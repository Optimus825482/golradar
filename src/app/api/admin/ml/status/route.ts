// ── Admin: ML Status Snapshot ──────────────────────────────────────
// One-call view: scheduler uptime, latest trainer jobs, today's
// ModelMetrics, and the current champion per name. Lets operators
// see "what's deployed" without crawling multiple endpoints.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ML_TRAINER_ENABLED, checkTrainerHealth } from '@/lib/ml/mlClient';
import { getTrainingSchedulerStatus } from '@/lib/ml/trainingScheduler';
import { listArtifacts, type ModelName } from '@/lib/ml/modelRouter';
import { adminRoute } from '@/lib/adminRoute';

export const dynamic = 'force-dynamic';

export const GET = adminRoute(async () => {
  if (typeof window !== 'undefined') {
    return NextResponse.json({ error: 'server-only' }, { status: 503 });
  }

  // Champions per name
  const artifacts = await listArtifacts();
  const champions: Record<string, { version: string; metrics: Record<string, number>; sha256: string }> = {};
  for (const a of artifacts.filter((x) => x.isChampion)) {
    champions[a.name] = { version: a.version, metrics: a.metrics, sha256: a.sha256 };
  }

  // Latest TrainingDataset rows (last 5)
  const datasets = await db.trainingDataset.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true, horizonMin: true, rowCount: true, brier: true,
      logLoss: true, path: true, sha256: true, status: true,
      createdAt: true, errorMsg: true,
    },
  });

  // Today's ModelMetrics (with a fallback to the most recent)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const recentMetrics = await db.modelMetrics.findFirst({
    where: { date: { gte: new Date(today.getTime() - 2 * 86_400_000) } },
    orderBy: { date: 'desc' },
  });

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    trainer: {
      enabled: ML_TRAINER_ENABLED,
      health: await checkTrainerHealth(),
    },
    scheduler: getTrainingSchedulerStatus(),
    champions: champions as Record<ModelName, { version: string; metrics: Record<string, number>; sha256: string }>,
    recentDatasets: datasets.map((d) => ({
      id: d.id,
      horizonMin: d.horizonMin,
      rowCount: d.rowCount,
      brier: d.brier,
      logLoss: d.logLoss,
      path: d.path,
      status: d.status,
      createdAt: d.createdAt,
      errorMsg: d.errorMsg,
    })),
    latestMetrics: recentMetrics
      ? {
          date: recentMetrics.date,
          brierScore: recentMetrics.brierScore,
          gbdtBrier: recentMetrics.gbdtBrier,
          xgbBrier: recentMetrics.xgbBrier,
          teamStrengthBrier: recentMetrics.teamStrengthBrier,
          inPlayBrier: recentMetrics.inPlayBrier,
          shadowBrierDelta: recentMetrics.shadowBrierDelta,
          nShadowSamples: recentMetrics.nShadowSamples,
        }
      : null,
  });
});
