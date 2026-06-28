// ── Admin: Manual Shadow Eval Trigger ────────────────────────────
// Runs the daily shadow Brier rollup + drift persistence once on
// demand. Useful after first deploy or to backfill historical days.

import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/adminRoute";
import { evaluateDailyShadows } from "@/lib/ml/shadowEvaluator";
import { evaluateCalibrationDrift, persistDriftReport } from "@/lib/ml/calibrationLoop";
import { db } from "@/lib/db";
import { logInfo } from "@/lib/devLog";

export const dynamic = "force-dynamic";

export const POST = adminRoute(async (request: Request) => {
  let body: { date?: string; windowDays?: number } = {};
  try { body = (await request.json()) as typeof body; } catch { body = {}; }

  const targetDate = body.date ? new Date(body.date) : new Date();
  const windowDays = body.windowDays ?? 7;

  // 1. Shadow Brier rollup
  const shadow = await evaluateDailyShadows(targetDate, { persist: true });

  // 2. Build series from last 14 days
  const since = new Date(Date.now() - 14 * 86_400_000);
  const series = await db.modelMetrics.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "asc" },
    select: { date: true, brierScore: true },
  });
  const brierSeries = series
    .filter((r) => r.brierScore != null)
    .map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      brierScore: r.brierScore as number,
    }));

  // 3. Drift report + persist
  const driftReport = evaluateCalibrationDrift({ series: brierSeries, windowDays });
  const today = targetDate.toISOString().slice(0, 10);
  await persistDriftReport(today, driftReport, "admin-manual");

  logInfo("admin-shadow-eval",
    `Manual eval done for ${today}: champion=${shadow.championBrier?.toFixed(4) ?? 'N/A'}, ` +
    `delta=${shadow.shadowBrierDelta.toFixed(4)}, drift=${driftReport.driftPct?.toFixed(2) ?? "N/A"}%`);

  return NextResponse.json({
    ok: true,
    shadow: {
      date: shadow.date,
      championBrier: shadow.championBrier,
      shadowBrierDelta: shadow.shadowBrierDelta,
      nShadowSamples: shadow.nShadowSamples,
      suspendedVariants: shadow.suspendedVariants,
      perVariant: shadow.perVariant,
    },
    drift: driftReport,
    seriesSize: brierSeries.length,
  });
});