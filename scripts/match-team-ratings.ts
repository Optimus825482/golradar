#!/usr/bin/env bun
/**
 * TeamRating vs FootballdbClub eslestirme.
 *
 * TeamRating'deki 5697 takimi FootballdbClub'daki 3060 kulüple
 * eslestirir. Eslestirilemeyen takimlari listeler.
 *
 * Eslestirme: teamName kucuk harf, tire/noktalama ignor.
 * Ikinci asamada fuzzy match (Levenshtein) dener.
 *
 * Kullanim:
 *   bun scripts/match-team-ratings.ts
 */

import { db } from '../src/lib/db';

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // sadece harf+rakam
    .replace(/^(fc|sc|ac|fk|ik|bk|cf|cd|ec|ca|clube|club|as|ss|us|tsv|sv|vfl)/, '')
    .replace(/(fc|sc|ac|fk|ik|bk|cf|cd)$/, '');
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] :
        1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

async function run() {
  // FootballdbClub'daki tum slug+name+points
  const fdbClubs = await db.footballdbClub.findMany({
    select: { name: true, slug: true, points: true, country: true },
  });
  const fdbSet = new Set(fdbClubs.map(c => normalize(c.name)));

  // TeamRating'deki tum teamName
  const teams = await db.teamRating.findMany({
    select: { teamName: true },
  });

  console.error(`FootballdbClub: ${fdbClubs.length} clubs`);
  console.error(`TeamRating:   ${teams.length} teams`);

  // Eslestirme
  const matched: Array<{ team: string; fdbName: string; slug: string; points: number }> = [];
  const unmatched: Array<{ team: string; best?: { name: string; slug: string; score: number } }> = [];

  for (const t of teams) {
    const norm = normalize(t.teamName);
    // 1. Direkt normalize eslesme
    const direct = fdbClubs.find(c => normalize(c.name) === norm);
    if (direct) {
      matched.push({ team: t.teamName, fdbName: direct.name, slug: direct.slug, points: direct.points });
      continue;
    }

    // 2. Fuzzy: Levenshtein distance
    let bestScore = Infinity;
    let bestClub: typeof fdbClubs[0] | null = null;
    for (const c of fdbClubs) {
      const score = levenshtein(norm, normalize(c.name));
      if (score < bestScore && score <= 3) { // max 3 harf fark
        bestScore = score;
        bestClub = c;
      }
    }
    if (bestClub) {
      matched.push({ team: t.teamName, fdbName: bestClub.name, slug: bestClub.slug, points: bestClub.points });
    } else {
      unmatched.push({ team: t.teamName, best: bestClub ? { name: bestClub.name, slug: bestClub.slug, score: bestScore } : undefined });
    }
  }

  console.error(`\n✅ Matched: ${matched.length}/${teams.length}`);
  console.error(`❌ Unmatched: ${unmatched.length}/${teams.length}`);

  // Rapor
  const out = {
    totalTeams: teams.length,
    totalFdbClubs: fdbClubs.length,
    matched: matched.length,
    unmatched: unmatched.length,
    matchedRate: Math.round((matched.length / teams.length) * 1000) / 10 + '%',
    sampleMatched: matched.slice(0, 10),
    sampleUnmatched: unmatched.slice(0, 20),
  };

  console.log(JSON.stringify(out, null, 2));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
