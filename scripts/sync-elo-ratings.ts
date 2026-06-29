#!/usr/bin/env bun
/**
 * TeamRating Elo Senkronizasyonu
 *
 * 1. FootballdbClub'daki 3100 kulüple eslestir (fuzzy + direkt)
 * 2. Eslestirilemeyenler icin ClubElo API dene
 * 3. Hala olmayanlar icin tahmini Elo (matchHistory bazli)
 * 4. TeamRating.elo sutununu guncelle
 *
 * Kullanim:
 *   bun scripts/sync-elo-ratings.ts           # dry-run rapor
 *   bun scripts/sync-elo-ratings.ts --persist # DB'ye yaz
 */

import { db } from '../src/lib/db';
import { fetchTeamRating } from '../src/lib/eloFetcher';
import { getRating } from '../src/lib/eloRating';
import { estimateFromMatchHistory } from '../src/lib/eloFetcher';

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
    .replace(/^(fc|sc|ac|fk|ik|bk|cf|cd|ec|ca|clube|club|as|ss|us|tsv|sv|vfl|ssc|as)/, '')
    .replace(/(fc|sc|ac|fk|ik|bk|cf|cd|ec)$/, '');
}

async function run() {
  const PERSIST = process.argv.includes('--persist');

  const fdbClubs = await db.footballdbClub.findMany({
    select: { name: true, slug: true, points: true, country: true },
  });
  const teams = await db.teamRating.findMany({
    select: { teamName: true, elo: true },
  });

  console.error(`FootballdbClub: ${fdbClubs.length}`);
  console.error(`TeamRating:    ${teams.length}\n`);

  let matched = 0, clubelo = 0, estimated = 0, failed = 0;
  const updates: Array<{ teamName: string; elo: number; source: string }> = [];

  for (const t of teams) {
    const norm = normalize(t.teamName);
    let elo: number | null = null;
    let source = '';

    // 1. Footballdb match (direct + fuzzy)
    const direct = fdbClubs.find(c => normalize(c.name) === norm);
    if (direct) { elo = direct.points; source = 'footballdb'; }
    else {
      // Fuzzy Levenshtein
      let best = Infinity;
      for (const c of fdbClubs) {
        const d = levenshtein(norm, normalize(c.name));
        if (d < best && d <= 2) { best = d; elo = c.points; source = `fuzzy:${c.name}`; }
      }
    }

    // 2. ClubElo API
    if (!elo) {
      try {
        const r = await fetchTeamRating(t.teamName);
        if (r) { elo = r.rating; source = r.source; clubelo++; }
      } catch {}
    }

    // 3. Tahmini Elo
    if (!elo) {
      elo = estimateFromMatchHistory(t.teamName);
      if (elo) { source = 'estimate'; estimated++; }
    }

    if (elo) {
      matched++;
      updates.push({ teamName: t.teamName, elo, source });
    } else {
      failed++;
    }

    if (matched % 500 === 0) console.error(`  ...${matched}/${teams.length}`);
  }

  console.error(`\n✅ Matched: ${matched}`);
  console.error(`   - Footballdb: ${matched - clubelo - estimated}`);
  console.error(`   - ClubElo:    ${clubelo}`);
  console.error(`   - Estimate:   ${estimated}`);
  console.error(`❌ Failed:  ${failed}`);

  if (PERSIST) {
    console.error(`\nUpdating TeamRating.elo...`);
    let done = 0;
    for (const u of updates) {
      await db.teamRating.updateMany({
        where: { teamName: u.teamName },
        data: { elo: u.elo },
      });
      done++;
      if (done % 500 === 0) console.error(`  ${done}/${updates.length}`);
    }
    console.error(`✅ Updated ${done} teams`);
  }

  console.log(JSON.stringify({
    ok: true, total: teams.length, matched, failed,
    sources: { footballdb: matched - clubelo - estimated, clubelo, estimate: estimated },
    persisted: PERSIST,
    sample: updates.slice(0, 5),
  }));
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] :
        1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
