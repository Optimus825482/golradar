// ── Admin: ML Monitoring Endpoint ─────────────────────────────────
// Returns daily ModelMetrics trend for the last N days + drift
// detection (compares last 7d avg Brier vs prior 7d).
//
// GET /api/admin/ml/monitoring?days=30

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminRoute } from "@/lib/adminRoute";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const days = Math.min(180, Math.max(7, parseInt(searchParams.get("days") ?? "30", 10)));

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  since.setHours(0, 0, 0, 0);

  const rows = await db.modelMetrics.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "asc" },
  });

  const series = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    brierScore: r.brierScore,
    logLoss: r.logLoss,
    accuracy: r.accuracy,
    calibrationError: r.calibrationError,
    totalPredictions: r.totalPredictions,
    totalGoals: r.totalGoals,
    avgCalibratedP: r.avgCalibratedP,
    shadowBrierDelta: r.shadowBrierDelta,
    gbdtBrier: r.gbdtBrier,
    xgbBrier: r.xgbBrier,
    inPlayBrier: r.inPlayBrier,
              // Ensemble Brier is the per-day blended score, pre-aggregated
              // in the writer. For now we expose the per-model Briers; the
              // caller can compute a weighted mean client-side if needed.
              ensembleBrier: r.brierScore,
  }));

  // Drift detection: compare last 7d avg Brier vs previous 7d avg
  const recent = series.slice(-7);
  const prior = series.slice(-14, -7);
  const recentAvg =
    recent.length > 0 ? recent.reduce((a, b) => a + b.brierScore, 0) / recent.length : null;
  const priorAvg =
    prior.length > 0 ? prior.reduce((a, b) => a + b.brierScore, 0) / prior.length : null;
  const driftPct =
    recentAvg !== null && priorAvg !== null && priorAvg !== 0
      ? ((recentAvg - priorAvg) / priorAvg) * 100
      : null;

  // Shadow tracking — find latest non-null shadowBrierDelta
  const latestShadow = [...series].reverse().find((s) => s.shadowBrierDelta != null);
  const bestShadowModel: 'gbdt' | 'xgb' | 'inplay' | null = (() => {
    if (!latestShadow) return null;
    const candidates = [
      { key: 'gbdt' as const, brier: latestShadow.gbdtBrier },
      { key: 'xgb' as const, brier: latestShadow.xgbBrier },
      { key: 'inplay' as const, brier: latestShadow.inPlayBrier },
    ].filter((c) => c.brier != null) as { key: 'gbdt' | 'xgb' | 'inplay'; brier: number }[];
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.brier - b.brier);
    return candidates[0].key;
  })();

  return NextResponse.json({
    ok: true,
    series,
    drift: {
      recentAvgBrier: recentAvg,
      priorAvgBrier: priorAvg,
      driftPct,
      direction: driftPct != null ? (driftPct > 5 ? 'worse' : driftPct < -5 ? 'better' : 'stable') : null,
    },
    latestShadow: latestShadow
      ? {
          date: latestShadow.date,
          delta: latestShadow.shadowBrierDelta,
          bestModel: bestShadowModel,
          gbdt: latestShadow.gbdtBrier,
          xgb: latestShadow.xgbBrier,
          inPlay: latestShadow.inPlayBrier,
        }
      : null,
    totalDays: series.length,
  });
});
