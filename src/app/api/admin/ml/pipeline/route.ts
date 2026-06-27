// ── Admin: ML Pipeline API ─────────────────────────────────────────
// POST /api/admin/ml/pipeline — Start a new pipeline run
// GET  /api/admin/ml/pipeline  — List recent pipeline runs
// GET  /api/admin/ml/pipeline?id=xxx — Get single run status

import { NextResponse } from 'next/server';
import { db } from "@/lib/db";
import { adminRoute } from "@/lib/adminRoute";
import { runPipeline } from '@/lib/ml/pipelineRunner';

export const dynamic = "force-dynamic";

export const POST = adminRoute(async (request: Request) => {
  try {
    const body = await request.json();
    const { modelName, horizonMin } = body;

    const SUPPORTED_PIPELINE_MODELS = [
      'gbdt',
      'xgb',
      'inplay',
      'team-strength',
      'xt-grid',
      'lightgbm',
    ];
    if (!SUPPORTED_PIPELINE_MODELS.includes(modelName)) {
      return NextResponse.json(
        { error: `modelName must be one of: ${SUPPORTED_PIPELINE_MODELS.join('|')}` },
        { status: 400 },
      );
    }

    const runId = await runPipeline({ modelName, horizonMin: horizonMin || 5 });
    return NextResponse.json({ ok: true, runId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});

export const GET = adminRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (id) {
    const run = await db.pipelineRun.findUnique({ where: { id } });
    return NextResponse.json(run || { error: 'not found' }, { status: run ? 200 : 404 });
  }

  const runs = await db.pipelineRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return NextResponse.json(runs);
});
