#!/usr/bin/env bun
/**
 * Poisson Blend Weight Grid Search — 2-phase (coarse → fine)
 * Grid searches 4 phase weights: early (0-30), mid (30-60), late (60-75), final (75-90+)
 */
import { db } from '../src/lib/db';

const ov: Record<string, number> = {};
for (const a of process.argv.slice(2)) { const m = a.match(/^--(\w+)=([\d.]+)$/); if (m) ov[m[1]] = parseFloat(m[2]); }

function blendWgh(min: number, w: number[]): number {
  if (min < 30) return w[0]; if (min < 60) return w[1]; if (min < 75) return w[2]; return w[3];
}

async function run() {
  const logs = await db.predictionLog.findMany({
    where: { goalScored: { not: null }, poissonHomeP: { not: null }, poissonAwayP: { not: null } },
    select: { rawScore: true, minute: true, goalScored: true, homeScore: true, awayScore: true, poissonHomeP: true, poissonAwayP: true },
    take: 50000, orderBy: { createdAt: 'desc' },
  });
  if (logs.length < 500) { console.error(JSON.stringify({ error: logs.length })); process.exit(1); }

  const split = Math.floor(logs.length * 0.7);
  const dev = logs.slice(0, split);
  const test = logs.slice(split);
  const eps = 1e-15;

  function evalWeights(w: number[], batch: typeof dev): number {
    let sum = 0;
    for (const log of batch) {
      const ph = log.poissonHomeP ?? 0; const pa = log.poissonAwayP ?? 0;
      const ap = 1 - (1 - ph) * (1 - pa);
      const min = log.minute ?? 45;
      const bw = blendWgh(min, w);
      const hs = Math.round((log.homeScore ?? 50) * (1 - bw) + ap * 100 * bw);
      const as = Math.round((log.awayScore ?? 50) * (1 - bw) + ap * 100 * bw * 0.7);
      const fs = Math.round(0.7 * Math.max(hs, as) + 0.3 * ((hs + as) / 2));
      const p = Math.max(eps, Math.min(1 - eps, fs / 100));
      const o = log.goalScored ? 1 : 0;
      sum += (p - o) ** 2;
    }
    return sum / batch.length;
  }

  // Phase 1: coarse — 5 steps each
  let best = [0.15, 0.12, 0.10, 0.08];
  let bestBrier = evalWeights(best, dev);
  const coarse = [0.05, 0.10, 0.15, 0.20, 0.25];

  for (const w0 of coarse) {
    for (const w1 of coarse) {
      for (const w2 of coarse) {
        for (const w3 of coarse) {
          const brier = evalWeights([w0, w1, w2, w3], dev.slice(0, 5000));
          if (brier < bestBrier) { bestBrier = brier; best = [w0, w1, w2, w3]; }
        }
      }
    }
  }
  console.error(`Coarse best: [${best}] Brier=${bestBrier.toFixed(5)}`);

  // Phase 2: fine — refined around best
  for (const [i, base] of best.entries()) {
    const range = [Math.max(0.03, base - 0.05), Math.min(0.30, base + 0.05)];
    for (let v = range[0]; v <= range[1]; v += 0.02) {
      const candidate = [...best]; candidate[i] = Math.round(v * 100) / 100;
      const brier = evalWeights(candidate, dev.slice(0, 10000));
      if (brier < bestBrier) { bestBrier = brier; best = candidate; }
    }
  }

  const testBrier = evalWeights(best, test);
  const defBrier = evalWeights([0.15, 0.12, 0.10, 0.08], test);

  console.log(JSON.stringify({
    brierScore: Math.round(testBrier * 100000) / 100000,
    defaultBrier: Math.round(defBrier * 100000) / 100000,
    total: logs.length,
    bestWeights: best,
  }));
}

run().catch(e => { console.error(JSON.stringify({ error: e.message })); process.exit(1); });
