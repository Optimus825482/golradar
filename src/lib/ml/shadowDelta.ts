// ── Shadow Brier Delta Helper ───────────────────────────────────────
// Standalone computation of best-shadow-vs-champion Brier delta.
// Kept as its own module so callers can compute deltas without
// pulling in the full shadow evaluator + DB rollup.

import { db } from '../db';

export const ShadowStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  INSUFFICIENT_DATA: 'insufficient-data',
} as const;

export type ShadowStatus = (typeof ShadowStatus)[keyof typeof ShadowStatus];

export interface ShadowDelta {
  status: ShadowStatus;
  championBrier: number | null;
  bestShadowBrier: number | null;
  bestShadowVariant: string | null;
  delta: number;
  nShadowSamples: number;
}

const DEGRADATION_THRESHOLD = 0.02;

export async function computeDailyShadowDelta(
  date: Date = new Date(),
): Promise<ShadowDelta> {
  const dateStr = date.toISOString().slice(0, 10);
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const logs = await db.predictionLog.findMany({
    where: {
      createdAt: { gte: dayStart, lt: dayEnd },
      goalScored: { not: null },
    },
    select: { modelVariant: true, calibratedP: true, goalScored: true },
  });

  if (logs.length === 0) {
    return {
      status: ShadowStatus.INSUFFICIENT_DATA,
      championBrier: null,
      bestShadowBrier: null,
      bestShadowVariant: null,
      delta: 0,
      nShadowSamples: 0,
    };
  }

  // Aggregate by variant
  const perVariant = new Map<string, { sum: number; n: number }>();
  for (const log of logs) {
    const v = log.modelVariant || 'champion';
    const brier = (log.calibratedP - (log.goalScored ? 1 : 0)) ** 2;
    const agg = perVariant.get(v) ?? { sum: 0, n: 0 };
    agg.sum += brier;
    agg.n += 1;
    perVariant.set(v, agg);
  }

  const champion = perVariant.get('champion');
  const championBrier = champion && champion.n > 0 ? champion.sum / champion.n : null;

  // Find the best non-champion variant
  let bestShadowBrier: number | null = null;
  let bestShadowVariant: string | null = null;
  let nShadowSamples = 0;
  for (const [v, agg] of perVariant.entries()) {
    if (v === 'champion') continue;
    if (agg.n < 50) continue; // need a real sample
    const brier = agg.sum / agg.n;
    if (bestShadowBrier === null || brier < bestShadowBrier) {
      bestShadowBrier = brier;
      bestShadowVariant = v;
      nShadowSamples = agg.n;
    }
  }

  if (championBrier === null || bestShadowBrier === null) {
    return {
      status: ShadowStatus.INSUFFICIENT_DATA,
      championBrier,
      bestShadowBrier,
      bestShadowVariant,
      delta: 0,
      nShadowSamples,
    };
  }

  const delta = bestShadowBrier - championBrier;
  return {
    status: delta > DEGRADATION_THRESHOLD ? ShadowStatus.DEGRADED : ShadowStatus.HEALTHY,
    championBrier,
    bestShadowBrier,
    bestShadowVariant,
    delta,
    nShadowSamples,
  };
}
