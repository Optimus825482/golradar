import { NextResponse } from "next/server";
import {
  calculateSignalStats,
  getSignalRecordsForDate,
  getSignalForMatch,
  getAvailableDates,
  checkAndRecordSignal,
  finalizeMatchSignals,
  cleanupStaleSignals,
  expireSignalsForHalftime,
  checkPendingSignals,
  startExpiryChecker,
} from "@/lib/goalSignalTracker";

// Start background expiry checker for pending signals
startExpiryChecker();

export const dynamic = "force-dynamic";

// GET /api/goal-signals?action=stats|records|match|dates&date=...&matchCode=...&days=...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "stats";

  try {
    if (action === "stats") {
      const days = parseInt(searchParams.get("days") || "30", 10);
      const stats = calculateSignalStats(days);
      return NextResponse.json(stats);
    }

    if (action === "records") {
      const date = searchParams.get("date") || new Date().toISOString().slice(0, 10);
      const records = getSignalRecordsForDate(date);
      return NextResponse.json({ date, count: records.length, records });
    }

    if (action === "match") {
      const matchCode = parseInt(searchParams.get("matchCode") || "0", 10);
      if (!matchCode) {
        return NextResponse.json({ error: "matchCode required" }, { status: 400 });
      }
      const records = getSignalForMatch(matchCode);
      return NextResponse.json({ matchCode, count: records.length, records });
    }

    if (action === "dates") {
      const dates = getAvailableDates();
      return NextResponse.json({ dates });
    }

    if (action === "finalize") {
      const matchCode = parseInt(searchParams.get("matchCode") || "0", 10);
      const homeScore = parseInt(searchParams.get("homeScore") || "0", 10);
      const awayScore = parseInt(searchParams.get("awayScore") || "0", 10);
      if (!matchCode) {
        return NextResponse.json({ error: "matchCode required" }, { status: 400 });
      }
      finalizeMatchSignals(matchCode, homeScore, awayScore);
      return NextResponse.json({ ok: true, matchCode });
    }

    return NextResponse.json({ error: "Unknown action. Use: stats, records, match, dates, finalize" }, { status: 400 });
  } catch (error: any) {
    console.error("[GoalSignals API] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/goal-signals — Record a new signal, expire halftime signals, or cleanup
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Expire signals for matches that entered halftime
    if (body.action === 'expireHalftime') {
      const matchCodes: number[] = body.matchCodes || [];
      const expired = expireSignalsForHalftime(new Set(matchCodes));
      return NextResponse.json({ ok: true, expired });
    }

    // Cleanup stale signal tracking state
    if (body.action === 'cleanup') {
      const activeCodes: number[] = body.activeCodes || [];
      cleanupStaleSignals(activeCodes);
      return NextResponse.json({ ok: true });
    }

    // Manual check — expire stale + update pending
    if (body.action === 'checkPending') {
      const result = checkPendingSignals();
      return NextResponse.json({ ok: true, ...result });
    }

    const {
      matchCode,
      homeTeam,
      awayTeam,
      league,
      matchTime,
      minute,
      score,
      side,
      homeGoals,
      awayGoals,
      // Enhanced fields
      homeScore,
      awayScore,
      level,
      factors,
      calibratedP,
      poissonP,
    } = body;

    if (!matchCode || !side || !score) {
      return NextResponse.json({ error: "matchCode, side, score required" }, { status: 400 });
    }

    const result = checkAndRecordSignal(
      parseInt(matchCode, 10),
      homeTeam || '?',
      awayTeam || '?',
      league || '?',
      matchTime || '',
      minute || '0',
      {
        score: parseInt(score, 10),
        homeScore: parseInt(homeScore, 10) || 0,
        awayScore: parseInt(awayScore, 10) || 0,
        side: side as 'home' | 'away',
        level: level || 'medium',
        factors: Array.isArray(factors) ? factors : [],
        calibratedP: parseFloat(calibratedP) || 0,
        poissonP: parseFloat(poissonP) || 0,
      },
      parseInt(homeGoals, 10) || 0,
      parseInt(awayGoals, 10) || 0,
    );

    if (result) {
      return NextResponse.json({ ok: true, signal: result });
    }

    return NextResponse.json({ ok: false, message: "Signal below threshold or cooldown" });
  } catch (error: any) {
    console.error("[GoalSignals API] POST Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
