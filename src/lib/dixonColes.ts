// ── Dixon-Coles Poisson Model ──────────────────────────────────
// Implements the Dixon-Coles (1997) model for football match prediction.
// Key features:
//   - Poisson regression with attack/defense parameters
//   - Low-score correction (τ parameter) for 0-0, 1-0, 0-1, 1-1
//   - Exponential time-decay weighting (ξ ≈ 0.00325)
//   - Home advantage factor (γ ≈ 1.35)
//   - Full 9×9 score probability matrix
//   - Over/Under, BTTS, 1X2 probability extraction
//
// Reference: Dixon & Coles (1997), "Modelling Association Football Scores
// and Inefficiencies in the Football Betting Market"

interface TeamStrength {
  attack: number;     // α: attack strength (relative to average = 1.0)
  defense: number;    // β: defense weakness (relative to average = 1.0)
  elo: number;        // Elo rating for Bayesian prior
  matchesPlayed: number;
  lastUpdated: number; // timestamp
}

export interface PoissonParams {
  lambdaHome: number; // Expected goals for home team
  lambdaAway: number; // Expected goals for away team
  rho: number;        // Dixon-Coles dependency parameter
  gamma: number;      // Home advantage factor
}

export interface ScoreProbability {
  homeGoals: number;
  awayGoals: number;
  probability: number;
}

export interface MatchProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
  overUnder: { [threshold: number]: { over: number; under: number } };
  btts: { yes: number; no: number };
  correctScore: ScoreProbability[];
  poissonMatrix: number[][]; // 9×9
  params: PoissonParams;
}

// ── Per-league home advantage (γ) ───────────────────────────────
// Replaces hardcoded 1.10 — source: historical goal ratios 2020-2026.
export const LEAGUE_GAMMA: Record<number, number> = {
  0: 1.10,   // default / unknown
  1: 1.12,   // Premier League
  2: 1.08,   // La Liga
  3: 1.14,   // Bundesliga
  4: 1.06,   // Serie A
  5: 1.09,   // Ligue 1
  6: 1.18,   // Süper Lig
  7: 1.13,   // Primeira Liga
  10: 1.17,  // Eredivisie
  11: 1.10,  // Championship
  100: 1.12, // Champions League
  101: 1.10, // Europa League
};

// ── Precomputed log factorial table (O(1) Poisson PMF) ──────────
const LOG_FACT_TABLE: number[] = (() => {
  const t = new Array(541).fill(0);
  for (let i = 2; i < t.length; i++) t[i] = t[i - 1] + Math.log(i);
  return t;
})();

// ── Poisson PMF ──────────────────────────────────────────────────
function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // Use log to avoid overflow for large lambda
  const logP = k * Math.log(lambda) - lambda - logFactorial(k);
  return Math.exp(logP);
}

function logFactorial(n: number): number {
  if (n <= 1) return 0;
  if (n < LOG_FACT_TABLE.length) return LOG_FACT_TABLE[n];
  // Fallback for n >= 541: Stirling approximation
  return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n);
}

// ── Dixon-Coles τ correction ─────────────────────────────────────
// Adjusts probabilities for low-scoring outcomes to account for
// dependency between home and away goals.
function dixonColesTau(i: number, j: number, lambdaHome: number, lambdaAway: number, rho: number): number {
  if (i === 0 && j === 0) return 1 - (lambdaHome * lambdaAway * rho);
  if (i === 0 && j === 1) return 1 + (lambdaHome * rho);
  if (i === 1 && j === 0) return 1 + (lambdaAway * rho);
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

// ── Time-decay weighting ─────────────────────────────────────────
// W(t) = exp(-ξ × t), where t = days since match.
// Exported as decayStrength for callers (backfill, feature extraction).
export function decayStrength(
  current: number,
  daysAgo: number,
  revertToMean: number = 1.0,
  xi: number = 0.00325,
): number {
  if (daysAgo <= 0) return current;
  const w = Math.exp(-xi * daysAgo);
  // Exponential decay toward revertToMean: new = mean + (cur - mean) * W(t)
  return revertToMean + (current - revertToMean) * w;
}

export function timeDecayWeight(daysAgo: number, xi: number = 0.00325): number {
  return Math.exp(-xi * daysAgo);
}

// ── Calculate expected goals from team strengths ─────────────────
export function calculateExpectedGoals(
  homeAttack: number,    // α_home
  awayDefense: number,   // β_away
  awayAttack: number,    // α_away
  homeDefense: number,   // β_home
  avgGoalsHome: number = 1.35,  // League average home goals
  avgGoalsAway: number = 1.15,  // League average away goals
  gamma?: number,               // Optional — falls back to LEAGUE_GAMMA[0]
): PoissonParams {
  const effectiveGamma = gamma ?? LEAGUE_GAMMA[0];
  // λ_home = α_home × β_away × γ × avg_home
  const lambdaHome = homeAttack * awayDefense * effectiveGamma * avgGoalsHome;
  // λ_away = α_away × β_home × avg_away
  const lambdaAway = awayAttack * homeDefense * avgGoalsAway;

  return {
    lambdaHome: Math.max(0.01, lambdaHome),
    lambdaAway: Math.max(0.01, lambdaAway),
    rho: -0.13,  // Typical ρ from Dixon-Coles fitting (negative = more draws)
    gamma: effectiveGamma,
  };
}

// ── Generate full probability matrix ─────────────────────────────
export function calculateMatchProbabilities(
  params: PoissonParams,
  maxGoals: number = 9,
): MatchProbabilities {
  const { lambdaHome, lambdaAway, rho } = params;
  const matrix: number[][] = [];
  const allScores: ScoreProbability[] = [];
  let homeWin = 0, draw = 0, awayWin = 0;

  // Build 9×9 matrix with Dixon-Coles correction
  for (let i = 0; i < maxGoals; i++) {
    matrix[i] = [];
    for (let j = 0; j < maxGoals; j++) {
      const tau = dixonColesTau(i, j, lambdaHome, lambdaAway, rho);
      const pHome = poissonPmf(i, lambdaHome);
      const pAway = poissonPmf(j, lambdaAway);
      const p = Math.max(0, tau * pHome * pAway);
      matrix[i][j] = p;

      allScores.push({ homeGoals: i, awayGoals: j, probability: p });

      if (i > j) homeWin += p;
      else if (i === j) draw += p;
      else awayWin += p;
    }
  }

  // Normalize to 1.0 (the 9×9 matrix doesn't capture all probability)
  const total = homeWin + draw + awayWin;
  if (total > 0) {
    homeWin /= total;
    draw /= total;
    awayWin /= total;
  }

  // Over/Under probabilities
  const overUnder: { [threshold: number]: { over: number; under: number } } = {};
  for (const threshold of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    let under = 0;
    for (const score of allScores) {
      if (score.homeGoals + score.awayGoals < threshold) under += score.probability;
    }
    under /= total;
    overUnder[threshold] = { over: 1 - under, under };
  }

  // BTTS (Both Teams To Score)
  let bttsNo = 0;
  for (const score of allScores) {
    if (score.homeGoals === 0 || score.awayGoals === 0) bttsNo += score.probability;
  }
  bttsNo /= total;
  const btts = { yes: 1 - bttsNo, no: bttsNo };

  // Top 10 most likely correct scores
  const correctScore = allScores
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 10);

  return {
    homeWin,
    draw,
    awayWin,
    overUnder,
    btts,
    correctScore,
    poissonMatrix: matrix,
    params,
  };
}

// ── Estimate team strength from xG data ──────────────────────────
// Uses xG for/against from recent matches to estimate attack/defense.
// Exported for callers (backfill, feature engineering).
export function estimateTeamStrength(
  xgForPerMatch: number[],    // xG scored in recent matches
  xgAgainstPerMatch: number[], // xG conceded in recent matches
  leagueAvgXgFor: number = 1.30,   // League average xG per match
  leagueAvgXgAgainst: number = 1.30,
): { attack: number; defense: number } {
  const n = xgForPerMatch.length;
  if (n === 0) return { attack: 1.0, defense: 1.0 };

  const avgXgFor = xgForPerMatch.reduce((a, b) => a + b, 0) / n;
  const avgXgAgainst = xgAgainstPerMatch.reduce((a, b) => a + b, 0) / n;

  // Attack strength = team avg / league avg
  // Defense weakness = team avg conceded / league avg conceded
  const attack = Math.max(0.3, Math.min(3.0, avgXgFor / leagueAvgXgFor));
  const defense = Math.max(0.3, Math.min(3.0, avgXgAgainst / leagueAvgXgAgainst));

  return { attack, defense };
}

// ── In-play goal probability from Poisson model ──────────────────
// P(at least 1 goal in remaining time) based on current xG rates
export function inPlayGoalProbability(
  currentHomeXg: number,
  currentAwayXg: number,
  minute: number,
  maxMinute: number = 90,
): {
  homeGoalP: number;
  awayGoalP: number;
  anyGoalP: number;
  expectedHomeRemaining: number;
  expectedAwayRemaining: number;
} {
  // Extrapolate xG rate to remaining time
  const homeXgRate = currentHomeXg / Math.max(1, minute); // xG per minute
  const awayXgRate = currentAwayXg / Math.max(1, minute);

  // Expected remaining xG
  const expectedHomeRemaining = homeXgRate * (maxMinute - minute);
  const expectedAwayRemaining = awayXgRate * (maxMinute - minute);

  // P(at least 1 goal) = 1 - P(0 goals) = 1 - exp(-λ_remaining)
  const homeGoalP = 1 - Math.exp(-expectedHomeRemaining);
  const awayGoalP = 1 - Math.exp(-expectedAwayRemaining);

  // P(any team scores) = 1 - P(neither scores)
  const anyGoalP = 1 - Math.exp(-(expectedHomeRemaining + expectedAwayRemaining));

  return {
    homeGoalP: Math.min(0.95, homeGoalP),
    awayGoalP: Math.min(0.95, awayGoalP),
    anyGoalP: Math.min(0.98, anyGoalP),
    expectedHomeRemaining,
    expectedAwayRemaining,
  };
}

// ── Dixon-Coles blend with existing Goal Radar score ─────────────
// Blends the Poisson model output with the existing rule-based score.
// Exported for ensemble layer callers.
export function blendWithPoisson(
  ruleBasedScore: number,   // 0-100 from existing Goal Radar
  poissonAnyGoalP: number,  // 0-1 from Dixon-Coles
  blendWeight: number = 0.25, // How much Poisson to blend (25%)
): number {
  const poissonScore = poissonAnyGoalP * 100;
  const blended = ruleBasedScore * (1 - blendWeight) + poissonScore * blendWeight;
  return Math.max(0, Math.min(85, Math.round(blended)));
}

// ── Time-based goal probability (research-calibrated) ────────────
// Goal distribution per 15-min interval (from literature)
const GOAL_TIME_DISTRIBUTION: Record<string, { rate: number; multiplier: number }> = {
  '1-15':   { rate: 0.12, multiplier: 0.70 },  // Lowest rate, dampen
  '16-30':  { rate: 0.15, multiplier: 0.88 },
  '31-45':  { rate: 0.17, multiplier: 1.05 },  // Uptick before HT
  '46-60':  { rate: 0.17, multiplier: 1.00 },
  '61-75':  { rate: 0.19, multiplier: 1.12 },
  '76-90+': { rate: 0.22, multiplier: 1.30 },  // Peak — fatigue, desperation
};

export function getTimeBasedGoalMultiplier(minute: number): number {
  if (minute <= 15) return GOAL_TIME_DISTRIBUTION['1-15'].multiplier;
  if (minute <= 30) return GOAL_TIME_DISTRIBUTION['16-30'].multiplier;
  if (minute <= 45) return GOAL_TIME_DISTRIBUTION['31-45'].multiplier;
  if (minute <= 60) return GOAL_TIME_DISTRIBUTION['46-60'].multiplier;
  if (minute <= 75) return GOAL_TIME_DISTRIBUTION['61-75'].multiplier;
  return GOAL_TIME_DISTRIBUTION['76-90+'].multiplier;
}
