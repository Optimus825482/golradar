// ── Admin: Model Optimizer Trigger ────────────────────────────────
// POST runs full optimization pipeline (backtest + calibration +
// Poisson fit + ensemble grid search). GET returns latest report.

import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/adminRoute";
import {
  runFullOptimization,
  runBacktestFromDB,
  optimizeEnsembleWeights,
} from "@/lib/modelOptimizer";
import { autoCalibrateFromDB, CALIBRATION_PARAMS } from "@/lib/calibration";
import { logError } from '@/lib/devLog';
import { calculateSignalStats } from "@/lib/signalRepository";
import { persistExcludedMinutes, invalidateExcludedMinutesCache } from "@/lib/excludedMinutes";
import type { MinuteRange } from "@/config";

export const dynamic = "force-dynamic";

export const POST = adminRoute(async (request: Request) => {
  let body: any = {};
  try {
    body = await request.json();
  } catch (e) { logError('route', e); }

  const league = parseInt(body.league) || 34;
  const season = body.season || "2025-2026";

  // Faz 9 — excluded minutes persist (POST: body.excludedMinutes)
  if (body.excludedMinutes) {
    const zones: MinuteRange[] = body.excludedMinutes;
    await persistExcludedMinutes(zones);
    return NextResponse.json({ ok: true, excludedMinutes: zones });
  }

  const report = await runFullOptimization(league, season);
  return NextResponse.json({ ok: true, report });
});

export const GET = adminRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "summary";

  // Faz 9 — excluded minute analysis
  if (action === "analyzeExcludedMinutes") {
    const days = parseInt(searchParams.get("days") ?? "90");
    const stats = await calculateSignalStats(days);
    const byRange = stats.signalsByMinuteRange;

    // Her dakika bölgesi için false-positive oranı
    const falsePositives: Array<{ label: string; total: number; goals: number; fpRate: number }> = [];
    for (const [label, data] of Object.entries(byRange)) {
      const fpRate = data.total > 0 ? 1 - data.goals / data.total : 0;
      falsePositives.push({ label, total: data.total, goals: data.goals, fpRate });
    }
    falsePositives.sort((a, b) => b.fpRate - a.fpRate);

    // Yüksek false-positive bölgeleri öner
    const EXCLUDE_FP_THRESHOLD = 0.85; // %85 ten fazla false positive → exclude adayı
    const suggested: MinuteRange[] = falsePositives
      .filter((fp) => fp.fpRate >= EXCLUDE_FP_THRESHOLD && fp.total >= 5)
      .map((fp) => {
        const [low, high] = fp.label.split("-").map(Number);
        return {
          start: isNaN(low) ? 0 : low,
          end: isNaN(high) ? 90 : high,
          reason: `false-positive ${(fp.fpRate * 100).toFixed(0)}% (${fp.total} sinyal, ${fp.goals} gol)`,
        };
      });

    return NextResponse.json({
      ok: true,
      excludedMinutes: suggested,
      falsePositives: falsePositives.slice(0, 10),
    });
  }

  // Default: quick summary
  const [backtest, ensemble] = await Promise.all([
    runBacktestFromDB("goaloo-season"),
    optimizeEnsembleWeights("goaloo-season"),
  ]);

  return NextResponse.json({
    ok: true,
    backtest,
    ensemble,
    calibrationParams: {
      L: CALIBRATION_PARAMS.L,
      k: CALIBRATION_PARAMS.k,
      x0: CALIBRATION_PARAMS.x0,
    },
  });
});
