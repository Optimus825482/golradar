#!/usr/bin/env bun
/**
 * Elo Benchmark — Match Outcome Prediction (not just goal occurrence)
 *
 * Measures Elo's ability to predict: home win / draw / away win
 * Metric: Multi-class Brier (lower = better) + classification accuracy
 *
 * Usage:
 *   bun scripts/elo-benchmark.ts                              # defaults
 *   bun scripts/elo-benchmark.ts --kBase=25 --homeAdv=70      # custom
 *
 * Output: JSON { brierMulti, accuracy, logLoss, ... }
 * brierMulti = multi-class Brier (0-2 scale, lower = better)
 */

import { db } from '../src/lib/db';

function parseArgs(): Record<string, number> {
  const params: Record<string, number> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=([\d.]+)$/);
    if (m) params[m[1]] = parseFloat(m[2]);
  }
  return params;
}

const overrides = parseArgs();

// ── Elo Parameters ────────────────────────────────────────────
const K_BASE = overrides.kBase ?? 30;
const HOME_ADVANTAGE = overrides.homeAdv ?? 80;
const INITIAL_RATING = 1500;
const PROVISIONAL_THRESHOLD = Math.round(overrides.provThreshold ?? 10);
const DECAY_RATE = overrides.decayRate ?? 0.00325;
const DRAW_PROB = overrides.drawProb ?? 0.10;

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function decayFn(current: number, daysAgo: number, revert: number): number {
  if (daysAgo <= 0) return current;
  return revert + (current - revert) * Math.exp(-DECAY_RATE * daysAgo);
}

function kFactor(matchesPlayed: number, goalDiff: number): number {
  let k = K_BASE;
  if (matchesPlayed < PROVISIONAL_THRESHOLD) k = K_BASE * 1.5;
  if (goalDiff >= 2) k *= 1 + (goalDiff - 1) * 0.15;
  if (goalDiff >= 4) k *= 1.15;
  if (goalDiff >= 6) k *= 1.2;
  return Math.min(k, K_BASE * 3);
}

function predictOutcome(homeR: number, awayR: number, drawP: number) {
  const eHome = expectedScore(homeR + HOME_ADVANTAGE, awayR);
  const eAway = 1 - eHome;
  return {
    homeWin: Math.round(eHome * (1 - drawP) * 1000) / 1000,
    draw: Math.round(drawP * 1000) / 1000,
    awayWin: Math.round(eAway * (1 - drawP) * 1000) / 1000,
  };
}

interface TeamState {
  rating: number;
  matchesPlayed: number;
  lastDate: Date;
}

interface BenchmarkResult {
  brierMulti: number;   // multi-class Brier (0 to 2, lower better)
  brierHomeWin: number; // binary Brier for home-win prediction
  logLoss: number;
  accuracy: number;     // match outcome accuracy
  homeWinAccuracy: number;
  n: number;
  nHome: number;
  nDraw: number;
  nAway: number;
  params: Record<string, number>;
}

async function run(): Promise<void> {
  const matches = await db.teamHistoryMatch.findMany({
    orderBy: { matchDate: 'asc' },
    take: 100000,
  });

  if (matches.length < 200) {
    console.error(JSON.stringify({ error: `Not enough: ${matches.length}` }));
    process.exit(1);
  }

  const splitIdx = Math.floor(matches.length * 0.8);
  const devMatches = matches.slice(0, splitIdx);
  const testMatches = matches.slice(splitIdx);

  function simulate(matchList: typeof matches) {
    const teams = new Map<string, TeamState>();
    let brierMulti = 0, brierBin = 0, logLossSum = 0;
    let correct = 0, correctHome = 0;
    let nHome = 0, nDraw = 0, nAway = 0;
    const eps = 1e-15;

    for (const m of matchList) {
      const matchDate = new Date(m.matchDate);
      const homeKey = m.homeTeam.toLowerCase();
      const awayKey = m.awayTeam.toLowerCase();

      let hs = teams.get(homeKey);
      let as_ = teams.get(awayKey);
      if (!hs) { hs = { rating: INITIAL_RATING, matchesPlayed: 0, lastDate: matchDate }; teams.set(homeKey, hs); }
      if (!as_) { as_ = { rating: INITIAL_RATING, matchesPlayed: 0, lastDate: matchDate }; teams.set(awayKey, as_); }

      const hDays = Math.max(0, (matchDate.getTime() - hs.lastDate.getTime()) / 86_400_000);
      const aDays = Math.max(0, (matchDate.getTime() - as_.lastDate.getTime()) / 86_400_000);
      const hR = decayFn(hs.rating, hDays, INITIAL_RATING);
      const aR = decayFn(as_.rating, aDays, INITIAL_RATING);

      // Multi-class prediction
      const pred = predictOutcome(hR, aR, DRAW_PROB);

      // Actual outcome
      const hg = m.homeGoals;
      const ag = m.awayGoals;
      let actualHome = 0, actualDraw = 0, actualAway = 0;
      if (hg > ag) { actualHome = 1; nHome++; }
      else if (hg < ag) { actualAway = 1; nAway++; }
      else { actualDraw = 1; nDraw++; }

      // Multi-class Brier
      const pH = Math.max(eps, Math.min(1 - eps, pred.homeWin));
      const pD = Math.max(eps, Math.min(1 - eps, pred.draw));
      const pA = Math.max(eps, Math.min(1 - eps, pred.awayWin));
      brierMulti += (pH - actualHome) ** 2 + (pD - actualDraw) ** 2 + (pA - actualAway) ** 2;

      // Binary Brier: home win vs not
      const oHome = actualHome;
      brierBin += (pH - oHome) ** 2;

      // Log loss (multi-class)
      const pActual = actualHome ? pH : actualDraw ? pD : pA;
      logLossSum += Math.log(Math.max(eps, pActual));

      // Accuracy
      const predictedOutcome = pred.homeWin >= pred.draw && pred.homeWin >= pred.awayWin ? 'H'
        : pred.draw >= pred.homeWin && pred.draw >= pred.awayWin ? 'D' : 'A';
      const actualOutcome = hg > ag ? 'H' : hg < ag ? 'A' : 'D';
      if (predictedOutcome === actualOutcome) correct++;
      if (predictedOutcome === 'H' && actualOutcome === 'H') correctHome++;

      // Update ratings
      let sH: number;
      if (hg > ag) sH = 1; else if (hg < ag) sH = 0; else sH = 0.5;
      const sA = 1 - sH;
      const gDiff = Math.abs(hg - ag);
      const eA = 1 - expectedScore(hR + HOME_ADVANTAGE, aR);
      const kH = kFactor(hs.matchesPlayed, gDiff);
      const kA = kFactor(as_.matchesPlayed, gDiff);

      hs.rating = Math.round(hR + kH * (sH - (1 - eA)));
      as_.rating = Math.round(aR + kA * (sA - eA));
      hs.matchesPlayed++;
      as_.matchesPlayed++;
      hs.lastDate = matchDate;
      as_.lastDate = matchDate;
    }

    return { brierMulti, brierBin, logLossSum, correct, correctHome, nHome, nDraw, nAway, n: matchList.length };
  }

  const dev = simulate(devMatches);
  const test = simulate(testMatches);

  const result: BenchmarkResult = {
    brierMulti: Math.round((test.brierMulti / test.n) * 10000) / 10000,
    brierHomeWin: Math.round((test.brierBin / test.n) * 10000) / 10000,
    logLoss: Math.round(-(test.logLossSum / test.n) * 10000) / 10000,
    accuracy: Math.round((test.correct / test.n) * 1000) / 1000,
    homeWinAccuracy: Math.round((test.correctHome / Math.max(1, test.nHome)) * 1000) / 1000,
    n: test.n,
    nHome: test.nHome,
    nDraw: test.nDraw,
    nAway: test.nAway,
    params: {
      kBase: K_BASE,
      homeAdvantage: HOME_ADVANTAGE,
      initialRating: INITIAL_RATING,
      decayRate: DECAY_RATE,
      drawProb: DRAW_PROB,
      provisionalThreshold: PROVISIONAL_THRESHOLD,
    },
  };

  console.log(JSON.stringify(result));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});
