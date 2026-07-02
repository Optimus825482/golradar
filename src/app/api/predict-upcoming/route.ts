// ── Upcoming Match Prediction API ──────────────────────────────
// GET /api/predict-upcoming?home=Netherlands&away=Morocco
// Elo + Pi-Rating + NationalTeamElo kullanarak mac oncesi tahmin.
// Canli istatistik olmadan calisir.

import { NextResponse } from 'next/server';
import { predictFromElo } from '@/lib/eloRating';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Elo -> relative strength. 1500 = 1.0, +/-100 = +/-0.1 */
function eloToStrength(elo: number): number {
  return Math.round((0.5 + (elo - 1500) / 1000) * 100) / 100;
}

async function findTeamRating(teamName: string) {
  // Try exact match first, then teamNameTr, then fallback
  const exact = await db.teamRating.findFirst({ where: { teamName: { equals: teamName, mode: 'insensitive' } } });
  if (exact) return exact;
  const byTr = await db.teamRating.findFirst({ where: { teamNameTr: { equals: teamName, mode: 'insensitive' } } });
  if (byTr) return byTr;
  // Last resort: try contains (for partial club names)
  return db.teamRating.findFirst({ where: { teamName: { contains: teamName, mode: 'insensitive' } } });
}

async function findNationalElo(teamName: string) {
  const exact = await db.nationalTeamElo.findFirst({ where: { countryName: { equals: teamName, mode: 'insensitive' } } });
  if (exact) return exact;
  return db.nationalTeamElo.findFirst({ where: { countryName: { contains: teamName, mode: 'insensitive' } } });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const home = searchParams.get('home')?.trim();
  const away = searchParams.get('away')?.trim();
  if (!home || !away) return NextResponse.json({ error: 'home and away required' }, { status: 400 });

  // 1. TeamRating + NationalTeamElo + TeamHistoryMatch — try exact match first
  const [homeRating, awayRating, homeNat, awayNat, homeMatches, awayMatches] = await Promise.all([
    findTeamRating(home),
    findTeamRating(away),
    findNationalElo(home),
    findNationalElo(away),
    db.teamHistoryMatch.findMany({
      where: { OR: [{ homeTeam: { contains: home, mode: 'insensitive' } }, { awayTeam: { contains: home, mode: 'insensitive' } }] },
      orderBy: { matchDate: 'desc' }, take: 30,
    }),
    db.teamHistoryMatch.findMany({
      where: { OR: [{ homeTeam: { contains: away, mode: 'insensitive' } }, { awayTeam: { contains: away, mode: 'insensitive' } }] },
      orderBy: { matchDate: 'desc' }, take: 30,
    }),
  ]);

  // 2. Elo: TeamRating → NationalTeamElo → predictFromElo → fallback
  const eloPred = predictFromElo(home, away);
  const predHomeElo = eloPred.homeRating;
  const predAwayElo = eloPred.awayRating;
  const homeElo = homeRating?.elo ?? homeNat?.elo ?? predHomeElo;
  const awayElo = awayRating?.elo ?? awayNat?.elo ?? predAwayElo;

  // 3. Atak/Defans: DB → TeamHistoryMatch goals → elo-based fallback
  function computeStrength(team: string, rating: any, matches: any[], isAttack: boolean, elo: number): number {
    if (isAttack && rating?.attackStrength != null && rating.attackStrength !== 1.0) return rating.attackStrength;
    if (!isAttack && rating?.defenseWeakness != null && rating.defenseWeakness !== 1.0) return rating.defenseWeakness;
    // Derive from match history goals
    if (matches.length > 0) {
      let totalGf = 0, totalGa = 0, count = 0;
      for (const m of matches) {
        const isHome = m.homeTeam.toLowerCase() === team.toLowerCase();
        totalGf += isHome ? m.homeGoals : m.awayGoals;
        totalGa += isHome ? m.awayGoals : m.homeGoals;
        count++;
      }
      const avgGf = totalGf / count;
      const avgGa = totalGa / count;
      if (isAttack) return Math.round((avgGf / 1.5) * 100) / 100;
      else return Math.round((avgGa / 1.5) * 100) / 100;
    }
    return eloToStrength(elo);
  }
  const homeAtk = computeStrength(home, homeRating, homeMatches, true, predHomeElo);
  const homeDef = computeStrength(home, homeRating, homeMatches, false, predHomeElo);
  const awayAtk = computeStrength(away, awayRating, awayMatches, true, predAwayElo);
  const awayDef = computeStrength(away, awayRating, awayMatches, false, predAwayElo);

  // 5. Expected goals (Poisson)
  const lambdaHome = (homeAtk + awayDef) / 2 * 1.2; // ev avantaji
  const lambdaAway = (awayAtk + homeDef) / 2;

  // 6. Mac skoru tahmini (en olasi skor)
  function poissonPmf(lambda: number, k: number): number {
    let fact = 1;
    for (let i = 2; i <= k; i++) fact *= i;
    return Math.pow(lambda, k) * Math.exp(-lambda) / fact;
  }

  // En olasi skorlari bul
  const scores: Array<{ home: number; away: number; prob: number }> = [];
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      scores.push({ home: h, away: a, prob: poissonPmf(lambdaHome, h) * poissonPmf(lambdaAway, a) });
    }
  }
  scores.sort((a, b) => b.prob - a.prob);
  const topScores = scores.slice(0, 5);
  const mostLikely = topScores[0];

  // 7. O2.5 ve BTTS
  let over25 = 0, btts = 0;
  for (const s of scores) {
    if (s.home + s.away > 2.5) over25 += s.prob;
    if (s.home > 0 && s.away > 0) btts += s.prob;
  }

  // 8. Win/draw/any goal
  let homeWin = 0, draw = 0, awayWin = 0, anyGoal = 0;
  for (const s of scores) {
    if (s.home > s.away) homeWin += s.prob;
    else if (s.home === s.away) draw += s.prob;
    else awayWin += s.prob;
    if (s.home > 0 || s.away > 0) anyGoal += s.prob;
  }

  return NextResponse.json({
    home, away,
    homeElo, awayElo,
    eloPrediction: {
      homeWinP: eloPred.homeWinP,
      drawP: eloPred.drawP,
      awayWinP: eloPred.awayWinP,
    },
    poissonPrediction: {
      lambdaHome: Math.round(lambdaHome * 100) / 100,
      lambdaAway: Math.round(lambdaAway * 100) / 100,
      homeWinP: Math.round(homeWin * 1000) / 1000,
      drawP: Math.round(draw * 1000) / 1000,
      awayWinP: Math.round(awayWin * 1000) / 1000,
      over25: Math.round(over25 * 1000) / 1000,
      btts: Math.round(btts * 1000) / 1000,
      anyGoal: Math.round(anyGoal * 1000) / 1000,
    },
    mostLikelyScore: `${mostLikely.home}-${mostLikely.away}`,
    topScores: topScores.map(s => ({
      score: `${s.home}-${s.away}`,
      prob: Math.round(s.prob * 1000) / 1000,
    })),
    teamStrengths: {
      homeAttack: homeAtk,
      homeDefense: homeDef,
      awayAttack: awayAtk,
      awayDefense: awayDef,
    },
  });
}
