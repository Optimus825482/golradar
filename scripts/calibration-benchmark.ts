#!/usr/bin/env bun
/**
 * Calibration Grid Search Benchmark
 *
 * Grid searches calibration sigmoid parameters (L, k, x0).
 * Backtests calibrated probabilities vs actual goal rates.
 *
 * Usage:
 *   bun scripts/calibration-benchmark.ts                     # defaults
 *   bun scripts/calibration-benchmark.ts --L=2.0 --k=0.15
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

// Calibration sigmoid: scaled = L / (1 + exp(-k*(x - x0)))
const L = ov.L ?? 1.0;     // ceiling
const K = ov.k ?? 0.20;    // steepness
const X0 = ov.x0 ?? 50;    // inflection point
const T = ov.T ?? 0.04;    // floor

function sigmoidCalibrate(raw: number, l: number, k: number, x0: number, t: number): number {
  const score01 = raw / 100;
  const calibrated = t + (l - t) / (1 + Math.exp(-k * (raw - x0)));
  return Math.max(0, Math.min(1, calibrated));
}

interface Result {
  brierScore: number;
  calibrationError: number;  // MAE between observed and predicted per bin
  totalPredictions: number;
  params: Record<string, number>;
}

async function run() {
  const logs = await db.predictionLog.findMany({
    where: {
      goalScored: { not: null },
    },
    select: { rawScore: true, goalScored: true },
    take: 100000,
  });

  if (logs.length < 30) {
    console.error(JSON.stringify({ error: `Need 30+, got ${logs.length}` }));
    process.exit(1);
  }

  // Split: 70/30
  const split = Math.floor(logs.length * 0.7);
  const devLogs = logs.slice(0, split);
  const testLogs = logs.slice(split);

  // Grid search on dev
  let bestBrier = 999;
  let bestL = L, bestK = K, bestX0 = X0, bestT = T;

  for (let l = 0.8; l <= 1.5; l += 0.1) {
    for (let k = 0.05; k <= 0.40; k += 0.05) {
      for (let x0 = 30; x0 <= 70; x0 += 5) {
        for (let t_ = 0.02; t_ <= 0.08; t_ += 0.01) {
          let brierSum = 0;
          const eps = 1e-15;
          for (const log of devLogs) {
            const p = sigmoidCalibrate(log.rawScore, l, k, x0, t_);
            const cp = Math.max(eps, Math.min(1 - eps, p));
            const o = log.goalScored ? 1 : 0;
            brierSum += (cp - o) ** 2;
          }
          const brier = brierSum / devLogs.length;
          if (brier < bestBrier) {
            bestBrier = brier;
            bestL = l; bestK = k; bestX0 = x0; bestT = t_;
          }
        }
      }
    }
  }

  // Evaluate on test
  let testBrier = 0, calError = 0;
  const bins = new Map<string, { count: number; goals: number; sumP: number }>();
  const eps = 1e-15;

  for (const log of testLogs) {
    const p = sigmoidCalibrate(log.rawScore, bestL, bestK, bestX0, bestT);
    const cp = Math.max(eps, Math.min(1 - eps, p));
    const o = log.goalScored ? 1 : 0;
    testBrier += (cp - o) ** 2;

    const bin = `${Math.floor(log.rawScore / 10) * 10}`;
    if (!bins.has(bin)) bins.set(bin, { count: 0, goals: 0, sumP: 0 });
    const b = bins.get(bin)!;
    b.count++; b.goals += o; b.sumP += cp;
  }

  // Calibration error: MAE per bin
  let binCount = 0;
  for (const [, b] of bins) {
    if (b.count < 10) continue;
    calError += Math.abs(b.goals / b.count - b.sumP / b.count);
    binCount++;
  }
  calError = binCount > 0 ? calError / binCount : 0;

  const result: Result = {
    brierScore: Math.round((testBrier / testLogs.length) * 100000) / 100000,
    calibrationError: Math.round(calError * 100000) / 100000,
    totalPredictions: logs.length,
    params: {
      L: Math.round(bestL * 100) / 100,
      k: Math.round(bestK * 100) / 100,
      x0: bestX0,
      T: Math.round(bestT * 100) / 100,
    },
  };

  console.log(JSON.stringify(result));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});
