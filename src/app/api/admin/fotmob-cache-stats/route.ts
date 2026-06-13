// ── Admin: FotMob Cache Stats ──────────────────────────────────────
// Lightweight diagnostic endpoint for the FotMob cache layer.
// Returns row counts, hit totals, and scheduler uptime.
//
// NOTE: In production this should be guarded by an auth check
// (admin role / API key). Kept open in dev for observability; add
// a session check before deploying.

import { NextResponse } from 'next/server';
import { getFotMobCacheStats } from '@/lib/fotmobCache';
import { getMaintenanceStatus } from '@/lib/fotmobCacheMaintenance';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (typeof window !== 'undefined') {
    return NextResponse.json({ error: 'server-only' }, { status: 503 });
  }

  try {
    const [stats, maintenance] = await Promise.all([
      getFotMobCacheStats(),
      Promise.resolve(getMaintenanceStatus()),
    ]);

    // Compute hit-rate ratio — null when no data has been served yet.
    // 0% means every read fell through to a network fetch; 100% means
    // every read hit the cache.
    const totalReads = stats.totalHits;
    const cacheHitRate = totalReads > 0
      ? Math.round((totalReads / (totalReads + stats.total)) * 1000) / 10
      : null;

    return NextResponse.json({
      cache: {
        totalRows: stats.total,
        expiredRows: stats.expired,
        failedFetchesLast24h: stats.failedLast24h,
        totalHits: stats.totalHits,
        cacheHitRatePct: cacheHitRate,
      },
      scheduler: {
        running: maintenance.running,
        startedAt: maintenance.startedAt > 0
          ? new Date(maintenance.startedAt).toISOString()
          : null,
        uptimeMs: maintenance.uptimeMs,
        uptimeHuman: maintenance.uptimeMs > 0
          ? humanizeMs(maintenance.uptimeMs)
          : '0s',
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'stats-unavailable', message: (err as Error).message },
      { status: 500 },
    );
  }
}

function humanizeMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const day = Math.floor(hr / 24);
  return `${day}d ${hr % 24}h`;
}
