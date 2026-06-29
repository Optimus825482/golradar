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
// WORKERS env ile override (örn: WORKERS=10 bun run scripts/elo-import-all.ts)
// ClubElo API rate limit: max ~1-2 req/saniye. Varsayilan 5 worker + 1sn delay = ~5 req/s
const WORKERS = parseInt(process.env.WORKERS ?? '5', 10);

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
      // Rate limit korumasi: her istek arasi 1000ms + random 0-500ms
      // 5 worker ile = ~3-5 req/s — ClubElo API sinirina uygun
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 500));
      try {
        const result = await fetchTeamRating(team);
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
      } catch {
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
