// ── Sofascore Backfill Seed Script ────────────────────────────────
// Standalone script that fetches historical match data from Sofascore
// (via the Python bridge) and writes PredictionLog + MatchEvent entries
// for ML training.
//
// Run: npx tsx scripts/seed-backfill.ts
//
// Options:
//   --days 30        Number of days to go back (default: 30)
//   --max-matches 300  Maximum matches to process (default: 300)
//   --workers 4       Parallel workers (default: 4)

import { PrismaClient } from "@prisma/client";
import { execFile } from "child_process";
import { join } from "path";
import * as fs from "fs";

interface SofascoreMatch {
  game_id: number;
  home_team: string;
  away_team: string;
  tournament_name: string;
  status_type: string;
  home_score: number | null;
  away_score: number | null;
  home_score_ht: number | null;
  away_score_ht: number | null;
}

interface SofascoreIncident {
  incident_type: number;
  incident_class: string;
  time: number;
  is_home: boolean;
  player_name: string;
  home_score: number;
  away_score: number;
}

interface SofascoreStatItem {
  period: string;
  group_name: string;
  stat_name: string;
  home: number | null;
  away: number | null;
}

interface SofascoreMomentumPoint {
  minute: number;
  value: number;
}

interface SofascoreMatchDetail {
  match_info: {
    home_team: string;
    away_team: string;
    tournament_name: string;
    home_score_ht: number | null;
    away_score_ht: number | null;
    home_score_ft: number | null;
    away_score_ft: number | null;
    venue: string | null;
    referee: string | null;
  };
  incidents: SofascoreIncident[];
  statistics: SofascoreStatItem[];
  momentum: SofascoreMomentumPoint[];
  shots: any[];
}

// ── Python bridge ────────────────────────────────────────────────

function findPython(): string {
  const candidates = [
    process.env.PYTHON_PATH,
    "C:\\Python313\\python.exe",
    "C:\\Python312\\python.exe",
    "python3",
    "python",
  ].filter(Boolean) as string[];

  for (const py of candidates) {
    try {
      const r = require("child_process").execFileSync(py, ["--version"], {
        timeout: 3000,
      });
      if (r.toString().includes("Python")) return py;
    } catch {
      continue;
    }
  }
  return "python3";
}

const PYTHON = findPython();
const BRIDGE = join(process.cwd(), "scripts", "sofascore-bridge.py");

function runBridge(args: string[], timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON,
      [BRIDGE, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr.toString().substring(0, 500) || err.message));
          return;
        }
        try {
          const result = JSON.parse(stdout.toString());
          if (!result.ok)
            reject(new Error(result.error || "Bridge returned not ok"));
          else resolve(result.data);
        } catch (e: any) {
          reject(new Error("Failed to parse bridge output: " + e.message));
        }
      },
    );
  });
}

// ── Momentum → Snapshot converter ───────────────────────────────

function momentumToSnapshots(match: {
  incidents: SofascoreIncident[];
  statistics: SofascoreStatItem[];
  momentum: SofascoreMomentumPoint[];
}) {
  const statMap = new Map<string, { home: number; away: number }>();
  for (const s of match.statistics) {
    if (!statMap.has(s.stat_name)) {
      statMap.set(s.stat_name, { home: s.home ?? 0, away: s.away ?? 0 });
    }
  }

  const goalAt = (minute: number, isHome: boolean) =>
    match.incidents.filter(
      (e) => e.incident_type === 1 && e.is_home === isHome && e.time <= minute,
    ).length;

  const intervals = [
    5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
  ];
  return intervals.map((min) => {
    const mom = match.momentum
      .filter((p) => p.minute <= min)
      .sort((a, b) => b.minute - a.minute)[0];
    const baseValue = mom?.value ?? 50;
    return {
      minute: min,
      homePressure: Math.min(100, Math.max(0, baseValue)),
      awayPressure: Math.min(100, Math.max(0, 100 - baseValue)),
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
    };
  });
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const daysBack = parseInt(
    args.find((a) => a.startsWith("--days="))?.split("=")[1] || "30",
  );
  const maxMatches = parseInt(
    args.find((a) => a.startsWith("--max-matches="))?.split("=")[1] || "300",
  );
  const workers = parseInt(
    args.find((a) => a.startsWith("--workers="))?.split("=")[1] || "4",
  );

  console.log(`[Seed] Using Python: ${PYTHON}`);
  console.log(
    `[Seed] Days back: ${daysBack}, Max matches: ${maxMatches}, Workers: ${workers}`,
  );

  const db = new PrismaClient();

  // Build date list
  const dates: string[] = [];
  for (let d = 1; d <= daysBack; d++) {
    const date = new Date(Date.now() - d * 86_400_000);
    dates.push(date.toISOString().slice(0, 10));
  }
  console.log(
    `[Seed] ${dates.length} dates to scan (${dates[0]} → ${dates[dates.length - 1]})`,
  );

  // Phase 1: fetch all match lists
  let allMatches: SofascoreMatch[] = [];
  for (const date of dates) {
    try {
      const matches = (await runBridge([
        "--action",
        "matches-by-date",
        "--date",
        date,
      ])) as SofascoreMatch[];
      const finished = matches.filter(
        (m) => m.status_type === "finished" && m.home_score != null,
      );
      allMatches.push(...finished);
      console.log(
        `[Seed] ${date}: ${finished.length} finished matches (total: ${allMatches.length})`,
      );
    } catch (e: any) {
      console.error(`[Seed] ${date}: error - ${e.message.substring(0, 80)}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\n[Seed] Total finished matches found: ${allMatches.length}`);
  console.log(
    `[Seed] Teams collected: ${new Set(allMatches.flatMap((m) => [m.home_team, m.away_team])).size}`,
  );

  // Cap to max matches
  if (allMatches.length > maxMatches) {
    allMatches = allMatches.slice(0, maxMatches);
    console.log(`[Seed] Capped to ${maxMatches} matches`);
  }

  // Collect team names + auto-fetch Elo
  const allTeams = [
    ...new Set(allMatches.flatMap((m) => [m.home_team, m.away_team])),
  ];
  console.log(
    `[Seed] Teams: ${allTeams.length} (Elo previously imported — skipping auto-fetch)`,
  );

  // Phase 2: fetch details + write to DB (parallel workers)
  let matchCursor = 0;
  let totalPredictions = 0;
  let processed = 0;

  async function worker(id: number) {
    const { calculateGoalProbability } = await import("../src/lib/goalRadar");
    const { extractFeatures, featuresToArray } =
      await import("../src/lib/featureEngineering");
    const { getRating } = await import("../src/lib/eloRating");

    while (true) {
      const idx = matchCursor++;
      if (idx >= allMatches.length) break;
      const m = allMatches[idx];

      try {
        const detail = (await runBridge([
          "--action",
          "match-detail",
          "--game-id",
          String(m.game_id),
        ])) as SofascoreMatchDetail;
        if (!detail?.incidents) continue;

        const enriched = {
          matchCode: m.game_id,
          homeTeam: m.home_team,
          awayTeam: m.away_team,
          league: m.tournament_name,
          homeScore: m.home_score ?? 0,
          awayScore: m.away_score ?? 0,
          incidents: detail.incidents,
          statistics: detail.statistics,
          momentum: detail.momentum,
        };

        const snapshots = momentumToSnapshots(enriched);
        if (snapshots.length === 0) continue;

        const homeElo = getRating(m.home_team)?.rating ?? null;
        const awayElo = getRating(m.away_team)?.rating ?? null;
        const goalEvents = detail.incidents.filter(
          (e) => e.incident_type === 1,
        );

        // Write MatchEvent entries
        for (const ge of goalEvents) {
          await db.matchEvent
            .create({
              data: {
                matchCode: m.game_id,
                minute: ge.time,
                eventType: "goal",
                side: ge.is_home ? "home" : "away",
                player: ge.player_name || null,
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
              m.home_team,
              m.away_team,
            );
            const features = await extractFeatures({
              stats: snap.stats,
              minute: minuteStr,
              isLive: true,
              homeGoals: homeGoalsAtMin,
              awayGoals: awayGoalsAtMin,
              homeTeam: m.home_team,
              awayTeam: m.away_team,
              pressureHistory,
              skipXtGrid: true,
            });
            const featuresArr = featuresToArray(features);

            predictionLogs.push({
              matchCode: m.game_id,
              minute: minNum,
              rawScore: prob.score,
              homeScore: prob.homeScore,
              awayScore: prob.awayScore,
              calibratedP: prob.calibratedP,
              side: prob.side ?? "none",
              level: prob.level,
              factorsJson: JSON.stringify(prob.factors),
              homeTeam: m.home_team,
              awayTeam: m.away_team,
              league: m.tournament_name,
              homeElo: homeElo ? Math.round(homeElo) : null,
              awayElo: awayElo ? Math.round(awayElo) : null,
              poissonHomeP: null,
              poissonAwayP: null,
              modelVariant: "sofascore-seed",
              featuresJson: JSON.stringify(featuresArr),
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
          `[Worker ${id}] ${processed}/${allMatches.length} - ${m.home_team} vs ${m.away_team}: ${predictionLogs.length} predictions`,
        );
      } catch (e: any) {
        console.error(
          `[Worker ${id}] Failed ${m.home_team}-${m.away_team}: ${e.message.substring(0, 100)}`,
        );
      }
    }
  }

  console.log(
    `\n[Seed] Starting ${workers} workers for ${allMatches.length} matches...`,
  );
  const startTime = Date.now();

  await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n══════════════════════════════════════`);
  console.log(`[Seed] Done!`);
  console.log(`  ✅ Matches processed: ${processed}/${allMatches.length}`);
  console.log(`  📊 Total predictions: ${totalPredictions}`);
  console.log(`  ⏱  Time: ${elapsed}s`);
  console.log(
    `  ⚡ Avg: ${(processed / Math.max(1, parseFloat(elapsed))).toFixed(1)} matches/sec`,
  );
  console.log(`══════════════════════════════════════`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error("[Seed] Fatal:", err);
  process.exit(1);
});
