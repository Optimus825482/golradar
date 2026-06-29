#!/usr/bin/env bun
/**
 * Weibull + Frank's Copula Corrector Benchmark — Faz 7 (Yol D)
 *
 * Corrector'un Poisson vs Weibull PMF + Frank κ vs ZISM β varyasyonlarını
 * predictionLog üzerinden ölçer. McHale & Scarf (2011) over-dispersion
 * düzeltmesi için Weibull Sayım PMF kullanır; Frank's Copula κ ise gol
 * korelasyonunu (pozitif/negatif) hesaba katar.
 *
 * Modlar:
 *   poisson-frank:    base=Poisson, corrector=Frank κ
 *   poisson-zism:     base=Poisson, corrector=ZISM β
 *   weibull-frank:    base=Weibull (shape=1.4), corrector=Frank κ
 *   weibull-zism:     base=Weibull (shape=1.4), corrector=ZISM β
 *
 * Çıktı JSON: { brierBase, brierCorrected, deltaBrier, mode,
 *               alpha, kappa, beta }
 *
 * Kullanım:
 *   bun scripts/weibull-copula-benchmark.ts
 *   bun scripts/weibull-copula-benchmark.ts --pmf=weibull --corrector=frank --kappa=-0.10
 */

import { db } from '../src/lib/db';
import {
  applyCorrector,
  buildBasePoissonMatrix,
  deriveStats,
} from '../src/lib/dixonColesCorrector';

function parseArgs(): Record<string, string | number> {
  const p: Record<string, string | number> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--(\w+)=(-?[\d.]+)$/);
    if (m) p[m[1]] = m[2];
  }
  return p;
}
const ov = parseArgs();

const TAKE = parseInt(String(ov.take ?? '50000'), 10);
const DEV_FRAC = parseFloat(String(ov.devFrac ?? '0.8'));
const PMF = String(ov.pmf ?? 'poisson'); // 'poisson' | 'weibull'
const CORRECTOR = String(ov.corrector ?? 'frank'); // 'frank' | 'zism'
const KAPPA = parseFloat(String(ov.kappa ?? '-0.10'));
const BETA = parseFloat(String(ov.beta ?? '0.10'));

interface Result {
  pmf: string;
  corrector: string;
  kappa: number;
  beta: number;
  brierBase: number;
  brierCorrected: number;
  deltaBrier: number;
  brierAnyGoalBase: number;
  brierAnyGoalCorrected: number;
  deltaAnyGoal: number;
  brierOverUnder: number;
  brierOverUnderCorrected: number;
  brierBtts: number;
  brierBttsCorrected: number;
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
    let baseBrier = 0;
    let corrBrier = 0;
    let baseBrierAnyGoal = 0;
    let corrBrierAnyGoal = 0;
    let baseOuBrier = 0;
    let corrOuBrier = 0;
    let baseBttsBrier = 0;
    let corrBttsBrier = 0;
    let positives = 0;

    const correctorParams = CORRECTOR === 'zism'
      ? { mode: 'zism' as const, kappa: 0, beta: BETA }
      : { mode: 'frank' as const, kappa: KAPPA, beta: 0 };

    for (const log of batch) {
      const o = log.goalScored ? 1 : 0;
      if (o === 1) positives++;

      const ed = (log.homeElo ?? 1500) - (log.awayElo ?? 1500);
      const lambdaHome = Math.max(0.5, Math.min(2.5, 1.3 + ed / 600));
      const lambdaAway = Math.max(0.5, Math.min(2.5, 1.1 - ed / 800));

      const baseMatrix = buildBasePoissonMatrix(lambdaHome, lambdaAway, 5, PMF as 'poisson' | 'weibull');
      const baseStats = deriveStats(baseMatrix);
      const pBaseAnyGoal = 1 - baseMatrix[0][0];

      const corrMatrix = applyCorrector(baseMatrix, correctorParams);
      const corrStats = deriveStats(corrMatrix);
      const pCorrAnyGoal = 1 - corrMatrix[0][0];

      baseBrier += (baseStats.btts - o) ** 2;
      corrBrier += (corrStats.btts - o) ** 2;
      baseBrierAnyGoal += (pBaseAnyGoal - o) ** 2;
      corrBrierAnyGoal += (pCorrAnyGoal - o) ** 2;
      baseOuBrier += (baseStats.over25 - o) ** 2;
      corrOuBrier += (corrStats.over25 - o) ** 2;
      baseBttsBrier += (baseStats.btts - o) ** 2;
      corrBttsBrier += (corrStats.btts - o) ** 2;
    }

    const n = batch.length;
    return {
      baseBrier: baseBrier / n,
      corrBrier: corrBrier / n,
      baseBrierAnyGoal: baseBrierAnyGoal / n,
      corrBrierAnyGoal: corrBrierAnyGoal / n,
      baseOu: baseOuBrier / n,
      corrOu: corrOuBrier / n,
      baseBtts: baseBttsBrier / n,
      corrBtts: corrBttsBrier / n,
      positiveRate: positives / n,
    };
  }

  const m = evaluate(dev);

  // Primary metric: brierBtts / deltaBtts (corrector BTTS optimization)
  // (eski corrector benchmark da primary=Btts idi)
  const primary = m.corrBtts; // minimize brier Btts

  const out = {
    primaryMetric: primary, // topoğrafik output
    pmf: PMF,
    corrector: CORRECTOR,
    kappa: KAPPA,
    beta: BETA,
    brierBase: Math.round(m.baseBrier * 10000) / 10000,
    brierCorrected: Math.round(m.corrBrier * 10000) / 10000,
    deltaBrier: Math.round((m.corrBrier - m.baseBrier) * 10000) / 10000,
    brierAnyGoalBase: Math.round(m.baseBrierAnyGoal * 10000) / 10000,
    brierAnyGoalCorrected: Math.round(m.corrBrierAnyGoal * 10000) / 10000,
    deltaAnyGoal: Math.round((m.corrBrierAnyGoal - m.baseBrierAnyGoal) * 10000) / 10000,
    brierOverUnder: Math.round(m.baseOu * 10000) / 10000,
    brierOverUnderCorrected: Math.round(m.corrOu * 10000) / 10000,
    brierBtts: Math.round(m.baseBtts * 10000) / 10000,
    brierBttsCorrected: Math.round(m.corrBtts * 10000) / 10000,
    deltaBtts: Math.round((m.corrBtts - m.baseBtts) * 10000) / 10000,
    dev: { n: dev.length, positiveRate: Math.round(m.positiveRate * 1000) / 1000 },
    params: { ...ov, take: TAKE, devFrac: DEV_FRAC, primary },
  };

  // Arbor eval.py "score: ..." formatı
  console.log(`score: ${primary.toFixed(4)}`);
  console.log(JSON.stringify(out));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
