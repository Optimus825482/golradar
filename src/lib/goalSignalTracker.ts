// ── Goal Signal Tracker v2 (PostgreSQL-backed) ──────────────────
// Tracks ALL goal probability signals and records detailed info:
//   - Every signal above threshold (not just first one)
//   - Signal start minute, probability %, calibrated probability
//   - Whether a goal happened after signal
//   - If goal happened: how many minutes after, which team scored
//   - Whether the scoring team matched the predicted side
//   - All active factors at signal time
//   - Match state at signal time (current score, minute)
//   - Signal escalation tracking (probability progression)
//
// Persistence: PostgreSQL via signalRepository. Previously this module
// wrote per-day JSON files; those have been migrated (see
// scripts/import-signal-logs.ts). The in-memory activeMatches map
// remains for session-local cooldown / escalation state.

import {
  createSignal as repoCreate,
  findExisting as repoFindExisting,
  updateLastValues as repoUpdateLastValues,
  findByDate as repoFindByDate,
  findByMatch as repoFindByMatch,
  findRecentPending as repoFindPending,
  findPendingForMatch as repoFindPendingForMatch,
  findAllPendingForMatch as repoFindAllPending,
  findAllForMatch as repoFindAllForMatch,
  getAvailableDates as repoGetDates,
  calculateSignalStats as repoCalculateStats,
  updateVerification as repoUpdateVerification,
  updateFinalScore as repoUpdateFinalScore,
} from "./signalRepository";

// ── Server-only check ─────────────────────────────────────────
const isServer = typeof window === 'undefined' && typeof process !== 'undefined';

// ── Local date helper (FIX: use local TZ, not UTC) ────────────
const getLocalDateString = (d: Date = new Date()): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// ── Types ────────────────────────────────────────────────────────

export interface GoalSignalRecord {
  id?: string; // DB row id — populated by repository when reading from DB
  // ── Match identification ──
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchTime: string; // Match start time
  date: string; // Date of the match

  // ── First signal details (snapshot at first threshold crossing) ──
  signalMinute: number;
  signalSide: "home" | "away";
  signalScore: number; // Raw Goal Radar score (0–100) — first signal
  calibratedP: number; // Calibrated probability (0–1) — first signal
  poissonP: number; // Dixon-Coles Poisson probability — first signal
  signalLevel: "low" | "medium" | "high" | "critical";
  activeFactors: string[]; // Factors at first signal time

  // ── Latest poll values (updated on every poll while signal is active) ──
  lastScore: number | null; // Most recent score
  lastCalibratedP: number | null; // Most recent calibrated probability
  lastPoissonP: number | null; // Most recent Poisson probability
  lastFactors: string[]; // Most recent factors

  homeScore: number; // Home threat score component
  awayScore: number; // Away threat score component

  // Match state at signal time
  currentHomeGoals: number;
  currentAwayGoals: number;

  // ── Signal metadata ──
  signalTimestamp: number; // Unix timestamp (ms) when signal was first created
  lastSignalTimestamp: number | null; // Unix timestamp (ms) of last poll update

  // ── Goal verification (filled later by checkForGoals / expire) ──
  goalHappened: boolean | null; // null=pending, true=goal happened, false=expired/no goal
  goalMinute: number | null;
  goalSide: "home" | "away" | null;
  correctPrediction: boolean | null; // true if scoring side matched predicted side
  minutesAfterSignal: number | null; // minutes waited for goal (capped at SIGNAL_EXPIRY_MINUTES)
  goalTimestamp: number | null;

  // ── Match result (filled by finalizeMatchSignals) ──
  finalHomeScore: number | null;
  finalAwayScore: number | null;

  // ── Escalation (true when lastScore >= signalScore + 10) ──
  escalated: boolean;
}

export interface ProbabilityBucket {
  range: string;
  min: number;
  max: number;
  total: number;
  goals: number;
  correct: number;
  goalRate: number;
  accuracy: number;
}

export interface SignalAccuracyStats {
  totalSignals: number;
  signalsWithGoal: number;
  signalsWithoutGoal: number;
  signalsPending: number;
  correctPredictions: number;
  incorrectPredictions: number;
  accuracyRate: number;
  goalAfterSignalRate: number;
  falsePositiveRate: number;
  avgMinutesAfterSignal: number;
  medianMinutesAfterSignal: number;
  minMinutesAfterSignal: number | null;
  maxMinutesAfterSignal: number | null;
  buckets: ProbabilityBucket[];
  brierScore: number;
  avgPredictedP: number;
  avgObservedP: number;
  calibrationError: number;
  homeSideAccuracy: number;
  awaySideAccuracy: number;
  levelDistribution: Record<string, { total: number; goals: number; correct: number }>;
  escalationSignals: number;
  escalationGoalRate: number;
  recentSignals: GoalSignalRecord[];
  signalsByDay: Record<string, { total: number; goals: number; correct: number }>;
  signalsByMinuteRange: Record<string, { total: number; goals: number }>;
}

// ── Internal state (session-local only) ────────────────────────

interface ActiveMatchState {
  lastKnownHomeGoals: number;
  lastKnownAwayGoals: number;
}

const activeMatches = new Map<number, ActiveMatchState>();

// ── Constants ──────────────────────────────────────────────────

const SIGNAL_THRESHOLD = 60;
const SIGNAL_EXPIRY_MINUTES = 15;  // Max minutes to wait for goal before expiring
const EXPIRY_CHECK_INTERVAL_MS = 30000; // Check every 30s

// ── Core tracking functions ───────────────────────────────────

/**
 * Check if a goal probability reading should trigger a signal record.
 * Called every time goalProbability is calculated during live match polling.
 */
export async function checkAndRecordSignal(
  matchCode: number,
  homeTeam: string,
  awayTeam: string,
  league: string,
  matchTime: string,
  minute: string,
  goalProbability: {
    score: number;
    homeScore: number;
    awayScore: number;
    side: "home" | "away" | "both" | null;
    level: "low" | "medium" | "high" | "critical";
    factors: string[];
    calibratedP: number;
    poissonP: number;
  },
  currentHomeGoals: number,
  currentAwayGoals: number,
): Promise<GoalSignalRecord | null> {
  const now = Date.now();
  const minNum = parseInt(minute.replace(/[^0-9]/g, ""), 10) || 0;
  const today = getLocalDateString();

  // ── Always update state & check for goals FIRST ────────────────
  let state = activeMatches.get(matchCode);
  if (!state) {
    state = {
      lastKnownHomeGoals: currentHomeGoals,
      lastKnownAwayGoals: currentAwayGoals,
    };
    activeMatches.set(matchCode, state);
  }

  // Check if a goal was scored since last check — independent of signal threshold
  if (
    currentHomeGoals !== state.lastKnownHomeGoals ||
    currentAwayGoals !== state.lastKnownAwayGoals
  ) {
    await checkForGoals(
      matchCode,
      currentHomeGoals,
      currentAwayGoals,
      minNum,
      today,
    );
  }

  // ── Signal threshold checks ───────────────────────────────────
  if (goalProbability.score < SIGNAL_THRESHOLD) return null;
  if (!goalProbability.side || goalProbability.side === "both") return null;

  const signalSide = goalProbability.side as "home" | "away";

  // ── Upsert logic ──────────────────────────────────────────────
  // If this match+side+date already has a signal row, update only the
  // "last" fields. If it doesn't exist, create with first-signal values.
  const existing = await repoFindExisting(matchCode, today, signalSide);

  if (existing) {
    // Signal exists — only update "last" values (don't touch first-signal fields)
    const updated = await repoUpdateLastValues(existing.id!, {
      lastScore: goalProbability.score,
      lastCalibratedP: goalProbability.calibratedP,
      lastPoissonP: goalProbability.poissonP,
      lastFactors: goalProbability.factors,
      lastSignalTimestamp: now,
    });
    return updated;
  }

  // Brand new signal → create with first-signal values
  const record: GoalSignalRecord = {
    matchCode,
    homeTeam,
    awayTeam,
    league,
    matchTime,
    date: today,

    signalMinute: minNum,
    signalSide,
    signalScore: goalProbability.score,
    calibratedP: goalProbability.calibratedP,
    poissonP: goalProbability.poissonP,
    signalLevel: goalProbability.level,
    activeFactors: goalProbability.factors,

    lastScore: goalProbability.score,
    lastCalibratedP: goalProbability.calibratedP,
    lastPoissonP: goalProbability.poissonP,
    lastFactors: goalProbability.factors,

    homeScore: goalProbability.homeScore,
    awayScore: goalProbability.awayScore,
    currentHomeGoals,
    currentAwayGoals,

    signalTimestamp: now,
    lastSignalTimestamp: now,

    goalHappened: null,
    goalMinute: null,
    goalSide: null,
    correctPrediction: null,
    minutesAfterSignal: null,
    goalTimestamp: null,

    finalHomeScore: null,
    finalAwayScore: null,
    escalated: false,
  };

  const created = await repoCreate(record);
  return created;
}

/**
 * Called when a goal is detected during match polling. Handles both
 * same-minute double goals (home+away in same poll cycle).
 */
export async function checkForGoals(
  matchCode: number,
  currentHomeGoals: number,
  currentAwayGoals: number,
  currentMinute: number,
  today: string,
): Promise<void> {
  const state = activeMatches.get(matchCode);
  if (!state) return;

  // Determine which side(s) scored since last check.
  const homeScored = currentHomeGoals > state.lastKnownHomeGoals;
  const awayScored = currentAwayGoals > state.lastKnownAwayGoals;

  state.lastKnownHomeGoals = currentHomeGoals;
  state.lastKnownAwayGoals = currentAwayGoals;

  if (!homeScored && !awayScored) return;

  const scoredSides: Array<"home" | "away"> = [];
  if (homeScored) scoredSides.push("home");
  if (awayScored) scoredSides.push("away");

  // Get ALL pending signals for this match (both sides)
  const allPending = await repoFindAllPending(matchCode);

  for (const goalSide of scoredSides) {
    // Match: same-side pending signals get verified as correct
    const sameSidePending = allPending.filter((s) => s.signalSide === goalSide);
    for (const s of sameSidePending) {
      const id = s.id ?? (await loadById(matchCode, today, s.signalSide));
      if (!id) continue;
      await repoUpdateVerification(id, {
        goalHappened: true,
        goalMinute: currentMinute,
        goalSide,
        correctPrediction: s.signalSide === goalSide,
        minutesAfterSignal: currentMinute - s.signalMinute,
        goalTimestamp: Date.now(),
      });
    }

    // Opposite-side pending: goal DID happen, but wrong side predicted
    const oppositeSide = goalSide === "home" ? "away" : "home";
    const oppositePending = allPending.filter(
      (s) => s.signalSide === oppositeSide,
    );
    for (const s of oppositePending) {
      const id = s.id ?? (await loadById(matchCode, today, oppositeSide));
      if (!id) continue;
      await repoUpdateVerification(id, {
        goalHappened: false,
        goalMinute: currentMinute,
        goalSide,
        correctPrediction: false,
        minutesAfterSignal: currentMinute - s.signalMinute,
        goalTimestamp: Date.now(),
      });
    }
  }
}

/**
 * Look up the prisma row id by (matchCode, date, signalSide) unique key.
 */
async function loadById(
  matchCode: number,
  date: string,
  signalSide: string,
): Promise<string | null> {
  const { db } = await import("./db");
  const row = await db.signal.findUnique({
    where: { matchCode_date_signalSide: { matchCode, date, signalSide } },
    select: { id: true },
  });
  return row?.id ?? null;
}

// ── Signal expiry (10-minute timeout) ─────────────────────────

/**
 * Expire any pending signals that have been waiting longer than SIGNAL_EXPIRY_MINUTES.
 * Single owner of stale expiry.
 */
async function expireStaleSignals(): Promise<number> {
  const expiryMs = SIGNAL_EXPIRY_MINUTES * 60 * 1000;
  const stale = await repoFindPending(expiryMs);
  let expired = 0;
  for (const s of stale) {
    const id = s.id ?? (await loadById(s.matchCode, s.date, s.signalSide));
    if (!id) continue;
    await repoUpdateVerification(id, {
      goalHappened: false,
      minutesAfterSignal: SIGNAL_EXPIRY_MINUTES,
    });
    expired++;
  }
  return expired;
}

/**
 * Immediately expire all pending signals for matches that entered halftime.
 * Returns number of signals expired.
 */
export async function expireSignalsForHalftime(
  halftimeMatchCodes: Set<number>,
): Promise<number> {
  let expired = 0;
  for (const matchCode of halftimeMatchCodes) {
    const pending = await repoFindAllPending(matchCode);
    for (const s of pending) {
      const id = s.id ?? (await loadById(matchCode, s.date, s.signalSide));
      if (!id) continue;
      await repoUpdateVerification(id, {
        goalHappened: false,
        minutesAfterSignal: SIGNAL_EXPIRY_MINUTES,
      });
      expired++;
    }
  }
  return expired;
}

// ── Check pending signals on demand ──────────────────────────

/**
 * Check all pending signals and update their status.
 * Returns { total, expired, stillPending }.
 */
export async function checkPendingSignals(): Promise<{
  total: number;
  expired: number;
  stillPending: number;
}> {
  const expired = await expireStaleSignals();
  // stillPending = matches tracked in activeMatches (rough estimate)
  const stillPending = activeMatches.size;
  return { total: expired, expired, stillPending };
}

// ── Expiry checker interval ───────────────────────────────────

let expiryInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background expiry checker. Runs every EXPIRY_CHECK_INTERVAL_MS.
 * Safe to call multiple times — only one interval is created.
 */
export function startExpiryChecker(): void {
  if (expiryInterval) return;
  if (!isServer) return;
  expiryInterval = setInterval(async () => {
    try {
      const expired = await expireStaleSignals();
      if (expired > 0 && process.env.NODE_ENV === 'development') {
        console.log(`[SignalTracker] Expired ${expired} stale signal(s)`);
      }
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[SignalTracker] expireStaleSignals error:', err);
      }
    }
  }, EXPIRY_CHECK_INTERVAL_MS);
  if (process.env.NODE_ENV === 'development') {
    console.log('[SignalTracker] Expiry checker started (interval: 30s)');
  }
}

function stopExpiryChecker(): void {
  if (expiryInterval) {
    clearInterval(expiryInterval);
    expiryInterval = null;
  }
}

// ── Match finalization ────────────────────────────────────────

/**
 * Report a goal scored in a match. Called by the frontend when it
 * detects a goal (goal count changed between polls). This is the
 * independent gol-tespit kanali — API'de checkAndRecordSignal'dan
 * ayri, sadece skor degisikligine dayali calisir.
 */
export async function reportGoal(
  matchCode: number,
  goalSide: "home" | "away",
  goalMinute: number,
): Promise<void> {
  const today = getLocalDateString();

  // Get ALL pending signals (both sides), not just the scoring side
  const allPending = await repoFindAllPending(matchCode);
  const opposite: "home" | "away" = goalSide === "home" ? "away" : "home";

  for (const s of allPending) {
    const side = s.signalSide;
    const id = s.id ?? (await loadById(matchCode, today, side));
    if (!id) continue;

    if (side === goalSide) {
      // Same side: goal happened, correct prediction
      await repoUpdateVerification(id, {
        goalHappened: true,
        goalMinute,
        goalSide,
        correctPrediction: side === goalSide,
        minutesAfterSignal: goalMinute - s.signalMinute,
        goalTimestamp: Date.now(),
      });
    } else {
      // Opposite side: goal happened but wrong side predicted
      await repoUpdateVerification(id, {
        goalHappened: false,
        goalMinute,
        goalSide,
        correctPrediction: false,
        minutesAfterSignal: goalMinute - s.signalMinute,
        goalTimestamp: Date.now(),
      });
    }
  }
}

/**
 * Called when match ends — finalize all remaining pending signals.
 */
export async function finalizeMatchSignals(
  matchCode: number,
  homeScore: number,
  awayScore: number,
): Promise<void> {
  const pending = await repoFindAllPending(matchCode);
  for (const s of pending) {
    const id = s.id ?? (await loadById(matchCode, s.date, s.signalSide));
    if (!id) continue;
    await repoUpdateVerification(id, {
      goalHappened: false,
      minutesAfterSignal: SIGNAL_EXPIRY_MINUTES,
    });
    await repoUpdateFinalScore(id, homeScore, awayScore);
  }

  // Backfill final scores for already-resolved signals.
  const all = await repoFindAllForMatch(matchCode);
  for (const s of all) {
    if (s.finalHomeScore != null) continue;
    const id = s.id ?? (await loadById(matchCode, s.date, s.signalSide));
    if (!id) continue;
    await repoUpdateFinalScore(id, homeScore, awayScore);
  }

  activeMatches.delete(matchCode);
}

// ── Cleanup ───────────────────────────────────────────────────

/**
 * Remove stale matches from active tracking.
 */
export async function cleanupStaleSignals(
  activeMatchCodes: number[],
): Promise<void> {
  const activeSet = new Set(activeMatchCodes);
  for (const [code] of activeMatches) {
    if (activeSet.has(code)) continue;
    const pending = await repoFindAllPending(code);
    for (const s of pending) {
      const id = s.id ?? (await loadById(code, s.date, s.signalSide));
      if (!id) continue;
      await repoUpdateVerification(id, {
        goalHappened: false,
        minutesAfterSignal: SIGNAL_EXPIRY_MINUTES,
      });
    }
    activeMatches.delete(code);
  }
}

// ── Statistics ────────────────────────────────────────────────

/**
 * Calculate signal statistics for the last N days.
 */
export async function calculateSignalStats(
  days: number = 30,
): Promise<SignalAccuracyStats> {
  return repoCalculateStats(days);
}

// ── Data retrieval functions ──────────────────────────────────

export async function getSignalRecordsForDate(
  date: string,
): Promise<GoalSignalRecord[]> {
  return repoFindByDate(date);
}

export async function getSignalForMatch(
  matchCode: number,
): Promise<GoalSignalRecord[]> {
  return repoFindByMatch(matchCode, { days: 7 });
}

export async function getAvailableDates(): Promise<string[]> {
  return repoGetDates();
}
