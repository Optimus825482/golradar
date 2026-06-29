#!/usr/bin/env bun
/**
 * GAP Rating Benchmark — Faz 4 (Yol B)
 *
 * predictionLog.featuresJson üzerinden sequence replay yaparak lite GAP
 * state güncellemesi yapıp, gapP Brier ve ensembleP-blend (alpha) Brier'ları
 * ölçer. Elo'nun ensemble mevcut davranışıyla karşılaştırma.
 *
 * Üretim formüllerinin birebir aynısı:
 *   - eloP = 0.12 + (homeElo - awayElo)/400 · 0.15 (clamp 0.01..0.99)
 *   - gapP: predictGapMatch(state, home, away).gapP
 *   - Ensemble blend: alpha · gapP + (1 - alpha) · eloP
 *
 * Çıktı JSON: { brierGap, brierElo, brierBlend, alpha,
 *               dev: { n, positiveRate } }
 *
 * Kullanım:
 *   bun scripts/gap-rating-benchmark.ts                          # defaults
 *   bun scripts/gap-rating-benchmark.ts --alpha=0.5 --take=100000
 */

import { db } from '../src/lib/db';
import {
  createGapRatingState,
  extractGapFeatures,
  updateGapRating,
  predictGapMatch,
} from '../src/lib/ml/gapRating';

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
const ALPHA = ov.alpha ?? 0.3;

interface Result {
  brierGap: number | null;
  brierElo: number;
  brierBlend: number | null;
  alpha: number;
  totalUpdates: number;
  matchesWithFeatures: number;
  dev: { n: number; positiveRate: number };
  params: Record<string, number>;
}

async function run() {
  // predictionLog + featuresJson'ı sıralı çek (createdAt artan).
  // Sequence replay için sıra kritik; createdAt desc yapıp reverse ediyoruz.
  const logs = await db.predictionLog.findMany({
    where: { goalScored: { not: null } },
    select: {
      homeTeam: true,
      awayTeam: true,
      goalScored: true,
      homeElo: true,
      awayElo: true,
      featuresJson: true,
      createdAt: true,
    },
    take: TAKE,
    orderBy: { createdAt: 'asc' },
  });

  if (logs.length < 30) {
    console.error(JSON.stringify({ error: `Need 30+ logs, got ${logs.length}` }));
    process.exit(1);
  }

  // 80/20 zaman sıralı split — replay sıralı olduğundan ilk %80 train, son %20 eval.
  const split = Math.floor(logs.length * DEV_FRAC);
  const train = logs.slice(0, split);
  const dev = logs.slice(split);

  // GAP state: train set üzerinde replay yaparak inşa et.
  const state = createGapRatingState();
  let matchesWithFeatures = 0;
  for (const log of train) {
    const features = extractGapFeatures(log.featuresJson);
    if (!features) continue;
    updateGapRating(state, log.homeTeam, log.awayTeam, features);
    matchesWithFeatures += 1;
  }

  function evaluate(batch: typeof logs) {
    const eps = 1e-15;
    let brierSumGap = 0;
    let brierSumElo = 0;
    let brierSumBlend = 0;
    let positives = 0;
    let gapActive = 0;

    for (const log of batch) {
      const o = log.goalScored ? 1 : 0;
      if (o === 1) positives++;

      const ed = (log.homeElo ?? 1500) - (log.awayElo ?? 1500);
      const eloP = Math.max(0.01, Math.min(0.99, 0.12 + (ed / 400) * 0.15));

      // GAP prediction: state'ten snapshot
      const gapPred = predictGapMatch(state, log.homeTeam, log.awayTeam);
      const gapPRaw = gapPred.gapP;
      const gapP = gapPRaw > 0 ? Math.max(eps, Math.min(1 - eps, gapPRaw)) : 0;

      // Blend: α · gapP + (1 - α) · eloP
      const blendP = Math.max(eps, Math.min(1 - eps,
        ALPHA * gapP + (1 - ALPHA) * eloP,
      ));

      brierSumElo += (eloP - o) ** 2;
      if (gapPRaw > 0) {
        brierSumGap += (gapP - o) ** 2;
        gapActive++;
      }
      brierSumBlend += (blendP - o) ** 2;
    }

    const n = batch.length;
    return {
      gap: brierSumGap / Math.max(1, gapActive),
      elo: brierSumElo / n,
      blend: brierSumBlend / n,
      positiveRate: positives / n,
      gapCoverage: gapActive / n,
    };
  }

  const m = evaluate(dev);

  const out: Result = {
    brierGap: m.gapActive > 0 ? Math.round(m.gap * 10000) / 10000 : null,
    brierElo: Math.round(m.elo * 10000) / 10000,
    brierBlend: ALPHA > 0 ? Math.round(m.blend * 10000) / 10000 : null,
    alpha: ALPHA,
    totalUpdates: state.totalUpdates,
    matchesWithFeatures,
    dev: {
      n: dev.length,
      positiveRate: Math.round(m.positiveRate * 1000) / 1000,
    },
    params: { ...ov, take: TAKE, devFrac: DEV_FRAC },
  };

  console.log(JSON.stringify(out));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
