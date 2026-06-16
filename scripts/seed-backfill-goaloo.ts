// ── Goaloo Season Backfill Seed Script ─────────────────────────────
// Fetches full season match data from football.goaloo.com and writes
// PredictionLog + MatchEvent entries for ML training.
//
// Goaloo advantage: NO 7-day limit — full seasons from 2004-2026 available.
// Data: scheduleId-based matches with momentum, events, odds, team stats.
//
// Run: npx tsx scripts/seed-backfill-goaloo.ts
//
// Options:
//   --league 34         Goaloo league ID (default: 34 = Italy Serie A)
//   --season 2025-2026  Season (default: 2025-2026)
//   --max-matches 300   Max matches to process (default: 300)
//   --workers 4          Parallel workers (default: 3)

import { PrismaClient } from "@prisma/client";
import {
  fetchGoalooSeasonMatches,
  fetchGoalooMomentum,
  fetchGoalooMatchEvents,
  type GoalooSeasonMatch,
  type MomentumData,
  type GoalooMatchEvent,
} from "../src/lib/goaloo";
import { getRating } from "../src/lib/eloRating";

// ── League config ─────────────────────────────────────────────────

const LEAGUES: Record<number, string> = {
  34: "Italy Serie A",
  36: "England Premier League",
  31: "Spain LaLiga",
  8: "Germany Bundesliga",
  11: "France Ligue 1",
  52: "Turkey Super Lig",
  103: "UEFA Champions League",
  113: "UEFA Europa League",
};

// ── Event-based snapshot converter ────────────────────────────────

interface MatchContext {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  homeScore: number;
  awayScore: number;
  momentum: MomentumData | null;
  goalEvents: { minute: number; isHome: boolean; player: string }[];
}

function momentumToSnapshots(ctx: MatchContext) {
  const intervals = [
    5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
  ];

  const homeGoalsAt = (min: number) =>
    ctx.goalEvents.filter((e) => e.isHome && e.minute <= min).length;
  const awayGoalsAt = (min: number) =>
    ctx.goalEvents.filter((e) => !e.isHome && e.minute <= min).length;

  return intervals.map((min) => {
    // Goaloo momentum: per-minute attack intensity 0-100
    // Average intensities up to this minute
    let homeSum = 0,
      awaySum = 0,
      count = 0;
    if (ctx.momentum) {
      const endIdx = Math.min(min, 90);
      for (let i = 0; i < endIdx; i++) {
        homeSum += ctx.momentum.homeIntensities[i] || 0;
        awaySum += ctx.momentum.awayIntensities[i] || 0;
        count++;
      }
    }
    const homePressure = count > 0 ? Math.round(homeSum / count) : 50;
    const awayPressure = count > 0 ? Math.round(awaySum / count) : 50;

    return {
      minute: min,
      homePressure,
      awayPressure,
      homeGoals: homeGoalsAt(min),
      awayGoals: awayGoalsAt(min),
      stats: {
        possession: { home: homePressure, away: awayPressure },
        shots_on_target: { home: 0, away: 0 },
        dangerous_attacks: { home: 0, away: 0 },
        shots_total: { home: 0, away: 0 },
        corners: { home: 0, away: 0 },
        yellow_cards: { home: 0, away: 0 },
      },
    };
  });
}

// ── Event parser ──────────────────────────────────────────────────

function parseGoalooEvents(
  events: GoalooMatchEvent[],
  homeTeam: string,
  awayTeam: string,
): { minute: number; isHome: boolean; player: string }[] {
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

    // Find which team name appears first after "Goal!"
    const homePos = afterGoal.indexOf(homeLower);
    const awayPos = afterGoal.indexOf(awayLower);

    let isHome: boolean;
    if (homePos >= 0 && (awayPos < 0 || homePos < awayPos)) {
      isHome = true;
    } else if (awayPos >= 0 && (homePos < 0 || awayPos < homePos)) {
      isHome = false;
    } else {
      // Fallback: check if scored player's team matches home
      isHome =
        detail.includes(homeLower) && !detail.includes(awayLower)
          ? true
          : detail.includes(awayLower) && !detail.includes(homeLower)
            ? false
            : true; // default home
    }

    result.push({
      minute: e.minute,
      isHome,
      player: e.player || "",
    });
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const leagueId = parseInt(
    args.find((a) => a.startsWith("--league="))?.split("=")[1] || "34",
  );
  const season =
    args.find((a) => a.startsWith("--season="))?.split("=")[1] || "2025-2026";
  const maxMatches = parseInt(
    args.find((a) => a.startsWith("--max-matches="))?.split("=")[1] || "300",
  );
  const workers = parseInt(
    args.find((a) => a.startsWith("--workers="))?.split("=")[1] || "3",
  );

  const leagueName = LEAGUES[leagueId] || `League#${leagueId}`;
  console.log(
    `[GoalooSeed] League: ${leagueName} (${leagueId}), Season: ${season}`,
  );
  console.log(`[GoalooSeed] Max matches: ${maxMatches}, Workers: ${workers}`);

  const db = new PrismaClient();

  // ── Phase 1: Fetch all season matches ──
  const seasonMatches = await fetchGoalooSeasonMatches(leagueId, season);

  // Filter: only finished matches with actual scores
  const finished = seasonMatches.filter((m) => {
    if (m.state !== -1) return false; // not finished
    const parts = m.score.split("-");
    const h = parseInt(parts[0]);
    const a = parseInt(parts[1]);
    return !isNaN(h) && !isNaN(a);
  });

  console.log(
    `[GoalooSeed] Total season matches: ${seasonMatches.length}, finished: ${finished.length}`,
  );

  // Cap
  const allMatches =
    finished.length > maxMatches ? finished.slice(0, maxMatches) : finished;

  if (allMatches.length < finished.length) {
    console.log(`[GoalooSeed] Capped to ${allMatches.length} matches`);
  }

  // Collect teams
  const allTeams = [
    ...new Set(allMatches.flatMap((m) => [m.homeTeam, m.awayTeam])),
  ];
  console.log(`[GoalooSeed] Teams: ${allTeams.length}`);

  // ── Phase 2: Process matches (parallel workers) ──
  let matchCursor = 0;
  let totalPredictions = 0;
  let processed = 0;

  async function worker(id: number) {
    const { calculateGoalProbability } = await import("../src/lib/goalRadar");
    const { extractFeatures, featuresToArray } =
      await import("../src/lib/featureEngineering");

    while (true) {
      const idx = matchCursor++;
      if (idx >= allMatches.length) break;
      const m = allMatches[idx];

      try {
        console.log(
          `[Worker ${id}] ${idx + 1}/${allMatches.length}: ${m.homeTeam} vs ${m.awayTeam} (${m.scheduleId})`,
        );

        // Fetch momentum
        const momentum = await fetchGoalooMomentum(m.scheduleId);
        if (!momentum) {
          console.log(
            `[Worker ${id}] No momentum for ${m.scheduleId}, skipping`,
          );
          continue;
        }

        // Fetch events
        const events = await fetchGoalooMatchEvents(m.scheduleId);
        const goalEvents = parseGoalooEvents(events, m.homeTeam, m.awayTeam);

        // Parse score
        const scoreParts = m.score.split("-");
        const homeScore = parseInt(scoreParts[0]) || 0;
        const awayScore = parseInt(scoreParts[1]) || 0;

        const ctx: MatchContext = {
          matchCode: m.scheduleId,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          league: leagueName,
          homeScore,
          awayScore,
          momentum,
          goalEvents,
        };

        const snapshots = momentumToSnapshots(ctx);
        if (snapshots.length === 0) continue;

        const homeElo = getRating(m.homeTeam)?.rating ?? null;
        const awayElo = getRating(m.awayTeam)?.rating ?? null;

        // Write MatchEvent entries
        for (const ge of goalEvents) {
          await db.matchEvent
            .create({
              data: {
                matchCode: m.scheduleId,
                minute: ge.minute,
                eventType: "goal",
                side: ge.isHome ? "home" : "away",
                player: ge.player || null,
              },
            })
            .catch(() => {});
        }

        // Generate PredictionLog entries
        const INTERVALS = [
          10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
        ];
        const predictionLogs: any[] = [];

        for (const minNum of INTERVALS) {
          const snap = snapshots.find((s) => s.minute === minNum);
          if (!snap) continue;

          // Find next goal after this minute for label
          const nextGoalMinute =
            goalEvents
              .map((g) => g.minute)
              .filter((t) => t > minNum)
              .sort((a, b) => a - b)[0] ?? null;

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

          const homeGoalsAtMin = snap.homeGoals;
          const awayGoalsAtMin = snap.awayGoals;

          try {
            const prob = calculateGoalProbability(
              snap.stats,
              minuteStr,
              true,
              pressureHistory,
              homeGoalsAtMin,
              awayGoalsAtMin,
              m.homeTeam,
              m.awayTeam,
            );
            const features = await extractFeatures({
              stats: snap.stats,
              minute: minuteStr,
              isLive: true,
              homeGoals: homeGoalsAtMin,
              awayGoals: awayGoalsAtMin,
              homeTeam: m.homeTeam,
              awayTeam: m.awayTeam,
              pressureHistory,
              skipXtGrid: true,
            });
            const featuresArr = featuresToArray(features);

            predictionLogs.push({
              matchCode: m.scheduleId,
              minute: minNum,
              rawScore: prob.score,
              homeScore: prob.homeScore,
              awayScore: prob.awayScore,
              calibratedP: prob.calibratedP,
              side: prob.side ?? "none",
              level: prob.level,
              factorsJson: JSON.stringify(prob.factors),
              homeTeam: m.homeTeam,
              awayTeam: m.awayTeam,
              league: leagueName,
              homeElo: homeElo ? Math.round(homeElo) : null,
              awayElo: awayElo ? Math.round(awayElo) : null,
              poissonHomeP: null,
              poissonAwayP: null,
              modelVariant: "goaloo-season",
              featuresJson: JSON.stringify(featuresArr),
              goalScored: nextGoalMinute != null,
              minutesToGoal:
                nextGoalMinute != null ? nextGoalMinute - minNum : null,
            });
          } catch {
            /* skip */
          }
        }

        if (predictionLogs.length > 0) {
          await db.predictionLog.createMany({
            data: predictionLogs,
            skipDuplicates: true,
          });
        }

        processed++;
        totalPredictions += predictionLogs.length;
        console.log(
          `[Worker ${id}] ✅ ${m.homeTeam} ${m.score} ${m.awayTeam}: ${predictionLogs.length} predictions`,
        );
      } catch (e: any) {
        console.error(
          `[Worker ${id}] ❌ ${m.homeTeam}-${m.awayTeam}: ${e.message?.substring(0, 120)}`,
        );
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  // Launch workers
  const workerPromises: Promise<void>[] = [];
  for (let i = 0; i < workers; i++) {
    workerPromises.push(worker(i + 1));
  }

  await Promise.all(workerPromises);

  // ── Summary ──
  console.log(`\n[GoalooSeed] ─── Done ───`);
  console.log(
    `[GoalooSeed] Matches processed: ${processed}/${allMatches.length}`,
  );
  console.log(`[GoalooSeed] Total predictions: ${totalPredictions}`);
  console.log(`[GoalooSeed] League: ${leagueName}, Season: ${season}`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("[GoalooSeed] Fatal:", e);
  process.exit(1);
});
