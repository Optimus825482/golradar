// ── Elo Rating System for Football ───────────────────────────────
// Implements a modified Elo rating system adapted for football.
// Key features:
//   - K-factor with goal difference multiplier
//   - Home advantage bonus (~80 Elo points)
//   - Match importance weighting
//   - In-memory cache with file persistence
//   - Pre-match win probability from Elo differential
//
// Reference: Elo, A.E. (1978). "The Rating of Chessplayers, Past and Present"

// File system imports - only used server-side
let fs: any;
let path: any;
if (typeof window === 'undefined') {
  try {
    fs = require('fs');
    path = require('path');
  } catch {}
}

export interface EloRating {
  rating: number;
  matchesPlayed: number;
  lastUpdated: number; // timestamp
  recentResults: ('W' | 'D' | 'L')[]; // last 10 results for form
}

export interface EloPrediction {
  homeWinP: number;
  drawP: number;
  awayWinP: number;
  homeRating: number;
  awayRating: number;
  ratingDiff: number;
}

const DATA_DIR = typeof window === 'undefined' && path ? path.join(process.cwd(), 'data', 'elo-ratings') : '';
const RATINGS_FILE = DATA_DIR ? path.join(DATA_DIR, 'ratings.json') : '';

// Elo constants
const K_BASE = 30;                // Base K-factor
const HOME_ADVANTAGE = 80;        // Home advantage in Elo points
const INITIAL_RATING = 1500;      // Starting rating for new teams
const PROVISIONAL_THRESHOLD = 10; // Matches before full K-factor

// In-memory cache
let ratingsCache: Map<string, EloRating> | null = null;
let cacheLoaded = false;

// ── File Persistence ─────────────────────────────────────────────

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadRatings(): Map<string, EloRating> {
  if (cacheLoaded && ratingsCache) return ratingsCache;

  try {
    ensureDataDir();
    if (fs.existsSync(RATINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf-8'));
      ratingsCache = new Map(Object.entries(data));
    } else {
      ratingsCache = new Map();
    }
  } catch {
    ratingsCache = new Map();
  }
  cacheLoaded = true;
  return ratingsCache;
}

function saveRatings(): void {
  if (!ratingsCache) return;
  try {
    ensureDataDir();
    const obj: Record<string, EloRating> = {};
    ratingsCache.forEach((v, k) => { obj[k] = v; });
    fs.writeFileSync(RATINGS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('[Elo] Failed to save ratings:', e);
  }
}

// ── Core Elo Functions ───────────────────────────────────────────

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export function getRating(teamName: string): EloRating {
  const ratings = loadRatings();
  const key = normalizeTeamName(teamName);
  const existing = ratings.get(key);
  if (existing) return { ...existing };
  return {
    rating: INITIAL_RATING,
    matchesPlayed: 0,
    lastUpdated: Date.now(),
    recentResults: [],
  };
}

export function getAllRatings(): Map<string, EloRating> {
  return loadRatings();
}

// Expected score (win probability) from Elo differential
// W_e = 1 / (1 + 10^((R_opponent - R_team) / 400))
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// Goal difference multiplier for K-factor
// Bigger wins → bigger rating changes
function goalDiffMultiplier(goalDiff: number): number {
  const absDiff = Math.abs(goalDiff);
  if (absDiff <= 1) return 1.0;
  if (absDiff === 2) return 1.5;
  return (11 + absDiff) / 8;
}

// Update ratings after a match result
export function updateRatings(
  homeTeam: string,
  awayTeam: string,
  homeGoals: number,
  awayGoals: number,
  matchImportance: number = 1.0, // 1.0 = league, 0.6 = friendly, 1.5 = playoff
): { homeNew: EloRating; awayNew: EloRating } {
  const ratings = loadRatings();
  const homeKey = normalizeTeamName(homeTeam);
  const awayKey = normalizeTeamName(awayTeam);

  const homeCurrent = ratings.get(homeKey) || {
    rating: INITIAL_RATING,
    matchesPlayed: 0,
    lastUpdated: Date.now(),
    recentResults: [],
  };
  const awayCurrent = ratings.get(awayKey) || {
    rating: INITIAL_RATING,
    matchesPlayed: 0,
    lastUpdated: Date.now(),
    recentResults: [],
  };

  // Add home advantage to home team rating for calculation
  const homeRatingWithHFA = homeCurrent.rating + HOME_ADVANTAGE;

  // Expected scores
  const homeExpected = expectedScore(homeRatingWithHFA, awayCurrent.rating);
  const awayExpected = expectedScore(awayCurrent.rating, homeRatingWithHFA);

  // Actual results
  const goalDiff = homeGoals - awayGoals;
  let homeActual: number, awayActual: number;
  if (goalDiff > 0) { homeActual = 1; awayActual = 0; }
  else if (goalDiff === 0) { homeActual = 0.5; awayActual = 0.5; }
  else { homeActual = 0; awayActual = 1; }

  // K-factor with adjustments
  const homeK = K_BASE * (homeCurrent.matchesPlayed < PROVISIONAL_THRESHOLD ? 1.5 : 1.0) *
                goalDiffMultiplier(goalDiff) * matchImportance;
  const awayK = K_BASE * (awayCurrent.matchesPlayed < PROVISIONAL_THRESHOLD ? 1.5 : 1.0) *
                goalDiffMultiplier(goalDiff) * matchImportance;

  // Rating updates: R_new = R_old + K × (W - W_e)
  const homeNewRating = homeCurrent.rating + homeK * (homeActual - homeExpected);
  const awayNewRating = awayCurrent.rating + awayK * (awayActual - awayExpected);

  // Update recent results (form)
  const homeResult: 'W' | 'D' | 'L' = goalDiff > 0 ? 'W' : goalDiff === 0 ? 'D' : 'L';
  const awayResult: 'W' | 'D' | 'L' = goalDiff < 0 ? 'W' : goalDiff === 0 ? 'D' : 'L';
  const homeRecent = [...homeCurrent.recentResults, homeResult].slice(-10);
  const awayRecent = [...awayCurrent.recentResults, awayResult].slice(-10);

  const homeNew: EloRating = {
    rating: Math.round(homeNewRating),
    matchesPlayed: homeCurrent.matchesPlayed + 1,
    lastUpdated: Date.now(),
    recentResults: homeRecent,
  };
  const awayNew: EloRating = {
    rating: Math.round(awayNewRating),
    matchesPlayed: awayCurrent.matchesPlayed + 1,
    lastUpdated: Date.now(),
    recentResults: awayRecent,
  };

  ratings.set(homeKey, homeNew);
  ratings.set(awayKey, awayNew);
  saveRatings();

  return { homeNew, awayNew };
}

// ── Pre-match prediction from Elo ────────────────────────────────
export function predictFromElo(homeTeam: string, awayTeam: string): EloPrediction {
  const homeElo = getRating(homeTeam);
  const awayElo = getRating(awayTeam);

  const homeRatingWithHFA = homeElo.rating + HOME_ADVANTAGE;
  const homeWinP = expectedScore(homeRatingWithHFA, awayElo.rating);

  // Draw probability estimation (Elo doesn't natively handle draws)
  // Use a logistic model: P(draw) ≈ f(rating_diff) where closer ratings → more draws
  // Approximation: P(draw) ≈ 0.26 × (1 - |P_home - 0.5|) × 2
  // Calibrated to ~26% base draw rate in football
  const ratingDiff = homeRatingWithHFA - awayElo.rating;
  const drawBase = 0.26;
  const drawReduction = Math.abs(homeWinP - 0.5) * 0.5;
  const drawP = Math.max(0.10, Math.min(0.35, drawBase - drawReduction));

  // Normalize probabilities
  const rawAwayP = 1 - homeWinP;
  const total = homeWinP + drawP + rawAwayP;

  return {
    homeWinP: Math.round((homeWinP / total) * 1000) / 1000,
    drawP: Math.round((drawP / total) * 1000) / 1000,
    awayWinP: Math.round((rawAwayP / total) * 1000) / 1000,
    homeRating: homeElo.rating,
    awayRating: awayElo.rating,
    ratingDiff,
  };
}

// ── Form index from recent results ───────────────────────────────
// Returns 0-1 scale: 1.0 = perfect form (all wins), 0.0 = all losses
export function getFormIndex(teamName: string): number {
  const elo = getRating(teamName);
  if (elo.recentResults.length === 0) return 0.5; // neutral
  let pts = 0;
  for (const r of elo.recentResults) {
    if (r === 'W') pts += 1.0;
    else if (r === 'D') pts += 0.4;
    // L = 0
  }
  return pts / elo.recentResults.length;
}

// ── Elo as Bayesian prior for Goal Radar ─────────────────────────
// Teams with higher Elo are more likely to score; this adjusts the
// baseline goal probability based on team strength differential
export function eloGoalAdjustment(
  homeTeam: string,
  awayTeam: string,
): { homeAdj: number; awayAdj: number } {
  const prediction = predictFromElo(homeTeam, awayTeam);
  // Convert win probability differential to goal adjustment
  // +5 for significant Elo advantage, -5 for disadvantage
  const homeAdj = Math.round((prediction.homeWinP - 0.40) * 25); // ±5 range
  const awayAdj = Math.round((prediction.awayWinP - 0.30) * 25);
  return {
    homeAdj: Math.max(-8, Math.min(8, homeAdj)),
    awayAdj: Math.max(-8, Math.min(8, awayAdj)),
  };
}

// ── Batch import from finished matches ───────────────────────────
export function importMatchResults(matches: Array<{
  home: string; away: string; homeGoals: number; awayGoals: number;
}>): void {
  for (const m of matches) {
    updateRatings(m.home, m.away, m.homeGoals, m.awayGoals);
  }
}
