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
import { applyCalibration } from "@/lib/calibration";
import { extractFeatures, featuresToArray } from "@/lib/featureEngineering";
import { loadXgbChampion } from "@/lib/ml/modelRouter";
import { predictXgb } from "@/lib/ml/xgbLoader";
import { logError } from '@/lib/devLog';

export const dynamic = "force-dynamic";

// Minimal raw match shape — Nesine returns ~20+ fields; parseMatch
// handles full mapping. Treat as opaque here.
type RawMatch = Record<string, unknown> & {
  S?: number;
  C?: number;
  WI?: unknown;
  [key: string]: unknown;
};

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

// Cap history size to avoid unbounded growth across long sessions.
// Each match is bounded to 540 snapshots; the Map itself is bounded
// implicitly by the number of distinct matches live at once.
const HALFTIME_STATUSES = new Set([3, 28]);

const emptyResponse = () => NextResponse.json({
  matches: [], byLeague: {}, version: 0, count: 0, pressureData: {}, goalRadarData: {},
});

// ── DB hydration: load past snapshots when server (re)starts mid-match ─
const HYDRATED_MATCHES = new Set<number>();

async function hydrateFromDB(matchCode: number, history: MatchPressureHistory) {
  if (HYDRATED_MATCHES.has(matchCode)) return;
  HYDRATED_MATCHES.add(matchCode);
  try {
    const rows = await db.matchSnapshot.findMany({
      where: { matchCode },
      orderBy: { minute: "asc" },
      take: 540,
    });
    for (const row of rows) {
      let stats: MatchStats;
      try { stats = JSON.parse(row.statsJson as string) as MatchStats; } catch { continue; }
      history.snapshots.push({
        minute: `${row.minute}'`,
        timestamp: new Date(row.createdAt).getTime(),
        homePressure: row.homePressure,
        awayPressure: row.awayPressure,
        homeGoals: row.homeGoals,
        awayGoals: row.awayGoals,
        stats,
      });
    }
  } catch (e) { logError('route', e); /* DB unavailable — fall back to current-session only */ }
}

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
    // Hydrate from DB on first access — fills missing snapshots from before server start
    hydrateFromDB(match.code, history);
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

  // Persist to DB using upsert — same (matchCode, minute) can be polled multiple times
  const minuteNum = parseInt(match.minute.replace(/[^0-9]/g, ''), 10) || 0;
  void db.matchSnapshot.upsert({
    where: { matchCode_minute: { matchCode: match.code, minute: minuteNum } },
    create: {
      matchCode: match.code,
      minute: minuteNum,
      homePressure: pressure.home,
      awayPressure: pressure.away,
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      statsJson: JSON.stringify(match.stats),
    },
    update: {
      homePressure: pressure.home,
      awayPressure: pressure.away,
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      statsJson: JSON.stringify(match.stats),
    },
  }).catch((e) => { logError('route', 'matchSnapshot upsert error:', e); });

  if (history.snapshots.length > 540) {
    history.snapshots = history.snapshots.slice(-540);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const version = searchParams.get("v") || "0";

  // Best-effort async hydration of the in-memory FotMob ID cache.
  // Failure is silent — route continues with non-enriched goalRadar.
  void hydrateFotMobIdCache().catch((e) => { logError('route', e); });

  let resp: Response;
  try {
    resp = await fetch(`${LIVESCORE_API}?sportType=1&v=${version}`, {
      headers: HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return emptyResponse();
  }
  if (!resp.ok) return emptyResponse();

  const text = await resp.text();
  let data: { sc?: number; v?: number; d?: unknown[] } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    return emptyResponse();
  }
  if (!data || data.sc !== 200) return emptyResponse();

  const rawMatches: RawMatch[] = (data.d as RawMatch[]) || [];
  const matches: (ParsedMatch & { goalRadar?: GoalProbability })[] = [];

  for (const m of rawMatches) {
    const status = m.S || 0;
    if (EXCLUDED_STATUSES.has(status)) continue;
    if (!ACTIVE_STATUSES.has(status) && !FINISHED_STATUSES.has(status))
      continue;

    // Sadece Nesine'de canlı bahis oynanabilen maçları göster
    // WI (Win/Draw/Win odds) dolu olan maçlarda canlı bahis açıktır
    if (ACTIVE_STATUSES.has(status) && (m as { WI?: unknown }).WI == null) continue;

    const parsed = parseMatch(m as Parameters<typeof parseMatch>[0]);
    updatePressureHistory(parsed);

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
      // Log ALL predictions for ML pipeline (no minimum score filter).
      // Level is determined by goalRadar.level — let low/medium signals
      // accumulate so the calibration + backtest systems see the full
      // distribution.
      if (goalRadar && parsed.isLive) {
        const homeElo = getRating(parsed.home)?.rating ?? null;
        const awayElo = getRating(parsed.away)?.rating ?? null;
        const matchMinute = parseInt(parsed.minute) || 0;
        void (async () => {
          let featuresJson: string | null = null;
          let championP: number | null = null;
          try {
            const features = await extractFeatures({
              stats: parsed.stats,
              minute: parsed.minute,
              isLive: true,
              homeGoals: parsed.homeGoals,
              awayGoals: parsed.awayGoals,
              homeTeam: parsed.home,
              awayTeam: parsed.away,
              pressureHistory: hist?.snapshots?.map((s) => ({
                homePressure: s.homePressure,
                awayPressure: s.awayPressure,
                stats: s.stats,
                homeGoals: s.homeGoals,
                awayGoals: s.awayGoals,
              })),
              skipXtGrid: true,
            });
            const fa = featuresToArray(features);
            featuresJson = JSON.stringify(fa);
            // Run champion XGB/GBDT model on the same features for ensemble-calibratedP
            for (const championName of ["xgb", "gbdt"] as const) {
              try {
                const champ = await loadXgbChampion(championName);
                if (champ) {
                  championP = predictXgb(champ.model, fa);
                  break;
                }
              } catch (e) { logError('route', e); /* try next */ }
            }
          } catch {
            // features not available — log without them
          }
          // P0.3: Unified calibration path — route through isotonic/sigmoid
          // regardless of source. ML raw championP no longer bypasses calibration.
          const finalCalibratedP =
            championP != null
              ? applyCalibration(championP)
              : goalRadar.calibratedP;
          await db.predictionLog
            .create({
              data: {
                matchCode: parsed.code,
                minute: matchMinute,
                rawScore: goalRadar.score,
                homeScore: goalRadar.homeScore,
                awayScore: goalRadar.awayScore,
                calibratedP: finalCalibratedP,
                side: goalRadar.side ?? "none",
                level: goalRadar.level,
                factorsJson: JSON.stringify(goalRadar.factors),
                featuresJson,
                homeTeam: parsed.home,
                awayTeam: parsed.away,
                league: parsed.league,
                homeElo: homeElo ? Math.round(homeElo) : null,
                awayElo: awayElo ? Math.round(awayElo) : null,
                modelVariant: "champion",
              },
            })
            .catch((e) => { logError('route', e); });
        })();
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
    void autoFetchMissingRatings(teamNames).catch((e) => { logError('route', e); });
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
