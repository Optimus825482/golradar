// ── ML Training Data Exporter ─────────────────────────────────────
// Builds labeled training rows from historical prediction logs.
//
// Each row = a single PredictionLog entry joined with whether a goal
// occurred in the next `horizonMin` minutes. The feature vector is
// the canonical 47-feature MatchFeatures array (already [0,1]-
// normalized), so the trainer can consume rows without re-extracting.
//
// Output: a JSONL file at `data/ml-training/<horizon>min-<date>.jsonl`
// plus a `TrainingDataset` row that records the file's SHA256 and
// status. The trainer sidecar reads the file path from the row.
//
// Label semantics:
//   1 = a goal happened in the same match within horizonMin after
//       this prediction's createdAt
//   0 = no goal in that window (including match-end and pending matches
//       which we conservatively label 0 to avoid optimistic training)
//
// All work is server-side; the export joins through Prisma and writes
// a flat file. Errors are recorded on the TrainingDataset row so the
// scheduler can skip + alert on failed exports.

import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { db } from '../db';
import { extractFeatures, featuresToArray, type MatchFeatures } from '../featureEngineering';
import type { FeatureExtractionInput } from '../featureEngineering';

// Use the Docker volume mount path (/app/data/ml-training) so the file is
// visible to the ml-trainer sidecar which mounts the same volume at /data.
// Falls back to cwd-relative path for local development.
export const TRAINING_DIR = process.env.NODE_ENV === 'production'
  ? '/app/data/ml-training'
  : join(process.cwd(), 'data', 'ml-training');

export type TrainingHorizon = 5 | 10 | 15;

export interface TrainingRow {
  matchCode: number;
  minute: number;
  features: number[];
  label: number;
  labelHorizonMin: TrainingHorizon;
  context: {
    league: string;
    homeElo: number;
    awayElo: number;
    homeTeam: string;
    awayTeam: string;
    createdAt: number; // unix ms
  };
}

export interface ExportOptions {
  days: number;
  horizon: TrainingHorizon;
  // Cap on row count to keep exports tractable. 0 = uncapped.
  maxRows?: number;
}

export interface ExportResult {
  datasetId: string;
  path: string;
  rowCount: number;
  sha256: string;
  bytes: number;
  dataStart: Date;
  dataEnd: Date;
}

/**
 * Build a FeatureExtractionInput shape from a PredictionLog row's
 * already-serialized featuresJson, falling back to a minimal stub
 * if featuresJson is missing. The trainer sees the same vector
 * shape regardless.
 */
function reconstructFeatureInput(log: any): FeatureExtractionInput | null {
  if (!log.featuresJson) return null;
  // Validate JSON shape. The trainer uses the same `featuresToArray`
  // order so callers can rely on the canonical 47-feature vector.
  try {
    JSON.parse(log.featuresJson) as MatchFeatures;
  } catch {
    return null;
  }
  return {
    stats: log.matchStats ?? {},
    minute: String(log.minute),
    isLive: true,
    homeGoals: log.homeGoals ?? 0,
    awayGoals: log.awayGoals ?? 0,
    homeTeam: log.homeTeam,
    awayTeam: log.awayTeam,
    // Pressure history not recoverable from a stored log — pass []
    // and let the static features (xG, shots, pressure gap) carry
    // the signal. The trainer should weight momentum features lower.
    pressureHistory: [],
  };
}

function hashRows(rows: TrainingRow[]): string {
  return createHash('sha256')
    .update(JSON.stringify(rows))
    .digest('hex');
}

/**
 * Compute the label for a prediction log row given the set of goal
 * events in the same match. A label of 1 means a goal happened
 * within horizonMin of the prediction's createdAt.
 */
function labelForLog(
  logCreatedAt: Date,
  horizonMin: TrainingHorizon,
  goalEvents: Array<{ minute: number; createdAt?: Date | null }>,
): number {
  const horizonMs = horizonMin * 60 * 1000;
  for (const ev of goalEvents) {
    // Use the event's createdAt when available (exact alignment),
    // otherwise fall back to match-time arithmetic via the minute column.
    const evTime = ev.createdAt ?? null;
    if (evTime) {
      if (evTime.getTime() <= logCreatedAt.getTime()) continue;
      if (evTime.getTime() - logCreatedAt.getTime() <= horizonMs) return 1;
    }
  }
  return 0;
}

/**
 * Main export entry point. Pulls PredictionLog rows from the last
 * `days` days, joins with MatchEvent for goal labels, and writes
 * a JSONL file. Returns the ExportResult with the dataset ID
 * (callers can also query TrainingDataset directly).
 */
export async function exportTrainingData(
  options: ExportOptions,
): Promise<ExportResult | null> {
  const { days, horizon, maxRows = 0 } = options;
  const cutoff = new Date(Date.now() - days * 86_400_000);

  // Fetch prediction logs in the time window. We cap to a reasonable
  // batch size up front; the trainer is fine with up to ~100k rows.
  const predictionLogs = await db.predictionLog.findMany({
    where: { createdAt: { gte: cutoff } },
    orderBy: [{ matchCode: "asc" }, { createdAt: "asc" }],
    take: maxRows > 0 ? maxRows : 100_000,
  });

  if (predictionLogs.length === 0) {
    return null; // No data — caller will create a "no data" record
  }

  // Collect match codes and fetch goal events for all of them in one query
  const matchCodes = Array.from(
    new Set(predictionLogs.map((l) => l.matchCode)),
  );
  const goalEvents = await db.matchEvent.findMany({
    where: {
      matchCode: { in: matchCodes },
      eventType: "goal",
    },
    select: { matchCode: true, minute: true, createdAt: true },
  });

  // Bucket events by matchCode for O(1) lookup
  const goalsByMatch = new Map<number, typeof goalEvents>();
  for (const ev of goalEvents) {
    if (!goalsByMatch.has(ev.matchCode)) goalsByMatch.set(ev.matchCode, []);
    goalsByMatch.get(ev.matchCode)!.push(ev);
  }

  // Build training rows — use PredictionLog.goalScored as primary label source.
  // MatchEvent lookup is a secondary fallback for logs that predate the goalScored column.
  const rows: TrainingRow[] = [];
  let skippedMissingFeatures = 0;
  let labeledFromDb = 0;
  let labeledFromEvents = 0;

  for (const log of predictionLogs) {
    if (!log.featuresJson) {
      skippedMissingFeatures++;
      continue;
    }

    // Use the persisted featuresJson directly when present (avoids
    // re-extraction drift). Fall back to on-the-fly extraction if
    // somehow the field is unparseable.
    let features: number[];
    try {
      const parsed = JSON.parse(log.featuresJson) as MatchFeatures;
      features = featuresToArray(parsed);
    } catch {
      const input = reconstructFeatureInput(log);
      if (!input) {
        skippedMissingFeatures++;
        continue;
      }
      const extracted = await extractFeatures(input);
      features = featuresToArray(extracted);
    }

    // Primary label: PredictionLog.goalScored (set during backfill / finalize)
    // Secondary: MatchEvent join for logs where goalScored is still null
    let label: number;
    if (log.goalScored !== null) {
      label = log.goalScored ? 1 : 0;
      labeledFromDb++;
    } else {
      const matchGoals = goalsByMatch.get(log.matchCode) ?? [];
      label = labelForLog(log.createdAt, horizon, matchGoals);
      labeledFromEvents++;
    }

    rows.push({
      matchCode: log.matchCode,
      minute: log.minute,
      features,
      label,
      labelHorizonMin: horizon,
      context: {
        league: log.league,
        homeElo: log.homeElo ?? 1500,
        awayElo: log.awayElo ?? 1500,
        homeTeam: log.homeTeam,
        awayTeam: log.awayTeam,
        createdAt: log.createdAt.getTime(),
      },
    });
  }

  if (rows.length === 0) {
    return null;
  }

  // Label distribution sanity check
  const positives = rows.filter((r) => r.label === 1).length;
  const negatives = rows.length - positives;
  console.log(
    `[Export] ${rows.length} rows, ${positives} positives (${((positives / rows.length) * 100).toFixed(1)}%), ` +
      `${negatives} negatives for horizon=${horizon}min` +
      (labeledFromDb > 0
        ? ` (${labeledFromDb} from DB goalScored, ${labeledFromEvents} from MatchEvent)`
        : ""),
  );

  if (positives === 0 || negatives === 0) {
    // Record failed export — trainer needs both classes
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `${horizon}min-${dateStr}.jsonl`;
    const filePath = join(TRAINING_DIR, fileName);
    const jsonl = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await writeFile(filePath, jsonl, "utf-8");
    const sha256 = hashRows(rows);
    await db.trainingDataset.create({
      data: {
        horizonMin: horizon,
        rowCount: rows.length,
        brier: null,
        logLoss: null,
        path: filePath,
        sha256,
        status: "failed",
        errorMsg: `Only one label class: ${positives} positives, ${negatives} negatives. Need goal events in the data.`,
        dataStart: predictionLogs[0].createdAt,
        dataEnd: predictionLogs[predictionLogs.length - 1].createdAt,
      },
    });
    return null;
  }

  // Write JSONL file
  await mkdir(TRAINING_DIR, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fileName = `${horizon}min-${dateStr}.jsonl`;
  const filePath = join(TRAINING_DIR, fileName);
  const jsonl = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(filePath, jsonl, "utf-8");

  const sha256 = hashRows(rows);

  // Quick sanity metrics on the export itself
  const baseRate = positives / rows.length;
  // Brier of "always predict base rate" — useful ceiling metric
  const brierBaseline =
    rows.reduce((acc, r) => acc + (r.label - baseRate) ** 2, 0) / rows.length;
  // Log loss of "always predict base rate" — useful ceiling metric
  const eps = 1e-9;
  const logLossBaseline =
    -rows.reduce(
      (acc, r) =>
        acc +
        r.label * Math.log(Math.max(baseRate, eps)) +
        (1 - r.label) * Math.log(Math.max(1 - baseRate, eps)),
      0,
    ) / rows.length;

  // Create the TrainingDataset row
  const dataset = await db.trainingDataset.create({
    data: {
      horizonMin: horizon,
      rowCount: rows.length,
      brier: brierBaseline,
      logLoss: logLossBaseline,
      path: filePath,
      sha256,
      status: "ready",
      dataStart: predictionLogs[0].createdAt,
      dataEnd: predictionLogs[predictionLogs.length - 1].createdAt,
    },
  });

  return {
    datasetId: dataset.id,
    path: filePath,
    rowCount: rows.length,
    sha256,
    bytes: jsonl.length,
    dataStart: predictionLogs[0].createdAt,
    dataEnd: predictionLogs[predictionLogs.length - 1].createdAt,
  };
}

/**
 * Mark a TrainingDataset as consumed (called by the trainer sidecar
 * after a successful train job). Helps the scheduler skip
 * already-trained datasets.
 */
export async function markDatasetConsumed(
  datasetId: string,
): Promise<void> {
  await db.trainingDataset.update({
    where: { id: datasetId },
    data: { status: 'consumed' },
  });
}

/**
 * Mark a dataset as failed (e.g. trainer couldn't read the file).
 * The scheduler will skip and retry on the next run.
 */
export async function markDatasetFailed(
  datasetId: string,
  errorMsg: string,
): Promise<void> {
  await db.trainingDataset.update({
    where: { id: datasetId },
    data: { status: 'failed', errorMsg },
  });
}

/**
 * Mark a dataset as failed and persist the path so the admin endpoint
 * can show it without re-fetching.
 */
export async function recordExportFailure(
  horizon: TrainingHorizon,
  errorMsg: string,
): Promise<string> {
  const dataset = await db.trainingDataset.create({
    data: {
      horizonMin: horizon,
      rowCount: 0,
      path: join(TRAINING_DIR, `${horizon}min-failed-${Date.now()}.jsonl`),
      sha256: '',
      status: 'failed',
      errorMsg,
    },
  });
  return dataset.id;
}
