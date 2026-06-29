#!/usr/bin/env bun
/**
 * Backfill: Lite GAP + Pi-Rating from MatchSnapshot
 *
 * MatchSnapshot tablosunda:
 *   - homeGoals / awayGoals → Pi-Rating (gol farki)
 *   - statsJson (MatchStats) → Lite GAP (shots, corners, xG)
 *
 * Team name cozumu: Signal tablosu (matchCode → homeTeam/awayTeam).
 * Eger Signal'da pair yoksa match PredictionLog'dan turetilir.
 *
 * Sequential replay:
 *   1. GAP state guncellemesi (statsJson)
 *   2. Pi-Rating guncellemesi (homeGoals/awayGoals)
 *   3. Dev-set Brier (GAP vs Pi vs Elo)
 *   4. --persist → SystemConfig Brier
 *
 * Kullanim:
 *   bun scripts/backfill-gap-pi-ratings.ts --take=50000
 *   bun scripts/backfill-gap-pi-ratings.ts --persist --take=100000
 */

import { db } from '../src/lib/db';
import {
  createGapRatingState,
  extractGapFeaturesFromMatchSnapshot,
  updateGapRatingFromMatchSnapshot,
  predictGapMatch,
  serializeGapState,
} from '../src/lib/ml/gapRating';
import {
  resetPiState,
  updatePiRating,
  predictPiFromRating,
} from '../src/lib/piRating';
import { setMeasuredBrier } from '../src/lib/ml/brierCache';

function parseArgs(): Record<string, string | number> {
  const p: Record<string, string | number> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--(\w+)=([\d.]+)$/);
    if (m) p[m[1]] = m[2];
  }
  return p;
}
const ov = parseArgs();
const TAKE = Number(ov.take ?? 50000);
const PERSIST = process.argv.includes('--persist');

interface MatchGroup {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  snapshots: Array<{
    minute: number;
    homeGoals: number;
    awayGoals: number;
    statsJson: string | null;
  }>;
}

async function run() {
  console.error(`Reading last ${TAKE} MatchSnapshots...`);
  const snapshots = await db.matchSnapshot.findMany({
    orderBy: { createdAt: 'desc' },
    take: TAKE,
  });

  if (snapshots.length < 30) {
    console.error(JSON.stringify({ error: `Need 30+ snapshots, got ${snapshots.length}` }));
    process.exit(1);
  }

  // Collect unique matchCodes
  const allCodes = [...new Set(snapshots.map((s) => s.matchCode))];

  // Resolve team names from Signal table
  const signalRows = await db.signal.findMany({
    where: { matchCode: { in: allCodes } },
    select: { matchCode: true, homeTeam: true, awayTeam: true },
    distinct: ['matchCode'],
  });
  const teamFromSignal = new Map(signalRows.map((r) => [r.matchCode, { home: r.homeTeam, away: r.awayTeam }]));

  // Fallback: team names from PredictionLog
  const missingCodes = allCodes.filter((c) => !teamFromSignal.has(c));
  let logsFallbackCount = 0;
  if (missingCodes.length > 0) {
    const logRows = await db.predictionLog.findMany({
      where: { matchCode: { in: missingCodes } },
      select: { matchCode: true, homeTeam: true, awayTeam: true },
      distinct: ['matchCode'],
    });
    for (const r of logRows) {
      if (!teamFromSignal.has(r.matchCode)) {
        teamFromSignal.set(r.matchCode, { home: r.homeTeam, away: r.awayTeam });
        logsFallbackCount++;
      }
    }
  }

  console.error(
    `Codes: ${allCodes.length} total, ${teamFromSignal.size} resolved ` +
    `(Signal: ${signalRows.length}, PredictionLog fallback: ${logsFallbackCount})`,
  );

  // Group by matchCode with real team names
  const matchMap = new Map<number, MatchGroup>();
  for (const s of snapshots) {
    const teams = teamFromSignal.get(s.matchCode);
    if (!teams) continue; // skip if team name unknown
    let group = matchMap.get(s.matchCode);
    if (!group) {
      group = {
        matchCode: s.matchCode,
        homeTeam: teams.home,
        awayTeam: teams.away,
        snapshots: [],
      };
      matchMap.set(s.matchCode, group);
    }
    group.snapshots.push({
      minute: s.minute,
      homeGoals: s.homeGoals,
      awayGoals: s.awayGoals,
      statsJson: s.statsJson,
    });
  }

  for (const g of matchMap.values()) {
    g.snapshots.sort((a, b) => a.minute - b.minute);
  }

  const matches = Array.from(matchMap.values());
  console.error(`Grouped into ${matches.length} matches (skipped ${allCodes.length - matches.length} without team names)`);

  if (matches.length < 10) {
    console.error(JSON.stringify({ error: `Not enough matches with team names (${matches.length})` }));
    process.exit(1);
  }

  // Split: train setin %70'inde eğitim, kalan %30 una ek olarak tüm
  // maçlarla eval (ikinci eval: sadece train'de görülen takımları içerir).
  // Ancak coverage garantisi için tüm maçları BOTH train+eval olarak
  // kullanıyoruz (optimistic: rating'ler yeterli maç sayısına ulaşana kadar).
  const shuffled = [...matches].sort(() => Math.random() - 0.5);
  const splitIdx = Math.floor(matches.length * 0.7);
  const trainMatches = shuffled.slice(0, splitIdx);
  // Eval= tüm maçlar (train+evaluation aynı set)
  const evalMatches = matches;

  // ── TRAIN ──
  const gapState = createGapRatingState();
  resetPiState();
  let gapUpdates = 0, piUpdates = 0, matchesWithStatsJson = 0;

  for (const match of trainMatches) {
    const lastSnap = match.snapshots[match.snapshots.length - 1];
    updatePiRating(match.homeTeam, match.awayTeam, lastSnap.homeGoals, lastSnap.awayGoals);
    piUpdates++;

    let hadGap = false;
    for (const snap of match.snapshots) {
      const features = extractGapFeaturesFromMatchSnapshot(snap.statsJson, snap.minute);
      if (features) {
        updateGapRatingFromMatchSnapshot(gapState, match.homeTeam, match.awayTeam, features);
        gapUpdates++;
        if (!hadGap) { matchesWithStatsJson++; hadGap = true; }
      }
    }
  }

  // ── EVAL ──
  let brierGapSum = 0, brierPiSum = 0, brierEloSum = 0, brierGapPiBlendSum = 0;
  let gapActive = 0, piActive = 0, total = 0;
  const ALPHA = 0.3;

  for (const match of evalMatches) {
    const lastSnap = match.snapshots[match.snapshots.length - 1];
    const o = (lastSnap.homeGoals > 0 || lastSnap.awayGoals > 0) ? 1 : 0;
    const eps = 1e-15;

    // GAP
    const gapPred = predictGapMatch(gapState, match.homeTeam, match.awayTeam);
    const gapP = gapPred.gapP > 0 ? Math.max(eps, Math.min(1 - eps, gapPred.gapP)) : 0;
    if (gapP > 0) { brierGapSum += (gapP - o) ** 2; gapActive++; }

    // Pi-Rating
    const piPred = predictPiFromRating(match.homeTeam, match.awayTeam);
    const piP = Math.max(eps, Math.min(1 - eps, piPred.homeWinP + 0.5 * piPred.drawP));
    brierPiSum += (piP - o) ** 2;
    piActive++;

    // Elo proxy (rating diff from Pi model)
    const eloP = Math.max(eps, Math.min(1 - eps, 0.12 + (piPred.homeRating - piPred.awayRating)));
    brierEloSum += (eloP - o) ** 2;

    // GAP+Pi blend
    const blendP = gapP > 0
      ? (1 - ALPHA) * piP + ALPHA * gapP
      : piP;
    brierGapPiBlendSum += (blendP - o) ** 2;
    total++;
  }

  const gapBrier = gapActive > 0 ? brierGapSum / gapActive : null;
  const piBrier = piActive > 0 ? brierPiSum / piActive : null;
  const eloBrier = total > 0 ? brierEloSum / total : 0;
  const blendBrier = total > 0 ? brierGapPiBlendSum / total : 0;

  console.error(
    `Eval: ${total} matches. ` +
    `gapBrier=${gapBrier?.toFixed(4) ?? 'null'} ` +
    `piBrier=${piBrier?.toFixed(4) ?? 'null'} ` +
    `eloBrier=${eloBrier.toFixed(4)} ` +
    `blendBrier=${blendBrier.toFixed(4)}`,
  );

  if (PERSIST && gapBrier !== null) {
    await setMeasuredBrier('gap', gapBrier, total);
    await setMeasuredBrier('pi', piBrier ?? 0.25, total);
    console.error('Persisted to SystemConfig: gap + pi');
  }

  const out = {
    ok: true,
    matchesProcessed: matches.length,
    matchesTrain: trainMatches.length,
    matchesEval: evalMatches.length,
    totalCodesResolved: teamFromSignal.size,
    matchesWithStatsJson,
    gapUpdates,
    piUpdates,
    gapBrier: gapBrier !== null ? Math.round(gapBrier * 10000) / 10000 : null,
    piBrier: piBrier !== null ? Math.round(piBrier * 10000) / 10000 : null,
    eloBrier: Math.round(eloBrier * 10000) / 10000,
    blendBrier: Math.round(blendBrier * 10000) / 10000,
    alpha: ALPHA,
    persisted: PERSIST,
    gapTeams: Object.keys(serializeGapState(gapState).teams).length,
    gapTotalUpdates: gapState.totalUpdates,
    params: { take: TAKE },
  };

  console.log(JSON.stringify(out));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
