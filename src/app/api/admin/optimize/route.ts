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
import { autoCalibrateFromDB } from "@/lib/calibration";
import { logError } from '@/lib/devLog';

export const dynamic = "force-dynamic";

export const POST = adminRoute(async (request: Request) => {
  let body: any = {};
  try {
    body = await request.json();
  } catch (e) { logError('route', e); }

  const league = parseInt(body.league) || 34;
  const season = body.season || "2025-2026";

  const report = await runFullOptimization(league, season);
  return NextResponse.json({ ok: true, report });
});

export const GET = adminRoute(async (_request: Request) => {
  // Quick summary: run backtest only (fast)
  const [backtest, ensemble] = await Promise.all([
    runBacktestFromDB("goaloo-season"),
    optimizeEnsembleWeights("goaloo-season"),
  ]);

  return NextResponse.json({
    ok: true,
    backtest,
    ensemble,
    calibrationParams: {
      L: 0.8,
      k: (await import("@/lib/calibration")).CALIBRATION_PARAMS.k,
      x0: (await import("@/lib/calibration")).CALIBRATION_PARAMS.x0,
    },
  });
});
