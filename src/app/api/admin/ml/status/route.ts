// ── Admin: ML Status Snapshot ──────────────────────────────────────
// One-call view: scheduler uptime, latest trainer jobs, today's
// ModelMetrics, and the current champion per name. Lets operators
// see "what's deployed" without crawling multiple endpoints.

import { NextResponse } from 'next/server';
import { existsSync } from "fs";
import { db } from "@/lib/db";
import { ML_TRAINER_ENABLED, checkTrainerHealth } from "@/lib/ml/mlClient";
import { getTrainingSchedulerStatus } from "@/lib/ml/trainingScheduler";
import {
  listArtifacts,
  resolveArtifactPath,
  type ModelName,
} from "@/lib/ml/modelRouter";
import { adminRoute } from "@/lib/adminRoute";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => {
  if (typeof window !== "undefined") {
    return NextResponse.json({ error: "server-only" }, { status: 503 });
  }

  // Champions per name
  const artifacts = await listArtifacts();
  const champions: Record<
    string,
    { version: string; metrics: Record<string, number>; sha256: string }
  > = {};
  for (const a of artifacts.filter((x) => x.isChampion)) {
    champions[a.name] = {
      version: a.version,
      metrics: a.metrics,
      sha256: a.sha256,
    };
  }

  // All artifacts (including non-champion) for version history
  const allArtifacts = artifacts.map((a) => ({
    name: a.name,
    version: a.version,
    isChampion: a.isChampion,
    metrics: a.metrics,
    createdAt: a.createdAt,
    fileExists: existsSync(resolveArtifactPath(a.artifactPath)),
  }));

  // Latest TrainingDataset rows (last 5)
  const datasets = await db.trainingDataset.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      horizonMin: true,
      rowCount: true,
      brier: true,
      logLoss: true,
      path: true,
      sha256: true,
      status: true,
      createdAt: true,
      errorMsg: true,
    },
  });

  // Recent ModelMetrics (last 14 days for trend)
  const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000);
  const recentMetricsAll = await db.modelMetrics.findMany({
    where: { date: { gte: twoWeeksAgo } },
    orderBy: { date: "desc" },
  });

  const latestMetrics =
    recentMetricsAll.length > 0 ? recentMetricsAll[0] : null;

  // Per-model performance trend (last 14 days)
  const modelTrend: Record<
    string,
    Array<{ date: string; brier: number | null }>
  > = {};
  for (const m of recentMetricsAll) {
    const dateStr = m.date.toISOString().slice(0, 10);
    for (const key of [
      "gbdtBrier",
      "xgbBrier",
      "inPlayBrier",
      "teamStrengthBrier",
    ] as const) {
      const modelName = key
        .replace("Brier", "")
        .replace("Strength", "-strength");
      if (!modelTrend[modelName]) modelTrend[modelName] = [];
      modelTrend[modelName].push({
        date: dateStr,
        brier: (m as any)[key] ?? null,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    trainer: {
      enabled: ML_TRAINER_ENABLED,
      health: await checkTrainerHealth(),
    },
    scheduler: getTrainingSchedulerStatus(),
    champions: champions as Record<
      ModelName,
      { version: string; metrics: Record<string, number>; sha256: string }
    >,
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
    latestMetrics: latestMetrics
      ? {
          date: latestMetrics.date,
          brierScore: latestMetrics.brierScore,
          gbdtBrier: latestMetrics.gbdtBrier,
          xgbBrier: latestMetrics.xgbBrier,
          teamStrengthBrier: latestMetrics.teamStrengthBrier,
          inPlayBrier: latestMetrics.inPlayBrier,
          shadowBrierDelta: latestMetrics.shadowBrierDelta,
          nShadowSamples: latestMetrics.nShadowSamples,
        }
      : null,
    modelTrend,
    allArtifacts,
  });
});
