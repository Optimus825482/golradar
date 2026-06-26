// ── Comprehensive Goaloo Dataset Backfill ──────────────────────────
// Parses all 981 league codes from GOALOO_Lig_Kodlari.md and fetches
// season match data for each league into TeamHistoryMatch.
//
// Two phases:
//   Phase 1 — lightweight: fetch season match results only (fast)
//   Phase 2 — enrichment: fetch momentum + events + predictions (slow)
//
// Run:
//   npx tsx scripts/dataset-backfill-all-leagues.ts
//
// Options:
//   --phase 1           Phase to run (default: 1)
//   --seasons 3         Number of recent seasons (default: 4)
//   --concurrency 10    Max parallel league fetches (default: 10)
//   --max-leagues 10    Limit leagues for testing (default: all)
//   --league 34         Single league mode (skip markdown parse)
//   --resume            Skip leagues already in TeamHistoryMatch
//   --start-id 50       Start from this Goaloo league ID
//   --end-id 100        End at this Goaloo league ID
//
// Phase 1 rate: ~300 leagues/min
// Phase 2 rate:  ~1 match/800ms (slow — use --max-matches and --workers)

import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { setTimeout } from "node:timers/promises";

// ── CLI args ───────────────────────────────────────────────────────

function cliInt(key: string, def: number): number {
  const idx = process.argv.indexOf(`--${key}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return parseInt(process.argv[idx + 1]);
  const eq = process.argv.find((a) => a.startsWith(`--${key}=`));
  if (eq) return parseInt(eq.split("=")[1]);
  return def;
}
function cliBool(key: string): boolean {
  return process.argv.includes(`--${key}`);
}

const PHASE = cliInt("phase", 1);
const SEASONS = cliInt("seasons", 4);
const CONCURRENCY = Math.min(30, cliInt("concurrency", 10));
const MAX_LEAGUES = cliInt("max-leagues", 9999);
const SINGLE_LEAGUE = cliInt("league", 0);
const RESUME = cliBool("resume");
const START_ID = cliInt("start-id", 0);
const END_ID = cliInt("end-id", 9999);
const MAX_MATCHES_PER_LEAGUE = cliInt("max-matches", 5000);
const WORKERS = cliInt("workers", 3);

const RECENT_SEASONS = (() => {
  const thisYear = new Date().getFullYear();
  const seasons: string[] = [];
  for (let i = 0; i < SEASONS; i++) {
    const y = thisYear - 1 - i;
    seasons.push(`${y}-${y + 1}`);
  }
  return seasons;
})();

// ── Parse league codes from markdown ────────────────────────────────

interface LeagueEntry {
  id: number;
  shortName: string;
  fullName: string;
}

function parseLeagueCodes(): LeagueEntry[] {
  const mdPath = path.resolve(__dirname, "..", "docs", "GOALOO_Lig_Kodlari.md");
  if (!fs.existsSync(mdPath)) {
    console.error(`[Dataset] GOALOO_Lig_Kodlari.md not found at ${mdPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(mdPath, "utf-8");
  const lines = content.split("\n");
  const leagues: LeagueEntry[] = [];

  // Format: | nth | ID | SHORT | Full Name |
  const rowRegex = /^\|\s*\d+\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|/;

  for (const line of lines) {
    const m = line.match(rowRegex);
    if (m) {
      const id = parseInt(m[1]);
      leagues.push({ id, shortName: m[2], fullName: m[3].trim() });
    }
  }

  return leagues;
}

// ── League filter ───────────────────────────────────────────────────

function filterLeagues(leagues: LeagueEntry[]): LeagueEntry[] {
  let filtered = leagues;

  if (SINGLE_LEAGUE > 0) {
    filtered = filtered.filter((l) => l.id === SINGLE_LEAGUE);
    if (filtered.length === 0) {
      console.error(`[Dataset] League ID ${SINGLE_LEAGUE} not found in catalogue`);
      process.exit(1);
    }
    return filtered;
  }

  if (START_ID > 0 || END_ID < 9999) {
    filtered = filtered.filter((l) => l.id >= START_ID && l.id <= END_ID);
  }

  if (MAX_LEAGUES < 9999) {
    filtered = filtered.slice(0, MAX_LEAGUES);
  }

  return filtered;
}

// ── Phase 1: Bulk import season matches into TeamHistoryMatch ──────

async function phase1BulkImport(
  db: PrismaClient,
  leagues: LeagueEntry[],
): Promise<{ leaguesProcessed: number; totalMatches: number; totalInserted: number }> {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  PHASE 1 — Bulk TeamHistoryMatch Import     ║`);
  console.log(`║  Leagues: ${String(leagues.length).padStart(4)}  Seasons: ${RECENT_SEASONS.join(", ")}  ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);

  const { fetchGoalooSeasonMatches } = await import("../src/lib/goaloo");

  // --resume not supported for Phase 1 (TeamHistoryMatch lacks league ID).
  // Use output log (.dataset-backfill.log) for progress tracking.
  if (RESUME) {
    console.log("[Dataset] --resume: check .dataset-backfill.log for progress");
  }

  let totalMatches = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let processed = 0;
  let leagueCursor = 0;
  const errors: { league: LeagueEntry; season: string; error: string }[] = [];
  const outputLog: string[] = [];

  async function worker() {
    while (true) {
      const idx = leagueCursor++;
      if (idx >= leagues.length) break;
      const league = leagues[idx];

      for (const season of RECENT_SEASONS) {
        try {
          const matches = await fetchGoalooSeasonMatches(league.id, season);
          totalMatches += matches.length;

          let inserted = 0;
          let skipped = 0;

          for (const m of matches) {
            if (m.state !== -1) continue;
            const home = m.homeTeam.toLowerCase().trim().replace(/\s+/g, " ");
            const away = m.awayTeam.toLowerCase().trim().replace(/\s+/g, " ");
            if (!home || !away) continue;

            const matchDate = m.date.split(" ")[0];
            const [homeGoals, awayGoals] = m.score.split("-").map(Number);
            if (isNaN(homeGoals) || isNaN(awayGoals)) continue;

            try {
              const result = await db.teamHistoryMatch.upsert({
                where: {
                  matchDate_homeTeam_awayTeam: {
                    matchDate,
                    homeTeam: home,
                    awayTeam: away,
                  },
                },
                create: {
                  matchDate,
                  homeTeam: home,
                  awayTeam: away,
                  homeGoals,
                  awayGoals,
                  league: league.fullName,
                  source: "goaloo",
                },
                update: {
                  homeGoals,
                  awayGoals,
                  league: league.fullName,
                  fetchedAt: new Date(),
                },
              });
              if (Date.now() - result.fetchedAt.getTime() < 2_000) inserted++;
              else skipped++;
            } catch {
              skipped++;
            }
          }

          totalInserted += inserted;
          totalSkipped += skipped;

          const line = `[${league.id}] ${league.shortName} (${season}): ${matches.length} matches, ${inserted} new, ${skipped} dup`;
          outputLog.push(line);
        } catch (e: any) {
          const msg = e?.message?.substring(0, 100) || "unknown error";
          errors.push({ league, season, error: msg });
          const line = `[${league.id}] ${league.shortName} (${season}): ❌ ${msg}`;
          outputLog.push(line);
        }

        // Rate limit: 500ms between season calls per worker
        await setTimeout(200);
      }

      processed++;
      if (processed % 50 === 0 || processed === leagues.length) {
        console.log(`[Dataset] Progress: ${processed}/${leagues.length} leagues (${totalInserted} new matches)`);
      }
    }
  }

  const workers_arr: Promise<void>[] = [];
  const workerCount = Math.min(CONCURRENCY, leagues.length);
  for (let i = 0; i < workerCount; i++) {
    workers_arr.push(worker());
  }
  await Promise.all(workers_arr);

  // Write output log
  const logPath = path.resolve(__dirname, "..", ".dataset-backfill.log");
  fs.writeFileSync(logPath, outputLog.join("\n"), "utf-8");
  console.log(`\n[Dataset] Log written to ${logPath}`);

  // Summary
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  PHASE 1 COMPLETE                          ║`);
  console.log(`║  Leagues processed: ${String(processed).padStart(4)}             ║`);
  console.log(`║  Total matches:     ${String(totalMatches).padStart(6)}             ║`);
  console.log(`║  New inserts:       ${String(totalInserted).padStart(6)}             ║`);
  console.log(`║  Duplicates:        ${String(totalSkipped).padStart(6)}             ║`);
  if (errors.length > 0) {
    console.log(`║  Errors:            ${String(errors.length).padStart(6)}             ║`);
    // Show top 10 errors
    console.log(`\n  Top errors:`);
    const errorCounts = new Map<string, number>();
    for (const e of errors) {
      const key = e.error;
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    }
    const entries: [string, number][] = [];
    errorCounts.forEach((v, k) => entries.push([k, v]));
    entries.sort((a, b) => b[1] - a[1]);
    for (const [err, count] of entries.slice(0, 10)) {
      console.log(`    ${err} (${count}x)`);
    }
  }
  console.log(`╚══════════════════════════════════════════════╝\n`);

  return { leaguesProcessed: processed, totalMatches, totalInserted };
}

// ── Phase 2: Enrich with momentum/events/predictions ──────────────

async function phase2Enrich(
  db: PrismaClient,
  leagues: LeagueEntry[],
): Promise<{ matchesProcessed: number; predictionsCreated: number }> {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  PHASE 2 — Momentum/Events/Predictions     ║`);
  console.log(`║  Leagues: ${String(leagues.length).padStart(4)}                      ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);

  const { fetchGoalooSeasonMatches, fetchGoalooMomentum, fetchGoalooMatchEvents } =
    await import("../src/lib/goaloo");

  let totalProcessed = 0;
  let totalPredictions = 0;
  let leagueCursor = 0;

  // Only do the most recent season for enrichment (too slow otherwise)
  const targetSeason = RECENT_SEASONS[0];

  async function worker() {
    const { calculateGoalProbability } = await import("../src/lib/goalRadar");
    const { extractFeatures, featuresToArray } = await import("../src/lib/featureEngineering");

    while (true) {
      const idx = leagueCursor++;
      if (idx >= leagues.length) break;
      const league = leagues[idx];

      try {
        const matches = await fetchGoalooSeasonMatches(league.id, targetSeason);
        const finished = matches.filter((m: any) => {
          if (m.state !== -1) return false;
          const parts = m.score.split("-");
          return !isNaN(parseInt(parts[0])) && !isNaN(parseInt(parts[1]));
        });

        const capped = finished.length > MAX_MATCHES_PER_LEAGUE
          ? finished.slice(0, MAX_MATCHES_PER_LEAGUE)
          : finished;

        for (const m of capped) {
          try {
            // Fetch momentum
            const momentum = await fetchGoalooMomentum(m.scheduleId);
            if (!momentum) continue;

            // Fetch events
            const events = await fetchGoalooMatchEvents(m.scheduleId);
            const goalEvents = events
              .filter((e: any) => e.type === "goal" && e.minute)
              .map((e: any) => ({
                minute: e.minute,
                isHome: e.team === "home",
                player: e.player || "",
              }));

            const scoreParts = m.score.split("-");
            const homeScore = parseInt(scoreParts[0]) || 0;
            const awayScore = parseInt(scoreParts[1]) || 0;

            // Create MatchEvent entries
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
            const intervals = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
            const predictionLogs: any[] = [];

            for (const minNum of intervals) {
              try {
                const emptyStats = {
                  possession: { home: 50, away: 50 },
                  shots_on_target: { home: 0, away: 0 },
                  dangerous_attacks: { home: 0, away: 0 },
                  shots_total: { home: 0, away: 0 },
                  corners: { home: 0, away: 0 },
                  yellow_cards: { home: 0, away: 0 },
                };

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
                  league: league.fullName,
                  homeElo: null,
                  awayElo: null,
                  modelVariant: "dataset-bulk",
                  featuresJson: JSON.stringify(featuresToArray(features)),
                  goalScored: false,
                  minutesToGoal: null,
                });
              } catch {
                /* skip interval */
              }
            }

            if (predictionLogs.length > 0) {
              await db.predictionLog.createMany({
                data: predictionLogs,
                skipDuplicates: true,
              });
            }

            totalPredictions += predictionLogs.length;
            totalProcessed++;
          } catch {
            /* skip match */
          }

          await setTimeout(800); // Rate limit
        }

        console.log(`[Enrich] ✅ ${league.shortName} (${league.id}): ${capped.length} matches enriched`);
      } catch {
        console.log(`[Enrich] ❌ ${league.shortName} (${league.id}): fetch failed`);
      }
    }
  }

  const workerCount = Math.min(WORKERS, leagues.length);
  const workers_arr: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers_arr.push(worker());
  }
  await Promise.all(workers_arr);

  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  PHASE 2 COMPLETE                          ║`);
  console.log(`║  Matches enriched: ${String(totalProcessed).padStart(4)}            ║`);
  console.log(`║  Predictions created: ${String(totalPredictions).padStart(5)}        ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);

  return { matchesProcessed: totalProcessed, predictionsCreated: totalPredictions };
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log(`\n▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓`);
  console.log(`▓  GOALOO COMPREHENSIVE DATASET BACKFILL          ▓`);
  console.log(`▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓`);
  console.log(`  Phase:        ${PHASE}`);
  console.log(`  Seasons:      ${RECENT_SEASONS.join(", ")}`);
  console.log(`  Concurrency:  ${CONCURRENCY}`);
  console.log(`  Max leagues:  ${MAX_LEAGUES === 9999 ? "all" : MAX_LEAGUES}`);
  console.log(`  Range:        ${START_ID}–${END_ID > 9999 ? "∞" : END_ID}`);

  // Parse leagues
  const allLeagues = parseLeagueCodes();
  console.log(`\n[Dataset] Parsed ${allLeagues.length} league codes from GOALOO_Lig_Kodlari.md`);

  const leagues = filterLeagues(allLeagues);
  console.log(`[Dataset] Processing ${leagues.length} leagues`);

  const db = new PrismaClient();

  try {
    if (PHASE === 1) {
      await phase1BulkImport(db, leagues);
    } else if (PHASE === 2) {
      await phase2Enrich(db, leagues);
    } else {
      // Both phases
      const phase1Result = await phase1BulkImport(db, leagues);
      if (phase1Result.totalInserted > 0 || phase1Result.totalMatches > 0) {
        console.log(`\n[Dataset] Proceeding to Phase 2 enrichment...\n`);
        await phase2Enrich(db, leagues);
      }
    }
  } finally {
    await db.$disconnect();
  }

  console.log(`\n▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓`);
  console.log(`▓  DATASET BACKFILL COMPLETE                     ▓`);
  console.log(`▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓\n`);
}

main().catch((e) => {
  console.error("[Dataset] Fatal:", e);
  process.exit(1);
});
