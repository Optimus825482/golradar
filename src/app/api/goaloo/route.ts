import { NextResponse } from "next/server";
import { rateLimit, RATE_LIMIT_DEFAULTS } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// GET /api/goaloo?action=matches|momentum|events|odds|teamstats|oddsMovement|backtestMatches&date=...&matchId=...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "matches";

  // Rate limit all goaloo requests
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(`goaloo:${ip}`, RATE_LIMIT_DEFAULTS.relaxed);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate-limited', retryMs: rl.resetMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) } },
    );
  }

  try {
    const {
      fetchGoalooMatchesByDate,
      fetchGoalooMomentum,
      fetchGoalooMatchEvents,
      fetchGoalooOdds,
      fetchGoalooTeamStats,
      analyzeOddsMovement,
    } = await import("@/lib/goaloo");

    if (action === "matches") {
      const date = searchParams.get("date");
      if (!date) {
        return NextResponse.json({ error: "date parameter required (YYYY-MM-DD)" }, { status: 400 });
      }
      const matches = await fetchGoalooMatchesByDate(date);
      return NextResponse.json({ matches, count: matches.length });
    }

    if (action === "momentum") {
      const matchId = searchParams.get("matchId");
      if (!matchId) {
        return NextResponse.json({ error: "matchId parameter required" }, { status: 400 });
      }
      const momentum = await fetchGoalooMomentum(parseInt(matchId, 10));
      if (!momentum) {
        return NextResponse.json({ error: "Momentum data not available for this match" }, { status: 404 });
      }
      return NextResponse.json(momentum);
    }

    if (action === "events") {
      const matchId = searchParams.get("matchId");
      if (!matchId) {
        return NextResponse.json({ error: "matchId parameter required" }, { status: 400 });
      }
      const events = await fetchGoalooMatchEvents(parseInt(matchId, 10));
      return NextResponse.json({ events });
    }

    if (action === "odds") {
      const matchId = searchParams.get("matchId");
      if (!matchId) {
        return NextResponse.json({ error: "matchId parameter required" }, { status: 400 });
      }
      const odds = await fetchGoalooOdds(parseInt(matchId, 10));
      if (!odds) {
        return NextResponse.json({ error: "Odds data not available" }, { status: 404 });
      }
      return NextResponse.json(odds);
    }

    if (action === "oddsMovement") {
      const matchId = searchParams.get("matchId");
      if (!matchId) {
        return NextResponse.json({ error: "matchId parameter required" }, { status: 400 });
      }
      const odds = await fetchGoalooOdds(parseInt(matchId, 10));
      if (!odds) {
        return NextResponse.json({ error: "Odds data not available for this match" }, { status: 404 });
      }
      const movement = analyzeOddsMovement(odds);
      return NextResponse.json(movement);
    }

    if (action === "teamstats") {
      const matchId = searchParams.get("matchId");
      if (!matchId) {
        return NextResponse.json({ error: "matchId parameter required" }, { status: 400 });
      }
      const stats = await fetchGoalooTeamStats(parseInt(matchId, 10));
      if (!stats) {
        return NextResponse.json({ error: "Team stats not available" }, { status: 404 });
      }
      return NextResponse.json(stats);
    }

    if (action === "backtestMatches") {
      // Fetch Goaloo matches for multiple dates and enrich with momentum/events/odds
      // Used by the backtest simulation to get real data instead of synthetic
      const daysBack = Math.min(30, Math.max(1, parseInt(searchParams.get("daysBack") || "3", 10)));
      const maxMatches = Math.min(200, Math.max(1, parseInt(searchParams.get("maxMatches") || "20", 10)));
      const enrich = searchParams.get("enrich") === "true"; // Fetch momentum+events+odds for each match

      const { fetchGoalooMatchesRecent, enrichGoalooMatch } = await import("@/lib/goaloo");

      console.log(`[Goaloo API] Fetching backtest matches: daysBack=${daysBack}, maxMatches=${maxMatches}, enrich=${enrich}`);

      const matches = await fetchGoalooMatchesRecent(daysBack);
      // Finished matches: state -1 (from bf_us1.js) or state 5 (from SoccerAjax)
      const finishedMatches = matches.filter(m => m.state === -1 || m.state === 5).slice(0, maxMatches);

      if (!enrich) {
        return NextResponse.json({
          matches: finishedMatches,
          count: finishedMatches.length,
        });
      }

      // Enrich each match with momentum, events, and odds data
      const enrichedMatches: Array<{
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
        momentum: any;
        events: any[];
        odds: any;
      }> = [];
      for (let i = 0; i < finishedMatches.length; i++) {
        const match = finishedMatches[i];
        try {
          const enriched = await enrichGoalooMatch(match);
          enrichedMatches.push(enriched);
        } catch (err) {
          console.error(`[Goaloo API] Error enriching match ${match.id}:`, err);
          // Still include basic match data even if enrichment fails
          enrichedMatches.push({
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
            momentum: null,
            events: [],
            odds: null,
          });
        }

        // Small delay to avoid rate limiting
        if (i < finishedMatches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      return NextResponse.json({
        matches: enrichedMatches,
        count: enrichedMatches.length,
        withMomentum: enrichedMatches.filter(m => m.momentum).length,
        withOdds: enrichedMatches.filter(m => m.odds).length,
      });
    }

    if (action === "resolve") {
      // Resolve a Nesine match to a Goaloo match by fuzzy team name matching
      const home = searchParams.get("home");
      const away = searchParams.get("away");
      const date = searchParams.get("date"); // YYYY-MM-DD
      const time = searchParams.get("time") || undefined; // HH:MM

      if (!home || !away || !date) {
        return NextResponse.json({ error: "home, away, and date parameters required" }, { status: 400 });
      }

      const { findGoalooMatchForNesine } = await import("@/lib/goaloo");
      const mapping = await findGoalooMatchForNesine(home, away, date, time);

      if (!mapping) {
        return NextResponse.json({ found: false });
      }

      return NextResponse.json({ found: true, ...mapping });
    }

    return NextResponse.json({ error: "Unknown action. Use: matches, momentum, events, odds, oddsMovement, teamstats, backtestMatches, resolve" }, { status: 400 });
  } catch (error: any) {
    console.error("[Goaloo API] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
