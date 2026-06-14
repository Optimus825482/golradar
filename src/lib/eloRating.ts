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

const K_BASE = 30;
const HOME_ADVANTAGE = 80;
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

export function updateRatings(home: string, away: string, homeGoals: number, awayGoals: number): { home: EloRating; away: EloRating } {
  const ratings = loadRatings();
  const homeKey = normalizeTeamName(home) || home;
  const awayKey = normalizeTeamName(away) || away;
  const defaultRating = (): EloRating => ({ rating: INITIAL_RATING, matchesPlayed: 0, lastUpdated: Date.now(), recentResults: [] });
  let homeRating: EloRating = ratings.get(homeKey) || defaultRating();
  let awayRating: EloRating = ratings.get(awayKey) || defaultRating();

  const homeR = homeRating.rating + HOME_ADVANTAGE;
  const eHome = expectedScore(homeR, awayRating.rating);
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
    rating: Math.round(homeRating.rating + kHome * (sHome - eHome)),
    matchesPlayed: homeRating.matchesPlayed + 1,
    lastUpdated: Date.now(),
    recentResults: [homeResult, ...homeRating.recentResults].slice(0, 10) as ('W' | 'D' | 'L')[],
  };
  awayRating = {
    rating: Math.round(awayRating.rating + kAway * (sAway - eAway)),
    matchesPlayed: awayRating.matchesPlayed + 1,
    lastUpdated: Date.now(),
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
  const eDraw = 0.08 + Math.random() * 0.04;
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

export function eloGoalAdjustment(home: string, away: string, currentMinute: number = 0): { homeAdjust: number; awayAdjust: number } {
  const pred = predictFromElo(home, away);
  const isLate = currentMinute >= 75;
  const isVeryLate = currentMinute >= 85;
  const diff = pred.ratingDiff;
  let homeAdjust = diff > 50 ? (isVeryLate ? 8 : isLate ? 5 : 2) : diff > 0 ? (isLate ? 3 : 1) : 0;
  let awayAdjust = diff < -50 ? (isVeryLate ? 8 : isLate ? 5 : 2) : diff < 0 ? (isLate ? 3 : 1) : 0;
  return { homeAdjust, awayAdjust };
}
