// ── Elo Rating System for Football ───────────────────────────────
// Reference: Elo, A.E. (1978). "The Rating of Chessplayers, Past and Present"

export interface EloRating {
  rating: number;
  matchesPlayed: number;
  lastUpdated: number;
  recentResults: ('W' | 'D' | 'L')[];
}

export interface EloPrediction {
  homeWinP: number;
  drawP: number;
  awayWinP: number;
  homeRating: number;
  awayRating: number;
  ratingDiff: number;
}

function getServerFs(): { fs: any; path: any } | null {
  if (typeof window !== 'undefined') return null;
  try {
    return { fs: require('fs'), path: require('path') };
  } catch { return null; }
}

const s = getServerFs();
const path = s?.path;
const DATA_DIR = path ? path.join(process.cwd(), 'data', 'elo-ratings') : '';
const RATINGS_FILE = DATA_DIR && path ? path.join(DATA_DIR, 'ratings.json') : '';

const K_BASE = 50;
const HOME_ADVANTAGE = 50;
const INITIAL_RATING = 1500;
const PROVISIONAL_THRESHOLD = 10;

let ratingsCache: Map<string, EloRating> | null = null;
let cacheLoaded = false;

function ensureDataDir(): void {
  const s2 = getServerFs();
  if (!s2) return;
  if (!s2.fs.existsSync(DATA_DIR)) {
    s2.fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadRatings(): Map<string, EloRating> {
  if (cacheLoaded && ratingsCache) return ratingsCache;
  try {
    const s2 = getServerFs();
    if (!s2) { ratingsCache = new Map(); cacheLoaded = true; return ratingsCache; }
    ensureDataDir();
    if (s2.fs.existsSync(RATINGS_FILE)) {
      const data: Record<string, EloRating> = JSON.parse(s2.fs.readFileSync(RATINGS_FILE, 'utf-8'));
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
    const s2 = getServerFs();
    if (!s2) return;
    ensureDataDir();
    const obj: Record<string, EloRating> = {};
    ratingsCache.forEach((v, k) => { obj[k] = v; });
    s2.fs.writeFileSync(RATINGS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('[Elo] Failed to save ratings:', e);
  }
}

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i').replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u').replace(/ç/g, 'c')
    .replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ı/g, 'i').replace(/ö/g, 'o')
    .replace(/ü/g, 'u').replace(/[^a-z0-9\s]/g, '').trim();
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function kFactor(rating: EloRating, goalDiff: number): number {
  let k = K_BASE;
  if (rating.matchesPlayed < PROVISIONAL_THRESHOLD) { k = K_BASE * 1.5; }
  if (goalDiff >= 2) k *= 1 + (goalDiff - 1) * 0.15;
  if (goalDiff >= 4) k *= 1.15;
  if (goalDiff >= 6) k *= 1.2;
  return Math.min(k, K_BASE * 3);
}

// P1.5: Time-decayed prior — ratings fade toward 1500 (league mean) over
// days since last match. ξ = 0.00325/day, half-life ≈ 213 days.
// Synchronous lazy import via require (CommonJS) to keep updateRatings sync.
let _decayFn: ((current: number, daysAgo: number, revert: number) => number) | null = null;
function getDecayFn(): (current: number, daysAgo: number, revert: number) => number {
  if (_decayFn) return _decayFn;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./dixonColes');
    _decayFn = (current, daysAgo, revert) => mod.decayStrength(current, daysAgo, revert, 0.00325);
  } catch {
    _decayFn = (current) => current; // graceful fallback if require fails
  }
  return _decayFn;
}

export function updateRatings(home: string, away: string, homeGoals: number, awayGoals: number): { home: EloRating; away: EloRating } {
  const ratings = loadRatings();
  const homeKey = normalizeTeamName(home) || home;
  const awayKey = normalizeTeamName(away) || away;
  const defaultRating = (): EloRating => ({ rating: INITIAL_RATING, matchesPlayed: 0, lastUpdated: Date.now(), recentResults: [] });
  let homeRating: EloRating = ratings.get(homeKey) || defaultRating();
  let awayRating: EloRating = ratings.get(awayKey) || defaultRating();

  // P1.5: Apply time decay to pre-match rating — old ratings fade to mean
  const now = Date.now();
  const homeDaysAgo = Math.max(0, (now - (homeRating.lastUpdated || now)) / 86_400_000);
  const awayDaysAgo = Math.max(0, (now - (awayRating.lastUpdated || now)) / 86_400_000);
  const decayFn = getDecayFn();
  const homeR_pre = decayFn(homeRating.rating, homeDaysAgo, INITIAL_RATING);
  const awayR_pre = decayFn(awayRating.rating, awayDaysAgo, INITIAL_RATING);

  const homeR = homeR_pre + HOME_ADVANTAGE;
  const eHome = expectedScore(homeR, awayR_pre);
  const eAway = 1 - eHome;

  let sHome: number, sAway: number;
  if (homeGoals > awayGoals) { sHome = 1; sAway = 0; }
  else if (homeGoals < awayGoals) { sHome = 0; sAway = 1; }
  else { sHome = 0.5; sAway = 0.5; }

  const goalDiff = Math.abs(homeGoals - awayGoals);
  const kHome = kFactor(homeRating, goalDiff);
  const kAway = kFactor(awayRating, goalDiff);

  const homeResult: ('W' | 'D' | 'L') = sHome === 1 ? 'W' : sHome === 0.5 ? 'D' : 'L';
  const awayResult: ('W' | 'D' | 'L') = sAway === 1 ? 'W' : sAway === 0.5 ? 'D' : 'L';
  homeRating = {
    rating: Math.round(homeR_pre + kHome * (sHome - eHome)),
    matchesPlayed: homeRating.matchesPlayed + 1,
    lastUpdated: now,
    recentResults: [homeResult, ...homeRating.recentResults].slice(0, 10) as ('W' | 'D' | 'L')[],
  };
  awayRating = {
    rating: Math.round(awayR_pre + kAway * (sAway - eAway)),
    matchesPlayed: awayRating.matchesPlayed + 1,
    lastUpdated: now,
    recentResults: [awayResult, ...awayRating.recentResults].slice(0, 10) as ('W' | 'D' | 'L')[],
  };

  ratings.set(homeKey, homeRating);
  ratings.set(awayKey, awayRating);
  ratingsCache = ratings;
  saveRatings();
  return { home: homeRating, away: awayRating };
}

export function importMatchResults(matches: Array<{ homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }>): void {
  for (const m of matches) {
    updateRatings(m.homeTeam, m.awayTeam, m.homeScore, m.awayScore);
  }
}

export function predictFromElo(home: string, away: string): EloPrediction {
  const ratings = loadRatings();
  const homeKey = normalizeTeamName(home) || home;
  const awayKey = normalizeTeamName(away) || away;
  const homeR = ratings.get(homeKey)?.rating ?? INITIAL_RATING;
  const awayR = ratings.get(awayKey)?.rating ?? INITIAL_RATING;
  const eHome = expectedScore(homeR + HOME_ADVANTAGE, awayR);
  const eAway = 1 - eHome;
  const eDraw = Math.max(0.05, 0.30 * Math.exp(-Math.abs(homeR - awayR) / 300));
  const adjustedHome = eHome * (1 - eDraw);
  const adjustedAway = eAway * (1 - eDraw);
  return {
    homeWinP: Math.round(adjustedHome * 1000) / 1000,
    drawP: Math.round(eDraw * 1000) / 1000,
    awayWinP: Math.round(adjustedAway * 1000) / 1000,
    homeRating: Math.round(homeR + HOME_ADVANTAGE),
    awayRating: Math.round(awayR),
    ratingDiff: Math.round(homeR + HOME_ADVANTAGE - awayR),
  };
}

export function getRating(team: string): { rating: number; matchesPlayed: number; lastUpdated: number; recentResults: string[] } | null {
  const ratings = loadRatings();
  const key = normalizeTeamName(team) || team;
  return ratings.get(key) ?? null;
}

export function getAllRatings(): Map<string, EloRating> {
  return loadRatings();
}

export function getFormIndex(team: string): number {
  const rating = getRating(team);
  if (!rating || rating.recentResults.length < 3) return 0;
  const results = [...rating.recentResults].reverse();
  let score = 0;
  for (const r of results.slice(-5)) {
    if (r === 'W') score += 2;
    else if (r === 'D') score += 1;
  }
  return score / Math.min(5, results.length) / 2;
}

// P1.2: Exponential weighted form index — recent matches count more.
// β=0.85 → ~2-week half-life. Replaces flat summation.
export function getFormIndexEma(team: string, beta: number = 0.85): number {
  const rating = getRating(team);
  if (!rating || rating.recentResults.length === 0) return 0.5;
  // recentResults is most-recent-first; reverse for chronological.
  const chrono = [...rating.recentResults].reverse();
  let weighted = 0;
  let totalWeight = 0;
  for (let i = 0; i < chrono.length; i++) {
    const w = Math.pow(beta, chrono.length - 1 - i);
    const v = chrono[i] === 'W' ? 1 : chrono[i] === 'D' ? 0.5 : 0;
    weighted += v * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0.5;
}

export function eloGoalAdjustment(home: string, away: string, currentMinute: number = 0): { homeAdjust: number; awayAdjust: number } {
  const pred = predictFromElo(home, away);
  const isLate = currentMinute >= 75;
  const isVeryLate = currentMinute >= 85;
  const diff = pred.ratingDiff;
  let homeAdjust = diff > 50 ? (isVeryLate ? 8 : isLate ? 5 : 2) : diff > 0 ? (isLate ? 3 : 1) : 0;
  let awayAdjust = diff < -50 ? (isVeryLate ? 8 : isLate ? 5 : 2) : diff < 0 ? (isLate ? 3 : 1) : 0;
  return { homeAdjust, awayAdjust };
}

/**
 * Directly set a team's Elo rating (used by import/admin).
 * Unlike updateRatings(), this doesn't simulate a match.
 */
export function setRating(team: string, rating: number, matchesPlayed?: number): EloRating {
  const ratings = loadRatings();
  const key = normalizeTeamName(team) || team;
  const existing = ratings.get(key);
  const entry: EloRating = {
    rating: Math.round(rating),
    matchesPlayed: matchesPlayed ?? existing?.matchesPlayed ?? 0,
    lastUpdated: Date.now(),
    recentResults: existing?.recentResults ?? [],
  };
  ratings.set(key, entry);
  ratingsCache = ratings;
  saveRatings();
  return entry;
}

/**
 * Bulk set ratings from an external source.
 * Returns count of imported teams.
 */
export function bulkSetRatings(entries: Array<{ team: string; rating: number; matchesPlayed?: number }>): number {
  const ratings = loadRatings();
  let count = 0;
  for (const e of entries) {
    const key = normalizeTeamName(e.team) || e.team;
    if (!key || e.rating < 500 || e.rating > 3000) continue;
    const existing = ratings.get(key);
    ratings.set(key, {
      rating: Math.round(e.rating),
      matchesPlayed: e.matchesPlayed ?? existing?.matchesPlayed ?? 0,
      lastUpdated: Date.now(),
      recentResults: existing?.recentResults ?? [],
    });
    count++;
  }
  ratingsCache = ratings;
  saveRatings();
  return count;
}

/**
 * Check which teams from a list are missing Elo ratings.
 * Returns the team names that need ratings.
 */
export function getTeamsNeedingRatings(teams: string[]): string[] {
  const ratings = loadRatings();
  return teams.filter(t => {
    const key = normalizeTeamName(t) || t;
    return !ratings.has(key);
  });
}

/**
 * Auto-fetch Elo ratings from ClubElo for teams that don't have ratings yet.
 * Runs in background — doesn't block the caller.
 * Returns a promise that resolves to the number of teams imported.
 */
export async function autoFetchMissingRatings(teams: string[]): Promise<number> {
  const missing = getTeamsNeedingRatings(teams);
  if (missing.length === 0) return 0;

  // Try to fetch from ClubElo in background
  const results: Array<{ team: string; rating: number }> = [];
  for (const team of missing) {
    try {
      const resp = await fetch(`http://api.clubelo.com/${team}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) continue;
      const csv = await resp.text();
      const lines = csv.trim().split('\n');
      if (lines.length < 2) continue;
      const lastLine = lines[lines.length - 1];
      const parts = lastLine.split(',');
      const rating = parseFloat(parts[1]);
      if (!isNaN(rating) && rating >= 500 && rating <= 3000) {
        results.push({ team, rating });
      }
    } catch {
      // Skip failed fetches silently
    }
  }

  if (results.length > 0) {
    return bulkSetRatings(results);
  }
  return 0;
}
