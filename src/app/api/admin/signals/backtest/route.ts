// ── Admin: Signal Algorithm Backtest ──────────────────────────────
// Re-runs the signal algorithm over historical PredictionLog rows
// (already labeled) and compares what the *current* algorithm
// would have done vs what actually happened.
//
// Two modes:
//   1. Replay  — recompute probability from raw stats for the same
//                 match+minute and check if signal would fire
//   2. Bucket  — slice resolved signals by calibrated P bucket and
//                 compute observed goal rate + Brier per bucket
//
// POST /api/admin/signals/backtest
//   body: { mode: "replay"|"bucket", days: 30 }

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminRoute } from "@/lib/adminRoute";

export const dynamic = "force-dynamic";

export const POST = adminRoute(async (request: Request) => {
  try {
    const body = await request.json();
    const mode = body.mode === "replay" ? "replay" : "bucket";
    const days = Math.min(180, Math.max(1, parseInt(String(body.days ?? "30"), 10) || 30));

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1. Fetch resolved PredictionLog rows (labeled, time-bounded)
    const rows = await db.predictionLog.findMany({
      where: {
        createdAt: { gte: since },
        goalScored: { not: null },
      },
      orderBy: { createdAt: "asc" },
      take: 20000,
    });

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        mode,
        days,
        totalRows: 0,
        message: "Bu periyotta etiketlenmiş tahmin yok",
      });
    }

    // 2. Compute per-row analysis
    if (mode === "bucket") {
      const buckets = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      const stats = buckets.slice(0, -1).map((lo, i) => {
        const hi = buckets[i + 1];
        const inBucket = rows.filter(
          (r) => r.calibratedP >= lo && r.calibratedP < hi,
        );
        const goals = inBucket.filter((r) => r.goalScored === true).length;
        const avgP =
          inBucket.length > 0
            ? inBucket.reduce((a, b) => a + b.calibratedP, 0) / inBucket.length
            : 0;
        const obsRate = inBucket.length > 0 ? goals / inBucket.length : 0;
        const brier = inBucket.reduce(
          (a, b) => a + Math.pow(b.calibratedP - (b.goalScored ? 1 : 0), 2),
          0,
        ) / inBucket.length;
        const calErr = Math.abs(obsRate - avgP);
        return {
          bucket: `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`,
          count: inBucket.length,
          avgPredicted: avgP,
          observedRate: obsRate,
          brier: brier || null,
          calibrationError: calErr,
          gap: obsRate - avgP,
        };
      });

      const totalBrier =
        rows.reduce((a, r) => a + Math.pow(r.calibratedP - (r.goalScored ? 1 : 0), 2), 0) /
        rows.length;

      return NextResponse.json({
        ok: true,
        mode,
        days,
        totalRows: rows.length,
        overallBrier: totalBrier,
        buckets: stats,
      });
    }

    // mode === "replay"
    // For each labeled row, compare rawScore vs calibratedP vs observed outcome
    let wouldFire = 0;
    let correctSide = 0;
    let totalBrierRaw = 0;
    let totalBrierCal = 0;
    let posLabel = 0;
    let posPredAndFire = 0;

    for (const r of rows) {
      const isGoal = r.goalScored === true;
      totalBrierRaw += Math.pow((r.rawScore / 100) - (isGoal ? 1 : 0), 2);
      totalBrierCal += Math.pow(r.calibratedP - (isGoal ? 1 : 0), 2);
      if (isGoal) posLabel++;
      // Replay: would algorithm have fired a signal for this row?
      const fires = r.rawScore >= 60 && r.side !== "none" && r.side !== "both";
      if (fires) wouldFire++;
      if (fires && r.side === (isGoal ? r.side : "")) correctSide++; // simplified
      if (fires && isGoal && r.calibratedP >= 0.4) posPredAndFire++;
    }

    return NextResponse.json({
      ok: true,
      mode,
      days,
      totalRows: rows.length,
      replay: {
        wouldFireCount: wouldFire,
        fireRate: wouldFire / rows.length,
        brierRaw: totalBrierRaw / rows.length,
        brierCalibrated: totalBrierCal / rows.length,
        observedGoalRate: posLabel / rows.length,
        positiveAndFired: posPredAndFire,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "internal_error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});
