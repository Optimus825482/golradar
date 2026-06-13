// FotMob API types and helpers
// Provides enriched match data: lineups, events, stats (1H/2H), weather, H2H, form

const FOTMOB_BASE = "https://www.fotmob.com/api/data";

const FOTMOB_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
};

// ── Types ──────────────────────────────────────────────────────

export interface FotMobMatchDay {
  id: number;
  leagueId: number;
  time: string;
  timeTS: number;
  home: {
    id: number;
    name: string;
    longName: string;
    score?: number;
    redCards?: number;
  };
  away: {
    id: number;
    name: string;
    longName: string;
    score?: number;
    redCards?: number;
  };
  status: {
    utcTime: string;
    finished: boolean;
    started: boolean;
    ongoing?: boolean;
    scoreStr?: string;
    liveTime?: { short: string; long: string };
    reason?: { short: string; long: string };
  };
}

export interface FotMobLineupPlayer {
  id: number;
  name: string;
  firstName?: string;
  lastName?: string;
  shirtNumber?: string;
  positionId: number;
  usualPlayingPositionId: number;
  countryName?: string;
  countryCode?: string;
  primaryTeamName?: string;
  marketValue?: number;
  rating?: number;
  performance?: {
    goals?: number;
    assists?: number;
    yellowCards?: number;
    redCards?: number;
    saves?: number;
    [key: string]: any;
  };
  horizontalLayout?: { x: number; y: number; height: number; width: number };
  verticalLayout?: { x: number; y: number; height: number; width: number };
  isCaptain?: boolean;
}

export interface FotMobLineupTeam {
  id: number;
  name: string;
  rating?: number;
  formation?: string;
  starters: FotMobLineupPlayer[];
  substitutes?: FotMobLineupPlayer[];
}

export interface FotMobEvent {
  time: number;          // Match minute (numeric)
  timeStr?: number;      // Same as time in some responses
  type: string;          // 'Goal', 'Card', 'Sub', 'Var', etc.
  timeTS?: number;
  isHome?: boolean;      // Whether this is a home team event
  playerName?: string;
  player?: { name: string; id?: number; profileUrl?: string };
  player1?: { name: string; id?: number };
  player2?: { name: string; id?: number };
  assistPlayerName?: string;
  addedTime?: string;
  homeScore?: number;
  awayScore?: number;
  overloadTime?: number | null;
  eventId?: number;
  [key: string]: any;
}

export interface FotMobStatGroup {
  title: string;
  key: string;
  type?: string;
  stats: {
    title: string;
    key: string;
    stats: (number | string | null)[];
    format?: string;
    type: string;
    highlighted?: string;
  }[];
}

export interface FotMobWeather {
  temperature: number;
  windSpeed: number;
  windDirectionCardinal: string;
  iconCode: number;
  relativeHumidity: number;
  precipitation: number;
  cloudCover: number;
  description: string;
}

export interface FotMobH2HMatch {
  time: { utcTime: string };
  home: { name: string; id: number; score?: number };
  away: { name: string; id: number; score?: number };
  status: { reason?: { short: string } };
  league: { name: string };
}

export interface FotMobFormEntry {
  matchId: number;
  opponentName: string;
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  result: "W" | "D" | "L";
  date: string;
}

// ── FotMob Momentum Types ──────────────────────────────────────────

export interface FotMobMomentumPoint {
  minute: number;       // Match minute (0-90+, 45.5 = halftime)
  value: number;        // -100 to +100 (positive=home dominant, negative=away)
}

export interface FotMobMomentum {
  main: {
    data: FotMobMomentumPoint[];
  };
  alternateModels?: any[];
}

export interface FotMobShot {
  id: number;
  eventType: 'Miss' | 'AttemptSaved' | 'Goal' | 'ShotOnPost' | 'OwnGoal';
  teamId: number;
  playerId: number;
  playerName: string;
  firstName?: string;
  lastName?: string;
  x: number;                // Pitch x coordinate
  y: number;                // Pitch y coordinate
  min: number;              // Match minute
  minAdded: number | null;  // Added time
  isBlocked: boolean;
  isOnTarget: boolean;
  expectedGoals: number;    // xG value for this shot
  expectedGoalsOnTarget: number | null;
  shotType: string;         // 'RightFoot', 'LeftFoot', 'Header', etc.
  situation: string;        // 'OpenPlay', 'FromCorner', 'SetPiece', 'Penalty'
  period: string;           // 'FirstHalf', 'SecondHalf'
  isOwnGoal: boolean;
  isFromInsideBox: boolean;
  teamColor: string;
}

export interface FotMobMatchDetails {
  matchId: number;
  homeTeam: FotMobLineupTeam | null;
  awayTeam: FotMobLineupTeam | null;
  events: FotMobEvent[];
  stats: Record<string, FotMobStatGroup[]>; // key: "All" | "1H" | "2H"
  weather: FotMobWeather | null;
  h2h: { summary: number[]; matches: FotMobH2HMatch[] } | null;
  homeForm: FotMobFormEntry[];
  awayForm: FotMobFormEntry[];
  momentum: FotMobMomentum | null;
  shotmap: FotMobShot[] | null;
  infoBox: {
    stadium?: { name: string; city: string; capacity: number; surface: string };
    referee?: string;
    attendance?: string;
  } | null;
  // NetScores-specific enriched data (when using NetScores as data source)
  _netscores?: {
    id: number;
    url: string;
    timer: any;
    ht_at: string | null;
    game_length: number | null;
    rawStats: any;
    rawEvents: any;
    xg: { home: string; away: string } | null;
    convertedStats: any;
    leagueState: any;
    situation: any;
    groups: any;
    firstHalfScore?: string;
    missingPlayers?: any;
  };
}

// ── Match ID mapping ──

interface MatchMapping {
  nesineCode: number;
  fotmobId: number;
  confidence: number; // 0-1
}

// Cache for match mappings (refreshed every 5 min)
let mappingCache: { timestamp: number; date: string; mappings: MatchMapping[] } | null = null;
const MAPPING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Name normalization for matching (delegated to shared module) ──

import { normalizeTeamName, translateTeamName, nameSimilarity } from './teamNameNormalizer';

// ── Fetch FotMob matches for today ──

export async function fetchFotMobMatches(date?: string): Promise<FotMobMatchDay[]> {
  const d = date || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const url = `${FOTMOB_BASE}/matches?date=${d}`;
  
  try {
    const resp = await fetch(url, { headers: FOTMOB_HEADERS, cache: "no-store" });
    if (!resp.ok) return [];
    const data = await resp.json();
    
    const matches: FotMobMatchDay[] = [];
    for (const league of data.leagues || []) {
      for (const m of league.matches || []) {
        matches.push(m);
      }
    }
    return matches;
  } catch {
    return [];
  }
}

// ── Build Nesine→FotMob match mapping ──

export async function buildMatchMappings(
  nesineMatches: { code: number; home: string; away: string; time: string }[]
): Promise<MatchMapping[]> {
  // Check cache
  const today = new Date().toISOString().slice(0, 10);
  if (mappingCache && mappingCache.date === today && Date.now() - mappingCache.timestamp < MAPPING_CACHE_TTL) {
    return mappingCache.mappings;
  }
  
  const fotmobMatches = await fetchFotMobMatches();
  const mappings: MatchMapping[] = [];
  
  for (const nm of nesineMatches) {
    let bestMatch: { fotmobId: number; confidence: number } | null = null;
    
    for (const fm of fotmobMatches) {
      const homeSim = nameSimilarity(nm.home, fm.home.name);
      const awaySim = nameSimilarity(nm.away, fm.away.name);
      
      // Time match (within 5 minutes tolerance)
      let timeMatch = false;
      try {
        // Parse Nesine time (HH:MM format, Istanbul timezone)
        const nesineMinutes = parseInt(nm.time.split(":")[0]) * 60 + parseInt(nm.time.split(":")[1]);
        // Parse FotMob time from UTC timestamp
        const fmDate = new Date(fm.status.utcTime);
        const fmIstanbul = new Date(fmDate.toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
        const fmMinutes = fmIstanbul.getHours() * 60 + fmIstanbul.getMinutes();
        timeMatch = Math.abs(nesineMinutes - fmMinutes) <= 5;
      } catch {}
      
      // Combined confidence: name similarity + time match
      const nameConf = (homeSim + awaySim) / 2;
      const conf = nameConf * (timeMatch ? 1.0 : 0.6);
      
      if (conf > 0.5 && (!bestMatch || conf > bestMatch.confidence)) {
        bestMatch = { fotmobId: fm.id, confidence: conf };
      }
    }
    
    if (bestMatch) {
      mappings.push({
        nesineCode: nm.code,
        fotmobId: bestMatch.fotmobId,
        confidence: bestMatch.confidence,
      });
    }
  }
  
  // Update cache
  mappingCache = { timestamp: Date.now(), date: today, mappings };
  return mappings;
}

// ── Fetch FotMob match details ──

export async function fetchMatchDetails(fotmobId: number): Promise<FotMobMatchDetails | null> {
  const url = `${FOTMOB_BASE}/matchDetails?matchId=${fotmobId}`;
  
  try {
    const resp = await fetch(url, { headers: FOTMOB_HEADERS, cache: "no-store" });
    if (!resp.ok) return null;
    const data = await resp.json();
    
    const content = data.content || {};
    
    // Parse lineups
    const lineupData = content.lineup || {};
    const homeTeam: FotMobLineupTeam | null = lineupData.homeTeam || null;
    const awayTeam: FotMobLineupTeam | null = lineupData.awayTeam || null;
    
    // Parse events — FotMob structure: matchFacts.events = {events: [...], eventTypes: [...]}
    const mfData = content.matchFacts || {};
    const eventsContainer = mfData.events;
    let parsedEvents: FotMobEvent[] = [];
    
    if (eventsContainer) {
      if (Array.isArray(eventsContainer.events)) {
        // Standard FotMob format: {events: [...], eventTypes: [...]}
        parsedEvents = eventsContainer.events;
      } else if (Array.isArray(eventsContainer)) {
        // Flat array format
        parsedEvents = eventsContainer;
      } else if (typeof eventsContainer === 'object') {
        // Organized by type
        const eventTypes = eventsContainer.eventTypes || eventsContainer;
        if (Array.isArray(eventTypes)) {
          for (const et of eventTypes) {
            if (et.events && Array.isArray(et.events)) {
              parsedEvents.push(...et.events);
            }
          }
        }
      }
    }
    
    // Parse stats with period breakdown
    const statsData = content.stats || {};
    const parsedStats: Record<string, FotMobStatGroup[]> = {};
    if (statsData.Periods) {
      for (const [period, periodData] of Object.entries(statsData.Periods)) {
        if (periodData && typeof periodData === "object" && (periodData as any).stats) {
          parsedStats[period] = (periodData as any).stats;
        }
      }
    }
    
    // Parse weather
    const weatherData = content.weather || null;
    
    // Parse H2H
    const h2hData = content.h2h || null;
    let parsedH2H: FotMobMatchDetails["h2h"] = null;
    if (h2hData) {
      parsedH2H = {
        summary: h2hData.summary || [0, 0, 0],
        matches: h2hData.matches || [],
      };
    }
    
    // Parse team form
    const teamFormData = mfData.teamForm || {};
    const homeForm: FotMobFormEntry[] = parseFormEntries(teamFormData, homeTeam?.id);
    const awayForm: FotMobFormEntry[] = parseFormEntries(teamFormData, awayTeam?.id);
    
    // Parse info box
    const infoBoxData = mfData.infoBox || null;
    let parsedInfoBox: FotMobMatchDetails["infoBox"] = null;
    if (infoBoxData) {
      parsedInfoBox = {
        stadium: infoBoxData.Stadium ? {
          name: infoBoxData.Stadium.name || "",
          city: infoBoxData.Stadium.city || "",
          capacity: infoBoxData.Stadium.capacity || 0,
          surface: infoBoxData.Stadium.surface || "",
        } : undefined,
        referee: infoBoxData.Referee?.text || undefined,
        attendance: infoBoxData.Attendance || undefined,
      };
    }
    
    // Momentum — FotMob format: {main: {data: [{minute, value}]}}
    const momentumData = content.momentum;
    let parsedMomentum: FotMobMomentum | null = null;
    if (momentumData && typeof momentumData === 'object' && momentumData.main?.data) {
      parsedMomentum = {
        main: { data: momentumData.main.data },
        alternateModels: momentumData.alternateModels || [],
      };
    }
    
    // Shotmap — FotMob format: {shots: [{id, eventType, teamId, expectedGoals, min, ...}]}
    const shotmapData = content.shotmap || {};
    let parsedShotmap: FotMobShot[] | null = null;
    if (Array.isArray(shotmapData.shots)) {
      parsedShotmap = shotmapData.shots;
    }
    
    return {
      matchId: data.general?.matchId || fotmobId,
      homeTeam,
      awayTeam,
      events: parsedEvents,
      stats: parsedStats,
      weather: weatherData,
      h2h: parsedH2H,
      homeForm,
      awayForm,
      momentum: parsedMomentum,
      shotmap: parsedShotmap,
      infoBox: parsedInfoBox,
    };
  } catch (error) {
    console.error("FotMob fetch error:", error);
    return null;
  }
}

function parseFormEntries(teamForm: any, teamId?: number): FotMobFormEntry[] {
  if (!teamForm || !teamId) return [];
  
  const entries: FotMobFormEntry[] = [];
  // teamForm is keyed by team ID
  const teamData = teamForm[teamId] || teamForm[String(teamId)];
  if (!Array.isArray(teamData)) return [];
  
  for (const entry of teamData.slice(0, 5)) {
    entries.push({
      matchId: entry.matchId || 0,
      opponentName: entry.opponentName || entry.opponent?.name || "?",
      home: entry.isHome ?? entry.home ?? true,
      goalsFor: entry.goalsFor ?? entry.score?.home ?? 0,
      goalsAgainst: entry.goalsAgainst ?? entry.score?.away ?? 0,
      result: entry.result || (entry.status?.reason?.short?.[0] as any) || "D",
      date: entry.time?.utcTime || "",
    });
  }
  
  return entries;
}

// ── Get team logo URL ──
function getFotMobTeamLogo(teamId: number): string {
  return `https://media.fotmob.com/images/team/${teamId}`;
}

// ── Get player image URL ──
function getFotMobPlayerImage(playerId: number): string {
  return `https://media.fotmob.com/images/player/${playerId}`;
}

// ── Position ID to position name ──
function getPositionName(positionId: number): string {
  const positions: Record<number, string> = {
    1: "GK",
    2: "RB",
    3: "CB",
    4: "LB",
    5: "RW",
    6: "CM",
    7: "LW",
    8: "CF",
    9: "RF",
    10: "LF",
    11: "GK",
    12: "DM",
    13: "AM",
    14: "RM",
    15: "LM",
  };
  return positions[positionId] || "";
}
