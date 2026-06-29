#!/usr/bin/env bun
/**
 * Dixon-Coles Corrector Benchmark — Faz 5 (Yol D)
 *
 * Frank's Copula κ ve ZISM β corrector'larının predictionLog üzerinden
 * bireysel etkisini ölçer. Production'da corrector sadece over/under + BTTS
 * tahminini etkiler (poissonP de facto gamma blend'i); label olarak dev-set
 * üzerinde Po label seti kullanır.
 *
 * Üretim sim:
 *   λ_h, λ_a = (1.3, 1.1) baseline (Eredivisie early-goal profile)
 *   corrector varyantlar: none | frank κ=-0.10 | frank κ=-0.30 | zism β=0.20
 *   goal label: dev-set'te `homeGoals > 0 || awayGoals > 0` üretecek şekilde proxy
 *
 * Veri kaynağı: PredictionLog.goalScored (binary). Lambda proxy: eloDiff'ten türetilmiş
 * basitleştirilmiş skala.
 *
 * Kullanım:
 *   bun scripts/zism-corrector-benchmark.ts
 *   bun scripts/zism-corrector-benchmark.ts --mode=frank --kappa=-0.30
 */

import { db } from '../src/lib/db';
import {
  applyCorrector,
  buildBasePoissonMatrix,
  deriveStats as deriveCorrectorStats,
} from '../src/lib/dixonColesCorrector';

function parseArgs(): Record<string, string> {
  const p: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--(\w+)=(-?[\d.]+)$/);
    if (m) p[m[1]] = m[2];
  }
  return p;
}
const ov = parseArgs();

const TAKE = parseInt(ov.take ?? '50000', 10);
const DEV_FRAC = parseFloat(ov.devFrac ?? '0.8');
const MODE = ov.mode ?? 'frank'; // 'frank' | 'zism'
const KAPPA = parseFloat(ov.kappa ?? '-0.10');
const BETA = parseFloat(ov.beta ?? '0.10');

interface Result {
  mode: string;
  kappa: number;
  beta: number;
  brierBase: number;
  brierCorrected: number;
  deltaBrier: number;
  brierOverUnderBase: number;
  brierOverUnderCorrected: number;
  brierBttsBase: number;
  brierBttsCorrected: number;
  deltaOverUnder: number;
  deltaBtts: number;
  dev: { n: number; positiveRate: number };
  params: Record<string, string | number>;
}

async function run() {
  const logs = await db.predictionLog.findMany({
    where: { goalScored: { not: null } },
    select: {
      calibratedP: true,
      goalScored: true,
      homeElo: true,
      awayElo: true,
    },
    take: TAKE,
  });

  if (logs.length < 30) {
    console.error(JSON.stringify({ error: `Need 30+ logs, got ${logs.length}` }));
    process.exit(1);
  }

  const split = Math.floor(logs.length * DEV_FRAC);
  const dev = logs.slice(split);

  function evaluate(batch: typeof logs) {
    const eps = 1e-15;
    let brierSumBase = 0;
    let brierSumCorr = 0;
    let brierSumOuBase = 0;
    let brierSumOuCorr = 0;
    let brierSumBttsBase = 0;
    let brierSumBttsCorr = 0;
    let positives = 0;

    for (const log of batch) {
      const o = log.goalScored ? 1 : 0;
      if (o === 1) positives++;

      const ed = (log.homeElo ?? 1500) - (log.awayElo ?? 1500);
      // Lambda proxy: eloDiffNormalized
      const lambdaHome = Math.max(0.5, Math.min(2.5, 1.3 + ed / 600));
      const lambdaAway = Math.max(0.5, Math.min(2.5, 1.1 - ed / 800));

      const baseMatrix = buildBasePoissonMatrix(lambdaHome, lambdaAway, 5);
      const baseStats = deriveCorrectorStats(baseMatrix);

      const correctorParams = MODE === 'zism'
        ? { mode: 'zism' as const, kappa: 0, beta: BETA }
        : { mode: 'frank' as const, kappa: KAPPA, beta: 0 };
      const corrMatrix = applyCorrector(baseMatrix, correctorParams);
      const corrStats = deriveCorrectorStats(corrMatrix);

      // Probability of goal-yes: P(H>0 ∪ A>0) = 1 - cell[0][0]
      const pBaseAnyGoal = Math.max(eps, Math.min(1 - eps, 1 - baseMatrix[0][0]));
      const pCorrAnyGoal = Math.max(eps, Math.min(1 - eps, 1 - corrMatrix[0][0]));

      brierSumBase += (pBaseAnyGoal - o) ** 2;
      brierSumCorr += (pCorrAnyGoal - o) ** 2;
      brierSumOuBase += (baseStats.over25 - o) ** 2;
      brierSumOuCorr += (corrStats.over25 - o) ** 2;
      brierSumBttsBase += (baseStats.btts - o) ** 2;
      brierSumBttsCorr += (corrStats.btts - o) ** 2;
    }

    const n = batch.length;
    return {
      base: brierSumBase / n,
      corr: brierSumCorr / n,
      ouBase: brierSumOuBase / n,
      ouCorr: brierSumOuCorr / n,
      bttsBase: brierSumBttsBase / n,
      bttsCorr: brierSumBttsCorr / n,
      positiveRate: positives / n,
    };
  }

  const m = evaluate(dev);

  const out: Result = {
    mode: MODE,
    kappa: KAPPA,
    beta: BETA,
    brierBase: Math.round(m.base * 10000) / 10000,
    brierCorrected: Math.round(m.corr * 10000) / 10000,
    deltaBrier: Math.round((m.corr - m.base) * 10000) / 10000,
    brierOverUnderBase: Math.round(m.ouBase * 10000) / 10000,
    brierOverUnderCorrected: Math.round(m.ouCorr * 10000) / 10000,
    brierBttsBase: Math.round(m.bttsBase * 10000) / 10000,
    brierBttsCorrected: Math.round(m.bttsCorr * 10000) / 10000,
    deltaOverUnder: Math.round((m.ouCorr - m.ouBase) * 10000) / 10000,
    deltaBtts: Math.round((m.bttsCorr - m.bttsBase) * 10000) / 10000,
    dev: { n: dev.length, positiveRate: Math.round(m.positiveRate * 1000) / 1000 },
    params: { ...ov, take: TAKE, devFrac: DEV_FRAC },
  };

  console.log(JSON.stringify(out));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
