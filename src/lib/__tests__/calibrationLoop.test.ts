import { describe, expect, test } from 'bun:test';
import {
  evaluateCalibrationDrift,
  type BrierPoint,
} from '../ml/calibrationLoop';

const series = (...briers: number[]): BrierPoint[] =>
  briers.map((b, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    brierScore: b,
  }));

describe('calibrationLoop: evaluateCalibrationDrift', () => {
  test('returns null direction when prior window is empty', () => {
    const report = evaluateCalibrationDrift({
      series: series(0.20, 0.21, 0.22),
      windowDays: 3,
    });
    expect(report.priorAvg).toBeNull();
    expect(report.recentAvg).toBeCloseTo(0.21, 4);
    expect(report.driftPct).toBeNull();
    expect(report.direction).toBeNull();
    expect(report.elevated).toBe(false);
  });

  test('flags elevated when recent is >10% worse than prior', () => {
    const report = evaluateCalibrationDrift({
      series: series(0.20, 0.20, 0.20, 0.20, 0.20, 0.25, 0.26, 0.27),
      windowDays: 3,
    });
    expect(report.elevated).toBe(true);
    expect(report.direction).toBe('worse');
    expect(report.driftPct).toBeGreaterThan(10);
  });

  test('reports stable when drift is within ±5%', () => {
    const report = evaluateCalibrationDrift({
      series: series(0.20, 0.20, 0.21, 0.21, 0.20, 0.21),
      windowDays: 3,
    });
    expect(report.direction).toBe('stable');
    expect(report.elevated).toBe(false);
  });

  test('reports better when recent is significantly lower', () => {
    const report = evaluateCalibrationDrift({
      series: series(0.30, 0.30, 0.30, 0.30, 0.20, 0.21, 0.22),
      windowDays: 3,
    });
    expect(report.direction).toBe('better');
    expect(report.elevated).toBe(false);
  });

  test('respects custom thresholdPct (5% trigger)', () => {
    const report = evaluateCalibrationDrift({
      series: series(0.20, 0.20, 0.20, 0.21, 0.22, 0.23),
      thresholdPct: 0.05,
      windowDays: 3,
    });
    expect(report.elevated).toBe(true);
  });

  test('handles unsorted input by sorting on date', () => {
    const report = evaluateCalibrationDrift({
      series: [
        { date: '2026-06-04', brierScore: 0.30 },
        { date: '2026-06-01', brierScore: 0.20 },
        { date: '2026-06-03', brierScore: 0.25 },
        { date: '2026-06-02', brierScore: 0.22 },
      ],
      windowDays: 2,
    });
    expect(report.recentAvg).toBeCloseTo(0.275, 4);
    expect(report.priorAvg).toBeCloseTo(0.21, 4);
  });
});
