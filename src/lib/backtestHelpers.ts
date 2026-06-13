// ── Backtest Statistical Helpers ───────────────────────────────────
// Pure computation functions extracted from backtestEngine.ts

import type {
  SignalRecord, BrierDecomposition, CalibrationPoint,
  TimeDistribution, SignalDecayPoint, FalsePositivePattern,
  FactorImportance, SideAccuracyAnalysis,
} from './backtestTypes';

export function computeBrierScore(signals: Array<{ calibratedP: number; goalHappened: boolean }>): number {
  if (signals.length === 0) return 0;
  let sum = 0;
  for (const s of signals) sum += (s.calibratedP - (s.goalHappened ? 1 : 0)) ** 2;
  return Math.round((sum / signals.length) * 10000) / 10000;
}

export function computeBrierDecomposition(
  signals: Array<{ calibratedP: number; goalHappened: boolean }>,
  bucketCount: number,
): BrierDecomposition {
  if (signals.length === 0) return { reliability: 0, resolution: 0, uncertainty: 0, brierScore: 0 };
  const buckets = new Map<number, { predicted: number[]; actual: number[] }>();
  for (const s of signals) {
    const bucketIdx = Math.min(bucketCount - 1, Math.floor(s.calibratedP * bucketCount));
    if (!buckets.has(bucketIdx)) buckets.set(bucketIdx, { predicted: [], actual: [] });
    const bucket = buckets.get(bucketIdx)!;
    bucket.predicted.push(s.calibratedP);
    bucket.actual.push(s.goalHappened ? 1 : 0);
  }
  const n = signals.length;
  const overallRate = signals.filter(s => s.goalHappened).length / n;
  let reliability = 0, resolution = 0;
  for (const [, bucket] of buckets) {
    const nk = bucket.predicted.length;
    const avgPredicted = bucket.predicted.reduce((a, b) => a + b, 0) / nk;
    const avgActual = bucket.actual.reduce((a, b) => a + b, 0) / nk;
    reliability += (nk / n) * (avgPredicted - avgActual) ** 2;
    resolution += (nk / n) * (avgActual - overallRate) ** 2;
  }
  const uncertainty = overallRate * (1 - overallRate);
  return {
    reliability: Math.round(reliability * 10000) / 10000,
    resolution: Math.round(resolution * 10000) / 10000,
    uncertainty: Math.round(uncertainty * 10000) / 10000,
    brierScore: Math.round((reliability - resolution + uncertainty) * 10000) / 10000,
  };
}

export function computeCalibrationCurve(
  signals: Array<{ calibratedP: number; goalHappened: boolean }>,
  bucketCount: number,
): CalibrationPoint[] {
  if (signals.length === 0) return [];
  const buckets: CalibrationPoint[] = [];
  const step = 1 / bucketCount;
  for (let i = 0; i < bucketCount; i++) {
    const minP = i * step, maxP = (i + 1) * step;
    const bucketSignals = signals.filter(s => s.calibratedP >= minP && s.calibratedP < maxP);
    if (bucketSignals.length === 0) continue;
    const avgPredicted = bucketSignals.reduce((s, r) => s + r.calibratedP, 0) / bucketSignals.length;
    const goalCount = bucketSignals.filter(s => s.goalHappened).length;
    const observedP = goalCount / bucketSignals.length;
    const z = 1.96, n = bucketSignals.length, p = observedP;
    const denominator = 1 + z * z / n;
    const center = (p + z * z / (2 * n)) / denominator;
    const interval = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denominator;
    buckets.push({
      predictedP: Math.round(avgPredicted * 1000) / 1000,
      observedP: Math.round(observedP * 1000) / 1000,
      count: bucketSignals.length,
      confidence: Math.round(interval * 1000) / 1000,
    });
  }
  return buckets;
}

export function computeTimeDistribution(goals: Array<{ minutesAfterSignal?: number | null }>): TimeDistribution {
  const times = goals.filter(s => s.minutesAfterSignal != null && s.minutesAfterSignal >= 0).map(s => s.minutesAfterSignal!);
  if (times.length === 0) return { histogram: [], percentiles: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 } };
  const ranges = [
    { range: '0-2dk', min: 0, max: 2 }, { range: '3-5dk', min: 3, max: 5 },
    { range: '6-10dk', min: 6, max: 10 }, { range: '11-15dk', min: 11, max: 15 },
    { range: '16-20dk', min: 16, max: 20 }, { range: '21-30dk', min: 21, max: 30 },
    { range: '31+dk', min: 31, max: 999 },
  ];
  const histogram = ranges.map(r => {
    const inRange = times.filter(t => t >= r.min && t <= r.max);
    return { range: r.range, count: inRange.length, goalCount: inRange.length, goalRate: times.length > 0 ? Math.round((inRange.length / times.length) * 1000) / 10 : 0 };
  });
  const sorted = [...times].sort((a, b) => a - b);
  const percentile = (p: number) => { const idx = Math.floor(sorted.length * p / 100); return Math.round((sorted[Math.min(idx, sorted.length - 1)] ?? 0) * 10) / 10; };
  return { histogram, percentiles: { p10: percentile(10), p25: percentile(25), p50: percentile(50), p75: percentile(75), p90: percentile(90) } };
}

export function computeSignalDecay(resolved: Array<{ signalMinute: number; goalHappened: boolean; calibratedP: number }>): SignalDecayPoint[] {
  const minuteRanges = [
    { label: '1-15', min: 1, max: 15 }, { label: '16-30', min: 16, max: 30 },
    { label: '31-45', min: 31, max: 45 }, { label: '46-60', min: 46, max: 60 },
    { label: '61-75', min: 61, max: 75 }, { label: '76-90+', min: 76, max: 120 },
  ];
  return minuteRanges.map(mr => {
    const rangeSignals = resolved.filter(s => s.signalMinute >= mr.min && s.signalMinute <= mr.max);
    const goals = rangeSignals.filter(s => s.goalHappened);
    return {
      minuteRange: mr.label,
      signalCount: rangeSignals.length,
      goalRate: rangeSignals.length > 0 ? Math.round((goals.length / rangeSignals.length) * 1000) / 10 : 0,
      avgCalibratedP: rangeSignals.length > 0 ? Math.round(rangeSignals.reduce((s, r) => s + r.calibratedP, 0) / rangeSignals.length * 1000) / 10 : 0,
    };
  });
}

export function computeScoreDifferenceAccuracy(
  resolved: Array<{ homeScore: number; awayScore: number; goalHappened: boolean; correctPrediction: boolean | null }>,
): { range: string; accuracy: number; count: number }[] {
  return [
    { range: 'Aynı (0-5)', min: 0, max: 5 }, { range: 'Hafif (6-15)', min: 6, max: 15 },
    { range: 'Orta (16-25)', min: 16, max: 25 }, { range: 'Baskın (26+)', min: 26, max: 999 },
  ].map(d => {
    const inRange = resolved.filter(s => { const diff = Math.abs(s.homeScore - s.awayScore); return diff >= d.min && diff <= d.max && s.goalHappened; });
    const correctInRange = inRange.filter(s => s.correctPrediction);
    return { range: d.range, accuracy: inRange.length > 0 ? Math.round((correctInRange.length / inRange.length) * 1000) / 10 : 0, count: inRange.length };
  });
}

export function computeFalsePositivePatterns(noGoals: Array<{ signalLevel: string; signalMinute: number; signalScore: number; signalSide: string }>): FalsePositivePattern[] {
  const patterns: Map<string, { count: number; scores: number[]; minutes: number[] }> = new Map();
  for (const s of noGoals) {
    const minuteZone = s.signalMinute <= 45 ? '1Y' : '2Y';
    const levelStr = s.signalLevel || 'unknown';
    const key1 = `${levelStr} ${minuteZone}`;
    if (!patterns.has(key1)) patterns.set(key1, { count: 0, scores: [], minutes: [] });
    patterns.get(key1)!.count++; patterns.get(key1)!.scores.push(s.signalScore); patterns.get(key1)!.minutes.push(s.signalMinute);
    const scoreRange = s.signalScore >= 90 ? '90%+' : s.signalScore >= 80 ? '80-89%' : s.signalScore >= 70 ? '70-79%' : '55-69%';
    const key2 = `Yüksek FP ${scoreRange} ${minuteZone}`;
    if (!patterns.has(key2)) patterns.set(key2, { count: 0, scores: [], minutes: [] });
    patterns.get(key2)!.count++; patterns.get(key2)!.scores.push(s.signalScore); patterns.get(key2)!.minutes.push(s.signalMinute);
  }
  const totalFP = noGoals.length || 1;
  return Array.from(patterns.entries())
    .filter(([, data]) => data.count >= 2)
    .map(([pattern, data]) => ({
      pattern, count: data.count, percentage: Math.round((data.count / totalFP) * 1000) / 10,
      avgSignalScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length * 10) / 10,
      avgMinute: Math.round(data.minutes.reduce((a, b) => a + b, 0) / data.minutes.length * 10) / 10,
    }))
    .sort((a, b) => b.count - a.count).slice(0, 10);
}

export function computeFactorImportance(
  resolved: Array<{ activeFactors: string[]; goalHappened: boolean }>,
): FactorImportance[] {
  const factorMap = new Map<string, { withGoal: number; withoutGoal: number; withTotal: number; withoutTotal: number }>();
  for (const s of resolved) {
    for (const f of new Set(s.activeFactors || [])) {
      if (!factorMap.has(f)) factorMap.set(f, { withGoal: 0, withoutGoal: 0, withTotal: 0, withoutTotal: 0 });
      const entry = factorMap.get(f)!; entry.withTotal++; if (s.goalHappened) entry.withGoal++;
    }
  }
  const total = resolved.length;
  const totalGoals = resolved.filter(s => s.goalHappened).length;
  return Array.from(factorMap.entries())
    .filter(([, data]) => data.withTotal >= 3)
    .map(([factor, data]) => {
      const goalRateWhenPresent = data.withTotal > 0 ? data.withGoal / data.withTotal : 0;
      const goalRateWhenAbsent = (total - data.withTotal) > 0 ? (totalGoals - data.withGoal) / (total - data.withTotal) : 0;
      return { factor, occurrenceRate: Math.round((data.withTotal / total) * 1000) / 10, goalRateWhenPresent: Math.round(goalRateWhenPresent * 1000) / 10, goalRateWhenAbsent: Math.round(goalRateWhenAbsent * 1000) / 10, lift: Math.round((goalRateWhenAbsent > 0 ? goalRateWhenPresent / goalRateWhenAbsent : 0) * 100) / 100 };
    })
    .sort((a, b) => b.lift - a.lift).slice(0, 15);
}
