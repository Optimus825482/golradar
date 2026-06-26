import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/adminRoute';
import { db } from '@/lib/db';
import { logInfo, logError } from '@/lib/devLog';
import fs from 'fs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/ml/dataset-cleanup
 * Her horizon için en yeni 3 dataset harici hepsini siler.
 * Failed/empty olanları da temizler.
 */
export const POST = adminRoute(async () => {
  try {
    const allDatasets = await db.trainingDataset.findMany({
      select: { id: true, horizonMin: true, path: true, rowCount: true, status: true, errorMsg: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    let deleted = 0;
    // Grupla horizon'a göre
    const byHorizon = new Map<number, typeof allDatasets>();
    for (const ds of allDatasets) {
      const h = ds.horizonMin;
      if (!byHorizon.has(h)) byHorizon.set(h, []);
      byHorizon.get(h)!.push(ds);
    }

    for (const [, group] of byHorizon) {
      // Son 3'ü koru
      const keep = group.slice(0, 3);
      const toDelete = group.slice(3);

      for (const ds of toDelete) {
        const isFailed = ds.status === 'failed' || !!ds.errorMsg;
        const isEmpty = (ds.rowCount ?? 0) === 0;
        // Keep last entry per horizon even if failed/empty (safety)
        if (ds.id === keep[keep.length - 1]?.id && !isFailed && !isEmpty) continue;

        if (ds.path) {
          try { if (fs.existsSync(ds.path)) fs.unlinkSync(ds.path); } catch { /* ok */ }
        }
        await db.trainingDataset.delete({ where: { id: ds.id } }).catch(() => {});
        deleted++;
      }
    }

    logInfo('DatasetCleanup', `Cleaned ${deleted} old datasets (keeping 3 newest per horizon)`);
    return NextResponse.json({ ok: true, deleted });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('DatasetCleanup', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

export const GET = adminRoute(async () => {
  const all = await db.trainingDataset.findMany({
    select: { id: true, horizonMin: true, rowCount: true, status: true, errorMsg: true, createdAt: true, path: true },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate stale count: more than 3 per horizon = stale
  const byHorizon = new Map<number, typeof all>();
  for (const ds of all) {
    const h = ds.horizonMin;
    if (!byHorizon.has(h)) byHorizon.set(h, []);
    byHorizon.get(h)!.push(ds);
  }
  let staleCount = 0;
  for (const [, group] of byHorizon) {
    if (group.length > 3) staleCount += group.length - 3;
  }

  const datasets = all.map(d => ({
    id: d.id,
    horizon: d.horizonMin,
    rowCount: d.rowCount,
    sizeBytes: 0,
    status: d.errorMsg ? 'failed' : d.status,
    date: d.createdAt?.toISOString().slice(0, 10) ?? '',
    createdAt: d.createdAt?.toISOString() ?? null,
    errorMsg: d.errorMsg,
  }));

  return NextResponse.json({
    ok: true,
    total: all.length,
    healthy: all.length - staleCount,
    stale: staleCount,
    datasets,
  });
});
