import { NextResponse } from "next/server";
import { rateLimit, RATE_LIMIT_DEFAULTS } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/securityHelpers";
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
import { extractFeatures, featuresToArray, pushFeatureSample } from "@/lib/featureEngineering";
import { loadTeamLogos, getTeamLogo } from "@/lib/teamLogos";
import { loadXgbChampion } from "@/lib/ml/modelRouter";
import { predictXgb } from "@/lib/ml/xgbLoader";
import { predictEnsemble } from "@/lib/ensemble";
import { reportGoal, parseMinute } from "@/lib/goalSignalTracker";
import type { GoalooEnrichment } from "@/lib/goalRadar";
import {
  ensureMatch,
  addSnapshot,
  getHistory,
  getSnapshots,
  isHydrated,
  markHydrated,
  isHalftime,
  pruneStale,
} from "@/lib/pressureHistory";
import type { PressureSnapshot } from "@/lib/advancedAnalytics";
import { logError } from '@/lib/devLog';
import { getMatchesCache, setMatchesCache } from '@/lib/server/matchesCache';
import { publishMatchEvent } from '@/lib/server/matchEvents';

export const dynamic = "force-dynamic";

// Minimal raw match shape — Nesine returns ~20+ fields; parseMatch
// handles full mapping. Treat as opaque here.
type RawMatch = Record<string, unknown> & {
  S?: number;
  C?: number;
  WI?: unknown;
  [key: string]: unknown;
};

// ── Server-side gol çapraz-kanal: son görülen skor (Faz 3) ──────
// Her poll'da delta tespiti için modül-scope Map. updateVerificationBatch
// idempotent olduğundan Map temizliği gerekmez (no-op yapılır).
const lastSeenGoals = new Map<number, { home: number; away: number }>();

// ── Bounded prediction-write queue (OOM guard) ──────────────────
// Prevents unbounded promise accumulation when DB writes lag.
// Drops oldest pending write when queue exceeds max depth.
const PREDICTION_QUEUE_MAX = 50;
const predictionQueue: Array<() => Promise<void>> = [];
let predictionWritesInFlight = 0;
let isDraining = false;

async function drainPredictionQueue(): Promise<void> {
  if (isDraining) return;
  isDraining = true;
  try {
    while (predictionQueue.length > 0 && predictionWritesInFlight < 5) {
      const fn = predictionQueue.shift()!;
      predictionWritesInFlight++;
      try { await fn(); } catch { /* caught inside fn */ }
      finally { predictionWritesInFlight--; }
    }
  } finally {
    isDraining = false;
  }
}

function enqueuePredictionWrite(fn: () => Promise<void>): void {
  predictionQueue.push(fn);
  if (predictionQueue.length > PREDICTION_QUEUE_MAX) {
    predictionQueue.shift(); // drop oldest pending
  }
  // Fire-and-forget drain — await not needed, concurrency bounded by
  // the in-flight counter. Sequential execution within the drain loop
  // is fine because each write is independent (DB insert).
  void drainPredictionQueue();
}

const emptyResponse = () => NextResponse.json({
  matches: [], byLeague: {}, version: 0, count: 0, pressureData: {}, goalRadarData: {},
});

// ── DB hydration: load past snapshots when server (re)starts mid-match ─
async function hydrateFromDB(matchCode: number, history: { snapshots: PressureSnapshot[] }) {
  if (isHydrated(matchCode)) return;
  markHydrated(matchCode);
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
  if (isHalftime(match.status)) return;

  const history = ensureMatch(match.code, {
    homeTeam: match.home,
    awayTeam: match.away,
    league: match.league,
    country: match.country,
  });
  // ponytail: DB hydration fire-and-forget — blocking await inside the
  // per-match loop adds 3-5s sequential latency. The current snapshot
  // goes through regardless; historical backfill is best-effort.
  if (!isHydrated(match.code)) {
    markHydrated(match.code);
    void hydrateFromDB(match.code, history).catch((e) => {
      logError('route', 'hydrateFromDB bg error:', e);
    });
  }

  const pressure = calculatePressure(match.stats);
  const last = history.snapshots[history.snapshots.length - 1];
  const now = Date.now();
  if (last && now - last.timestamp < 3000) return;

  addSnapshot(
    match.code,
    match.minute,
    pressure.home,
    pressure.away,
    match.stats,
    match.homeGoals,
    match.awayGoals,
  );

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
}

export async function GET(request: Request) {
  // Rate limit — public endpoint koruması
  const ip = getClientIp(request);
  const rl = rateLimit(`matches:${ip}`, { windowMs: 60000, maxRequests: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", resetMs: rl.resetMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const version = searchParams.get("v") || "0";
  const isWriter = searchParams.get("writer") === "1";

  // ── Cache lookup (post-2026-07-01 refactor) ─────────────────────
  // The /api/cron/poll-matches writer refreshes this cache every 5s.
  // If the writer is up, 100% of public traffic serves from cache —
  // 0 external API calls, 0 DB queries for the match data. If the
  // writer is down, we fall through to a direct fetch on a single
  // in-flight request (no thundering-herd rebuild).
  const cacheKey = `matches:v=${version}`;
  const cached = getMatchesCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached.body, {
      headers: {
        "X-Cache": "HIT",
        "X-Cache-Source": cached.source,
        "X-Cache-Age-Ms": String(Date.now() - cached.writtenAt),
      },
    });
  }

  // Best-effort async hydration of the in-memory FotMob ID cache.
  // Failure is silent — route continues with non-enriched goalRadar.
  void hydrateFotMobIdCache().catch((e) => { logError('route', e); });

  let resp: Response;
  try {
    resp = await fetch(`${LIVESCORE_API}?sportType=1&v=${version}`, {
      headers: HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(isWriter ? 25_000 : 10_000),
    });
    // Retry once on non-ok (Nesine API bazen 502/503 döner).
    // Writer path skips retry — the cron retries in 5s anyway.
    if (!resp.ok && !isWriter) {
      await new Promise(r => setTimeout(r, 1000));
      resp = await fetch(`${LIVESCORE_API}?sportType=1&v=${version}`, {
        headers: HEADERS,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    }
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

    // WI-based filter removed — Nesine's WI field shape is unreliable
    // (null, {}, string, missing). All active matches pass through;
    // odds availability is exposed via UI badge, not by filtering.

    const parsed = parseMatch(m as Parameters<typeof parseMatch>[0]);
    updatePressureHistory(parsed);

    // Faz 3 — server-side gol çapraz-kanal: önceki poll'daki skorla delta varsa
    // reportGoal çağır. updateVerificationBatch idempotent (where: goalHappened:null),
    // ikinci raporlama no-op. İdempotency guard gereksiz.
    if (parsed.homeGoals != null && parsed.awayGoals != null) {
      const prev = lastSeenGoals.get(parsed.code);
      if (prev != null) {
        if (parsed.homeGoals > prev.home) {
          const goalMin = parseMinute(parsed.minute);
          void reportGoal(parsed.code, "home", goalMin).catch((e) => {
            logError("matches-route", "reportGoal home failed:", e);
          });
        } else if (parsed.awayGoals > prev.away) {
          const goalMin = parseMinute(parsed.minute);
          void reportGoal(parsed.code, "away", goalMin).catch((e) => {
            logError("matches-route", "reportGoal away failed:", e);
          });
        }
      }
      lastSeenGoals.set(parsed.code, { home: parsed.homeGoals, away: parsed.awayGoals });
    }

    const hist = getSnapshots(parsed.code);
    let goalRadar: GoalProbability | undefined;

	      // Writer path: skip expensive FotMob/Goaloo enrichment.
	      // goalRadar hesaplanacak ama enrichment null olacak.
	      let fotmobData: import("@/lib/fotmob").FotMobMatchDetails | null = null;
	      let goalooOddsBoost: { homeBoost: number; awayBoost: number; significance: string } | null = null;
	      let goalooData: GoalooEnrichment | null = null;
	      let closingOddsProxy: import('@/lib/goaloo').ClosingOddsProxy | null = null;

	      if (!isWriter) {
      	      // Try to enrich with FotMob data. The async lookup is bounded
      	      // by Promise.race + a 200ms timeout — slow cache misses fall
      	      // through to a non-enriched goalRadar.
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

      	      // Try to enrich with Goaloo data (odds + momentum).
      	      // Dinamik import — Python bridge (scraper.ts) serverless'te
      	      // crash vermesin diye lazy-loaded. Timeout 300ms.
      	      try {
      	        const goaloo = await import('@/lib/goaloo');
      	        const goalooMatch = await Promise.race([
      	          goaloo.findGoalooMatchForNesine(parsed.home, parsed.away, parsed.matchDate),
      	          new Promise<null>((resolve) => setTimeout(() => resolve(null), 300)),
      	        ]);
      	        if (goalooMatch) {
      	          const [odds, momentum] = await Promise.all([
      	            goaloo.fetchGoalooOdds(goalooMatch.goalooMatchId).catch(() => null),
      	            goaloo.fetchGoalooMomentum(goalooMatch.goalooMatchId).catch(() => null),
      	          ]);
      	          // E2: Closing line value proxy (Wilkens 2026)
      	          closingOddsProxy = await goaloo.fetchClosingOddsProxy(goalooMatch.goalooMatchId).catch(() => null);
      	          if (odds) {
      	            const movement = goaloo.analyzeOddsMovement(odds);
      	            if (movement.significance !== 'none') {
      	              goalooOddsBoost = {
      	                homeBoost: movement.homeBoost,
      	                awayBoost: movement.awayBoost,
      	                significance: movement.significance,
      	              };
      	            }
      	          }
      	          if (momentum && momentum.totalMinutes > 0) {
      	            const recentWindow = Math.min(5, momentum.totalMinutes);
      	            const startIdx = Math.max(0, momentum.homeIntensities.length - recentWindow);
      	            const recentHome = momentum.homeIntensities.slice(startIdx);
      	            const recentAway = momentum.awayIntensities.slice(startIdx);
      	            const homeAvg = recentHome.reduce((s, v) => s + v, 0) / recentHome.length;
      	            const awayAvg = recentAway.reduce((s, v) => s + v, 0) / recentAway.length;
      	            const midIdx = Math.floor(recentHome.length / 2);
      	            const homeFirst = recentHome.slice(0, midIdx).reduce((s, v) => s + v, 0) / Math.max(1, midIdx);
      	            const homeLast = recentHome.slice(midIdx).reduce((s, v) => s + v, 0) / Math.max(1, recentHome.length - midIdx);
      	            const awayFirst = recentAway.slice(0, midIdx).reduce((s, v) => s + v, 0) / Math.max(1, midIdx);
      	            const awayLast = recentAway.slice(midIdx).reduce((s, v) => s + v, 0) / Math.max(1, recentAway.length - midIdx);
      	            goalooData = {
      	              oddsMovement: goalooOddsBoost,
      	              momentumTrend: {
      	                homeAvg, awayAvg,
      	                homeDirection: homeLast > homeFirst + 5 ? 'rising' : homeLast < homeFirst - 5 ? 'falling' : 'stable',
      	                awayDirection: awayLast > awayFirst + 5 ? 'rising' : awayLast < awayFirst - 5 ? 'falling' : 'stable',
      	              },
      	            };
      	          } else if (goalooOddsBoost) {
      	            goalooData = { oddsMovement: goalooOddsBoost, momentumTrend: null };
      	          }
      	        }
      	      } catch {
      	        // Goaloo timeout veya hata — sessiz geç
	      }
	      }

	      goalRadar = calculateGoalProbability(
	        parsed.stats,
	        parsed.minute,
	        parsed.isLive,
	        hist.length > 0 ? hist : undefined,
	        parsed.homeGoals,
	        parsed.awayGoals,
	        parsed.home,
	        parsed.away,
	        goalooOddsBoost,   // ← artık undefined değil
	        parsed.leagueId,   // ← artık undefined değil!
	        fotmobData,
	        goalooData,        // ← YENİ
	      );
      // Log ALL predictions for ML pipeline (no minimum score filter).
      // Level is determined by goalRadar.level — let low/medium signals
      // accumulate so the calibration + backtest systems see the full
      // distribution.
      if (goalRadar && parsed.isLive) {
	        const homeElo = getRating(parsed.home)?.rating ?? null;
	        const awayElo = getRating(parsed.away)?.rating ?? null;
	        const matchMinute = parseInt(parsed.minute) || 0;
	        // ponytail: bounded async queue — drops oldest pending if over capacity.
	        // Prevents OOM from unbounded promise accumulation when DB writes lag.
	        enqueuePredictionWrite(async () => {
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
	              pressureHistory: hist.length > 0 ? hist.map((s: PressureSnapshot) => ({
	                homePressure: s.homePressure,
	                awayPressure: s.awayPressure,
	                stats: s.stats,
	                homeGoals: s.homeGoals,
	                awayGoals: s.awayGoals,
	              })) : undefined,
	              // E5: referee name from FotMob infobox → RefereeStats DB
	              // lookup. With a 5-min in-memory cache (refereeStats.ts)
	              // this is one query per unique active referee per 5 min,
	              // regardless of how many matches they officiate.
	              refereeName: fotmobData?.infoBox?.referee ?? null,
	              // E1: FotMob shotmap → shot geometry features (angle, distance, GK proxy)
	              shotmap: fotmobData?.shotmap ?? undefined,
	              fotmobHomeTeamId: fotmobData?.homeTeam?.id ?? null,
	              fotmobAwayTeamId: fotmobData?.awayTeam?.id ?? null,
	              // E2: Closing line value from Goaloo initial odds (Wilkens 2026)
	              closingOdds: closingOddsProxy ? {
	                over25: closingOddsProxy.over25Implied,
	                btts: closingOddsProxy.bttsYesImplied,
	                homeWin: closingOddsProxy.homeImplied,
	                draw: closingOddsProxy.drawImplied,
	                awayWin: closingOddsProxy.awayImplied,
	              } : undefined,
	              skipXtGrid: true,
	            });
	            const fa = featuresToArray(features);
	            featuresJson = JSON.stringify(fa);
	            // P1.4: feed drift monitor — async-safe, no backpressure impact
	            try { pushFeatureSample(features); } catch { /* best-effort */ }
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
	            // Faz A4 N-of-M: count how many models in the ensemble
	            // predict >0.5 for the current match. Tier determination
	            // in goalSignalTracker uses this count. predictEnsemble is
	            // best-effort — failure leaves the count at 0 (treated
	            // as "no tier" → 'radar' fallback for backward compat).
	            try {
	              const ensemble = await predictEnsemble({
	                stats: parsed.stats,
	                minute: String(matchMinute),
	                isLive: true,
	                homeGoals: parsed.homeGoals ?? 0,
	                awayGoals: parsed.awayGoals ?? 0,
	                homeTeam: parsed.home,
	                awayTeam: parsed.away,
	                // E1+E2: shot geometry + closing odds → ensemble ML inference
	                shotmap: fotmobData?.shotmap ?? undefined,
	                fotmobHomeTeamId: fotmobData?.homeTeam?.id ?? null,
	                fotmobAwayTeamId: fotmobData?.awayTeam?.id ?? null,
	                closingOdds: closingOddsProxy ? {
	                  over25: closingOddsProxy.over25Implied,
	                  btts: closingOddsProxy.bttsYesImplied,
	                  homeWin: closingOddsProxy.homeImplied,
	                  draw: closingOddsProxy.drawImplied,
	                  awayWin: closingOddsProxy.awayImplied,
	                } : undefined,
	                refereeName: fotmobData?.infoBox?.referee ?? null,
	              });
	              if (typeof ensemble.modelAgreementCount === 'number') {
	                goalRadar.modelAgreementCount = ensemble.modelAgreementCount;
	              }
	            } catch (e) { logError('route-ensemble', e); /* best-effort */ }
	          } catch {
	            // features not available — log without featuresJson
	          }
	          // P0.3: Unified calibration path — route through isotonic/sigmoid
	          // regardless of source. ML raw championP no longer bypasses calibration.
	          const finalCalibratedP =
	            championP != null
	              ? applyCalibration(championP)
	              : applyCalibration(goalRadar.score / 100);
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
	        });
	      }
    matches.push({ ...parsed, goalRadar });
  }

  // Sıralama: en yüksek dakika (en çok oynanan) üstte
  const parseMinuteForSort = (m: typeof matches[0]): number => {
    if (m.isFinished) return 91;
    if (m.minute === 'DA') return 45;
    if (m.minute === 'MS') return 91;
    const n = parseInt(m.minute.replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  };
  matches.sort((a, b) => {
    const ma = parseMinuteForSort(a);
    const mb = parseMinuteForSort(b);
    return mb - ma; // yüksek dakika üstte
  });

  const byLeague: Record<string, ParsedMatch[]> = {};
  const pressureData: Record<number, PressureSnapshot[]> = {};
  const goalRadarData: Record<number, GoalProbability> = {};

  for (const m of matches) {
    if (!byLeague[m.league]) byLeague[m.league] = [];
    byLeague[m.league].push(m);
    const snapshots = getSnapshots(m.code);
    if (snapshots.length > 0) pressureData[m.code] = snapshots;
    if (m.goalRadar) goalRadarData[m.code] = m.goalRadar;
  }

  // Auto-fetch missing Elo ratings in background (fire-and-forget)
  if (matches.length > 0) {
    const teamNames = matches.flatMap((m) => [m.home, m.away]).filter(Boolean);
    void autoFetchMissingRatings(teamNames).catch((e) => { logError('route', e); });
  }

  // Prune stale entries from in-memory pressure history (older than 1h)
  pruneStale(60 * 60 * 1000);

  // Resolve FotMob logo URLs from TeamMapping + CSV fallback
  const teamLogos: Record<string, string> = {};
  const allTeamNames = matches.flatMap((m) => [
    m.home.toLowerCase().trim(),
    m.away.toLowerCase().trim(),
  ]);
  const uniqueNames = [...new Set(allTeamNames)];
  if (uniqueNames.length > 0) {
    try {
      // Batch lookup from DB
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

      // DB'de logo bulunanları ekle
      for (const mapping of mappings) {
        if (mapping.fotmobLogoUrl) {
          const key = mapping.canonicalName.toLowerCase();
          teamLogos[key] = mapping.fotmobLogoUrl;
          if (mapping.nesineName) {
            teamLogos[mapping.nesineName.toLowerCase()] = mapping.fotmobLogoUrl;
          }
        }
      }

      // CSV fallback: DB'de bulunamayanlar için CSV'den dene
      await loadTeamLogos();
      for (const teamName of uniqueNames) {
        if (!teamLogos[teamName]) {
          const url = getTeamLogo(teamName);
          if (url) teamLogos[teamName] = url;
        }
      }
    } catch {
      // Silent — logos are cosmetic
    }
  }

  const body = {
    matches,
    byLeague,
    version: data.v || 0,
    count: matches.length,
    pressureData,
    goalRadarData,
    teamLogos,
  };

  // Cache the response so concurrent and subsequent requests
  // serve the same payload without re-running the external pipeline.
  // The cron writer will overwrite this within 5s; this "fallback"
  // write only fires when the writer is down.
  setMatchesCache(cacheKey, body, "fallback");
  // Publish a snapshot event so any SSE subscribers can pick it up.
  publishMatchEvent({ type: "snapshot", timestamp: Date.now(), data: body });

  return NextResponse.json(body, {
    headers: {
      "X-Cache": "MISS",
      "X-Cache-Source": "fallback",
    },
  });
}
