// ── Probability Calibration & Brier Score Tracking ───────────────
// Converts raw Goal Radar scores (0-100) to calibrated probabilities.
// Tracks prediction accuracy using Brier Score, Log Loss, and
// calibration curves. Persists to JSON files for backtesting.
//
// Reference: Brier, G.W. (1950). "Verification of forecasts expressed
// in terms of probability." Monthly Weather Review.

// File system imports - only used server-side
let fs: any;
let path: any;
if (typeof window === 'undefined') {
  try {
    fs = require('fs');
    path = require('path');
  } catch {}
}

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

const DATA_DIR = typeof window === 'undefined' && path ? path.join(process.cwd(), 'data', 'calibration') : '';
const RECORDS_FILE = DATA_DIR ? path.join(DATA_DIR, 'records.json') : '';

// ── Calibration Curve (sigmoid-based) ────────────────────────────
// Maps raw score → calibrated probability using a fitted sigmoid.
// Default calibration based on football analytics research:
//   - Score 30 → ~8% probability
//   - Score 50 → ~25% probability
//   - Score 70 → ~55% probability
//   - Score 85 → ~75% probability

const CALIBRATION_PARAMS = {
  // Sigmoid: P = L / (1 + exp(-k * (score - x0)))
  L: 0.80,   // Maximum probability cap (80% — never 100% certain)
  k: 0.065,  // Steepness
  x0: 65,    // Midpoint (score where P ≈ L/2)
};

export function calibrateScore(rawScore: number): number {
  const { L, k, x0 } = CALIBRATION_PARAMS;
  const p = L / (1 + Math.exp(-k * (rawScore - x0)));
  return Math.round(p * 1000) / 1000; // 3 decimal places
}

// ── Brier Score ──────────────────────────────────────────────────
// BS = (1/N) × Σ (f_i - o_i)²
// f_i = predicted probability, o_i = actual outcome (0 or 1)
function calculateBrierScore(records: CalibrationRecord[]): number {
  if (records.length === 0) return 1.0;
  let sum = 0;
  for (const r of records) {
    const outcome = r.goalScored ? 1 : 0;
    sum += Math.pow(r.calibratedP - outcome, 2);
  }
  return sum / records.length;
}

// ── Log Loss ─────────────────────────────────────────────────────
// LL = -(1/N) × Σ [o_i × log(f_i) + (1-o_i) × log(1-f_i)]
function calculateLogLoss(records: CalibrationRecord[]): number {
  if (records.length === 0) return Infinity;
  let sum = 0;
  const eps = 1e-15; // avoid log(0)
  for (const r of records) {
    const p = Math.max(eps, Math.min(1 - eps, r.calibratedP));
    const o = r.goalScored ? 1 : 0;
    sum += o * Math.log(p) + (1 - o) * Math.log(1 - p);
  }
  return -(sum / records.length);
}

// ── Persistence ──────────────────────────────────────────────────

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveCalibrationRecord(record: CalibrationRecord): void {
  try {
    ensureDataDir();
    let records: CalibrationRecord[] = [];
    if (fs.existsSync(RECORDS_FILE)) {
      records = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf-8'));
    }
    records.push(record);

    // Keep last 10,000 records to avoid unbounded growth
    if (records.length > 10000) {
      records = records.slice(-10000);
    }

    fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error('[Calibration] Failed to save record:', e);
  }
}

function loadCalibrationRecords(): CalibrationRecord[] {
  try {
    ensureDataDir();
    if (fs.existsSync(RECORDS_FILE)) {
      return JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf-8'));
    }
  } catch {
    // empty
  }
  return [];
}

// ── Calibration Statistics ───────────────────────────────────────

export function calculateCalibrationStats(days?: number): CalibrationStats {
  let records = loadCalibrationRecords();

  // Filter by date if specified
  if (days) {
    const cutoff = Date.now() - days * 86400000;
    records = records.filter(r => r.timestamp >= cutoff);
  }

  if (records.length === 0) {
    return {
      totalPredictions: 0,
      totalGoals: 0,
      brierScore: 1.0,
      logLoss: Infinity,
      accuracy: 0,
      calibrationError: 0,
      bins: [],
      lastUpdated: Date.now(),
    };
  }

  const totalGoals = records.filter(r => r.goalScored).length;
  const brierScore = calculateBrierScore(records);
  const logLoss = calculateLogLoss(records);

  // Accuracy: % of predictions where calibratedP > 0.5 matches outcome
  let correct = 0;
  for (const r of records) {
    const predicted = r.calibratedP > 0.5;
    if (predicted === r.goalScored) correct++;
  }
  const accuracy = correct / records.length;

  // Calibration bins (10-point ranges: 0-10, 10-20, ..., 80-90)
  const bins: CalibrationBin[] = [];
  for (let lo = 0; lo < 90; lo += 10) {
    const hi = lo + 10;
    const binRecords = records.filter(r => r.score >= lo && r.score < hi);
    if (binRecords.length === 0) continue;

    const goalCount = binRecords.filter(r => r.goalScored).length;
    const avgCalP = binRecords.reduce((s, r) => s + r.calibratedP, 0) / binRecords.length;

    bins.push({
      scoreRange: [lo, hi],
      count: binRecords.length,
      goalCount,
      observedRate: goalCount / binRecords.length,
      avgCalibratedP: Math.round(avgCalP * 1000) / 1000,
    });
  }

  // Mean absolute calibration error
  let calErrorSum = 0;
  for (const bin of bins) {
    calErrorSum += Math.abs(bin.observedRate - bin.avgCalibratedP);
  }
  const calibrationError = bins.length > 0 ? calErrorSum / bins.length : 0;

  return {
    totalPredictions: records.length,
    totalGoals,
    brierScore: Math.round(brierScore * 10000) / 10000,
    logLoss: Math.round(logLoss * 10000) / 10000,
    accuracy: Math.round(accuracy * 1000) / 1000,
    calibrationError: Math.round(calibrationError * 10000) / 10000,
    bins,
    lastUpdated: Date.now(),
  };
}

// ── Auto-calibrate: adjust sigmoid params from observed data ──────
// Simple gradient-free optimization: adjust x0 and k to minimize
// Brier Score on historical data
export function autoCalibrate(): { x0: number; k: number; brierBefore: number; brierAfter: number } | null {
  const records = loadCalibrationRecords();
  if (records.length < 50) return null; // Need at least 50 records

  const currentBrier = calculateBrierScore(records);
  let bestX0 = CALIBRATION_PARAMS.x0;
  let bestK = CALIBRATION_PARAMS.k;
  let bestBrier = currentBrier;

  // Grid search over x0 (40-90) and k (0.03-0.10)
  for (let x0 = 40; x0 <= 90; x0 += 5) {
    for (let k = 30; k <= 100; k += 5) {
      const kVal = k / 1000;
      // Calculate Brier with these params
      let sum = 0;
      for (const r of records) {
        const p = CALIBRATION_PARAMS.L / (1 + Math.exp(-kVal * (r.score - x0)));
        const outcome = r.goalScored ? 1 : 0;
        sum += Math.pow(p - outcome, 2);
      }
      const brier = sum / records.length;
      if (brier < bestBrier) {
        bestBrier = brier;
        bestX0 = x0;
        bestK = kVal;
      }
    }
  }

  // Apply if improvement > 5%
  if (bestBrier < currentBrier * 0.95) {
    CALIBRATION_PARAMS.x0 = bestX0;
    CALIBRATION_PARAMS.k = bestK;
    return { x0: bestX0, k: bestK, brierBefore: currentBrier, brierAfter: bestBrier };
  }

  return null;
}
