import { NextResponse } from "next/server";
import {
  fetchScoremerMatchListCached,
  fetchScoremerMatchStatsCached,
  buildScoremerMappingsCached,
  convertScoremerStatsToMatchStats,
  fetchTeamMatches,
  getTeamSlug,
  type ScoremerMatchStats,
  type ScoremerMatch,
} from "@/lib/scoremer";

export const dynamic = "force-dynamic";

// ── In-memory mapping cache ──
const globalForCache = globalThis as unknown as {
  scoremerMappingCache: {
    timestamp: number;
    mappings: Map<number, { scoremerId: string; scoremerUrl: string; confidence: number }>;
  } | undefined;
};
if (!globalForCache.scoremerMappingCache) {
  globalForCache.scoremerMappingCache = undefined;
}

// ── Helper: try to find Scoremer match via team page search ──
async function findMatchViaTeamPage(
  homeTeam: string,
  awayTeam: string
): Promise<{ scoremerId: string; confidence: number } | null> {
  // Try both home and away team names to find a slug
  for (const teamName of [homeTeam, awayTeam]) {
    const slug = await getTeamSlug(teamName);
    if (!slug) continue;

    try {
      const teamMatches = await fetchTeamMatches(slug);
      if (teamMatches.length === 0) continue;

      // Find a match that has the other team name
      const otherTeam = teamName === homeTeam ? awayTeam : homeTeam;
      const normalizeStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const otherNorm = normalizeStr(otherTeam);

      for (const tm of teamMatches) {
        // Check both home and away team names on the team page
        const tmHomeNorm = normalizeStr(tm.homeTeam);
        const tmAwayNorm = normalizeStr(tm.awayTeam);
        if (tmHomeNorm.includes(otherNorm) || otherNorm.includes(tmHomeNorm) ||
            tmAwayNorm.includes(otherNorm) || otherNorm.includes(tmAwayNorm)) {
          return { scoremerId: tm.id, confidence: 0.7 };
        }
      }
    } catch (err) {
      console.error(`[Scoremer] Team page search error for ${teamName}:`, err);
    }
  }
  return null;
}

// GET /api/scoremer?action=mapping|details|matches&...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "details";

  // ── Action: mapping — build Nesine→Scoremer mapping ──
  if (action === "mapping") {
    try {
      const matchesJson = searchParams.get("matches");
      if (!matchesJson) {
        return NextResponse.json(
          { error: "matches parameter required for mapping" },
          { status: 400 }
        );
      }

      const nesineMatches = JSON.parse(matchesJson);
      const mappings = await buildScoremerMappingsCached(nesineMatches);

      const mappingMap = new Map<number, { scoremerId: string; scoremerUrl: string; confidence: number }>();
      for (const m of mappings) {
        mappingMap.set(m.nesineCode, {
          scoremerId: m.scoremerId,
          scoremerUrl: m.scoremerUrl,
          confidence: m.confidence,
        });
      }
      globalForCache.scoremerMappingCache = {
        timestamp: Date.now(),
        mappings: mappingMap,
      };

      return NextResponse.json({
        mappings: mappings.map(m => ({
          nesineCode: m.nesineCode,
          scoremerId: m.scoremerId,
          scoremerUrl: m.scoremerUrl,
          confidence: m.confidence,
        })),
      });
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // ── Action: details — get match stats from Scoremer ──
  if (action === "details") {
    const matchCode = searchParams.get("matchCode");
    const scoremerId = searchParams.get("scoremerId");
    const homeParam = searchParams.get("home");
    const awayParam = searchParams.get("away");

    let sId: string | null = scoremerId;

    // Try to find from cache if no direct ID
    if (!sId && matchCode) {
      const code = parseInt(matchCode, 10);
      if (globalForCache.scoremerMappingCache) {
        const mapping = globalForCache.scoremerMappingCache.mappings.get(code);
        if (mapping) {
          sId = mapping.scoremerId;
        }
      }
    }

    // Auto-rebuild mapping if not found and team names provided
    if (!sId && matchCode && homeParam && awayParam) {
      try {
        console.log(`[Scoremer] Auto-mapping for match ${matchCode}: ${homeParam} vs ${awayParam}`);
        const timeParam = searchParams.get("time") || "00:00";
        const nesineMatch = [{
          code: parseInt(matchCode, 10),
          home: homeParam,
          away: awayParam,
          time: timeParam,
        }];

        // First try: build mapping from fixtures
        const mappings = await buildScoremerMappingsCached(nesineMatch);

        if (mappings.length > 0) {
          const found = mappings[0];
          sId = found.scoremerId;

          if (!globalForCache.scoremerMappingCache) {
            globalForCache.scoremerMappingCache = {
              timestamp: Date.now(),
              mappings: new Map(),
            };
          }
          globalForCache.scoremerMappingCache.mappings.set(found.nesineCode, {
            scoremerId: found.scoremerId,
            scoremerUrl: found.scoremerUrl,
            confidence: found.confidence,
          });
          console.log(`[Scoremer] Auto-mapping (fixtures) for ${matchCode}: ${sId} (confidence: ${found.confidence.toFixed(2)})`);
        }

        // Second try: search via team page
        if (!sId) {
          console.log(`[Scoremer] Fixtures mapping failed, trying team page for ${homeParam}`);
          const teamResult = await findMatchViaTeamPage(homeParam, awayParam);
          if (teamResult) {
            sId = teamResult.scoremerId;
            if (!globalForCache.scoremerMappingCache) {
              globalForCache.scoremerMappingCache = {
                timestamp: Date.now(),
                mappings: new Map(),
              };
            }
            globalForCache.scoremerMappingCache.mappings.set(parseInt(matchCode, 10), {
              scoremerId: teamResult.scoremerId,
              scoremerUrl: `/tr/match/${teamResult.scoremerId}`,
              confidence: teamResult.confidence,
            });
            console.log(`[Scoremer] Auto-mapping (team page) for ${matchCode}: ${sId}`);
          }
        }

        if (!sId) {
          console.warn(`[Scoremer] Auto-mapping failed for match ${matchCode}: no match found`);
        }
      } catch (err) {
        console.error(`[Scoremer] Auto-mapping error for match ${matchCode}:`, err);
      }
    }

    if (!sId) {
      return NextResponse.json({
        error: "No Scoremer mapping found",
        needsMapping: true,
      });
    }

    try {
      // Try to get inline stats from match list first (avoids extra HTTP request)
      // The match list may have raceDataPopup2 stats embedded
      const allMatches = await fetchScoremerMatchListCached();
      const matchWithInlineStats = allMatches.find(m => m.id === sId && m.stats !== null);

      let stats: ScoremerMatchStats | null = null;
      if (matchWithInlineStats?.stats) {
        // Use inline stats from the match list (faster, no extra request)
        stats = matchWithInlineStats.stats;
        console.log(`[Scoremer] Using inline stats for ${sId} (no extra fetch needed)`);
      } else {
        // Fallback: fetch from match_live page
        stats = await fetchScoremerMatchStatsCached(sId);
      }

      if (!stats) {
        return NextResponse.json(
          { error: "Scoremer stats not available (match may not have stats yet)" },
          { status: 404 }
        );
      }

      const convertedStats = convertScoremerStatsToMatchStats(stats);
      const htConvertedStats = convertScoremerStatsToMatchStats(stats, true);

      // Extract HT score from Scoremer match row if available
      let htScore: string | null = null;
      if (matchWithInlineStats && (matchWithInlineStats.htHomeScore > 0 || matchWithInlineStats.htAwayScore > 0)) {
        htScore = `${matchWithInlineStats.htHomeScore}:${matchWithInlineStats.htAwayScore}`;
      }

      return NextResponse.json({
        scoremerId: sId,
        stats: convertedStats,
        htStats: htConvertedStats,
        rawStats: stats,
        htScore,
      });
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // ── Action: matches — get all matches from Scoremer ──
  if (action === "matches") {
    try {
      const matches = await fetchScoremerMatchListCached();
      return NextResponse.json({
        count: matches.length,
        matches: matches.map(m => ({
          id: m.id,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          league: m.league,
          time: m.time,
          status: m.status,
          url: m.url,
        })),
      });
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
