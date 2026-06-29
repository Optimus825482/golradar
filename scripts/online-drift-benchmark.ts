#!/usr/bin/env bun
/**
 * Online Drift Benchmark (A3)
 *
 * Son N kayıt üzerinden per-model online adjustment faktörlerini (0.8x–1.2x)
 * accuracy-based olarak hesaplar. Production'da recordPrediction ile her
 * resolved sinyal/kayıt toplanır; applyOnlineAdjustments ensemble.ts'te
 * bir sonraki tahminde bunları uygular.
 *
 * Bu benchmark:
 *   1. PredictionLog.goalScored etiketli kayıtları okur (rule-based olarak).
 *   2. Her kayıt için predicted=calibratedP, actual=goalScored üretir.
 *   3. computeOnlineAdjustments'ın ürettiği faktörleri ve per-model accuracy
 *      trendini raporlar.
 *
 * Çıktı JSON: { totalRecords, totalModels, modelAccuracy, topModel,
 *               adjustmentFactors, n: <sample>, positiveRate }
 *
 * Kullanım:
 *   bun scripts/online-drift-benchmark.ts                # defaults
 *   bun scripts/online-drift-benchmark.ts --window=500   # son 500
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

const TAKE = ov.take ?? 10000;
const WINDOW = ov.window ?? 500;

interface Result {
  totalRecords: number;
  totalModels: number;
  perModelAccuracy: Record<string, { n: number; correct: number; accuracy: number }>;
  topModel: string | null;
  adjustmentFactors: Record<string, number>;
  maxAccuracy: number;
  n: number;
  positiveRate: number;
  params: Record<string, number>;
}

async function run() {
  // Sadece labeled kayıtları değerlendir.
  const logs = await db.predictionLog.findMany({
    where: {
      goalScored: { not: null },
    },
    select: { calibratedP: true, goalScored: true },
    take: TAKE,
    orderBy: { createdAt: 'desc' },
  });

  if (logs.length < 30) {
    console.error(JSON.stringify({ error: `Need 30+ logs, got ${logs.length}` }));
    process.exit(1);
  }

  // Online adjustment mantığı: sliding window, accuracy-based weighting.
  // Burada "rule" modelini simüle ediyoruz — production'da her sinyal
  // resolved olduktan sonra recordPrediction çağrılır.
  const records: Array<{ model: string; predicted: number; actual: number }> = [];
  for (const log of logs) {
    records.push({
      model: 'rule',
      predicted: log.calibratedP ?? 0.5,
      actual: log.goalScored ? 1 : 0,
    });
  }

  // Son WINDOW kayda sınırla
  const window = records.slice(0, WINDOW);

  // Per-model accuracy
  const perModel: Record<string, { n: number; correct: number }> = {};
  let positives = 0;
  for (const r of window) {
    if (!perModel[r.model]) perModel[r.model] = { n: 0, correct: 0 };
    perModel[r.model].n++;
    const isCorrect = (r.predicted > 0.5) === (r.actual === 1);
    if (isCorrect) perModel[r.model].correct++;
    if (r.actual === 1) positives++;
  }

  const perModelAccuracy: Result['perModelAccuracy'] = {};
  let maxAccuracy = 0;
  let topModel: string | null = null;
  for (const [model, stats] of Object.entries(perModel)) {
    const accuracy = stats.n > 0 ? stats.correct / stats.n : 0.5;
    perModelAccuracy[model] = { n: stats.n, correct: stats.correct, accuracy };
    if (accuracy > maxAccuracy) {
      maxAccuracy = accuracy;
      topModel = model;
    }
  }

  // Normalize: en iyi model 1.2x, en kötü 0.8x — weightTuner.computeOnlineAdjustments mantığı
  const adjustmentFactors: Record<string, number> = {};
  if (maxAccuracy > 0) {
    for (const [model, stats] of Object.entries(perModel)) {
      const acc = stats.n > 0 ? stats.correct / stats.n : 0.5;
      adjustmentFactors[model] = Math.round((0.8 + 0.4 * (acc / maxAccuracy)) * 1000) / 1000;
    }
  }

  const out: Result = {
    totalRecords: records.length,
    totalModels: Object.keys(perModel).length,
    perModelAccuracy: Object.fromEntries(
      Object.entries(perModelAccuracy).map(([k, v]) => [
        k,
        {
          n: v.n,
          correct: v.correct,
          accuracy: Math.round(v.accuracy * 1000) / 1000,
        },
      ]),
    ),
    topModel,
    adjustmentFactors,
    maxAccuracy: Math.round(maxAccuracy * 1000) / 1000,
    n: window.length,
    positiveRate: Math.round((positives / Math.max(1, window.length)) * 1000) / 1000,
    params: { ...ov, take: TAKE, window: WINDOW },
  };

  console.log(JSON.stringify(out));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
