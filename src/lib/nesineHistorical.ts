// ── Nesine Historical Match Backfill ─────────────────────────
// Uses Nesine's GetUnliveMatches API to fetch finished matches
// with REAL stats (possession, shots, corners, xG).
//
// API: GET /api/v2/LiveScore/GetUnliveMatches?sportType=1&date=YYYY-MM-DD
// Returns: same format as live matches with SE (stats) array
//
// Bu, Goaloo scraping'ten ÇOK DAHA iyi çünkü:
//   - Gerçek istatistikler (momentum tahmini değil)
//   - Cloudflare yok, hızlı
//   - Tüm Nesine ligleri (Avrupa + diğer kıtalar)
//   - Canlı maçlarla aynı format (kod tekrarı yok)

import { logError } from '@/lib/devLog';
import type { MatchStats } from '@/lib/nesineTypes';

const UNLIVE_API = 'https://ls.nesine.com/api/v2/LiveScore/GetUnliveMatches';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.nesine.com/',
};

export interface NesineHistoricalMatch {
  bid: number;        // match ID
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;
  homeScore: number;
  awayScore: number;
  stats: MatchStats;  // gerçek istatistikler!
  status: number;     // 5 = finished
}

/**
 * Belirli bir tarihteki bitmiş maçları getir.
 * Her maç için gerçek possession, shots, corners, xG içerir.
 */
export async function fetchHistoricalMatches(date: string): Promise<NesineHistoricalMatch[]> {
  try {
    const url = `${UNLIVE_API}?sportType=1&date=${date}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];

    const data = await res.json();
    const matches = data?.d ?? [];

    return matches
      .filter((m: any) => m.S === 5) // sadece bitmiş maçlar
      .map((m: any) => parseHistoricalMatch(m))
      .filter(Boolean) as NesineHistoricalMatch[];
  } catch (err) {
    logError('nesineHistorical', `Failed for ${date}:`, err);
    return [];
  }
}

/**
 * Bir tarih aralığındaki tüm maçları getir.
 */
export async function fetchHistoricalMatchesRange(
  startDate: string,
  endDate: string,
): Promise<NesineHistoricalMatch[]> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const allMatches: NesineHistoricalMatch[] = [];

  // Nesine API'si günde ~100 maç döndürür, rate limit yok
  // Günde 1 istek = 365 gün için 365 istek
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    const matches = await fetchHistoricalMatches(dateStr);
    allMatches.push(...matches);
    current.setDate(current.getDate() + 1);
  }

  return allMatches;
}

/**
 * Ham API yanıtını NesineHistoricalMatch'e çevir.
 * SE array'ini MatchStats formatına dönüştürür.
 */
function parseHistoricalMatch(raw: any): NesineHistoricalMatch | null {
  const bid = raw.BID || raw.C;
  if (!bid) return null;

  const homeTeam = raw.HT || '';
  const awayTeam = raw.AT || '';
  if (!homeTeam || !awayTeam) return null;

  // Skor
  const es = raw.ES?.[0] || {};
  const homeScore = es.H ?? 0;
  const awayScore = es.A ?? 0;

  // SE → MatchStats dönüşümü (ET_MAP ile aynı)
  const se = raw.SE || [];
  const stats: MatchStats = {};

  for (const s of se) {
    const et = s.ET as number;
    const h = s.H != null ? Number(s.H) : null;
    const a = s.A != null ? Number(s.A) : null;
    if (h == null || a == null) continue;

    switch (et) {
      case 1:  stats.corners = { home: h, away: a }; break;
      case 7:  stats.shots_on_target = { home: h, away: a }; break;
      case 8:  stats.dangerous_attacks = { home: h, away: a }; break;
      case 11: stats.possession = { home: h, away: a }; break;
      case 14: stats.yellow_cards = { home: h, away: a }; break;
      case 117: stats.pass_accuracy = { home: h, away: a }; break;
      case 119: stats.shots_total = { home: h, away: a }; break;
      case 120: stats.shots_blocked = { home: h, away: a }; break;
      case 121: stats.xg = { home: h, away: a }; break;
    }
  }

  return {
    bid,
    homeTeam,
    awayTeam,
    league: raw.L || '',
    date: raw.matchDate || '',
    homeScore,
    awayScore,
    stats,
    status: raw.S ?? 5,
  };
}

/**
 * Nesine historical match'leri PredictionLog tablosuna yaz.
 * Goaloo'dan gol events'lerini çekerek goalScored label'larını belirler.
 */
export async function backfillFromNesine(
  matches: NesineHistoricalMatch[],
  options: { maxMatches?: number } = {},
): Promise<{ processed: number; predictions: number }> {
  const { calculateGoalProbability } = await import('@/lib/goalRadar');
  const { extractFeatures, featuresToArray } = await import('@/lib/featureEngineering');
  const { findGoalooMatchForNesine, fetchGoalooMatchEvents } = await import('@/lib/goaloo');
  const { db } = await import('@/lib/db');

  const max = options.maxMatches ?? matches.length;
  let processed = 0;
  let predictions = 0;

  for (const match of matches) {
    if (processed >= max) break;
    processed++;

    try {
      // Goaloo mapping: Nesine match → Goaloo matchId
      const goalooMapping = await findGoalooMatchForNesine(
        match.homeTeam, match.awayTeam,
        match.date.slice(0, 10),
      );

      // Fetch goal events from Goaloo
      let goalooGoalMinutes: Array<{ minute: number; isHome: boolean }> = [];
      if (goalooMapping) {
        const events = await fetchGoalooMatchEvents(goalooMapping.goalooMatchId).catch(() => []);
        goalooGoalMinutes = events
          .filter((e: any) => e.type === 'goal' && e.minute)
          .map((e: any) => ({ minute: e.minute, isHome: e.team === 'home' }));
      }

      const intervals = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
      const predLogs: any[] = [];

      for (const minNum of intervals) {
        try {
          const prob = calculateGoalProbability(
            match.stats,
            `${minNum}'`, true, [], match.homeScore, match.awayScore,
            match.homeTeam, match.awayTeam,
          );
          const features = await extractFeatures({
            stats: match.stats,
            minute: `${minNum}'`, isLive: true,
            homeGoals: match.homeScore, awayGoals: match.awayScore,
            homeTeam: match.homeTeam, awayTeam: match.awayTeam,
            pressureHistory: [], skipXtGrid: true,
          });

          // goalScored: Goaloo'dan gelen events'e göre belirle
          const goalAfter = goalooGoalMinutes.filter(g => g.minute > minNum);
          const goalScored = goalAfter.length > 0 ? true : null;

          predLogs.push({
            matchCode: match.bid,
            minute: minNum,
            rawScore: prob.score,
            homeScore: prob.homeScore,
            awayScore: prob.awayScore,
            calibratedP: prob.calibratedP,
            side: prob.side ?? 'none',
            level: prob.level,
            factorsJson: JSON.stringify(prob.factors),
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            league: match.league,
            homeElo: null,
            awayElo: null,
            modelVariant: 'nesine-historical',
            featuresJson: JSON.stringify(featuresToArray(features)),
            goalScored,
            minutesToGoal: null,
          });
        } catch { /* skip */ }
      }

      if (predLogs.length > 0) {
        await db.predictionLog.createMany({ data: predLogs, skipDuplicates: true });
        predictions += predLogs.length;
      }
    } catch { /* skip match */ }
  }

  return { processed, predictions };
}
