#!/usr/bin/env bun
/**
 * Stacking Ensemble Benchmark
 *
 * Faz 2 (A2+C) — Stack meta-model'in (src/lib/ml/stackingEnsemble.ts) bireysel
 * Brier'ını ölçer ve alpha-blend sonrası ensembleP delta'sını raporlar.
 *
 * Üretim formüllerinin birebir aynısı kullanılır:
 *   - ruleP   = max(0.01, min(0.99, rawScore/100))
 *   - poissonP = 1 - (1 - pHome)(1 - pAway); fallback Elo'ya göre
 *   - eloP     = 0.12 + (homeElo-awayElo)/400 · 0.15
 *   - mlP      = calibratedP ?? 0.5
 *   - teamStrengthP = 0 (default — benchmark'ta teamStrength modeli yok)
 *   - inPlayP   = 0 (default — benchmark dev-set'lerinde geçmiş maçlar)
 *
 * Stacking default ağırlıkları (eşit=1) + cold-start guard → servis yoksa
 * degrade gracefully.
 *
 * Çıktı JSON: { brierStacking, brierBma, brierBmaStackingWeighted, alpha,
 *               dev: { n, positiveRate } }
 *
 * Kullanım:
 *   bun scripts/stacking-benchmark.ts                          # defaults
 *   bun scripts/stacking-benchmark.ts --alpha=0.3 --take=100000
 */

import { db } from '../src/lib/db';
import {
  predictStacking,
  loadStackingSamples,
  getStackingSamplesCount,
} from '../src/lib/ml/stackingEnsemble';

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
// Üretim ağırlıkları (TIER_CAPS ruleBased 0.45 / poisson 0.35 / elo 0.20)
const WR = ov.wr ?? 0.45;
const WP = ov.wp ?? 0.35;
const WE = ov.we ?? 0.20;
const ALPHA = ov.alpha ?? 0.3; // Faz 2 default blend

interface Result {
  brierStacking: number | null;
  brierBMA: number;
  brierBmaStackingWeighted: number | null;
  alpha: number;
  weightedDelta: number | null;
  stackingSamplesLoaded: number;
  dev: { n: number; positiveRate: number };
  params: Record<string, number>;
}

async function run() {
  // Cold-start: stacking training data yükle (file persistence)
  await loadStackingSamples();
  const samplesLoaded = getStackingSamplesCount();

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
    let brierSumStacking = 0;
    let brierSumBma = 0;
    let brierSumBlend = 0;
    let positives = 0;
    let stackingActive = 0;

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

      // BMA stand-in: weighted average (production'la aynı TIER_CAPS mantığı)
      const totalW = WR + WP + WE;
      const bmaP = Math.max(eps, Math.min(1 - eps,
        (WR * ruleP + WP * poissonP + WE * eloP) / totalW,
      ));

      // Stacking meta-model (default eşit ağırlıklar)
      const stackingP = predictStacking({
        ruleBased: ruleP,
        poisson: poissonP,
        elo: eloP,
        ml: mlP,
        teamStrength: 0, // benchmark kapsamı dışı
        inplay: 0,       // benchmark kapsamı dışı
      });
      const stackingPClamp = Math.max(eps, Math.min(1 - eps, stackingP));

      // Alpha-blend (C fazı gating davranışı)
      const blendP = Math.max(eps, Math.min(1 - eps,
        (1 - ALPHA) * bmaP + ALPHA * stackingPClamp,
      ));

      brierSumStacking += (stackingPClamp - o) ** 2;
      brierSumBma += (bmaP - o) ** 2;
      brierSumBlend += (blendP - o) ** 2;
      if (stackingP > 0.01) stackingActive++;
    }

    const n = batch.length;
    return {
      stacking: brierSumStacking / n,
      bma: brierSumBma / n,
      blend: brierSumBlend / n,
      positiveRate: positives / n,
      stackingCoverage: stackingActive / n,
    };
  }

  const m = evaluate(dev);

  const out: Result = {
    // cold-start: eğer n<100 ise currentWeights default eşit ağırlıklar,
    // o da bma ile aynı sonuç verir (sigmoid((rule+poisson+elo+ml)/7)).
    brierStacking: Number.isFinite(m.stacking) ? Math.round(m.stacking * 10000) / 10000 : null,
    brierBMA: Math.round(m.bma * 10000) / 10000,
    brierBmaStackingWeighted:
      ALPHA > 0 ? Math.round(m.blend * 10000) / 10000 : null,
    alpha: ALPHA,
    weightedDelta:
      ALPHA > 0
        ? Math.round((m.blend - m.bma) * 10000) / 10000
        : null,
    stackingSamplesLoaded: samplesLoaded,
    dev: {
      n: dev.length,
      positiveRate: Math.round(m.positiveRate * 1000) / 1000,
    },
    params: { ...ov, take: TAKE, devFrac: DEV_FRAC, wr: WR, wp: WP, we: WE },
  };

  console.log(JSON.stringify(out));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
