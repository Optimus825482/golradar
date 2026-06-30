// ── Upcoming Match Prediction API ──────────────────────────────
// GET /api/predict-upcoming?home=Netherlands&away=Morocco
// Elo + Pi-Rating + NationalTeamElo kullanarak mac oncesi tahmin.
// Canli istatistik olmadan calisir.

import { NextResponse } from 'next/server';
import { predictFromElo } from '@/lib/eloRating';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const home = searchParams.get('home')?.trim();
  const away = searchParams.get('away')?.trim();
  if (!home || !away) return NextResponse.json({ error: 'home and away required' }, { status: 400 });

  // 1. TeamRating'den takim guclerini al (kulup takimlari)
  const [homeRating, awayRating, homeNat, awayNat] = await Promise.all([
    db.teamRating.findFirst({ where: { teamName: { contains: home, mode: 'insensitive' } } }),
    db.teamRating.findFirst({ where: { teamName: { contains: away, mode: 'insensitive' } } }),
    db.nationalTeamElo.findFirst({ where: { countryName: { contains: home, mode: 'insensitive' } } }),
    db.nationalTeamElo.findFirst({ where: { countryName: { contains: away, mode: 'insensitive' } } }),
  ]);

  // 2. Elo: TeamRating → NationalTeamElo fallback
  const homeElo = homeRating?.elo ?? homeNat?.elo ?? 1500;
  const awayElo = awayRating?.elo ?? awayNat?.elo ?? 1500;

  // 3. predictFromElo ile kazanma olasiliklari
  const eloPred = predictFromElo(home, away);

  // 4. Atak/Defans gucleri
  const homeAtk = homeRating?.attackStrength ?? (homeNat ? 1.0 : 1.0);
  const homeDef = homeRating?.defenseWeakness ?? (homeNat ? 1.0 : 1.0);
  const awayAtk = awayRating?.attackStrength ?? (awayNat ? 1.0 : 1.0);
  const awayDef = awayRating?.defenseWeakness ?? (awayNat ? 1.0 : 1.0);

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
