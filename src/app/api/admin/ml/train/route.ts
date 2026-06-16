// ── Admin: ML Train Trigger ────────────────────────────────────────
// Kicks off a training job on the Python sidecar and polls until
// completion. After a successful run, registers the artifact
// with the ModelArtifact registry (champion flag NOT set —
// promotion is a separate manual/admin step).
//
// Body:
//   {
//     name: "xgb",
//     version: "1.0.0",
//     horizon_min: 5,
//     dataset_id: "<TrainingDataset id>",   // preferred
//     dataset_path: "data/ml-training/5min-...jsonl" // fallback
//   }
//
// Returns:
//   { ok: true, jobId, status, artifactPath, metrics, registered: bool }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { startTraining, pollJob, markArtifactReady, ML_TRAINER_ENABLED } from '@/lib/ml/mlClient';
import { registerArtifact } from '@/lib/ml/modelRouter';
import { adminRoute } from '@/lib/adminRoute';

export const dynamic = 'force-dynamic';

interface TrainRequestBody {
  name?: string;
  version?: string;
  horizon_min?: number;
  dataset_id?: string;
  dataset_path?: string;
}

export const POST = adminRoute(async (request: Request) => {
  if (typeof window !== 'undefined') {
    return NextResponse.json({ error: 'server-only' }, { status: 503 });
  }
  if (!ML_TRAINER_ENABLED) {
    return NextResponse.json(
      { error: 'trainer-sidecar-disabled', message: 'ML_TRAINER_URL not set' },
      { status: 503 },
    );
  }

  let body: TrainRequestBody = {};
  try {
    body = (await request.json()) as TrainRequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const { name } = body;

  if (!name || !["gbdt", "xgb", "inplay"].includes(name)) {
    return NextResponse.json(
      { error: "name must be one of gbdt|xgb|inplay" },
      { status: 400 },
    );
  }

  // ── Auto-version: find latest artifact and bump patch ───────
  let version = body.version ?? "";
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    const latest = await db.modelArtifact.findFirst({
      where: { name: name as string },
      orderBy: { createdAt: "desc" },
    });
    if (latest) {
      const parts = latest.version.split(".").map(Number);
      parts[2] = (parts[2] ?? 0) + 1;
      version = parts.join(".");
    } else {
      version = "1.0.0";
    }
  }

  // ── Smart defaults: horizon_min + dataset auto-discovery ─────
  const horizon_min =
    typeof body.horizon_min === "number" && body.horizon_min >= 1
      ? body.horizon_min
      : 5; // default to 5-min horizon

  let resolvedPath = body.dataset_path ?? null;
  let dataset_id = body.dataset_id ?? null;

  // Auto-resolve dataset: if no explicit dataset, find the latest
  // ready TrainingDataset for this horizon
  if (!resolvedPath && !dataset_id) {
    const latestDataset = await db.trainingDataset.findFirst({
      where: { horizonMin: horizon_min, status: "ready" },
      orderBy: { createdAt: "desc" },
    });
    if (latestDataset) {
      dataset_id = latestDataset.id;
      resolvedPath = latestDataset.path;
    }
  } else if (dataset_id) {
    const ds = await db.trainingDataset.findUnique({
      where: { id: dataset_id },
    });
    if (!ds) {
      return NextResponse.json(
        { error: `dataset_id ${dataset_id} not found` },
        { status: 404 },
      );
    }
    if (ds.horizonMin !== horizon_min) {
      return NextResponse.json(
        {
          error: "horizon_min mismatch",
          message: `dataset was built for ${ds.horizonMin}min, request asked for ${horizon_min}min`,
        },
        { status: 400 },
      );
    }
    resolvedPath = ds.path;
  }

  if (!resolvedPath) {
    return NextResponse.json(
      {
        error:
          "no training dataset available — export data first or provide dataset_id/dataset_path",
      },
      { status: 400 },
    );
  }

  // Start the job
  const job = await startTraining({
    name: name as 'gbdt' | 'xgb' | 'inplay',
    version,
    horizon_min,
    dataset_path: resolvedPath,
  });
  if (!job) {
    return NextResponse.json(
      { error: 'trainer-unreachable' },
      { status: 502 },
    );
  }

  // Poll until done (up to 5 min for a single XGBoost run)
  const completed = await pollJob(job.jobId, { timeoutMs: 300_000, pollMs: 3_000 });
  if (!completed) {
    return NextResponse.json(
      {
        ok: false,
        jobId: job.jobId,
        status: 'timeout',
        message: 'trainer did not complete within 5 min',
      },
      { status: 504 },
    );
  }
  if (completed.status === 'failed') {
    return NextResponse.json(
      {
        ok: false,
        jobId: job.jobId,
        status: 'failed',
        error: completed.error,
      },
      { status: 500 },
    );
  }

  // Register the artifact (champion=false; admin promotes separately)
  let registered = false;
  if (completed.artifactPath) {
    try {
      await registerArtifact({
        name: name as 'gbdt' | 'xgb' | 'inplay',
        version,
        artifactPath: completed.artifactPath,
        metrics: completed.metrics,
        sha256: String(completed.metrics.sha256 ?? ''),
        bytes: completed.metrics.artifactBytes ?? null,
        notes: `Trained on horizon=${horizon_min}min, n=${completed.metrics.n ?? '?'}`,
      });
      registered = true;

      // Mark the dataset consumed
      if (dataset_id) {
        await db.trainingDataset
          .update({ where: { id: dataset_id }, data: { status: 'consumed' } })
          .catch(() => {});
      }

      // Tell the trainer sidecar the file is ready (writes .ready marker)
      await markArtifactReady(name, version, 'auto-marked after successful train');
    } catch (err) {
      return NextResponse.json({
        ok: true,
        jobId: job.jobId,
        status: 'success',
        artifactPath: completed.artifactPath,
        metrics: completed.metrics,
        registered: false,
        registrationError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    jobId: job.jobId,
    status: 'success',
    artifactPath: completed.artifactPath,
    metrics: completed.metrics,
    registered,
  });
});

