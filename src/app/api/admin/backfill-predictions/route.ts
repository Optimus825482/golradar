// ── Admin: Goaloo Season Backfill ──────────────────────────────────
// Fetches full-season historical matches from football.goaloo.com,
// uses real per-minute momentum & goal events from the Goaloo API.
// Generates prediction snapshots at ~5min intervals and writes
// PredictionLog + MatchEvent entries for ML training.
//
// POST body: { league: 34, season: "2025-2026", maxMatches: 500 }

import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/adminRoute";
import { db } from "@/lib/db";
import { calculateGoalProbability } from "@/lib/goalRadar";
import { extractFeatures, featuresToArray } from "@/lib/featureEngineering";
import { getRating } from "@/lib/eloRating";
import type { MomentumData, GoalooSeasonMatch, GoalooMatchEvent } from "@/lib/goaloo";

export const dynamic = "force-dynamic";

// ── In-memory progress tracker ────────────────────────────────────

interface BackfillProgress {
  status: "running" | "done" | "failed";
  league: number;
  season: string;
  maxMatches: number;
  totalMatches: number;
  totalPredictions: number;
  processedMatches: number;
  currentMatch: string;
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

// ── Convert Goaloo momentum (per-minute intensity 0-100) → snapshot ─

function momentumToSnapshots(
  momentum: MomentumData,
  goalEvents: { minute: number; isHome: boolean }[],
): Array<{
  minute: number; homePressure: number; awayPressure: number;
  homeGoals: number; awayGoals: number;
  stats: Record<string, { home: number; away: number }>;
}> {
  const intervals = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];

  const homeGoalsAt = (m: number) => goalEvents.filter(e => e.isHome && e.minute <= m).length;
  const awayGoalsAt = (m: number) => goalEvents.filter(e => !e.isHome && e.minute <= m).length;

  return intervals.map(min => {
    let hSum = 0, aSum = 0, cnt = 0;
    for (let i = 0; i < Math.min(min, 90); i++) {
      hSum += momentum.homeIntensities[i] || 0;
      aSum += momentum.awayIntensities[i] || 0;
      cnt++;
    }
    return {
      minute: min,
      homePressure: cnt > 0 ? Math.round(hSum / cnt) : 50,
      awayPressure: cnt > 0 ? Math.round(aSum / cnt) : 50,
      homeGoals: homeGoalsAt(min),
      awayGoals: awayGoalsAt(min),
      stats: {
        possession: { home: cnt > 0 ? Math.round(hSum / cnt) : 50, away: cnt > 0 ? Math.round(aSum / cnt) : 50 },
        shots_on_target: { home: 0, away: 0 },
        dangerous_attacks: { home: 0, away: 0 },
        shots_total: { home: 0, away: 0 },
        corners: { home: 0, away: 0 },
        yellow_cards: { home: 0, away: 0 },
      },
    };
  });
}

// ── Parse goal events from Goaloo detail text ────────────────────

function parseGoalEvents(events: GoalooMatchEvent[], homeTeam: string, awayTeam: string) {
  const result: { minute: number; isHome: boolean; player: string }[] = [];
  for (const e of events) {
    if (e.type !== "goal" || !e.minute) continue;
    // Goaloo format: "18' Goal! Inter Milan 1, Torino 0. Player (Team)"
    // BOTH team names appear. First team after "Goal!" = scoring team.
    const detail = e.detail.toLowerCase();
    const goalIdx = detail.indexOf("goal");
    const afterGoal = goalIdx >= 0 ? detail.substring(goalIdx + 4) : detail;
    const homeLower = homeTeam.toLowerCase();
    const awayLower = awayTeam.toLowerCase();
    const homePos = afterGoal.indexOf(homeLower);
    const awayPos = afterGoal.indexOf(awayLower);
    let isHome: boolean;
    if (homePos >= 0 && (awayPos < 0 || homePos < awayPos)) {
      isHome = true;
    } else if (awayPos >= 0 && (homePos < 0 || awayPos < homePos)) {
      isHome = false;
    } else {
      isHome = true; // default
    }
    result.push({ minute: e.minute, isHome, player: e.player || "" });
  }
  return result;
}

// ── Process a single match ────────────────────────────────────────

async function processMatch(m: GoalooSeasonMatch, leagueName: string): Promise<number> {
  const matchCode = m.scheduleId;
  const homeTeam = m.homeTeam;
  const awayTeam = m.awayTeam;

	  // Fetch momentum & events from Goaloo AJAX endpoints
	  const goaloo = await import('@/lib/goaloo');
	  const momentum = await goaloo.fetchGoalooMomentum(matchCode);
  if (!momentum) return 0;

	  const events = await goaloo.fetchGoalooMatchEvents(matchCode);
  const goalEvents = parseGoalEvents(events, homeTeam, awayTeam);

  // Build snapshots
  const snapshots = momentumToSnapshots(momentum, goalEvents);
  if (snapshots.length === 0) return 0;

  // Elo
  const homeElo = getRating(homeTeam)?.rating ?? null;
  const awayElo = getRating(awayTeam)?.rating ?? null;

  // Write goal events
  for (const ge of goalEvents) {
    await db.matchEvent.create({
      data: {
        matchCode, minute: ge.minute, eventType: "goal",
        side: ge.isHome ? "home" : "away", player: ge.player || null,
      },
    }).catch((e) => { console.error('[backfill-predictions] matchEvent create error:', e); });
  }

  // Generate predictions at intervals
  const INTERVALS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
  const predictionLogs: any[] = [];

  for (const minNum of INTERVALS) {
    const snap = snapshots.find(s => s.minute === minNum);
    if (!snap) continue;

    const homeGoalsAtMin = snap.homeGoals;
    const awayGoalsAtMin = snap.awayGoals;
    const pressureHistory = snapshots
      .filter(s => s.minute <= minNum)
      .map(s => ({ homePressure: s.homePressure, awayPressure: s.awayPressure, stats: s.stats, homeGoals: s.homeGoals, awayGoals: s.awayGoals }));

    try {
      const prob = calculateGoalProbability(snap.stats, `${minNum}'`, true, pressureHistory, homeGoalsAtMin, awayGoalsAtMin, homeTeam, awayTeam);
      const features = await extractFeatures({ stats: snap.stats, minute: `${minNum}'`, isLive: true, homeGoals: homeGoalsAtMin, awayGoals: awayGoalsAtMin, homeTeam, awayTeam, pressureHistory, skipXtGrid: true });
      const featuresArr = featuresToArray(features);

      const nextGoalMinute = goalEvents.map(g => g.minute).filter(t => t > minNum).sort((a, b) => a - b)[0] ?? null;

      predictionLogs.push({
        matchCode, minute: minNum,
        rawScore: prob.score, homeScore: prob.homeScore, awayScore: prob.awayScore,
        calibratedP: prob.calibratedP, side: prob.side ?? "none", level: prob.level,
        factorsJson: JSON.stringify(prob.factors),
        homeTeam, awayTeam, league: leagueName,
        homeElo: homeElo ? Math.round(homeElo) : null,
        awayElo: awayElo ? Math.round(awayElo) : null,
        poissonHomeP: null, poissonAwayP: null,
        modelVariant: "goaloo-season",
        featuresJson: JSON.stringify(featuresArr),
        goalScored: nextGoalMinute ? true : false,
        minutesToGoal: nextGoalMinute ? nextGoalMinute - minNum : null,
      });
    } catch { /* skip */ }
  }

  if (predictionLogs.length > 0) {
    await db.predictionLog.createMany({ data: predictionLogs, skipDuplicates: true });
  }
  return predictionLogs.length;
}

// ── POST: Kick off backfill ───────────────────────────────────────

export const POST = adminRoute(async (request: Request) => {
  let body: any;
  try { body = await request.json(); } catch { body = {}; }

  const league = parseInt(body.league) || 34;
  const season = body.season || "2025-2026";
  const maxMatches = Math.min(2000, Math.max(10, parseInt(body.maxMatches) || 500));
  const jobId = body.jobId || crypto.randomUUID();

  const LEAGUE_NAMES: Record<number, string> = {
    34: "Italy Serie A", 36: "England Premier League", 31: "Spain LaLiga",
    8: "Germany Bundesliga", 11: "France Ligue 1", 52: "Turkey Super Lig",
  };

  const progress: BackfillProgress = {
    status: "running", league, season, maxMatches,
    totalMatches: 0, totalPredictions: 0, processedMatches: 0,
    currentMatch: "", progressPct: 0,
  };
  getProgressStore()[jobId] = progress;

  void (async () => {
    try {
	      const goaloo = await import('@/lib/goaloo');
	      const matches = await goaloo.fetchGoalooSeasonMatches(league, season);
      progress.totalMatches = Math.min(matches.length, maxMatches);

      let processed = 0, totalPreds = 0;
      for (const m of matches) {
        if (processed >= maxMatches) break;
        try {
          progress.currentMatch = `${m.homeTeam} vs ${m.awayTeam}`;
          const leagueName = LEAGUE_NAMES[league] || `League#${league}`;
          const preds = await processMatch(m, leagueName);
          totalPreds += preds;
          processed++;
          progress.processedMatches = processed;
          progress.totalPredictions = totalPreds;
          progress.progressPct = Math.round((processed / progress.totalMatches) * 100);
        } catch { /* skip */ }
        await new Promise(r => setTimeout(r, 600));
      }

      progress.status = "done";
      progress.progressPct = 100;
    } catch (err: any) {
      progress.status = "failed";
      progress.error = err?.message || String(err);
    }
  })();

  return NextResponse.json({ ok: true, jobId, totalMatches: 0 });
});

// ── GET: Poll job progress ────────────────────────────────────────

export const GET = adminRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const store = getProgressStore();
  const progress = store[jobId];
  if (!progress) return NextResponse.json({ error: "job not found" }, { status: 404 });

  return NextResponse.json(progress);
});
