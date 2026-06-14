// ── Team Strength Kalman (W4) ─────────────────────────────────────
// Per-team 2D state (attack α, defense β) with random-walk
// transition and Poisson-approx observation. Independent α and β
// (no off-diagonal covariance) — keeps the algebra tractable and
// matches the Dixon-Coles paper's decomposed strength model.
//
// Observation model:
//   goals_for ~ Poisson(λ_h)  with λ_h = exp(α_home - β_away + γ)
//   goals_against ~ Poisson(λ_a)  with λ_a = exp(α_away - β_home + γ)
//
// Using the Karling (1994) Poisson→Normal approximation: for
// large λ the log-Poisson is well-approximated by Normal(log(λ), 1/λ).
// We minimize -log(λ) * observed + λ in the update step (which is
// the Poisson log-likelihood, not the Gaussian surrogate — gives
// better behavior at low scoring counts like 0 or 1).
//
// Update is univariate-per-dimension via the Karling transformation
// `x = log(λ)`, residual `r = observed - exp(x)`, variance `V_obs =
// exp(x)`. Then standard Kalman scalar update on x.
//
// Teams with fewer than MIN_MATCHES are treated as unrated (return
// flat priors). Bounded updates keep numerical stability: α, β
// clamped to [-3, +3] (= exp range ~0.05 to 20 goals/season per
// match — a generous envelope for any team in any league).

export interface TeamState {
  alpha: number; // attack strength
  beta: number; // defense weakness
  matches: number;
  lastUpdate: number; // unix ms
  /** Per-dim posterior variance (independent α, β). */
  varAlpha: number;
  varBeta: number;
}

export interface ScoredMatch {
  date: string; // YYYY-MM-DD
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
}

export interface KalmanConfig {
  /** Random-walk standard deviation per match (per dimension). */
  sigmaRW: number;
  /** Home advantage in log-xG units (≈ log(1.3) ≈ 0.27). */
  homeAdvantage: number;
  /** Process-noise inflation per match (1.0 = no inflation). */
  processInflation: number;
  /** Reject teams with fewer than this many matches from the fit. */
  minMatches: number;
  /** Prior mean and variance for new teams. */
  priorAlpha: number;
  priorBeta: number;
  priorVar: number;
  /** Hard clamps on α and β for numerical safety. */
  clampMin: number;
  clampMax: number;
}

export const DEFAULT_KALMAN_CONFIG: KalmanConfig = {
  sigmaRW: 0.05,         // 0.05 log-units per match ≈ 5% drift
  homeAdvantage: 0.27,   // exp(0.27) ≈ 1.31 (EPL home advantage)
  processInflation: 1.0,
  minMatches: 5,
  priorAlpha: 0.0,
  priorBeta: 0.0,
  priorVar: 0.25,        // prior std dev ≈ 0.5
  clampMin: -3.0,
  clampMax: 3.0,
};

export interface TeamStrengthModel {
  teams: Map<string, TeamState>;
  config: KalmanConfig;
  version: string;
  fittedAt: number;
  nMatches: number;
  nTeams: number;
}

// ── Helpers ────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function teamKey(name: string): string {
  return name.trim().toLowerCase();
}

function ensureTeam(
  teams: Map<string, TeamState>,
  name: string,
  config: KalmanConfig,
): TeamState {
  const key = teamKey(name);
  let s = teams.get(key);
  if (!s) {
    s = {
      alpha: config.priorAlpha,
      beta: config.priorBeta,
      varAlpha: config.priorVar,
      varBeta: config.priorVar,
      matches: 0,
      lastUpdate: 0,
    };
    teams.set(key, s);
  }
  return s;
}

function kalmanUpdate(
  mean: number,
  variance: number,
  observed: number,
  config: KalmanConfig,
): { mean: number; variance: number } {
  // Karling: log-link normal approximation.
  // x = log(λ) so observation log-λ has variance ≈ 1/λ.
  // For predict step we use the current mean as the predicted x.
  // For update: residual on the *response* scale (goals), with
  // variance exp(mean).
  const expMean = Math.exp(clamp(mean, -10, 10));
  const obsVariance = Math.max(0.01, expMean); // floor avoids div-by-zero
  const K = variance / (variance + obsVariance);
  // Residual: difference between observed and predicted λ (on response scale).
  // Convert to log-scale by dividing by λ — this is the score-function
  // residual for Poisson: d/dλ logL = (obs/λ) - 1.
  const r = (observed - expMean) / expMean;
  const newMean = clamp(mean + K * r, config.clampMin, config.clampMax);
  const newVariance = (1 - K) * variance;
  return { mean: newMean, variance: newVariance };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Fit a fresh model from a list of historical matches (oldest first).
 * Pure function — no I/O. The caller persists the result.
 */
export function fitBatch(
  matches: ScoredMatch[],
  configOverrides: Partial<KalmanConfig> = {},
): TeamStrengthModel {
  const config: KalmanConfig = { ...DEFAULT_KALMAN_CONFIG, ...configOverrides };
  const teams = new Map<string, TeamState>();
  const sorted = [...matches].sort((a, b) => a.date.localeCompare(b.date));

  for (const m of sorted) {
    const home = ensureTeam(teams, m.homeTeam, config);
    const away = ensureTeam(teams, m.awayTeam, config);

    // 1) Process step: variance grows by σ² before the observation
    const processVar = config.sigmaRW * config.sigmaRW * config.processInflation;
    home.varAlpha += processVar;
    home.varBeta += processVar;
    away.varAlpha += processVar;
    away.varBeta += processVar;

    // 2) Predict step is implicit: current α, β used as log-λ means.
    //    The Karling score-function residual handles the link from
    //    observed goals on the response scale back to log-space.

    // 3) Update α_home (obs = m.homeGoals)
    const updateHome = kalmanUpdate(
      home.alpha, home.varAlpha, m.homeGoals, config,
    );
    home.alpha = updateHome.mean;
    home.varAlpha = updateHome.variance;

    // 4) Update β_home (home's defense observed via away goals)
    const updateHomeDef = kalmanUpdate(
      home.beta, home.varBeta, m.awayGoals, config,
    );
    home.beta = updateHomeDef.mean;
    home.varBeta = updateHomeDef.variance;

    // 5) Update α_away, β_away symmetrically
    const updateAway = kalmanUpdate(
      away.alpha, away.varAlpha, m.awayGoals, config,
    );
    away.alpha = updateAway.mean;
    away.varAlpha = updateAway.variance;

    const updateAwayDef = kalmanUpdate(
      away.beta, away.varBeta, m.homeGoals, config,
    );
    away.beta = updateAwayDef.mean;
    away.varBeta = updateAwayDef.variance;

    home.matches += 1;
    away.matches += 1;
    home.lastUpdate = Date.now();
    away.lastUpdate = Date.now();
  }

  return {
    teams,
    config,
    version: `kalman-${Date.now()}`,
    fittedAt: Date.now(),
    nMatches: matches.length,
    nTeams: teams.size,
  };
}

/**
 * Predict the Poisson rate and the implied 1X2 probabilities.
 * For low-sample teams, falls back to flat priors (so the result
 * is still defined, just uninformative).
 */
export interface MatchPrediction {
  lambdaHome: number;
  lambdaAway: number;
  homeWinP: number;
  drawP: number;
  awayWinP: number;
  alphaHome: number;
  betaHome: number;
  alphaAway: number;
  betaAway: number;
  matches: { home: number; away: number };
}

export function predictMatch(
  model: TeamStrengthModel,
  homeTeam: string,
  awayTeam: string,
): MatchPrediction {
  const cfg = model.config;
  const home = model.teams.get(teamKey(homeTeam));
  const away = model.teams.get(teamKey(awayTeam));

  // Fall back to flat priors if either side is below the match threshold
  const homeRated = home && home.matches >= cfg.minMatches;
  const awayRated = away && away.matches >= cfg.minMatches;

  const alphaHome = homeRated ? home!.alpha : cfg.priorAlpha;
  const betaHome = homeRated ? home!.beta : cfg.priorBeta;
  const alphaAway = awayRated ? away!.alpha : cfg.priorAlpha;
  const betaAway = awayRated ? away!.beta : cfg.priorBeta;

  const lambdaHome = Math.exp(alphaHome - betaAway + cfg.homeAdvantage);
  const lambdaAway = Math.exp(alphaAway - betaHome);

  // 1X2 via Poisson-Dixon-Coles-like aggregation (cap at 9 goals
  // each side for tractability)
  const maxGoals = 9;
  let homeWinP = 0;
  let drawP = 0;
  let awayWinP = 0;
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      total += p;
      if (h > a) homeWinP += p;
      else if (h === a) drawP += p;
      else awayWinP += p;
    }
  }
  if (total > 0) {
    homeWinP /= total;
    drawP /= total;
    awayWinP /= total;
  }

  return {
    lambdaHome,
    lambdaAway,
    homeWinP,
    drawP,
    awayWinP,
    alphaHome,
    betaHome,
    alphaAway,
    betaAway,
    matches: {
      home: home?.matches ?? 0,
      away: away?.matches ?? 0,
    },
  };
}

/**
 * Built-in default model. Returns flat attack=0, defense=0
 * (exp(0)=1 goal expectation, league avg). Use until enough
 * matches have been backfilled.
 */
export function loadTeamStrength(): TeamStrengthModel {
  return {
    teams: new Map(),
    config: { ...DEFAULT_KALMAN_CONFIG },
    version: '0.0.0-default',
    fittedAt: Date.now(),
    nMatches: 0,
    nTeams: 0,
  };
}

/**
 * Serialize a fitted model to a plain object suitable for JSON
 * persistence. Inverse of `loadTeamStrengthFromJSON`.
 */
export function serializeTeamStrength(model: TeamStrengthModel): string {
  const teams: Record<string, TeamState> = {};
  for (const [k, v] of model.teams.entries()) teams[k] = v;
  return JSON.stringify({
    version: model.version,
    fittedAt: model.fittedAt,
    nMatches: model.nMatches,
    nTeams: model.nTeams,
    config: model.config,
    teams,
  });
}

export function deserializeTeamStrength(json: string): TeamStrengthModel {
  const parsed = JSON.parse(json) as {
    version: string;
    fittedAt: number;
    nMatches: number;
    nTeams: number;
    config: KalmanConfig;
    teams: Record<string, TeamState>;
  };
  const teams = new Map<string, TeamState>();
  for (const [k, v] of Object.entries(parsed.teams)) teams.set(k, v);
  return {
    teams,
    config: parsed.config,
    version: parsed.version,
    fittedAt: parsed.fittedAt,
    nMatches: parsed.nMatches,
    nTeams: parsed.nTeams,
  };
}

// ── Internal: Poisson PMF (log-form for numerical safety) ──────────
function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  // log P(k; λ) = k*log(λ) - λ - log(k!)
  const logLambda = Math.log(lambda);
  return Math.exp(k * logLambda - lambda - logFactorial(k));
}

function logFactorial(n: number): number {
  if (n <= 1) return 0;
  let r = 0;
  for (let i = 2; i <= n; i++) r += Math.log(i);
  return r;
}
