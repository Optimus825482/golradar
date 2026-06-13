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
} from './signalRepository';

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
  // ── Match identification ──
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchTime: string;         // Match start time
  date: string;              // Date of the match

  // ── Signal details ──
  signalMinute: number;
  signalSide: 'home' | 'away';
  signalScore: number;         // Raw Goal Radar score (0–100)
  calibratedP: number;         // Calibrated probability (0–1)
  poissonP: number;            // Dixon-Coles Poisson probability
  signalLevel: 'low' | 'medium' | 'high' | 'critical';

  // Factors at signal time
  activeFactors: string[];
  homeScore: number;           // Home threat score component
  awayScore: number;           // Away threat score component

  // Match state at signal time
  currentHomeGoals: number;
  currentAwayGoals: number;

  // ── Signal metadata ──
  signalIndex: number;           // Nth signal for this match (1-based)
  isEscalation: boolean;
  previousSignalScore: number | null;
  signalTimestamp: number;       // Unix timestamp (ms) when signal was created

  // ── Goal verification (filled later by checkForGoals / expire) ──
  goalHappened: boolean | null;  // null=pending, true=goal happened, false=expired/no goal
  goalMinute: number | null;
  goalSide: 'home' | 'away' | null;
  correctPrediction: boolean | null;  // true if scoring side matched predicted side
  minutesAfterSignal: number | null;  // minutes waited for goal (capped at SIGNAL_EXPIRY_MINUTES)
  goalTimestamp: number | null;

  // ── Match result (filled by finalizeMatchSignals) ──
  finalHomeScore: number | null;
  finalAwayScore: number | null;
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
  signalCount: number;
  lastSignalScore: number | null;
  lastSignalSide: string | null;
  hasAnyGoalVerification: boolean;
  lastKnownHomeGoals: number;
  lastKnownAwayGoals: number;
}

const activeMatches = new Map<number, ActiveMatchState>();

// ── Constants ──────────────────────────────────────────────────

const SIGNAL_THRESHOLD = 60;
const ESCALATION_THRESHOLD = 10;   // Score increase to count as escalation
const SIGNAL_COOLDOWN_MINUTES = 3; // Min minutes between signals for same match+side
const MAX_SIGNALS_PER_MATCH = 10;
const SIGNAL_EXPIRY_MINUTES = 10;  // Max minutes to wait for goal before expiring
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
    side: 'home' | 'away' | 'both' | null;
    level: 'low' | 'medium' | 'high' | 'critical';
    factors: string[];
    calibratedP: number;
    poissonP: number;
  },
  currentHomeGoals: number,
  currentAwayGoals: number,
): Promise<GoalSignalRecord | null> {
  if (goalProbability.score < SIGNAL_THRESHOLD) return null;
  if (!goalProbability.side || goalProbability.side === 'both') return null;

  const now = Date.now();
  const minNum = parseInt(minute.replace(/[^0-9]/g, ''), 10) || 0;
  const today = getLocalDateString();
  const signalSide = goalProbability.side as 'home' | 'away';

  let state = activeMatches.get(matchCode);
  if (!state) {
    state = {
      signalCount: 0,
      lastSignalScore: null,
      lastSignalSide: null,
      hasAnyGoalVerification: false,
      lastKnownHomeGoals: currentHomeGoals,
      lastKnownAwayGoals: currentAwayGoals,
    };
    activeMatches.set(matchCode, state);
  }

  // Cooldown: same side within SIGNAL_COOLDOWN_MINUTES, no escalation → skip.
  if (state.lastSignalScore !== null && state.lastSignalSide === signalSide) {
    const lastRecord = await repoFindPendingForMatch(matchCode, signalSide);
    const lastUnverified = lastRecord
      .sort((a, b) => b.signalMinute - a.signalMinute)[0];
    if (lastUnverified && (minNum - lastUnverified.signalMinute) < SIGNAL_COOLDOWN_MINUTES) {
      if (goalProbability.score - state.lastSignalScore < ESCALATION_THRESHOLD) {
        return null;
      }
    }
  }

  if (state.signalCount >= MAX_SIGNALS_PER_MATCH) return null;

  const isEscalation = state.lastSignalScore !== null &&
    signalSide === state.lastSignalSide &&
    goalProbability.score - state.lastSignalScore >= ESCALATION_THRESHOLD;

  state.signalCount++;
  const signalIndex = state.signalCount;
  const previousScore = state.lastSignalScore;
  state.lastSignalScore = goalProbability.score;
  state.lastSignalSide = signalSide;

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
    homeScore: goalProbability.homeScore,
    awayScore: goalProbability.awayScore,

    currentHomeGoals,
    currentAwayGoals,

    signalIndex,
    isEscalation,
    previousSignalScore: previousScore,
    signalTimestamp: now,

    goalHappened: null,
    goalMinute: null,
    goalSide: null,
    correctPrediction: null,
    minutesAfterSignal: null,
    goalTimestamp: null,

    finalHomeScore: null,
    finalAwayScore: null,
  };

  const created = await repoCreate(record);
  return created;
}

/**
 * Called when a goal is detected during match polling. Handles both
 * same-minute double goals (home+away in same poll cycle).
 */
async function checkForGoals(
  matchCode: number,
  currentHomeGoals: number,
  currentAwayGoals: number,
  currentMinute: number,
  _today: string,
): Promise<void> {
  const state = activeMatches.get(matchCode);
  if (!state) return;

  // Determine which side(s) scored since last check.
  const homeScored = currentHomeGoals > state.lastKnownHomeGoals;
  const awayScored = currentAwayGoals > state.lastKnownAwayGoals;

  state.lastKnownHomeGoals = currentHomeGoals;
  state.lastKnownAwayGoals = currentAwayGoals;

  if (!homeScored && !awayScored) return;
  state.hasAnyGoalVerification = true;

  const scoredSides: Array<'home' | 'away'> = [];
  if (homeScored) scoredSides.push('home');
  if (awayScored) scoredSides.push('away');

  for (const goalSide of scoredSides) {
    const pending = await repoFindPendingForMatch(matchCode, goalSide);
    if (pending.length === 0) continue;

    // Most recent pending first.
    const matched = pending.sort((a, b) => b.signalMinute - a.signalMinute)[0]!;
    const id = await loadByKey(matchCode, matched.date, matched.signalIndex);
    if (!id) continue;
    await repoUpdateVerification(id, {
      goalHappened: true,
      goalMinute: currentMinute,
      goalSide,
      correctPrediction: matched.signalSide === goalSide,
      minutesAfterSignal: currentMinute - matched.signalMinute,
      goalTimestamp: Date.now(),
    });
  }

  // Opposite-side expiry: only for sides that did NOT score in this cycle.
  // Single-owner pattern — expireStaleSignals owns stale cleanup (#5).
  if (scoredSides.length === 1) {
    const scoringSide = scoredSides[0]!;
    const opposite: 'home' | 'away' = scoringSide === 'home' ? 'away' : 'home';
    const oppositePending = await repoFindPendingForMatch(matchCode, opposite);
    for (const s of oppositePending) {
      const anchored = await loadByKey(matchCode, s.date, s.signalIndex);
      if (!anchored) continue;
      await repoUpdateVerification(anchored, {
        goalHappened: false,
        goalSide: scoringSide,
        correctPrediction: false,
        minutesAfterSignal: SIGNAL_EXPIRY_MINUTES,
        goalTimestamp: null,
      });
    }
  }
}

/**
 * Look up the prisma row id by (matchCode, date, signalIndex) unique key.
 * Returns the row id (string) or null.
 */
async function loadByKey(
  matchCode: number,
  date: string,
  signalIndex: number,
): Promise<string | null> {
  // We don't have a direct repository helper for this; query via db.
  const { db } = await import('./db');
  const row = await db.signal.findUnique({
    where: { matchCode_date_signalIndex: { matchCode, date, signalIndex } },
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
    const id = await loadByKey(s.matchCode, s.date, s.signalIndex);
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
      const id = await loadByKey(matchCode, s.date, s.signalIndex);
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

  let stillPending = 0;
  for (const [, state] of activeMatches) {
    if (state.hasAnyGoalVerification) stillPending++;
  }

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
 * Called when match ends — finalize all remaining pending signals.
 */
export async function finalizeMatchSignals(
  matchCode: number,
  homeScore: number,
  awayScore: number,
): Promise<void> {
  const pending = await repoFindAllPending(matchCode);
  for (const s of pending) {
    const id = await loadByKey(matchCode, s.date, s.signalIndex);
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
    const id = await loadByKey(matchCode, s.date, s.signalIndex);
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
    // Expire all pending signals of this match before dropping state.
    const pending = await repoFindAllPending(code);
    for (const s of pending) {
      const id = await loadByKey(code, s.date, s.signalIndex);
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
