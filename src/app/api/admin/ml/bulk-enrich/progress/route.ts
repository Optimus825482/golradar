// ── Bulk Enrich Progress API ───────────────────────────────────
// Frontend poll'u için anlık progress durumu.
// GET /api/admin/ml/bulk-enrich/progress

import { NextResponse } from 'next/server';
import { getEnrichProgress } from '@/lib/enrichProgress';

export const dynamic = 'force-dynamic';

export async function GET() {
  const progress = getEnrichProgress();
  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return NextResponse.json({
    ...progress,
    percent: pct,
    elapsed: progress.startTime > 0
      ? Math.round((Date.now() - progress.startTime) / 1000)
      : 0,
  });
}
