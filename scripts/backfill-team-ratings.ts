#!/usr/bin/env bun
/**
 * TeamRating Backfill — Tüm mevcut verilerle TeamRating tablosunu doldurur.
 *
 * Kaynak: TeamHistoryMatch tablosu (tüm oynanmış maçlar)
 * Çıktı: TeamRating tablosu (upsert, her takım için tek satır)
 *
 * Kolonlar:
 *   - elo: Elo rating (ratings.json veya hesaplanmış)
 *   - attackStrength/defenseWeakness: Kalman model α/β
 *   - wins/draws/losses, goalsFor/goalsAgainst, xgFor/xgAgainst
 *   - formJson: JSON son 10 maç ["W","D","L",...]
 *   - piHa/piHd/piAa/piAd/piMatches: Pi-Rating (Constantinou & Fenton)
 *
 * Kullanım:
 *   bun scripts/backfill-team-ratings.ts           # dry-run, sadece rapor
 *   bun scripts/backfill-team-ratings.ts --persist # DB'ye yaz
 *   bun scripts/backfill-team-ratings.ts --persist --min-matches=5
 */

import { db } from '../src/lib/db';
import {
  resetPiState,
  updatePiRating,
  exportPiState,
} from '../src/lib/piRating';
import { fitBatch } from '../src/lib/ml/teamStrengthKalman';
import type { TeamStrengthModel } from '../src/lib/ml/teamStrengthKalman';

async function run() {
  const PERSIST = process.argv.includes('--persist');
  const MIN_MATCHES = parseInt(process.argv.find(a => a.startsWith('--min-matches='))?.split('=')[1] ?? '1', 10);

  console.error('Reading TeamHistoryMatch...');
  const rows = await db.teamHistoryMatch.findMany({
    orderBy: { matchDate: 'asc' },
  });

  if (rows.length < 10) {
    console.error(JSON.stringify({ error: `Need 10+ matches, got ${rows.length}` }));
    process.exit(1);
  }
  console.error(`Read ${rows.length} historical matches.`);

  // ── Aggregate per-team stats ──
  const teamStats = new Map<string, {
    wins: number; draws: number; losses: number;
    goalsFor: number; goalsAgainst: number;
    xgFor: number; xgAgainst: number;
    matchesPlayed: number;
    formResults: string[]; // ["W","D","L",...]
    lastMatchDate: string;
  }>();

  for (const r of rows) {
    for (const side of ['home', 'away'] as const) {
      const teamName = side === 'home' ? r.homeTeam : r.awayTeam;
      if (!teamName) continue;
      let s = teamStats.get(teamName);
      if (!s) {
        s = { wins:0, draws:0, losses:0, goalsFor:0, goalsAgainst:0, xgFor:0, xgAgainst:0, matchesPlayed:0, formResults:[], lastMatchDate:'' };
        teamStats.set(teamName, s);
      }
      const gf = side === 'home' ? r.homeGoals : r.awayGoals;
      const ga = side === 'home' ? r.awayGoals : r.homeGoals;
      s.goalsFor += gf;
      s.goalsAgainst += ga;
      if (r.homeXG != null) s.xgFor += side === 'home' ? r.homeXG : (r.awayXG ?? 0);
      if (r.awayXG != null) s.xgAgainst += side === 'home' ? r.awayXG : (r.homeXG ?? 0);
      if (gf > ga) s.wins++;
      else if (gf < ga) s.losses++;
      else s.draws++;
      s.matchesPlayed++;
      const result = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      s.formResults.push(result);
      if (r.matchDate > s.lastMatchDate) s.lastMatchDate = r.matchDate;
    }
  }

  // Son 10 form sonucunu sakla
  for (const s of teamStats.values()) {
    s.formResults = s.formResults.slice(-10);
  }

  console.error(`Aggregated stats for ${teamStats.size} teams.`);

  // ── Pi-Rating sequential replay ──
  console.error('Running Pi-Rating sequential replay...');
  resetPiState();
  for (const r of rows) {
    updatePiRating(r.homeTeam, r.awayTeam, r.homeGoals, r.awayGoals);
  }
  const piState = exportPiState();
  console.error(`Pi-Rating done: ${Object.keys(piState).length} teams rated.`);

  // ── Kalman model fit (attackStrength/defenseWeakness) ──
  console.error('Fitting Kalman team-strength model...');
  const scoredMatches = rows.map(r => ({
    date: r.matchDate,
    homeTeam: r.homeTeam,
    awayTeam: r.awayTeam,
    homeGoals: r.homeGoals,
    awayGoals: r.awayGoals,
    homeXG: r.homeXG ?? undefined,
    awayXG: r.awayXG ?? undefined,
  }));
  const kalmanModel: TeamStrengthModel = fitBatch(scoredMatches, { minMatches: MIN_MATCHES });
  console.error(`Kalman done: ${Object.keys(kalmanModel.teams).length} teams.`);

  // ── Elo ratings ──
  const { getRating } = await import('../src/lib/eloRating');
  let eloFound = 0;
  for (const [teamName] of teamStats) {
    const elo = getRating(teamName);
    if (elo) eloFound++;
  }
  console.error(`Elo found for ${eloFound}/${teamStats.size} teams.`);

  // ── Sort teams by matches played (most first) ──
  const sortedTeams = [...teamStats.entries()]
    .filter(([, s]) => s.matchesPlayed >= MIN_MATCHES)
    .sort((a, b) => b[1].matchesPlayed - a[1].matchesPlayed);

  console.error(
    `Will upsert ${sortedTeams.length} teams (min ${MIN_MATCHES} matches). ` +
    `Dry-run=${!PERSIST}`,
  );

  if (!PERSIST) {
    // Dry-run: just show summary
    const top = sortedTeams.slice(0, 5);
    const sample: Record<string, unknown>[] = [];
    for (const [name, stats] of top) {
      const eloRating = getRating(name);
      const kt = kalmanModel.teams[name];
      const pr = piState[name];
      sample.push({
        teamName: name,
        matchesPlayed: stats.matchesPlayed,
        wins: stats.wins,
        elo: eloRating?.rating ?? 1500,
        kalmanAlpha: kt?.alpha ?? null,
        kalmanBeta: kt?.beta ?? null,
        piHa: pr?.Ha ?? null,
        piHd: pr?.Hd ?? null,
      });
    }
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      totalMatches: rows.length,
      totalTeams: sortedTeams.length,
      eloCoverage: `${eloFound}/${teamStats.size}`,
      kalmanTeams: Object.keys(kalmanModel.teams).length,
      piTeams: Object.keys(piState).length,
      sample,
    }));
    return;
  }

  // ── PERSIST: Upsert into TeamRating ──
  console.error('Upserting TeamRating rows...');
  let upserted = 0;
  for (const [teamName, stats] of sortedTeams) {
    const eloRating = getRating(teamName);
    const kt = kalmanModel.teams[teamName];
    const pr = piState[teamName];

    await db.teamRating.upsert({
      where: { teamName },
      create: {
        teamName,
        teamNameTr: null, // TeamMapping'te nameTr yok; ileride eklenebilir
        elo: eloRating?.rating ?? 1500,
        attackStrength: kt?.alpha ?? 1.0,
        defenseWeakness: kt?.beta ?? 1.0,
        matchesPlayed: stats.matchesPlayed,
        wins: stats.wins,
        draws: stats.draws,
        losses: stats.losses,
        goalsFor: stats.goalsFor,
        goalsAgainst: stats.goalsAgainst,
        xgFor: Math.round(stats.xgFor * 100) / 100,
        xgAgainst: Math.round(stats.xgAgainst * 100) / 100,
        formJson: JSON.stringify(stats.formResults.slice(-10)),
        piHa: pr?.Ha ?? 0,
        piHd: pr?.Hd ?? 0,
        piAa: pr?.Aa ?? 0,
        piAd: pr?.Ad ?? 0,
        piMatches: pr?.matchesHa ?? 0,
      },
      update: {
        teamNameTr: null,
        elo: eloRating?.rating ?? 1500,
        attackStrength: kt?.alpha ?? 1.0,
        defenseWeakness: kt?.beta ?? 1.0,
        matchesPlayed: stats.matchesPlayed,
        wins: stats.wins,
        draws: stats.draws,
        losses: stats.losses,
        goalsFor: stats.goalsFor,
        goalsAgainst: stats.goalsAgainst,
        xgFor: Math.round(stats.xgFor * 100) / 100,
        xgAgainst: Math.round(stats.xgAgainst * 100) / 100,
        formJson: JSON.stringify(stats.formResults.slice(-10)),
        piHa: pr?.Ha ?? 0,
        piHd: pr?.Hd ?? 0,
        piAa: pr?.Aa ?? 0,
        piAd: pr?.Ad ?? 0,
        piMatches: pr?.matchesHa ?? 0,
      },
    });
    upserted++;
    if (upserted % 100 === 0) console.error(`  ...${upserted}/${sortedTeams.length}`);
  }

  console.error(`✅ Upserted ${upserted} teams to TeamRating.`);

  console.log(JSON.stringify({
    ok: true,
    dryRun: false,
    totalMatches: rows.length,
    totalTeams: upserted,
    eloCoverage: `${eloFound}/${teamStats.size}`,
    kalmanTeams: Object.keys(kalmanModel.teams).length,
    piTeams: Object.keys(piState).length,
  }));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
