// ── Admin: Data Import (Team History Backfill) ───────────────────────
// Two-mode endpoint:
//   1. dryRun=true  → validate source+range, do NOT touch DB
//   2. dryRun=false → call backfillTeamHistory() with the same args
//
// Body:
//   {
//     source: 'fotmob' | 'sofascore' | 'scoremer' | 'goaloo'
//     startDate: 'YYYY-MM-DD',
//     endDate:   'YYYY-MM-DD',
//     dryRun:    boolean  (default: true)
//   }

import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/adminRoute';
import {
  backfillTeamHistory,
} from '@/lib/ml/teamHistoryBackfill';
import { fetchHistoricalMatchesRange, backfillFromNesine } from '@/lib/nesineHistorical';

export const dynamic = 'force-dynamic';

const VALID_SOURCES = ['fotmob', 'sofascore', 'scoremer', 'goaloo', 'nesine'];
const MAX_DAYS = 365;

export const POST = adminRoute(async (request: Request) => {
  let body: {
    source?: string;
    startDate?: string;
    endDate?: string;
    dryRun?: boolean;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid-body' }, { status: 400 });
  }

  const source = body.source ?? 'fotmob';
  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid-source',
        message: `Source must be one of: ${VALID_SOURCES.join(', ')}`,
        valid: VALID_SOURCES,
      },
      { status: 400 },
    );
  }

  const end = body.endDate ? new Date(body.endDate) : new Date();
  const start = body.startDate
    ? new Date(body.startDate)
    : new Date(end.getTime() - 30 * 86_400_000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json(
      { ok: false, error: 'invalid-date' },
      { status: 400 },
    );
  }
  if (start > end) {
    return NextResponse.json(
      { ok: false, error: 'startDate > endDate' },
      { status: 400 },
    );
  }

  const days = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
  if (days > MAX_DAYS) {
    return NextResponse.json(
      {
        ok: false,
        error: 'range-too-large',
        message: `Date range is ${days} days; max is ${MAX_DAYS}.`,
        days,
        max: MAX_DAYS,
      },
      { status: 400 },
    );
  }

  const dryRun = body.dryRun ?? true;
  const dateRange = {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    days,
  };

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      source,
      dateRange,
    });
  }

  try {
    // Nesine historical: gerçek stats'lı geçmiş maç backfill
    if (source === 'nesine') {
      const matches = await fetchHistoricalMatchesRange(
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
      );
      const result = await backfillFromNesine(matches, { maxMatches: Math.min(matches.length, 100000) });

      return NextResponse.json({
        ok: true,
        dryRun: false,
        source,
        dateRange,
        scraped: matches.length,
        inserted: result.processed,
        predictionLogsCreated: result.predictions,
        skippedDuplicate: 0,
        message: `${matches.length} maç bulundu, ${result.processed} işlendi, ${result.predictions} prediction log oluşturuldu`,
      });
    }

    const backfill = await backfillTeamHistory(start, end, source as any);

    // ── Auto-trigger Phase 2 enrichment for Goaloo ──
    // After import, immediately enrich matches with momentum + events + prediction logs.
    let enrichResult = null;
    if (source === 'goaloo' && backfill.inserted && backfill.inserted > 0) {
      try {
        const enrichUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3012'}/api/admin/ml/bulk-enrich`;
        const enrichRes = await fetch(enrichUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': process.env.CRON_SECRET || '' },
          body: JSON.stringify({ maxMatches: Math.min(backfill.inserted, 100000) }),
          signal: AbortSignal.timeout(30000),
        });
        if (enrichRes.ok) enrichResult = await enrichRes.json();
      } catch {
        // Enrichment is best-effort — don't fail the import
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      source,
      dateRange,
      ...backfill,
      enrichResult,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: 'import-failed',
        message: err instanceof Error ? err.message : String(err),
        source,
        dateRange,
      },
      { status: 500 },
    );
  }
});
