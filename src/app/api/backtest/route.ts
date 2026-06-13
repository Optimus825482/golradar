import { NextResponse } from "next/server";
import {
  runBacktest,
  getQuickSummary,
  listBacktestResults,
  type BacktestConfig,
} from "@/lib/backtestEngine";
import { rateLimit, RATE_LIMIT_DEFAULTS } from "@/lib/rateLimit";
import { db as prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/backtest?action=run|summary|list&days=...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "summary";

  try {
    if (action === "run") {
      const config: BacktestConfig = {};
      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");
      const days = searchParams.get("days");

      if (startDate) config.startDate = startDate;
      if (endDate) config.endDate = endDate;
      if (days && !startDate) {
        const d = parseInt(days, 10);
        if (d > 0) {
          const start = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
          config.startDate = start.toISOString().slice(0, 10);
        }
      }

      const result = runBacktest(config);
      return NextResponse.json(result);
    }

    if (action === "summary") {
      const summary = getQuickSummary();
      return NextResponse.json(summary);
    }

    if (action === "list") {
      const files = listBacktestResults();
      return NextResponse.json({ files });
    }

    if (action === "runs") {
      const runs = await prisma.backtestRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          daysBack: true,
          maxMatches: true,
          totalMatches: true,
          signalsRecorded: true,
          goalsDetected: true,
          accuracy: true,
          avgTimeToGoal: true,
        },
      });
      return NextResponse.json({ runs });
    }

    return NextResponse.json({ error: "Unknown action. Use: run, summary, list" }, { status: 400 });
  } catch (error: any) {
    console.error("[Backtest API] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/backtest — Start a historical simulation
// Uses Nesine data + Goaloo momentum/odds enrichment when available
export async function POST(request: Request) {
  try {
    // Rate limit: max 5 POST backtest requests per minute per IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rl = rateLimit(`backtest:${ip}`, RATE_LIMIT_DEFAULTS.strict);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${Math.ceil(rl.resetMs / 1000)}s.` },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) } },
      );
    }

    const body = await request.json().catch(() => ({}));
    const action = body.action || "simulate";

    if (action === "simulate") {
      const daysBack = body.daysBack ? parseInt(body.daysBack, 10) : 3;
      const maxMatches = body.maxMatches ? parseInt(body.maxMatches, 10) : 30;
      const signalThreshold = body.signalThreshold ? parseInt(body.signalThreshold, 10) : 55;
      const useGoaloo = body.useGoaloo !== false; // Default: true

      console.log(`[Backtest API] Starting simulation: daysBack=${daysBack}, maxMatches=${maxMatches}, useGoaloo=${useGoaloo}`);

      // ── Step 1: Fetch finished matches from Nesine ──
      const { UNLIVE_API, HEADERS, parseMatch } = await import("@/lib/nesine");

      const datesToProcess: string[] = [];
      for (let d = 1; d <= daysBack; d++) {
        const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
        datesToProcess.push(date.toISOString().slice(0, 10));
      }

      const allParsed: any[] = [];
      for (const date of datesToProcess) {
        try {
          const resp = await fetch(`${UNLIVE_API}?sportType=1&date=${date}`, {
            headers: HEADERS,
            cache: "no-store",
            signal: AbortSignal.timeout(15000),
          });
          if (resp.ok) {
            const text = await resp.text();
            try {
              const data = JSON.parse(text);
              if (data?.sc === 200 && data.d) {
                for (const m of data.d) {
                  const status = m.S || 0;
                  if (status !== 5 && status !== 22 && status !== 24) continue;
                  allParsed.push(parseMatch(m));
                }
              }
            } catch { /* skip bad json */ }
          }
        } catch (err) {
          console.error(`[Backtest API] Nesine fetch failed for ${date}:`, err);
        }
      }

      const matchesToProcess = allParsed.slice(0, maxMatches);
      console.log(`[Backtest API] Found ${allParsed.length} matches, processing ${matchesToProcess.length}`);

      // ── Step 2: Build input for simulator ──
      const simMatches: any[] = [];

      // ── Step 2a: Optionally enrich with Goaloo data ──
      let goalooEnrichmentMap = new Map<number, any>();

      if (useGoaloo) {
        try {
          const {
            fetchGoalooMatchesRecent,
            fetchGoalooMomentum,
            fetchGoalooMatchEvents,
            fetchGoalooOdds,
            analyzeOddsMovement,
          } = await import("@/lib/goaloo");

          console.log(`[Backtest API] Fetching Goaloo data for enrichment...`);
          const goalooMatches = await fetchGoalooMatchesRecent(daysBack);
          const finishedGoaloo = goalooMatches.filter(m => m.state === -1 || m.state === 5);

          // Build a mapping from team names to Goaloo match IDs
          // Using Jaccard similarity for team name matching
          const goalooTeamMap = new Map<string, number>(); // "homeTeam|awayTeam" → goalooMatchId
          for (const gm of finishedGoaloo) {
            const key = `${gm.homeTeam.toLowerCase().trim()}|${gm.awayTeam.toLowerCase().trim()}`;
            goalooTeamMap.set(key, gm.id);
          }

          // Try to match Nesine matches to Goaloo matches
          let enrichedCount = 0;
          for (const m of matchesToProcess) {
            const homeLower = m.home.toLowerCase().trim();
            const awayLower = m.away.toLowerCase().trim();
            const exactKey = `${homeLower}|${awayLower}`;

            let goalooMatchId: number | null = goalooTeamMap.get(exactKey) || null;

            // If no exact match, try Jaccard similarity
            if (!goalooMatchId) {
              let bestSim = 0;
              let bestId: number | null = null;
              for (const [key, id] of goalooTeamMap) {
                const [gh, ga] = key.split('|');
                const simHome = jaccardSimilarity(homeLower, gh);
                const simAway = jaccardSimilarity(awayLower, ga);
                const sim = (simHome + simAway) / 2;
                if (sim > bestSim && sim > 0.5) {
                  bestSim = sim;
                  bestId = id;
                }
              }
              goalooMatchId = bestId;
            }

            if (goalooMatchId) {
              try {
                // Fetch momentum, events, and odds in parallel
                const [momentum, events, odds] = await Promise.all([
                  fetchGoalooMomentum(goalooMatchId).catch(() => null),
                  fetchGoalooMatchEvents(goalooMatchId).catch(() => []),
                  fetchGoalooOdds(goalooMatchId).catch(() => null),
                ]);

                const oddsMovement = odds ? analyzeOddsMovement(odds) : null;

                goalooEnrichmentMap.set(m.code, {
                  goalooMomentum: momentum,
                  goalooEvents: events,
                  goalooOddsMovement: oddsMovement && oddsMovement.significance !== 'none' ? oddsMovement : null,
                });

                enrichedCount++;
              } catch (err) {
                console.error(`[Backtest API] Goaloo enrichment failed for ${m.home} vs ${m.away}:`, err);
              }

              // Small delay between Goaloo requests
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }

          console.log(`[Backtest API] Enriched ${enrichedCount}/${matchesToProcess.length} matches with Goaloo data`);
        } catch (err) {
          console.error(`[Backtest API] Goaloo enrichment failed:`, err);
          // Continue without Goaloo data
        }
      }

      // ── Step 2b: Build simulation input ──
      for (const m of matchesToProcess) {
        const ftStats: Record<string, { home: number | null; away: number | null }> = {};
        const htStats: Record<string, { home: number | null; away: number | null }> = {};

        if (m.stats && typeof m.stats === 'object') {
          for (const [key, val] of Object.entries(m.stats)) {
            if (val && typeof val === 'object' && 'home' in val && 'away' in val) {
              ftStats[key] = val as { home: number | null; away: number | null };
            }
          }
        }

        const enrichment = goalooEnrichmentMap.get(m.code);

        simMatches.push({
          matchCode: m.code,
          homeTeam: m.home,
          awayTeam: m.away,
          league: m.league,
          time: m.time,
          homeScore: m.homeGoals,
          awayScore: m.awayGoals,
          htScore: m.firstHalfScore || "-",
          ftStats,
          htStats: Object.keys(htStats).length > 0 ? htStats : null,
          // Goaloo enrichment
          goalooMomentum: enrichment?.goalooMomentum || null,
          goalooEvents: enrichment?.goalooEvents || null,
          goalooOddsMovement: enrichment?.goalooOddsMovement || null,
        });
      }

      // ── Step 3: Run simulation ──
      console.log(`[Backtest API] Running simulation on ${simMatches.length} matches...`);

      const { runHistoricalSimulation } = await import("@/lib/backtestSimulator");

      const config = { daysBack, maxMatches, signalThreshold };

      const result = await runHistoricalSimulation(simMatches, config);

      // Save to DB
      try {
        const btResult = result.backtestResult;
        await prisma.backtestRun.create({
          data: {
            daysBack,
            maxMatches,
            totalMatches: simMatches.length,
            signalsRecorded: result.progress.signalsRecorded || 0,
            goalsDetected: result.progress.goalsDetected || 0,
            accuracy: btResult?.accuracy ?? null,
            avgTimeToGoal: btResult?.avgMinutesAfterSignal ?? null,
            resultJson: JSON.stringify(btResult || {}),
          },
        });
      } catch (dbErr) {
        // Non-critical — don't fail the response
      }

      return NextResponse.json({
        ok: true,
        message: "Simulation completed",
        progress: result.progress,
        matchCount: simMatches.length,
        matchesWithStats: result.progress.matchesWithStats,
        matchesWithGoalooMomentum: result.progress.matchesWithGoalooMomentum,
        matchesWithOddsMovement: result.progress.matchesWithOddsMovement,
        signalsRecorded: result.progress.signalsRecorded,
        goalsDetected: result.progress.goalsDetected,
        backtestAvailable: !!result.backtestResult,
        backtestResult: result.backtestResult,
      });
    }

    return NextResponse.json({ error: "Unknown POST action. Use: simulate" }, { status: 400 });
  } catch (error: any) {
    console.error("[Backtest API] POST Error:", error);
    return NextResponse.json({ error: error.message || "Backtest failed" }, { status: 500 });
  }
}

// ── Jaccard Similarity for team name matching ──
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(''));
  const setB = new Set(b.split(''));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
