// ── Signal Repository (PostgreSQL-backed) ──────────────────────
// Persistence + queries for goal signal records. Replaces the
// flat-file JSON store that previously lived in goalSignalTracker.ts.
// All public functions return shapes compatible with the existing
// GoalSignalRecord / SignalAccuracyStats types so the UI and API
// consumers do not need to change.

import type { Signal } from '@prisma/client';
import { db } from './db';
import type {
  GoalSignalRecord,
  SignalAccuracyStats,
  ProbabilityBucket,
} from './goalSignalTracker';

// ── Adapter: Prisma row → in-memory GoalSignalRecord ───────────

/**
 * Convert a Prisma Signal row to the in-memory GoalSignalRecord shape
 * used by the rest of the app. Handles:
 *  - Date → unix ms number
 *  - Json (string[]) → string[]
 *  - null passthrough
 */
export function toGoalSignalRecord(row: Signal): GoalSignalRecord {
  return {
    matchCode: row.matchCode,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    league: row.league,
    matchTime: row.matchTime,
    date: row.date,

    signalMinute: row.signalMinute,
    signalSide: row.signalSide as 'home' | 'away',
    signalScore: row.signalScore,
    calibratedP: row.calibratedP,
    poissonP: row.poissonP,
    signalLevel: row.signalLevel as GoalSignalRecord['signalLevel'],

    activeFactors: Array.isArray(row.activeFactors)
      ? (row.activeFactors as string[])
      : [],
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    currentHomeGoals: row.currentHomeGoals,
    currentAwayGoals: row.currentAwayGoals,

    signalIndex: row.signalIndex,
    isEscalation: row.isEscalation,
    previousSignalScore: row.previousSignalScore,
    signalTimestamp: row.signalTimestamp.getTime(),

    goalHappened: row.goalHappened,
    goalMinute: row.goalMinute,
    goalSide: row.goalSide as 'home' | 'away' | null,
    correctPrediction: row.correctPrediction,
    minutesAfterSignal: row.minutesAfterSignal,
    goalTimestamp: row.goalTimestamp ? row.goalTimestamp.getTime() : null,

    finalHomeScore: row.finalHomeScore,
    finalAwayScore: row.finalAwayScore,
  };
}

// ── Convert in-memory record → Prisma create input ──────────────

/**
 * Build Prisma create input from a GoalSignalRecord. Used by
 * checkAndRecordSignal at write time. Inverse of toGoalSignalRecord.
 */
function fromGoalSignalRecord(record: GoalSignalRecord) {
  return {
    matchCode: record.matchCode,
    homeTeam: record.homeTeam,
    awayTeam: record.awayTeam,
    league: record.league,
    matchTime: record.matchTime,
    date: record.date,

    signalMinute: record.signalMinute,
    signalSide: record.signalSide,
    signalScore: record.signalScore,
    calibratedP: record.calibratedP,
    poissonP: record.poissonP,
    signalLevel: record.signalLevel,
    activeFactors: record.activeFactors,

    homeScore: record.homeScore,
    awayScore: record.awayScore,
    currentHomeGoals: record.currentHomeGoals,
    currentAwayGoals: record.currentAwayGoals,

    signalIndex: record.signalIndex,
    isEscalation: record.isEscalation,
    previousSignalScore: record.previousSignalScore,
    signalTimestamp: new Date(record.signalTimestamp),

    goalHappened: record.goalHappened,
    goalMinute: record.goalMinute,
    goalSide: record.goalSide,
    correctPrediction: record.correctPrediction,
    minutesAfterSignal: record.minutesAfterSignal,
    goalTimestamp:
      record.goalTimestamp != null ? new Date(record.goalTimestamp) : null,

    finalHomeScore: record.finalHomeScore,
    finalAwayScore: record.finalAwayScore,
  };
}

// ── Reads ───────────────────────────────────────────────────────

/**
 * All signals for a single date. Ordered by signalTimestamp ASC.
 */
export async function findByDate(date: string): Promise<GoalSignalRecord[]> {
  const rows = await db.signal.findMany({
    where: { date },
    orderBy: { signalTimestamp: 'asc' },
  });
  return rows.map(toGoalSignalRecord);
}

/**
 * Signals for a single matchCode across the last N days (default 7).
 * Ordered by signalTimestamp ASC.
 */
export async function findByMatch(
  matchCode: number,
  options: { days?: number } = {},
): Promise<GoalSignalRecord[]> {
  const days = options.days ?? 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.signal.findMany({
    where: { matchCode, signalTimestamp: { gte: cutoff } },
    orderBy: { signalTimestamp: 'asc' },
  });
  return rows.map(toGoalSignalRecord);
}

/**
 * Pending signals older than the expiry threshold. Used by the
 * background expiry interval and by cleanupStaleSignals.
 */
export async function findRecentPending(
  expiryMs: number,
): Promise<GoalSignalRecord[]> {
  const cutoff = new Date(Date.now() - expiryMs);
  const rows = await db.signal.findMany({
    where: { goalHappened: null, signalTimestamp: { lt: cutoff } },
  });
  return rows.map(toGoalSignalRecord);
}

/**
 * Pending signals for a specific match. Used by checkForGoals to find
 * candidates for verification when a goal is observed.
 */
export async function findPendingForMatch(
  matchCode: number,
  signalSide: 'home' | 'away',
): Promise<GoalSignalRecord[]> {
  const rows = await db.signal.findMany({
    where: { matchCode, signalSide, goalHappened: null },
    orderBy: { signalMinute: 'desc' },
  });
  return rows.map(toGoalSignalRecord);
}

/**
 * All pending signals for a match (both sides). Used by
 * finalizeMatchSignals.
 */
export async function findAllPendingForMatch(
  matchCode: number,
): Promise<GoalSignalRecord[]> {
  const rows = await db.signal.findMany({
    where: { matchCode, goalHappened: null },
  });
  return rows.map(toGoalSignalRecord);
}

/**
 * All signals for a match (resolved + pending) across last 7 days.
 * Used to backfill final scores.
 */
export async function findAllForMatch(
  matchCode: number,
): Promise<GoalSignalRecord[]> {
  return findByMatch(matchCode, { days: 7 });
}

/**
 * Distinct dates that have at least one signal, sorted DESC.
 * Used by UI date pickers.
 */
export async function getAvailableDates(): Promise<string[]> {
  const rows = await db.signal.findMany({
    distinct: ['date'],
    select: { date: true },
    orderBy: { date: 'desc' },
  });
  return rows.map((r) => r.date);
}

/**
 * All signals in the last N days. Used by calculateSignalStats.
 */
export async function findRecent(days: number): Promise<GoalSignalRecord[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.signal.findMany({
    where: { signalTimestamp: { gte: cutoff } },
    orderBy: { signalTimestamp: 'asc' },
  });
  return rows.map(toGoalSignalRecord);
}

// ── Writes ──────────────────────────────────────────────────────

/**
 * Create a new signal record. The (matchCode, date, signalIndex) unique
 * constraint prevents duplicate writes if the same signal is posted
 * twice. Returns the created record (or null on unique violation).
 */
export async function createSignal(
  record: GoalSignalRecord,
): Promise<GoalSignalRecord | null> {
  try {
    const row = await db.signal.create({ data: fromGoalSignalRecord(record) });
    return toGoalSignalRecord(row);
  } catch (err: unknown) {
    // P2002 = unique constraint violation → treat as a no-op duplicate
    if (isPrismaUniqueViolation(err)) return null;
    throw err;
  }
}

/**
 * Update verification fields for a signal. Returns the updated record
 * or null if the id does not exist.
 */
export async function updateVerification(
  id: string,
  fields: {
    goalHappened: boolean;
    goalMinute?: number;
    goalSide?: 'home' | 'away' | null;
    correctPrediction?: boolean;
    minutesAfterSignal?: number;
    goalTimestamp?: number | null;
  },
): Promise<GoalSignalRecord | null> {
  try {
    const row = await db.signal.update({
      where: { id },
      data: {
        goalHappened: fields.goalHappened,
        goalMinute: fields.goalMinute,
        goalSide: fields.goalSide ?? null,
        correctPrediction: fields.correctPrediction,
        minutesAfterSignal: fields.minutesAfterSignal,
        goalTimestamp:
          fields.goalTimestamp != null
            ? new Date(fields.goalTimestamp)
            : fields.goalTimestamp === null
              ? null
              : undefined,
      },
    });
    return toGoalSignalRecord(row);
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return null;
    throw err;
  }
}

/**
 * Set final match score for a signal. Skips if finalHomeScore is
 * already set (idempotent backfill). Returns updated record or null.
 */
export async function updateFinalScore(
  id: string,
  finalHomeScore: number,
  finalAwayScore: number,
): Promise<GoalSignalRecord | null> {
  const existing = await db.signal.findUnique({
    where: { id },
    select: { finalHomeScore: true },
  });
  if (!existing) return null;
  if (existing.finalHomeScore != null) return null;
  try {
    const row = await db.signal.update({
      where: { id },
      data: { finalHomeScore, finalAwayScore },
    });
    return toGoalSignalRecord(row);
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return null;
    throw err;
  }
}

// ── Error guards ────────────────────────────────────────────────

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}

function isPrismaNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2025'
  );
}

// ── Stats aggregation ───────────────────────────────────────────

/**
 * Compute SignalAccuracyStats from the last `days` days. Aggregation
 * runs in JS — 10K rows / 30 days is well within in-process budget
 * and avoids a query fan-out for marginal speed gain.
 */
export async function calculateSignalStats(
  days: number = 30,
): Promise<SignalAccuracyStats> {
  const allSignals = await findRecent(days);

  const totalSignals = allSignals.length;
  const signalsWithGoal = allSignals.filter((s) => s.goalHappened === true).length;
  const signalsWithoutGoal = allSignals.filter((s) => s.goalHappened === false).length;
  const signalsPending = allSignals.filter((s) => s.goalHappened === null).length;
  const correctPredictions = allSignals.filter((s) => s.correctPrediction === true).length;
  const incorrectPredictions = allSignals.filter((s) => s.correctPrediction === false).length;

  const resolved = allSignals.filter((s) => s.goalHappened !== null);
  const resolvedWithGoal = resolved.filter((s) => s.goalHappened === true);

  const avgMinutesAfterSignal = resolvedWithGoal.length > 0
    ? resolvedWithGoal.reduce((sum, s) => sum + (s.minutesAfterSignal || 0), 0) / resolvedWithGoal.length
    : 0;

  const sortedMinutes = resolvedWithGoal
    .map((s) => s.minutesAfterSignal || 0)
    .sort((a, b) => a - b);
  const medianMinutesAfterSignal = sortedMinutes.length > 0
    ? sortedMinutes[Math.floor(sortedMinutes.length / 2)]
    : 0;
  const minMinutesAfterSignal = sortedMinutes.length > 0 ? sortedMinutes[0] : null;
  const maxMinutesAfterSignal = sortedMinutes.length > 0 ? sortedMinutes[sortedMinutes.length - 1] : null;

  const bucketDefs = [
    { range: '60-69%', min: 60, max: 69 },
    { range: '70-79%', min: 70, max: 79 },
    { range: '80-89%', min: 80, max: 89 },
    { range: '90-100%', min: 90, max: 100 },
  ];
  const buckets: ProbabilityBucket[] = bucketDefs.map((b) => {
    const inRange = resolved.filter((s) => s.signalScore >= b.min && s.signalScore <= b.max);
    const goals = inRange.filter((s) => s.goalHappened === true).length;
    const correct = inRange.filter((s) => s.correctPrediction === true).length;
    return {
      ...b,
      total: inRange.length,
      goals,
      correct,
      goalRate: inRange.length > 0 ? goals / inRange.length : 0,
      accuracy: inRange.length > 0 ? correct / inRange.length : 0,
    };
  });

  const brierScore = resolved.length > 0
    ? resolved.reduce((sum, s) => {
        const p = s.calibratedP;
        const o = s.goalHappened === true ? 1 : 0;
        return sum + (p - o) ** 2;
      }, 0) / resolved.length
    : 0;

  const avgPredictedP = resolved.length > 0
    ? resolved.reduce((sum, s) => sum + s.calibratedP, 0) / resolved.length
    : 0;
  const avgObservedP = resolved.length > 0
    ? resolvedWithGoal.length / resolved.length
    : 0;

  const homeSignals = resolved.filter((s) => s.signalSide === 'home');
  const awaySignals = resolved.filter((s) => s.signalSide === 'away');
  const homeCorrect = homeSignals.filter((s) => s.correctPrediction === true).length;
  const awayCorrect = awaySignals.filter((s) => s.correctPrediction === true).length;

  const levelDistribution: Record<string, { total: number; goals: number; correct: number }> = {};
  for (const s of resolved) {
    if (!levelDistribution[s.signalLevel]) {
      levelDistribution[s.signalLevel] = { total: 0, goals: 0, correct: 0 };
    }
    levelDistribution[s.signalLevel].total++;
    if (s.goalHappened === true) levelDistribution[s.signalLevel].goals++;
    if (s.correctPrediction === true) levelDistribution[s.signalLevel].correct++;
  }

  const escalationSignals = allSignals.filter((s) => s.isEscalation).length;
  const escalationWithGoal = allSignals.filter((s) => s.isEscalation && s.goalHappened === true).length;

  const recentSignals = [...allSignals]
    .sort((a, b) => (b.signalTimestamp || 0) - (a.signalTimestamp || 0))
    .slice(0, 50);

  const signalsByDay: Record<string, { total: number; goals: number; correct: number }> = {};
  for (const s of allSignals) {
    const d = s.date;
    if (!signalsByDay[d]) signalsByDay[d] = { total: 0, goals: 0, correct: 0 };
    signalsByDay[d].total++;
    if (s.goalHappened === true) signalsByDay[d].goals++;
    if (s.correctPrediction === true) signalsByDay[d].correct++;
  }

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
    const inRange = allSignals.filter((s) => s.signalMinute >= r.min && s.signalMinute <= r.max);
    signalsByMinuteRange[r.label] = {
      total: inRange.length,
      goals: inRange.filter((s) => s.goalHappened === true).length,
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
