#!/usr/bin/env bun
/**
 * Ensemble Weight Grid Search Benchmark
 *
 * Backtests different ensemble weight combinations against PredictionLog.
 * Each log has goalScored (label) + individual model scores.
 *
 * Usage:
 *   bun scripts/ensemble-benchmark.ts                        # defaults
 *   bun scripts/ensemble-benchmark.ts --wr=0.35 --wp=0.25   # custom
 *
 * Output: JSON { brierScore, ... }
 * Lower brierScore = better ensemble blend.
 */

import { db } from '../src/lib/db';

function parseArgs(): Record<string, number> {
  const p: Record<string, number> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--(\w+)=([\d.]+)$/);
    if (m) p[m[1]] = parseFloat(m[2]);
  }
  return p;
}
const ov = parseArgs();

const WR = ov.wr ?? 0.35;
const WP = ov.wp ?? 0.25;
const WE = ov.we ?? 0.10;
const WM = ov.wm;
// If wm not specified, it's the remainder
const wm = WM ?? Math.max(0, 1 - WR - WP - WE);
const WTOTAL = WR + WP + WE + wm;

interface Result {
  brierScore: number;
  logLoss: number;
  accuracy: number;
  totalPredictions: number;
  weights: { ruleBased: number; poisson: number; elo: number; ml: number };
  params: Record<string, number>;
}

async function run() {
  const logs = await db.predictionLog.findMany({
    where: {
      goalScored: { not: null },
    },
    select: {
      rawScore: true,
      calibratedP: true,
      goalScored: true,
      homeElo: true,
      awayElo: true,
      poissonHomeP: true,
      poissonAwayP: true,
    },
    take: 100000,
  });

  if (logs.length < 30) {
    console.error(JSON.stringify({ error: `Need 30+ logs, got ${logs.length}` }));
    process.exit(1);
  }

  // Split: 80% dev, 20% test
  const split = Math.floor(logs.length * 0.8);
  const devLogs = logs.slice(0, split);
  const testLogs = logs.slice(split);

  function evaluate(batch: typeof logs): { brier: number; ll: number; acc: number } {
    let brierSum = 0, llSum = 0, correct = 0;
    const eps = 1e-15;

    for (const log of batch) {
      // Rule-based: rawScore mapped to 0-1 (same as production)
      const ruleP = Math.max(0.01, Math.min(0.99, (log.rawScore ?? 50) / 100));

      // Poisson: from stored Dixon-Coles output
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

      // Elo
      const ed = (log.homeElo ?? 1500) - (log.awayElo ?? 1500);
      const eloP = Math.max(0.01, Math.min(0.99, 0.12 + (ed / 400) * 0.15));

      // ML: calibratedP is best single estimate
      const mlP = Math.max(0.01, Math.min(0.99, log.calibratedP ?? 0.5));

      // Weighted ensemble
      const eP = (WR * ruleP + WP * poissonP + WE * eloP + wm * mlP) / WTOTAL;
      const p = Math.max(eps, Math.min(1 - eps, eP));
      const o = log.goalScored ? 1 : 0;

      brierSum += (p - o) ** 2;
      llSum += o * Math.log(p) + (1 - o) * Math.log(1 - p);
      if ((p > 0.12) === !!log.goalScored) correct++;
    }

    const n = batch.length;
    return {
      brier: brierSum / n,
      ll: -(llSum / n),
      acc: correct / n,
    };
  }

  // Find best weights on dev
  let bestBrier = 999;
  let bestWr = WR, bestWp = WP, bestWe = WE, bestWm = wm;

  for (let wr = 0.10; wr <= 0.50; wr += 0.05) {
    for (let wp = 0.05; wp <= 0.35; wp += 0.05) {
      for (let we = 0.05; we <= 0.20; we += 0.05) {
        const wml = 1 - wr - wp - we;
        if (wml < 0) continue;

        const devResult = {
          brierSum: 0 as number,
          n: 0,
        };
        const eps2 = 1e-15;
        for (const log of devLogs) {
          const ruleP = Math.max(0.01, Math.min(0.99, (log.rawScore ?? 50) / 100));
          let poissonP: number;
          if (log.poissonHomeP != null && log.poissonAwayP != null)
            poissonP = 1 - (1 - log.poissonHomeP) * (1 - log.poissonAwayP);
          else if (log.poissonHomeP != null) poissonP = log.poissonHomeP;
          else poissonP = 0.12;
          poissonP = Math.max(0.01, Math.min(0.99, poissonP));
          const ed2 = (log.homeElo ?? 1500) - (log.awayElo ?? 1500);
          const eloP = Math.max(0.01, Math.min(0.99, 0.12 + (ed2 / 400) * 0.15));
          const mlP = Math.max(0.01, Math.min(0.99, log.calibratedP ?? 0.5));
          const eP = wr * ruleP + wp * poissonP + we * eloP + wml * mlP;
          const p = Math.max(eps2, Math.min(1 - eps2, eP));
          const o = log.goalScored ? 1 : 0;
          devResult.brierSum += (p - o) ** 2;
          devResult.n++;
        }
        const brier = devResult.brierSum / devResult.n;
        if (brier < bestBrier) {
          bestBrier = brier;
          bestWr = wr; bestWp = wp; bestWe = we; bestWm = wml;
        }
      }
    }
  }

  // Evaluate best on test
  const testEval = evaluate(testLogs);
  const allEval = evaluate(logs);

  const result: Result = {
    brierScore: Math.round(testEval.brier * 100000) / 100000,
    logLoss: Math.round(testEval.ll * 10000) / 10000,
    accuracy: Math.round(testEval.acc * 1000) / 1000,
    totalPredictions: logs.length,
    weights: {
      ruleBased: Math.round(bestWr * 100) / 100,
      poisson: Math.round(bestWp * 100) / 100,
      elo: Math.round(bestWe * 100) / 100,
      ml: Math.round(bestWm * 100) / 100,
    },
    params: {
      wr: WR, wp: WP, we: WE, wm: wm,
      bestWr, bestWp, bestWe, bestWm: bestWm,
      devBrier: Math.round(bestBrier * 100000) / 100000,
      allBrier: Math.round(allEval.brier * 100000) / 100000,
    },
  };

  console.log(JSON.stringify(result));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});
