// ── Admin: Bulk Enrich (Goaloo Phase 2) ──────────────────────────
// After TeamHistoryMatch is populated with Goaloo match results
// (Phase 1 via /admin/ml/data-import), this endpoint enriches each
// match with momentum + events + prediction logs for ML training.
//
// Since TeamHistoryMatch doesn't store Goaloo scheduleId, this
// endpoint re-fetches season JSON from Goaloo (same as Phase 1) and
// then enriches each finished match with detailed data.
//
// POST body:
//   {
//     "leagueIds": [34, 36],   // optional; all 166 if omitted
//     "maxMatches": 500,       // default 500, max 2000
//     "season": "2025-2026"    // optional; auto if omitted
//   }
//
// Rate: ~1 match/sec (800ms delay + HTTP calls). 500 matches ≈ 8 min.
// maxDuration=180s.

import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/adminRoute';
import { db } from '@/lib/db';
import { GOALOO_LEAGUES } from '@/lib/ml/goalooLeagues';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

interface EnrichReq {
  leagueIds?: number[];
  maxMatches?: number;
  season?: string;
}

interface LeagueResult {
  leagueId: number;
  shortName: string;
  fullName: string;
  seasonMatches: number;
  finished: number;
  enriched: number;
  errors: number;
}

export const POST = adminRoute(async (req: Request) => {
  let body: EnrichReq = {};
  try {
    body = (await req.json()) as EnrichReq;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid-body' }, { status: 400 });
  }

  const maxMatches = Math.min(body.maxMatches ?? 500, 2000);
  const now = new Date();
  const thisYear = now.getFullYear();
  const defaultSeason = now.getMonth() >= 6 ? `${thisYear}-${thisYear + 1}` : `${thisYear - 1}-${thisYear}`;
  const season = body.season ?? defaultSeason;

  // Resolve leagues
  let targetLeagues = body.leagueIds?.length
    ? GOALOO_LEAGUES.filter((l) => body.leagueIds!.includes(l.id))
    : [...GOALOO_LEAGUES];

  if (targetLeagues.length === 0) {
    return NextResponse.json({ ok: false, error: 'no-leagues', message: 'No matching leagues' }, { status: 400 });
  }

  // Dynamic imports (server-only modules)
  const { fetchGoalooSeasonMatches, fetchGoalooMomentum, fetchGoalooMatchEvents } = await import('@/lib/goaloo');
  const { calculateGoalProbability } = await import('@/lib/goalRadar');
  const { extractFeatures, featuresToArray } = await import('@/lib/featureEngineering');
  const { getRating } = await import('@/lib/eloRating');

  const results: LeagueResult[] = [];
  let totalProcessed = 0;
  let totalPredictions = 0;
  let totalEvents = 0;
  let totalErrors = 0;
  const startTime = Date.now();
  let globalDone = false;

  const logProgress = () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`[BulkEnrich] ${totalProcessed} matches, ${totalPredictions} predictions, ${totalErrors} errors (${elapsed}s)`);
  };

  for (const league of targetLeagues) {
    if (globalDone) break;

    try {
      const seasonMatches = await fetchGoalooSeasonMatches(league.id, season);
      const finished = seasonMatches.filter((m: any) => {
        if (m.state !== -1) return false;
        const parts = m.score.split('-');
        return !isNaN(parseInt(parts[0])) && !isNaN(parseInt(parts[1]));
      });

      let enriched = 0;
      let leagueErrors = 0;

      for (const m of finished) {
        if (totalProcessed >= maxMatches) {
          globalDone = true;
          break;
        }

        try {
          // Fetch momentum
          const momentum = await fetchGoalooMomentum(m.scheduleId);
          if (!momentum) { leagueErrors++; continue; }

          // Fetch events
          const events = await fetchGoalooMatchEvents(m.scheduleId);
          const goalEvents = events
            .filter((e: any) => e.type === 'goal' && e.minute)
            .map((e: any) => ({
              minute: e.minute,
              isHome: e.team === 'home',
              player: e.player || '',
            }));

          const scoreParts = m.score.split('-');
          const homeScore = parseInt(scoreParts[0]) || 0;
          const awayScore = parseInt(scoreParts[1]) || 0;

          // Write MatchEvent entries
          for (const ge of goalEvents) {
            await db.matchEvent
              .create({
                data: {
                  matchCode: m.scheduleId,
                  minute: ge.minute,
                  eventType: 'goal',
                  side: ge.isHome ? 'home' : 'away',
                  player: ge.player || null,
                },
              })
              .catch(() => {});
            totalEvents++;
          }

          // Generate PredictionLog entries
          const intervals = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
          const predLogs: any[] = [];

          for (const minNum of intervals) {
            const emptyStats = {
              possession: { home: 50, away: 50 },
              shots_on_target: { home: 0, away: 0 },
              dangerous_attacks: { home: 0, away: 0 },
              shots_total: { home: 0, away: 0 },
              corners: { home: 0, away: 0 },
              yellow_cards: { home: 0, away: 0 },
            };

            const nextGoalMinute = goalEvents
              .map((g: any) => g.minute)
              .filter((t: number) => t > minNum)
              .sort((a: number, b: number) => a - b)[0] ?? null;

            try {
              const prob = calculateGoalProbability(
                emptyStats,
                `${minNum}'`,
                true,
                [],
                homeScore,
                awayScore,
                m.homeTeam,
                m.awayTeam,
              );
              const features = await extractFeatures({
                stats: emptyStats,
                minute: `${minNum}'`,
                isLive: true,
                homeGoals: homeScore,
                awayGoals: awayScore,
                homeTeam: m.homeTeam,
                awayTeam: m.awayTeam,
                pressureHistory: [],
                skipXtGrid: true,
              });

              const homeElo = getRating(m.homeTeam)?.rating ?? null;
              const awayElo = getRating(m.awayTeam)?.rating ?? null;

              predLogs.push({
                matchCode: m.scheduleId,
                minute: minNum,
                rawScore: prob.score,
                homeScore: prob.homeScore,
                awayScore: prob.awayScore,
                calibratedP: prob.calibratedP,
                side: prob.side ?? 'none',
                level: prob.level,
                factorsJson: JSON.stringify(prob.factors),
                homeTeam: m.homeTeam,
                awayTeam: m.awayTeam,
                league: league.fullName,
                homeElo: homeElo ? Math.round(homeElo) : null,
                awayElo: awayElo ? Math.round(awayElo) : null,
                modelVariant: 'goaloo-bulk',
                featuresJson: JSON.stringify(featuresToArray(features)),
                goalScored: nextGoalMinute != null,
                minutesToGoal: nextGoalMinute != null ? nextGoalMinute - minNum : null,
              });
            } catch { /* skip interval */ }
          }

          if (predLogs.length > 0) {
            await db.predictionLog.createMany({
              data: predLogs,
              skipDuplicates: true,
            });
          }

          totalPredictions += predLogs.length;
          totalProcessed++;
          enriched++;
        } catch {
          leagueErrors++;
        }

        // Rate limit: 800ms between matches (Goaloo anti-bot)
        await new Promise((r) => setTimeout(r, 800));
      }

      results.push({
        leagueId: league.id,
        shortName: league.shortName,
        fullName: league.fullName,
        seasonMatches: seasonMatches.length,
        finished: finished.length,
        enriched,
        errors: leagueErrors,
      });

      if (totalProcessed % 100 === 0) logProgress();
    } catch {
      results.push({
        leagueId: league.id,
        shortName: league.shortName,
        fullName: league.fullName,
        seasonMatches: 0,
        finished: 0,
        enriched: 0,
        errors: 1,
      });
      totalErrors++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logProgress();

  return NextResponse.json({
    ok: true,
    season,
    leagueCount: targetLeagues.length,
    leaguesWithData: results.filter((r) => r.finished > 0).length,
    matchesProcessed: totalProcessed,
    predictionLogsCreated: totalPredictions,
    matchEventsCreated: totalEvents,
    errors: totalErrors,
    perLeague: results.slice(0, 10),
    elapsed: `${elapsed}s`,
  });
});
