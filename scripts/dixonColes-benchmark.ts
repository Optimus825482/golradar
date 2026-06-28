#!/usr/bin/env bun
/**
 * Dixon-Coles Grid Search Benchmark
 *
 * Grid searches: rho (dependency), gamma (home advantage), decay rate.
 * Tests on real Poisson 1X2 prediction accuracy.
 *
 * Usage:
 *   bun scripts/dixonColes-benchmark.ts                    # defaults
 *   bun scripts/dixonColes-benchmark.ts --rho=-0.08 --gamma=1.20
 */

import { db } from '../src/lib/db';
import {
  calculateExpectedGoals,
  calculateMatchProbabilities,
} from '../src/lib/dixonColes';

function parseArgs(): Record<string, number> {
  const p: Record<string, number> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--(\w+)=([\d.-]+)$/);
    if (m) p[m[1]] = parseFloat(m[2]);
  }
  return p;
}
const ov = parseArgs();

const RHO = ov.rho ?? -0.13;
const GAMMA = ov.gamma ?? 1.10;
const DECAY = ov.decay ?? 0.00325;
const TEAM_STRENGTH = ov.strength ?? 1.0; // default attack/defense (neutral)

interface TeamAccum {
  goalsFor: number;
  goalsAgainst: number;
  matches: number;
}

interface Result {
  brierMulti: number;
  accuracy: number;
  totalMatches: number;
  params: Record<string, number>;
}

async function run() {
  const matches = await db.teamHistoryMatch.findMany({
    orderBy: { matchDate: 'asc' },
    take: 50000,
  });

  if (matches.length < 500) {
    console.error(JSON.stringify({ error: matches.length }));
    process.exit(1);
  }

  const split = Math.floor(matches.length * 0.7);
  const devMatches = matches.slice(0, split);
  const testMatches = matches.slice(split);

  // Estimate team strengths from dev matches
  const teams = new Map<string, TeamAccum>();
  for (const m of devMatches) {
    const h = m.homeTeam; const a = m.awayTeam;
    if (!teams.has(h)) teams.set(h, { goalsFor: 0, goalsAgainst: 0, matches: 0 });
    if (!teams.has(a)) teams.set(a, { goalsFor: 0, goalsAgainst: 0, matches: 0 });
    const ht = teams.get(h)!; const at = teams.get(a)!;
    ht.goalsFor += m.homeGoals; ht.goalsAgainst += m.awayGoals; ht.matches++;
    at.goalsFor += m.awayGoals; at.goalsAgainst += m.homeGoals; at.matches++;
  }

  const allGf = [...teams.values()].reduce((s, t) => s + t.goalsFor, 0);
  const allM = [...teams.values()].reduce((s, t) => s + t.matches, 0);
  const leagueAvg = allM > 0 ? allGf / allM : 1.35;

  const attackMap = new Map<string, number>();
  const defenseMap = new Map<string, number>();
  for (const [name, t] of teams) {
    attackMap.set(name, (t.goalsFor / Math.max(1, t.matches)) / leagueAvg);
    defenseMap.set(name, (t.goalsAgainst / Math.max(1, t.matches)) / leagueAvg);
  }

  function simulate(matchList: typeof matches): { brierMulti: number; correct: number; n: number } {
    let brierSum = 0, correct = 0, n = 0;
    const eps = 1e-15;

    for (const m of matchList) {
      const hAtk = attackMap.get(m.homeTeam) ?? 1.0;
      const hDef = defenseMap.get(m.homeTeam) ?? 1.0;
      const aAtk = attackMap.get(m.awayTeam) ?? 1.0;
      const aDef = defenseMap.get(m.awayTeam) ?? 1.0;

      const params = calculateExpectedGoals(hAtk, aDef, aAtk, hDef, GAMMA);
      // Override rho
      params.rho = RHO;

      const probs = calculateMatchProbabilities(params);

      const h = m.homeGoals; const a = m.awayGoals;
      const actH = h > a ? 1 : 0;
      const actD = h === a ? 1 : 0;
      const actA = h < a ? 1 : 0;

      const pH = Math.max(eps, Math.min(1 - eps, probs.homeWin));
      const pD = Math.max(eps, Math.min(1 - eps, probs.draw));
      const pA = Math.max(eps, Math.min(1 - eps, probs.awayWin));

      brierSum += (pH - actH) ** 2 + (pD - actD) ** 2 + (pA - actA) ** 2;

      const pred = pH >= pD && pH >= pA ? 'H' : pD >= pH && pD >= pA ? 'D' : 'A';
      const actual = h > a ? 'H' : h < a ? 'A' : 'D';
      if (pred === actual) correct++;
      n++;
    }

    return { brierMulti: brierSum / n, correct, n };
  }

  const result = simulate(testMatches);

  const out: Result = {
    brierMulti: Math.round(result.brierMulti * 100000) / 100000,
    accuracy: Math.round((result.correct / result.n) * 1000) / 1000,
    totalMatches: matches.length,
    params: {
      rho: RHO, gamma: GAMMA, decay: DECAY, avgStrength: TEAM_STRENGTH,
    },
  };

  console.log(JSON.stringify(out));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});
