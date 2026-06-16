// ── Admin: Historical Prediction Backfill (Sofascore-powered) ─────
// Fetches finished matches from Sofascore (via datafc bridge), uses
// real per-minute momentum, exact goal times, HT/FT scores, and full
// match statistics. Generates prediction snapshots at ~5min intervals
// and writes PredictionLog entries for ML training.
//
// POST body:
//   { daysBack: 30, maxMatches: 500 }

import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/adminRoute";
import { db } from "@/lib/db";
import {
  fetchSofascoreMatchesByDate,
  fetchSofascoreMatchDetail,
  type SofascoreMatch,
  type SofascoreIncident,
  type SofascoreMomentumPoint,
  type SofascoreStatItem,
} from "@/lib/sofascore";
import { calculateGoalProbability } from "@/lib/goalRadar";
import { extractFeatures, featuresToArray } from "@/lib/featureEngineering";
import { getRating, autoFetchMissingRatings } from "@/lib/eloRating";

export const dynamic = "force-dynamic";

// ── In-memory progress tracker ────────────────────────────────────

interface BackfillProgress {
  status: "running" | "done" | "failed";
  daysBack: number;
  maxMatches: number;
  totalDates: number;
  processedDates: number;
  failedDates: number;
  totalMatches: number;
  totalPredictions: number;
  currentDate: string;
  currentMatch: string;
  teamsCollected: number;
  progressPct: number;
  error?: string;
}

const globalForBackfill = globalThis as unknown as {
  __backfillProgress: Record<string, BackfillProgress> | undefined;
};

function getProgressStore(): Record<string, BackfillProgress> {
  if (!globalForBackfill.__backfillProgress) {
    globalForBackfill.__backfillProgress = {};
  }
  return globalForBackfill.__backfillProgress;
}

// ── Types ────────────────────────────────────────────────────────

interface EnrichedMatch {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  homeScore: number;
  awayScore: number;
  homeScoreHT: number;
  awayScoreHT: number;
  incidents: SofascoreIncident[];
  statistics: SofascoreStatItem[];
  momentum: SofascoreMomentumPoint[];
}

// ── Convert Sofascore momentum → pressure snapshot ────────────────
// Sofascore momentum: [{minute: 1, value: 47}, {minute: 2, value: 52}, ...]
// Value represents home team attack intensity (0-100).

function momentumToSnapshots(match: EnrichedMatch): Array<{
  minute: number;
  homePressure: number;
  awayPressure: number;
  homeGoals: number;
  awayGoals: number;
  stats: Record<string, { home: number; away: number }>;
}> {
  const { momentum, statistics } = match;

  // Build stats lookup per stat name
  const statMap = new Map<string, { home: number; away: number }>();
  for (const s of statistics) {
    if (!statMap.has(s.stat_name)) {
      statMap.set(s.stat_name, { home: s.home ?? 0, away: s.away ?? 0 });
    }
  }

  // Goal events with exact minutes
  const goalAt = (minute: number, isHome: boolean) =>
    match.incidents.filter(
      (e) => e.incident_type === 1 && e.is_home === isHome && e.time <= minute,
    ).length;

  const snapshots: Array<{
    minute: number;
    homePressure: number;
    awayPressure: number;
    homeGoals: number;
    awayGoals: number;
    stats: Record<string, { home: number; away: number }>;
  }> = [];

  const intervals = [
    5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
  ];
  for (const min of intervals) {
    // Find closest momentum point
    const mom = momentum
      .filter((p) => p.minute <= min)
      .sort((a, b) => b.minute - a.minute)[0];

    // Sofascore momentum value represents home attack intensity
    // Derive away pressure as inverse
    const baseValue = mom?.value ?? 50;
    const homePressure = Math.min(100, Math.max(0, baseValue));
    const awayPressure = Math.min(100, Math.max(0, 100 - baseValue));

    snapshots.push({
      minute: min,
      homePressure,
      awayPressure,
      homeGoals: goalAt(min, true),
      awayGoals: goalAt(min, false),
      stats: {
        possession: statMap.get("Ball possession") ?? { home: 50, away: 50 },
        shots_on_target: statMap.get("Shots on target") ?? { home: 0, away: 0 },
        dangerous_attacks: statMap.get("Dangerous attacks") ?? {
          home: 0,
          away: 0,
        },
        shots_total: statMap.get("Total shots") ?? { home: 0, away: 0 },
        corners: statMap.get("Corner kicks") ?? { home: 0, away: 0 },
        yellow_cards: statMap.get("Yellow cards") ?? { home: 0, away: 0 },
      },
    });
  }

  return snapshots;
}

// ── Fetch finished matches from Sofascore by date ─────────────────

async function fetchFinishedMatchesByDate(
  date: string,
): Promise<EnrichedMatch[]> {
  const matches = await fetchSofascoreMatchesByDate(date);
  if (matches.length === 0) return [];

  // Filter finished matches
  const finished = matches.filter(
    (m) =>
      m.status_type === "finished" &&
      m.home_score != null &&
      m.away_score != null,
  );

  // Fetch detail (incidents, stats, momentum) for each match — concurrency 3
  const enriched: (EnrichedMatch | null)[] = [];
  for (let i = 0; i < finished.length; i += 3) {
    const batch = finished.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(async (m) => {
        const detail = await fetchSofascoreMatchDetail(m.game_id);
        if (!detail) return null;
        return {
          matchCode: m.game_id,
          homeTeam: m.home_team,
          awayTeam: m.away_team,
          league: m.tournament_name,
          homeScore: m.home_score ?? 0,
          awayScore: m.away_score ?? 0,
          homeScoreHT: m.home_score_ht ?? 0,
          awayScoreHT: m.away_score_ht ?? 0,
          incidents: detail.incidents,
          statistics: detail.statistics,
          momentum: detail.momentum,
        } as EnrichedMatch;
      }),
    );
    enriched.push(...results);
    if (i + 3 < finished.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return enriched.filter((m): m is EnrichedMatch => m !== null);
}

async function processMatch(match: EnrichedMatch): Promise<number> {
  const { homeTeam, awayTeam, league, matchCode } = match;

  // 1. Build pressure snapshots from Sofascore's real momentum data
  const snapshots = momentumToSnapshots(match);
  if (snapshots.length === 0) return 0;

  // 2. Get Elo ratings
  const homeElo = getRating(homeTeam)?.rating ?? null;
  const awayElo = getRating(awayTeam)?.rating ?? null;

  // 3. Goal events (incident_type=1 = goal)
  const goalEvents = match.incidents.filter((e) => e.incident_type === 1);

  // 4. Write MatchEvent entries for goals
  for (const ge of goalEvents) {
    await db.matchEvent
      .create({
        data: {
          matchCode,
          minute: ge.time,
          eventType: "goal" as const,
          side: ge.is_home ? "home" : "away",
          player: ge.player_name || null,
        },
      })
      .catch(() => {});
  }

  // 5. Generate PredictionLog entries at ~5min intervals
  const INTERVALS = [
    10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
  ];
  const predictionLogs: any[] = [];

  for (const minNum of INTERVALS) {
    const snap = snapshots.find((s) => s.minute === minNum);
    if (!snap) continue;

    const minuteStr = `${minNum}'`;

    const pressureHistory = snapshots
      .filter((s) => s.minute <= minNum)
      .map((s) => ({
        homePressure: s.homePressure,
        awayPressure: s.awayPressure,
        stats: s.stats,
        homeGoals: s.homeGoals,
        awayGoals: s.awayGoals,
      }));

    const homeGoalsAtMin = goalEvents.filter(
      (e) => e.is_home && e.time <= minNum,
    ).length;
    const awayGoalsAtMin = goalEvents.filter(
      (e) => !e.is_home && e.time <= minNum,
    ).length;

    try {
      const prob = calculateGoalProbability(
        snap.stats,
        minuteStr,
        true,
        pressureHistory,
        homeGoalsAtMin,
        awayGoalsAtMin,
        homeTeam,
        awayTeam,
      );

      const features = await extractFeatures({
        stats: snap.stats,
        minute: minuteStr,
        isLive: true,
        homeGoals: homeGoalsAtMin,
        awayGoals: awayGoalsAtMin,
        homeTeam,
        awayTeam,
        pressureHistory,
        skipXtGrid: true,
      });

      const featuresArr = featuresToArray(features);

      predictionLogs.push({
        matchCode,
        minute: minNum,
        rawScore: prob.score,
        homeScore: prob.homeScore,
        awayScore: prob.awayScore,
        calibratedP: prob.calibratedP,
        side: prob.side ?? "none",
        level: prob.level,
        factorsJson: JSON.stringify(prob.factors),
        homeTeam,
        awayTeam,
        league,
        homeElo: homeElo ? Math.round(homeElo) : null,
        awayElo: awayElo ? Math.round(awayElo) : null,
        poissonHomeP: null,
        poissonAwayP: null,
        modelVariant: "historical-backfill",
        featuresJson: JSON.stringify(featuresArr),
      });
    } catch {
      // Skip
    }
  }

  // 6. Batch insert
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
  const maxMatches = Math.min(
    2000,
    Math.max(10, parseInt(body.maxMatches) || 500),
  );
  const jobId = body.jobId || crypto.randomUUID();

  const dates: string[] = [];
  for (let d = 1; d <= daysBack; d++) {
    const date = new Date(Date.now() - d * 86_400_000);
    dates.push(date.toISOString().slice(0, 10));
  }

  const progress: BackfillProgress = {
    status: "running",
    daysBack,
    maxMatches,
    totalDates: dates.length,
    processedDates: 0,
    failedDates: 0,
    totalMatches: 0,
    totalPredictions: 0,
    currentDate: "",
    currentMatch: "",
    teamsCollected: 0,
    progressPct: 0,
  };
  getProgressStore()[jobId] = progress;

  void (async () => {
    try {
      const allTeams = new Set<string>();

      // Phase 1: collect teams (they're in the match names, fast)
      for (const date of dates) {
        const matches = await fetchSofascoreMatchesByDate(date);
        for (const m of matches) {
          allTeams.add(m.home_team);
          allTeams.add(m.away_team);
        }
      }
      progress.teamsCollected = allTeams.size;

      if (allTeams.size > 0) {
        await autoFetchMissingRatings([...allTeams]).catch(() => {});
      }

      // Phase 2: parallel workers
      const BACKFILL_WORKERS = 4;
      let dateCursor = 0;
      let processedDatesCount = 0;

      const phase2Lock = new (class {
        _total = 0;
        _preds = 0;
        _failedDates = 0;
        update(date: string, match: string, mc: number, preds: number) {
          this._total += mc;
          this._preds += preds;
          progress.currentDate = date;
          progress.currentMatch = match;
          progress.totalMatches = this._total;
          progress.totalPredictions = this._preds;
          progress.failedDates = this._failedDates;
          progress.processedDates = processedDatesCount;
          progress.progressPct = Math.round(
            (processedDatesCount / dates.length) * 100,
          );
        }
      })();

      async function dateWorker() {
        while (true) {
          const idx = dateCursor++;
          if (idx >= dates.length) break;
          const date = dates[idx];

          const enriched = await fetchFinishedMatchesByDate(date);
          if (enriched.length === 0) {
            phase2Lock._failedDates++;
            processedDatesCount++;
            phase2Lock.update(date, "", 0, 0);
            continue;
          }

          for (const match of enriched) {
            if (progress.totalMatches >= progress.maxMatches) break;
            try {
              const count = await processMatch(match);
              phase2Lock.update(
                date,
                `${match.homeTeam}-${match.awayTeam}`,
                1,
                count,
              );
            } catch {
              /* skip */
            }
          }
          processedDatesCount++;
          phase2Lock.update(date, "", 0, 0);
        }
      }

      await Promise.all(
        Array.from({ length: BACKFILL_WORKERS }, () => dateWorker()),
      );

      progress.status = "done";
      progress.progressPct = 100;
    } catch (err: any) {
      progress.status = "failed";
      progress.error = err?.message || String(err);
    }
  })();

  return NextResponse.json({ ok: true, jobId, totalDates: dates.length });
});

// ── GET: poll job progress ────────────────────────────────────────

export const GET = adminRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const store = getProgressStore();
  const progress = store[jobId];
  if (!progress) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  return NextResponse.json(progress);
});
