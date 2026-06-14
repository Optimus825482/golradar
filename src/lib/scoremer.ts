// Scoremer.com API client
// Fetches match statistics for finished matches from scoremer.com
// Uses the fixtures page (server-rendered) for match list, match_live for stats

import { normalizeTeamName, translateTeamName, nameSimilarity } from './teamNameNormalizer';

const SCOREMER_BASE = "https://www.scoremer.com";
const SCOREMER_TR_BASE = "https://www.scoremer.com/tr";

const log = process.env.NODE_ENV === 'development' ? console.log : () => {};
const warn = process.env.NODE_ENV === 'development' ? console.warn : () => {};
const errLog = process.env.NODE_ENV === 'development' ? console.error : () => {};

export interface ScoremerMatchStats {
  // Full-time stats
  shots_on_target: { home: number; away: number } | null;       // İsabetli Şut / Hedefe vuruşlar / On Target
  shots_off_target: { home: number; away: number } | null;      // İsabetsiz Şut / Hedef dışı vuruşlar / Off Target
  dangerous_attacks: { home: number; away: number } | null;     // Tehlikeli Hücum / Dangerous Attacks
  attacks: { home: number; away: number } | null;               // Hücum / Saldırılar / Attacks
  possession: { home: number; away: number } | null;            // Top sahipliği % / Possession %
  expected_goals: { home: number; away: number } | null;        // Expected Goals / xG
  corners: { home: number; away: number } | null;               // Köşe vuruş / Corners
  // Half-time stats
  ht_shots_on_target: { home: number; away: number } | null;
  ht_shots_off_target: { home: number; away: number } | null;
  ht_dangerous_attacks: { home: number; away: number } | null;
  ht_attacks: { home: number; away: number } | null;
  ht_possession: { home: number; away: number } | null;
  ht_corners: { home: number; away: number } | null;
}

export interface ScoremerMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  htHomeScore: number;
  htAwayScore: number;
  league: string;
  time: string;
  status: string;
  url: string;
  stats: ScoremerMatchStats | null;
}

export interface ScoremerMapping {
  nesineCode: number;
  scoremerId: string;
  scoremerUrl: string;
  confidence: number;
}

// ── Fetch page via Node.js fetch (cross-platform) ──────────────

import { scrapeUrl } from './scraper';

const SCOREMER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
};

async function fetchDirectHttp(url: string): Promise<string | null> {
  // Step 1: Try native fetch (fast, works on unprotected sites)
  try {
    const resp = await fetch(url, { headers: SCOREMER_HEADERS, signal: AbortSignal.timeout(20000) });
    if (resp.ok) {
      const text = await resp.text();
      if (text.length > 1000) return text;
    }
  } catch { /* fall through to bridge */ }

  // Step 2: Try Python bridge (bypasses Cloudflare via curl_cffi)
  const result = await scrapeUrl(url, { type: 'html', referer: 'https://www.scoremer.com/', timeout: 25000 });
  if (result.ok && result.data && result.data.length > 1000) return result.data;
  warn(`[Scoremer] Bridge failed for ${url}: ${result.error || 'too short'}`);
  return null;
}

// ── Team slug cache (built from fixtures) ──

const teamSlugCache: { entry: CacheEntry<Map<string, string>> | null } = { entry: null };

function extractTeamSlugs(html: string, slugMap: Map<string, string>) {
  const teamAnchors = html.matchAll(/<a[^>]*href="\/tr\/football\/team\/([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/gi);
  for (const m of teamAnchors) {
    const slug = m[1];
    const name = m[2].trim();
    if (slug && name) {
      slugMap.set(name, slug);
      // Also store normalized version for fuzzy matching
      const norm = normalizeTeamName(name);
      if (norm) slugMap.set(norm, slug);
    }
  }
}

export async function getTeamSlug(teamName: string): Promise<string | null> {
  // Check cache
  if (teamSlugCache.entry && Date.now() - teamSlugCache.entry.timestamp < CACHE_TTL) {
    const norm = normalizeTeamName(teamName);
    return teamSlugCache.entry.data.get(teamName) || teamSlugCache.entry.data.get(norm) || null;
  }

  // Build slug cache from fixtures
  const slugMap = new Map<string, string>();
  const now = new Date();
  const istanbulOffset = 3 * 60;
  const localOffset = now.getTimezoneOffset();
  const istanbulMs = now.getTime() + (istanbulOffset + localOffset) * 60000;
  const istanbulDate = new Date(istanbulMs);
  const todayStr = istanbulDate.toISOString().slice(0, 10);

  const url = `${SCOREMER_TR_BASE}/fixtures?date=${todayStr}`;
  const html = await fetchDirectHttp(url);
  if (html) {
    extractTeamSlugs(html, slugMap);
  }

  teamSlugCache.entry = { data: slugMap, timestamp: Date.now() };

  const norm = normalizeTeamName(teamName);
  return slugMap.get(teamName) || slugMap.get(norm) || null;
}

// ── Parse match list from scoremer.com/tr/fixtures (server-rendered) ──

async function fetchScoremerMatchList(): Promise<ScoremerMatch[]> {
  // Use the fixtures page which is server-rendered (unlike the JS-rendered main page)
  // Try today, yesterday, tomorrow AND the /fixtures/last page for finished matches
  const matches: ScoremerMatch[] = [];
  const seenIds = new Set<string>();

  // Get Istanbul date
  const now = new Date();
  const istanbulOffset = 3 * 60; // UTC+3
  const localOffset = now.getTimezoneOffset();
  const istanbulMs = now.getTime() + (istanbulOffset + localOffset) * 60000;
  const istanbulDate = new Date(istanbulMs);
  const todayStr = istanbulDate.toISOString().slice(0, 10);
  const yesterday = new Date(istanbulMs - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const tomorrow = new Date(istanbulMs + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  // Fetch fixtures for today, yesterday, and tomorrow
  for (const dateStr of [yesterdayStr, todayStr, tomorrowStr]) {
    const url = `${SCOREMER_TR_BASE}/fixtures?date=${dateStr}`;
    const html = await fetchDirectHttp(url);
    if (!html) {
      warn(`[Scoremer] Failed to fetch fixtures for ${dateStr}`);
      continue;
    }

    parseFixturesHtml(html, matches, seenIds);
  }

  // Also fetch the /fixtures/last page which shows recently finished matches
  // This is critical for mapping Nesine finished matches to Scoremer
  const lastUrl = `${SCOREMER_TR_BASE}/fixtures/last`;
  const lastHtml = await fetchDirectHttp(lastUrl);
  if (lastHtml) {
    parseFixturesHtml(lastHtml, matches, seenIds);
    log(`[Scoremer] Added matches from /fixtures/last (total: ${matches.length})`);
  } else {
    warn(`[Scoremer] Failed to fetch /fixtures/last`);
  }

  log(`[Scoremer] Found ${matches.length} matches from fixtures pages`);
  return matches;
}

// ── Fetch matches from a team's page on Scoremer (has finished matches) ──

export async function fetchTeamMatches(teamSlug: string): Promise<ScoremerMatch[]> {
  const url = `${SCOREMER_TR_BASE}/football/team/${teamSlug}`;
  const html = await fetchDirectHttp(url);
  if (!html) return [];

  const matches: ScoremerMatch[] = [];
  const seenIds = new Set<string>();
  parseFixturesHtml(html, matches, seenIds);
  return matches;
}

// ── Date-range fixture fetch (replaces single-date lookups) ────────
// Iterates a window of days (default 7) and returns unique matches.
// Critical for matching yesterday/tomorrow Nesine fixtures that
// the default 3-day scan in fetchScoremerMatchList can miss.

export async function getScoremerMatchesForDateRange(
  startDate: Date,
  endDate: Date,
): Promise<ScoremerMatch[]> {
  const matches: ScoremerMatch[] = [];
  const seenIds = new Set<string>();
  const day = 24 * 60 * 60 * 1000;

  for (let t = startDate.getTime(); t <= endDate.getTime(); t += day) {
    const d = new Date(t);
    const dateStr = d.toISOString().slice(0, 10);
    const url = `${SCOREMER_TR_BASE}/fixtures?date=${dateStr}`;
    const html = await fetchDirectHttp(url);
    if (!html) continue;
    parseFixturesHtml(html, matches, seenIds);
  }

  // Always include recently finished matches
  const lastUrl = `${SCOREMER_TR_BASE}/fixtures/last`;
  const lastHtml = await fetchDirectHttp(lastUrl);
  if (lastHtml) parseFixturesHtml(lastHtml, matches, seenIds);

  return matches;
}

// ── Filter Scoremer matches by status (finished vs upcoming) ────────

export function filterScoremerMatchesByStatus(
  matches: ScoremerMatch[],
  status: 'finished' | 'upcoming' | 'all' = 'all',
): ScoremerMatch[] {
  if (status === 'all') return matches;
  return matches.filter((m) => {
    // Finished: status field marked (e.g. "MS", "Bitti") OR FT score present and non-zero
    const statusSaysFinished = /^(MS|Bitti|FT|FT$|Finished|Ended)/i.test(m.status || '');
    const hasFullTimeScore = (m.homeScore > 0 || m.awayScore > 0) && m.status !== 'VS';
    const isFinished = statusSaysFinished || hasFullTimeScore;
    return status === 'finished' ? isFinished : !isFinished;
  });
}

// ── Shared HTML parser for fixtures tables ──

function parseFixturesHtml(html: string, matches: ScoremerMatch[], seenIds: Set<string>) {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    // Extract match ID from /match/ or /tr/match/ links
    const idMatch = row.match(/\/(?:tr\/)?match\/(\d+)/);
    if (!idMatch) continue;
    const id = idMatch[1];

    if (seenIds.has(id)) continue;
    seenIds.add(id);

    // Extract team names from /tr/football/team/ links
    const teamMatches = [...row.matchAll(/<a[^>]*href="\/tr\/football\/team\/[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/gi)];
    const homeTeam = teamMatches[0]?.[1]?.trim() || '';
    const awayTeam = teamMatches[1]?.[1]?.trim() || '';
    if (!homeTeam || !awayTeam) continue;

    // Extract league name
    const leagueMatch = row.match(/<a[^>]*href="\/tr\/football\/league\/[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/i);
    const league = leagueMatch?.[1]?.trim() || '';

    // Extract time
    const timeMatch = row.match(/(\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2})/);
    const matchTime = timeMatch?.[1] || '';

    // Check status - VS means upcoming, MS/Bitti means finished
    const isVS = row.includes('>VS<');
    const isMS = row.includes('>MS<') || row.includes('>Bitti<');
    // Also detect finished matches from score cells (blue-color or red-color class)
    const hasScoreCell = /class="[^"]*(?:blue-color|red-color)[^"]*"[^>]*>\s*\d+\s*:\s*\d+/.test(row);
    const status = isMS ? 'MS' : isVS ? 'VS' : hasScoreCell ? 'MS' : '';

    // Extract scores for finished matches
    let homeScore = 0;
    let awayScore = 0;
    if (isMS || hasScoreCell || !isVS) {
      // Strategy 1: Look for blue-color/red-color score cells (fixtures/last page format)
      // These appear as: <td class="text-center blue-color">0 : 2</td>
      // First score cell = HT score, Second = FT score
      const scoreCellPattern = /class="[^"]*(?:blue-color|red-color)[^"]*"[^>]*>\s*(\d+)\s*:\s*(\d+)/g;
      const scoreCells: { h: number; a: number }[] = [];
      let cellMatch;
      while ((cellMatch = scoreCellPattern.exec(row)) !== null) {
        const h = parseInt(cellMatch[1]);
        const a = parseInt(cellMatch[2]);
        if (h <= 20 && a <= 20) {
          scoreCells.push({ h, a });
        }
      }
      
      if (scoreCells.length >= 2) {
        // Last score cell = Full-time score (most reliable)
        homeScore = scoreCells[scoreCells.length - 1].h;
        awayScore = scoreCells[scoreCells.length - 1].a;
      } else if (scoreCells.length === 1) {
        homeScore = scoreCells[0].h;
        awayScore = scoreCells[0].a;
      } else {
        // Strategy 2: Fallback — look for any score pattern in the row
        const scorePatterns = row.match(/(\d+)\s*:\s*(\d+)/g);
        if (scorePatterns && scorePatterns.length > 0) {
          for (const sp of scorePatterns) {
            const parts = sp.match(/(\d+)\s*:\s*(\d+)/);
            if (parts) {
              const h = parseInt(parts[1]);
              const a = parseInt(parts[2]);
              // Filter out time patterns (like 19:00, 20:30)
              if (h <= 20 && a <= 20 && !(h >= 0 && h <= 23 && a <= 59 && a > 20)) {
                homeScore = h;
                awayScore = a;
                break;
              }
            }
          }
        }
      }
    }

    // Also extract team slugs for future team page lookups
    const homeSlugMatch = row.match(/href="\/tr\/football\/team\/([^"]+)"/i);
    const awaySlugMatch = row.matchAll(/href="\/tr\/football\/team\/([^"]+)"/gi);
    const awaySlugs = [...awaySlugMatch];

    // Parse inline raceDataPopup2 stats if present (embedded in fixtures row HTML)
    const inlineStats = parseInlineRaceData(row);

    // Extract HT score from score cells (first cell = HT, last = FT)
    let htHomeScore = 0;
    let htAwayScore = 0;
    if (isMS || hasScoreCell || !isVS) {
      const scoreCellPattern = /class="[^"]*(?:blue-color|red-color)[^"]*"[^>]*>\s*(\d+)\s*:\s*(\d+)/g;
      const allScoreCells: { h: number; a: number }[] = [];
      let cellMatch;
      while ((cellMatch = scoreCellPattern.exec(row)) !== null) {
        const h = parseInt(cellMatch[1]);
        const a = parseInt(cellMatch[2]);
        if (h <= 20 && a <= 20) {
          allScoreCells.push({ h, a });
        }
      }
      // If there are 2+ score cells, first is HT, last is FT
      if (allScoreCells.length >= 2) {
        htHomeScore = allScoreCells[0].h;
        htAwayScore = allScoreCells[0].a;
      }
    }

    // Also try to extract HT score from the raceDataPopup header ("H Scores 1 : 2")
    if (htHomeScore === 0 && htAwayScore === 0) {
      const htHeaderMatch = row.match(/H\s+Scores?\s+(\d+)\s*:\s*(\d+)/i);
      if (htHeaderMatch) {
        htHomeScore = parseInt(htHeaderMatch[1]);
        htAwayScore = parseInt(htHeaderMatch[2]);
      }
    }

    matches.push({
      id,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      htHomeScore,
      htAwayScore,
      league,
      time: matchTime,
      status,
      url: `/tr/match/${id}`,
      stats: inlineStats,
    });
  }
}

// ── Parse inline raceDataPopup2 from match row ──────────────
// The fixtures page embeds match stats inside a popup div in each row:
// <td class="hasRaceDataPopup ...">1 : 2<i class="fa fa-angle-down"></i>
//   <div class="panel score-bar-con raceDataPopup2">
//     <div class="panel-body">
//       <div class="row MBTitle racdDataPopup2Half">
//         <div class="small-6 columns ...">H Scores 1 : 2</div>
//         <div class="small-6 columns ...">H Corners 6 : 1</div>
//       </div>
//       <div class="score-bar-item"><h5>On Target</h5>...
//       <div class="score-bar-item"><h5>Dangerous Attacks</h5>...
//       ...
//     </div>
//   </div>
// </td>
// Both English and Turkish labels may appear depending on page language.

function parseInlineRaceData(rowHtml: string): ScoremerMatchStats | null {
  if (!rowHtml.includes('raceDataPopup2') && !rowHtml.includes('score-bar-item')) return null;

  const stats: ScoremerMatchStats = {
    shots_on_target: null,
    shots_off_target: null,
    dangerous_attacks: null,
    attacks: null,
    possession: null,
    expected_goals: null,
    corners: null,
    ht_shots_on_target: null,
    ht_shots_off_target: null,
    ht_dangerous_attacks: null,
    ht_attacks: null,
    ht_possession: null,
    ht_corners: null,
  };

  // Stat name mapping (both English and Turkish labels)
  const statNameMap: Record<string, { key: keyof ScoremerMatchStats; isPct?: boolean }> = {
    'On Target': { key: 'shots_on_target' },
    'Off Target': { key: 'shots_off_target' },
    'Dangerous Attacks': { key: 'dangerous_attacks' },
    'Attacks': { key: 'attacks' },
    'Possession %': { key: 'possession', isPct: true },
    'Possession': { key: 'possession', isPct: true },
    'Hedefe vuruşlar': { key: 'shots_on_target' },
    'Hedef dışı vuruşlar': { key: 'shots_off_target' },
    'Tehlikeli Saldırılar': { key: 'dangerous_attacks' },
    'Saldırılar': { key: 'attacks' },
    'Top sahipliği': { key: 'possession', isPct: true },
    'Top sahipliği %': { key: 'possession', isPct: true },
  };

  // Parse HT scores and corners from the header row
  const htHeaderMatch = rowHtml.match(/H\s+Scores?\s+(\d+)\s*:\s*(\d+)/i);
  if (htHeaderMatch) {
    // These are HT scores - store as metadata (not in stats struct directly)
  }
  const htCornersMatch = rowHtml.match(/H\s+Corners?\s+(\d+)\s*:\s*(\d+)/i);
  if (htCornersMatch) {
    stats.ht_corners = { home: parseInt(htCornersMatch[1]), away: parseInt(htCornersMatch[2]) };
  }

  // Parse stat items using h5 + small-2 columns pattern
  const h5Regex = /<h5>([^<]+)<\/h5>/gi;
  let h5Match;
  while ((h5Match = h5Regex.exec(rowHtml)) !== null) {
    const statName = h5Match[1].trim();
    const mapping = statNameMap[statName];
    if (!mapping) continue;

    const contextStart = h5Match.index;
    const contextEnd = Math.min(rowHtml.length, contextStart + 600);
    const context = rowHtml.substring(contextStart, contextEnd);

    // Look for small-2 columns with values
    const colRegex = /class="small-2[^"]*text-center[^"]*columns"[^>]*>([^<]+)<\/div>/gi;
    const values: string[] = [];
    let colMatch;
    while ((colMatch = colRegex.exec(context)) !== null) {
      values.push(colMatch[1].trim());
    }

    if (values.length >= 2) {
      const home = parseStatValue(values[0], mapping.isPct);
      const away = parseStatValue(values[values.length - 1], mapping.isPct);
      if (home !== null && away !== null) {
        (stats as any)[mapping.key] = { home, away };
      }
    }
  }

  // Check if we got any meaningful stats
  const hasAnyStat = Object.values(stats).some(v => v !== null);
  return hasAnyStat ? stats : null;
}

// ── Parse match detail stats from scoremer.com/tr/match_live/ID ──

async function fetchScoremerMatchStats(matchId: string): Promise<ScoremerMatchStats | null> {
  const url = `${SCOREMER_TR_BASE}/match_live/${matchId}`;
  const html = await fetchDirectHttp(url);
  if (!html) {
    errLog(`[Scoremer] Failed to fetch match detail for ${matchId}`);
    return null;
  }

  if (!html.includes('Hedefe vuruşlar') && !html.includes('Tehlikeli Saldırılar') &&
      !html.includes('On Target') && !html.includes('Dangerous Attacks')) {
    log(`[Scoremer] No stats found for match ${matchId} (likely not yet played)`);
    return null;
  }

  return parseStatsFromHtml(html);
}

// ── Parse stats from HTML content ─────────────────────────────

function parseStatsFromHtml(html: string): ScoremerMatchStats | null {
  const stats: ScoremerMatchStats = {
    shots_on_target: null,
    shots_off_target: null,
    dangerous_attacks: null,
    attacks: null,
    possession: null,
    expected_goals: null,
    corners: null,
    ht_shots_on_target: null,
    ht_shots_off_target: null,
    ht_dangerous_attacks: null,
    ht_attacks: null,
    ht_possession: null,
    ht_corners: null,
  };

  // Find the full-time stats section (before Yarım Zaman / Half Time)
  const yarimZamanIdx = html.indexOf('Yarım Zaman');
  const halfTimeIdx = html.indexOf('Half Time');
  const splitIdx = yarimZamanIdx > 0 ? yarimZamanIdx : halfTimeIdx > 0 ? halfTimeIdx : -1;
  const fullTimeHtml = splitIdx > 0 ? html.substring(0, splitIdx) : html;
  const halfTimeHtml = splitIdx > 0 ? html.substring(splitIdx) : '';

  // Parse stats from full-time section
  parseStatSection(fullTimeHtml, stats, false);
  // Parse stats from half-time section
  parseStatSection(halfTimeHtml, stats, true);

  // Check if we got any stats
  const hasAnyStat = Object.values(stats).some(v => v !== null);
  if (!hasAnyStat) return null;

  return stats;
}

function parseStatSection(html: string, stats: ScoremerMatchStats, isHalfTime: boolean) {
  const statNameMap: Record<string, { key: keyof ScoremerMatchStats; isPct?: boolean }> = {
    // Turkish labels
    'Hedefe vuruşlar': { key: isHalfTime ? 'ht_shots_on_target' : 'shots_on_target' },
    'Hedef dışı vuruşlar': { key: isHalfTime ? 'ht_shots_off_target' : 'shots_off_target' },
    'Tehlikeli Saldırılar': { key: isHalfTime ? 'ht_dangerous_attacks' : 'dangerous_attacks' },
    'Saldırılar': { key: isHalfTime ? 'ht_attacks' : 'attacks' },
    'Top sahipliği': { key: isHalfTime ? 'ht_possession' : 'possession', isPct: true },
    'Top sahipliği %': { key: isHalfTime ? 'ht_possession' : 'possession', isPct: true },
    'Expected Goals': { key: isHalfTime ? 'ht_expected_goals' as keyof ScoremerMatchStats : 'expected_goals' },
    'Köşe vuruşlar': { key: isHalfTime ? 'ht_corners' : 'corners' },
    // English labels (some pages use English)
    'On Target': { key: isHalfTime ? 'ht_shots_on_target' : 'shots_on_target' },
    'Off Target': { key: isHalfTime ? 'ht_shots_off_target' : 'shots_off_target' },
    'Dangerous Attacks': { key: isHalfTime ? 'ht_dangerous_attacks' : 'dangerous_attacks' },
    'Attacks': { key: isHalfTime ? 'ht_attacks' : 'attacks' },
    'Possession %': { key: isHalfTime ? 'ht_possession' : 'possession', isPct: true },
    'Possession': { key: isHalfTime ? 'ht_possession' : 'possession', isPct: true },
    'Corners': { key: isHalfTime ? 'ht_corners' : 'corners' },
  };

  // Try Pattern 1 (flex layout) first
  const flexRegex = /<div[^>]*style="display:\s*flex[^"]*"[^>]*>\s*<span>([^<]+)<\/span>\s*<span>([^<]+)<\/span>\s*<span>([^<]+)<\/span>\s*<\/div>/gi;
  let flexMatch;
  while ((flexMatch = flexRegex.exec(html)) !== null) {
    const homeVal = flexMatch[1].trim();
    const statName = flexMatch[2].trim();
    const awayVal = flexMatch[3].trim();

    const mapping = statNameMap[statName];
    if (mapping) {
      const home = parseStatValue(homeVal, mapping.isPct);
      const away = parseStatValue(awayVal, mapping.isPct);
      if (home !== null && away !== null) {
        (stats as any)[mapping.key] = { home, away };
      }
    }
  }

  // Try Pattern 2 (classic layout with h5 and small-2 columns)
  const classicRegex = /<h5>([^<]+)<\/h5>\s*<div[^>]*>\s*<div[^>]*class="small-2[^"]*"[^>]*>([^<]+)<\/div>\s*<div[^>]*class="small-8[^"]*"[^>]*>[\s\S]*?<\/div>\s*<div[^>]*class="small-2[^"]*"[^>]*>([^<]+)<\/div>/gi;
  let classicMatch;
  while ((classicMatch = classicRegex.exec(html)) !== null) {
    const statName = classicMatch[1].trim();
    const homeVal = classicMatch[2].trim();
    const awayVal = classicMatch[3].trim();

    const mapping = statNameMap[statName];
    if (mapping) {
      const home = parseStatValue(homeVal, mapping.isPct);
      const away = parseStatValue(awayVal, mapping.isPct);
      if (home !== null && away !== null) {
        (stats as any)[mapping.key] = { home, away };
      }
    }
  }

  // Also try a simpler pattern for the h5-based layout (both Turkish and English labels)
  const simpleH5Regex = /<h5>(Hedefe vuruşlar|Hedef dışı vuruşlar|Tehlikeli Saldırılar|Saldırılar|Top sahipliği|Top sahipliği %|Expected Goals|Köşe vuruşlar|On Target|Off Target|Dangerous Attacks|Attacks|Possession %|Possession|Corners)<\/h5>/gi;
  let h5Match;
  while ((h5Match = simpleH5Regex.exec(html)) !== null) {
    const statName = h5Match[1];
    const mapping = statNameMap[statName];
    if (mapping && !stats[mapping.key]) {
      const contextStart = h5Match.index;
      const contextEnd = Math.min(html.length, contextStart + 800);
      const context = html.substring(contextStart, contextEnd);

      // Look for small-2 columns
      const colRegex = /class="small-2[^"]*text-center[^"]*columns"[^>]*>([^<]+)<\/div>/gi;
      const values: string[] = [];
      let colMatch;
      while ((colMatch = colRegex.exec(context)) !== null) {
        values.push(colMatch[1].trim());
      }
      if (values.length >= 2) {
        const home = parseStatValue(values[0], mapping.isPct);
        const away = parseStatValue(values[values.length - 1], mapping.isPct);
        if (home !== null && away !== null) {
          (stats as any)[mapping.key] = { home, away };
        }
      }
    }
  }
}

function parseStatValue(val: string, isPct?: boolean): number | null {
  if (!val) return null;
  const cleaned = val.replace('%', '').replace(',', '.').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return num;
}

// ── Team name normalization for mapping ────────────────────────

// ── Build Nesine→Scoremer match mapping ────────────────────────

async function buildScoremerMappings(
  nesineMatches: { code: number; home: string; away: string; time: string }[]
): Promise<ScoremerMapping[]> {
  const scoremerMatches = await fetchScoremerMatchList();
  if (scoremerMatches.length === 0) {
    warn("[Scoremer] No matches found from fixtures pages");
    return [];
  }

  const mappings: ScoremerMapping[] = [];

  for (const nm of nesineMatches) {
    let bestMatch: { match: ScoremerMatch; confidence: number } | null = null;

    for (const sm of scoremerMatches) {
      const homeSim = nameSimilarity(nm.home, sm.homeTeam);
      const awaySim = nameSimilarity(nm.away, sm.awayTeam);

      // Try swapped
      const homeSimSwap = nameSimilarity(nm.home, sm.awayTeam);
      const awaySimSwap = nameSimilarity(nm.away, sm.homeTeam);

      const nameConf = Math.max(
        (homeSim + awaySim) / 2,
        (homeSimSwap + awaySimSwap) / 2
      );

      // Score match bonus
      let scoreBonus = 0;
      const nmHome = parseInt(String(nm.home)) || 0;
      const nmAway = parseInt(String(nm.away)) || 0;
      if (sm.homeScore === nmHome || sm.awayScore === nmAway) {
        scoreBonus = 0.05;
      }
      if (sm.homeScore === nmHome && sm.awayScore === nmAway) {
        scoreBonus = 0.1;
      }

      const conf = nameConf + scoreBonus;

      if (conf > 0.5 && (!bestMatch || conf > bestMatch.confidence)) {
        bestMatch = { match: sm, confidence: conf };
      }
    }

    if (bestMatch) {
      mappings.push({
        nesineCode: nm.code,
        scoremerId: bestMatch.match.id,
        scoremerUrl: bestMatch.match.url,
        confidence: bestMatch.confidence,
      });
    }
  }

  log(`[Scoremer] Built ${mappings.length} mappings from ${nesineMatches.length} Nesine matches`);
  return mappings;
}

// ── Convert Scoremer stats to app's MatchStats format ──────────

export function convertScoremerStatsToMatchStats(
  scoremerStats: ScoremerMatchStats | null,
  isHalfTime: boolean = false
): Record<string, { home: number | null; away: number | null }> {
  if (!scoremerStats) return {};

  const result: Record<string, { home: number | null; away: number | null }> = {};

  const prefix = isHalfTime ? 'ht_' : '';

  const statMappings: { scoremerKey: keyof ScoremerMatchStats; appKey: string }[] = [
    { scoremerKey: `${prefix}shots_on_target` as keyof ScoremerMatchStats, appKey: 'shots_on_target' },
    { scoremerKey: `${prefix}shots_off_target` as keyof ScoremerMatchStats, appKey: 'shots_off_target' },
    { scoremerKey: `${prefix}dangerous_attacks` as keyof ScoremerMatchStats, appKey: 'dangerous_attacks' },
    { scoremerKey: `${prefix}attacks` as keyof ScoremerMatchStats, appKey: 'attacks' },
    { scoremerKey: `${prefix}possession` as keyof ScoremerMatchStats, appKey: 'possession' },
    { scoremerKey: `${prefix}expected_goals` as keyof ScoremerMatchStats, appKey: 'xg' },
    { scoremerKey: `${prefix}corners` as keyof ScoremerMatchStats, appKey: 'corners' },
  ];

  for (const mapping of statMappings) {
    const stat = scoremerStats[mapping.scoremerKey];
    if (stat) {
      result[mapping.appKey] = {
        home: stat.home,
        away: stat.away,
      };
    }
  }

  // Calculate shots_total from on_target + off_target (Scoremer doesn't provide total directly)
  const sotKey = `${prefix}shots_on_target` as keyof ScoremerMatchStats;
  const sofKey = `${prefix}shots_off_target` as keyof ScoremerMatchStats;
  const sot = scoremerStats[sotKey];
  const sof = scoremerStats[sofKey];
  if (sot || sof) {
    result.shots_total = {
      home: (sot?.home ?? 0) + (sof?.home ?? 0),
      away: (sot?.away ?? 0) + (sof?.away ?? 0),
    };
  }

  return result;
}

// ── In-memory cache ─────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const matchListCache: { entry: CacheEntry<ScoremerMatch[]> | null } = { entry: null };
const statsCache = new Map<string, CacheEntry<ScoremerMatchStats>>();
const mappingCache: { entry: CacheEntry<ScoremerMapping[]> | null } = { entry: null };

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function fetchScoremerMatchListCached(): Promise<ScoremerMatch[]> {
  if (matchListCache.entry && Date.now() - matchListCache.entry.timestamp < CACHE_TTL) {
    return matchListCache.entry.data;
  }
  const data = await fetchScoremerMatchList();
  matchListCache.entry = { data, timestamp: Date.now() };
  return data;
}

export async function fetchScoremerMatchStatsCached(matchId: string): Promise<ScoremerMatchStats | null> {
  const cached = statsCache.get(matchId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  const data = await fetchScoremerMatchStats(matchId);
  if (data) {
    statsCache.set(matchId, { data, timestamp: Date.now() });
  }
  return data;
}

export async function buildScoremerMappingsCached(
  nesineMatches: { code: number; home: string; away: string; time: string }[]
): Promise<ScoremerMapping[]> {
  if (mappingCache.entry && Date.now() - mappingCache.entry.timestamp < CACHE_TTL) {
    return mappingCache.entry.data;
  }
  const data = await buildScoremerMappings(nesineMatches);
  mappingCache.entry = { data, timestamp: Date.now() };
  return data;
}
