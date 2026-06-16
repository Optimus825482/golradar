import { NextResponse } from "next/server";
import {
  LIVESCORE_API,
  HEADERS,
  EXCLUDED_STATUSES,
  ACTIVE_STATUSES,
  FINISHED_STATUSES,
  parseMatch,
  calculatePressure,
  calculateGoalProbability,
  hydrateFotMobIdCache,
  ParsedMatch,
  MatchStats,
  GoalProbability,
} from "@/lib/nesine";
import { getCachedMatchDetails } from "@/lib/fotmob";
import { autoFetchMissingRatings, getRating } from "@/lib/eloRating";
import { db } from "@/lib/db";
import { checkForGoals } from "@/lib/goalSignalTracker";

export const dynamic = "force-dynamic";

interface PressureSnapshot {
  minute: string;
  timestamp: number;
  homePressure: number;
  awayPressure: number;
  stats: MatchStats;
  homeGoals: number;
  awayGoals: number;
}

interface MatchPressureHistory {
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  snapshots: PressureSnapshot[];
}

const globalForHistory = globalThis as unknown as {
  pressureHistory: Map<number, MatchPressureHistory> | undefined;
};
if (!globalForHistory.pressureHistory) {
  globalForHistory.pressureHistory = new Map();
}
const pressureHistory = globalForHistory.pressureHistory;

// Eviction: cap at 500 matches, remove stale entries (>6h old)
const MAX_HISTORY_ENTRIES = 500;
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;
function evictStaleHistory() {
  if (pressureHistory.size <= MAX_HISTORY_ENTRIES) return;
  const now = Date.now();
  for (const [code, hist] of pressureHistory) {
    const lastSnap = hist.snapshots[hist.snapshots.length - 1];
    if (lastSnap && now - lastSnap.timestamp > HISTORY_TTL_MS) {
      pressureHistory.delete(code);
    }
  }
  // If still over limit, remove oldest entries
  if (pressureHistory.size > MAX_HISTORY_ENTRIES) {
    const entries = [...pressureHistory.entries()];
    entries.sort((a, b) => {
      const aTime = a[1].snapshots[a[1].snapshots.length - 1]?.timestamp ?? 0;
      const bTime = b[1].snapshots[b[1].snapshots.length - 1]?.timestamp ?? 0;
      return aTime - bTime;
    });
    const toRemove = entries.slice(0, pressureHistory.size - MAX_HISTORY_ENTRIES);
    for (const [code] of toRemove) pressureHistory.delete(code);
  }
}
evictStaleHistory();

const HALFTIME_STATUSES = new Set([3, 28]);

const emptyResponse = () => NextResponse.json({
  matches: [], byLeague: {}, version: 0, count: 0, pressureData: {}, goalRadarData: {},
});

function updatePressureHistory(match: ParsedMatch) {
  if (!match.hasStats) return;
  if (HALFTIME_STATUSES.has(match.status)) return;

  let history = pressureHistory.get(match.code);
  if (!history) {
    history = {
      homeTeam: match.home,
      awayTeam: match.away,
      league: match.league,
      country: match.country,
      snapshots: [],
    };
    pressureHistory.set(match.code, history);
  }

  const pressure = calculatePressure(match.stats);
  const now = Date.now();
  const last = history.snapshots[history.snapshots.length - 1];
  if (last && now - last.timestamp < 3000) return;

  history.snapshots.push({
    minute: match.minute, timestamp: now,
    homePressure: pressure.home, awayPressure: pressure.away,
    stats: { ...match.stats },
    homeGoals: match.homeGoals, awayGoals: match.awayGoals,
  });

  if (history.snapshots.length > 540) {
    history.snapshots = history.snapshots.slice(-540);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const version = searchParams.get("v") || "0";

  // Best-effort async hydration of the in-memory FotMob ID cache.
  // Failure is silent — route continues with non-enriched goalRadar.
  void hydrateFotMobIdCache().catch(() => {});

  let resp;
  try {
    resp = await fetch(`${LIVESCORE_API}?sportType=1&v=${version}`, {
      headers: HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return emptyResponse();
  }
  if (!resp.ok) return emptyResponse();

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return emptyResponse();
  }
  if (!data || data.sc !== 200) return emptyResponse();

  const rawMatches = data.d || [];
  const matches: (ParsedMatch & { goalRadar?: GoalProbability })[] = [];

  // Fan out FotMob cache lookups for live matches in parallel.
  // Padded to a 200ms deadline so a slow/missing cache never blocks
  // the response — failures degrade gracefully to non-enriched output.
  const fotmobPromises = new Map<
    number,
    Promise<import("@/lib/fotmob").FotMobMatchDetails | null>
  >();
  for (const m of rawMatches) {
    const status = m.S || 0;
    if (!ACTIVE_STATUSES.has(status)) continue;
    const code = m.C || 0;
    if (fotmobPromises.has(code)) continue;
    // Defer to parse-time so we know the resolved matchDate/fotmobId
    // after the team-mapping cache hydrates.
  }

  for (const m of rawMatches) {
    const status = m.S || 0;
    if (EXCLUDED_STATUSES.has(status)) continue;
    if (!ACTIVE_STATUSES.has(status) && !FINISHED_STATUSES.has(status))
      continue;

    const parsed = parseMatch(m);
    updatePressureHistory(parsed);

    // Fire-and-forget goal verification for live matches
    if (parsed.isLive && parsed.hasStats) {
      const currentMinute =
        parseInt(parsed.minute.replace(/[^0-9]/g, ""), 10) || 0;
      const today = new Date();
      const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      void checkForGoals(
        parsed.code,
        parsed.homeGoals,
        parsed.awayGoals,
        currentMinute,
        localDate,
      ).catch(() => {});
    }

    const hist = pressureHistory.get(parsed.code);
    let goalRadar: GoalProbability | undefined;

    if (parsed.isLive && parsed.hasStats) {
      // Try to enrich with FotMob data. The async lookup is bounded
      // by Promise.race + a 200ms timeout — slow cache misses fall
      // through to a non-enriched goalRadar.
      let fotmobData: import("@/lib/fotmob").FotMobMatchDetails | null = null;
      if (parsed.fotmobId && parsed.matchDate) {
        try {
          fotmobData = await Promise.race([
            getCachedMatchDetails(parsed.fotmobId, parsed.matchDate),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 200),
            ),
          ]);
        } catch {
          fotmobData = null;
        }
      }
      goalRadar = calculateGoalProbability(
        parsed.stats,
        parsed.minute,
        parsed.isLive,
        hist?.snapshots,
        parsed.homeGoals,
        parsed.awayGoals,
        parsed.home,
        parsed.away,
        undefined,
        undefined,
        fotmobData,
      );
      if (goalRadar.score < 55) goalRadar = undefined;

      // Auto-log predictions to PredictionLog for ML training pipeline
      if (goalRadar && parsed.isLive && goalRadar.score >= 40) {
        const homeElo = getRating(parsed.home)?.rating ?? null;
        const awayElo = getRating(parsed.away)?.rating ?? null;
        void db.predictionLog
          .create({
            data: {
              matchCode: parsed.code,
              minute: parseInt(parsed.minute) || 0,
              rawScore: goalRadar.score,
              homeScore: goalRadar.homeScore,
              awayScore: goalRadar.awayScore,
              calibratedP: goalRadar.calibratedP,
              side: goalRadar.side ?? "none",
              level: goalRadar.level,
              factorsJson: JSON.stringify(goalRadar.factors),
              homeTeam: parsed.home,
              awayTeam: parsed.away,
              league: parsed.league,
              homeElo: homeElo ? Math.round(homeElo) : null,
              awayElo: awayElo ? Math.round(awayElo) : null,
              modelVariant: "champion",
            },
          })
          .catch(() => {});
      }
    }
    matches.push({ ...parsed, goalRadar });
  }

  matches.sort((a, b) => {
    const l = a.league.localeCompare(b.league, "tr");
    return l !== 0 ? l : a.time.localeCompare(b.time);
  });

  const byLeague: Record<string, ParsedMatch[]> = {};
  const pressureData: Record<number, PressureSnapshot[]> = {};
  const goalRadarData: Record<number, GoalProbability> = {};

  for (const m of matches) {
    if (!byLeague[m.league]) byLeague[m.league] = [];
    byLeague[m.league].push(m);
    const hist = pressureHistory.get(m.code);
    if (hist?.snapshots.length) pressureData[m.code] = hist.snapshots;
    if (m.goalRadar) goalRadarData[m.code] = m.goalRadar;
  }

  // Auto-fetch missing Elo ratings in background (fire-and-forget)
  if (matches.length > 0) {
    const teamNames = matches.flatMap((m) => [m.home, m.away]).filter(Boolean);
    void autoFetchMissingRatings(teamNames).catch(() => {});
  }

  // Resolve FotMob logo URLs from TeamMapping for each team
  const teamLogos: Record<string, string> = {};
  const allTeamNames = matches.flatMap((m) => [
    m.home.toLowerCase().trim(),
    m.away.toLowerCase().trim(),
  ]);
  const uniqueNames = [...new Set(allTeamNames)];
  if (uniqueNames.length > 0) {
    try {
      // Batch lookup: match by nesineName (fuzzy) or canonicalName
      const mappings = await db.teamMapping.findMany({
        where: {
          OR: uniqueNames.map((n) => ({
            OR: [
              { canonicalName: { contains: n, mode: "insensitive" as const } },
              { nesineName: { contains: n, mode: "insensitive" as const } },
            ],
          })),
        },
        select: { canonicalName: true, fotmobLogoUrl: true, nesineName: true },
        take: 200,
      });
      for (const mapping of mappings) {
        if (mapping.fotmobLogoUrl) {
          // Store by lowercase for lookup
          const key = mapping.canonicalName.toLowerCase();
          teamLogos[key] = mapping.fotmobLogoUrl;
          if (mapping.nesineName) {
            teamLogos[mapping.nesineName.toLowerCase()] = mapping.fotmobLogoUrl;
          }
        }
      }
    } catch {
      // Silent — logos are cosmetic
    }
  }

  return NextResponse.json({
    matches,
    byLeague,
    version: data.v || 0,
    count: matches.length,
    pressureData,
    goalRadarData,
    teamLogos,
  });
}
