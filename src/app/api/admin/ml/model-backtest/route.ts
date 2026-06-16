// ── Admin: Model Backtest (modelBacktest.ts wrapper) ────────────
// Wraps `runModelBacktest` from modelBacktest.ts. Supports:
//   - 'champion' for currently deployed model
//   - 'artifact:<name>@<version>' for stored artifacts
//   - 'shadow:<name>@<version>' for shadow variants
//
// GET  /api/admin/ml/model-backtest          → list artifacts
// POST /api/admin/ml/model-backtest          → run backtest
//   body: { mode: "champion"|"artifact", name?, version?, days?: 14 }

import { NextResponse } from "next/server";
import {
  runModelBacktest,
  type ModelSelector,
  type BacktestModelConfig,
  type BacktestModelResult,
} from "@/lib/ml/modelBacktest";
import { listArtifacts } from "@/lib/ml/modelRouter";
import type { ModelName } from "@/lib/ml/modelRouter";
import { adminRoute } from "@/lib/adminRoute";

export const dynamic = "force-dynamic";

const VALID_NAMES = new Set<string>([
  "gbdt",
  "xgb",
  "inplay",
  "team-strength",
  "xt-grid",
]);

export const GET = adminRoute(async () => {
  const artifacts = await listArtifacts();
  return NextResponse.json({
    artifacts: artifacts.map((a) => ({
      name: a.name,
      version: a.version,
      isChampion: a.isChampion,
      metrics: a.metrics,
      trainedAt: a.createdAt,
    })),
  });
});

export const POST = adminRoute(async (request: Request) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const mode = body.mode || "champion";
  const days = Math.min(90, Math.max(1, body.days || 14));

  let selector: ModelSelector;

  if (mode === "champion") {
    selector = { kind: "champion" };
  } else if (mode === "artifact") {
    const name = body.name;
    const version = body.version;
    if (!name || !VALID_NAMES.has(name)) {
      return NextResponse.json(
        { error: "valid model name required" },
        { status: 400 },
      );
    }
    if (!version) {
      return NextResponse.json({ error: "version required" }, { status: 400 });
    }
    selector = { kind: "artifact", name: name as ModelName, version };
  } else {
    return NextResponse.json(
      { error: "mode must be champion|artifact" },
      { status: 400 },
    );
  }

  const config: BacktestModelConfig = {
    days,
    minSamples: body.minSamples ?? 50,
  };

  const result = await runModelBacktest(selector, config);
  if (!result) {
    return NextResponse.json(
      { error: "not enough data for backtest" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, result });
});
