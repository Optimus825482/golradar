#!/usr/bin/env bun
/**
 * Pi-Rating Benchmark — Faz 7 (Yol C)
 *
 * Constantinou & Fenton (2013) Pi-Rating'i predictionLog üzerinden replay
 * yaparak eğitip EloBrier vs PiBrier ve alpha-blend delta ölçer.
 *
 * Üretim formüllerinin birebir aynısı:
 *   - eloP  = 0.12 + (homeElo - awayElo)/400 * 0.15
 *   - Pi-Rating update: gol-farkı (proxy: 1 vs 0, backward-compat)
 *   - Pi-Rating predict: 1X2 via erf/Φ approximation (stddev=1.5)
 *
 * Çıktı JSON: { brierElo, brierPi, brierPiEloBlend, alpha,
 *               dev: { n, positiveRate } }
 *
 * Kullanım:
 *   bun scripts/pi-rating-benchmark.ts
 *   bun scripts/pi-rating-benchmark.ts --alpha=0.5 --take=100000
 */

import { db } from '../src/lib/db';
import {
  resetPiState,
  updatePiRating,
  predictPiFromRating,
} from '../src/lib/piRating';

function parseArgs(): Record<string, number> {
  const p: Record<string, number> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--(\w+)=([\d.]+)$/);
    if (m) p[m[1]] = parseFloat(m[2]);
  }
  return p;
}
const ov = parseArgs();

const TAKE = ov.take ?? 100_000;
const DEV_FRAC = ov.devFrac ?? 0.8;
const ALPHA = ov.alpha ?? 0.5;

interface Result {
  brierElo: number;
  brierPi: number;
  brierPiEloBlend: number | null;
  alpha: number;
  totalUpdates: number;
  dev: { n: number; positiveRate: number };
  params: Record<string, number>;
}

async function run() {
  const logs = await db.predictionLog.findMany({
    where: { goalScored: { not: null } },
    select: {
      homeTeam: true,
      awayTeam: true,
      goalScored: true,
      homeElo: true,
      awayElo: true,
      createdAt: true,
    },
    take: TAKE,
    orderBy: { createdAt: 'asc' },
  });

  if (logs.length < 30) {
    console.error(JSON.stringify({ error: `Need 30+ logs, got ${logs.length}` }));
    process.exit(1);
  }

  const split = Math.floor(logs.length * DEV_FRAC);
  const train = logs.slice(0, split);
  const dev = logs.slice(split);

  // Pi-Rating replay (train set'i)
  resetPiState();
  let totalUpdates = 0;
  for (const log of train) {
    // Backward-compat: predictionLog'da homeGoals/awayGoals yok.
    // goalScored=true ise default home=1, away=0 (gol-farkı proxy).
    updatePiRating(log.homeTeam, log.awayTeam, log.goalScored ? 1 : 0, 0);
    totalUpdates++;
  }

  function evaluate(batch: typeof logs) {
    const eps = 1e-15;
    let brierSumElo = 0, brierSumPi = 0, brierSumBlend = 0;
    let positives = 0, piActive = 0;

    for (const log of batch) {
      const o = log.goalScored ? 1 : 0;
      if (o === 1) positives++;

      const ed = (log.homeElo ?? 1500) - (log.awayElo ?? 1500);
      const eloP = Math.max(0.01, Math.min(0.99, 0.12 + (ed / 400) * 0.15));

      const piPred = predictPiFromRating(log.homeTeam, log.awayTeam);
      const piAnyGoal = piPred.homeWinP + 0.5 * piPred.drawP;
      const piP = piAnyGoal > 0
        ? Math.max(eps, Math.min(1 - eps, Math.max(0.05, piAnyGoal)))
        : 0;

      const blendP = Math.max(eps, Math.min(1 - eps,
        (1 - ALPHA) * eloP + ALPHA * piP,
      ));

      brierSumElo += (eloP - o) ** 2;
      if (piP > 0) {
        brierSumPi += (piP - o) ** 2;
        piActive++;
      }
      brierSumBlend += (blendP - o) ** 2;
    }

    const n = batch.length;
    return {
      elo: brierSumElo / n,
      pi: brierSumPi / Math.max(1, piActive),
      blend: brierSumBlend / n,
      positiveRate: positives / n,
      piCoverage: piActive / n,
    };
  }

  const m = evaluate(dev);

  const out: Result = {
    brierElo: Math.round(m.elo * 10000) / 10000,
    brierPi: m.piCoverage > 0 ? Math.round(m.pi * 10000) / 10000 : 0,
    brierPiEloBlend: ALPHA > 0 ? Math.round(m.blend * 10000) / 10000 : null,
    alpha: ALPHA,
    totalUpdates,
    dev: { n: dev.length, positiveRate: Math.round(m.positiveRate * 1000) / 1000 },
    params: { ...ov, take: TAKE, devFrac: DEV_FRAC },
  };

  console.log(JSON.stringify(out));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
