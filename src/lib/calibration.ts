// ── Probability Calibration & Brier Score Tracking ───────────────
// Converts raw Goal Radar scores (0-100) to calibrated probabilities.
// Tracks prediction accuracy using Brier Score, Log Loss, and
// calibration curves.
//
// Persistence (Faz 2): SystemConfig tablosu (sigmoid L/k/x0 + isotonic
// breakpoint'leri) + PredictionLog (istatistik/autoCalibrate kaynağı).
// Disk'teki data/calibration/records.json + isotonic.json YOK.
//
// Reference: Brier, G.W. (1950). "Verification of forecasts expressed
// in terms of probability." Monthly Weather Review.

import { db } from "./db";
import { logError, logInfo } from '@/lib/devLog';
import { DEFAULT_CALIBRATION_PARAMS } from '@/config';

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
  brierScore: number | null;
  logLoss: number | null;
  accuracy: number | null;
  calibrationError: number | null;  // Mean absolute calibration error
  bins: CalibrationBin[];
  lastUpdated: number;
}

// ── SystemConfig anahtarları ────────────────────────────────────
const SYSTEM_KEY_PARAMS = 'calibration.params';
const SYSTEM_KEY_ISOTONIC = 'calibration.isotonic';

// ── Calibration Curve (sigmoid-based) ────────────────────────────
// Runtime-mutable. autoCalibrateFromDB() DB'ye yazdığında in-memory
// cache de güncellenir. Startup'ta hydrateFromDB() ile DB'den çekilir.
export const CALIBRATION_PARAMS: { L: number; k: number; x0: number; T: number } = {
  ...DEFAULT_CALIBRATION_PARAMS,
};

// ── Isotonic regression (PAVA) ───────────────────────────────────
// Non-parametric monotonic mapping. Outperforms sigmoid for tree-based
// models when n ≥ 500 validation samples (Niculescu-Mizil 2005).
// Persisted in SystemConfig (calibration.isotonic) as JSONB.
interface IsotonicTable {
  /** Sorted x breakpoints in [0,1] */
  x: number[];
  /** Corresponding calibrated values in [0,1], non-decreasing */
  y: number[];
  fittedAt: number;
  fittedN: number;
}

// ── Beta Calibration ──────────────────────────────────────────
// Bilgi: Beta calibration fits a scaled Beta CDF transformation to
// probability outputs. Particularly effective for [0,1]-bounded
// predictions (Kull et al., 2017). Parameters: a, b (shape), c (scale).
// Transform: log(p/(1-p)) → logit space → Beta CDF.
interface BetaParams {
  a: number;      // Beta shape 1
  b: number;      // Beta shape 2
  c: number;      // Scale factor
  d: number;      // Intercept
  fittedAt: number;
  fittedN: number;
}

let cachedBeta: BetaParams | null = null;
const SYSTEM_KEY_BETA = 'calibration.beta';

let cachedIsotonic: IsotonicTable | null = null;

function poolAdjacentViolators(xIn: number[], yIn: number[]): { x: number[]; y: number[] } {
  const pairs = xIn.map((x, i) => [x, yIn[i]] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const xs = pairs.map(p => p[0]);
  const ys: number[] = pairs.map(p => p[1]);

  const blockMeans: number[] = [];
  const blockSizes: number[] = [];
  let curMean = ys[0];
  let curSize = 1;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] >= curMean) {
      curMean = (curMean * curSize + ys[i]) / (curSize + 1);
      curSize++;
    } else {
      blockMeans.push(curMean);
      blockSizes.push(curSize);
      curMean = ys[i];
      curSize = 1;
    }
  }
  blockMeans.push(curMean);
  blockSizes.push(curSize);

  const calibrated = new Array<number>(xs.length);
  let idx = 0;
  for (let b = 0; b < blockMeans.length; b++) {
    for (let k = 0; k < blockSizes[b]; k++) {
      calibrated[idx++] = blockMeans[b];
    }
  }
  const outX: number[] = [];
  const outY: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (i === 0 || calibrated[i] !== outY[outY.length - 1]) {
      outX.push(xs[i]);
      outY.push(calibrated[i]);
    }
  }
  return { x: outX, y: outY };
}

// ── SystemConfig hydrate / persist ───────────────────────────────
/** DB'den calibration params + isotonic + beta çekip in-memory cache'i doldurur. */
export async function hydrateCalibrationFromDB(): Promise<void> {
  try {
    const rows = await db.systemConfig.findMany({
      where: { key: { in: [SYSTEM_KEY_PARAMS, SYSTEM_KEY_ISOTONIC, SYSTEM_KEY_BETA] } },
    });
    for (const row of rows) {
      if (row.key === SYSTEM_KEY_PARAMS) {
        const v = row.value as { L?: number; k?: number; x0?: number; T?: number } | null;
        if (v && typeof v.L === 'number' && typeof v.k === 'number' && typeof v.x0 === 'number') {
          // Guard: sagliksiz degerler varsa varsayilani kullan
          const sane = (val: number, min: number, max: number, def: number) =>
            val >= min && val <= max ? val : def;
          CALIBRATION_PARAMS.L = sane(v.L, 0.01, 1.0, 0.90);
          CALIBRATION_PARAMS.k = sane(v.k, 0.001, 1.0, 0.05);
          CALIBRATION_PARAMS.x0 = sane(v.x0, 0, 100, 30);
          CALIBRATION_PARAMS.T = typeof v.T === 'number' ? sane(v.T, 0.001, 1.0, 0.08) : 0.08;
        }
      } else if (row.key === SYSTEM_KEY_ISOTONIC) {
        const v = row.value as IsotonicTable | null;
        if (v && Array.isArray(v.x) && Array.isArray(v.y) && v.x.length === v.y.length) {
          cachedIsotonic = v;
        }
      } else if (row.key === SYSTEM_KEY_BETA) {
        const v = row.value as BetaParams | null;
        if (v && typeof v.c === 'number' && typeof v.d === 'number') {
          cachedBeta = v;
        }
      }
    }
  } catch (e) {
    logError('calibration', 'hydrateFromDB failed:', e);
  }
}

async function persistParamsToDB(updatedBy: string): Promise<void> {
  await db.systemConfig.upsert({
    where: { key: SYSTEM_KEY_PARAMS },
	    create: {
	      key: SYSTEM_KEY_PARAMS,
	      value: { L: CALIBRATION_PARAMS.L, k: CALIBRATION_PARAMS.k, x0: CALIBRATION_PARAMS.x0, T: CALIBRATION_PARAMS.T },
	      updatedBy,
	    },
	    update: {
	      value: { L: CALIBRATION_PARAMS.L, k: CALIBRATION_PARAMS.k, x0: CALIBRATION_PARAMS.x0, T: CALIBRATION_PARAMS.T },
	      updatedBy,
	    },
	  });
}

// ── Beta Calibration ──────────────────────────────────────────
// Beta calibration for [0,1]-bounded probability outputs.
// Fits: logit(p) = c * log(p/(1-p)) + d, then applies Beta CDF.
// Reference: Kull, M., Silva Filho, T., & Flach, P. (2017). "Beta
// calibration: a well-founded foundation for calibration."
//
// Works best when isotonic is unstable (small N) or overfits.
export function fitBeta(
  rawScores: number[],  // 0-100
  actuals: number[],     // 0 or 1
): BetaParams | null {
  if (rawScores.length !== actuals.length || rawScores.length < 30) return null;

  // Normalize scores to (0,1), clamping edges to avoid log(0)
  const ps = rawScores.map(s => {
    const p = s / 100;
    return Math.max(1e-6, Math.min(1 - 1e-6, p));
  });

  // Logit transform: log(p / (1-p))
  const logits = ps.map(p => Math.log(p / (1 - p)));

  // Simple logistic regression in logit space:
  // target ~ Bernoulli, link=logit, predictors=[logit(p), 1]
  // Use gradient descent to fit a, b (slope=coeff, intercept)
  // goal: minimize log loss
  let a = 1.0; // slope (c in beta params)
  let b = 0.0; // intercept (d in beta params)
  const lr = 0.01;
  const epochs = 1000;

  for (let epoch = 0; epoch < epochs; epoch++) {
    let gradA = 0, gradB = 0;
    for (let i = 0; i < ps.length; i++) {
      const z = a * logits[i] + b;
      const pred = 1 / (1 + Math.exp(-z));
      const err = pred - actuals[i];
      gradA += err * logits[i];
      gradB += err;
    }
    gradA /= ps.length;
    gradB /= ps.length;
    a -= lr * gradA;
    b -= lr * gradB;
  }

  // Clamp to prevent extreme values
  a = Math.max(0.1, Math.min(10, a));
  b = Math.max(-10, Math.min(10, b));

  const params: BetaParams = {
    a: 1,  // Beta shape 1 (default 1 = uniform prior)
    b: 1,  // Beta shape 2
    c: a,  // scale = logistic regression slope
    d: b,  // intercept
    fittedAt: Date.now(),
    fittedN: rawScores.length,
  };
  cachedBeta = params;

  db.systemConfig.upsert({
    where: { key: SYSTEM_KEY_BETA },
    create: { key: SYSTEM_KEY_BETA, value: params as unknown as object },
    update: { value: params as unknown as object },
  }).catch(() => {});

  return params;
}

function applyBeta(rawScore: number): number | null {
  if (!cachedBeta) return null;
  const p = Math.max(1e-6, Math.min(1 - 1e-6, rawScore / 100));
  const logit = Math.log(p / (1 - p));
  const z = cachedBeta.c * logit + cachedBeta.d;
  // Beta CDF approximation via sigmoid in logit space
  const calibrated = 1 / (1 + Math.exp(-z));
  return Math.round(calibrated * 1000) / 1000;
}

export function fitIsotonic(
  rawScores: number[],  // 0-100
  actuals: number[],     // 0 or 1
): IsotonicTable | null {
  if (rawScores.length !== actuals.length || rawScores.length < 50) return null;
  const xNorm = rawScores.map(s => Math.max(0, Math.min(1, s / 100)));
  const { x, y } = poolAdjacentViolators(xNorm, actuals);
  const table: IsotonicTable = { x, y, fittedAt: Date.now(), fittedN: rawScores.length };
  cachedIsotonic = table;
  // Persist async — fire-and-forget, hata durumunda in-memory tablo yine geçerli.
  db.systemConfig
    .upsert({
      where: { key: SYSTEM_KEY_ISOTONIC },
      create: { key: SYSTEM_KEY_ISOTONIC, value: table as unknown as object },
      update: { value: table as unknown as object },
    })
    .catch((e) => logError('calibration', 'isotonic persist failed:', e));
  return table;
}

function loadIsotonic(): IsotonicTable | null {
  return cachedIsotonic;
}

export function applyIsotonic(rawScore: number): number | null {
  const table = loadIsotonic();
  if (!table || table.x.length === 0) return null;
  const x = Math.max(0, Math.min(1, rawScore / 100));
  let lo = 0, hi = table.x.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (table.x[mid] <= x) lo = mid;
    else hi = mid;
  }
  if (x <= table.x[0]) return table.y[0];
  if (x >= table.x[table.x.length - 1]) return table.y[table.y.length - 1];
  const x0 = table.x[lo], x1 = table.x[hi];
  const y0 = table.y[lo], y1 = table.y[hi];
  const t = (x - x0) / Math.max(1e-9, x1 - x0);
  return Math.max(0, Math.min(1, y0 + t * (y1 - y0)));
}

export function clearIsotonicCache(): void {
  cachedIsotonic = null;
}

	/** Optimize sigmoid params from PredictionLog table, persist to SystemConfig. */
let _calibrationRunning = false;

export async function autoCalibrateFromDB(): Promise<{
  x0: number;
  k: number;
  L: number;
  brierBefore: number;
  brierAfter: number;
} | null> {
  if (_calibrationRunning) return null;
  _calibrationRunning = true;
  try {
    const logs = await db.predictionLog.findMany({
	    where: { goalScored: { not: null } },
	    select: { rawScore: true, calibratedP: true, goalScored: true },
	    orderBy: { createdAt: "desc" },
	    take: 10000,
	  });
	
	  if (logs.length < 50) return null;
	
	  // Train/validation split: 80% train, 20% validation (zaman sıralı)
	  const midpoint = Math.floor(logs.length * 0.8);
	  const trainLogs = logs.slice(0, midpoint);
	  const valLogs = logs.slice(midpoint);
	
	  const currentBrier =
	    trainLogs.reduce(
	      (s, r) => s + Math.pow(r.calibratedP - (r.goalScored ? 1 : 0), 2),
	      0,
	    ) / trainLogs.length;
	
	  // Faz 2 — L grid search'a dahil edildi. Grid: x0∈[40..85] step 2,
	  // k∈[0.020..0.120] step 0.002, L∈[0.80..0.99] step 0.02.
	  // ── İki aşamalı grid search ──
	  // Aşama 1: kaba grid (step 10/10/5) en iyi bölgeyi bul
	  // Aşama 2: ince grid (step 2/2/1) en iyi bölgede
	  let bestX0 = CALIBRATION_PARAMS.x0;
	  let bestK = CALIBRATION_PARAMS.k;
	  let bestL = CALIBRATION_PARAMS.L;
	  let bestTrainBrier = currentBrier;
	  let bestValBrier = currentBrier;
	
	  for (const phase of ['coarse', 'fine'] as const) {
	    const x0Step = phase === 'coarse' ? 10 : 2;
	    const kStep = phase === 'coarse' ? 0.010 : 0.002;
	    const lStep = phase === 'coarse' ? 0.05 : 0.01;
	
    const x0Range = phase === 'coarse'
      ? { min: 20, max: 50 }
      : { min: Math.max(20, bestX0 - x0Step * 2), max: Math.min(50, bestX0 + x0Step * 2) };
	    const kRange = phase === 'coarse'
	      ? { min: 0.020, max: 0.120 }
	      : { min: Math.max(0.020, bestK - kStep * 10), max: Math.min(0.120, bestK + kStep * 10) };
	    const lRange = phase === 'coarse'
	      ? { min: 0.80, max: 0.99 }
	      : { min: Math.max(0.80, bestL - lStep * 3), max: Math.min(0.99, bestL + lStep * 3) };
	
	    for (let x0 = x0Range.min; x0 <= x0Range.max; x0 += x0Step) {
	      for (let k = kRange.min; k <= kRange.max + kStep / 2; k += kStep) {
	        for (let l = lRange.min; l <= lRange.max + lStep / 2; l += lStep) {
	          const L = Math.round(l * 100) / 100;
	          let sum = 0;
	          for (const r of trainLogs) {
	            const p = L / (1 + Math.exp(-k * (r.rawScore - x0)));
	            sum += Math.pow(p - (r.goalScored ? 1 : 0), 2);
	          }
	          const brier = sum / trainLogs.length;
	          if (brier < bestTrainBrier) {
	            bestTrainBrier = brier;
	            bestX0 = x0;
	            bestK = k;
	            bestL = L;
	          }
	        }
	      }
	    }
	  }
	
	  // Evaluate best params on validation set
	  let valSum = 0;
	  for (const r of valLogs) {
	    const p = bestL / (1 + Math.exp(-bestK * (r.rawScore - bestX0)));
	    valSum += Math.pow(p - (r.goalScored ? 1 : 0), 2);
	  }
	  bestValBrier = valSum / valLogs.length;
	
  // Only apply if meaningful improvement (>2% relative on validation)
  // AND x0 is in sane range (≤50 prevents zero-calibrated scores >50)
  if (bestValBrier < currentBrier * 0.98 && bestX0 <= 50) {
    CALIBRATION_PARAMS.x0 = bestX0;
    CALIBRATION_PARAMS.k = bestK;
    CALIBRATION_PARAMS.L = bestL;
    try {
      await persistParamsToDB('autoCalibrateFromDB');
    } catch (e) {
      logError('calibration', 'persist failed:', e);
    }
    logInfo(
      'calibration',
      `Optimized: x0=${bestX0}, k=${bestK.toFixed(4)}, L=${bestL.toFixed(2)}, TrainBrier ${currentBrier.toFixed(4)} → ValBrier ${bestValBrier.toFixed(4)}`,
    );
    return {
      x0: bestX0,
      k: bestK,
      L: bestL,
      brierBefore: currentBrier,
      brierAfter: bestValBrier,
    };
  }
	
  logInfo(
    'calibration',
    `No improvement needed (TrainBrier ${currentBrier.toFixed(4)}, ValBrier ${bestValBrier.toFixed(4)})`,
	  );
	  return null;
	} finally {
	  _calibrationRunning = false;
	}
	}

// ── Per-Model Calibration ────────────────────────────────────
// Her model ayrı kalibrasyon parametrelerine sahip olabilir.
// Bu sayede iyi kalibre olmuş modeller ezilmez, kötüler düzeltilir.
interface ModelCalibParams {
  beta?: BetaParams | null;
  isotonic?: IsotonicTable | null;
  sigmoid?: { L: number; k: number; x0: number; T: number };
}

const perModelCalibration: Map<string, ModelCalibParams> = new Map();
const SYSTEM_KEY_MODEL_PREFIX = 'calibration.model.';

/**
 * Bir model için kalibrasyon kaydet.
 */
export function setModelCalibration(modelName: string, params: ModelCalibParams): void {
  perModelCalibration.set(modelName, params);
}

/**
 * Bir model için kalibre edilmiş probability döndür.
 * Önce Beta, sonra Isotonic, sonra sigmoid dener.
 */
export function calibrateModelOutput(modelName: string, rawScore: number): number {
  const mc = perModelCalibration.get(modelName);
  if (!mc) return calibrateScore(rawScore); // global fallback

  // Beta
  if (mc.beta) {
    const p = Math.max(1e-6, Math.min(1 - 1e-6, rawScore / 100));
    const logit = Math.log(p / (1 - p));
    const z = mc.beta.c * logit + mc.beta.d;
    const cal = 1 / (1 + Math.exp(-z));
    return Math.round(cal * 1000) / 1000;
  }

  // Isotonic
  if (mc.isotonic) {
    const x = Math.max(0, Math.min(1, rawScore / 100));
    let lo = 0, hi = mc.isotonic.x.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (mc.isotonic.x[mid] <= x) lo = mid;
      else hi = mid;
    }
    const cal = mc.isotonic.y[lo] + (x - mc.isotonic.x[lo]) / (mc.isotonic.x[hi] - mc.isotonic.x[lo]) * (mc.isotonic.y[hi] - mc.isotonic.y[lo]);
    return Math.round(Math.max(0, Math.min(1, cal)) * 1000) / 1000;
  }

  // Sigmoid + temperature
  if (mc.sigmoid) {
    const { L, k, x0, T } = mc.sigmoid;
    const z = k * (rawScore - x0);
    const cal = L / (1 + Math.exp(-z / T));
    return Math.round(cal * 1000) / 1000;
  }

  return calibrateScore(rawScore);
}

// Single global calibrator uses the above for consistency
export function calibrateScore(rawScore: number): number {
  // Prefer Beta (best for [0,1] bounded), then isotonic, then sigmoid + temperature.
  const beta = applyBeta(rawScore);
  if (beta != null) return beta;
  const iso = applyIsotonic(rawScore);
  if (iso != null) return Math.round(iso * 1000) / 1000;
  const { L, k, x0, T } = CALIBRATION_PARAMS;
  // Temperature scaling: logit / T before sigmoid
  const z = k * (rawScore - x0);
  const p = L / (1 + Math.exp(-z / T));
  return Math.round(p * 1000) / 1000;
}

/**
 * Unified calibration entry point for any source (heuristic or ML).
 * Routes through isotonic when available, sigmoid otherwise.
 */
export function applyCalibration(rawScore01: number): number {
  return calibrateScore(Math.max(0, Math.min(100, rawScore01 * 100)));
}

/**
 * Expected Calibration Error (ECE) — 10-bin reliability metric.
 * Lower is better. Returns ECE in [0,1].
 */
export function computeECE(
  probs: number[],
  outcomes: number[],
  bins: number = 10,
): number {
  if (probs.length === 0 || probs.length !== outcomes.length) return 0;
  let ece = 0;
  for (let i = 0; i < bins; i++) {
    const lo = i / bins, hi = (i + 1) / bins;
    const inBin = probs
      .map((p, idx) => ({ p, y: outcomes[idx] }))
      .filter(({ p }) => p >= lo && p < (i === bins - 1 ? hi + 1e-9 : hi));
    if (inBin.length === 0) continue;
    const conf = inBin.reduce((s, { p }) => s + p, 0) / inBin.length;
    const acc = inBin.reduce((s, { y }) => s + y, 0) / inBin.length;
    ece += (inBin.length / probs.length) * Math.abs(conf - acc);
  }
  return ece;
}

// ── İstatistik (PredictionLog tabanlı) ───────────────────────────
// Eski: records.json (silindi). Artık PredictionLog tek kaynak.

interface StatRecord {
  score: number;        // rawScore (0-100)
  calibratedP: number;
  goalScored: boolean;
}

async function loadCalibrationRecords(days?: number): Promise<StatRecord[]> {
  const where: { goalScored: { not: null } } = { goalScored: { not: null } };
  const logs = await db.predictionLog.findMany({
    where,
    select: { rawScore: true, calibratedP: true, goalScored: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: days ? days * 500 : 50000, // yeterli alt küme
  });
  return logs
    .filter((r) => r.goalScored != null)
    .map((r) => ({
      score: r.rawScore,
      calibratedP: r.calibratedP,
      goalScored: r.goalScored!,
    }));
}

function calculateBrierScore(records: StatRecord[]): number {
  if (records.length === 0) return 1.0;
  let sum = 0;
  for (const r of records) {
    const outcome = r.goalScored ? 1 : 0;
    sum += Math.pow(r.calibratedP - outcome, 2);
  }
  return sum / records.length;
}

function calculateLogLoss(records: StatRecord[]): number {
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

export async function calculateCalibrationStats(days?: number): Promise<CalibrationStats> {
  const records = await loadCalibrationRecords(days);
  if (records.length === 0) {
    return {
      totalPredictions: 0, totalGoals: 0, brierScore: null, logLoss: null,
      accuracy: null, calibrationError: null, bins: [], lastUpdated: Date.now(),
    };
  }
  const totalGoals = records.filter((r) => r.goalScored).length;
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
    const binRecords = records.filter((r) => r.score >= lo && r.score < hi);
    if (binRecords.length === 0) continue;
    const goalCount = binRecords.filter((r) => r.goalScored).length;
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

export async function autoCalibrate(): Promise<{ x0: number; k: number; L: number; brierBefore: number; brierAfter: number } | null> {
  return autoCalibrateFromDB();
}
