import { NextResponse } from "next/server";
import {
  fetchFotMobMatches,
  fetchMatchDetails,
  buildMatchMappings,
} from "@/lib/fotmob";

export const dynamic = "force-dynamic";

// ── In-memory mapping cache ──
const globalForCache = globalThis as unknown as {
  fotmobMappingCache: {
    timestamp: number;
    mappings: Map<number, number>; // nesineCode → fotmobId
  } | undefined;
};
if (!globalForCache.fotmobMappingCache) {
  globalForCache.fotmobMappingCache = undefined;
}

// GET /api/fotmob?matchCode=12345
// Returns FotMob match details for a given Nesine match code
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const matchCode = searchParams.get("matchCode");
  const action = searchParams.get("action") || "details";

  // Action: mapping - build Nesine→FotMob mapping for all live matches
  if (action === "mapping") {
    try {
      const matchesJson = searchParams.get("matches");
      if (!matchesJson) {
        return NextResponse.json(
          { error: "matches parameter required for mapping" },
          { status: 400 }
        );
      }

      let nesineMatches: any[];
      try {
        nesineMatches = JSON.parse(matchesJson);
        if (!Array.isArray(nesineMatches)) throw new Error('expected array');
      } catch {
        return NextResponse.json(
          { error: "Invalid matches JSON — expected a JSON array" },
          { status: 400 }
        );
      }
      const mappings = await buildMatchMappings(nesineMatches);

      const mappingMap = new Map<number, number>();
      for (const m of mappings) {
        mappingMap.set(m.nesineCode, m.fotmobId);
      }
      globalForCache.fotmobMappingCache = {
        timestamp: Date.now(),
        mappings: mappingMap,
      };

      return NextResponse.json({
        mappings: mappings.map((m) => ({
          nesineCode: m.nesineCode,
          fotmobId: m.fotmobId,
          confidence: m.confidence,
        })),
      });
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Action: details - get FotMob match details for a specific match
  if (action === "details") {
    if (!matchCode) {
      return NextResponse.json(
        { error: "matchCode parameter required" },
        { status: 400 }
      );
    }

    const code = parseInt(matchCode, 10);
    let fotmobId: number | null = null;

    if (globalForCache.fotmobMappingCache) {
      fotmobId = globalForCache.fotmobMappingCache.mappings.get(code) || null;
    }

    const directFotmobId = searchParams.get("fotmobId");
    if (directFotmobId) {
      fotmobId = parseInt(directFotmobId, 10);
    }

    // ── Auto-rebuild mapping if not found and team names provided ──
    const homeParam = searchParams.get("home");
    const awayParam = searchParams.get("away");
    const timeParam = searchParams.get("time");

    if (!fotmobId && homeParam && awayParam) {
      try {
        console.log(`[FotMob] Auto-rebuilding mapping for match ${matchCode}: ${homeParam} vs ${awayParam}`);
        const nesineMatch = [{
          code: code,
          home: homeParam,
          away: awayParam,
          time: timeParam || "00:00",
        }];
        const mappings = await buildMatchMappings(nesineMatch);

        if (mappings.length > 0) {
          fotmobId = mappings[0].fotmobId;

          // Merge into the global cache
          if (!globalForCache.fotmobMappingCache) {
            globalForCache.fotmobMappingCache = {
              timestamp: Date.now(),
              mappings: new Map(),
            };
          }
          globalForCache.fotmobMappingCache.mappings.set(code, fotmobId);
          console.log(`[FotMob] Auto-mapping success for ${matchCode}: fotmobId=${fotmobId} (confidence: ${mappings[0].confidence.toFixed(2)})`);
        } else {
          console.warn(`[FotMob] Auto-mapping failed for match ${matchCode}: no match found`);
        }
      } catch (err) {
        console.error(`[FotMob] Auto-mapping error for match ${matchCode}:`, err);
      }
    }

    if (!fotmobId) {
      return NextResponse.json({
        error: "No FotMob mapping found",
        needsMapping: true,
      });
    }

    try {
      const details = await fetchMatchDetails(fotmobId);
      if (!details) {
        return NextResponse.json(
          { error: "FotMob data not available" },
          { status: 404 }
        );
      }

      return NextResponse.json({ fotmobId, details });
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Action: search - search for a FotMob match by team names
  if (action === "search") {
    const home = searchParams.get("home");
    const away = searchParams.get("away");
    if (!home || !away) {
      return NextResponse.json(
        { error: "home and away parameters required" },
        { status: 400 }
      );
    }

    try {
      const fotmobMatches = await fetchFotMobMatches();
      const homeLower = home.toLowerCase();
      const awayLower = away.toLowerCase();
      
      const results = fotmobMatches
        .filter((m) => {
          const fmHome = m.home.name.toLowerCase();
          const fmAway = m.away.name.toLowerCase();
          return (
            fmHome.includes(homeLower) ||
            homeLower.includes(fmHome) ||
            fmAway.includes(awayLower) ||
            awayLower.includes(fmAway)
          );
        })
        .slice(0, 5);

      return NextResponse.json({ results });
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
