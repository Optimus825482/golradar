#!/usr/bin/env bun
/**
 * Glicko-2 Benchmark — Faz 7 (Yol C)
 *
 * Glickman Glicko-2'yi predictionLog üzerinden replay yaparak eğitip
 * EloBrier vs Glicko2Brier ve alpha-blend delta ölçer.
 *
 * Glickman (2013) formüller:
 *   - g(φ) = 1 / sqrt(1 + 3·φ²/π²)
 *   - E_i = 1 / (1 + exp(−g · (μ_i − μ_j)))
 *   - V = 1 / Σ g_j² E (1 − E)
 *   - Δ = V · Σ g · (s − E)
 *   - σ Illinois Algorithm ile iteratif
 *
 * Çıktı JSON: { brierElo, brierGlicko, brierBlend, alpha,
 *               dev: { n } }
 *
 * Kullanım:
 *   bun scripts/glicko2-benchmark.ts
 *   bun scripts/glicko2-benchmark.ts --alpha=0.5 --take=100000
 */

import { db } from '../src/lib/db';
import {
  resetGlicko2,
  updateGlicko2Simplified,
  predictGlicko2,
} from '../src/lib/glicko2';

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
  brierGlicko: number;
  brierBlend: number;
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

  resetGlicko2();
  let totalUpdates = 0;
  for (const log of train) {
    updateGlicko2Simplified(log.homeTeam, log.awayTeam, log.goalScored ? 1 : 0, 0);
    // ^ SimScore: goalScored=true => 1-0 (default gap proxy)
    // (full Illinois update yerine simpler training kullanılıyor;
    // RD+σ yakınsaması az olduğu için hızlı dev-set ölçüm için yeterli)
    totalUpdates++;
  }

  function evaluate(batch: typeof logs) {
    const eps = 1e-15;
    let brierSumElo = 0, brierSumGlicko = 0, brierSumBlend = 0;
    let positives = 0, glickoActive = 0;

    for (const log of batch) {
      const o = log.goalScored ? 1 : 0;
      if (o === 1) positives++;

      const ed = (log.homeElo ?? 1500) - (log.awayElo ?? 1500);
      const eloP = Math.max(0.01, Math.min(0.99, 0.12 + (ed / 400) * 0.15));

      const gPred = predictGlicko2(log.homeTeam, log.awayTeam);
      const gAnyGoal = gPred.homeWinP + 0.5 * gPred.drawP;
      const gP = gPred.RD.home > 0
        ? Math.max(eps, Math.min(1 - eps, Math.max(0.05, gAnyGoal)))
        : 0;

      const blendP = Math.max(eps, Math.min(1 - eps,
        (1 - ALPHA) * eloP + ALPHA * gP,
      ));

      brierSumElo += (eloP - o) ** 2;
      if (gP > 0) {
        brierSumGlicko += (gP - o) ** 2;
        glickoActive++;
      }
      brierSumBlend += (blendP - o) ** 2;
    }

    const n = batch.length;
    return {
      elo: brierSumElo / n,
      glicko: brierSumGlicko / Math.max(1, glickoActive),
      blend: brierSumBlend / n,
      positiveRate: positives / n,
      glickoCoverage: glickoActive / n,
    };
  }

  const m = evaluate(dev);

  const out: Result = {
    brierElo: Math.round(m.elo * 10000) / 10000,
    brierGlicko: m.glickoCoverage > 0 ? Math.round(m.glicko * 10000) / 10000 : 0,
    brierBlend: Math.round(m.blend * 10000) / 10000,
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
