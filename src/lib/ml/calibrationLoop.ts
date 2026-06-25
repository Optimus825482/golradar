// ── Dynamic Calibration Loop ──────────────────────────────────────
// Polls the monitoring endpoint for ensemble Brier trends and flags
// when the ensemble is degrading past a configurable threshold. This
// is a READ-ONLY advisory hook — it does not mutate model weights
// or call computeEnsembleWeights. Promotion of a new weight set
// requires manual review of the model weight router tier table.
//
// Usage:
//   import { evaluateCalibrationDrift } from './ml/calibrationLoop';
//   const report = await evaluateCalibrationDrift({ brierSeries, threshold });
//   // report.elevated === true means Brier > threshold for `windowDays`
//
// Threshold semantics:
//   - elevated = (recent avg Brier) > (prior avg Brier * (1 + threshold_pct))
//   - driftPct: signed delta as percentage (positive = worse)
//   - no DB writes; safe to call from request handlers or cron
//
// Persistence: `persistDriftReport` writes each report to SystemConfig
// under `calibration.drift.<date>` so admin/monitoring surfaces can
// recall the last N days without recomputing.

import { db } from '@/lib/db';
import { logInfo, logWarn, logError } from '@/lib/devLog';

const SYSTEM_KEY_DRIFT_PREFIX = 'calibration.drift';

export interface BrierPoint {
  date: string; // YYYY-MM-DD
  brierScore: number;
}

export interface CalibrationDriftInput {
  series: BrierPoint[];
  thresholdPct?: number; // e.g. 0.10 = "10% worse than prior 7d"
  windowDays?: number; // e.g. 7
}

export interface CalibrationDriftReport {
  elevated: boolean;
  recentAvg: number | null;
  priorAvg: number | null;
  driftPct: number | null;
  direction: 'better' | 'worse' | 'stable' | null;
  windowDays: number;
  recentPoints: number;
}

export function evaluateCalibrationDrift(
  input: CalibrationDriftInput,
): CalibrationDriftReport {
  const thresholdPct = input.thresholdPct ?? 0.10;
  const windowDays = input.windowDays ?? 7;
  const series = input.series;

  // Sort ascending by date so the tail of the array is the most
  // recent window. Defensive — caller may pass unordered points.
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-windowDays);
  const prior = sorted.slice(-windowDays * 2, -windowDays);

  const avg = (pts: BrierPoint[]): number | null => {
    if (pts.length === 0) return null;
    return pts.reduce((a, b) => a + b.brierScore, 0) / pts.length;
  };

  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  const driftPct =
    recentAvg !== null && priorAvg !== null && priorAvg !== 0
      ? ((recentAvg - priorAvg) / priorAvg) * 100
      : null;

  const elevated =
    driftPct !== null && driftPct > thresholdPct * 100;

  const direction: CalibrationDriftReport['direction'] =
    driftPct == null
      ? null
      : driftPct > 5
        ? 'worse'
        : driftPct < -5
          ? 'better'
          : 'stable';

  return {
    elevated,
    recentAvg,
    priorAvg,
    driftPct,
    direction,
    windowDays,
    recentPoints: recent.length,
  };
}

/**
 * Persist a drift report to SystemConfig so monitoring surfaces and
 * the admin/calibration page can recall the last N days of drift
 * reports without re-aggregating. One row per date — re-runs of the
 * same day overwrite the previous snapshot.
 */
export async function persistDriftReport(
  date: string,
  report: CalibrationDriftReport,
  updatedBy: string = 'calibrationLoop',
): Promise<void> {
  const key = `${SYSTEM_KEY_DRIFT_PREFIX}.${date}`;
  try {
    await db.systemConfig.upsert({
      where: { key },
      create: { key, value: report as unknown as object, updatedBy },
      update: { value: report as unknown as object, updatedBy },
    });
    if (report.elevated) {
      logWarn('calibrationLoop',
        `Drift elevated on ${date}: ${report.driftPct?.toFixed(2)}% worse (prior=${report.priorAvg?.toFixed(4)}, recent=${report.recentAvg?.toFixed(4)})`);
    } else {
      logInfo('calibrationLoop',
        `Drift stable on ${date}: ${report.driftPct?.toFixed(2) ?? 'n/a'}% (recent=${report.recentAvg?.toFixed(4) ?? 'n/a'})`);
    }
  } catch (e) {
    logError('calibrationLoop', `persistDriftReport(${date}) failed:`, e);
  }
}

/** Fetch the most recent N drift reports, newest first. */
export async function listDriftReports(limit = 14): Promise<Array<{ date: string; report: CalibrationDriftReport }>> {
  const rows = await db.systemConfig.findMany({
    where: { key: { startsWith: `${SYSTEM_KEY_DRIFT_PREFIX}.` } },
    orderBy: { key: 'desc' },
    take: limit,
  });
  const out: Array<{ date: string; report: CalibrationDriftReport }> = [];
  for (const row of rows) {
    const date = row.key.slice(SYSTEM_KEY_DRIFT_PREFIX.length + 1);
    out.push({ date, report: row.value as unknown as CalibrationDriftReport });
  }
  return out;
}
