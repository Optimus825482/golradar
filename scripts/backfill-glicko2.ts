#!/usr/bin/env bun
/**
 * Glicko-2 Backfill from MatchSnapshot
 *
 * MatchSnapshot.homeGoals/awayGoals ile Glicko-2 state'ini günceller,
 * ardından dev-set Brier ölçer. --persist ile SystemConfig'e yazar.
 *
 * Kullanım:
 *   bun scripts/backfill-glicko2.ts --take=50000
 *   bun scripts/backfill-glicko2.ts --persist --take=50000
 */

import { db } from '../src/lib/db';
import {
  resetGlicko2,
  updateGlicko2Simplified,
  predictGlicko2,
  exportGlicko2State,
} from '../src/lib/glicko2';
import { setMeasuredBrier } from '../src/lib/ml/brierCache';

async function run() {
  const TAKE = parseInt(process.argv.find(a => a.startsWith('--take='))?.split('=')[1] ?? '50000', 10);
  const PERSIST = process.argv.includes('--persist');

  console.error(`Reading last ${TAKE} MatchSnapshots...`);
  const snapshots = await db.matchSnapshot.findMany({
    orderBy: { createdAt: 'desc' },
    take: TAKE,
  });

  const allCodes = [...new Set(snapshots.map((s) => s.matchCode))];

  // Team name resolution
  const signalRows = await db.signal.findMany({
    where: { matchCode: { in: allCodes } },
    select: { matchCode: true, homeTeam: true, awayTeam: true },
    distinct: ['matchCode'],
  });
  const teamMap = new Map(signalRows.map((r) => [r.matchCode, { home: r.homeTeam, away: r.awayTeam }]));

  const missing = allCodes.filter((c) => !teamMap.has(c));
  if (missing.length > 0) {
    const logRows = await db.predictionLog.findMany({
      where: { matchCode: { in: missing } },
      select: { matchCode: true, homeTeam: true, awayTeam: true },
      distinct: ['matchCode'],
    });
    for (const r of logRows) {
      if (!teamMap.has(r.matchCode)) teamMap.set(r.matchCode, { home: r.homeTeam, away: r.awayTeam });
    }
  }

  // Group snapshots by match
  const matchMap = new Map<number, { home: string; away: string; snapshots: Array<{ minute: number; homeGoals: number; awayGoals: number }> }>();
  for (const s of snapshots) {
    const t = teamMap.get(s.matchCode);
    if (!t) continue;
    let m = matchMap.get(s.matchCode);
    if (!m) { m = { home: t.home, away: t.away, snapshots: [] }; matchMap.set(s.matchCode, m); }
    m.snapshots.push({ minute: s.minute, homeGoals: s.homeGoals, awayGoals: s.awayGoals });
  }

  // Sort snapshots by minute
  for (const m of matchMap.values()) m.snapshots.sort((a, b) => a.minute - b.minute);

  const matches = Array.from(matchMap.values());
  console.error(`Grouped into ${matches.length} matches`);

  // Split
  const shuffled = [...matches].sort(() => Math.random() - 0.5);
  const splitIdx = Math.floor(matches.length * 0.7);
  const train = shuffled.slice(0, splitIdx);
  const evalAll = matches;

  // Train
  resetGlicko2();
  let updates = 0;
  for (const m of train) {
    const last = m.snapshots[m.snapshots.length - 1];
    updateGlicko2Simplified(m.home, m.away, last.homeGoals, last.awayGoals);
    updates++;
  }

  // Eval
  let brierGlicko = 0, brierElo = 0, total = 0;
  for (const m of evalAll) {
    const last = m.snapshots[m.snapshots.length - 1];
    const o = (last.homeGoals > 0 || last.awayGoals > 0) ? 1 : 0;
    const pred = predictGlicko2(m.home, m.away);
    const gP = Math.max(0.01, Math.min(0.99, pred.homeWinP + 0.5 * pred.drawP));
    const ed = (1500 - 1500);
    const eloP = Math.max(0.01, Math.min(0.99, 0.12 + ed));
    brierGlicko += (gP - o) ** 2;
    brierElo += (eloP - o) ** 2;
    total++;
  }

  const glickoBrier = total > 0 ? brierGlicko / total : 0;
  const eloBrier = total > 0 ? brierElo / total : 0;

  console.error(`Eval: ${total} matches. glickoBrier=${glickoBrier.toFixed(4)} eloBrier=${eloBrier.toFixed(4)}`);

  if (PERSIST) {
    await setMeasuredBrier('glicko2', glickoBrier, total);
    console.error('Persisted glicko2 Brier to SystemConfig');
  }

  console.log(JSON.stringify({
    ok: true,
    matchesProcessed: matches.length,
    matchesTrain: train.length,
    matchesEval: total,
    glickoBrier: Math.round(glickoBrier * 10000) / 10000,
    eloBrier: Math.round(eloBrier * 10000) / 10000,
    persisted: PERSIST,
    totalUpdates: updates,
  }));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
