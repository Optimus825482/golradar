// ── Admin: Historical Prediction Backfill ──────────────────────────
// Scrapes finished matches from Nesine API, generates prediction
// snapshots at ~5min intervals, and writes PredictionLog entries
// with full feature vectors for ML training.
//
// Also writes MatchEvent entries for goals (needed for labeling).
//
// POST body:
//   { daysBack: 30, maxMatches: 500 }

import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/adminRoute';
import { db } from '@/lib/db';
import {
  LIVESCORE_API,
  HEADERS,
  FINISHED_STATUSES,
  parseMatch,
  calculateGoalProbability,
  type ParsedMatch,
} from '@/lib/nesine';
import { generateSyntheticSnapshots } from '@/lib/advancedAnalytics';
import { extractFeatures, featuresToArray } from '@/lib/featureEngineering';
import { getRating, autoFetchMissingRatings } from '@/lib/eloRating';

export const dynamic = 'force-dynamic';

async function fetchFinishedMatchesForDate(date: string): Promise<ParsedMatch[]> {
  try {
    const resp = await fetch(`${LIVESCORE_API}?sportType=1&date=${date}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return [];
    const text = await resp.text();
    let data: any;
    try { data = JSON.parse(text); } catch { return []; }
    if (!Array.isArray(data)) return [];

    return data
      .filter((m: any) => FINISHED_STATUSES.has(m.S))
      .map((m: any) => parseMatch(m))
      .filter((m: ParsedMatch) => m.hasStats && m.homeGoals !== undefined);
  } catch {
    return [];
  }
}

async function processMatch(match: ParsedMatch): Promise<number> {
  const { home, away, league, code, homeGoals, awayGoals, firstHalfScore, stats } = match;

  // 1. Generate synthetic snapshots from FT stats
  const htStats = null; // We don't have HT stats from Nesine basic API
  const snapshots = generateSyntheticSnapshots(stats, htStats, homeGoals, awayGoals, firstHalfScore);

  if (snapshots.length === 0) return 0;

  // 2. Get Elo ratings
  const homeElo = getRating(home)?.rating ?? null;
  const awayElo = getRating(away)?.rating ?? null;

  // 3. Generate goal events from score
  const goalEvents: Array<{ minute: number; side: 'home' | 'away' }> = [];
  if (homeGoals > 0 || awayGoals > 0) {
    // Distribute goals roughly across the match
    for (let g = 0; g < homeGoals; g++) {
      goalEvents.push({ minute: Math.round(10 + (80 / homeGoals) * g + Math.random() * 5), side: 'home' });
    }
    for (let g = 0; g < awayGoals; g++) {
      goalEvents.push({ minute: Math.round(10 + (80 / awayGoals) * g + Math.random() * 5), side: 'away' });
    }
  }

  // 4. Write MatchEvent entries for goals (for labeling in exportTrainingData)
  for (const ge of goalEvents) {
    await db.matchEvent.create({
      data: {
        matchCode: code,
        minute: ge.minute,
        eventType: 'goal',
        side: ge.side,
      },
    }).catch(() => {}); // Ignore duplicates
  }

  // 5. Generate PredictionLog entries at ~5min intervals
  const INTERVALS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
  const predictionLogs: any[] = [];

  for (const minNum of INTERVALS) {
    // Find the closest snapshot
    const snap = snapshots.reduce((best, s) => {
      const sMin = parseInt(String(s.minute)) || 45;
      const bestMin = parseInt(String(best.minute)) || 45;
      return Math.abs(sMin - minNum) < Math.abs(bestMin - minNum) ? s : best;
    }, snapshots[0]);

    if (!snap) continue;

    const snapMinute = parseInt(String(snap.minute)) || 45;
    const minuteStr = `${minNum}'`;

    // Build pressure history from snapshots up to this minute
    const pressureHistory = snapshots
      .filter(s => (parseInt(String(s.minute)) || 45) <= minNum)
      .map(s => ({
        homePressure: s.homePressure ?? 50,
        awayPressure: s.awayPressure ?? 50,
        stats: s.stats,
        homeGoals: s.homeGoals,
        awayGoals: s.awayGoals,
      }));

    // Calculate goals at this minute (approximate)
    const goalsAtMinute = (side: 'home' | 'away') => {
      return goalEvents.filter(g => g.side === side && g.minute <= minNum).length;
    };

    try {
      // Calculate goal probability
      const prob = calculateGoalProbability(
        snap.stats,
        minuteStr,
        true,
        pressureHistory,
        goalsAtMinute('home'),
        goalsAtMinute('away'),
        home,
        away,
        undefined,
        match.leagueId,
      );

      // Extract features
      const features = await extractFeatures({
        stats: snap.stats,
        minute: minuteStr,
        isLive: true,
        homeGoals: goalsAtMinute('home'),
        awayGoals: goalsAtMinute('away'),
        homeTeam: home,
        awayTeam: away,
        pressureHistory,
        skipXtGrid: true,
      });

      const featuresArr = featuresToArray(features);

      predictionLogs.push({
        matchCode: code,
        minute: minNum,
        rawScore: prob.score,
        homeScore: prob.homeScore,
        awayScore: prob.awayScore,
        calibratedP: prob.calibratedP,
        side: prob.side ?? 'none',
        level: prob.level,
        factorsJson: JSON.stringify(prob.factors),
        homeTeam: home,
        awayTeam: away,
        league,
        homeElo: homeElo ? Math.round(homeElo) : null,
        awayElo: awayElo ? Math.round(awayElo) : null,
        poissonHomeP: null,
        poissonAwayP: null,
        modelVariant: 'historical-backfill',
        featuresJson: JSON.stringify(featuresArr),
      });
    } catch {
      // Skip this interval if feature extraction fails
    }
  }

  // 6. Batch insert PredictionLog entries
  if (predictionLogs.length > 0) {
    await db.predictionLog.createMany({
      data: predictionLogs,
      skipDuplicates: true,
    });
  }

  return predictionLogs.length;
}

export const POST = adminRoute(async (request: Request) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const daysBack = Math.min(90, Math.max(1, parseInt(body.daysBack) || 30));
  const maxMatches = Math.min(2000, Math.max(10, parseInt(body.maxMatches) || 500));

  // Build date list
  const dates: string[] = [];
  for (let d = 1; d <= daysBack; d++) {
    const date = new Date(Date.now() - d * 86_400_000);
    dates.push(date.toISOString().slice(0, 10));
  }

  let totalMatches = 0;
  let totalPredictions = 0;
  let failedDates = 0;
  const allTeams = new Set<string>();

  // First pass: collect all team names for Elo auto-fetch
  for (const date of dates) {
    const matches = await fetchFinishedMatchesForDate(date);
    for (const m of matches) {
      allTeams.add(m.home);
      allTeams.add(m.away);
    }
  }

  // Auto-fetch missing Elo ratings
  if (allTeams.size > 0) {
    await autoFetchMissingRatings([...allTeams]).catch(() => {});
  }

  // Second pass: process matches
  for (const date of dates) {
    if (totalMatches >= maxMatches) break;

    const matches = await fetchFinishedMatchesForDate(date);
    if (matches.length === 0) {
      failedDates++;
      continue;
    }

    for (const match of matches) {
      if (totalMatches >= maxMatches) break;

      try {
        const count = await processMatch(match);
        totalPredictions += count;
        totalMatches++;
      } catch {
        // Skip failed matches
      }
    }

    // Small delay between dates to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  return NextResponse.json({
    ok: true,
    summary: {
      daysBack,
      datesProcessed: dates.length,
      failedDates,
      totalMatches,
      totalPredictions,
      teamsEloFetched: allTeams.size,
    },
  });
});
