// ── Backtest Engine ────────────────────────────────────────────────

import { logError } from '@/lib/devLog';
import type {
  SignalRecord, QuickBacktestSummary,
  BacktestConfig, BacktestResult,
  ThresholdAnalysis, BacktestBucket, LevelStats,
  SideAccuracyAnalysis, EscalationAnalysis, DailyPerformance,
  BrierDecomposition,
} from './backtestTypes';

import {
  computeBrierScore, computeBrierDecomposition,
  computeCalibrationCurve, computeTimeDistribution,
  computeSignalDecay, computeScoreDifferenceAccuracy,
  computeFalsePositivePatterns, computeFactorImportance,
} from './backtestHelpers';

export type { BrierDecomposition };
export type * from './backtestTypes';

function getBeFs() {
  if (typeof window !== 'undefined') return null;
  try { return require('fs'); } catch { return null; }
}
function getBePath() {
  if (typeof window !== 'undefined') return null;
  try { return require('path'); } catch { return null; }
}

const sBe = getBePath();
const DATA_DIR = sBe ? sBe.join(process.cwd(), 'data', 'signal-logs') : '';
const BACKTEST_DIR = sBe ? sBe.join(process.cwd(), 'data', 'backtest-results') : '';

function ensureDirs() {
  const fs = getBeFs();
  if (!fs) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKTEST_DIR)) fs.mkdirSync(BACKTEST_DIR, { recursive: true });
}

// ── Flat file loader (legacy) ─────────────────────────────────────
function loadSignalsFromFlatFiles(startDate?: string, endDate?: string): SignalRecord[] {
  const fs = getBeFs();
  const path = getBePath();
  if (!fs || !path) return [];

  ensureDirs();
  const allSignals: SignalRecord[] = [];

  try {
    const files = fs.readdirSync(DATA_DIR);
    const signalFiles = files
      .filter((f: string) => f.startsWith('signals-') && f.endsWith('.json'))
      .sort();

    for (const file of signalFiles) {
      const dateStr = file.replace('signals-', '').replace('.json', '');
      if (startDate && dateStr < startDate) continue;
      if (endDate && dateStr > endDate) continue;

      try {
        const data = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
        const signals = JSON.parse(data);
        allSignals.push(...signals);
      } catch (e) { logError('backtestEngine', e); }
    }
  } catch (e) { logError('backtestEngine', e); }

  return allSignals;
}

// ── DB fallback loader (async, primary source) ────────────────────
// Flat file sinyal logs cogu zaman bos (sadece 1 gun veri var).
// Bu fonksiyon DB'deki Signal tablosundan backtest verisi ceker.
async function loadSignalsFromDB(startDate?: string, endDate?: string): Promise<SignalRecord[]> {
  try {
    const { db } = await import('@/lib/db');
    const where: Record<string, unknown> = { goalHappened: { not: null } };
    if (startDate) where.date = { gte: startDate };
    if (endDate) {
      where.date = { ...(where.date as Record<string, string> || {}), lte: endDate };
    }

    const rows = await db.signal.findMany({
      where,
      orderBy: { signalTimestamp: 'asc' },
      take: 50000,
    });

    return rows.map(r => ({
      matchCode: r.matchCode,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      league: r.league,
      matchTime: r.matchTime,
      date: r.date,
      signalMinute: r.signalMinute,
      signalSide: r.signalSide as 'home' | 'away',
      signalScore: r.signalScore,
      calibratedP: r.calibratedP,
      poissonP: r.poissonP,
      signalLevel: r.signalLevel,
      activeFactors: (r.activeFactors as string[]) || [],
      homeScore: r.homeScore,
      awayScore: r.awayScore,
      currentHomeGoals: r.currentHomeGoals,
      currentAwayGoals: r.currentAwayGoals,
      signalIndex: 0,
      isEscalation: r.escalated || false,
      previousSignalScore: null,
      signalTimestamp: r.signalTimestamp.getTime(),
      goalHappened: r.goalHappened,
      goalMinute: r.goalMinute,
      goalSide: r.goalSide as 'home' | 'away' | null,
      correctPrediction: r.correctPrediction,
      minutesAfterSignal: r.minutesAfterSignal,
      goalTimestamp: r.goalTimestamp?.getTime() ?? null,
      finalHomeScore: r.finalHomeScore,
      finalAwayScore: r.finalAwayScore,
    }));
  } catch (e) {
    logError('backtestEngine', 'DB load failed:', e);
    return [];
  }
}

function loadSignalsForRange(startDate?: string, endDate?: string): SignalRecord[] {
  // FIX: Once flat file'dan dene, bos gelirse DB'den async dene.
  // Synchronous API geregi sync dondur; DB async yol async overload'da.
  const flat = loadSignalsFromFlatFiles(startDate, endDate);
  return flat;
}

/** Async variant — DB fallback ile. Backtest API route'lari bunu cagirmali. */
export async function loadSignalsForRangeAsync(startDate?: string, endDate?: string): Promise<SignalRecord[]> {
  const flat = loadSignalsFromFlatFiles(startDate, endDate);
  if (flat.length > 0) return flat;
  // Flat file bos → DB'den dene
  const fromDB = await loadSignalsFromDB(startDate, endDate);
  if (fromDB.length > 0) {
    console.log(`[BacktestEngine] Flat files empty, loaded ${fromDB.length} signals from DB`);
  }
  return fromDB;
}

export function runBacktest(config: BacktestConfig = {}): BacktestResult { return runBacktestImpl(config) as unknown as BacktestResult; }

/** Async variant — DB fallback ile. Backtest API route'lari bunu kullanmali. */
export async function runBacktestAsync(config: BacktestConfig = {}): Promise<BacktestResult> {
  const signals: any[] = await loadSignalsForRangeAsync(config.startDate, config.endDate);
  return runBacktestImplCore(signals, config) as unknown as BacktestResult;
}

function runBacktestImpl(config: BacktestConfig = {}): any {
  const signals: any[] = loadSignalsForRange(config.startDate, config.endDate);
  return runBacktestImplCore(signals, config);
}

function runBacktestImplCore(signals: any[], config: BacktestConfig = {}): any {
  const { minSignals = 10, thresholdRange = [55, 60, 65, 70, 75, 80], bucketCount = 10 } = config;
  if (signals.length === 0) {
    return {
      totalSignals: 0,
      truePositives: 0, falsePositives: 0, trueNegatives: 0, falseNegatives: 0,
      precision: 0, recall: 0, f1Score: 0, accuracy: 0,
      avgScoreCorrect: 0, avgScoreIncorrect: 0,
      thresholds: [], buckets: [], calibrationCurve: [],
      timeDistribution: { histogram: [], percentiles: { p25: 0, p50: 0, p75: 0, p90: 0 } }, signalDecay: [], scoreDiffAccuracy: [],
      falsePositivePatterns: [], factorImportance: [],
      brierScore: 0, brierDecomposition: { refinement: 0, calibration: 0, uncertainty: 0 },
      sideAccuracy: { home: { correct: 0, total: 0, accuracy: 0 }, away: { correct: 0, total: 0, accuracy: 0 } },
      escalation: { early: { correct: 0, total: 0, accuracy: 0 }, late: { correct: 0, total: 0, accuracy: 0 } },
      dailyPerformance: [],
    };
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;
  let scoreSumCorrect = 0, scoreSumIncorrect = 0, scoreCorrectN = 0, scoreIncorrectN = 0;

  for (const s of signals) {
    const outcome = s.goalScored;
    const isPos = s.score >= 60;
    if (isPos && outcome) { tp++; scoreSumCorrect += s.score; scoreCorrectN++; }
    else if (isPos && !outcome) { fp++; scoreSumIncorrect += s.score; scoreIncorrectN++; }
    else if (!isPos && !outcome) tn++;
    else fn++;
  }

  const total = tp + fp + tn + fn;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1Score = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const accuracy = total > 0 ? (tp + tn) / total : 0;

  const thresholds: any = thresholdRange.map(threshold => {
    let ttp = 0, tfp = 0, ttn = 0, tfn = 0;
    for (const s of signals) {
      if (s.score >= threshold && s.goalScored) ttp++;
      else if (s.score >= threshold && !s.goalScored) tfp++;
      else if (s.score < threshold && !s.goalScored) ttn++;
      else tfn++;
    }
    const tprec = ttp + tfp > 0 ? ttp / (ttp + tfp) : 0;
    const trec = ttp + tfn > 0 ? ttp / (ttp + tfn) : 0;
    return {
      threshold, tp: ttp, fp: tfp, tn: ttn, fn: tfn,
      precision: Math.round(tprec * 1000) / 1000,
      recall: Math.round(trec * 1000) / 1000,
      f1: tprec + trec > 0 ? Math.round(2 * tprec * trec / (tprec + trec) * 1000) / 1000 : 0,
      accuracy: ttp + tfp + ttn + tfn > 0 ? Math.round((ttp + ttn) / (ttp + tfp + ttn + tfn) * 1000) / 1000 : 0,
    };
  });

  const buckets: any = [];
  const bucketSize = 100 / bucketCount;
  for (let i = 0; i < bucketCount; i++) {
    const lo = Math.round(i * bucketSize);
    const hi = Math.round((i + 1) * bucketSize);
    const bin = signals.filter(s => s.score >= lo && s.score < hi);
    buckets.push({
      scoreRange: [lo, hi] as [number, number],
      count: bin.length,
      goalCount: bin.filter(s => s.goalScored).length,
      observedRate: bin.length > 0 ? bin.filter(s => s.goalScored).length / bin.length : 0,
    });
  }

  return {
    totalSignals: signals.length,
    truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1Score: Math.round(f1Score * 1000) / 1000,
    accuracy: Math.round(accuracy * 1000) / 1000,
    avgScoreCorrect: scoreCorrectN > 0 ? Math.round(scoreSumCorrect / scoreCorrectN * 10) / 10 : 0,
    avgScoreIncorrect: scoreIncorrectN > 0 ? Math.round(scoreSumIncorrect / scoreIncorrectN * 10) / 10 : 0,
    thresholds,
    buckets,
    calibrationCurve: computeCalibrationCurve(signals, bucketCount),
    timeDistribution: computeTimeDistribution(signals),
    signalDecay: computeSignalDecay(signals),
    scoreDiffAccuracy: computeScoreDifferenceAccuracy(signals),
    falsePositivePatterns: computeFalsePositivePatterns(signals),
    factorImportance: computeFactorImportance(signals),
    brierScore: Math.round(computeBrierScore(signals) * 10000) / 10000,
    brierDecomposition: (computeBrierDecomposition as any)(signals as any),
    sideAccuracy: computeSideAccuracy(signals),
    escalation: computeEscalationAccuracy(signals),
    dailyPerformance: computeDailyPerformance(signals),
  };
}

function computeSideAccuracy(signals: any[]): { home: { correct: number; total: number; accuracy: number }; away: { correct: number; total: number; accuracy: number } } {
  let hc = 0, ht = 0, ac = 0, at = 0;
  for (const s of signals) {
    if (s.side === 'home') { ht++; if (s.goalScored) hc++; }
    else if (s.side === 'away') { at++; if (s.goalScored) ac++; }
  }
  return {
    home: { correct: hc, total: ht, accuracy: ht > 0 ? Math.round(hc / ht * 1000) / 1000 : 0 },
    away: { correct: ac, total: at, accuracy: at > 0 ? Math.round(ac / at * 1000) / 1000 : 0 },
  };
}

function computeEscalationAccuracy(signals: any[]): { early: { correct: number; total: number; accuracy: number }; late: { correct: number; total: number; accuracy: number } } {
  let ec = 0, et = 0, lc = 0, lt = 0;
  for (const s of signals) {
    if (s.score < 70) { et++; if (s.goalScored) ec++; }
    else { lt++; if (s.goalScored) lc++; }
  }
  return {
    early: { correct: ec, total: et, accuracy: et > 0 ? Math.round(ec / et * 1000) / 1000 : 0 },
    late: { correct: lc, total: lt, accuracy: lt > 0 ? Math.round(lc / lt * 1000) / 1000 : 0 },
  };
}

function computeDailyPerformance(signals: any[]): DailyPerformance[] {
  const byDate = new Map<string, any[]>();
  for (const s of signals) {
    const d = s.timestamp ? new Date(s.timestamp).toISOString().slice(0, 10) : 'unknown';
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(s);
  }
  const result: DailyPerformance[] = [];
  for (const [date, daySignals] of byDate) {
    let tp = 0, fp = 0;
    for (const s of daySignals) {
      if (s.score >= 60 && s.goalScored) tp++;
      else if (s.score >= 60 && !s.goalScored) fp++;
    }
    result.push({
      date, totalSignals: daySignals.length, correct: tp, incorrect: fp,
      accuracy: tp + fp > 0 ? Math.round(tp / (tp + fp) * 1000) / 1000 : 0,
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export function listBacktestResults(): string[] {
  const fs = getBeFs();
  const path = getBePath();
  if (!fs || !path) return [];
  try {
    return fs.readdirSync(BACKTEST_DIR)
      .filter((f: string) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 100);
  } catch { return []; }
}

export function getQuickSummary(): QuickBacktestSummary {
  const signals: any[] = loadSignalsForRange();
  const result = runBacktest();
  return {
    totalSignals: signals.length,
    lastUpdated: signals.length > 0 ? signals[signals.length - 1].timestamp : 0,
    accuracy: result.accuracy,
    precision: result.precision,
    recall: result.recall,
    f1Score: result.f1Score,
    brierScore: result.brierScore,
    totalTruePositives: (result as any).truePositives,
    totalFalsePositives: (result as any).falsePositives,
    totalMatches: 0,
    avgScoreCorrect: (result as any).avgScoreCorrect,
    avgScoreIncorrect: (result as any).avgScoreIncorrect,
  } as any;
}
