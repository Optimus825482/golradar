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
    // Parse body defensively — empty/invalid body should not 500.
    let body: { mode?: unknown; days?: unknown; horizonMin?: unknown } = {};
    const text = await request.text();
    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { ok: false, error: "invalid JSON body" },
          { status: 400 },
        );
      }
    }
    const mode = body.mode === "replay" ? "replay" : "bucket";
    const days = Math.min(180, Math.max(1, parseInt(String(body.days ?? "30"), 10) || 30));
    // horizonMin: signal reach window (5/10/15/30/60 min). null = no filter.
    // Filters by minutesToGoal — only rows whose goal happened within horizon
    // count as "matched" signal.
    const horizonRaw = body.horizonMin;
    const horizonMin =
      horizonRaw == null || horizonRaw === ""
        ? null
        : Math.min(120, Math.max(1, parseInt(String(horizonRaw), 10) || 0)) || null;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1. Fetch resolved PredictionLog rows (labeled, time-bounded)
    let rows = await db.predictionLog.findMany({
      where: {
        createdAt: { gte: since },
        goalScored: { not: null },
      },
      orderBy: { createdAt: "asc" },
      take: 20000,
    });

    // Apply horizon filter (client-side; Prisma can't compute minutesToGoal
    // server-side without a derived column).
    if (horizonMin != null) {
      rows = rows.filter(
        (r) => r.minutesToGoal == null || r.minutesToGoal <= horizonMin,
      );
    }

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        mode,
        days,
        horizonMin,
        totalRows: 0,
        message:
          horizonMin != null
            ? `Bu periyotta ${horizonMin}dk horizon'da etiketlenmiş tahmin yok`
            : "Bu periyotta etiketlenmiş tahmin yok",
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
        horizonMin: horizonMin ?? null,
        totalRows: rows.length,
        overallBrier: totalBrier,
        buckets: stats,
      });
    }

    // mode === "replay"
    // For each labeled row, compare rawScore vs calibratedP vs observed outcome
    let wouldFire = 0;
    let totalBrierRaw = 0;
    let totalBrierCal = 0;
    let posLabel = 0;
    let posPredAndFire = 0;

    for (const r of rows) {
      const isGoal = r.goalScored === true;
      totalBrierRaw += Math.pow((r.rawScore / 100) - (isGoal ? 1 : 0), 2);
      totalBrierCal += Math.pow(r.calibratedP - (isGoal ? 1 : 0), 2);
      if (isGoal) posLabel++;
      // FIX: side null/none/both filtrele. Eski kod `!== "none"` yapiyordu
      // ama null'i geciriyordu (side null olan satirlar fire sayiliyordu).
      // Ayrica "both" da geciriliyordu, bu da yanlis.
      const side = r.side as string | null;
      const hasValidSide = side != null && side !== "none" && side !== "both";
      const fires = r.rawScore >= 60 && hasValidSide;
      if (fires) wouldFire++;
      // FIX: calibratedP filtreyi kaldir — sinyal esigi zaten rawScore>=60.
      // calibratedP>=0.4 ayri bir metrik (calibration quality), burda degil.
      // NOT: correctSide hesaplamasi burada mumkun degil cunku PredictionLog'ta
      // goalSide alani yok. Signal tablosu uzerinden backtestEngine.ts'de yapilir.
      if (fires && isGoal) posPredAndFire++;
    }

    return NextResponse.json({
      ok: true,
      mode,
      days,
      horizonMin: horizonMin ?? null,
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
