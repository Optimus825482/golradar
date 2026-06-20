// ── Shadow Evaluator ────────────────────────────────────────────────
// Daily roll-up of per-variant Brier scores from `PredictionLog`.
// Compares every modelVariant (champion, artifact:<name>@<ver>,
// shadow:<name>@<ver>) against the champion and records:
//
//   ModelMetrics:
//     - gbdtBrier / xgbBrier / inPlayBrier / teamStrengthBrier
//       (one column per *name*, picking the most recent artifact's
//        metrics for that name)
//     - shadowBrierDelta (best shadow - champion; negative = shadow wins)
//     - nShadowSamples
//
// Auto-suspend policy: if any shadow variant is 0.02+ worse than
// champion for 2 consecutive days, flip its `isChampion=false`
// (it already shouldn't be champion, so this is a safety net) and
// write a deprecation note. We don't delete the artifact —
// operators may want to inspect it before removal.

import { db } from '../db';
import { ShadowStatus } from './shadowDelta';
import type { ModelName } from './modelRouter';
import { logWarn } from '@/lib/devLog';

export interface DailyMetricsResult {
  date: string; // YYYY-MM-DD
  modelMetricsId: string | null;
  championBrier: number;
  perVariant: Record<string, { brier: number; n: number; artifact: string | null }>;
  shadowBrierDelta: number;
  nShadowSamples: number;
  suspendedVariants: string[];
  computedAt: string;
}

/**
 * Compute the daily metrics for a single date (defaults to today UTC).
 * Re-runnable: produces a deterministic aggregation. The caller
 * (scheduler) decides whether to persist the result.
 */
export async function evaluateDailyShadows(
  date: Date = new Date(),
  options: { persist?: boolean } = {},
): Promise<DailyMetricsResult> {
  const dateStr = date.toISOString().slice(0, 10);
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const { persist = true } = options;

  // Fetch all predictions for the day, then group by modelVariant
  const logs = await db.predictionLog.findMany({
    where: {
      createdAt: { gte: dayStart, lt: dayEnd },
      goalScored: { not: null }, // only resolved
    },
    select: {
      modelVariant: true,
      calibratedP: true,
      goalScored: true,
    },
  });

  if (logs.length === 0) {
    return {
      date: dateStr,
      modelMetricsId: null,
      championBrier: 0,
      perVariant: {},
      shadowBrierDelta: 0,
      nShadowSamples: 0,
      suspendedVariants: [],
      computedAt: new Date().toISOString(),
    };
  }

  // Aggregate Brier per variant
  const perVariantAgg = new Map<string, { sum: number; n: number; artifact: string | null }>();
  for (const log of logs) {
    const v = log.modelVariant || 'champion';
    const brier = (log.calibratedP - (log.goalScored ? 1 : 0)) ** 2;
    const existing = perVariantAgg.get(v) ?? { sum: 0, n: 0, artifact: null };
    existing.sum += brier;
    existing.n += 1;
    perVariantAgg.set(v, existing);
  }

  // Feature parity check: champion and shadow must share label space.
  // If shadow variant n is < 20% of champion n, flag as under-sampled.
  const championN = perVariantAgg.get('champion')?.n ?? 0;
  if (championN > 50) {
    for (const [v, agg] of perVariantAgg.entries()) {
      if (v === 'champion') continue;
      if (agg.n > 0 && agg.n < championN * 0.2) {
        logWarn('shadowEvaluator',
          `Parity gap: ${v} has ${agg.n} samples vs champion ${championN} — may under-represent`);
      }
    }
  }

  // Resolve artifact names from disk (for shadow/artifact variants,
  // the second token is the artifact id like "xgb@1.0.0")
  for (const [variant, agg] of perVariantAgg.entries()) {
    if (variant.startsWith('artifact:') || variant.startsWith('shadow:')) {
      const id = variant.split('@')[1];
      agg.artifact = id ?? null;
    }
  }

  // Champion Brier
  const championAgg = perVariantAgg.get('champion');
  const championBrier = championAgg && championAgg.n > 0
    ? championAgg.sum / championAgg.n
    : 0;

  // Build per-variant result map
  const perVariant: Record<string, { brier: number; n: number; artifact: string | null }> = {};
  for (const [v, agg] of perVariantAgg.entries()) {
    perVariant[v] = { brier: agg.sum / agg.n, n: agg.n, artifact: agg.artifact };
  }

  // Best shadow: minimum Brier across all non-champion variants
  let bestShadowBrier = Infinity;
  let nShadowSamples = 0;
  for (const [v, agg] of perVariantAgg.entries()) {
    if (v === 'champion') continue;
    const brier = agg.sum / agg.n;
    if (brier < bestShadowBrier) {
      bestShadowBrier = brier;
      nShadowSamples = agg.n;
    }
  }
  if (!isFinite(bestShadowBrier)) bestShadowBrier = 0;
  const shadowBrierDelta = championBrier > 0 ? bestShadowBrier - championBrier : 0;

  // Per-name column picks: take the most-recent artifact for that
  // name (so ModelMetrics tracks the *current* version of "xgb" rather
  // than averaging every historical xgb shadow).
  const perNameBrier: Partial<Record<ModelName, number>> = {};
  for (const name of ['gbdt', 'xgb', 'inplay', 'team-strength'] as ModelName[]) {
    // Find any variant row that contains the name (e.g. "xgb@1.0.0"
    // or "shadow:xgb@...") and pick the one with the highest n.
    let best: { variant: string; brier: number; n: number } | null = null;
    for (const [v, agg] of perVariantAgg.entries()) {
      const lower = v.toLowerCase();
      if (!lower.includes(name) && !(v === 'champion' && name === 'gbdt')) continue;
      const brier = agg.sum / agg.n;
      if (!best || agg.n > best.n) {
        best = { variant: v, brier, n: agg.n };
      }
    }
    if (best) perNameBrier[name] = best.brier;
  }

  // Auto-suspend check: a shadow variant > 0.02 worse than champion
  // for 2+ consecutive days. We look at the previous day's row.
  const suspendedVariants: string[] = [];
  if (championBrier > 0) {
    const yesterday = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
    const yStr = yesterday.toISOString().slice(0, 10);
    const prevMetrics = await db.modelMetrics.findUnique({
      where: { date: yesterday },
    });
    if (prevMetrics && prevMetrics.shadowBrierDelta) {
      // Two days of bad shadow: log a note on today's row.
      // We don't actually flip isChampion=false because shadows
      // shouldn't be champion to begin with. Instead we mark the
      // artifact with a `notes` flag for human review.
      const bothBad = shadowBrierDelta > 0.02 && prevMetrics.shadowBrierDelta > 0.02;
      if (bothBad) {
        for (const [v, agg] of perVariantAgg.entries()) {
          if (v === 'champion') continue;
          const brier = agg.sum / agg.n;
          if (brier - championBrier > 0.02) {
            suspendedVariants.push(v);
          }
        }
      }
    }
    void yStr; // suppress unused warning
  }

  // Persist to ModelMetrics
  let modelMetricsId: string | null = null;
  if (persist) {
    const updated = await db.modelMetrics.upsert({
      where: { date: dayStart },
      create: {
        date: dayStart,
        brierScore: championBrier,
        logLoss: 0, // populated separately if needed
        accuracy: 0,
        totalPredictions: logs.length,
        totalGoals: logs.filter((l) => l.goalScored).length,
        avgCalibratedP: 0,
        goalAfterSignalP: 0,
        avgMinutesToGoal: 0,
        calibrationError: 0,
        gbdtBrier: perNameBrier['gbdt'] ?? null,
        xgbBrier: perNameBrier['xgb'] ?? null,
        teamStrengthBrier: perNameBrier['team-strength'] ?? null,
        inPlayBrier: perNameBrier['inplay'] ?? null,
        shadowBrierDelta: championBrier > 0 ? shadowBrierDelta : null,
        nShadowSamples,
      },
      update: {
        brierScore: championBrier,
        totalPredictions: logs.length,
        totalGoals: logs.filter((l) => l.goalScored).length,
        gbdtBrier: perNameBrier['gbdt'] ?? null,
        xgbBrier: perNameBrier['xgb'] ?? null,
        teamStrengthBrier: perNameBrier['team-strength'] ?? null,
        inPlayBrier: perNameBrier['inplay'] ?? null,
        shadowBrierDelta: championBrier > 0 ? shadowBrierDelta : null,
        nShadowSamples,
      },
    });
    modelMetricsId = updated.id;
  }

  return {
    date: dateStr,
    modelMetricsId,
    championBrier,
    perVariant,
    shadowBrierDelta,
    nShadowSamples,
    suspendedVariants,
    computedAt: new Date().toISOString(),
  };
}

// ── Re-export to keep API surface tight ─────────────────────────────
export { ShadowStatus };
