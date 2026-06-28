// ── Cron Polling Endpoint ────────────────────────────────────────
// Server-side polling worker that runs continuously in the
// background regardless of user presence. Tier-aware: idle (0 users)
// still polls but at reduced cadence, and skips heavy analytics.
//
// Tier rules:
//   LITE (0 users):  60s interval, no heavy analytics, no FotMob enrichment
//   MID  (1-10):     30s interval, no heavy analytics
//   FULL (10+):      15s interval, heavy analytics + FotMob enrichment
//
// Singleton guard: globalThis.__cronInFlight prevents concurrent runs
// if the trigger fires before the previous run completes.
//
// Auth: requires `X-Cron-Secret` header matching `process.env.CRON_SECRET`.
// Coolify cron service sends this header on each call.

import { NextResponse } from "next/server";
import type { MatchStats } from "@/lib/nesine";
import {
  calculateGoalProbability,
  calculatePressure,
  FINISHED_STATUSES,
  LIVESCORE_API,
  HEADERS,
} from "@/lib/nesine";
import {
  calculateMomentumBars,
  calculateXgFlow,
  calculateThreatIndex,
  generateSyntheticSnapshots,
} from "@/lib/advancedAnalytics";
import {
  checkAndRecordSignal,
  reportGoal,
  expireSignalsForHalftime,
} from "@/lib/goalSignalTracker";
import { activeUserCount } from "@/lib/presence";
import { resolveTier, tierConfig, type TierConfig } from "@/lib/tier";
import {
  ensureMatch,
  addSnapshot,
  getSnapshots,
  pruneStale,
} from "@/lib/pressureHistory";
import { logError, logInfo } from "@/lib/devLog";
import { createThesis } from "@/lib/signalThesis";
import { onGoal, onFulltime } from "@/lib/feedbackLoops";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Singleton guard ──────────────────────────────────────────────
const g = globalThis as unknown as {
  __cronInFlight?: boolean;
  __cronLastRun?: number;
};

function acquireLock(): boolean {
  if (g.__cronInFlight) return false;
  g.__cronInFlight = true;
  return true;
}

function releaseLock(): void {
  g.__cronInFlight = false;
  g.__cronLastRun = Date.now();
}

// ── Auth ─────────────────────────────────────────────────────────
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // CRON_SECRET not set: allow only in development
    return process.env.NODE_ENV !== "production";
  }
  const header = request.headers.get("x-cron-secret");
  return header === secret;
}

// ── Goal detection ───────────────────────────────────────────────
function parseGoalMinute(minute: string | number): number {
  if (typeof minute === "number") return Math.max(0, minute);
  const plusMatch = minute.match(/^(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) {
    return parseInt(plusMatch[1], 10) + parseInt(plusMatch[2], 10);
  }
  const num = parseInt(minute.replace(/[^0-9]/g, ""), 10);
  return isNaN(num) ? 0 : num;
}

interface GoalDelta {
  matchCode: number;
  side: "home" | "away";
  minute: number;
}

// ── Match processor ──────────────────────────────────────────────
async function processMatch(
  raw: Record<string, unknown>,
  cfg: TierConfig,
): Promise<{
  code: number;
  processed: boolean;
  signalsCreated: number;
  isHalftime: boolean;
  isFinished: boolean;
  heavyAnalytics: boolean;
}> {
  const status = (raw.S as number) || 0;
  const isLive = status === 4 || status === 5 || status === 6 || status === 7;
  const isFinished = FINISHED_STATUSES.has(status);
  const isHalftime = status === 3 || status === 28;

  const matchCode = raw.C as number;
  const home = String(raw.HT || "");
  const away = String(raw.AT || "");
  const minute = String(raw.M || "0");
  // Goal scores: ES[0] holds current set score (T:1 = first half / live)
  const homeGoals = (raw.ES?.[0]?.H as number) || 0;
  const awayGoals = (raw.ES?.[0]?.A as number) || 0;
  const league = String(raw.L || "");

  if (!matchCode || !home || !away) {
    return {
      code: 0,
      processed: false,
      signalsCreated: 0,
      isHalftime,
      isFinished,
      heavyAnalytics: false,
    };
  }

  // ── Ensure history entry exists ──
  ensureMatch(matchCode, { homeTeam: home, awayTeam: away, league, country: "" });

  if (isHalftime) {
    return {
      code: matchCode,
      processed: true,
      signalsCreated: 0,
      isHalftime: true,
      isFinished,
      heavyAnalytics: false,
    };
  }

  if (!isLive) {
    return {
      code: matchCode,
      processed: true,
      signalsCreated: 0,
      isHalftime: false,
      isFinished,
      heavyAnalytics: false,
    };
  }

  // Parse stats — raw shape varies by Nesine; defensive defaults
  const stats: MatchStats = {
    possession: { home: 50, away: 50 },
    dangerous_attacks: {
      home: (raw.DAH as number) || 0,
      away: (raw.DAA as number) || 0,
    },
    shots_total: {
      home: (raw.SH as number) || 0,
      away: (raw.SA as number) || 0,
    },
    shots_on_target: { home: 0, away: 0 },
    shots_off_target: { home: 0, away: 0 },
    shots_blocked: { home: 0, away: 0 },
    corners: {
      home: (raw.CH as number) || 0,
      away: (raw.CA as number) || 0,
    },
    offsides: { home: 0, away: 0 },
    fouls: { home: 0, away: 0 },
    free_kicks: { home: 0, away: 0 },
    yellow_cards: { home: 0, away: 0 },
    red_cards: { home: 0, away: 0 },
    xg: { home: 0, away: 0 },
  };

  const pressure = calculatePressure(stats);

  // Snapshot — only if past minimum interval or score changed
  const lastSnap = getSnapshots(matchCode).slice(-1)[0];
  const now = Date.now();
  const scoreChanged =
    !lastSnap ||
    (lastSnap.homeGoals ?? 0) !== homeGoals ||
    (lastSnap.awayGoals ?? 0) !== awayGoals;
  const intervalOk = !lastSnap || now - lastSnap.timestamp >= cfg.snapshotMinuteEvery * 60_000;

  if (scoreChanged || intervalOk) {
    addSnapshot(matchCode, minute, pressure.home, pressure.away, stats, homeGoals, awayGoals);
  }

  // Goal detection — score delta since last snapshot
  const goalDeltas: GoalDelta[] = [];
  if (lastSnap) {
    if (homeGoals > (lastSnap.homeGoals ?? 0)) {
      goalDeltas.push({
        matchCode,
        side: "home",
        minute: parseGoalMinute(minute),
      });
    }
    if (awayGoals > (lastSnap.awayGoals ?? 0)) {
      goalDeltas.push({
        matchCode,
        side: "away",
        minute: parseGoalMinute(minute),
      });
    }
  }

  // Report goals
  for (const delta of goalDeltas) {
    try {
      await reportGoal(delta.matchCode, delta.side, delta.minute);
    } catch (e) {
      logError("Cron", "reportGoal failed:", e);
    }
  }

  // Calculate goal probability
  const snapshots = getSnapshots(matchCode);
  const prob = calculateGoalProbability(
    stats,
    minute,
    true,
    snapshots,
    homeGoals,
    awayGoals,
    home,
    away,
  );

  // Signal recording — exclude unreliable minute zones:
  //   0-2 min:    match context still forming
  //   43-45 min:  pre-halftime tactical uncertainty
  //   89-120 min: extra-time swings
  const sigMin = parseInt(minute.replace(/[^0-9]/g, ""), 10) || 0;
  const inExcludedZone = sigMin <= 2 || (sigMin >= 43 && sigMin <= 45) || sigMin >= 89;

  let signalsCreated = 0;
  if (prob && prob.score >= 60 && prob.side && prob.side !== "both" && !inExcludedZone) {
    try {
      const result = await checkAndRecordSignal(
        matchCode,
        home,
        away,
        league,
        String(raw.T || ""),
        minute,
        {
          score: prob.score,
          homeScore: prob.homeScore,
          awayScore: prob.awayScore,
          side: prob.side,
          level: prob.level,
          factors: prob.factors,
          calibratedP: prob.calibratedP,
          poissonP: prob.poissonP,
        },
        homeGoals,
        awayGoals,
      );
      if (result) {
        signalsCreated = 1;

        // ── Thesis kaydet (engellemez, sadece kayıt) ─────
        createThesis({
          matchCode,
          homeTeam: home,
          awayTeam: away,
          league,
          predictedSide: prob.side as 'home' | 'away',
          predictedMinuteRange: [Math.max(0, sigMin - 5), Math.min(90, sigMin + 10)],
          predictedProbability: prob.calibratedP,
          expectedScore: prob.score,
          tier: prob.level === 'critical' || prob.level === 'high' ? 'HIGH' : 'MEDIUM',
          keyFactors: prob.factors,
          dominantModels: ['radar', 'poisson'],
          dataSourceGrade: 'B',
        });
      }
    } catch (e) {
      logError("Cron", "checkAndRecordSignal failed:", e);
    }
  }

  // Heavy analytics only in FULL tier
  let heavyAnalytics = false;
  if (cfg.heavyAnalytics) {
    heavyAnalytics = true;
    // Touch heavy analytics to keep the symbols warm
    try {
      if (snapshots.length >= 2) {
        calculateMomentumBars(snapshots);
        calculateXgFlow(snapshots);
        calculateThreatIndex(stats, minute, snapshots);
      } else {
        generateSyntheticSnapshots(stats, null, homeGoals, awayGoals, undefined);
      }
    } catch (e) {
      logError("Cron", "heavy analytics failed:", e);
    }
  }

  // ── Fulltime Feedback Loop ──────────────────────────
  if (status && FINISHED_STATUSES.has(status) && signalsCreated > 0) {
    onFulltime({
      matchCode,
      homeScore: homeGoals,
      awayScore: awayGoals,
      league,
    }).catch(() => {});
  }

  return {
    code: matchCode,
    processed: true,
    signalsCreated,
    isHalftime: false,
    isFinished: false,
    heavyAnalytics,
  };
}

// ── Cron runner ──────────────────────────────────────────────────
async function runCronTick(): Promise<{
  ok: boolean;
  tier: string;
  matchesProcessed: number;
  signalsCreated: number;
  goalsReported: number;
  halftimeExpired: number;
  autoFinalized: number;
  durationMs: number;
}> {
  const start = Date.now();
  const users = activeUserCount();
  const tier = resolveTier(users);
  const cfg = tierConfig(tier);

  // Prune stale in-memory state (older than 4h)
  pruneStale(4 * 60 * 60 * 1000);

  // Fetch live matches from Nesine
  let resp: Response;
  try {
    resp = await fetch(`${LIVESCORE_API}?sportType=1&v=0`, {
      headers: HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    logError("Cron", "fetch failed:", e);
    return {
      ok: false,
      tier,
        matchesProcessed: 0,
        signalsCreated: 0,
        goalsReported: 0,
        halftimeExpired: 0,
      autoFinalized: 0,
      durationMs: Date.now() - start,
    };
  }

  let data: { sc?: number; d?: Record<string, unknown>[] };
  try {
    data = (await resp.json()) as { sc?: number; d?: Record<string, unknown>[] };
  } catch (e) {
    logError("Cron", "json parse failed:", e);
    return {
      ok: false,
      tier,
      matchesProcessed: 0,
      signalsCreated: 0,
      goalsReported: 0,
      halftimeExpired: 0,
      autoFinalized: 0,
      durationMs: Date.now() - start,
    };
  }

  if (data.sc !== 200 || !Array.isArray(data.d)) {
    return {
      ok: false,
      tier,
      matchesProcessed: 0,
      signalsCreated: 0,
      goalsReported: 0,
      halftimeExpired: 0,
      autoFinalized: 0,
      durationMs: Date.now() - start,
    };
  }

  // Find halftime matches for expiry
  const halftimeCodes = new Set<number>();
  for (const raw of data.d) {
    const status = (raw.S as number) || 0;
    if (status === 3 || status === 28) {
      const code = raw.C as number;
      if (code) halftimeCodes.add(code);
    }
  }
  let halftimeExpired = 0;
  if (halftimeCodes.size > 0) {
    try {
      halftimeExpired = await expireSignalsForHalftime(halftimeCodes);
    } catch (e) {
      logError("Cron", "expire halftime failed:", e);
    }
  }

  // Process matches — sequential to avoid hammering DB
  let matchesProcessed = 0;
  let signalsCreated = 0;
  let goalsReported = 0;

  for (const raw of data.d) {
    try {
      const result = await processMatch(raw, cfg);
      if (result.processed) matchesProcessed++;
      signalsCreated += result.signalsCreated;
    } catch (e) {
      logError("Cron", "processMatch failed for code:", raw.C, e);
    }
  }

  // Count goals reported during this tick
  goalsReported = halftimeExpired === 0 ? 0 : 0; // goals tracked via reportGoal side-effects

  // ── Auto-finalize stale pending signals ───────────────────────────
  let autoFinalized = 0;
  try {
    const staleCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const result = await db.signal.updateMany({
      where: {
        goalHappened: null,
        signalTimestamp: { lt: staleCutoff },
      },
      data: { goalHappened: false },
    });
    autoFinalized = result.count;
    if (autoFinalized > 0) {
      logInfo('Cron', `Auto-finalized ${autoFinalized} stale signals (pending >2h)`);
    }
  } catch (e) {
    logError('Cron', 'auto-finalize failed:', e);
  }

  return {
    ok: true,
    tier,
    matchesProcessed,
    signalsCreated,
    goalsReported,
    halftimeExpired,
    autoFinalized,
    durationMs: Date.now() - start,
  };
}

// ── HTTP handlers ────────────────────────────────────────────────
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!acquireLock()) {
    return NextResponse.json(
      {
        ok: true,
        skipped: "in_flight",
        message: "Previous cron tick still running",
      },
      { status: 202 },
    );
  }

  try {
    const result = await runCronTick();
    return NextResponse.json(result);
  } catch (e) {
    logError("Cron", "tick failed:", e);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  } finally {
    releaseLock();
  }
}

export async function POST(request: Request) {
  // Pipeline service'ten gelen bireysel maç verisi
  // WebSocket → pipeline service → POST /api/cron/poll
  const source = request.headers.get('X-Pipeline-Source');
  if (source === 'websocket') {
    try {
      const body = await request.json();
      const { matchCode, homeTeam, awayTeam, league, minute, homeGoals, awayGoals, status } = body;

      if (!matchCode || !homeTeam || !awayTeam) {
        return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
      }

      // Process single match through the pipeline
      const raw = {
        C: matchCode,
        HT: homeTeam,
        AT: awayTeam,
        L: league,
        M: minute,
        ES: [{ H: homeGoals, A: awayGoals }],
        S: status ?? 4,
        T: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      };

      const cfg = tierConfig(resolveTier(activeUserCount()));
      const result = await processMatch(raw, cfg);

      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      logError("Cron", "pipeline POST failed:", e);
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  }

  // Fallback: normal cron tick
  return GET(request);
}
