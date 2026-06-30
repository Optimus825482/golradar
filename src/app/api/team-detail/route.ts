// ── Team Detail API ─────────────────────────────────────────────
// GET /api/team-detail?team=Galatasaray
// Returns: TeamRating + recent matches with goals + season averages
// Falls back to on-the-fly calculation if TeamRating row missing.
// For national teams, falls back to NationalTeamElo for Elo rating.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const team = searchParams.get('team')?.trim();
  if (!team) return NextResponse.json({ error: 'team required' }, { status: 400 });

  // 1. Try TeamRating from DB
  let rating = await db.teamRating.findUnique({ where: { teamName: team } });
  if (!rating) {
    const rows = await db.teamRating.findMany({
      where: { teamName: { contains: team, mode: 'insensitive' } },
      take: 1,
    });
    rating = rows[0] ?? null;
  }

  // 2. Recent matches from TeamHistoryMatch
  const recentMatches = await db.teamHistoryMatch.findMany({
    where: {
      OR: [{ homeTeam: { contains: team, mode: 'insensitive' } },
           { awayTeam: { contains: team, mode: 'insensitive' } }],
    },
    orderBy: { matchDate: 'desc' },
    take: 30,
  });

  // Format last 5
  const last5 = recentMatches.slice(0, 5).map(m => {
    const isHome = m.homeTeam.toLowerCase() === team.toLowerCase();
    const gf = isHome ? m.homeGoals : m.awayGoals;
    const ga = isHome ? m.awayGoals : m.homeGoals;
    const opponent = isHome ? m.awayTeam : m.homeTeam;
    const result = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
    return { date: m.matchDate, opponent, goalsFor: gf, goalsAgainst: ga, result, isHome };
  });

  // 3. Season aggregates from TeamHistoryMatch
  const thmTotal = recentMatches.length;
  let thmWins = 0, thmDraws = 0, thmLosses = 0, thmGf = 0, thmGa = 0;
  for (const m of recentMatches) {
    const isHome = m.homeTeam.toLowerCase() === team.toLowerCase();
    const gfm = isHome ? m.homeGoals : m.awayGoals;
    const gam = isHome ? m.awayGoals : m.homeGoals;
    thmGf += gfm; thmGa += gam;
    if (gfm > gam) thmWins++; else if (gfm < gam) thmLosses++; else thmDraws++;
  }

  // 4. Use TeamRating data if available, otherwise TeamHistoryMatch
  const mp = rating?.matchesPlayed ?? thmTotal;
  const w = rating?.wins ?? thmWins;
  const d = rating?.draws ?? thmDraws;
  const l = rating?.losses ?? thmLosses;
  const gf = rating?.goalsFor ?? thmGf;
  const ga = rating?.goalsAgainst ?? thmGa;

  // 5. Season averages from the SAME source (mp/gf/ga)
  const seasonAvgGF = mp > 0 ? Math.round((gf / mp) * 100) / 100 : 0;
  const seasonAvgGA = mp > 0 ? Math.round((ga / mp) * 100) / 100 : 0;

  // 6. Elo: TeamRating → NationalTeamElo fallback
  let elo = rating?.elo ?? 1500;
  if (elo === 1500 || !rating) {
    // Try national team elo
    const nat = await db.nationalTeamElo.findFirst({
      where: { countryName: { contains: team, mode: 'insensitive' } },
    });
    if (nat) elo = nat.elo;
  }

  // 7. Attack/Defense strength
  let attackStrength = rating?.attackStrength ?? null;
  let defenseWeakness = rating?.defenseWeakness ?? null;
  if ((attackStrength == null || attackStrength === 1.0) && mp > 0) {
    attackStrength = Math.round(((gf / mp) / 1.5) * 100) / 100;
  }
  if ((defenseWeakness == null || defenseWeakness === 1.0) && mp > 0) {
    defenseWeakness = Math.round(((ga / mp) / 1.5) * 100) / 100;
  }
  if (attackStrength == null) attackStrength = 1.0;
  if (defenseWeakness == null) defenseWeakness = 1.0;

  return NextResponse.json({
    team,
    elo,
    attackStrength,
    defenseWeakness,
    piHa: rating?.piHa ?? 0,
    piHd: rating?.piHd ?? 0,
    piAa: rating?.piAa ?? 0,
    piAd: rating?.piAd ?? 0,
    piMatches: rating?.piMatches ?? 0,
    matchesPlayed: mp,
    wins: w,
    draws: d,
    losses: l,
    goalsFor: gf,
    goalsAgainst: ga,
    seasonAvgGF,
    seasonAvgGA,
    last5,
    recentMatchCount: thmTotal,
  });
}
