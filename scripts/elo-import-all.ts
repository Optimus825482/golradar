// ── One-time Elo Import for All TeamMapping Teams ────────────────
// Fetches Elo ratings for every team in TeamMapping from all sources
// (ClubElo → FootballDB → estimate) and writes them to the database.
// Uses 8 concurrent workers for speed.
//
// Run: npx tsx scripts/elo-import-all.ts

import { PrismaClient } from "@prisma/client";
import { fetchTeamRating } from "../src/lib/eloFetcher";
import { bulkSetRatings } from "../src/lib/eloRating";

const db = new PrismaClient();
// WORKERS env ile override (örn: WORKERS=20 bun run scripts/elo-import-all.ts)
// ClubElo API rate limit: ~1-2 req/saniye. 20 worker + 1sn delay + retry = ~20 req/s
const WORKERS = parseInt(process.env.WORKERS ?? '20', 10);

async function main() {
  console.log("[EloImport] Fetching all teams from TeamMapping...");
  const mappings = await db.teamMapping.findMany({
    select: { canonicalName: true },
  });
  const teams = mappings.map((m) => m.canonicalName);
  console.log(
    `[EloImport] ${teams.length} teams found. Starting with ${WORKERS} workers...`,
  );

  let cursor = 0;
  let fetched = 0;
  let failed = 0;
  const results: Array<{ team: string; rating: number; source: string }> = [];

  // Worker pool — each worker picks the next available team
  async function worker(id: number) {
    while (true) {
      const idx = cursor++;
      if (idx >= teams.length) break;
      const team = teams[idx];
      // Rate limit korumasi: her istek arasi 500ms + random 0-300ms
      // + 3 retry exponential backoff (notebook'daki requests_retry_session mantigi)
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));
      let result = null;
      let lastErr: unknown = null;
      for (let retry = 0; retry < 3; retry++) {
        try {
          result = await fetchTeamRating(team);
          if (result) break;
        } catch (e) {
          lastErr = e;
          // Exponential backoff: 0.3 * 2^retry saniye (notebook backoff_factor=0.3)
          const backoff = 300 * Math.pow(2, retry);
          if (retry < 2) await new Promise((r) => setTimeout(r, backoff));
        }
      }
      if (result) {
        results.push({
          team: result.team,
          rating: result.rating,
          source: result.source,
        });
        fetched++;
      } else {
        failed++;
      }
      const done = fetched + failed;
      if (done % 10 === 0 || done === teams.length) {
        console.log(
          `[EloImport][W${id}] ${done}/${teams.length} - ok:${fetched} fail:${failed} (${team})`,
        );
      }
    }
  }

  // Launch all workers in parallel
  const workers = Array.from({ length: WORKERS }, (_, i) => worker(i));
  await Promise.all(workers);

  // Save to in-memory Elo ratings
  if (results.length > 0) {
    bulkSetRatings(results.map((r) => ({ team: r.team, rating: r.rating })));
  }

  // Write to TeamMapping
  for (const r of results) {
    await db.teamMapping
      .update({
        where: { canonicalName: r.team },
        data: { eloRating: r.rating, eloSource: r.source },
      })
      .catch((e) => { console.error('[elo-import-all] updateTeamMapping error:', e); });
  }

  console.log(`[EloImport] Done!`);
  console.log(`  ✅ Fetched: ${fetched}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  📊 Total:   ${teams.length}`);

  if (results.length > 0) {
    console.log(`\n[EloImport] Sample ratings:`);
    results.slice(0, 10).forEach((r) => {
      console.log(`  ${r.team.padEnd(20)} ${r.rating} (${r.source})`);
    });
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error("[EloImport] Fatal:", err);
  process.exit(1);
});
