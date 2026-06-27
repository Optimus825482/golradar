import { NextResponse } from "next/server";
import {
  fetchNetScoresGames,
  fetchGameDetail,
  buildNetScoresMappings,
  convertNetScoresStatsToMatchStats,
  convertNetScoresEvents,
  fetchGameTimers,
} from "@/lib/netscores";

export const dynamic = "force-dynamic";

const log = process.env.NODE_ENV === 'development' ? console.log : () => {};
const warnN = process.env.NODE_ENV === 'development' ? console.warn : () => {};
const devError = process.env.NODE_ENV === 'development' ? console.error : () => {};

const globalForCache = globalThis as unknown as {
  netscoresMappingCache: {
    timestamp: number;
    mappings: Map<number, { netscoresId: number; netscoresUrl: string; confidence: number }>;
  } | undefined;
};
if (!globalForCache.netscoresMappingCache) {
  globalForCache.netscoresMappingCache = undefined;
}

// POST /api/netscores — mapping only (body = JSON { matches: [...] })
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const matches = body.matches;
    if (!Array.isArray(matches)) {
      return NextResponse.json({ error: "matches array required" }, { status: 400 });
    }
    const action = body.action || "mapping";

    if (action === "mapping") {
      const mappings = await buildNetScoresMappings(matches);
      const mappingMap = new Map<number, { netscoresId: number; netscoresUrl: string; confidence: number }>();
      for (const m of mappings) {
        mappingMap.set(m.nesineCode, {
          netscoresId: m.netscoresId,
          netscoresUrl: m.netscoresUrl,
          confidence: m.confidence,
        });
      }
      globalForCache.netscoresMappingCache = {
        timestamp: Date.now(),
        mappings: mappingMap,
      };
      return NextResponse.json({
        mappings: mappings.map(m => ({
          nesineCode: m.nesineCode,
          netscoresId: m.netscoresId,
          netscoresSlugId: m.netscoresSlugId,
          netscoresUrl: m.netscoresUrl,
          confidence: m.confidence,
        })),
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

// GET /api/netscores?action=details|timers|games&...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "details";

  // ── Action: details ──
  if (action === "details") {
    const matchCode = searchParams.get("matchCode");
    const directUrl = searchParams.get("url");
    const homeParam = searchParams.get("home");
    const awayParam = searchParams.get("away");
    const timeParam = searchParams.get("time");

    let netscoresUrl: string | null = directUrl;

    if (!netscoresUrl && matchCode) {
      const code = parseInt(matchCode, 10);
      if (globalForCache.netscoresMappingCache) {
        const mapping = globalForCache.netscoresMappingCache.mappings.get(code);
        if (mapping) netscoresUrl = mapping.netscoresUrl;
      }
    }

    if (!netscoresUrl && matchCode && homeParam && awayParam) {
      try {
        const nesineMatch = [{ code: parseInt(matchCode, 10), home: homeParam, away: awayParam, time: timeParam || "00:00" }];
        const mappings = await buildNetScoresMappings(nesineMatch);
        if (mappings.length > 0) {
          const found = mappings[0];
          netscoresUrl = found.netscoresUrl;
          if (!globalForCache.netscoresMappingCache) {
            globalForCache.netscoresMappingCache = { timestamp: Date.now(), mappings: new Map() };
          }
          globalForCache.netscoresMappingCache.mappings.set(found.nesineCode, {
            netscoresId: found.netscoresId,
            netscoresUrl: found.netscoresUrl,
            confidence: found.confidence,
          });
        }
      } catch (err) {
        devError(`[NetScores] Auto-mapping error:`, err);
      }
    }

    if (!netscoresUrl && homeParam && awayParam) {
      try {
        const nsGames = await fetchNetScoresGames();
        const normalize = (name: string) =>
          name.toLowerCase().replace(/[áàâä]/g,"a").replace(/[éèêë]/g,"e")
            .replace(/[íìîï]/g,"i").replace(/[óòôö]/g,"o")
            .replace(/[úùûü]/g,"u").replace(/[çč]/g,"c")
            .replace(/[š]/g,"s").replace(/[ž]/g,"z").replace(/[ñ]/g,"n")
            .replace(/[ğ]/g,"g").replace(/[ı]/g,"i").replace(/[ö]/g,"o")
            .replace(/[ü]/g,"u").replace(/[ş]/g,"s")
            .replace(/[^a-z0-9\s]/g,"").replace(/\s+/g," ").trim();
        const teamNameMap: Record<string,string> = {"türkiye":"turkey","almanya":"germany","ingiltere":"england","fransa":"france","ispanya":"spain","italya":"italy","brezilya":"brazil","arjantin":"argentina","portekiz":"portugal","hollanda":"netherlands","belçika":"belgium"};
        const translate = (name:string) => { const n=normalize(name); return teamNameMap[n]||n; };
        const nameSim = (a:string,b:string):number => {
          const na=translate(a), nb=normalize(b);
          if(na===nb) return 1; if(na.includes(nb)||nb.includes(na)) return .85;
          const wa=new Set(na.split(" ")), wb=new Set(nb.split(" "));
          const inter=new Set([...wa].filter(x=>wb.has(x)));
          return new Set([...wa,...wb]).size===0?0:inter.size/new Set([...wa,...wb]).size;
        };
        let bestMatch:{game:any;confidence:number}|null=null;
        for(const g of nsGames){
          const hns=[g.teams.home.name,...(g.teams.home.aliases_names||[])];
          const ans=[g.teams.away.name,...(g.teams.away.aliases_names||[])];
          let bs1=0,bs2=0,bs3=0,bs4=0;
          for(const h of hns) bs1=Math.max(bs1,nameSim(homeParam,h));
          for(const a of ans) bs2=Math.max(bs2,nameSim(awayParam,a));
          for(const a of ans) bs3=Math.max(bs3,nameSim(homeParam,a));
          for(const h of hns) bs4=Math.max(bs4,nameSim(awayParam,h));
          const conf=Math.max((bs1+bs2)/2,(bs3+bs4)/2);
          if(conf>.4&&(!bestMatch||conf>bestMatch.confidence)) bestMatch={game:g,confidence:conf};
        }
        if(bestMatch){
          netscoresUrl=bestMatch.game.url;
          if(matchCode){
            if(!globalForCache.netscoresMappingCache) globalForCache.netscoresMappingCache={timestamp:Date.now(),mappings:new Map()};
            globalForCache.netscoresMappingCache.mappings.set(parseInt(matchCode,10),{netscoresId:bestMatch.game.id,netscoresUrl:bestMatch.game.url,confidence:bestMatch.confidence});
          }
        }
      } catch(err){ devError(`[NetScores] Direct search error:`,err); }
    }

    if (!netscoresUrl) {
      return NextResponse.json({ error: "No NetScores mapping found", needsMapping: true });
    }

    try {
      const detail = await fetchGameDetail(netscoresUrl);
      if (!detail) return NextResponse.json({ error: "NetScores data not available" }, { status: 404 });

      // NetScores'dan gelen logoları logo map'ine ekle (CSV'de yoksa)
      import('@/lib/teamLogos').then(({ registerTeamLogos }) => {
        registerTeamLogos([
          { name: detail.teams.home?.name || '', logo: detail.teams.home?.logo || null },
          { name: detail.teams.away?.name || '', logo: detail.teams.away?.logo || null },
        ]);
      }).catch(() => {});

      const convertedStats = convertNetScoresStatsToMatchStats(detail.stats);
      const convertedEvents = convertNetScoresEvents(detail.events, detail.teams.home?.name || "Home", detail.teams.away?.name || "Away");

      const dedupedStats: Record<string,{home:number|null;away:number|null}> = {};
      for (const [key, val] of Object.entries(convertedStats)) {
        if (dedupedStats[key]) {
          const existingHasNull = dedupedStats[key].home == null || dedupedStats[key].away == null;
          const newHasNull = val.home == null || val.away == null;
          if (existingHasNull && !newHasNull) dedupedStats[key] = val;
        } else dedupedStats[key] = val;
      }

      let firstHalfScore = "";
      if (detail.score?.items) {
        const period1 = detail.score.items["1"] || detail.score.items[1];
        if (period1) firstHalfScore = `${period1.home||0}-${period1.away||0}`;
      }

      const fotmobCompatible = {
        matchId: detail.id,
        homeTeam: detail.teams.home ? { id: detail.teams.home.id, name: detail.teams.home.name, logo: detail.teams.home.logo, formation: null, starters: [], substitutes: [] } : null,
        awayTeam: detail.teams.away ? { id: detail.teams.away.id, name: detail.teams.away.name, logo: detail.teams.away.logo, formation: null, starters: [], substitutes: [] } : null,
        events: convertedEvents,
        stats: { "All": Object.entries(dedupedStats).map(([key,val])=>({title:key,key,stats:[val.home,val.away],type:"number"})).filter(g=>g.stats[0]!=null||g.stats[1]!=null) },
        weather: null, h2h: detail.h2h ? { summary: [0,0,0], matches: Object.values(detail.h2h) } : null,
        homeForm: [], awayForm: [], momentum: null, shotmap: null,
        infoBox: detail.stadium ? { stadium: { name: detail.stadium.name, city: detail.stadium.city, capacity: detail.stadium.capacity, surface: "" } } : null,
        _netscores: {
          id: detail.id, url: detail.url, timer: detail.timer, ht_at: detail.ht_at, game_length: detail.game_length,
          rawStats: detail.stats, rawEvents: detail.events,
          xg: detail.stats?.xg ? { home: detail.stats.xg.home, away: detail.stats.xg.away } : null,
          convertedStats: dedupedStats, leagueState: detail.league_state || null,
          situation: detail.situation || null, groups: detail.groups || null, firstHalfScore,
          missingPlayers: detail.missing_players || null,
        },
      };

      return NextResponse.json({ netscoresUrl, details: fotmobCompatible });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ── Action: timers ──
  if (action === "timers") {
    const idsParam = searchParams.get("ids");
    if (!idsParam) return NextResponse.json({ error: "ids parameter required" }, { status: 400 });
    try {
      const ids = idsParam.split(",").map(Number).filter(n => !isNaN(n));
      const timers = await fetchGameTimers(ids);
      return NextResponse.json({ timers });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ── Action: games ──
  if (action === "games") {
    try {
      const games = await fetchNetScoresGames();
      return NextResponse.json({
        count: games.length,
        games: games.map(g => ({
          id: g.id, slugId: g.slugId, url: g.url,
          home: g.teams.home.name, away: g.teams.away.name,
          homeLogo: g.teams.home.logo, awayLogo: g.teams.away.logo,
          status: g.status, score1: g.score.summary.score1, score2: g.score.summary.score2,
          minute: g.timer.current_minute, league: g.league.name, country: g.league.country?.code,
        })),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
