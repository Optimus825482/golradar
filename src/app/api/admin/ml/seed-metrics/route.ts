// ── Admin: Backfill ModelMetrics Series ───────────────────────────
// One-shot: derive daily ModelMetrics rows from PredictionLog. Used
// after first deploy or whenever the daily shadow job has missed days.
//
// Computes per-day champion Brier, logLoss, accuracy, ECE, plus
// per-name (gbdt/xgb/inplay) Brier from the modelVariant column.

import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/adminRoute";
import { db } from "@/lib/db";
import { computeECE } from "@/lib/calibration";
import { logInfo } from "@/lib/devLog";

export const dynamic = "force-dynamic";

export const POST = adminRoute(async (request: Request) => {
  let body: { days?: number } = {};
  try { body = (await request.json()) as typeof body; } catch { body = {}; }
  const days = Math.min(365, Math.max(1, body.days ?? 30));
  const since = new Date(Date.now() - days * 86_400_000);

  // Pull all resolved predictions in window (chunked if huge).
  const logs = await db.predictionLog.findMany({
    where: {
      goalScored: { not: null },
      createdAt: { gte: since },
    },
    select: {
      matchCode: true,
      minute: true,
      modelVariant: true,
      calibratedP: true,
      goalScored: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (logs.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "no-data",
      message: `No resolved PredictionLog rows in last ${days} days`,
      days,
    });
  }

  // Group by UTC date (YYYY-MM-DD)
  type Bucket = {
    date: Date;
    briers: number[];
    probs: number[];
    outcomes: number[];
    correct: number;
    total: number;
    goals: number;
    perName: Map<string, { sum: number; n: number }>;
  };
  const byDate = new Map<string, Bucket>();
  for (const log of logs) {
    const date = new Date(log.createdAt);
    date.setUTCHours(0, 0, 0, 0);
    const key = date.toISOString();
    let b = byDate.get(key);
    if (!b) {
      b = {
        date,
        briers: [],
        probs: [],
        outcomes: [],
        correct: 0,
        total: 0,
        goals: 0,
        perName: new Map(),
      };
      byDate.set(key, b);
    }
    const p = log.calibratedP;
    const y = log.goalScored ? 1 : 0;
    b.briers.push((p - y) ** 2);
    b.probs.push(p);
    b.outcomes.push(y);
    b.total++;
    if (y === 1) b.goals++;
    if ((p > 0.5) === (y === 1)) b.correct++;

    // Per-name aggregation from modelVariant
    const variant = log.modelVariant || "champion";
    const name = variant.startsWith("shadow:")
      ? variant.split(":")[1]
      : variant.startsWith("artifact:")
        ? variant.split(":")[1].split("@")[0]
        : variant === "champion"
          ? "champion"
          : variant;
    const nb = b.perName.get(name) ?? { sum: 0, n: 0 };
    nb.sum += (p - y) ** 2;
    nb.n += 1;
    b.perName.set(name, nb);
  }

  let written = 0;
  for (const b of byDate.values()) {
    const brierScore = b.briers.reduce((s, v) => s + v, 0) / b.briers.length;
    const logLoss = b.probs.reduce((s, p, i) => {
      const y = b.outcomes[i];
      const pc = Math.max(1e-15, Math.min(1 - 1e-15, p));
      return s + (y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
    }, 0) / b.probs.length;
    const accuracy = b.total > 0 ? b.correct / b.total : 0;
    const calibrationError = b.probs.length > 50 ? computeECE(b.probs, b.outcomes) : 0;
    const avgCalibratedP = b.probs.reduce((s, v) => s + v, 0) / b.probs.length;

    // Find best shadow brierDelta from perName (best non-champion - champion)
    const champBrier = b.perName.get("champion")
      ? b.perName.get("champion")!.sum / b.perName.get("champion")!.n
      : null;
    let bestShadow = Infinity;
    let nShadowSamples = 0;
    const perNameBrier: Record<string, number> = {};
    for (const [name, agg] of b.perName.entries()) {
      const nb = agg.sum / agg.n;
      perNameBrier[name] = nb;
      if (name !== "champion" && nb < bestShadow) {
        bestShadow = nb;
        nShadowSamples = agg.n;
      }
    }
    const shadowBrierDelta = champBrier != null && isFinite(bestShadow)
      ? bestShadow - champBrier
      : null;

    await db.modelMetrics.upsert({
      where: { date: b.date },
      create: {
        date: b.date,
        brierScore,
        logLoss,
        accuracy,
        totalPredictions: b.total,
        totalGoals: b.goals,
        avgCalibratedP,
        goalAfterSignalP: 0,
        avgMinutesToGoal: 0,
        calibrationError,
        gbdtBrier: perNameBrier["gbdt"] ?? null,
        xgbBrier: perNameBrier["xgb"] ?? null,
        teamStrengthBrier: perNameBrier["team-strength"] ?? null,
        inPlayBrier: perNameBrier["inplay"] ?? null,
        shadowBrierDelta: shadowBrierDelta,
        nShadowSamples,
      },
      update: {
        brierScore,
        logLoss,
        accuracy,
        totalPredictions: b.total,
        totalGoals: b.goals,
        avgCalibratedP,
        calibrationError,
        gbdtBrier: perNameBrier["gbdt"] ?? null,
        xgbBrier: perNameBrier["xgb"] ?? null,
        teamStrengthBrier: perNameBrier["team-strength"] ?? null,
        inPlayBrier: perNameBrier["inplay"] ?? null,
        shadowBrierDelta,
        nShadowSamples,
      },
    });
    written++;
  }

  logInfo("admin-seed-metrics", `Backfilled ${written} daily rows from ${logs.length} predictions`);

  return NextResponse.json({
    ok: true,
    daysScanned: days,
    predictionsScanned: logs.length,
    daysWritten: written,
    dateRange: {
      start: logs[0]?.createdAt?.toISOString(),
      end: logs[logs.length - 1]?.createdAt?.toISOString(),
    },
  });
});