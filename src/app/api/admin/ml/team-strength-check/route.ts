// ── Admin: Team Strength Data Check ────────────────────────────────
// Pre-flight check before training: does TeamHistoryMatch have enough
// rows to fit a Kalman model? Returns counts per source and a list
// of teams that pass the minMatches filter.
//
// GET /api/admin/ml/team-strength-check?minMatches=5
//   → {
//       ok: true,
//       totalMatches: 3000,
//       perSource: { fotmob: 3000, sofascore: 0, ... },
//       teamsWithMinMatches: 142,
//       maxMatchesForTeam: 87,
//       minMatches: 5,
//       ready: true
//     }

import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/adminRoute';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = adminRoute(async (request: Request) => {
  const url = new URL(request.url);
  const minMatches = Math.max(
    1,
    Math.min(100, parseInt(url.searchParams.get('minMatches') ?? '5', 10) || 5),
  );

  // Total rows + breakdown by source
  const all = await db.teamHistoryMatch.findMany({
    select: { homeTeam: true, awayTeam: true, source: true },
  });

  const perSource: Record<string, number> = {};
  for (const row of all) {
    perSource[row.source] = (perSource[row.source] ?? 0) + 1;
  }

  // Count team appearances (home + away), filter by minMatches
  const counts = new Map<string, number>();
  for (const row of all) {
    counts.set(row.homeTeam, (counts.get(row.homeTeam) ?? 0) + 1);
    counts.set(row.awayTeam, (counts.get(row.awayTeam) ?? 0) + 1);
  }
  let teamsWithMinMatches = 0;
  let maxMatchesForTeam = 0;
  for (const c of counts.values()) {
    if (c >= minMatches) teamsWithMinMatches += 1;
    if (c > maxMatchesForTeam) maxMatchesForTeam = c;
  }

  // A model needs at least 2 teams with minMatches rows (home + away).
  // We also want enough matches to give the Kalman filter stable params.
  const ready = teamsWithMinMatches >= 2 && all.length >= minMatches * 4;

  return NextResponse.json({
    ok: true,
    totalMatches: all.length,
    perSource,
    teamsTotal: counts.size,
    teamsWithMinMatches,
    maxMatchesForTeam,
    minMatches,
    ready,
  });
});
