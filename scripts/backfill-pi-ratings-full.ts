#!/usr/bin/env bun
/**
 * Pi-Rating Backfill — TÜM season verisinden (teamHistoryMatch)
 *
 * `teamHistoryMatch` tablosundaki tüm maçları kullanarak Pi-Rating
 * hesaplar. Bu tablo tüm oynanmış maçları içerir, MatchSnapshot
 * gibi canlı kısıtlaması yoktur.
 *
 * Kullanım:
 *   bun scripts/backfill-pi-ratings-full.ts --season=2026
 *   bun scripts/backfill-pi-ratings-full.ts --persist
 */

import { db } from '../src/lib/db';
import {
  resetPiState,
  updatePiRating,
  predictPiFromRating,
} from '../src/lib/piRating';
import { setMeasuredBrier } from '../src/lib/ml/brierCache';

async function run() {
  const PERSIST = process.argv.includes('--persist');

  console.error('Reading all TeamHistoryMatch rows...');
  const rows = await db.teamHistoryMatch.findMany({
    orderBy: { matchDate: 'asc' },
  });

  if (rows.length < 30) {
    console.error(JSON.stringify({ error: `Need 30+ matches, got ${rows.length}` }));
    process.exit(1);
  }

  console.error(`Read ${rows.length} historical matches.`);

  // Split 80/20
  const split = Math.floor(rows.length * 0.8);
  const train = rows.slice(0, split);
  const evalAll = rows;

  // Train Pi-Rating on ALL historical matches
  resetPiState();
  for (const r of train) {
    updatePiRating(r.homeTeam, r.awayTeam, r.homeGoals, r.awayGoals);
  }
  const teams = new Set<string>();
  for (const r of rows) {
    teams.add(r.homeTeam);
    teams.add(r.awayTeam);
  }

  console.error(`Trained on ${train.length} matches, ${teams.size} teams`);

  // Eval
  let brierPi = 0, brierElo = 0, total = 0;
  for (const r of evalAll) {
    const o = (r.homeGoals > 0 || r.awayGoals > 0) ? 1 : 0;
    const pred = predictPiFromRating(r.homeTeam, r.awayTeam);
    const piP = Math.max(0.01, Math.min(0.99, pred.homeWinP + 0.5 * pred.drawP));
    brierPi += (piP - o) ** 2;
    brierElo += (0.5 - o) ** 2; // baseline
    total++;
  }

  const piBrier = total > 0 ? brierPi / total : 0;
  const eloBrier = total > 0 ? brierElo / total : 0;

  console.error(`Eval: ${total} matches. piBrier=${piBrier.toFixed(4)} eloBrier=${eloBrier.toFixed(4)} teams=${teams.size}`);

  if (PERSIST) {
    await setMeasuredBrier('pi', piBrier, total);
    console.error('Persisted pi Brier to SystemConfig');
  }

  console.log(JSON.stringify({
    ok: true,
    totalMatches: rows.length,
    teamsTrained: teams.size,
    piBrier: Math.round(piBrier * 10000) / 10000,
    eloBrier: Math.round(eloBrier * 10000) / 10000,
    persisted: PERSIST,
  }));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
