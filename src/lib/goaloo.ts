// ── Goaloo.com API Client ──────────────────────────────────────────
// Fetches match lists, momentum/attack charts, odds, and events
// from goaloo.com for both live and historical matches.
//
// Key endpoints:
//   - SoccerAjax?type=6&date=YYYY-MM-DD  → Match list by date
//   - SoccerAjax?type=2&id={matchId}     → Momentum/attack chart (jsq field)
//   - SoccerAjax?type=1&id={matchId}     → Multi-bookmaker odds (1X2, AH, O/U)
//   - SoccerAjax?type=3&id={matchId}     → Team stats (avg goals, corners, etc.)
//   - SoccerAjax?type=4&id={matchId}     → Live odds movements
//   - gettextlivedetail?scheduleId={id}  → Match events (goals, cards, subs)

import { execFile } from 'child_process';
import { devLog, devWarn, devError } from './devLog';
import { scrapeUrl } from './scraper';

const GOALOO_BASE = 'https://www.goaloo.com';
const GOALOO_AJAX = `${GOALOO_BASE}/ajax`;

// ── Types ──────────────────────────────────────────────────────

export interface GoalooMatch {
  id: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeam: string;
  awayTeam: string;
  date: string;          // YYYY-MM-DD
  time: string;          // HH:MM
  state: number;         // -1=finished, 0=upcoming, 1-14=live states
  homeScore: number;
  awayScore: number;
  htHomeScore: number;
  htAwayScore: number;
  homeRank: string;      // Ranking/position
  awayRank: string;
  asianHandicap: number | null;
  overUnder: number | null;
  leagueName: string;
  leagueShortName: string;
  hasStats: boolean;
  redCards: { home: number; away: number };
}

interface GoalooLeague {
  id: number;
  shortName: string;
  fullName: string;
  color: string;
  subLeagueId: number | null;
}

export interface MomentumData {
  matchId: number;
  homeIntensities: number[];   // Per-minute attack intensity (0-100) for home
  awayIntensities: number[];   // Per-minute attack intensity (0-100) for away
  homeGoalMinutes: number[];   // Minutes where home scored
  awayGoalMinutes: number[];   // Minutes where away scored
  homeRedCardMinutes: number[];
  awayRedCardMinutes: number[];
  totalMinutes: number;        // How many minutes of data
}

export interface GoalooMatchEvent {
  id: number;
  minute: number;
  type: 'goal' | 'yellow_card' | 'red_card' | 'substitution';
  team: 'home' | 'away';
  player: string;
  detail: string;
  timestamp: string;
}

export interface GoalooOdds {
  matchId: number;
  bookmaker: string;
  initial: {
    homeWin: number;
    draw: number;
    awayWin: number;
    ahLine: number;
    ahHome: number;
    ahAway: number;
    ouLine: number;
    over: number;
    under: number;
  } | null;
  live: {
    homeWin: number;
    draw: number;
    awayWin: number;
    ahLine: number;
    ahHome: number;
    ahAway: number;
    ouLine: number;
    over: number;
    under: number;
  } | null;
}

export interface GoalooTeamStats {
  avgGoals: { home: number; away: number };
  avgGoalsConceded: { home: number; away: number };
  avgCorners: { home: number; away: number };
  avgYellowCards: { home: number; away: number };
  avgPossession: { home: number; away: number };
  recentRecord: { home: string; away: string }; // e.g. "6W 3D 1L"
  rating: { home: number; away: number };
}

// ── Fetch helper (curl-based to bypass anti-bot) ──────────────

async function goalooFetch(url: string): Promise<string | null> {
  // Step 1: Try Python bridge (curl_cffi — bypasses Cloudflare)
  const bridgeResult = await scrapeUrl(url, { type: 'json', referer: 'https://www.goaloo.com/', timeout: 15000 });
  if (bridgeResult.ok && bridgeResult.data) {
    return typeof bridgeResult.data === 'string' ? bridgeResult.data : JSON.stringify(bridgeResult.data);
  }

  // Step 2: Fallback — try curl (works on some environments)
  try {
    const result = await new Promise<string | null>((resolve) => {
      execFile('curl', [
        '-s', '-L', '--max-time', '15',
        '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        '-H', 'Accept: application/json, text/javascript, */*; q=0.01',
        '-H', 'Accept-Language: en-US,en;q=0.9',
        '-H', 'X-Requested-With: XMLHttpRequest',
        '-H', 'Referer: https://www.goaloo.com/',
        '--compressed', url,
      ], { encoding: 'utf-8', timeout: 20000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) resolve(null);
        else resolve(stdout);
      });
    });
    if (result) return result;
  } catch { /* both failed */ }

  devError(`[Goaloo] All fetch methods failed for ${url}`);
  return null;
}

// Direct fetch for football.goaloo.com JSON (handles BOM via Python)
let _pythonPath: string | undefined;
function findPythonPath(): string | null {
  if (_pythonPath !== undefined) return _pythonPath || null;
  const candidates = [process.env.PYTHON_PATH, "C:\\Python313\\python.exe", "python3", "python"].filter(Boolean) as string[];
  for (const py of candidates) {
    try {
      const { execFileSync } = require('child_process') as typeof import('child_process');
      const r = execFileSync(py!, ["--version"], { timeout: 3000, encoding: 'utf-8' });
      if (r.includes("Python")) { _pythonPath = py; return py; }
    } catch { continue; }
  }
  _pythonPath = '';
  return null;
}

async function goalooFetchSeasonJson(url: string): Promise<string | null> {
  const python = findPythonPath();
  if (!python) {
    devError('[Goaloo] No Python found for season JSON');
    return null;
  }
  try {
    const { execFile } = require('child_process') as typeof import('child_process');
    const { join } = require('path') as typeof import('path');
    const script = join(process.cwd(), 'scripts', '_goaloo_fetch.py');
    return await new Promise<string | null>((resolve) => {
      execFile(python!, [script, url], {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 5 * 1024 * 1024,
      }, (err: any, stdout: string) => {
        if (err || !stdout) { resolve(null); return; }
        try {
          // Validate it's JSON
          JSON.parse(stdout);
          resolve(stdout);
        } catch {
          // Try stripping BOM
          try {
            const stripped = stdout.replace(/^\uFEFF/, '');
            JSON.parse(stripped);
            resolve(stripped);
          } catch {
            resolve(null);
          }
        }
      });
    });
  } catch { return null; }
}

// ── Parse match data JS format ────────────────────────────────
// The bf_us1.js and SoccerAjax type=6 return data as:
// var A=Array(N);
// A[1]=[id,leagueId,homeTeamId,awayTeamId,'Home','Away','2026,5,10,19,00,00',state,half,homeScore,awayScore,htHome,htAway,homeRed,awayRed,'homeRank','awayRank',...,'True',ahLine,?,ouLine,?,hasStats,?,cornerH,cornerA,subLeagueId,...,weather,referee];

function parseMatchArray(dataStr: string): GoalooMatch[] {
  const matches: GoalooMatch[] = [];
  const regex = /A\[(\d+)\]=\[(\d+),(\d+),(\d+),(\d+),'([^']*)','([^']*)','([^']*)'[^[]*?\]/g;
  let m;

  while ((m = regex.exec(dataStr)) !== null) {
    const idx = parseInt(m[1]);
    const fullMatch = m[0];

    // Parse the full array - need to handle quoted strings and nested commas
    const values = parseJSArray(fullMatch.replace(/^A\[\d+\]=/, ''));

    if (values.length < 10) continue;

    const id = parseInt(String(values[0])) || 0;
    const leagueId = parseInt(String(values[1])) || 0;
    const homeTeamId = parseInt(String(values[2])) || 0;
    const awayTeamId = parseInt(String(values[3])) || 0;
    const homeTeam = cleanTeamName(String(values[4]));
    const awayTeam = cleanTeamName(String(values[5]));

    // Parse date
    const dateStr = String(values[6] || values[7] || '');
    const { date, time } = parseGoalooDate(dateStr);

    const state = parseInt(String(values[8])) ?? 0;
    const homeScore = parseInt(String(values[10])) || 0;
    const awayScore = parseInt(String(values[11])) || 0;
    const homeRank = String(values[16] || '');
    const awayRank = String(values[17] || '');

    // Parse HT scores
    let htHomeScore = 0;
    let htAwayScore = 0;
    const htScoreStr = String(values[25] || '');
    if (htScoreStr && htScoreStr.includes('-')) {
      const htParts = htScoreStr.split('-');
      htHomeScore = parseInt(htParts[0]) || 0;
      htAwayScore = parseInt(htParts[1]) || 0;
    }

    // Asian Handicap
    const ahLine = values[19] ? parseFloat(String(values[19])) : null;
    const ouLine = values[21] ? parseFloat(String(values[21])) : null;

    // Red cards
    const homeRed = parseInt(String(values[14])) || 0;
    const awayRed = parseInt(String(values[15])) || 0;

    // Sub-league ID
    const subLeagueId = values[24] ? parseInt(String(values[24])) : null;

    matches.push({
      id,
      leagueId,
      homeTeamId,
      awayTeamId,
      homeTeam,
      awayTeam,
      date,
      time,
      state,
      homeScore,
      awayScore,
      htHomeScore,
      htAwayScore,
      homeRank,
      awayRank,
      asianHandicap: ahLine,
      overUnder: ouLine,
      leagueName: '',
      leagueShortName: '',
      hasStats: values[23] === '1',
      redCards: { home: homeRed, away: awayRed },
    });
  }

  return matches;
}

// Parse league data: B[1]=[75,'World Cup','FIFA World Cup','#660000',1,'...',413,'',,1,52];
function parseLeagueArray(dataStr: string): Map<number, GoalooLeague> {
  const leagues = new Map<number, GoalooLeague>();
  const regex = /B\[\d+\]=\[(\d+),'([^']*)','([^']*)','([^']*)'/g;
  let m;

  while ((m = regex.exec(dataStr)) !== null) {
    const id = parseInt(m[1]);
    leagues.set(id, {
      id,
      shortName: m[2],
      fullName: m[3],
      color: m[4],
      subLeagueId: null,
    });
  }

  return leagues;
}

// ── JS Array Parser ────────────────────────────────────────────
// Goaloo returns data as JS arrays with mixed types
// e.g. [2992506,1,102,991,'Malaga','Las Palmas','2026,5,10,19,00,00',-1,1,1,0,1,0,0,1,1,'4','5','','',3,'','',7,2,0]

function parseJSArray(arrStr: string): (string | number)[] {
  const result: (string | number)[] = [];
  let i = 1; // skip [
  let depth = 0;

  while (i < arrStr.length && arrStr[i] !== ']') {
    // Skip whitespace
    while (i < arrStr.length && arrStr[i] === ' ') i++;
    if (i >= arrStr.length || arrStr[i] === ']') break;

    if (arrStr[i] === "'") {
      // String value
      let str = '';
      i++; // skip opening quote
      while (i < arrStr.length && arrStr[i] !== "'") {
        if (arrStr[i] === '\\' && i + 1 < arrStr.length) {
          str += arrStr[i + 1];
          i += 2;
        } else {
          str += arrStr[i];
          i++;
        }
      }
      i++; // skip closing quote
      result.push(str);
    } else if (arrStr[i] === '[') {
      // Nested array - skip it
      depth++;
      let nested = '[';
      i++;
      while (i < arrStr.length && depth > 0) {
        if (arrStr[i] === '[') depth++;
        if (arrStr[i] === ']') depth--;
        nested += arrStr[i];
        i++;
      }
      result.push(nested);
    } else if (arrStr[i] === ',' || arrStr[i] === ' ') {
      i++;
    } else {
      // Number or identifier
      let num = '';
      while (i < arrStr.length && arrStr[i] !== ',' && arrStr[i] !== ']' && arrStr[i] !== ' ') {
        num += arrStr[i];
        i++;
      }
      const parsed = parseInt(num);
      result.push(isNaN(parsed) ? num : parsed);
    }

    // Skip comma
    while (i < arrStr.length && (arrStr[i] === ',' || arrStr[i] === ' ')) i++;
  }

  return result;
}

function cleanTeamName(name: string): string {
  return name
    .replace(/<font[^>]*>/gi, '')
    .replace(/<\/font>/gi, '')
    .replace(/\(N\)/g, '')
    .trim();
}

function parseGoalooDate(dateStr: string): { date: string; time: string } {
  // Format: "2026-06-12 02:00:00" or "2026,5,10,19,00,00"
  if (dateStr.includes('-')) {
    const parts = dateStr.split(' ');
    return {
      date: parts[0] || '',
      time: parts[1]?.substring(0, 5) || '',
    };
  }

  // Comma format: "2026,5,10,19,00,00"
  const parts = dateStr.split(',');
  if (parts.length >= 6) {
    const year = parts[0];
    const month = String(parseInt(parts[1]) + 1).padStart(2, '0'); // Month is 0-indexed!
    const day = parts[2].padStart(2, '0');
    const hour = parts[3].padStart(2, '0');
    const min = parts[4].padStart(2, '0');
    return {
      date: `${year}-${month}-${day}`,
      time: `${hour}:${min}`,
    };
  }

  return { date: '', time: '' };
}

// ── Public API: Fetch all matches for a league season ────────
// Uses football.goaloo.com/jsData/matchResult/json/{season}/s{leagueId}_en.json
// which contains the ENTIRE season — no 7-day limit!

export interface GoalooSeasonMatch {
  scheduleId: number;
  leagueId: number;
  state: number;            // -1=finished
  date: string;             // YYYY-MM-DD HH:MM
  homeTeamId: number;
  awayTeamId: number;
  homeTeam: string;
  awayTeam: string;
  score: string;            // "1-0"
  htScore: string;          // "1-0"
  homeRank: string;
  awayRank: string;
  ahLine: string;
  ahHome: string;
  ouLine: string;
  ouHome: string;
  round: string;            // "R_14"
}

export async function fetchGoalooSeasonMatches(
  leagueId: number,
  season: string,
): Promise<GoalooSeasonMatch[]> {
  const url = `https://football.goaloo.com/jsData/matchResult/json/${season}/s${leagueId}_en.json`;
  const data = await goalooFetchSeasonJson(url);

  if (!data) {
    console.error(`[Goaloo] Failed to fetch season matches for ${leagueId} ${season}`);
    return [];
  }

  try {
    const json = JSON.parse(data);

    // Team lookup
    const teamMap = new Map<number, string>();
    if (json.TeamInfo) {
      for (const t of json.TeamInfo) {
        teamMap.set(Number(t[0]), String(t[1]));
      }
    }

    // ScheduleList is { "sub_XXXX": { "R_1": [...], "R_2": [...] } }
    const matches: GoalooSeasonMatch[] = [];
    const scheduleList = json.ScheduleList || {};
    for (const subKey of Object.keys(scheduleList)) {
      const rounds = scheduleList[subKey];
      for (const roundKey of Object.keys(rounds)) {
        const roundMatches = rounds[roundKey];
        if (!Array.isArray(roundMatches)) continue;
        for (const row of roundMatches) {
          if (!Array.isArray(row) || row.length < 8) continue;
          // Row: [scheduleId, leagueId, state, dateStr, homeTeamId, awayTeamId, score, htScore, homeRank, awayRank, ahLine, ahHome, ouLine, ouHome, ...]
          const scheduleId = Number(row[0]) || 0;
          const state = Number(row[2]) ?? 0;
          const dateStr = String(row[3] || '');
          const homeTeamId = Number(row[4]) || 0;
          const awayTeamId = Number(row[5]) || 0;
          const score = String(row[6] || '0-0');
          const htScore = String(row[7] || '0-0');
          const homeRank = String(row[8] || '');
          const awayRank = String(row[9] || '');
          const ahLine = String(row[10] || '');
          const ahHome = String(row[11] || '');
          const ouLine = String(row[12] || '');
          const ouHome = String(row[13] || '');

          const homeTeam = teamMap.get(homeTeamId) || `Team#${homeTeamId}`;
          const awayTeam = teamMap.get(awayTeamId) || `Team#${awayTeamId}`;

          matches.push({
            scheduleId, leagueId, state, date: dateStr,
            homeTeamId, awayTeamId, homeTeam, awayTeam,
            score, htScore, homeRank, awayRank,
            ahLine, ahHome, ouLine, ouHome,
            round: roundKey,
          });
        }
      }
    }

    console.log(`[Goaloo] Season ${season} league ${leagueId}: ${matches.length} matches`);
    return matches;
  } catch (err: any) {
    console.error(`[Goaloo] Parse error for season ${leagueId} ${season}:`, err?.message?.substring(0, 100));
    return [];
  }
}

// ── Public API: Fetch matches by date ────────────────────────

export async function fetchGoalooMatchesByDate(date: string): Promise<GoalooMatch[]> {
  const url = `${GOALOO_BASE}/Ajax/SoccerAjax?type=6&date=${date}&order=league&timezone=0&flesh=${Math.random()}`;
  const data = await goalooFetch(url);

  if (!data) {
    console.error(`[Goaloo] Failed to fetch matches for ${date}`);
    return [];
  }

  try {
    const json = JSON.parse(data);
    if (json.ErrCode !== 0 || !json.Data) {
      console.error(`[Goaloo] API error for ${date}:`, json.ErrMsg || json.ErrCode);
      return [];
    }

    const dataStr = json.Data as string;
    const matches = parseMatchArray(dataStr);

    // Also parse leagues for name enrichment
    const leagues = parseLeagueArray(dataStr);
    for (const match of matches) {
      const league = leagues.get(match.leagueId);
      if (league) {
        match.leagueName = league.fullName;
        match.leagueShortName = league.shortName;
      }
    }

    console.log(`[Goaloo] Found ${matches.length} matches for ${date}`);
    return matches;
  } catch (err: any) {
    console.error(`[Goaloo] Parse error for ${date}:`, err?.message?.substring(0, 100));
    return [];
  }
}

// ── Public API: Fetch matches for last N days ────────────────

export async function fetchGoalooMatchesRecent(daysBack: number = 3): Promise<GoalooMatch[]> {
  const allMatches: GoalooMatch[] = [];
  const seenIds = new Set<number>();

  const now = new Date();
  // Istanbul timezone offset
  const istanbulOffset = 3 * 60;
  const localOffset = now.getTimezoneOffset();
  const istanbulMs = now.getTime() + (istanbulOffset + localOffset) * 60000;

  for (let d = 0; d <= daysBack; d++) {
    const date = new Date(istanbulMs - d * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().slice(0, 10);

    const matches = await fetchGoalooMatchesByDate(dateStr);
    for (const match of matches) {
      if (!seenIds.has(match.id)) {
        seenIds.add(match.id);
        allMatches.push(match);
      }
    }

    // Small delay between requests
    if (d < daysBack) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`[Goaloo] Total: ${allMatches.length} matches from last ${daysBack} days`);
  return allMatches;
}

// ── Public API: Fetch momentum/attack chart ──────────────────
// The jsq format:
//   "H1_DATA!H2_DATA"
// Each half is split by "^" into 6 segments (15-min periods)
// Within each segment, "%" separates per-minute values
// ";" separates home from away team data
// ";1" indicates a goal was scored

export async function fetchGoalooMomentum(matchId: number): Promise<MomentumData | null> {
  const url = `${GOALOO_BASE}/ajax/soccerajax?type=2&id=${matchId}`;
  const data = await goalooFetch(url);

  if (!data) {
    console.error(`[Goaloo] Failed to fetch momentum for match ${matchId}`);
    return null;
  }

  try {
    const json = JSON.parse(data);
    if (json.ErrCode !== 0 || !json.Data?.jsq) {
      return null;
    }

    const jsq: string = json.Data.jsq;
    return parseMomentumJsq(matchId, jsq);
  } catch (err: any) {
    console.error(`[Goaloo] Momentum parse error for ${matchId}:`, err?.message?.substring(0, 100));
    return null;
  }
}

function parseMomentumJsq(matchId: number, jsq: string): MomentumData {
  const homeIntensities: number[] = new Array(90).fill(0);
  const awayIntensities: number[] = new Array(90).fill(0);
  const homeGoalMinutes: number[] = [];
  const awayGoalMinutes: number[] = [];
  const homeRedCardMinutes: number[] = [];
  const awayRedCardMinutes: number[] = [];

  // jsq format detailed analysis:
  // "HALF1_DATA!HALF2_DATA"
  // Each half has 6 segments separated by "^" (one per 15-min period)
  // Within each segment: "%" separates individual minute values
  // ";" separates home team data from away team data  
  // ";N" where N is a small number can indicate events (goals)
  //
  // Example: "6%,11%,11%,17%^19%,19%;1,11%,17%^29%;1,19%;1,22%,21%;1^..."
  // 
  // The numbers represent attack intensity for each minute in that 15-min segment.
  // Home team values come before ";", away team values come after.
  // When there are fewer values than 15 in a segment, the remaining minutes are 0.

  const halves = jsq.split('!');

  for (let h = 0; h < halves.length; h++) {
    const segments = halves[h].split('^');
    const halfStart = h === 0 ? 0 : 45; // 0-indexed minute offset for this half

    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s];
      if (!segment) continue;

      const segStart = halfStart + s * 15; // 0-indexed minute for this segment
      let homeMinuteOffset = 0;
      let awayMinuteOffset = 0;

      // Split by ";" to get home and away parts
      const semiParts = segment.split(';');

      // Parse home team values (first part, before any ;)
      const homePart = semiParts[0];
      const homeTokens = homePart.split('%').filter(v => v.length > 0);
      for (const token of homeTokens) {
        const num = parseInt(token);
        const minIdx = segStart + homeMinuteOffset;
        if (!isNaN(num) && minIdx < 90) {
          homeIntensities[minIdx] = num;
        }
        homeMinuteOffset++;
      }

      // Parse away team values (parts after ;)
      // Format can be:
      //   "1" → standalone goal marker
      //   "11%,17%" → away minute values
      //   "1,11%,17%" → goal marker + away values
      //   "19%;1,22%,21%;1" → multiple sub-groups
      for (let p = 1; p < semiParts.length; p++) {
        const part = semiParts[p];
        if (!part) continue;

        // Split by comma to handle goal markers mixed with values
        const tokens = part.split(',');
        for (const token of tokens) {
          const trimmed = token.trim();
          if (trimmed === '1') {
            // Goal event for away team at this minute offset
            const goalMin = segStart + awayMinuteOffset + 1; // 1-indexed
            if (goalMin >= 1 && goalMin <= 90) {
              awayGoalMinutes.push(goalMin);
            }
          } else if (trimmed.includes('%')) {
            // Away team minute values
            const vals = trimmed.split('%').filter(v => v.length > 0);
            for (const v of vals) {
              const num = parseInt(v);
              const minIdx = segStart + awayMinuteOffset;
              if (!isNaN(num) && minIdx < 90) {
                awayIntensities[minIdx] = num;
              }
              awayMinuteOffset++;
            }
          } else {
            // Single number value (away intensity)
            const num = parseInt(trimmed);
            if (!isNaN(num) && num > 1) {
              const minIdx = segStart + awayMinuteOffset;
              if (minIdx < 90) {
                awayIntensities[minIdx] = num;
              }
              awayMinuteOffset++;
            }
          }
        }
      }
    }
  }

  // Determine home goal minutes from events API (not from jsq which is unreliable for home goals)
  // We'll leave homeGoalMinutes empty here and fill it from events API in the caller

  return {
    matchId,
    homeIntensities,
    awayIntensities,
    homeGoalMinutes,
    awayGoalMinutes,
    homeRedCardMinutes,
    awayRedCardMinutes,
    totalMinutes: 90,
  };
}

// ── Public API: Fetch match events ───────────────────────────

export async function fetchGoalooMatchEvents(matchId: number): Promise<GoalooMatchEvent[]> {
  const url = `${GOALOO_BASE}/ajax/gettextlivedetail?scheduleId=${matchId}`;
  const data = await goalooFetch(url);

  if (!data) return [];

  try {
    const events: GoalooMatchEvent[] = JSON.parse(data);
    return events.map((e: any) => {
      const content = e.content || '';
      const minuteMatch = content.match(/(\d+)'/);
      const minute = minuteMatch ? parseInt(minuteMatch[1]) : 0;

      let type: GoalooMatchEvent['type'] = 'substitution';
      if (content.includes('Goal')) type = 'goal';
      else if (content.includes('Red Card')) type = 'red_card';
      else if (content.includes('Yellow Card')) type = 'yellow_card';

      const playerMatch = content.match(/\)\s+(.+?)\s+(?:Goal|Yellow|Red|Substitution)/);
      const player = playerMatch ? playerMatch[1] : content.replace(/<[^>]+>/g, '').trim();

      return {
        id: e.id,
        minute,
        type,
        team: 'home', // Need match context to determine - will be enriched by caller
        player,
        detail: content.replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ''),
        timestamp: e.time,
      };
    });
  } catch {
    return [];
  }
}

// ── Public API: Fetch odds data ──────────────────────────────

export async function fetchGoalooOdds(matchId: number): Promise<GoalooOdds | null> {
  const url = `${GOALOO_BASE}/ajax/soccerajax?type=1&id=${matchId}`;
  const data = await goalooFetch(url);

  if (!data) return null;

  try {
    const json = JSON.parse(data);
    if (json.ErrCode !== 0 || !json.Data) return null;

    // Parse the odds data string
    const oddsStr: string = json.Data;
    const bookmakers = oddsStr.split('^');

    // Use Crown as primary (first bookmaker)
    const crownData = bookmakers[0];
    if (!crownData) return null;

    const rows = crownData.split(';');
    const initial = parseOddsRow(rows[0]);
    const live = rows.length > 1 ? parseOddsRow(rows[1]) : null;

    return {
      matchId,
      bookmaker: 'Crown',
      initial,
      live,
    };
  } catch {
    return null;
  }
}

function parseOddsRow(row: string): GoalooOdds['initial'] | null {
  if (!row || row.includes('Crown') === false && row.split(',').length < 10) return null;

  const parts = row.split(',').map(Number);
  if (parts.length < 14) return null;

  return {
    homeWin: parts[0] || 0,
    draw: parts[1] || 0,
    awayWin: parts[2] || 0,
    ahLine: parts[3] || 0,
    ahHome: parts[4] || 0,
    ahAway: parts[5] || 0,
    ouLine: parts[8] || 0,
    over: parts[9] || 0,
    under: parts[10] || 0,
  };
}

// ── Public API: Fetch team stats ─────────────────────────────

export async function fetchGoalooTeamStats(matchId: number): Promise<GoalooTeamStats | null> {
  const url = `${GOALOO_BASE}/ajax/soccerajax?type=3&id=${matchId}`;
  const data = await goalooFetch(url);

  if (!data) return null;

  try {
    const json = JSON.parse(data);
    if (json.ErrCode !== 0 || !json.Data) return null;

    const homeTeam = json.Data.HomeTeam;
    const awayTeam = json.Data.AwayTeam;
    if (!homeTeam || !awayTeam) return null;

    const parseStats = (team: any) => {
      const techStat = team.TechStat || [];
      const stats: Record<string, number> = {};
      for (const stat of techStat) {
        if (stat.Title && stat.ItemResult) {
          stats[stat.Title] = parseFloat(stat.ItemResult) || 0;
        }
      }
      return stats;
    };

    const homeStats = parseStats(homeTeam);
    const awayStats = parseStats(awayTeam);

    return {
      avgGoals: { home: homeStats['Goal'] || 0, away: awayStats['Goal'] || 0 },
      avgGoalsConceded: { home: homeStats['Loss'] || 0, away: awayStats['Loss'] || 0 },
      avgCorners: { home: homeStats['Corner Kicks'] || 0, away: awayStats['Corner Kicks'] || 0 },
      avgYellowCards: { home: homeStats['Yellow Cards'] || 0, away: awayStats['Yellow Cards'] || 0 },
      avgPossession: { home: homeStats['Possession'] || 0, away: awayStats['Possession'] || 0 },
      recentRecord: {
        home: homeTeam.MatchRsult ? `${homeTeam.MatchRsult.length} games` : 'N/A',
        away: awayTeam.MatchRsult ? `${awayTeam.MatchRsult.length} games` : 'N/A',
      },
      rating: {
        home: homeStats['Goal'] ? Math.round(homeStats['Goal'] * 10) / 10 : 0,
        away: awayStats['Goal'] ? Math.round(awayStats['Goal'] * 10) / 10 : 0,
      },
    };
  } catch {
    return null;
  }
}

// ── Nesine → Goaloo Match Mapping ─────────────────────────────
// Fuzzy-match Nesine matches to Goaloo matches by team name similarity.
// Uses Jaccard-like token overlap scoring to handle name differences.

function normalizeTeamName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 1 && !['fc', 'cf', 'sc', 'ac', 'bk', 'if', 'ik', 'fk', 'nk', 'sk', 'sd', 'rc', 'cd', 'as', 'ss', 'us', 'cs', 'cl', 'ca', 'sl', 'sa', 'sv', 'se', 'ap', 'af', 'aa', 'av', 'ec', 'ed', 'og', 'ud', 'vb', 'ce', 'gp', 'ca', 'pa', 'pb', 'bs', 'es', 'tp', 'mf', 'mt', 'mr', 'ms', 'mm', 'md', 'mi', 'ml', 'mb', 'ma', 'mc', 'mg', 'mh', 'mj', 'mk', 'mn', 'mo', 'mp', 'mq', 'mu', 'mv', 'mw', 'mx', 'my', 'mz'].includes(t))
}

function teamNameSimilarity(nameA: string, nameB: string): number {
  const tokensA = new Set(normalizeTeamName(nameA))
  const tokensB = new Set(normalizeTeamName(nameB))
  if (tokensA.size === 0 && tokensB.size === 0) return 0

  let intersection = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++
    // Also check partial match (3+ chars)
    else {
      for (const tb of tokensB) {
        if (t.length >= 3 && tb.length >= 3 && (t.startsWith(tb) || tb.startsWith(t) || levenshtein(t, tb) <= 1)) {
          intersection += 0.7
          break
        }
      }
    }
  }

  const union = tokensA.size + tokensB.size - intersection
  return union > 0 ? intersection / union : 0
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)
      )
    }
  }
  return dp[m][n]
}

export interface GoalooMatchMapping {
  goalooMatchId: number
  homeTeam: string
  awayTeam: string
  score: number  // Match quality score (0-1)
}

export async function findGoalooMatchForNesine(
  nesineHome: string,
  nesineAway: string,
  matchDate: string,  // YYYY-MM-DD
  matchTime?: string, // HH:MM
): Promise<GoalooMatchMapping | null> {
  // Fetch Goaloo matches for the same date
  const goalooMatches = await fetchGoalooMatchesCached(matchDate)
  if (goalooMatches.length === 0) return null

  let bestMatch: GoalooMatchMapping | null = null
  let bestScore = 0

  for (const gm of goalooMatches) {
    const homeSim = teamNameSimilarity(nesineHome, gm.homeTeam)
    const awaySim = teamNameSimilarity(nesineAway, gm.awayTeam)
    const combinedScore = (homeSim + awaySim) / 2

    // Time proximity bonus (if within 30 min of each other)
    let timeBonus = 0
    if (matchTime && gm.time) {
      const [nh, nm] = matchTime.split(':').map(Number)
      const [gh, gnm] = gm.time.split(':').map(Number)
      if (!isNaN(nh) && !isNaN(gh)) {
        const diffMin = Math.abs((nh * 60 + (nm || 0)) - (gh * 60 + (gnm || 0)))
        if (diffMin <= 30) timeBonus = 0.1
        if (diffMin <= 10) timeBonus = 0.15
      }
    }

    const totalScore = combinedScore + timeBonus

    if (totalScore > bestScore && combinedScore >= 0.3) {
      bestScore = totalScore
      bestMatch = {
        goalooMatchId: gm.id,
        homeTeam: gm.homeTeam,
        awayTeam: gm.awayTeam,
        score: totalScore,
      }
    }
  }

  // Only return if we have a reasonable match
  if (bestMatch && bestScore >= 0.4) {
    console.log(`[Goaloo Mapping] ${nesineHome} vs ${nesineAway} → Goaloo #${bestMatch.goalooMatchId} ${bestMatch.homeTeam} vs ${bestMatch.awayTeam} (score: ${bestScore.toFixed(2)})`)
    return bestMatch
  }

  return null
}

// ── Cache ─────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const matchesCache = new Map<string, CacheEntry<GoalooMatch[]>>();
const momentumCache = new Map<number, CacheEntry<MomentumData | null>>();
const eventsCache = new Map<number, CacheEntry<GoalooMatchEvent[]>>();
const oddsCache = new Map<number, CacheEntry<GoalooOdds | null>>();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Periodic cleanup to prevent unbounded growth
function cleanupCache() {
  const now = Date.now();
  const cutoff = now - CACHE_TTL * 2; // Remove entries older than 2x TTL
  for (const [key, val] of matchesCache) {
    if (val.timestamp < cutoff) matchesCache.delete(key);
  }
  for (const [key, val] of momentumCache) {
    if (val.timestamp < cutoff) momentumCache.delete(key);
  }
  for (const [key, val] of eventsCache) {
    if (val.timestamp < cutoff) eventsCache.delete(key);
  }
  for (const [key, val] of oddsCache) {
    if (val.timestamp < cutoff) oddsCache.delete(key);
  }
}

// Run cleanup every 30 minutes (only on server)
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupCache, 30 * 60 * 1000);
}

async function fetchGoalooMatchesCached(date: string): Promise<GoalooMatch[]> {
  const cached = matchesCache.get(date);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  const data = await fetchGoalooMatchesByDate(date);
  matchesCache.set(date, { data, timestamp: Date.now() });
  return data;
}

async function fetchGoalooMomentumCached(matchId: number): Promise<MomentumData | null> {
  const cached = momentumCache.get(matchId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  const data = await fetchGoalooMomentum(matchId);
  momentumCache.set(matchId, { data, timestamp: Date.now() });
  return data;
}

// ── Convert Goaloo match to app format ───────────────────────

export interface GoalooMatchForBacktest {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  time: string;
  homeScore: number;
  awayScore: number;
  htHomeScore: number;
  htAwayScore: number;
  asianHandicap: number | null;
  overUnder: number | null;
  momentum: MomentumData | null;
  events: GoalooMatchEvent[];
  odds: GoalooOdds | null;
}

export async function enrichGoalooMatch(match: GoalooMatch): Promise<GoalooMatchForBacktest> {
  const [momentum, events, odds] = await Promise.all([
    fetchGoalooMomentum(match.id).catch(() => null),
    fetchGoalooMatchEvents(match.id).catch(() => []),
    fetchGoalooOdds(match.id).catch(() => null),
  ]);

  return {
    matchCode: match.id,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    league: match.leagueName || match.leagueShortName,
    time: match.time,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    htHomeScore: match.htHomeScore,
    htAwayScore: match.htAwayScore,
    asianHandicap: match.asianHandicap,
    overUnder: match.overUnder,
    momentum,
    events,
    odds,
  };
}

// ── Convert Goaloo momentum data to PressureSnapshot format ──────
// This allows the backtest engine to use REAL per-minute attack intensities
// from Goaloo instead of synthetic interpolated snapshots.

interface GoalooPressureSnapshot {
  minute: string;
  timestamp: number;
  homePressure: number;
  awayPressure: number;
  stats: Record<string, { home: number | null; away: number | null }>;
  homeGoals?: number;
  awayGoals?: number;
}

function convertMomentumToSnapshots(
  momentum: MomentumData,
  events: GoalooMatchEvent[],
  homeScore: number,
  awayScore: number,
  htHomeScore: number,
  htAwayScore: number,
  ftStats?: Record<string, { home: number | null; away: number | null }> | null,
  htStats?: Record<string, { home: number | null; away: number | null }> | null,
): GoalooPressureSnapshot[] {
  const snapshots: GoalooPressureSnapshot[] = [];
  const totalMinutes = momentum.totalMinutes || 90;

  // Goal minutes from events (more reliable than momentum data)
  const homeGoalMins = new Set(momentum.homeGoalMinutes);
  const awayGoalMins = new Set(momentum.awayGoalMinutes);
  for (const evt of events) {
    if (evt.type === 'goal') {
      if (evt.team === 'home') homeGoalMins.add(evt.minute);
      else awayGoalMins.add(evt.minute);
    }
  }

  // Build cumulative goal tracking
  let cumHomeGoals = 0;
  let cumAwayGoals = 0;

  // Find max intensity for pressure normalization
  const maxIntensity = Math.max(
    ...momentum.homeIntensities.slice(0, totalMinutes),
    ...momentum.awayIntensities.slice(0, totalMinutes),
    5
  );

  for (let min = 1; min <= totalMinutes; min++) {
    const idx = min - 1;
    const homeIntensity = idx < momentum.homeIntensities.length ? momentum.homeIntensities[idx] : 0;
    const awayIntensity = idx < momentum.awayIntensities.length ? momentum.awayIntensities[idx] : 0;

    // Track goals
    if (homeGoalMins.has(min)) cumHomeGoals++;
    if (awayGoalMins.has(min)) cumAwayGoals++;

    // Convert intensity to pressure (0-100 scale)
    // Goaloo intensity values are relative, normalize to pressure scale
    const homePressure = Math.round((homeIntensity / maxIntensity) * 85 + 8);
    const awayPressure = Math.round((awayIntensity / maxIntensity) * 85 + 8);

    // Interpolate stats from FT/HT stats if available
    const stats: Record<string, { home: number | null; away: number | null }> = {};
    if (ftStats && Object.keys(ftStats).length > 0) {
      const is1h = min <= 45;
      const halfMin = is1h ? min : min - 45;
      const halfTotal = 45;
      const ratio = halfMin / halfTotal;

      const targetStats = is1h
        ? (htStats && Object.keys(htStats).length > 0 ? htStats : ftStats)
        : ftStats;

      for (const [key, val] of Object.entries(targetStats)) {
        if (!val) continue;
        const targetHome = val.home ?? 0;
        const targetAway = val.away ?? 0;

        if (is1h || key === 'possession') {
          stats[key] = {
            home: Math.round(targetHome * ratio * 10) / 10,
            away: Math.round(targetAway * ratio * 10) / 10,
          };
        } else {
          // 2nd half: HT + interpolated diff
          const baseHome = htStats?.[key]?.home ?? 0;
          const baseAway = htStats?.[key]?.away ?? 0;
          const diffHome = targetHome - baseHome;
          const diffAway = targetAway - baseAway;
          stats[key] = {
            home: Math.round((baseHome + diffHome * ratio) * 10) / 10,
            away: Math.round((baseAway + diffAway * ratio) * 10) / 10,
          };
        }
      }
    }

    snapshots.push({
      minute: `${min}'`,
      timestamp: Date.now() - (totalMinutes - min) * 60000,
      homePressure: Math.min(100, homePressure),
      awayPressure: Math.min(100, awayPressure),
      stats,
      homeGoals: cumHomeGoals,
      awayGoals: cumAwayGoals,
    });
  }

  return snapshots;
}

// ── Odds Movement Analysis ─────────────────────────────────────
// Detects significant odds drops that indicate market expectation
// of increased goal probability. Used as Factor F13 in Goal Radar.

export interface OddsMovement {
  matchId: number;
  homeWinDrop: number;     // Positive = odds dropped = market expects home goal
  awayWinDrop: number;     // Positive = odds dropped = market expects away goal
  overDrop: number;        // Positive = over odds dropped = market expects goals
  ahHomeShift: number;     // Asian handicap line shift toward home
  ahAwayShift: number;     // Asian handicap line shift toward away
  significance: 'none' | 'low' | 'medium' | 'high' | 'critical';
  homeBoost: number;       // Points to add to home score in Goal Radar
  awayBoost: number;       // Points to add to away score in Goal Radar
}

export function analyzeOddsMovement(odds: GoalooOdds): OddsMovement {
  const result: OddsMovement = {
    matchId: odds.matchId,
    homeWinDrop: 0,
    awayWinDrop: 0,
    overDrop: 0,
    ahHomeShift: 0,
    ahAwayShift: 0,
    significance: 'none',
    homeBoost: 0,
    awayBoost: 0,
  };

  if (!odds.initial || !odds.live) return result;

  // Calculate odds drops (positive = price decreased = market expects more goals)
  // Home win odds: lower odds = market thinks home more likely to win/score
  result.homeWinDrop = odds.initial.homeWin - odds.live.homeWin;
  result.awayWinDrop = odds.initial.awayWin - odds.live.awayWin;

  // Over/Under: if over odds dropped, market expects more goals
  if (odds.initial.over > 0 && odds.live.over > 0) {
    result.overDrop = odds.initial.over - odds.live.over;
  }

  // Asian Handicap line shift
  if (odds.initial.ahLine !== 0 || odds.live.ahLine !== 0) {
    result.ahHomeShift = odds.live.ahLine - odds.initial.ahLine; // Negative shift = home favored more
    result.ahAwayShift = -result.ahHomeShift;
  }

  // ── Calculate significance ──
  // Odds drops of 0.20+ are significant; 0.50+ are critical
  const maxDrop = Math.max(result.homeWinDrop, result.awayWinDrop);
  const overSignal = result.overDrop > 0.15;

  if (maxDrop >= 0.50 || (maxDrop >= 0.30 && overSignal)) {
    result.significance = 'critical';
  } else if (maxDrop >= 0.30 || (maxDrop >= 0.15 && overSignal)) {
    result.significance = 'high';
  } else if (maxDrop >= 0.15 || overSignal) {
    result.significance = 'medium';
  } else if (maxDrop >= 0.05) {
    result.significance = 'low';
  }

  // ── Calculate Goal Radar boost points ──
  // Odds drop → goal expectation boost (asymmetric: sharp drops = more points)
  // Based on market efficiency research: 0.10 drop ≈ 5% probability shift
  if (result.homeWinDrop > 0.05) {
    // Home odds dropped: market expects home to score/win
    result.homeBoost = Math.min(8, Math.round(result.homeWinDrop * 20));
    if (result.overDrop > 0.10) result.homeBoost += 2; // Over also dropped → goals expected
  }

  if (result.awayWinDrop > 0.05) {
    result.awayBoost = Math.min(8, Math.round(result.awayWinDrop * 20));
    if (result.overDrop > 0.10) result.awayBoost += 2;
  }

  // If OVER odds dropped significantly, both sides get a small boost
  // (market expects goals from either team)
  if (result.overDrop > 0.20) {
    const overBoost = Math.min(4, Math.round(result.overDrop * 8));
    result.homeBoost += overBoost;
    result.awayBoost += overBoost;
  }

  // Cap total boosts
  result.homeBoost = Math.min(12, result.homeBoost);
  result.awayBoost = Math.min(12, result.awayBoost);

  return result;
}
