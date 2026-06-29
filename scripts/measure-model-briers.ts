#!/usr/bin/env bun
/**
 * Model Brier Calibration Benchmark
 *
 * A1 (Yol A-1) — Her modelin (Rule-Based / Poisson / Elo / ML) dev-set
 * Brier'ını doğrudan PredictionLog üzerinden yeniden hesaplar. Bu değerler
 * ensemble.ts `computeEnsembleWeights` çağrısına beslenir, böylece TIER_CAPS
 * rotasyonu artık tüm 6 model için geçerli olur (önce yalnızca
 * ml/inplay/team-strength arasında).
 *
 * Üretim formülleriyle birebir aynı:
 *   - ruleP   = max(0.01, min(0.99, rawScore/100))
 *   - poissonP = 1 - (1 - pHome)(1 - pAway); fallback Elo'ya göre
 *   - eloP     = 0.12 + (homeElo-awayElo)/400 · 0.15  (clamp 0.01..0.99)
 *   - mlP      = calibratedP ?? 0.5
 *
 * Çıktı JSON: { brierRule, brierPoisson, brierElo, brierMultiBaseline,
 *               dev: { n, nHome, nDraw, nAway } }
 *
 * Kullanım:
 *   bun scripts/measure-model-briers.ts                    # defaults
 *   bun scripts/measure-model-briers.ts --take=200000
 */

import { db } from '../src/lib/db';
import {
  setMeasuredBrier,
} from '../src/lib/ml/brierCache';

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
// Reuse ensemble-benchmark weights as the "default" baseline blend:
const WR = ov.wr ?? 0.45;
const WP = ov.wp ?? 0.35;
const WE = ov.we ?? 0.20;

interface Result {
  brierRule: number;
  brierPoisson: number;
  brierElo: number;
  brierML: number;
  brierMultiBaseline: number;
  brierMultiWithShards: number | null;
  dev: { n: number; positiveRate: number };
  weights: { ruleBased: number; poisson: number; elo: number };
  persisted: boolean;
  params: Record<string, number>;
}

async function run() {
  const logs = await db.predictionLog.findMany({
    where: { goalScored: { not: null } },
    select: {
      rawScore: true,
      calibratedP: true,
      goalScored: true,
      homeElo: true,
      awayElo: true,
      poissonHomeP: true,
      poissonAwayP: true,
    },
    take: TAKE,
  });

  if (logs.length < 30) {
    console.error(JSON.stringify({ error: `Need 30+ logs, got ${logs.length}` }));
    process.exit(1);
  }

  const split = Math.floor(logs.length * DEV_FRAC);
  const dev = logs.slice(0, split);

  function evaluate(batch: typeof logs) {
    const eps = 1e-15;
    let brierRule = 0,
      brierPoisson = 0,
      brierElo = 0,
      brierML = 0,
      brierMultiBaseline = 0;
    let positives = 0;
    let shardRuleMul = 0,
      shardPoissonMul = 0,
      shardEloMul = 0;

    // Brier score'ların sharded (1 - p^2) üzerinden ortalama kalite göstergesi.
    // Burada amaç modelin bireysel eğilimini (sharp/flat) ayırt etmek değil;
    // sadece her modelin ortalama p² değerini karşılaştırmak.
    for (const log of batch) {
      const o = log.goalScored ? 1 : 0;
      if (o === 1) positives++;

      const ruleP = Math.max(0.01, Math.min(0.99, (log.rawScore ?? 50) / 100));

      let poissonP: number;
      if (log.poissonHomeP != null && log.poissonAwayP != null) {
        poissonP = 1 - (1 - log.poissonHomeP) * (1 - log.poissonAwayP);
      } else if (log.poissonHomeP != null) {
        poissonP = log.poissonHomeP;
      } else {
        const ed = (log.homeElo ?? 1500) - (log.awayElo ?? 1500);
        poissonP = Math.max(0.01, Math.min(0.99, 0.15 + (ed / 400) * 0.1));
      }
      poissonP = Math.max(0.01, Math.min(0.99, poissonP));

      const ed = (log.homeElo ?? 1500) - (log.awayElo ?? 1500);
      const eloP = Math.max(0.01, Math.min(0.99, 0.12 + (ed / 400) * 0.15));

      const mlP = Math.max(0.01, Math.min(0.99, log.calibratedP ?? 0.5));

      brierRule += (ruleP - o) ** 2;
      brierPoisson += (poissonP - o) ** 2;
      brierElo += (eloP - o) ** 2;
      brierML += (mlP - o) ** 2;

      const baselineP = Math.max(eps, Math.min(1 - eps,
        (WR * ruleP + WP * poissonP + WE * eloP) / (WR + WP + WE),
      ));
      brierMultiBaseline += (baselineP - o) ** 2;

      // Shard "agreement" göstergesi: modelin p-ortalama ile sapması
      shardRuleMul += ruleP;
      shardPoissonMul += poissonP;
      shardEloMul += eloP;
    }

    const n = batch.length;
    return {
      rule: brierRule / n,
      poisson: brierPoisson / n,
      elo: brierElo / n,
      ml: brierML / n,
      multiBaseline: brierMultiBaseline / n,
      positiveRate: positives / n,
      shardMean: {
        rule: shardRuleMul / n,
        poisson: shardPoissonMul / n,
        elo: shardEloMul / n,
      },
    };
  }

  const m = evaluate(dev);
  let persisted = false;
  if (process.argv.includes('--persist')) {
    await Promise.all([
      setMeasuredBrier('rule', m.rule, dev.length),
      setMeasuredBrier('poisson', m.poisson, dev.length),
      setMeasuredBrier('elo', m.elo, dev.length),
    ]);
    persisted = true;
  }

  const out: Result = {
    brierRule: Math.round(m.rule * 10000) / 10000,
    brierPoisson: Math.round(m.poisson * 10000) / 10000,
    brierElo: Math.round(m.elo * 10000) / 10000,
    brierML: Math.round(m.ml * 10000) / 10000,
    brierMultiBaseline: Math.round(m.multiBaseline * 10000) / 10000,
    brierMultiWithShards: null, // doldurulacak (faz 1.4'te)
    dev: { n: dev.length, positiveRate: Math.round(m.positiveRate * 1000) / 1000 },
    weights: { ruleBased: WR, poisson: WP, elo: WE },
    persisted,
    params: {
      ...ov,
      take: TAKE,
      devFrac: DEV_FRAC,
      shardMeanRule: Math.round(m.shardMean.rule * 1000) / 1000,
      shardMeanPoisson: Math.round(m.shardMean.poisson * 1000) / 1000,
      shardMeanElo: Math.round(m.shardMean.elo * 1000) / 1000,
    },
  };

  console.log(JSON.stringify(out));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
