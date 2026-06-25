// NetScores API client — replaces FotMob
// Provides: match list, stats (28+ categories), events, xG, real-time via WebSocket
// API endpoints: /api/home, /api/recent, /api/ws, /api/game//football/{slug}-live-{id}

const NETSCORES_BASE = "https://www.netscores.com";

// User-Agent pool — rotating reduces Cloudflare's fingerprint score for
// repeated requests from the same egress IP. Picked per request from a
// small set of recent desktop Chrome builds.
const NETSCORES_UA_POOL: string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
];

function pickUserAgent(): string {
  return NETSCORES_UA_POOL[Math.floor(Math.random() * NETSCORES_UA_POOL.length)];
}

const NETSCORES_BASE_HEADERS = {
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9,tr-TR;q=0.8,tr;q=0.7",
  Referer: "https://www.netscores.com/",
  Origin: "https://www.netscores.com",
} as const;

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...NETSCORES_BASE_HEADERS,
    "User-Agent": pickUserAgent(),
    ...extra,
  };
}

// Backoff schedule (ms) for CF-blocked retries. Cap at 3 attempts total —
// beyond that the source is rate-limiting us, not transiently failing.
const CF_RETRY_DELAYS_MS = [800, 2000] as const;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Scrapling-based Cloudflare bypass ──
// Uses Scrapling's StealthyFetcher to bypass Cloudflare challenges.
// Falls back to direct Node.js fetch if Scrapling is unavailable.

import { scrapeUrl } from './scraper';

function getNsPath() {
  if (typeof window !== 'undefined') return null;
  try { return require('path'); } catch { return null; }
}
function getNsFs() {
  if (typeof window !== 'undefined') return null;
  try { return require('fs'); } catch { return null; }
}

let _scraplingScript: string | null = null;
function getScraplingScript(): string {
  if (!_scraplingScript) {
    const p = getNsPath();
    if (p) _scraplingScript = p.join(process.cwd(), "scripts", "netscores-fetch.py");
    else _scraplingScript = '';
  }
  return _scraplingScript!;
}

let scraplingAvailable: boolean | null = null;
function resolvePython(): string | null {
  if (_pythonPath !== undefined) return _pythonPath;
  const candidates: string[] = [];
  if (process.env.PYTHON_PATH) candidates.push(process.env.PYTHON_PATH);
  if (process.platform === 'win32') {
    candidates.push('python', 'python3', 'py');
  } else {
    candidates.push('python3', 'python');
  }
  const myfs = getNsFs();
  if (!myfs) { _pythonPath = null; return null; }
  for (const c of candidates) {
    try {
      if (myfs.existsSync(c)) {
        _pythonPath = c;
        return c;
      }
    } catch {
      // ignore
    }
  }
  _pythonPath = null;
  return null;
}
let _pythonPath: string | null | undefined = undefined;

// Fetch via Scrapling Python script (bypasses Cloudflare)
function fetchViaScrapling(url: string, timeoutMs: number = 20000): Promise<any> {
  const execFile = typeof window === 'undefined' ? require('child_process').execFile : null;
  return new Promise((resolve) => {
    const python = resolvePython();
    if (!python || !execFile) {
      console.error("Scrapling disabled: no python interpreter on PATH. Set PYTHON_PATH to enable.");
      scraplingAvailable = false;
      resolve(null);
      return;
    }
    const args = [getScraplingScript(), url, "--timeout", String(timeoutMs)];
    const timeout = setTimeout(() => {
      resolve(null); // Timeout - don't crash
    }, timeoutMs + 10000); // Extra buffer for Python startup

    execFile(python, args, { timeout: timeoutMs + 10000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      clearTimeout(timeout);
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          // Binary vanished between resolve and exec — invalidate cache.
          _pythonPath = undefined;
        }
        console.error("Scrapling exec error:", error.message);
        scraplingAvailable = false; // Mark as unavailable
        resolve(null);
        return;
      }

      try {
        // Scrapling outputs log lines to stderr, JSON result to stdout
        const lines = stdout.trim().split("\n");
        // Find the JSON line (starts with {)
        for (const line of lines) {
          if (line.trim().startsWith("{")) {
            const result = JSON.parse(line.trim());
            if (result.ok && result.data) {
              resolve(result.data);
            } else {
              console.error("Scrapling returned error:", result.error);
              resolve(null);
            }
            return;
          }
        }
        console.error("Scrapling: no JSON found in output");
        resolve(null);
      } catch (err: any) {
        console.error("Scrapling parse error:", err?.message);
        resolve(null);
      }
    });
  });
}

// ── Trainer sidecar Cloudflare bypass ──
// When the main container has no Python runtime (e.g. Alpine-based
// production image), proxy through the ml-trainer sidecar which has
// Python + Scrapling (curl_cffi) for CF challenge solving.

const TRAINER_NETSCORES_URL = process.env.ML_TRAINER_URL
  ? `${process.env.ML_TRAINER_URL}/netscores-proxy`
  : null;

async function fetchViaTrainerProxy(url: string): Promise<any> {
  if (!TRAINER_NETSCORES_URL) return null;
  try {
    const resp = await fetch(TRAINER_NETSCORES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, timeout_ms: 20000 }),
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) return null;
    const result = await resp.json();
    if (result.ok && result.data) return result.data;
    return null;
  } catch {
    return null;
  }
}

// Direct Node.js fetch (fast but Cloudflare may block)
async function fetchDirect(url: string): Promise<any> {
  try {
    const resp = await fetch(url, {
      headers: {
        ...buildHeaders({
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        }),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (resp.ok) {
      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return await resp.json();
      }
      if (contentType.includes("text/html") || contentType.includes("text/plain")) {
        const text = await resp.text();
        if (text.length < 200000) {
          try {
            return JSON.parse(text);
          } catch (e) { logError('netscores', e); }
        }
      }
    }
    // Detect a CF challenge page even when status is 200/403 with HTML
    // body — common when CF returns a JS challenge in plain text.
    if (resp.status === 403 || resp.status === 503) {
      return null;
    }
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.error("Direct fetch error:", err?.message || err);
    }
  }
  return null;
}

// Smart fetch: try direct first, fall back to Scrapling, then bridge.
// Retries on CF-block with a small backoff schedule. Each attempt uses a
// fresh User-Agent from the pool so consecutive challenges look like
// different browsers.
async function fetchWithCFBypass(url: string): Promise<any> {
  // Try direct fetch first (fastest)
  const directResult = await fetchWithCFRetry(url);
  if (directResult) return directResult;

  // Try trainer proxy early — it's the most reliable bypass since
  // ml-trainer has Python + curl_cffi. Try before local Python methods
  // to avoid slow process spawns.
  const trainerResult = await fetchViaTrainerProxy(url);
  if (trainerResult) return trainerResult;

  // Try Scrapling Python script — skip entirely when no Python on PATH
  // or when previously marked unavailable.
  if (scraplingAvailable !== false) {
    if (scraplingAvailable === null) {
      const python = resolvePython();
      if (!python) {
        scraplingAvailable = false;
      } else {
        try {
          const fs = await import("fs");
          scraplingAvailable = fs.existsSync(getScraplingScript());
        } catch {
          scraplingAvailable = false;
        }
      }
    }

    if (scraplingAvailable) {
      const scraplingResult = await fetchViaScrapling(url);
      if (scraplingResult) return scraplingResult;
    }
  }

  // Python bridge (curl_cffi with TLS fingerprint)
  if (resolvePython()) {
    const bridgeResult = await scrapeUrl(url, { type: 'json', referer: 'https://www.netscores.com/', timeout: 20000 });
    if (bridgeResult.ok && bridgeResult.data) return bridgeResult.data;
  }

  return null;
}

// Retries the direct Node.js path with exponential-ish backoff. The CF
// challenge cache lives ~30s on the edge; spacing requests with a fresh
// UA gives a meaningful chance of slipping past a sticky challenge.
async function fetchWithCFRetry(url: string): Promise<any> {
  for (let attempt = 0; attempt <= CF_RETRY_DELAYS_MS.length; attempt++) {
    const result = await fetchDirect(url);
    if (result) return result;
    if (attempt >= CF_RETRY_DELAYS_MS.length) break;
    await sleep(CF_RETRY_DELAYS_MS[attempt]);
  }
  return null;
}

// ── Types ──────────────────────────────────────────────────────

export interface NetScoresTeam {
  id: number;
  name: string;
  logo: string | null;
  url: string;
  aliases_names?: string[];
}

export interface NetScoresLeague {
  id: number;
  url: string;
  name: string;
  sort: number;
  country: {
    id: string;
    name: string;
    code: string;
    url: string;
  };
}

export interface NetScoresGame {
  id: number;
  url: string;
  slugId: number;
  sport: { name: string; url: string; slug: string };
  league: NetScoresLeague;
  teams: {
    home: NetScoresTeam;
    away: NetScoresTeam;
  };
  status: number;       // 0=upcoming, 1=live, 3=finished (could be others like halftime)
  finished_at: string | null;
  time: { start: string };
  score: {
    summary: { score1: string | null; score2: string | null };
    items?: Record<string, { number: number; home: string | null; away: string | null }>;
  };
  redcards: { home: number; away: number };
  title: string;
  timer: {
    is_ticking: boolean;
    current_minute: string | null;
    second: string | null;
    added_minutes: string | null;
    period: string | null;
  };
  stream_url: string;
}

export interface NetScoresStat {
  id: string;
  home: string;
  away: string;
}

export interface NetScoresGameDetail {
  id: number;
  url: string;
  sport: { name: string; url: string; slug: string };
  league: NetScoresLeague;
  teams: {
    home: NetScoresTeam;
    away: NetScoresTeam;
  };
  status: number;
  finished_at: string | null;
  time: { start: string };
  score: NetScoresGame['score'];
  redcards: { home: number; away: number };
  game_length: number | null;
  title: string;
  timer: NetScoresGame['timer'];
  stream_url: string;
  groups?: {
    home: { id: string; name: string; group_name: string; standings: any[] };
    away: { id: string; name: string; group_name: string; standings: any[] };
  };
  stadium: {
    name: string;
    city: string;
    country: string;
    capacity: number;
  } | null;
  stats: Record<string, NetScoresStat> | null;
  events: Record<string, { text: string }> | null;
  league_state?: {
    round: string | null;
    home_position: number;
    away_position: number;
  };
  situation?: {
    action: string;
    side: string;
    player: any;
    incoming_player: any;
  };
  ht_at: string | null;
  h2h?: Record<string, NetScoresGame>;
  missing_players?: { home: any[]; away: any[] };
}

// ── Map Nesine match code → NetScores game ID ──

interface NetScoresMapping {
  nesineCode: number;
  netscoresId: number;
  netscoresSlugId: number;
  netscoresUrl: string;
  confidence: number;
}

let mappingCache: { timestamp: number; date: string; mappings: NetScoresMapping[] } | null = null;
const MAPPING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Name normalization for matching (delegated to shared module)

import { normalizeTeamName, translateTeamName, nameSimilarity } from './teamNameNormalizer';
import { logError } from '@/lib/devLog';

// Extract slug ID from URL like "/football/xxx-live-127912"
function extractSlugId(url: string): number {
  const match = url.match(/-(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

// ── Fetch all games from NetScores /api/home ──

export async function fetchNetScoresGames(): Promise<NetScoresGame[]> {
  try {
    const data = await fetchWithCFBypass(`${NETSCORES_BASE}/api/home`);
    if (!data) {
      console.error("NetScores /api/home: no data returned (CF blocked?)");
      return [];
    }

    const games: NetScoresGame[] = [];
    const gamesMap = data?.result?.games || {};
    for (const [key, g] of Object.entries(gamesMap)) {
      const game = g as any;
      if (game.sport?.slug !== "football") continue;
      games.push({
        ...game,
        slugId: extractSlugId(game.url || ""),
      });
    }
    return games;
  } catch (error) {
    console.error("NetScores fetch error:", error);
    return [];
  }
}

// ── Build Nesine→NetScores match mapping ──

export async function buildNetScoresMappings(
  nesineMatches: { code: number; home: string; away: string; time: string }[]
): Promise<NetScoresMapping[]> {
  const today = new Date().toISOString().slice(0, 10);
  if (mappingCache && mappingCache.date === today && Date.now() - mappingCache.timestamp < MAPPING_CACHE_TTL) {
    return mappingCache.mappings;
  }

  const nsGames = await fetchNetScoresGames();
  const mappings: NetScoresMapping[] = [];

  for (const nm of nesineMatches) {
    let bestMatch: { game: NetScoresGame; confidence: number } | null = null;

    for (const g of nsGames) {
      // Check team name similarity, including aliases
      const homeNames = [g.teams.home.name, ...(g.teams.home.aliases_names || [])];
      const awayNames = [g.teams.away.name, ...(g.teams.away.aliases_names || [])];

      let bestHomeSim = 0;
      let bestAwaySim = 0;
      for (const hName of homeNames) {
        bestHomeSim = Math.max(bestHomeSim, nameSimilarity(nm.home, hName));
      }
      for (const aName of awayNames) {
        bestAwaySim = Math.max(bestAwaySim, nameSimilarity(nm.away, aName));
      }

      // Also try swapped home/away (some sources swap the order)
      let bestHomeSimSwap = 0;
      let bestAwaySimSwap = 0;
      for (const aName of awayNames) {
        bestHomeSimSwap = Math.max(bestHomeSimSwap, nameSimilarity(nm.home, aName));
      }
      for (const hName of homeNames) {
        bestAwaySimSwap = Math.max(bestAwaySimSwap, nameSimilarity(nm.away, hName));
      }

      const nameConf = Math.max(
        (bestHomeSim + bestAwaySim) / 2,
        (bestHomeSimSwap + bestAwaySimSwap) / 2
      );

      // Time match (within 15 min tolerance — netscores uses UTC, nesine uses Istanbul)
      let timeMatch = false;
      try {
        const nesineMinutes = parseInt(nm.time.split(":")[0]) * 60 + parseInt(nm.time.split(":")[1]);
        const gDate = new Date(g.time.start + "Z");
        const gIstanbul = new Date(gDate.getTime() + 3 * 60 * 60 * 1000);
        const gMinutes = gIstanbul.getUTCHours() * 60 + gIstanbul.getUTCMinutes();
        timeMatch = Math.abs(nesineMinutes - gMinutes) <= 15;
      } catch (e) { logError('netscores', e); }

      const conf = nameConf * (timeMatch ? 1.0 : 0.5);

      if (conf > 0.4 && (!bestMatch || conf > bestMatch.confidence)) {
        bestMatch = { game: g, confidence: conf };
      }
    }

    if (bestMatch) {
      mappings.push({
        nesineCode: nm.code,
        netscoresId: bestMatch.game.id,
        netscoresSlugId: bestMatch.game.slugId,
        netscoresUrl: bestMatch.game.url,
        confidence: bestMatch.confidence,
      });
    }
  }

  mappingCache = { timestamp: Date.now(), date: today, mappings };
  return mappings;
}

// ── Fetch game detail ──
// Try direct API first (clean JSON), then fall back to _payload.json (Nuxt SSR)

export async function fetchGameDetail(netscoresUrl: string): Promise<NetScoresGameDetail | null> {
  try {
    // Strategy 1: Direct /api/game/ endpoint — returns clean JSON
    const directApiUrl = `${NETSCORES_BASE}/api/game/${netscoresUrl}`;
    const directData = await fetchWithCFBypass(directApiUrl);
    if (directData) {
      const gameData = directData?.result?.game || directData?.game || directData;
      if (gameData && gameData.id) {
        return parseDirectApiResponse(gameData);
      }
    }

    // Strategy 2: _payload.json (Nuxt SSR payload — reference-based, harder to parse)
    const payloadUrl = `${NETSCORES_BASE}${netscoresUrl}/_payload.json`;
    const data = await fetchWithCFBypass(payloadUrl);

    if (!data) {
      console.error("NetScores game detail: no data returned from any method");
      return null;
    }

    // If data is an array, it's the Nuxt payload format (reference-based)
    if (Array.isArray(data)) {
      return extractGameDataFromPayload(data);
    }

    // If data has result.game structure, it's the direct API format
    const gameData = data?.result?.game || data?.game || data;
    if (gameData && gameData.id) {
      return parseDirectApiResponse(gameData);
    }

    console.error("NetScores game detail: unexpected data structure", Array.isArray(data) ? `array[${data.length}]` : typeof data);
    return null;
  } catch (error) {
    console.error("NetScores game detail fetch error:", error);
    return null;
  }
}

// ── Extract game data from Nuxt's compressed payload format ──

function extractGameDataFromPayload(payload: any[]): NetScoresGameDetail | null {
  try {
    if (!Array.isArray(payload) || payload.length === 0) return null;

    // Build a lookup: index → value
    const lookup = new Map<number, any>();
    for (let i = 0; i < payload.length; i++) {
      lookup.set(i, payload[i]);
    }

    // Resolve Nuxt's reference-based payload into concrete values.
    // Numbers in [0, payload.length) could be either references to
    // other payload entries OR legitimate primitive values (e.g.
    // status=0). To disambiguate: only resolve when the indexed
    // value exists AND is an object/array (references are always
    // objects in Nuxt's serialization). Primitives pass through.
    const resolve = (val: any, depth = 0): any => {
      if (depth > 15) return val;
      if (typeof val === "number" && val >= 0 && val < payload.length) {
        const resolved = lookup.get(val);
        // Only follow reference if target is an object/array (not a primitive)
        if (resolved !== undefined && (typeof resolved === "object" || Array.isArray(resolved))) {
          return resolve(resolved, depth + 1);
        }
      }
      if (Array.isArray(val)) return val.map(v => resolve(v, depth + 1));
      if (val && typeof val === "object") {
        const result: any = {};
        for (const [k, v] of Object.entries(val)) {
          result[k] = resolve(v, depth + 1);
        }
        return result;
      }
      return val;
    };

    // Find the game data object (has id, url, stats, events)
    for (let i = 0; i < payload.length; i++) {
      const item = payload[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;

      if (item.id !== undefined && item.url !== undefined && item.stats !== undefined) {
        const resolved = resolve(item);
        return buildGameDetailFromResolved(resolved);
      }
    }

    // Alternative: search for an object with game-like keys
    for (let i = 0; i < payload.length; i++) {
      const item = payload[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;

      const keys = Object.keys(item);
      if (keys.includes("id") && keys.includes("url") && keys.includes("teams") && keys.includes("score") && typeof item.id === "number") {
        const resolved = resolve(item);
        return buildGameDetailFromResolved(resolved);
      }
    }

    return null;
  } catch (error) {
    console.error("Payload extraction error:", error);
    return null;
  }
}

// Build a NetScoresGameDetail from resolved Nuxt payload data
function buildGameDetailFromResolved(resolved: any): NetScoresGameDetail | null {
  try {
    // Parse stats
    const rawStats = resolved.stats || null;
    let parsedStats: Record<string, NetScoresStat> | null = null;
    if (rawStats && typeof rawStats === "object") {
      parsedStats = {};
      if (rawStats.items) {
        for (const [key, val] of Object.entries(rawStats.items)) {
          if (val && typeof val === "object" && "home" in (val as any) && "away" in (val as any)) {
            parsedStats[key] = val as NetScoresStat;
          }
        }
      } else {
        for (const [key, val] of Object.entries(rawStats)) {
          if (val && typeof val === "object" && "home" in (val as any) && "away" in (val as any)) {
            parsedStats[key] = val as NetScoresStat;
          }
        }
      }
    }

    // Parse events
    const rawEvents = resolved.events || null;
    let parsedEvents: Record<string, { text: string }> | null = null;
    if (rawEvents && typeof rawEvents === "object") {
      parsedEvents = {};
      if (rawEvents.items) {
        for (const [key, val] of Object.entries(rawEvents.items)) {
          if (val && typeof val === "object" && "text" in (val as any)) {
            parsedEvents[key] = val as { text: string };
          }
        }
      } else {
        for (const [key, val] of Object.entries(rawEvents)) {
          if (val && typeof val === "object" && "text" in (val as any)) {
            parsedEvents[key] = val as { text: string };
          }
        }
      }
    }

    // Parse stadium
    const rawStadium = resolved.stadium || null;
    let parsedStadium: NetScoresGameDetail["stadium"] = null;
    if (rawStadium && typeof rawStadium === "object" && rawStadium.name) {
      parsedStadium = {
        name: rawStadium.name || "",
        city: rawStadium.city || "",
        country: rawStadium.country || "",
        capacity: rawStadium.capacity || 0,
      };
    }

    // Parse teams
    const teams = resolved.teams || {};
    const homeTeam = teams.home || {};
    const awayTeam = teams.away || {};

    // Parse league_state — validate types because Nuxt payload resolution can corrupt values
    let leagueState: NetScoresGameDetail["league_state"] = undefined;
    if (resolved.league_state && typeof resolved.league_state === "object") {
      const hp = resolved.league_state.home_position;
      const ap = resolved.league_state.away_position;
      // Only include if positions are actual numbers (Nuxt payload can corrupt them to objects)
      if ((typeof hp === "number" || typeof hp === "string") && (typeof ap === "number" || typeof ap === "string")) {
        leagueState = {
          round: typeof resolved.league_state.round === "string" ? resolved.league_state.round : null,
          home_position: typeof hp === "number" ? hp : parseInt(String(hp), 10) || 0,
          away_position: typeof ap === "number" ? ap : parseInt(String(ap), 10) || 0,
        };
      }
    }

    return {
      id: resolved.id,
      url: resolved.url || "",
      sport: resolved.sport || { name: "Football", url: "/football", slug: "football" },
      league: resolved.league || {},
      teams: {
        home: { id: homeTeam.id, name: homeTeam.name, logo: homeTeam.logo || null, url: homeTeam.url || "" },
        away: { id: awayTeam.id, name: awayTeam.name, logo: awayTeam.logo || null, url: awayTeam.url || "" },
      },
      status: typeof resolved.status === "number" ? resolved.status : 0,
      finished_at: typeof resolved.finished_at === "string" ? resolved.finished_at : null,
      time: resolved.time && typeof resolved.time === "object" && resolved.time.start ? resolved.time : { start: "" },
      score: resolved.score && typeof resolved.score === "object" && resolved.score.summary ? resolved.score : { summary: { score1: null, score2: null } },
      redcards: resolved.redcards && typeof resolved.redcards === "object" && typeof resolved.redcards.home === "number" ? resolved.redcards : { home: 0, away: 0 },
      game_length: typeof resolved.game_length === "number" ? resolved.game_length : null,
      title: typeof resolved.title === "string" ? resolved.title : "",
      timer: resolved.timer && typeof resolved.timer === "object" && typeof resolved.timer.current_minute !== "object" ? resolved.timer : { is_ticking: false, current_minute: null, second: null, added_minutes: null, period: null },
      stream_url: typeof resolved.stream_url === "string" ? resolved.stream_url : "",
      stadium: parsedStadium,
      stats: parsedStats,
      events: parsedEvents,
      league_state: leagueState,
      situation: resolved.situation && typeof resolved.situation === "object" && typeof resolved.situation.action === "string" ? resolved.situation : undefined,
      ht_at: typeof resolved.ht_at === "string" ? resolved.ht_at : null,
    };
  } catch (error) {
    console.error("Build game detail error:", error);
    return null;
  }
}

// Parse direct API response (format: {result: {game: {...}}})
function parseDirectApiResponse(gameData: any): NetScoresGameDetail | null {
  try {
    const rawStats = gameData.stats || null;
    let parsedStats: Record<string, NetScoresStat> | null = null;
    if (rawStats && typeof rawStats === "object") {
      parsedStats = {};
      for (const [key, val] of Object.entries(rawStats)) {
        if (val && typeof val === "object" && "home" in (val as any) && "away" in (val as any)) {
          parsedStats[key] = val as NetScoresStat;
        }
      }
    }

    const rawEvents = gameData.events || null;
    let parsedEvents: Record<string, { text: string }> | null = null;
    if (rawEvents && typeof rawEvents === "object") {
      parsedEvents = {};
      for (const [key, val] of Object.entries(rawEvents)) {
        if (val && typeof val === "object" && "text" in (val as any)) {
          parsedEvents[key] = val as { text: string };
        }
      }
    }

    const rawStadium = gameData.stadium || null;
    let parsedStadium: NetScoresGameDetail["stadium"] = null;
    if (rawStadium && typeof rawStadium === "object" && rawStadium.name) {
      parsedStadium = { name: rawStadium.name || "", city: rawStadium.city || "", country: rawStadium.country || "", capacity: rawStadium.capacity || 0 };
    }

    const teams = gameData.teams || {};
    const homeTeam = teams.home || {};
    const awayTeam = teams.away || {};

    return {
      id: gameData.id,
      url: gameData.url || "",
      sport: gameData.sport || { name: "Football", url: "/football", slug: "football" },
      league: gameData.league || {},
      teams: {
        home: { id: homeTeam.id, name: homeTeam.name, logo: homeTeam.logo || null, url: homeTeam.url || "", aliases_names: homeTeam.aliases_names },
        away: { id: awayTeam.id, name: awayTeam.name, logo: awayTeam.logo || null, url: awayTeam.url || "", aliases_names: awayTeam.aliases_names },
      },
      status: gameData.status,
      finished_at: gameData.finished_at || null,
      time: gameData.time || { start: "" },
      score: gameData.score || { summary: { score1: null, score2: null } },
      redcards: gameData.redcards || { home: 0, away: 0 },
      game_length: gameData.game_length || null,
      title: gameData.title || "",
      timer: gameData.timer || { is_ticking: false, current_minute: null, second: null, added_minutes: null, period: null },
      stream_url: gameData.stream_url || "",
      stadium: parsedStadium,
      stats: parsedStats,
      events: parsedEvents,
      league_state: gameData.league_state || undefined,
      situation: gameData.situation || undefined,
      ht_at: gameData.ht_at || null,
      h2h: gameData.h2h || undefined,
      missing_players: gameData.missing_players || undefined,
      groups: gameData.groups || undefined,
    };
  } catch (error) {
    console.error("Direct API parse error:", error);
    return null;
  }
}

// ── Convert NetScores stats to our app's MatchStats format ──

export function convertNetScoresStatsToMatchStats(
  nsStats: Record<string, NetScoresStat> | null
): Record<string, { home: number | null; away: number | null }> {
  if (!nsStats) return {};

  const result: Record<string, { home: number | null; away: number | null }> = {};

  // Map NetScores stat keys to our app's stat keys
  const keyMap: Record<string, string> = {
    "possession_rt": "possession",
    "attacks": "attacks",
    "dangerous_attacks": "dangerous_attacks",
    "on_target": "shots_on_target",
    "off_target": "shots_off_target",
    "goalattempts": "shots_total",
    "corners": "corners",
    "corner_f": "corners",
    "corner_h": "corner_h",
    "fouls": "fouls",
    "offsides": "offsides",
    "saves": "saves",
    "yellowcards": "yellow_cards",
    "redcards": "red_cards",
    "yellowred_cards": "yellow_red_cards",
    "substitutions": "substitutions",
    "xg": "xg",
    "key_passes": "key_passes",
    "crosses": "crosses",
    "crossing_accuracy": "crossing_accuracy",
    "shots_blocked": "shots_blocked",
    "passing_accuracy": "passing_accuracy",
    "action_areas": "action_areas",
    "ball_safe": "ball_safe",
    "goals": "goals",
    "penalties": "penalties",
    "injuries": "injuries",
  };

  for (const [nsKey, stat] of Object.entries(nsStats)) {
    const ourKey = keyMap[nsKey] || nsKey;
    const homeVal = parseFloat(stat.home);
    const awayVal = parseFloat(stat.away);
    result[ourKey] = {
      home: isNaN(homeVal) ? null : homeVal,
      away: isNaN(awayVal) ? null : awayVal,
    };
  }

  return result;
}

// ── Convert NetScores events to FotMob-compatible event format ──

export interface NetScoresConvertedEvent {
  time: number;
  type: string;
  isHome: boolean;
  playerName?: string;
  homeScore?: number;
  awayScore?: number;
  text: string;
}

export function convertNetScoresEvents(
  nsEvents: Record<string, { text: string }> | null,
  homeTeamName: string,
  awayTeamName: string
): NetScoresConvertedEvent[] {
  if (!nsEvents) return [];

  const events: NetScoresConvertedEvent[] = [];

  for (const [id, ev] of Object.entries(nsEvents)) {
    const text = ev.text || "";

    // Parse minute from text like "42' - 1st Goal - Player (Team) -"
    const minuteMatch = text.match(/^(\d+)'/);
    const minute = minuteMatch ? parseInt(minuteMatch[1], 10) : 0;

    // Determine event type
    let type = "Info";
    const lowerText = text.toLowerCase();
    if (lowerText.includes("goal")) type = "Goal";
    else if (lowerText.includes("yellow card") || lowerText.includes("yellowcard")) type = "YellowCard";
    else if (lowerText.includes("red card") || lowerText.includes("redcard")) type = "RedCard";
    else if (lowerText.includes("corner")) type = "Corner";
    else if (lowerText.includes("substitution")) type = "Sub";
    else if (lowerText.includes("half") || lowerText.includes("score after")) type = "Half";

    // Determine if home or away
    let isHome = true;
    const homeLower = homeTeamName.toLowerCase();
    const awayLower = awayTeamName.toLowerCase();
    if (lowerText.includes(awayLower)) isHome = false;
    else if (lowerText.includes(homeLower)) isHome = true;
    // For goals without explicit team name, try to infer from context
    else if (type === "Goal") {
      // Check if parentheses contain team reference
      const parenMatch = text.match(/\(([^)]+)\)/);
      if (parenMatch) {
        const parenContent = parenMatch[1].toLowerCase();
        if (parenContent.includes(awayLower) || parenContent.includes("away")) isHome = false;
      }
    }

    // Parse player name from text like "42' - 1st Goal - Player Name (Team) -"
    let playerName: string | undefined;
    const playerMatch = text.match(/-\s+([A-Z][a-zA-Z\s']+?)\s*\(/);
    if (playerMatch) {
      playerName = playerMatch[1].trim();
    }

    // Parse score from goal events
    let homeScore: number | undefined;
    let awayScore: number | undefined;
    const scoreMatch = text.match(/(\d+)\s*-\s*(\d+)/);
    if (scoreMatch && (type === "Goal" || type === "Half")) {
      homeScore = parseInt(scoreMatch[1], 10);
      awayScore = parseInt(scoreMatch[2], 10);
    }

    events.push({
      time: minute,
      type,
      isHome,
      playerName,
      homeScore,
      awayScore,
      text,
    });
  }

  // Sort by minute
  events.sort((a, b) => a.time - b.time);
  return events;
}

// ── Fetch game timers (lightweight real-time update) ──

export async function fetchGameTimers(gameIds: number[]): Promise<Record<number, NetScoresGame['timer']>> {
  if (gameIds.length === 0) return {};

  try {
    const params = gameIds.map(id => `ids[]=${id}`).join("&");
    const data = await fetchWithCFBypass(`${NETSCORES_BASE}/api/timers?${params}`);
    if (!data) return {};

    const result: Record<number, NetScoresGame['timer']> = {};
    const items = data?.result || {};
    for (const [key, val] of Object.entries(items)) {
      const id = parseInt(key.replace("item-", ""), 10);
      const gameData = val as any;
      if (gameData?.timer) {
        result[id] = gameData.timer;
      }
    }
    return result;
  } catch {
    return {};
  }
}

// ── Get team logo URL from NetScores ──

function getNetScoresTeamLogo(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  if (logoUrl.startsWith("http")) return logoUrl;
  return `${NETSCORES_BASE}${logoUrl}`;
}
