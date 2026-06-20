// ── Daily Metrics Endpoint ────────────────────────────────────────
// Aggregates today's signal performance, total analyzed matches,
// and upcoming matches for the home page KPI strip.

import { NextResponse } from "next/server";
import {
  LIVESCORE_API,
  HEADERS,
  EXCLUDED_STATUSES,
  ACTIVE_STATUSES,
  FINISHED_STATUSES,
  parseMatch,
} from "@/lib/nesine";
import { calculateSignalStats } from "@/lib/goalSignalTracker";
import { logError } from "@/lib/devLog";

export const dynamic = "force-dynamic";

function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function GET() {
  try {
    const today = getLocalDateString();
    const now = Date.now();

    // 1. All-time stats (90 days for stability)
    const allTimeStats = await calculateSignalStats(90);
    const allTimeSuccessRate = allTimeStats.goalPrimary.successRate;
    const allTimeSignals = allTimeStats.totalSignals;
    const allTimeGoals = allTimeStats.signalsWithGoal;

    // 2. Today's stats from recentSignals
    const todayStats = await calculateSignalStats(1);
    const todaySignalsAll = todayStats.recentSignals.filter(
      (s) => s.date === today,
    );
    const todayTotal = todaySignalsAll.length;
    const todayGoals = todaySignalsAll.filter((s) => s.goalHappened === true).length;
    const todayFail = todaySignalsAll.filter((s) => s.goalHappened === false).length;
    const todayResolved = todayGoals + todayFail;
    const todaySuccessRate =
      todayResolved > 0 ? todayGoals / todayResolved : 0;
    const todayPending = todayTotal - todayResolved;

    // 3. Fetch live matches from Nesine for upcoming + analyzed counts
    let resp: Response;
    try {
      resp = await fetch(`${LIVESCORE_API}?sportType=1&v=0`, {
        headers: HEADERS,
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      return NextResponse.json({
        ok: false,
        today: {
          signalsTotal: todayTotal,
          goalsHit: todayGoals,
          fail: todayFail,
          pending: todayPending,
          successRate: todaySuccessRate,
          analyzedMatches: 0,
        },
        upcoming: { liveNow: 0, startsSoon: 0, total: 0 },
        allTime: {
          successRate: allTimeSuccessRate,
          totalSignals: allTimeSignals,
          totalGoals: allTimeGoals,
        },
        lastUpdated: now,
      });
    }

    if (!resp.ok) {
      return NextResponse.json({
        ok: false,
        today: {
          signalsTotal: todayTotal,
          goalsHit: todayGoals,
          fail: todayFail,
          pending: todayPending,
          successRate: todaySuccessRate,
          analyzedMatches: 0,
        },
        upcoming: { liveNow: 0, startsSoon: 0, total: 0 },
        allTime: {
          successRate: allTimeSuccessRate,
          totalSignals: allTimeSignals,
          totalGoals: allTimeGoals,
        },
        lastUpdated: now,
      });
    }

    const data = (await resp.json()) as {
      sc?: number;
      d?: Record<string, unknown>[];
    };

    let liveNow = 0;
    let startsSoon = 0;
    let analyzedToday = 0;
    let rawTotal = 0;

    if (data.sc === 200 && Array.isArray(data.d)) {
      for (const raw of data.d) {
        const status = (raw.S as number) || 0;
        if (EXCLUDED_STATUSES.has(status)) continue;
        if (!ACTIVE_STATUSES.has(status) && !FINISHED_STATUSES.has(status)) continue;
        rawTotal++;
        const parsed = parseMatch(raw as Parameters<typeof parseMatch>[0]);
        const matchDate = parsed.matchDate || "";

        // Live right now (status 2-7)
        if (status >= 2 && status <= 7) {
          liveNow++;
          // Count as analyzed today if match date is today
          if (matchDate === today) analyzedToday++;
        }

        // Starts soon: scheduled but not started, today or in next 4 hours
        if (status === 1 && matchDate === today) {
          startsSoon++;
        }
      }
    }

    // Build response with proper shape for KPI rendering
    return NextResponse.json({
      ok: true,
      today: {
        signalsTotal: todayTotal,
        goalsHit: todayGoals,
        fail: todayFail,
        pending: todayPending,
        successRate: todaySuccessRate,
        resolved: todayResolved,
        analyzedMatches: analyzedToday,
      },
      upcoming: {
        liveNow,
        startsSoon,
        total: liveNow + startsSoon,
      },
      allTime: {
        successRate: allTimeSuccessRate,
        totalSignals: allTimeSignals,
        totalGoals: allTimeGoals,
      },
      date: today,
      lastUpdated: now,
    });
  } catch (err: unknown) {
    logError("DailyMetrics API", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
