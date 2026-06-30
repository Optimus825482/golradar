// ── Team Detail API ─────────────────────────────────────────────
// GET /api/team-detail?team=Galatasaray
// Returns: TeamRating + recent matches with goals + season averages
// Falls back to on-the-fly calculation if TeamRating row missing.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const team = searchParams.get('team')?.trim();
  if (!team) return NextResponse.json({ error: 'team required' }, { status: 400 });

  // 1. Try TeamRating from DB
  let rating = await db.teamRating.findUnique({ where: { teamName: team } });

  // 2. If no rating, search by case-insensitive
  if (!rating) {
    const rows = await db.teamRating.findMany({
      where: { teamName: { contains: team, mode: 'insensitive' } },
      take: 1,
    });
    rating = rows[0] ?? null;
  }

  // 3. Recent matches from TeamHistoryMatch
  const recentMatches = await db.teamHistoryMatch.findMany({
    where: {
      OR: [{ homeTeam: { contains: team, mode: 'insensitive' } },
           { awayTeam: { contains: team, mode: 'insensitive' } }],
    },
    orderBy: { matchDate: 'desc' },
    take: 30,
  });

  // Format recent matches for display (last 5)
  const last5 = recentMatches.slice(0, 5).map(m => {
    const isHome = m.homeTeam.toLowerCase() === team.toLowerCase();
    const gf = isHome ? m.homeGoals : m.awayGoals;
    const ga = isHome ? m.awayGoals : m.homeGoals;
    const opponent = isHome ? m.awayTeam : m.homeTeam;
    const result = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
    return { date: m.matchDate, opponent, goalsFor: gf, goalsAgainst: ga, result, isHome };
  });

  // Season aggregates (from all fetched matches)
  const total = recentMatches.length;
  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0;
  for (const m of recentMatches) {
    const isHome = m.homeTeam.toLowerCase() === team.toLowerCase();
    const gfm = isHome ? m.homeGoals : m.awayGoals;
    const gam = isHome ? m.awayGoals : m.homeGoals;
    gf += gfm; ga += gam;
    if (gfm > gam) wins++; else if (gfm < gam) losses++; else draws++;
  }

  // Calculate attack/defense strength if missing
  let attackStrength = rating?.attackStrength ?? null;
  let defenseWeakness = rating?.defenseWeakness ?? null;
  if (attackStrength == null && total > 0) {
    const avgGoalsScored = gf / total;
    // Attack strength = avg goals scored / 1.5 (league avg)
    attackStrength = Math.round((avgGoalsScored / 1.5) * 100) / 100;
  }
  if (defenseWeakness == null && total > 0) {
    const avgGoalsConceded = ga / total;
    defenseWeakness = Math.round((avgGoalsConceded / 1.5) * 100) / 100;
  }

  return NextResponse.json({
    team,
    elo: rating?.elo ?? 1500,
    attackStrength: attackStrength ?? 1.0,
    defenseWeakness: defenseWeakness ?? 1.0,
    piHa: rating?.piHa ?? 0,
    piHd: rating?.piHd ?? 0,
    piAa: rating?.piAa ?? 0,
    piAd: rating?.piAd ?? 0,
    piMatches: rating?.piMatches ?? 0,
    matchesPlayed: rating?.matchesPlayed ?? total,
    wins: rating?.wins ?? wins,
    draws: rating?.draws ?? draws,
    losses: rating?.losses ?? losses,
    goalsFor: rating?.goalsFor ?? gf,
    goalsAgainst: rating?.goalsAgainst ?? ga,
    seasonAvgGF: total > 0 ? Math.round((gf / total) * 100) / 100 : 0,
    seasonAvgGA: total > 0 ? Math.round((ga / total) * 100) / 100 : 0,
    last5,
    // Raw recent matches for detail
    recentMatchCount: total,
  });
}
