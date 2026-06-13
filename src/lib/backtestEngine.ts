// ── Backtest Engine ────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as path from 'path';

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

// Re-export to keep type import side-effect (used in runBacktest signature)
export type { BrierDecomposition };

export type * from './backtestTypes';

// ── Data Loading ────────────────────────────────────────────────

const DATA_DIR = typeof window === 'undefined' && path
  ? path.join(process.cwd(), 'data', 'signal-logs')
  : '';
const BACKTEST_DIR = typeof window === 'undefined' && path
  ? path.join(process.cwd(), 'data', 'backtest-results')
  : '';

function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(BACKTEST_DIR)) mkdirSync(BACKTEST_DIR, { recursive: true });
}

function loadSignalsForRange(startDate?: string, endDate?: string): SignalRecord[] {
  ensureDirs();
  const allSignals: SignalRecord[] = [];

  try {
    const files = readdirSync(DATA_DIR);
    const signalFiles = files
      .filter(f => f.startsWith('signals-') && f.endsWith('.json'))
      .sort();

    for (const file of signalFiles) {
      const dateStr = file.replace('signals-', '').replace('.json', '');

      if (startDate && dateStr < startDate) continue;
      if (endDate && dateStr > endDate) continue;

      try {
        const data = readFileSync(join(DATA_DIR, file), 'utf-8');
        const signals = JSON.parse(data);
        allSignals.push(...signals);
      } catch {
        // Skip corrupted files
      }
    }
  } catch {
    // No data yet
  }

  return allSignals;
}

// ── Main Backtest Function ─────────────────────────────────────

export function runBacktest(config: BacktestConfig = {}): BacktestResult {
  const {
    minSignals = 10,
    thresholdRange = [55, 60, 65, 70, 75, 80],
    bucketCount = 10,
  } = config;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = minSignals;
  void _;

  const allSignals = loadSignalsForRange(config.startDate, config.endDate);
  const resolved = allSignals.filter(s => s.goalHappened !== null) as Array<SignalRecord & { goalHappened: boolean }>;

  const dates = allSignals.map(s => s.date).sort();
  const dateRange = {
    start: dates[0] || new Date().toISOString().slice(0, 10),
    end: dates[dates.length - 1] || new Date().toISOString().slice(0, 10),
  };

  const goals = resolved.filter(s => s.goalHappened);
  const noGoals = resolved.filter(s => !s.goalHappened);
  const correct = resolved.filter(s => s.correctPrediction === true);

  const brierScore = computeBrierScore(resolved);
  const brierDecomposition = computeBrierDecomposition(resolved, bucketCount);

  let logLossSum = 0;
  for (const s of resolved) {
    const p = Math.max(0.001, Math.min(0.999, s.calibratedP));
    const y = s.goalHappened ? 1 : 0;
    logLossSum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  const logLoss = resolved.length > 0
    ? Math.round((logLossSum / resolved.length) * 10000) / 10000
    : 0;

  const precision = resolved.length > 0
    ? Math.round((goals.length / resolved.length) * 1000) / 10
    : 0;

  const recall = precision;

  const f1Score = precision > 0 && recall > 0
    ? Math.round((2 * precision * recall / (precision + recall)) * 10) / 10
    : 0;

  const specificity = resolved.length > 0
    ? Math.round((noGoals.length / resolved.length) * 1000) / 10
    : 0;

  const accuracy = resolved.length > 0
    ? Math.round(((correct.length + noGoals.length) / resolved.length) * 1000) / 10
    : 0;

  const thresholdAnalysis: ThresholdAnalysis[] = thresholdRange.map(threshold => {
    const aboveThreshold = resolved.filter(s => s.signalScore >= threshold);
    const aboveGoals = aboveThreshold.filter(s => s.goalHappened);
    const aboveCorrect = aboveGoals.filter(s => s.correctPrediction);
    const aboveFP = aboveThreshold.filter(s => !s.goalHappened);
    const times = aboveGoals.filter(s => s.minutesAfterSignal != null).map(s => s.minutesAfterSignal!);

    const tPrecision = aboveThreshold.length > 0
      ? Math.round((aboveGoals.length / aboveThreshold.length) * 1000) / 10 : 0;
    const tRecall = goals.length > 0
      ? Math.round((aboveGoals.length / goals.length) * 1000) / 10 : 0;

    return {
      threshold,
      signalCount: aboveThreshold.length,
      goalCount: aboveGoals.length,
      precision: tPrecision,
      avgMinutesToGoal: times.length > 0
        ? Math.round(times.reduce((a, b) => a + b, 0) / times.length * 10) / 10 : 0,
      correctSideRate: aboveGoals.length > 0
        ? Math.round((aboveCorrect.length / aboveGoals.length) * 1000) / 10 : 0,
      falsePositiveRate: aboveThreshold.length > 0
        ? Math.round((aboveFP.length / aboveThreshold.length) * 1000) / 10 : 0,
      f1Score: tPrecision > 0 && tRecall > 0
        ? Math.round((2 * tPrecision * tRecall / (tPrecision + tRecall)) * 10) / 10 : 0,
    };
  });

  const calibrationCurve = computeCalibrationCurve(resolved, bucketCount);

  let eceSum = 0;
  let eceTotal = 0;
  for (const cp of calibrationCurve) {
    eceSum += Math.abs(cp.predictedP - cp.observedP) * cp.count;
    eceTotal += cp.count;
  }
  const calibrationError = eceTotal > 0
    ? Math.round((eceSum / eceTotal) * 10000) / 10000
    : 0;

  const avgPredicted = resolved.length > 0
    ? resolved.reduce((s, r) => s + r.calibratedP, 0) / resolved.length : 0;
  const avgObserved = resolved.length > 0 ? goals.length / resolved.length : 0;
  const overconfidence = Math.round((avgPredicted - avgObserved) * 1000) / 10;

  const timeDistribution = computeTimeDistribution(goals);
  const signalDecayByMinute = computeSignalDecay(resolved);

  const bucketRanges = [
    { range: '55-59%', minP: 55, maxP: 59 },
    { range: '60-64%', minP: 60, maxP: 64 },
    { range: '65-69%', minP: 65, maxP: 69 },
    { range: '70-74%', minP: 70, maxP: 74 },
    { range: '75-79%', minP: 75, maxP: 79 },
    { range: '80-84%', minP: 80, maxP: 84 },
    { range: '85-89%', minP: 85, maxP: 89 },
    { range: '90-100%', minP: 90, maxP: 100 },
  ];

  const buckets: BacktestBucket[] = bucketRanges.map(br => {
    const bSignals = resolved.filter(s => s.signalScore >= br.minP && s.signalScore <= br.maxP);
    const bGoals = bSignals.filter(s => s.goalHappened);
    const bCorrect = bGoals.filter(s => s.correctPrediction);
    const bTimes = bGoals.filter(s => s.minutesAfterSignal != null).map(s => s.minutesAfterSignal!);
    const bCalibAvg = bSignals.length > 0
      ? bSignals.reduce((s, r) => s + r.calibratedP, 0) / bSignals.length : 0;

    let brierContrib = 0;
    for (const s of bSignals) {
      brierContrib += (s.calibratedP - (s.goalHappened ? 1 : 0)) ** 2;
    }

    return {
      range: br.range,
      minP: br.minP,
      maxP: br.maxP,
      total: bSignals.length,
      goals: bGoals.length,
      goalRate: bSignals.length > 0
        ? Math.round((bGoals.length / bSignals.length) * 1000) / 10 : 0,
      correctSide: bCorrect.length,
      correctSideRate: bGoals.length > 0
        ? Math.round((bCorrect.length / bGoals.length) * 1000) / 10 : 0,
      avgMinutesToGoal: bTimes.length > 0
        ? Math.round(bTimes.reduce((a, b) => a + b, 0) / bTimes.length * 10) / 10 : 0,
      avgCalibratedP: Math.round(bCalibAvg * 1000) / 10,
      brierContribution: Math.round(brierContrib * 10000) / 10000,
    };
  });

  const homeSignals = goals.filter(s => s.signalSide === 'home');
  const awaySignals = goals.filter(s => s.signalSide === 'away');
  const homeCorrect = homeSignals.filter(s => s.correctPrediction);
  const awayCorrect = awaySignals.filter(s => s.correctPrediction);

  const sideAccuracy: SideAccuracyAnalysis = {
    overall: goals.length > 0
      ? Math.round((correct.length / goals.length) * 1000) / 10 : 0,
    homeOnly: homeSignals.length > 0
      ? Math.round((homeCorrect.length / homeSignals.length) * 1000) / 10 : 0,
    awayOnly: awaySignals.length > 0
      ? Math.round((awayCorrect.length / awaySignals.length) * 1000) / 10 : 0,
    byScoreDifference: computeScoreDifferenceAccuracy(resolved),
  };

  const falsePositivePatterns = computeFalsePositivePatterns(noGoals);

  const levelAnalysis: Record<string, LevelStats> = {};
  for (const level of ['low', 'medium', 'high', 'critical']) {
    const lSignals = resolved.filter(s => s.signalLevel === level);
    const lGoals = lSignals.filter(s => s.goalHappened);
    const lCorrect = lGoals.filter(s => s.correctPrediction);
    const lTimes = lGoals.filter(s => s.minutesAfterSignal != null).map(s => s.minutesAfterSignal!);

    levelAnalysis[level] = {
      total: lSignals.length,
      goals: lGoals.length,
      goalRate: lSignals.length > 0
        ? Math.round((lGoals.length / lSignals.length) * 1000) / 10 : 0,
      correctSideRate: lGoals.length > 0
        ? Math.round((lCorrect.length / lGoals.length) * 1000) / 10 : 0,
      avgMinutesToGoal: lTimes.length > 0
        ? Math.round(lTimes.reduce((a, b) => a + b, 0) / lTimes.length * 10) / 10 : 0,
    };
  }

  const factorImportance = computeFactorImportance(resolved);

  const dailyMap = new Map<string, SignalRecord[]>();
  for (const s of resolved) {
    if (!dailyMap.has(s.date)) dailyMap.set(s.date, []);
    dailyMap.get(s.date)!.push(s);
  }
  const dailyPerformance: DailyPerformance[] = [];
  for (const [date, daySignals] of dailyMap) {
    const dGoals = daySignals.filter(s => s.goalHappened);
    const dCorrect = dGoals.filter(s => s.correctPrediction);
    const dTimes = dGoals.filter(s => s.minutesAfterSignal != null).map(s => s.minutesAfterSignal!);
    let dBrier = 0;
    for (const s of daySignals) {
      dBrier += (s.calibratedP - (s.goalHappened ? 1 : 0)) ** 2;
    }

    dailyPerformance.push({
      date,
      totalSignals: daySignals.length,
      goals: dGoals.length,
      goalRate: daySignals.length > 0
        ? Math.round((dGoals.length / daySignals.length) * 1000) / 10 : 0,
      correctSideRate: dGoals.length > 0
        ? Math.round((dCorrect.length / dGoals.length) * 1000) / 10 : 0,
      avgMinutesToGoal: dTimes.length > 0
        ? Math.round(dTimes.reduce((a, b) => a + b, 0) / dTimes.length * 10) / 10 : 0,
      brierScore: daySignals.length > 0
        ? Math.round((dBrier / daySignals.length) * 10000) / 10000 : 0,
    });
  }
  dailyPerformance.sort((a, b) => b.date.localeCompare(a.date));

  const escalated = resolved.filter(s => s.isEscalation);
  const nonEscalated = resolved.filter(s => !s.isEscalation);
  const escGoals = escalated.filter(s => s.goalHappened);
  const nonEscGoals = nonEscalated.filter(s => s.goalHappened);
  const escGoalRate = escalated.length > 0
    ? Math.round((escGoals.length / escalated.length) * 1000) / 10 : 0;
  const nonEscGoalRate = nonEscalated.length > 0
    ? Math.round((nonEscGoals.length / nonEscalated.length) * 1000) / 10 : 0;

  const escalationPerformance: EscalationAnalysis = {
    totalEscalations: escalated.length,
    goalRateEscalated: escGoalRate,
    goalRateNonEscalated: nonEscGoalRate,
    escalationLift: nonEscGoalRate > 0
      ? Math.round((escGoalRate / nonEscGoalRate) * 100) / 100 : 0,
    avgScoreIncrease: escalated.length > 0
      ? Math.round(
        escalated.reduce((s, r) => s + (r.signalScore - (r.previousSignalScore ?? r.signalScore)), 0) / escalated.length * 10
      ) / 10 : 0,
  };

  const allTimesToGoal = goals
    .filter(s => s.minutesAfterSignal != null && s.minutesAfterSignal > 0)
    .map(s => s.minutesAfterSignal!);
  const earlyWarningValue = allTimesToGoal.length > 0
    ? Math.round(allTimesToGoal.reduce((a, b) => a + b, 0) / allTimesToGoal.length * 10) / 10
    : 0;

  const result: BacktestResult = {
    config,
    generatedAt: new Date().toISOString(),
    signalCount: resolved.length,
    dateRange,
    brierScore,
    brierDecomposition,
    logLoss,
    accuracy,
    precision,
    recall,
    f1Score,
    specificity,
    thresholdAnalysis,
    calibrationCurve,
    calibrationError,
    overconfidence,
    timeDistribution,
    earlyWarningValue,
    signalDecayByMinute,
    buckets,
    sideAccuracy,
    falsePositivePatterns,
    levelAnalysis,
    factorImportance,
    dailyPerformance,
    escalationPerformance,
  };

  try {
    ensureDirs();
    const resultDate = new Date().toISOString().slice(0, 10);
    const resultTime = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    const resultFile = join(BACKTEST_DIR, `backtest-${resultDate}-${resultTime}.json`);
    writeFileSync(resultFile, JSON.stringify(result, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Backtest] Failed to save result:', err);
  }

  return result;
}

export function getQuickSummary(): QuickBacktestSummary {
  const result = runBacktest({});
  const bestThreshold = result.thresholdAnalysis.reduce(
    (best, t) => t.f1Score > best.f1Score ? t : best,
    result.thresholdAnalysis[0],
  );
  return {
    totalSignals: result.signalCount,
    resolvedSignals: result.signalCount,
    goalRate: result.precision,
    brierScore: result.brierScore,
    calibrationError: result.calibrationError,
    earlyWarningValue: result.earlyWarningValue,
    bestThreshold: bestThreshold?.threshold ?? 60,
    bestThresholdPrecision: bestThreshold?.precision ?? 0,
    topFactors: result.factorImportance.slice(0, 5).map(f => f.factor),
  };
}

export function listBacktestResults(): string[] {
  ensureDirs();
  try {
    return readdirSync(BACKTEST_DIR)
      .filter(f => f.startsWith('backtest-') && f.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
