#!/usr/bin/env bun
/**
 * Dynamic Elo Import — hizini otomatik ayarlayan Elo import scripti.
 *
 * AIMD (Additive Increase / Multiplicative Decrease) mantigi:
 *   - Baslangic: 3 worker, 2000ms delay
 *   - Basarili gidiyorsa: her 50 basarida worker+1, delay-100ms (min 300ms)
 *   - Rate limit (429 / hata) yerse: delay*2, worker/2 (min 1)
 *   - En uygun hizi kendisi bulur
 *
 * Calistirma (PowerShell):
 *   bun scripts/elo-import-all.ts
 *
 * Not: Worker/delay override icin:
 *   WORKERS=10 MIN_DELAY=500 bun scripts/elo-import-all.ts
 */

import { PrismaClient } from "@prisma/client";
import { fetchTeamRating } from "../src/lib/eloFetcher";
import { bulkSetRatings } from "../src/lib/eloRating";

const db = new PrismaClient();

// ── Dynamic AIMD parameters ──
const MIN_WORKERS = 1;
const MAX_WORKERS = 50;
const INITIAL_WORKERS = 12;
const MIN_DELAY_MS = 300;     // en hizli: 300ms
const MAX_DELAY_MS = 5000;    // en yavas: 5sn
const INITIAL_DELAY_MS = 2000;
const SPEED_UP_INTERVAL = 50; // her 50 basarida hizlan
const SLOW_DOWN_THRESHOLD = 0.3; // son 20'de %30+ hata => yavasla

let currentWorkers = parseInt(process.env.WORKERS ?? String(INITIAL_WORKERS), 10);
let currentDelay = parseInt(process.env.MIN_DELAY ?? String(INITIAL_DELAY_MS), 10);
let successSinceLastAdjust = 0;

// Sliding window for rate limit detection
let recentResults: Array<"ok" | "fail"> = [];
const WINDOW_SIZE = 20;

function recordResult(r: "ok" | "fail"): void {
  recentResults.push(r);
  if (recentResults.length > WINDOW_SIZE) recentResults.shift();
}

function shouldSlowDown(): boolean {
  if (recentResults.length < WINDOW_SIZE) return false;
  const fails = recentResults.filter((r) => r === "fail").length;
  return fails / WINDOW_SIZE >= SLOW_DOWN_THRESHOLD;
}

function speedUp(): void {
  successSinceLastAdjust++;
  if (successSinceLastAdjust >= SPEED_UP_INTERVAL) {
    successSinceLastAdjust = 0;
    currentWorkers = Math.min(MAX_WORKERS, currentWorkers + 1);
    currentDelay = Math.max(MIN_DELAY_MS, currentDelay - 100);
    console.log(`[AIMD] ⬆️ Hizlandi: ${currentWorkers} worker, ${currentDelay}ms delay`);
  }
}

function slowDown(): void {
  currentWorkers = Math.max(MIN_WORKERS, Math.floor(currentWorkers / 2));
  currentDelay = Math.min(MAX_DELAY_MS, currentDelay * 2);
  successSinceLastAdjust = 0;
  recentResults = []; // window'u temizle, tekrar olcum yapsin
  console.log(`[AIMD] ⬇️ Yavasladi: ${currentWorkers} worker, ${currentDelay}ms delay`);
}

async function main() {
  console.log(`[EloImport] Fetching all teams from TeamMapping...`);
  const mappings = await db.teamMapping.findMany({
    select: { canonicalName: true },
  });
  const teams = mappings.map((m) => m.canonicalName);
  console.log(
    `[EloImport] ${teams.length} teams found. Dynamic AIMD: baslangic ${currentWorkers} worker, ${currentDelay}ms delay.`,
  );

  let cursor = 0;
  let fetched = 0;
  let failed = 0;
  const results: Array<{ team: string; rating: number; source: string }> = [];

  // Worker pool — dynamic AIMD
  async function worker(id: number) {
    while (true) {
      const idx = cursor++;
      if (idx >= teams.length) break;
      const team = teams[idx];

      // Dinamik delay (AIMD)
      await new Promise((r) => setTimeout(r, currentDelay + Math.random() * currentDelay * 0.3));

      // 3 retry with exponential backoff
      let result = null;
      for (let retry = 0; retry < 3; retry++) {
        try {
          result = await fetchTeamRating(team);
          if (result) break;
        } catch (e) {
          const backoff = 300 * Math.pow(2, retry);
          if (retry < 2) await new Promise((r) => setTimeout(r, backoff));
        }
      }

      if (result) {
        results.push({ team: result.team, rating: result.rating, source: result.source });
        fetched++;
        recordResult("ok");
        speedUp();
      } else {
        failed++;
        recordResult("fail");
      }

      // AIMD: hata orani yuksekse yavasla
      if (shouldSlowDown()) {
        slowDown();
      }

      const done = fetched + failed;
      if (done % 10 === 0 || done === teams.length) {
        const rate = done > 0 ? Math.round((fetched / done) * 100) : 0;
        console.log(
          `[EloImport][W${id}] ${done}/${teams.length} - ok:${fetched} fail:${failed} ` +
          `(%${rate}) ${currentWorkers}w/${currentDelay}ms (${team})`,
        );
      }
    }
  }

  // Dinamik worker sayisi ile baslat
  const workers = Array.from({ length: currentWorkers }, (_, i) => worker(i));
  await Promise.all(workers);

  // Save results
  if (results.length > 0) {
    bulkSetRatings(results.map((r) => ({ team: r.team, rating: r.rating })));
  }

  for (const r of results) {
    await db.teamMapping.update({
      where: { canonicalName: r.team },
      data: { eloRating: r.rating, eloSource: r.source },
    }).catch(() => {});
  }

  console.log(`[EloImport] Done!`);
  console.log(`  ✅ Fetched: ${fetched}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  📊 Total:   ${teams.length}`);
  console.log(`  ⚙️ Final:   ${currentWorkers} workers, ${currentDelay}ms delay`);

  if (results.length > 0) {
    console.log(`\n[EloImport] Sample ratings:`);
    results.slice(0, 10).forEach((r) =>
      console.log(`  ${r.team.padEnd(25)} ${r.rating} (${r.source})`),
    );
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
