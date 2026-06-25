// ── ML Training Scheduler ──────────────────────────────────────────
// Background task that exports training data on a daily cadence
// (03:00 local) and on-demand. Singleton pattern mirrors
// fotmobCacheMaintenance.ts to survive HMR / restart cycles.
//
// Currently exports 3 horizons (5/10/15 min). Each horizon produces
// a separate JSONL file. The Python sidecar trainer picks up new
// "ready" rows from `TrainingDataset` and trains new model versions.

import {
  exportTrainingData,
  recordExportFailure,
  type TrainingHorizon,
  type ExportResult,
} from "./exportTrainingData";
import {
  startTraining,
  pollJob,
  ML_TRAINER_ENABLED,
} from './mlClient';
import { registerArtifact } from './modelRouter';
import { logInfo, logWarn, logError } from '@/lib/devLog';

const EXPORT_HOUR_LOCAL = 3; // 03:00 local
const EXPORT_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 min — re-check time
const DEFAULT_DAYS_BACK = 90;
const MAX_ROWS_PER_EXPORT = 50_000;

interface SchedulerState {
  exportTimer: ReturnType<typeof setInterval> | null;
  lastExportDate: string; // YYYY-MM-DD, used as a once-per-day guard
  lastInPlayExportDate: string; // YYYY-MM-DD, used as a once-per-window guard
  lastShadowEvalDate: string; // YYYY-MM-DD, used as a once-per-day guard
  horizons: TrainingHorizon[];
  startedAt: number;
}

const globalForScheduler = globalThis as unknown as {
  mlTrainingScheduler: SchedulerState | undefined;
};

function getState(): SchedulerState {
  if (!globalForScheduler.mlTrainingScheduler) {
    globalForScheduler.mlTrainingScheduler = {
      exportTimer: null,
      lastExportDate: '',
      lastInPlayExportDate: '',
      lastShadowEvalDate: '',
      horizons: [5, 10, 15],
      startedAt: 0,
    };
  }
  return globalForScheduler.mlTrainingScheduler;
}

async function exportAllHorizons(): Promise<void> {
  const state = getState();
  for (const horizon of state.horizons) {
    try {
      const result = await exportTrainingData({
        days: DEFAULT_DAYS_BACK,
        horizon,
        maxRows: MAX_ROWS_PER_EXPORT,
      });
      if (result) {
        logInfo('MLScheduler',
          `Exported ${result.rowCount} rows (horizon=${horizon}min) → ${result.path}`);
      } else {
        logInfo('MLScheduler', `No data for horizon=${horizon}min — skipped`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('MLScheduler', `Export failed (horizon=${horizon}min): ${msg}`);
      try {
        await recordExportFailure(horizon, msg);
      } catch (innerErr) {
        const innerMsg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        logError('MLScheduler', `Failed to record failure: ${innerMsg}`);
      }
    }
  }
}

function checkAndRunDaily(): void {
  const state = getState();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (now.getHours() < EXPORT_HOUR_LOCAL) return; // before the window
  if (state.lastExportDate === today) return; // already ran today
  state.lastExportDate = today;
  void exportAllHorizons();
  // Same daily trigger: run shadow Brier rollup + drift persistence.
  // Both write to DB so the monitoring page has data on first load.
  if (state.lastShadowEvalDate !== today) {
    state.lastShadowEvalDate = today;
    void runDailyShadowEval(today);
  }
}

async function runDailyShadowEval(today: string): Promise<void> {
  try {
    const { evaluateDailyShadows } = await import('./shadowEvaluator');
    const { evaluateCalibrationDrift, persistDriftReport } = await import('./calibrationLoop');
    const { db } = await import('@/lib/db');

    // 1. Shadow Brier rollup → writes ModelMetrics
    const shadow = await evaluateDailyShadows(new Date(), { persist: true });

    // 2. Build series from last 14 days for drift calculation
    const since = new Date(Date.now() - 14 * 86_400_000);
    const series = await db.modelMetrics.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'asc' },
      select: { date: true, brierScore: true },
    });
    const brierSeries = series
      .filter((r) => r.brierScore != null)
      .map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        brierScore: r.brierScore as number,
      }));
    const driftReport = evaluateCalibrationDrift({ series: brierSeries, windowDays: 7 });
    await persistDriftReport(today, driftReport, 'trainingScheduler');

    logInfo('MLScheduler',
      `Daily shadow eval done — champion=${shadow.championBrier.toFixed(4)}, ` +
      `delta=${shadow.shadowBrierDelta.toFixed(4)}, suspended=${shadow.suspendedVariants.length}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('MLScheduler', `Daily shadow eval failed: ${msg}`);
  }
}

export function startTrainingScheduler(): SchedulerState {
  const state = getState();
  if (state.exportTimer) return state;

  state.startedAt = Date.now();
  const setUnref = (t: ReturnType<typeof setInterval>) => {
    if (typeof (t as { unref?: () => void }).unref === 'function') {
      (t as { unref: () => void }).unref();
    }
    return t;
  };

  state.exportTimer = setUnref(
    setInterval(checkAndRunDaily, EXPORT_CHECK_INTERVAL_MS),
  );

  // First-run check: if it's already past the daily window and
  // nothing ran today, run immediately so a fresh boot doesn't
  // wait 15 min for the first export.
  checkAndRunDaily();

  logInfo('MLScheduler',
    `Started — check every ${EXPORT_CHECK_INTERVAL_MS / 60000}m, ` +
      `horizons=${state.horizons.join(',')}min, daily at ${EXPORT_HOUR_LOCAL}:00 local`);
  return state;
}

export function stopTrainingScheduler(): void {
  const state = getState();
  if (state.exportTimer) clearInterval(state.exportTimer);
  state.exportTimer = null;
}

export function getTrainingSchedulerStatus(): {
  running: boolean;
  startedAt: number;
  uptimeMs: number;
  lastExportDate: string;
  lastInPlayExportDate: string;
  horizons: TrainingHorizon[];
} {
  const state = getState();
  return {
    running: !!state.exportTimer,
    startedAt: state.startedAt,
    uptimeMs: state.startedAt > 0 ? Date.now() - state.startedAt : 0,
    lastExportDate: state.lastExportDate,
    lastInPlayExportDate: state.lastInPlayExportDate,
    horizons: state.horizons,
  };
}

/**
 * Trigger an export for one or all horizons. Used by the admin
 * endpoint when the operator wants to bypass the daily schedule.
 */
export async function triggerExportNow(
  horizon?: TrainingHorizon,
): Promise<ExportResult | null> {
  const state = getState();
  const target = horizon ?? state.horizons[0];
  try {
    const result = await exportTrainingData({
      days: DEFAULT_DAYS_BACK,
      horizon: target,
      maxRows: MAX_ROWS_PER_EXPORT,
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordExportFailure(target, msg);
    return null;
  }
}

// ── In-play retrain scheduler (W6) ───────────────────────────────
// 6-hour cadence; fires when we're inside a match window
// (Fri-Sun 12:00-23:00 UTC+3). Each run: export horizon=5min
// from the last 7 days, then call the trainer sidecar to fit
// an "inplay" XGBoost artifact and register it as a non-champion
// shadow. Promotion is a separate operator step.
//
// Why last 7 days: the in-play signal is short-lived (form,
// injuries, referee tendencies) and a 90-day window would
// overweight stale signal.

const INPLAY_DAYS_BACK = 7;
const INPLAY_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const INPLAY_VERSION_PREFIX = 'ip';
const INPLAY_MATCH_WINDOWS_UTC3 = [
  // Hours-of-day in UTC+3 when matches typically run. Outside
  // these windows we skip the export to save trainer cycles.
  { dayOfWeek: 5, startHour: 12, endHour: 23 }, // Friday
  { dayOfWeek: 6, startHour: 12, endHour: 23 }, // Saturday
  { dayOfWeek: 0, startHour: 12, endHour: 22 }, // Sunday
  { dayOfWeek: 2, startHour: 18, endHour: 23 }, // Tuesday (CL)
  { dayOfWeek: 3, startHour: 18, endHour: 23 }, // Wednesday
];

function isInMatchWindow(now: Date): boolean {
  // Convert to UTC+3 (Istanbul)
  const utcMs = now.getTime();
  const istanbulMs = utcMs + (3 * 60 + now.getTimezoneOffset()) * 60_000;
  const istanbul = new Date(istanbulMs);
  const dow = istanbul.getDay();
  const hour = istanbul.getHours();
  return INPLAY_MATCH_WINDOWS_UTC3.some(
    (w) => w.dayOfWeek === dow && hour >= w.startHour && hour < w.endHour,
  );
}

async function runInPlayRetrain(): Promise<void> {
  const state = getState();
  if (!ML_TRAINER_ENABLED) {
    logInfo('MLScheduler', 'In-play skipped: trainer sidecar disabled (ML_TRAINER_URL not set)');
    return;
  }
  if (!isInMatchWindow(new Date())) {
    logInfo('MLScheduler', 'In-play skipped: outside match window');
    return;
  }
  // Once-per-calendar-day guard for in-play: avoid burning trainer
  // cycles on every 6h tick when we're inside an active window.
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastInPlayExportDate === today) {
    logInfo('MLScheduler', `In-play skipped: already exported today (${today})`);
    return;
  }
  state.lastInPlayExportDate = today;
  try {
    // 1. Export 5-min-horizon training data from the last 7 days
    const result = await exportTrainingData({
      days: INPLAY_DAYS_BACK,
      horizon: 5,
      maxRows: MAX_ROWS_PER_EXPORT,
    });
    if (!result) {
      logInfo('MLScheduler', 'In-play skipped: no data in last 7 days');
      return;
    }
    // 2. Fire training job
    const version = `${INPLAY_VERSION_PREFIX}-${Date.now()}`;
    const job = await startTraining({
      name: 'inplay',
      version,
      horizon_min: 5,
      dataset_path: result.path,
    });
    if (!job) {
      logWarn('MLScheduler', 'In-play trainer unreachable');
      return;
    }
    const completed = await pollJob(job.jobId, { timeoutMs: 180_000, pollMs: 3_000 });
    if (!completed || completed.status !== 'success' || !completed.artifactPath) {
      logWarn('MLScheduler', `In-play train failed: ${completed?.error ?? 'timeout'}`);
      return;
    }
    // 3. Register as a shadow artifact (champion=false). Operator
    // promotes manually via the admin endpoint.
    await registerArtifact({
      name: 'inplay',
      version,
      artifactPath: completed.artifactPath,
      metrics: completed.metrics,
      sha256: String(completed.metrics.sha256 ?? ''),
      bytes: completed.metrics.artifactBytes ?? null,
      notes: `In-play re-train (n=${completed.metrics.n ?? '?'}, horizon=5min, last 7 days)`,
    });
    logInfo('MLScheduler', `In-play artifact registered: ${version}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('MLScheduler', `In-play retrain error: ${msg}`);
    // Roll back so a retry can happen on the next tick instead of
    // waiting until tomorrow's first window.
    state.lastInPlayExportDate = '';
  }
}

let inPlayTimer: ReturnType<typeof setInterval> | null = null;

export function startInPlayScheduler(): { running: boolean; startedAt: number } {
  if (inPlayTimer) return { running: true, startedAt: Date.now() };
  const setUnref = (t: ReturnType<typeof setInterval>) => {
    if (typeof (t as { unref?: () => void }).unref === 'function') {
      (t as { unref: () => void }).unref();
    }
    return t;
  };
  inPlayTimer = setUnref(setInterval(runInPlayRetrain, INPLAY_INTERVAL_MS));
  // First-run check: if we boot in the middle of a match window,
  // kick off immediately. Otherwise wait the full 6h.
  if (isInMatchWindow(new Date())) {
    void runInPlayRetrain();
  }
  logInfo('MLScheduler',
    `In-play scheduler started — every ${INPLAY_INTERVAL_MS / 3_600_000}h, ` +
      `match windows only (Fri-Sun + Tue/Wed evenings UTC+3)`);
  return { running: true, startedAt: Date.now() };
}

export function stopInPlayScheduler(): void {
  if (inPlayTimer) clearInterval(inPlayTimer);
  inPlayTimer = null;
}

/** Manual trigger — admin endpoint or smoke test. */
export async function triggerInPlayRetrainNow(): Promise<{ ok: boolean; reason?: string }> {
  if (!ML_TRAINER_ENABLED) {
    return { ok: false, reason: 'trainer-sidecar-disabled' };
  }
  await runInPlayRetrain();
  return { ok: true };
}

// Auto-start on server boot (gated by runtime check to avoid
// double-start in dev HMR). Mirrors fotmobCacheMaintenance.
// Skip during build when DATABASE_URL is not available.
if (typeof window === 'undefined' && process.env.DATABASE_URL) {
  setImmediate(() => {
    try {
      startTrainingScheduler();
      startInPlayScheduler();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logWarn('MLScheduler', `Auto-start failed: ${msg}`);
    }
  });
}
