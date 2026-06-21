// ── Admin: Team Strength Fit ────────────────────────────────────────
// Two-step: (1) backfill historical matches from Scoremer into
// `TeamHistoryMatch` for a date range, then (2) fit a fresh
// Kalman team-strength model and register it as a
// `ModelArtifact(name='team-strength')`.
//
// Body:
//   {
//     startDate: "2025-01-01",     // optional, default 365 days back
//     endDate:   "2026-06-14",     // optional, default today
//     minMatches: 5,               // optional, default 5
//     notes: "initial backfill",   // optional
//     promote: true                // optional, default false
//   }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  backfillTeamHistory,
  fitAndRegisterTeamStrength,
} from '@/lib/ml/teamHistoryBackfill';
import { promoteArtifact } from '@/lib/ml/modelRouter';
import { adminRoute } from '@/lib/adminRoute';

export const dynamic = 'force-dynamic';

export const POST = adminRoute(async (request: Request) => {

  let body: {
    startDate?: string;
    endDate?: string;
    minMatches?: number;
    notes?: string;
    promote?: boolean;
    source?: 'scoremer' | 'goaloo';
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // Empty body is OK — defaults applied below
  }

  const end = body.endDate ? new Date(body.endDate) : new Date();
  const start = body.startDate
    ? new Date(body.startDate)
    : new Date(end.getTime() - 365 * 86_400_000);
  const minMatches = body.minMatches ?? 5;
  const source = body.source ?? 'goaloo';

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: 'invalid-date' }, { status: 400 });
  }
  if (start > end) {
    return NextResponse.json({ error: 'startDate > endDate' }, { status: 400 });
  }

  try {
    const backfill = await backfillTeamHistory(start, end, source);
    const fit = await fitAndRegisterTeamStrength({
      minMatches,
      notes: body.notes,
    });

    let promoted = false;
    if (body.promote && fit.modelVersion !== 'no-data') {
      const r = await promoteArtifact('team-strength', fit.modelVersion, body.notes);
      promoted = r.ok;
    }

    return NextResponse.json({
      ok: true,
      backfill,
      fit,
      promoted,
      dateRange: {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'fit-failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
});

// ── GET: latest champion + 5 recent artifacts ───────────────────
// Satisfies the ELO admin page which fetches GET on this endpoint.
export const GET = adminRoute(async () => {
  const champion = await db.modelArtifact.findFirst({
    where: { name: 'team-strength', isChampion: true },
    orderBy: { createdAt: 'desc' },
  });
  const recent = await db.modelArtifact.findMany({
    where: { name: 'team-strength' },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  return NextResponse.json({
    ok: true,
    champion: champion
      ? {
          version: champion.version,
          metrics: JSON.parse(champion.metricsJson || '{}'),
          createdAt: champion.createdAt,
        }
      : null,
    recent: recent.map((a) => ({
      version: a.version,
      isChampion: a.isChampion,
      metrics: JSON.parse(a.metricsJson || '{}'),
      createdAt: a.createdAt,
    })),
  });
});
