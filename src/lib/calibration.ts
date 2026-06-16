// ── Probability Calibration & Brier Score Tracking ───────────────
// Converts raw Goal Radar scores (0-100) to calibrated probabilities.
// Tracks prediction accuracy using Brier Score, Log Loss, and
// calibration curves. Persists to JSON files for backtesting.
//
// Reference: Brier, G.W. (1950). "Verification of forecasts expressed
// in terms of probability." Monthly Weather Review.

interface CalibrationRecord {
  score: number;           // Raw Goal Radar score (0-100)
  calibratedP: number;     // Calibrated probability (0-1)
  goalScored: boolean;     // Whether a goal was actually scored
  minutesToGoal: number | null; // Minutes from signal to goal (or null)
  timestamp: number;
  matchCode: number;
  side: 'home' | 'away' | 'both';
}

export interface CalibrationBin {
  scoreRange: [number, number]; // e.g., [30, 40)
  count: number;
  goalCount: number;
  observedRate: number;   // goalCount / count
  avgCalibratedP: number; // average calibrated probability
}

export interface CalibrationStats {
  totalPredictions: number;
  totalGoals: number;
  brierScore: number;
  logLoss: number;
  accuracy: number;
  calibrationError: number;  // Mean absolute calibration error
  bins: CalibrationBin[];
  lastUpdated: number;
}

function getServerFs(): { fs: any; path: any } | null {
  if (typeof window !== 'undefined') return null;
  try {
    return { fs: require('fs'), path: require('path') };
  } catch { return null; }
}

const s = getServerFs();
const DATA_DIR = s ? s.path.join(process.cwd(), 'data', 'calibration') : '';
const RECORDS_FILE = s ? s.path.join(DATA_DIR, 'records.json') : '';

// ── Calibration Curve (sigmoid-based) ────────────────────────────
// Parameters are runtime-mutable — autoCalibrateFromDB() updates them
// from actual PredictionLog outcomes.
export const CALIBRATION_PARAMS = {
  L: 0.80,      // max probability (ceiling)
  k: 0.065,     // steepness
  x0: 65,       // midpoint (score → 50% probability)
};

import { db } from "./db";

/** Optimize sigmoid params from PredictionLog table, persist to DB. */
export async function autoCalibrateFromDB(): Promise<{
  x0: number;
  k: number;
  brierBefore: number;
  brierAfter: number;
} | null> {
  // Load resolved predictions (goalScored not null) from last 90 days
  const logs = await db.predictionLog.findMany({
    where: { goalScored: { not: null }, modelVariant: "goaloo-season" },
    select: { rawScore: true, calibratedP: true, goalScored: true },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  if (logs.length < 50) return null;

  // Current brier
  const currentBrier =
    logs.reduce(
      (s, r) => s + Math.pow(r.calibratedP - (r.goalScored ? 1 : 0), 2),
      0,
    ) / logs.length;

  // Grid search for best (x0, k). L stays at 0.80 (ceiling)
  let bestX0 = CALIBRATION_PARAMS.x0;
  let bestK = CALIBRATION_PARAMS.k;
  let bestBrier = currentBrier;

  for (let x0 = 40; x0 <= 85; x0 += 2) {
    for (let kRaw = 20; kRaw <= 120; kRaw += 2) {
      const k = kRaw / 1000;
      let sum = 0;
      for (const r of logs) {
        const p = CALIBRATION_PARAMS.L / (1 + Math.exp(-k * (r.rawScore - x0)));
        sum += Math.pow(p - (r.goalScored ? 1 : 0), 2);
      }
      const brier = sum / logs.length;
      if (brier < bestBrier) {
        bestBrier = brier;
        bestX0 = x0;
        bestK = k;
      }
    }
  }

  // Only apply if meaningful improvement (>2% relative)
  if (bestBrier < currentBrier * 0.98) {
    CALIBRATION_PARAMS.x0 = bestX0;
    CALIBRATION_PARAMS.k = bestK;
    console.log(
      `[Calibration] Optimized: x0=${bestX0}, k=${bestK.toFixed(4)}, Brier ${currentBrier.toFixed(4)} → ${bestBrier.toFixed(4)}`,
    );
    return {
      x0: bestX0,
      k: bestK,
      brierBefore: currentBrier,
      brierAfter: bestBrier,
    };
  }

  console.log(
    `[Calibration] No improvement needed (Brier ${currentBrier.toFixed(4)}, best ${bestBrier.toFixed(4)})`,
  );
  return null;
}

export function calibrateScore(rawScore: number): number {
  const { L, k, x0 } = CALIBRATION_PARAMS;
  const p = L / (1 + Math.exp(-k * (rawScore - x0)));
  return Math.round(p * 1000) / 1000;
}

function calculateBrierScore(records: CalibrationRecord[]): number {
  if (records.length === 0) return 1.0;
  let sum = 0;
  for (const r of records) {
    const outcome = r.goalScored ? 1 : 0;
    sum += Math.pow(r.calibratedP - outcome, 2);
  }
  return sum / records.length;
}

function calculateLogLoss(records: CalibrationRecord[]): number {
  if (records.length === 0) return Infinity;
  let sum = 0;
  const eps = 1e-15;
  for (const r of records) {
    const p = Math.max(eps, Math.min(1 - eps, r.calibratedP));
    const o = r.goalScored ? 1 : 0;
    sum += o * Math.log(p) + (1 - o) * Math.log(1 - p);
  }
  return -(sum / records.length);
}

function ensureDataDir(): void {
  const s2 = getServerFs();
  if (!s2) return;
  if (!s2.fs.existsSync(DATA_DIR)) {
    s2.fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveCalibrationRecord(record: CalibrationRecord): void {
  try {
    const s2 = getServerFs();
    if (!s2) return;
    ensureDataDir();
    let records: CalibrationRecord[] = [];
    if (s2.fs.existsSync(RECORDS_FILE)) {
      records = JSON.parse(s2.fs.readFileSync(RECORDS_FILE, 'utf-8'));
    }
    records.push(record);
    if (records.length > 10000) records = records.slice(-10000);
    s2.fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error('[Calibration] Failed to save record:', e);
  }
}

function loadCalibrationRecords(): CalibrationRecord[] {
  try {
    const s2 = getServerFs();
    if (!s2) return [];
    ensureDataDir();
    if (s2.fs.existsSync(RECORDS_FILE)) {
      return JSON.parse(s2.fs.readFileSync(RECORDS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

export function calculateCalibrationStats(days?: number): CalibrationStats {
  let records = loadCalibrationRecords();
  if (days) {
    const cutoff = Date.now() - days * 86400000;
    records = records.filter(r => r.timestamp >= cutoff);
  }
  if (records.length === 0) {
    return {
      totalPredictions: 0, totalGoals: 0, brierScore: 1.0, logLoss: Infinity,
      accuracy: 0, calibrationError: 0, bins: [], lastUpdated: Date.now(),
    };
  }
  const totalGoals = records.filter(r => r.goalScored).length;
  const brierScore = calculateBrierScore(records);
  const logLoss = calculateLogLoss(records);
  let correct = 0;
  for (const r of records) {
    if ((r.calibratedP > 0.5) === r.goalScored) correct++;
  }
  const accuracy = correct / records.length;
  const bins: CalibrationBin[] = [];
  for (let lo = 0; lo < 90; lo += 10) {
    const hi = lo + 10;
    const binRecords = records.filter(r => r.score >= lo && r.score < hi);
    if (binRecords.length === 0) continue;
    const goalCount = binRecords.filter(r => r.goalScored).length;
    const avgCalP = binRecords.reduce((s, r) => s + r.calibratedP, 0) / binRecords.length;
    bins.push({
      scoreRange: [lo, hi], count: binRecords.length, goalCount,
      observedRate: goalCount / binRecords.length,
      avgCalibratedP: Math.round(avgCalP * 1000) / 1000,
    });
  }
  let calErrorSum = 0;
  for (const bin of bins) calErrorSum += Math.abs(bin.observedRate - bin.avgCalibratedP);
  const calibrationError = bins.length > 0 ? calErrorSum / bins.length : 0;
  return {
    totalPredictions: records.length, totalGoals,
    brierScore: Math.round(brierScore * 10000) / 10000,
    logLoss: Math.round(logLoss * 10000) / 10000,
    accuracy: Math.round(accuracy * 1000) / 1000,
    calibrationError: Math.round(calibrationError * 10000) / 10000,
    bins, lastUpdated: Date.now(),
  };
}

export function autoCalibrate(): { x0: number; k: number; brierBefore: number; brierAfter: number } | null {
  const records = loadCalibrationRecords();
  if (records.length < 50) return null;
  const currentBrier = calculateBrierScore(records);
  let bestX0 = CALIBRATION_PARAMS.x0;
  let bestK = CALIBRATION_PARAMS.k;
  let bestBrier = currentBrier;
  for (let x0 = 40; x0 <= 90; x0 += 5) {
    for (let k = 30; k <= 100; k += 5) {
      const kVal = k / 1000;
      let sum = 0;
      for (const r of records) {
        const p = CALIBRATION_PARAMS.L / (1 + Math.exp(-kVal * (r.score - x0)));
        sum += Math.pow(p - (r.goalScored ? 1 : 0), 2);
      }
      const brier = sum / records.length;
      if (brier < bestBrier) { bestBrier = brier; bestX0 = x0; bestK = kVal; }
    }
  }
  if (bestBrier < currentBrier * 0.95) {
    CALIBRATION_PARAMS.x0 = bestX0;
    CALIBRATION_PARAMS.k = bestK;
    return { x0: bestX0, k: bestK, brierBefore: currentBrier, brierAfter: bestBrier };
  }
  return null;
}
