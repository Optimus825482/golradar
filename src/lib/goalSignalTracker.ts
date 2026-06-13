// ── Goal Signal Tracker v2 (Enhanced) ──────────────────────────────
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
// Data persisted to /home/z/my-project/data/signal-logs/
// Separately from the backtest module.

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

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

// ── Internal state──────────────────────────────────────────────

interface ActiveMatchState {
  signalCount: number;
  lastSignalScore: number | null;
  lastSignalSide: string | null;
  hasAnyGoalVerification: boolean;
  lastKnownHomeGoals: number;
  lastKnownAwayGoals: number;
  unverifiedSignals: GoalSignalRecord[];
}

const activeMatches = new Map<number, ActiveMatchState>();

// ── Constants ──────────────────────────────────────────────────

const SIGNAL_THRESHOLD = 60;
const ESCALATION_THRESHOLD = 10;   // Score increase to count as escalation
const SIGNAL_COOLDOWN_MINUTES = 3; // Min minutes between signals for same match+side
const MAX_SIGNALS_PER_MATCH = 10;
const SIGNAL_EXPIRY_MINUTES = 10;  // Max minutes to wait for goal before expiring
const EXPIRY_CHECK_INTERVAL_MS = 30000; // Check every 30s

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data', 'signal-logs');

// ── Data directory ─────────────────────────────────────────────

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function getDayFilePath(date: string): string {
  return join(DATA_DIR, `signals-${date}.json`);
}

// ── Load / Save ────────────────────────────────────────────────

function loadDaySignals(date: string): GoalSignalRecord[] {
  const filePath = getDayFilePath(date);
  if (!existsSync(filePath)) return [];
  try {
    const data = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    // Handle legacy: file was saved as a single object instead of array
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && parsed.matchCode) return [parsed];
    return [];
  } catch {
    return [];
  }
}

function saveDaySignals(date: string, signals: GoalSignalRecord[]) {
  ensureDataDir();
  const filePath = getDayFilePath(date);
  writeFileSync(filePath, JSON.stringify(signals, null, 2), 'utf-8');
}

function updateDaySignal(date: string, matchCode: number, updater: (record: GoalSignalRecord) => boolean): boolean {
  const signals = loadDaySignals(date);
  let changed = false;
  for (let i = 0; i < signals.length; i++) {
    if (signals[i].matchCode === matchCode) {
      if (updater(signals[i])) {
        changed = true;
      }
    }
  }
  if (changed) saveDaySignals(date, signals);
  return changed;
}

function updatePendingSignal(
  matchCode: number,
  side: string | null,
  updater: (record: GoalSignalRecord) => boolean
): boolean {
  const today = getLocalDateString();
  let changed = updateDaySignal(today, matchCode, (r) => {
    if (r.goalHappened !== null) return false; // only update pending
    if (side !== null && r.signalSide !== side) return false; // only matching side
    return updater(r);
  });
  // Also check yesterday's signals (matches at midnight)
  const yesterday = getLocalDateString(new Date(Date.now() - 86400000));
  const changedYesterday = updateDaySignal(yesterday, matchCode, (r) => {
    if (r.goalHappened !== null) return false;
    if (side !== null && r.signalSide !== side) return false;
    return updater(r);
  });
  return changed || changedYesterday;
}

// ── Core tracking functions ───────────────────────────────────

/**
 * Check if a goal probability reading should trigger a signal record.
 * Called every time goalProbability is calculated during live match polling.
 */
export function checkAndRecordSignal(
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
): GoalSignalRecord | null {
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
      unverifiedSignals: [],
    };
    activeMatches.set(matchCode, state);
  }

  // Check cooldown
  if (state.lastSignalScore !== null && state.lastSignalSide === signalSide) {
    const lastUnverified = [...state.unverifiedSignals].reverse().find(
      s => s.signalSide === signalSide && !s.goalVerified
    );
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

  // Persist
  const daySignals = loadDaySignals(today);
  daySignals.push(record);
  saveDaySignals(today, daySignals);

  state.unverifiedSignals.push(record);

  return record;
}

/**
 * Called when a goal is detected during match polling.
 */
function checkForGoals(
  matchCode: number,
  currentHomeGoals: number,
  currentAwayGoals: number,
  currentMinute: number,
  today: string,
): void {
  const state = activeMatches.get(matchCode);
  if (!state) return;

  // Determine which side scored (if any)
  const homeScored = currentHomeGoals > state.lastKnownHomeGoals;
  const awayScored = currentAwayGoals > state.lastKnownAwayGoals;
  const goalSide = homeScored ? 'home' : awayScored ? 'away' : null;
  if (!goalSide) return;

  // Update state for next check
  state.lastKnownHomeGoals = currentHomeGoals;
  state.lastKnownAwayGoals = currentAwayGoals;
  state.hasAnyGoalVerification = true;

  // Mark the most recent pending signal for the correct side
  const pendingForSide = state.unverifiedSignals
    .filter(s => s.signalSide === goalSide && s.goalHappened === null)
    .sort((a, b) => b.signalMinute - a.signalMinute); // most recent first

  if (pendingForSide.length === 0) return;

  const matched = pendingForSide[0];
  matched.goalHappened = true;
  matched.goalMinute = currentMinute;
  matched.goalSide = goalSide;
  matched.correctPrediction = matched.signalSide === goalSide;
  matched.minutesAfterSignal = currentMinute - matched.signalMinute;
  matched.goalTimestamp = Date.now();

  // Persist
  updatePendingSignal(matchCode, goalSide, (r) => {
    if (r.signalIndex === matched.signalIndex) {
      Object.assign(r, {
        goalHappened: true,
        goalMinute: currentMinute,
        goalSide,
        correctPrediction: r.signalSide === goalSide,
        minutesAfterSignal: currentMinute - r.signalMinute,
        goalTimestamp: Date.now(),
      });
      return true;
    }
    return false;
  });

  // Also expire other pending signals for the opposite side
  const opposite = goalSide === 'home' ? 'away' : 'home';
  state.unverifiedSignals
    .filter(s => s.signalSide === opposite && s.goalHappened === null)
    .forEach(s => {
      s.goalHappened = false;
      s.goalSide = goalSide;
      s.correctPrediction = false;
      s.minutesAfterSignal = SIGNAL_EXPIRY_MINUTES;
      updatePendingSignal(matchCode, opposite, (r) => {
        if (r.signalIndex === s.signalIndex) {
          Object.assign(r, {
            goalHappened: false,
            goalSide,
            correctPrediction: false,
            minutesAfterSignal: SIGNAL_EXPIRY_MINUTES,
          });
          return true;
        }
        return false;
      });
    });
}

// ── Signal expiry (10-minute timeout) ─────────────────────────

/**
 * Expire any pending signals that have been waiting longer than SIGNAL_EXPIRY_MINUTES.
 * Called by the internal expiry interval.
 */
function expireStaleSignals(): number {
  const now = Date.now();
  const expiryMs = SIGNAL_EXPIRY_MINUTES * 60 * 1000;
  let expired = 0;

  for (const [matchCode, state] of activeMatches.entries()) {
    for (const signal of state.unverifiedSignals) {
      if (signal.goalHappened !== null) continue;
      if (now - signal.signalTimestamp >= expiryMs) {
        signal.goalHappened = false;
        signal.minutesAfterSignal = SIGNAL_EXPIRY_MINUTES;
        // Persist
        updatePendingSignal(matchCode, null, (r) => {
          if (r.signalIndex === signal.signalIndex && r.goalHappened === null) {
            r.goalHappened = false;
            r.minutesAfterSignal = SIGNAL_EXPIRY_MINUTES;
            return true;
          }
          return false;
        });
        expired++;
      }
    }
  }
  return expired;
}

/**
 * Immediately expire all pending signals for matches that entered halftime.
 * Returns number of signals expired.
 */
export function expireSignalsForHalftime(halftimeMatchCodes: Set<number>): number {
  let expired = 0;
  for (const matchCode of halftimeMatchCodes) {
    const state = activeMatches.get(matchCode);
    if (!state) continue;
    for (const signal of state.unverifiedSignals) {
      if (signal.goalHappened !== null) continue;
      signal.goalHappened = false;
      signal.minutesAfterSignal = SIGNAL_EXPIRY_MINUTES;
      updatePendingSignal(matchCode, null, (r) => {
        if (r.signalIndex === signal.signalIndex && r.goalHappened === null) {
          r.goalHappened = false;
          r.minutesAfterSignal = SIGNAL_EXPIRY_MINUTES;
          return true;
        }
        return false;
      });
      expired++;
    }
  }
  return expired;
}

// ── Check pending signals on demand ──────────────────────────

/**
 * Check all pending signals and update their status.
 * Called manually via UI button.
 * Returns { total, expired, stillPending }
 */
export function checkPendingSignals(): { total: number; expired: number; stillPending: number } {
  const total = expireStaleSignals();

  // Also check any pending signals in the in-memory state that are
  // from matches no longer being polled — expire them too
  let stillPending = 0;
  for (const [, state] of activeMatches) {
    for (const s of state.unverifiedSignals) {
      if (s.goalHappened === null) stillPending++;
    }
  }

  return { total, expired: total, stillPending };
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
  expiryInterval = setInterval(() => {
    const expired = expireStaleSignals();
    if (expired > 0 && process.env.NODE_ENV === 'development') {
      console.log(`[SignalTracker] Expired ${expired} stale signal(s)`);
    }
  }, EXPIRY_CHECK_INTERVAL_MS);
  if (process.env.NODE_ENV === 'development') {
    console.log('[SignalTracker] Expiry checker started (interval: 30s)');
  }
}

/**
 * Stop the expiry checker interval.
 */
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
export function finalizeMatchSignals(
  matchCode: number,
  homeScore: number,
  awayScore: number,
): void {
  const state = activeMatches.get(matchCode);
  if (!state) return;

  for (const signal of state.unverifiedSignals) {
    if (signal.goalHappened !== null) continue;
    signal.goalHappened = false;
    signal.minutesAfterSignal = SIGNAL_EXPIRY_MINUTES;

    updatePendingSignal(matchCode, null, (r) => {
      if (r.signalIndex === signal.signalIndex && r.goalHappened === null) {
        r.goalHappened = false;
        r.minutesAfterSignal = SIGNAL_EXPIRY_MINUTES;
        r.finalHomeScore = homeScore;
        r.finalAwayScore = awayScore;
        return true;
      }
      return false;
    });
  }

  // Update final scores for all signals
  const today = getLocalDateString();
  updateDaySignal(today, matchCode, (r) => {
    if (r.finalHomeScore == null) {
      r.finalHomeScore = homeScore;
      r.finalAwayScore = awayScore;
      return true;
    }
    return false;
  });
  const yesterday = getLocalDateString(new Date(Date.now() - 86400000));
  updateDaySignal(yesterday, matchCode, (r) => {
    if (r.finalHomeScore == null) {
      r.finalHomeScore = homeScore;
      r.finalAwayScore = awayScore;
      return true;
    }
    return false;
  });

  activeMatches.delete(matchCode);
}

// ── Cleanup ───────────────────────────────────────────────────

/**
 * Remove stale matches from active tracking.
 */
export function cleanupStaleSignals(activeMatchCodes: number[]): void {
  const activeSet = new Set(activeMatchCodes);
  for (const [code] of activeMatches) {
    if (!activeSet.has(code)) {
      // Finalize any remaining unverified signals
      const state = activeMatches.get(code);
      if (state && state.unverifiedSignals.some(s => s.goalHappened === null)) {
        // Expire all pending
        for (const s of state.unverifiedSignals) {
          if (s.goalHappened !== null) continue;
          s.goalHappened = false;
          s.minutesAfterSignal = SIGNAL_EXPIRY_MINUTES;
        }
      }
      activeMatches.delete(code);
    }
  }
}

// ── Statistics ────────────────────────────────────────────────

/**
 * Calculate signal statistics for the last N days.
 */
export function calculateSignalStats(days: number = 30): SignalAccuracyStats {
  const allSignals: GoalSignalRecord[] = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = getLocalDateString(d);
    const daySignals = loadDaySignals(dateStr);
    allSignals.push(...daySignals);
  }

  const totalSignals = allSignals.length;
  const signalsWithGoal = allSignals.filter(s => s.goalHappened === true).length;
  const signalsWithoutGoal = allSignals.filter(s => s.goalHappened === false).length;
  const signalsPending = allSignals.filter(s => s.goalHappened === null).length;
  const correctPredictions = allSignals.filter(s => s.correctPrediction === true).length;
  const incorrectPredictions = allSignals.filter(s => s.correctPrediction === false).length;

  // Resolved-only stats
  const resolved = allSignals.filter(s => s.goalHappened !== null);
  const resolvedWithGoal = resolved.filter(s => s.goalHappened === true);
  const avgMinutesAfterSignal = resolvedWithGoal.length > 0
    ? resolvedWithGoal.reduce((sum, s) => sum + (s.minutesAfterSignal || 0), 0) / resolvedWithGoal.length
    : 0;

  // Median
  const sortedMinutes = resolvedWithGoal
    .map(s => s.minutesAfterSignal || 0)
    .sort((a, b) => a - b);
  const medianMinutesAfterSignal = sortedMinutes.length > 0
    ? sortedMinutes[Math.floor(sortedMinutes.length / 2)]
    : 0;

  // Min/Max
  const minMinutesAfterSignal = sortedMinutes.length > 0 ? sortedMinutes[0] : null;
  const maxMinutesAfterSignal = sortedMinutes.length > 0 ? sortedMinutes[sortedMinutes.length - 1] : null;

  // Probability buckets (60-69, 70-79, 80-89, 90-100)
  const bucketDefs = [
    { range: '60-69%', min: 60, max: 69 },
    { range: '70-79%', min: 70, max: 79 },
    { range: '80-89%', min: 80, max: 89 },
    { range: '90-100%', min: 90, max: 100 },
  ];
  const buckets: ProbabilityBucket[] = bucketDefs.map(b => {
    const inRange = resolved.filter(s => s.signalScore >= b.min && s.signalScore <= b.max);
    const goals = inRange.filter(s => s.goalHappened === true).length;
    const correct = inRange.filter(s => s.correctPrediction === true).length;
    return {
      ...b,
      total: inRange.length,
      goals,
      correct,
      goalRate: inRange.length > 0 ? goals / inRange.length : 0,
      accuracy: inRange.length > 0 ? correct / inRange.length : 0,
    };
  });

  // Brier score
  const brierScore = resolved.length > 0
    ? resolved.reduce((sum, s) => {
        const p = s.calibratedP;
        const o = s.goalHappened === true ? 1 : 0;
        return sum + (p - o) ** 2;
      }, 0) / resolved.length
    : 0;

  // Average predicted vs observed
  const avgPredictedP = resolved.length > 0
    ? resolved.reduce((sum, s) => sum + s.calibratedP, 0) / resolved.length
    : 0;
  const avgObservedP = resolved.length > 0
    ? resolvedWithGoal.length / resolved.length
    : 0;

  // Side accuracy
  const homeSignals = resolved.filter(s => s.signalSide === 'home');
  const awaySignals = resolved.filter(s => s.signalSide === 'away');
  const homeCorrect = homeSignals.filter(s => s.correctPrediction === true).length;
  const awayCorrect = awaySignals.filter(s => s.correctPrediction === true).length;

  // Level distribution
  const levelDistribution: Record<string, { total: number; goals: number; correct: number }> = {};
  for (const s of resolved) {
    if (!levelDistribution[s.signalLevel]) {
      levelDistribution[s.signalLevel] = { total: 0, goals: 0, correct: 0 };
    }
    levelDistribution[s.signalLevel].total++;
    if (s.goalHappened === true) levelDistribution[s.signalLevel].goals++;
    if (s.correctPrediction === true) levelDistribution[s.signalLevel].correct++;
  }

  // Escalation signals
  const escalationSignals = allSignals.filter(s => s.isEscalation).length;
  const escalationWithGoal = allSignals.filter(s => s.isEscalation && s.goalHappened === true).length;

  // Recent signals (last 50)
  const recentSignals = [...allSignals]
    .sort((a, b) => (b.signalTimestamp || 0) - (a.signalTimestamp || 0))
    .slice(0, 50);

  // By day
  const signalsByDay: Record<string, { total: number; goals: number; correct: number }> = {};
  for (const s of allSignals) {
    const d = s.date;
    if (!signalsByDay[d]) signalsByDay[d] = { total: 0, goals: 0, correct: 0 };
    signalsByDay[d].total++;
    if (s.goalHappened === true) signalsByDay[d].goals++;
    if (s.correctPrediction === true) signalsByDay[d].correct++;
  }

  // By minute range
  const signalsByMinuteRange: Record<string, { total: number; goals: number }> = {};
  const ranges = [
    { label: '0-15', min: 0, max: 15 },
    { label: '16-30', min: 16, max: 30 },
    { label: '31-45', min: 31, max: 45 },
    { label: '46-60', min: 46, max: 60 },
    { label: '61-75', min: 61, max: 75 },
    { label: '76-90+', min: 76, max: 999 },
  ];
  for (const r of ranges) {
    const inRange = allSignals.filter(s => s.signalMinute >= r.min && s.signalMinute <= r.max);
    signalsByMinuteRange[r.label] = {
      total: inRange.length,
      goals: inRange.filter(s => s.goalHappened === true).length,
    };
  }

  return {
    totalSignals,
    signalsWithGoal,
    signalsWithoutGoal,
    signalsPending,
    correctPredictions,
    incorrectPredictions,
    accuracyRate: correctPredictions > 0 ? correctPredictions / (correctPredictions + incorrectPredictions) : 0,
    goalAfterSignalRate: resolved.length > 0 ? signalsWithGoal / resolved.length : 0,
    falsePositiveRate: resolved.length > 0 ? signalsWithoutGoal / resolved.length : 0,
    avgMinutesAfterSignal,
    medianMinutesAfterSignal,
    minMinutesAfterSignal,
    maxMinutesAfterSignal,
    buckets,
    brierScore,
    avgPredictedP,
    avgObservedP,
    calibrationError: Math.abs(avgPredictedP - avgObservedP),
    homeSideAccuracy: homeSignals.length > 0 ? homeCorrect / homeSignals.length : 0,
    awaySideAccuracy: awaySignals.length > 0 ? awayCorrect / awaySignals.length : 0,
    levelDistribution,
    escalationSignals,
    escalationGoalRate: escalationSignals > 0 ? escalationWithGoal / escalationSignals : 0,
    recentSignals,
    signalsByDay,
    signalsByMinuteRange,
  };
}

// ── Data retrieval functions ──────────────────────────────────

export function getSignalRecordsForDate(date: string): GoalSignalRecord[] {
  return loadDaySignals(date);
}

export function getSignalForMatch(matchCode: number): GoalSignalRecord[] {
  const results: GoalSignalRecord[] = [];
  const today = getLocalDateString();

  // Check today and past few days
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = getLocalDateString(d);
    const signals = loadDaySignals(dateStr);
    results.push(...signals.filter(s => s.matchCode === matchCode));
  }
  return results;
}

export function getAvailableDates(): string[] {
  ensureDataDir();
  if (!existsSync(DATA_DIR)) return [];
  try {
    return readdirSync(DATA_DIR)
      .filter(f => f.startsWith('signals-') && f.endsWith('.json'))
      .map(f => f.replace('signals-', '').replace('.json', ''))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
