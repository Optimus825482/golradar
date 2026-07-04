// ── Admin: Signal Algorithm Backtest ──────────────────────────────
// İKİ MOD:
//   1. Bucket — PredictionLog'daki feature'ları alır, GÜNCEL modelle
//              yeniden hesaplar, gerçek sonuçla karşılaştırır
//   2. Replay — Aynı feature setiyle sinyal tetiklenir mi kontrol eder
//
// Bu sayede eskiden toplanmış veriler GÜNCEL modelle test edilir.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminRoute } from "@/lib/adminRoute";

// Lazy-load the ML model to avoid blocking the import chain
let _gbdtModel: any = null;
async function getCurrentPrediction(features: number[]): Promise<number> {
  try {
    if (!_gbdtModel) {
      const { loadModel } = await import("@/lib/goalPredictor");
      _gbdtModel = loadModel();
      if (!_gbdtModel) return 0.5;
    }
    const { predictGBDT } = await import("@/lib/goalPredictor");
    const result = predictGBDT(_gbdtModel, features);
    return result.probability;
  } catch {
    return 0.5;
  }
}

function parseFeatures(row: any): number[] | null {
  try {
    if (!row.featuresJson) return null;
    const parsed = JSON.parse(row.featuresJson);
    if (Array.isArray(parsed)) {
      let f = [...parsed];
      if (f.length > 67) f = f.slice(0, 67);
      else if (f.length < 67) f = [...f, ...Array(67 - f.length).fill(0.5)];
      return f;
    }
    return null;
  } catch {
    return null;
  }
}

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

    // 2. Re-run predictions with CURRENT model
    //    FeaturesJson → GBDT model → new probability
    let replayed: { prob: number; actualGoal: boolean }[] = [];
    let replayErrors = 0;
    for (const r of rows) {
      const feats = parseFeatures(r);
      if (!feats) { replayErrors++; continue; }
      const prob = await getCurrentPrediction(feats);
      replayed.push({ prob, actualGoal: r.goalScored === true });
    }

    if (replayed.length === 0) {
      return NextResponse.json({
        ok: true, mode, days, horizonMin, totalRows: 0,
        message: "Hiçbir satır yeniden hesaplanamadı (featuresJson yok)",
      });
    }

    // 3. Compute per-row analysis with NEW predictions
    if (mode === "bucket") {
      const buckets = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      const stats = buckets.slice(0, -1).map((lo, i) => {
        const hi = buckets[i + 1];
        const inBucket = replayed.filter((r) => r.prob >= lo && r.prob < hi);
        const goals = inBucket.filter((r) => r.actualGoal).length;
        const avgP =
          inBucket.length > 0
            ? inBucket.reduce((a, b) => a + b.prob, 0) / inBucket.length
            : 0;
        const obsRate = inBucket.length > 0 ? goals / inBucket.length : 0;
        const brier = inBucket.reduce(
          (a, b) => a + Math.pow(b.prob - (b.actualGoal ? 1 : 0), 2),
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
        replayed.reduce((a, r) => a + Math.pow(r.prob - (r.actualGoal ? 1 : 0), 2), 0) /
        replayed.length;

      return NextResponse.json({
        ok: true,
        mode,
        days,
        horizonMin: horizonMin ?? null,
        totalRows: replayed.length,
        overallBrier: totalBrier,
        buckets: stats,
      });
    }

    // mode === "replay"
    // GÜNCEL modelin tahminleriyle replay yap
    let wouldFire = 0;
    let totalBrierNew = 0;
    let posLabel = 0;
    let posPredAndFire = 0;

    for (const rp of replayed) {
      const isGoal = rp.actualGoal;
      totalBrierNew += Math.pow(rp.prob - (isGoal ? 1 : 0), 2);
      if (isGoal) posLabel++;
      const fires = rp.prob >= 0.6; // signal threshold
      if (fires) wouldFire++;
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
        fireRate: wouldFire / replayed.length,
        brierRaw: totalBrierNew / replayed.length,
        brierCalibrated: totalBrierNew / replayed.length,
        observedGoalRate: posLabel / replayed.length,
        positiveAndFired: posPredAndFire,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "internal_error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});
