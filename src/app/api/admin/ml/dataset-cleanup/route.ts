import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/adminRoute';
import { db } from '@/lib/db';
import { logInfo, logError } from '@/lib/devLog';
import fs from 'fs';

export const dynamic = 'force-dynamic';

export const POST = adminRoute(async () => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const allDatasets = await db.trainingDataset.findMany({
      select: { id: true, path: true, rowCount: true, status: true, errorMsg: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    let deleted = 0;
    for (const ds of allDatasets) {
      const isOld = ds.createdAt && ds.createdAt < thirtyDaysAgo;
      const isFailed = ds.status === 'failed' || !!ds.errorMsg;
      const isEmpty = (ds.rowCount ?? 0) === 0;
      if (!isOld && !isFailed && !isEmpty) continue;

      // Safety: keep at least last 5 datasets
      const currentIndex = allDatasets.findIndex(d => d.id === ds.id);
      if (currentIndex < 5 && allDatasets.length > 5) continue;

      if (ds.path) {
        try { if (fs.existsSync(ds.path)) fs.unlinkSync(ds.path); } catch { /* ok */ }
      }
      await db.trainingDataset.delete({ where: { id: ds.id } });
      deleted++;
    }

    logInfo('DatasetCleanup', `Cleaned ${deleted} stale/failed/empty datasets`);
    return NextResponse.json({ ok: true, deleted });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('DatasetCleanup', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
