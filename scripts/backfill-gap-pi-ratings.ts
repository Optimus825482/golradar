#!/usr/bin/env bun
/**
 * Backfill: Lite GAP + Pi-Rating from MatchSnapshot
 *
 * MatchSnapshot tablosunda:
 *   - homeGoals / awayGoals → Pi-Rating (gol farki)
 *   - statsJson (MatchStats) → Lite GAP (shots, corners, xG)
 *
 * Bu script MatchSnapshot'i sequential replay ederek:
 *   1. GAP rating state'i günceller (updateGapRatingFromMatchSnapshot)
 *   2. Pi-Rating state'ini günceller (updatePiRating, gerçek skor)
 *   3. Dev-set Brier ölçer (GAP vs Elo, Pi vs Elo)
 *   4. --persist flag varsa SystemConfig'e Brier değerlerini yazar
 *
 * Çıktı JSON: { matchesProcessed, gapBrier, piBrier, eloBrier, ... }
 *
 * Kullanım:
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

  console.error(`Got ${snapshots.length} snapshots, grouping by matchCode...`);

  // Group by matchCode, create team mappings
  const matchMap = new Map<number, MatchGroup>();
  for (const s of snapshots) {
    let group = matchMap.get(s.matchCode);
    if (!group) {
      // Parse homeTeam/awayTeam from first snapshot's statsJson or skip
      try {
        const stats = s.statsJson ? JSON.parse(s.statsJson) : null;
        group = {
          matchCode: s.matchCode,
          homeTeam: `match_${s.matchCode}_home`,
          awayTeam: `match_${s.matchCode}_away`,
          snapshots: [],
        };
        matchMap.set(s.matchCode, group);
      } catch { continue; }
    }
    group.snapshots.push({
      minute: s.minute,
      homeGoals: s.homeGoals,
      awayGoals: s.awayGoals,
      statsJson: s.statsJson,
    });
  }

  // Sort each group by minute ascending
  for (const g of matchMap.values()) {
    g.snapshots.sort((a, b) => a.minute - b.minute);
  }

  const matches = Array.from(matchMap.values());
  console.error(`Grouped into ${matches.length} unique matches`);

  // Split 80/20 time-sequential (by first snapshot timestamp)
  const splitIdx = Math.floor(matches.length * 0.8);
  const trainMatches = matches.slice(0, splitIdx);
  const evalMatches = matches.slice(splitIdx);

  // ── TRAIN ──
  const gapState = createGapRatingState();
  resetPiState();
  let gapUpdates = 0;
  let piUpdates = 0;
  let matchesWithStatsJson = 0;

  for (const match of trainMatches) {
    const lastSnap = match.snapshots[match.snapshots.length - 1];
    // Use last snapshot's homeGoals/awayGoals as final score for Pi-Rating
    updatePiRating(match.homeTeam, match.awayTeam, lastSnap.homeGoals, lastSnap.awayGoals);
    piUpdates++;

    for (const snap of match.snapshots) {
      const features = extractGapFeaturesFromMatchSnapshot(snap.statsJson, snap.minute);
      if (features) {
        updateGapRatingFromMatchSnapshot(gapState, match.homeTeam, match.awayTeam, features);
        gapUpdates++;
        if (gapUpdates === 1) matchesWithStatsJson++;
      }
    }
  }

  // ── EVAL ──
  let brierGapSum = 0, brierPiSum = 0, brierEloSum = 0;
  let gapActive = 0, piActive = 0, total = 0;

  for (const match of evalMatches) {
    const lastSnap = match.snapshots[match.snapshots.length - 1];
    const o = (lastSnap.homeGoals > 0 || lastSnap.awayGoals > 0) ? 1 : 0;

    // GAP prediction
    const gapPred = predictGapMatch(gapState, match.homeTeam, match.awayTeam);
    if (gapPred.gapP > 0) {
      brierGapSum += (gapPred.gapP - o) ** 2;
      gapActive++;
    }

    // Pi-Rating prediction
    const piPred = predictPiFromRating(match.homeTeam, match.awayTeam);
    const piP = piPred.homeWinP + 0.5 * piPred.drawP;
    if (piP > 0.01) {
      brierPiSum += (piP - o) ** 2;
      piActive++;
    }

    // Elo proxy (rating diff)
    const ratingDiff = piPred.homeRating - piPred.awayRating;
    const eloP = Math.max(0.01, Math.min(0.99, 0.12 + ratingDiff));
    brierEloSum += (eloP - o) ** 2;
    total++;
  }

  const gapBrier = gapActive > 0 ? brierGapSum / gapActive : null;
  const piBrier = piActive > 0 ? brierPiSum / piActive : null;
  const eloBrier = total > 0 ? brierEloSum / total : 0;

  console.error(
    `Eval: ${total} matches. gapBrier=${gapBrier?.toFixed(4) ?? 'null'} ` +
    `piBrier=${piBrier?.toFixed(4) ?? 'null'} eloBrier=${eloBrier.toFixed(4)}`,
  );

  if (PERSIST) {
    await setMeasuredBrier('gap', gapBrier ?? 0.25, total);
    await setMeasuredBrier('pi', piBrier ?? 0.25, total);
    console.error('Persisted to SystemConfig');
  }

  const out = {
    ok: true,
    matchesProcessed: matches.length,
    matchesTrain: trainMatches.length,
    matchesEval: evalMatches.length,
    gapUpdates,
    piUpdates,
    matchesWithStatsJson,
    gapBrier: gapBrier !== null ? Math.round(gapBrier * 10000) / 10000 : null,
    piBrier: piBrier !== null ? Math.round(piBrier * 10000) / 10000 : null,
    eloBrier: Math.round(eloBrier * 10000) / 10000,
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
