import { NextResponse } from 'next/server';
import { triggerExportNow } from '@/lib/ml/trainingScheduler';
import type { TrainingHorizon } from '@/lib/ml/exportTrainingData';
import { adminRoute } from '@/lib/adminRoute';
import { db } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const VALID_HORIZONS: TrainingHorizon[] = [5, 10, 15];

// GET /api/admin/ml/export — list available training datasets from DB
export const GET = adminRoute(async () => {
  const rows = await db.trainingDataset.findMany({
    select: { id: true, horizonMin: true, rowCount: true, path: true, status: true, errorMsg: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const datasets = rows.map(r => {
    let sizeBytes = 0;
    if (r.path) {
      try {
        const fullPath = r.path.startsWith('/') ? r.path : path.join(process.cwd(), r.path);
        if (fs.existsSync(fullPath)) sizeBytes = fs.statSync(fullPath).size;
      } catch { /* file may be deleted */ }
    }
    return {
      id: r.id,
      horizon: r.horizonMin,
      rowCount: r.rowCount,
      path: r.path,
      sizeBytes,
      status: r.status,
      date: r.createdAt?.toISOString().slice(0, 10) ?? '',
      createdAt: r.createdAt?.toISOString() ?? null,
      errorMsg: r.errorMsg,
    };
  });
  return NextResponse.json({ datasets });
});

export const POST = adminRoute(async (request: Request) => {
  if (typeof window !== 'undefined') {
    return NextResponse.json({ error: 'server-only' }, { status: 503 });
  }

  let body: { horizon?: number } = {};
  try {
    body = (await request.json()) as { horizon?: number };
  } catch {
    // Empty body is OK — defaults to all horizons
  }

  let horizon: TrainingHorizon | undefined;
  if (typeof body.horizon === 'number') {
    if (!VALID_HORIZONS.includes(body.horizon as TrainingHorizon)) {
      return NextResponse.json(
        { error: `invalid horizon; must be one of ${VALID_HORIZONS.join(', ')}` },
        { status: 400 },
      );
    }
    horizon = body.horizon as TrainingHorizon;
  }

  try {
    const result = await triggerExportNow(horizon);
    return NextResponse.json({
      ok: !!result,
      horizon: result?.datasetId ? `${horizon ?? 5}min` : null,
      rowCount: result?.rowCount ?? 0,
      path: result?.path ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'export-failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
});
