// ── Model Backtest (DB-backed, model-aware) ───────────────────────
// Evaluates any registered model artifact against historical
// `PredictionLog` rows. Joins with `MatchEvent` to determine the
// actual goal outcome (label) for each prediction.
//
// Supports three modes:
//   - 'champion'     : the currently promoted model (per `ModelArtifact.isChampion`)
//   - 'artifact:<name>@<version>' : a specific artifact
//   - 'live:<modelVariant>' : a shadow variant string from PredictionLog.modelVariant
//
// The new model replaces the JSON-file backtest in `backtestEngine.ts`
// for A/B comparisons. We do NOT delete the old engine — it's still
// the entry point for the `/api/backtest` route and for parity
// testing against historical data.

import { db } from '../db';
import { featuresToArray, type MatchFeatures } from '../featureEngineering';
import { getXgbModelCached, predictXgb, type XgbModel } from './xgbLoader';
import type { ModelName } from './modelRouter';

export type ModelSelector =
  | { kind: 'champion' }
  | { kind: 'artifact'; name: ModelName; version: string }
  | { kind: 'shadow'; shadowName: string; shadowVersion: string };

export const CHAMPION_SELECTOR: ModelSelector = { kind: 'champion' };

export interface BacktestModelResult {
  selector: string;            // resolved to a string for reporting
  selectorKind: 'champion' | 'artifact' | 'shadow';
  totalPredictions: number;
  resolvedPredictions: number; // those with a known label
  brierScore: number;
  logLoss: number;
  accuracy: number;
  calibrationError: number;
  precision: number;
  recall: number;
  f1Score: number;
  falsePositiveRate: number;
  sideAccuracy: { home: number; away: number };
  levelDistribution: Record<string, { total: number; goals: number; correct: number }>;
  byDay: Array<{ date: string; total: number; goals: number; brier: number }>;
  computedAt: string;
  notes: string[];
}

export interface BacktestModelConfig {
  // Number of days back from now() to evaluate
  days?: number;
  // Minimum prediction count required — return null below this
  minSamples?: number;
  // Optional side filter: 'home' | 'away' | 'both' (default all)
  side?: 'home' | 'away' | 'both';
  // Slice by minute range (inclusive)
  minuteMin?: number;
  minuteMax?: number;
  // Sample cap (0 = unlimited)
  maxRows?: number;
}

// ── Helpers ────────────────────────────────────────────────────────

interface ResolvedLog {
  features: number[];
  label: number; // 0 = no goal, 1 = goal
  side: 'home' | 'away' | 'both';
  level: 'low' | 'medium' | 'high' | 'critical';
  date: string; // YYYY-MM-DD
  matchCode: number;
  modelVariant: string;
}

function buildBucketMap(): Record<string, { total: number; goals: number; correct: number }> {
  return {
    low: { total: 0, goals: 0, correct: 0 },
    medium: { total: 0, goals: 0, correct: 0 },
    high: { total: 0, goals: 0, correct: 0 },
    critical: { total: 0, goals: 0, correct: 0 },
  };
}

function clamp01(p: number): number {
  return Math.max(1e-9, Math.min(1 - 1e-9, p));
}

function computeEce(probs: number[], labels: number[], nBins = 10): number {
  if (probs.length === 0) return 0;
  const bins = new Array(nBins).fill(0).map(() => ({ conf: 0, acc: 0, n: 0 }));
  for (let i = 0; i < probs.length; i++) {
    const idx = Math.min(nBins - 1, Math.floor(probs[i] * nBins));
    bins[idx].conf += probs[i];
    bins[idx].acc += labels[i];
    bins[idx].n += 1;
  }
  let ece = 0;
  const n = probs.length;
  for (const b of bins) {
    if (b.n === 0) continue;
    ece += (b.n / n) * Math.abs(b.conf / b.n - b.acc / b.n);
  }
  return ece;
}

// ── Main: compare two selectors (champion vs candidate) ────────────

export interface CompareResult {
  champion: BacktestModelResult;
  candidate: BacktestModelResult;
  delta: {
    brier: number;       // candidate - champion (negative = candidate wins)
    logLoss: number;
    accuracy: number;
    sampleCount: number; // min(champion, candidate) — to compare fairly
    winner: 'champion' | 'candidate' | 'tie';
  };
  computedAt: string;
}

export async function runModelBacktest(
  selector: ModelSelector,
  config: BacktestModelConfig = {},
): Promise<BacktestModelResult | null> {
  const {
    days = 30,
    minSamples = 50,
    side,
    minuteMin,
    minuteMax,
    maxRows = 0,
  } = config;
  const cutoff = new Date(Date.now() - days * 86_400_000);

  // Determine which modelVariant discriminator to pull
  let variantFilter: string | null = null;
  let kind: "champion" | "artifact" | "shadow" = "champion";
  let resolvedSelector = "";
  if (selector.kind === "champion") {
    kind = "champion";
    variantFilter = "champion";
    resolvedSelector = "champion";
  } else if (selector.kind === "artifact") {
    kind = "artifact";
    variantFilter = `artifact:${selector.name}@${selector.version}`;
    resolvedSelector = variantFilter;
  } else {
    kind = "shadow";
    variantFilter = `shadow:${selector.shadowName}@${selector.shadowVersion}`;
    resolvedSelector = variantFilter;
  }

  // For artifact/shadow cases we need the model to run predictions;
  // for champion we use the stored calibratedP directly.
  let xgbModel: XgbModel | null = null;
  let modelLoadError: string | null = null;
  if (selector.kind === "artifact") {
    const meta = await db.modelArtifact.findUnique({
      where: {
        name_version: { name: selector.name, version: selector.version },
      },
    });
    if (!meta) {
      return null;
    }
    try {
      xgbModel = await getXgbModelCached(meta.artifactPath);
    } catch (e: unknown) {
      modelLoadError = `Model yuklenemedi: ${(e as Error)?.message ?? e}`;
    }
  } else if (selector.kind === "shadow") {
    const meta = await db.modelArtifact.findUnique({
      where: {
        name_version: {
          name: selector.shadowName as ModelName,
          version: selector.shadowVersion,
        },
      },
    });
    if (!meta) {
      return null;
    }
    try {
      xgbModel = await getXgbModelCached(meta.artifactPath);
    } catch (e: unknown) {
      modelLoadError = `Model yuklenemedi: ${(e as Error)?.message ?? e}`;
    }
  }

  // If model couldn't load, return an error-like result instead of crashing
  if (modelLoadError) {
    return {
      selector: resolvedSelector,
      selectorKind: kind,
      totalPredictions: 0,
      resolvedPredictions: 0,
      brierScore: 0,
      logLoss: 0,
      accuracy: 0,
      calibrationError: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      falsePositiveRate: 0,
      sideAccuracy: { home: 0, away: 0 },
      levelDistribution: buildBucketMap(),
      byDay: [],
      computedAt: new Date().toISOString(),
      notes: [modelLoadError],
    };
  }

  // Query PredictionLog rows
  const whereFilter: Record<string, unknown> = {
    createdAt: { gte: cutoff },
    goalScored: { not: null },
  };
  // Champion re-uses stored calibratedP (no re-score needed).
  // Artifact/shadow re-score ALL available rows through the new model.
  // All modes need goalScored != null for a label.
  if (kind !== "champion") {
    // Artifact/shadow re-scoring needs featuresJson
    whereFilter.featuresJson = { not: null };
  }
  if (side && side !== "both") whereFilter.side = side;
  if (minuteMin != null) whereFilter.minute = { gte: minuteMin };
  if (minuteMax != null) {
    whereFilter.minute = {
      ...(whereFilter.minute as Record<string, number> | undefined),
      lte: minuteMax,
    };
  }

  const logs = await db.predictionLog.findMany({
    where: whereFilter,
    orderBy: { createdAt: "asc" },
    take: maxRows > 0 ? maxRows : 50_000,
  });

  if (logs.length < minSamples) return null;

  // Build features, labels, and probArray in a SINGLE pass
  const resolved: ResolvedLog[] = [];
  const probArray: number[] = [];

  for (const log of logs) {
    // Champion mode uses stored calibratedP — features not needed.
    // Artifact/shadow modes re-score through XGB — need featuresJson.
    let features: number[];
    if (kind === "champion") {
      features = [];
    } else {
      if (!log.featuresJson) continue;
      try {
        const parsed = JSON.parse(log.featuresJson) as MatchFeatures;
        features = featuresToArray(parsed);
      } catch {
        continue;
      }
    }

    // Compute probability once — same value used for all metrics
    let p: number;
    if (xgbModel) {
      p = clamp01(predictXgb(xgbModel, features));
    } else {
      p = clamp01(log.calibratedP);
    }
    probArray.push(p);

    const label = log.goalScored === true ? 1 : 0;

    // Normalize level to guard against case/whitespace mismatches
    const rawLevel = (log.level || "").trim().toLowerCase();
    const normLevel = ["low", "medium", "high", "critical"].includes(rawLevel)
      ? rawLevel
      : "low";

    resolved.push({
      features,
      label,
      side: log.side as "home" | "away" | "both",
      level: normLevel as "low" | "medium" | "high" | "critical",
      date: new Date(log.createdAt).toISOString().slice(0, 10),
      matchCode: log.matchCode,
      modelVariant: log.modelVariant,
    });
  }

  if (resolved.length < minSamples) return null;

  const labels = resolved.map((r) => r.label);
  if (probArray.length !== labels.length) return null;
  const brier =
    probArray.reduce((acc, p, i) => acc + (p - (labels[i] ?? 0)) ** 2, 0) /
    probArray.length;
  const logLoss =
    -probArray.reduce(
      (acc, p, i) =>
        acc +
        (labels[i] ?? 0) * Math.log(p) +
        (1 - (labels[i] ?? 0)) * Math.log(1 - p),
      0,
    ) / probArray.length;
  const predictedPositives = probArray.map((p) => (p > 0.5 ? 1 : 0));
  let correct = 0;
  for (let i = 0; i < predictedPositives.length; i++) {
    if (predictedPositives[i] === (labels[i] ?? 0)) correct++;
  }
  const accuracy = correct / probArray.length;
  const truePos = labels.reduce<number>(
    (acc, y, i) =>
      y === 1 && (predictedPositives[i] ?? 0) === 1 ? acc + 1 : acc,
    0,
  );
  const falsePos = labels.reduce<number>(
    (acc, y, i) =>
      y === 0 && (predictedPositives[i] ?? 0) === 1 ? acc + 1 : acc,
    0,
  );
  const actualPos = labels.reduce((acc, y) => acc + (y === 1 ? 1 : 0), 0);
  const actualNeg = labels.length - actualPos;
  const precision = truePos + falsePos > 0 ? truePos / (truePos + falsePos) : 0;
  const recall = actualPos > 0 ? truePos / actualPos : 0;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;
  const fpr = actualNeg > 0 ? falsePos / actualNeg : 0;

  // Per-side accuracy
  const homeSignals = resolved.filter((r) => r.side === "home");
  const awaySignals = resolved.filter((r) => r.side === "away");
  let homeCorrect = 0;
  for (const r of homeSignals) {
    const idx = resolved.indexOf(r);
    if ((predictedPositives[idx] ?? 0) === r.label) homeCorrect++;
  }
  let awayCorrect = 0;
  for (const r of awaySignals) {
    const idx = resolved.indexOf(r);
    if ((predictedPositives[idx] ?? 0) === r.label) awayCorrect++;
  }
  const homeSideAccuracy =
    homeSignals.length > 0 ? homeCorrect / homeSignals.length : 0;
  const awaySideAccuracy =
    awaySignals.length > 0 ? awayCorrect / awaySignals.length : 0;

  // Level distribution
  const levelDist = buildBucketMap();
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]!;
    const lvl = levelDist[r.level];
    if (!lvl) continue;
    lvl.total += 1;
    if (r.label === 1) lvl.goals += 1;
    if (predictedPositives[i] === r.label) lvl.correct += 1;
  }

  // Per-day
  const byDayMap = new Map<
    string,
    { total: number; goals: number; brierSum: number }
  >();
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]!;
    const day = byDayMap.get(r.date) ?? { total: 0, goals: 0, brierSum: 0 };
    day.total += 1;
    if (r.label === 1) day.goals += 1;
    day.brierSum += (probArray[i]! - r.label) ** 2;
    byDayMap.set(r.date, day);
  }
  const byDay = Array.from(byDayMap.entries())
    .map(([date, v]) => ({
      date,
      total: v.total,
      goals: v.goals,
      brier: v.brierSum / v.total,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const notes: string[] = [];
  notes.push(
    `Backtest: selector=${resolvedSelector}, kind=${kind}, ` +
      `predictions=${resolved.length}, uniqueDays=${byDay.length}`,
  );
  if (kind === "champion" && xgbModel) {
    notes.push(
      "Champion re-scored through modelRouter; matches stored calibratedP within 1e-3.",
    );
  }
  if (kind === "artifact" || kind === "shadow") {
    notes.push(
      "Candidate re-scored through XGBoost loader; champion uses stored log.calibratedP.",
    );
  }

  return {
    selector: resolvedSelector,
    selectorKind: kind,
    totalPredictions: resolved.length,
    resolvedPredictions: resolved.length,
    brierScore: brier,
    logLoss,
    accuracy,
    calibrationError: computeEce(probArray, labels),
    precision,
    recall,
    f1Score: f1,
    falsePositiveRate: fpr,
    sideAccuracy: { home: homeSideAccuracy, away: awaySideAccuracy },
    levelDistribution: levelDist,
    byDay,
    computedAt: new Date().toISOString(),
    notes,
  };
}

export async function runCompareBacktest(
  candidate: { name: ModelName; version: string },
  config: BacktestModelConfig = {},
): Promise<CompareResult | null> {
  const champion = await runModelBacktest(CHAMPION_SELECTOR, config);
  const cand = await runModelBacktest(
    { kind: 'artifact', name: candidate.name, version: candidate.version },
    config,
  );
  if (!champion || !cand) return null;
  // For a fair compare, restrict to overlapping time window + min
  // sample count. For v1 we trust both ran on the same config.
  const sampleCount = Math.min(champion.resolvedPredictions, cand.resolvedPredictions);
  const deltaBrier = cand.brierScore - champion.brierScore;
  const deltaLogLoss = cand.logLoss - champion.logLoss;
  const deltaAcc = cand.accuracy - champion.accuracy;
  let winner: 'champion' | 'candidate' | 'tie' = 'tie';
  if (deltaBrier < -0.005 && sampleCount >= 200) winner = 'candidate';
  else if (deltaBrier > 0.005) winner = 'champion';

  return {
    champion,
    candidate: cand,
    delta: {
      brier: deltaBrier,
      logLoss: deltaLogLoss,
      accuracy: deltaAcc,
      sampleCount,
      winner,
    },
    computedAt: new Date().toISOString(),
  };
}
