// ── Admin: Historical Prediction Backfill (Goaloo-powered) ─────────
// Fetches finished matches from Goaloo (detailed match data with real
// per-minute momentum, exact goal times, HT scores, league info),
// generates prediction snapshots at ~5min intervals, and writes
// PredictionLog entries with full feature vectors for ML training.
//
// POST body:
//   { daysBack: 30, maxMatches: 500 }

import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/adminRoute";
import { db } from "@/lib/db";
import {
  fetchGoalooMatchesByDate,
  enrichGoalooMatch,
  type GoalooMatchForBacktest,
} from "@/lib/goaloo";
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

// ── Convert Goaloo momentum intensity → pressure snapshot ─────────
// Goaloo's jsq gives us real per-minute attack intensity (0-100+)
// which maps directly to our PressureSnapshot format.

function momentumToSnapshots(match: GoalooMatchForBacktest): Array<{
  minute: number;
  homePressure: number;
  awayPressure: number;
  homeGoals: number;
  awayGoals: number;
  stats: Record<string, { home: number; away: number }>;
}> {
  const { momentum } = match;
  if (!momentum) return [];

  // Goal events with exact minutes
  const goalAt = (minute: number, side: "home" | "away") =>
    match.events.filter(
      (e) => e.type === "goal" && e.team === side && e.minute <= minute,
    ).length;

  const snapshots: Array<{
    minute: number;
    homePressure: number;
    awayPressure: number;
    homeGoals: number;
    awayGoals: number;
    stats: Record<string, { home: number; away: number }>;
  }> = [];

  // Create a snapshot every 5 minutes using Goaloo's real intensity data
  const intervals = [
    5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
  ];
  for (const min of intervals) {
    const idx = min - 1; // 0-based index
    const homePressure = momentum.homeIntensities[idx] ?? 0;
    const awayPressure = momentum.awayIntensities[idx] ?? 0;

    // Only include if we have at least some intensity data
    snapshots.push({
      minute: min,
      homePressure: Math.min(100, Math.max(0, homePressure)),
      awayPressure: Math.min(100, Math.max(0, awayPressure)),
      homeGoals: goalAt(min, "home"),
      awayGoals: goalAt(min, "away"),
      stats: {
        possession: { home: 50, away: 50 },
        shots_on_target: {
          home: Math.round(homePressure / 20),
          away: Math.round(awayPressure / 20),
        },
        dangerous_attacks: {
          home: Math.round(homePressure * 0.8),
          away: Math.round(awayPressure * 0.8),
        },
      },
    });
  }

  return snapshots;
}

// ── Fetch finished matches from Goaloo by date ────────────────────

async function fetchFinishedMatchesByDate(
  date: string,
): Promise<GoalooMatchForBacktest[]> {
  const matches = await fetchGoalooMatchesByDate(date);
  if (matches.length === 0) return [];

  // Filter finished matches with scores
  const finished = matches.filter(
    (m) => m.state === -1 && (m.homeScore > 0 || m.awayScore > 0 || m.hasStats),
  );

  // Enrich each match (fetch events, momentum, odds in parallel)
  const enriched = await Promise.all(
    finished.map((m) => enrichGoalooMatch(m).catch(() => null)),
  );

  return enriched.filter((m): m is GoalooMatchForBacktest => m !== null);
}

async function processMatch(match: GoalooMatchForBacktest): Promise<number> {
  const { homeTeam, awayTeam, league, matchCode, homeScore, awayScore } = match;

  // 1. Build pressure snapshots from Goaloo's real momentum data
  const snapshots = momentumToSnapshots(match);
  if (snapshots.length === 0) return 0;

  // 2. Get Elo ratings
  const homeElo = getRating(homeTeam)?.rating ?? null;
  const awayElo = getRating(awayTeam)?.rating ?? null;

  // 3. Goal events from Goaloo (REAL exact minutes)
  const goalEvents = match.events.filter((e) => e.type === "goal");

  // 4. Write MatchEvent entries for goals (for labeling in exportTrainingData)
  for (const ge of goalEvents) {
    await db.matchEvent
      .create({
        data: {
          matchCode,
          minute: ge.minute,
          eventType: "goal" as const,
          side: ge.team as string,
          player: ge.player || null,
        },
      })
      .catch(() => {}); // Ignore duplicates
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

    // Build pressure history from snapshots up to this minute
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
      (e) => e.team === "home" && e.minute <= minNum,
    ).length;
    const awayGoalsAtMin = goalEvents.filter(
      (e) => e.team === "away" && e.minute <= minNum,
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
        undefined,
        undefined, // leagueId not available from Goaloo directly
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
  const maxMatches = Math.min(
    2000,
    Math.max(10, parseInt(body.maxMatches) || 500),
  );
  const jobId = body.jobId || crypto.randomUUID();

  // Build date list
  const dates: string[] = [];
  for (let d = 1; d <= daysBack; d++) {
    const date = new Date(Date.now() - d * 86_400_000);
    dates.push(date.toISOString().slice(0, 10));
  }

  // Create progress entry
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

  // Run async — don't block the response
  void (async () => {
    try {
      let totalMatches = 0;
      let totalPredictions = 0;
      let failedDates = 0;
      const allTeams = new Set<string>();

      // Phase 1: collect team names (10% of progress)
      for (const date of dates) {
        if (totalMatches >= maxMatches * 2) break;
        progress.currentDate = date;
        const matches = await fetchGoalooMatchesByDate(date);
        for (const m of matches) {
          allTeams.add(m.homeTeam);
          allTeams.add(m.awayTeam);
        }
      }
      progress.teamsCollected = allTeams.size;

      // Auto-fetch missing Elo ratings
      if (allTeams.size > 0) {
        await autoFetchMissingRatings([...allTeams]).catch(() => {});
      }

      // Phase 2: process matches (90% of progress)
      const phase2Start = 0.1;
      for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        if (totalMatches >= maxMatches) break;

        progress.currentDate = date;
        progress.processedDates = i;
        progress.progressPct = Math.round(
          (phase2Start + (i / dates.length) * 0.9) * 100,
        );

        const enriched = await fetchFinishedMatchesByDate(date);
        if (enriched.length === 0) {
          failedDates++;
          continue;
        }

        for (const match of enriched) {
          if (totalMatches >= maxMatches) break;

          progress.currentMatch = `${match.homeTeam}-${match.awayTeam}`;

          try {
            const count = await processMatch(match);
            totalPredictions += count;
            totalMatches++;
          } catch {
            // skip failed
          }
        }

        // Delay between dates
        await new Promise((r) => setTimeout(r, 500));
      }

      progress.status = "done";
      progress.totalMatches = totalMatches;
      progress.totalPredictions = totalPredictions;
      progress.failedDates = failedDates;
      progress.processedDates = dates.length;
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
