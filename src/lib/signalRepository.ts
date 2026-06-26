// ── Signal Repository (PostgreSQL-backed) ──────────────────────
// Persistence + queries for goal signal records. Replaces the
// flat-file JSON store that previously lived in goalSignalTracker.ts.
// All public functions return shapes compatible with the existing
// GoalSignalRecord / SignalAccuracyStats types so the UI and API
// consumers do not need to change.

import type { Signal } from '@prisma/client';
import { db } from './db';
import { logError } from './devLog';
import { SIGNAL_EXPIRY_MINUTES } from '@/config';
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
  // Prisma row may include the `id` field we don't expose in GoalSignalRecord.
  // We spread it via a cast so we can use it in lookup paths.
  const base = {
    id: row.id,
    matchCode: row.matchCode,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    league: row.league,
    matchTime: row.matchTime,
    date: row.date,

    signalMinute: row.signalMinute,
    signalSide: row.signalSide as "home" | "away",
    signalScore: row.signalScore,
    calibratedP: row.calibratedP,
    poissonP: row.poissonP,
    signalLevel: row.signalLevel as GoalSignalRecord["signalLevel"],
    activeFactors: Array.isArray(row.activeFactors)
      ? (row.activeFactors as string[])
      : [],

    lastScore: row.lastScore ?? row.signalScore,
    lastCalibratedP: row.lastCalibratedP ?? row.calibratedP,
    lastPoissonP: row.lastPoissonP ?? row.poissonP,
    lastFactors: Array.isArray(row.lastFactors)
      ? (row.lastFactors as string[])
      : [],

    homeScore: row.homeScore,
    awayScore: row.awayScore,
    currentHomeGoals: row.currentHomeGoals,
    currentAwayGoals: row.currentAwayGoals,

    signalTimestamp: row.signalTimestamp.getTime(),
    lastSignalTimestamp: row.lastSignalTimestamp
      ? row.lastSignalTimestamp.getTime()
      : null,

    goalHappened: row.goalHappened,
    goalMinute: row.goalMinute,
    goalSide: row.goalSide as "home" | "away" | null,
    correctPrediction: row.correctPrediction,
    minutesAfterSignal: row.minutesAfterSignal,
    goalTimestamp: row.goalTimestamp ? row.goalTimestamp.getTime() : null,

    finalHomeScore: row.finalHomeScore,
    finalAwayScore: row.finalAwayScore,

    escalated: row.escalated ?? false,
  };
  return base as GoalSignalRecord & { id: string };
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

    lastScore: record.lastScore,
    lastCalibratedP: record.lastCalibratedP,
    lastPoissonP: record.lastPoissonP,
    lastFactors: record.lastFactors,

    homeScore: record.homeScore,
    awayScore: record.awayScore,
    currentHomeGoals: record.currentHomeGoals,
    currentAwayGoals: record.currentAwayGoals,

    signalTimestamp: new Date(record.signalTimestamp),
    lastSignalTimestamp:
      record.lastSignalTimestamp != null
        ? new Date(record.lastSignalTimestamp)
        : null,

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

/**
 * Find an existing signal by (matchCode, date, signalSide). Returns the
 * row (with id) or null. Used by checkAndRecordSignal to decide upsert vs create.
 */
export async function findExisting(
  matchCode: number,
  date: string,
  signalSide: string,
): Promise<(GoalSignalRecord & { id: string }) | null> {
  const row = await db.signal.findFirst({
    where: { matchCode, date, signalSide, goalHappened: null }, // only pending
    orderBy: { signalTimestamp: "desc" },
  });
  if (!row) return null;
  return toGoalSignalRecord(row) as GoalSignalRecord & { id: string };
}

/**
 * Update "last" value fields for an existing signal. Detects escalation:
 * when lastScore >= signalScore + 10, marks escalated=true permanently.
 */
export async function updateLastValues(
  id: string,
  fields: {
    lastScore: number;
    lastCalibratedP: number;
    lastPoissonP: number;
    lastFactors: string[];
    lastSignalTimestamp: number;
  },
): Promise<GoalSignalRecord | null> {
  try {
    // Atomic escalation via updateMany WHERE clause. Only rows that are
    // NOT already escalated AND have signalScore <= lastScore - 10 get
    // escalated=true. Concurrent callers both run this query -- the first
    // one succeeds (escalated flips to true), the second finds no matching
    // rows (escalated is already true). No read-then-write race.
    await db.signal.updateMany({
      where: {
        id,
        escalated: false,
        signalScore: { lte: fields.lastScore - 10 },
      },
      data: { escalated: true },
    });

    // Then update last values (escalation race is handled above)
    const row = await db.signal.update({
      where: { id },
      data: {
        lastScore: fields.lastScore,
        lastCalibratedP: fields.lastCalibratedP,
        lastPoissonP: fields.lastPoissonP,
        lastFactors: fields.lastFactors,
        lastSignalTimestamp: new Date(fields.lastSignalTimestamp),
      },
    });
    return toGoalSignalRecord(row);
  } catch (err) {
    logError('signalRepository', 'updateLastValues failed:', err);
    return null;
  }
}

// ── Writes ──────────────────────────────────────────────────────

/**
 * Create a new signal record. Used only for brand-new signals.
 * (matchCode, date, signalSide) unique constraint prevents duplicates.
 */
export async function createSignal(
  record: GoalSignalRecord,
): Promise<GoalSignalRecord | null> {
  const data = fromGoalSignalRecord(record);
  try {
    const row = await db.signal.create({ data });
    return toGoalSignalRecord(row);
  } catch (err: unknown) {
    if (isPrismaUniqueViolation(err)) return null;
    throw err;
  }
}

/**
 * Update verification fields for a signal. Uses optimistic lock via
 * updatedAt check to prevent finalize race when two callers race.
 * Returns the updated record or null if conflict/not-found.
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
    /** Pass the observed `updatedAt` from the prior read for optimistic lock.
     * If omitted, falls back to plain update (legacy callers). */
    expectedUpdatedAt?: number | null;
  },
): Promise<GoalSignalRecord | null> {
  try {
    const where: { id: string; updatedAt?: Date } = { id };
    if (fields.expectedUpdatedAt != null) {
      where.updatedAt = new Date(fields.expectedUpdatedAt);
    }
    const row = await db.signal.update({
      where,
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
    // P2034 = transaction conflict — another writer beat us
    if (typeof err === 'object' && err !== null && 'code' in err &&
        (err as { code?: string }).code === 'P2034') return null;
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

// ── Batch writes (Faz 3) ────────────────────────────────────────

/**
 * Bulk verification update for a single match — collapses N
 * pending signals' update into one round trip.
 * Returns the count of rows actually updated.
 */
export async function updateVerificationBatch(
  matchCode: number,
  fields: {
    goalHappened: boolean;
    goalMinute?: number;
    goalSide?: 'home' | 'away' | null;
    correctPrediction?: boolean;
    minutesAfterSignal?: number;
    goalTimestamp?: number | null;
  },
): Promise<number> {
  try {
    const result = await db.signal.updateMany({
      where: { matchCode, goalHappened: null },
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
    return result.count;
  } catch (err) {
    logError('signalRepository', 'updateVerificationBatch failed:', err);
    return 0;
  }
}

/**
 * Bulk expire pending signals whose signalTimestamp is older than
 * `cutoff`. Returns number of expired signals.
 */
export async function expirePendingBatch(cutoff: Date): Promise<number> {
  try {
    const result = await db.signal.updateMany({
      where: { goalHappened: null, signalTimestamp: { lt: cutoff } },
      data: { goalHappened: false },
    });
    return result.count;
  } catch (err) {
    logError('signalRepository', 'expirePendingBatch failed:', err);
    return 0;
  }
}

/**
 * Bulk expire pending signals for an explicit list of matchCodes.
 * Used by goalSignalTracker.cleanupStaleSignals — keeps the
 * repository as the single write path. Returns number of expired rows.
 */
export async function expirePendingBatchForCodes(
  matchCodes: number[],
): Promise<number> {
  if (matchCodes.length === 0) return 0;
  try {
    const result = await db.signal.updateMany({
      where: { matchCode: { in: matchCodes }, goalHappened: null },
      data: {
        goalHappened: false,
        minutesAfterSignal: SIGNAL_EXPIRY_MINUTES,
      },
    });
    return result.count;
  } catch (err) {
    logError('signalRepository', 'expirePendingBatchForCodes failed:', err);
    return 0;
  }
}

/**
 * Bulk finalize: set final score on ALL signals for a match whose
 * finalHomeScore is not yet set. Idempotent (skips already-set rows
 * via the `null` check in where).
 */
export async function finalizeMatchBatch(
  matchCode: number,
  finalHomeScore: number,
  finalAwayScore: number,
): Promise<number> {
  try {
    const result = await db.signal.updateMany({
      where: { matchCode, finalHomeScore: null },
      data: { finalHomeScore, finalAwayScore },
    });
    return result.count;
  } catch (err) {
    logError('signalRepository', 'finalizeMatchBatch failed:', err);
    return 0;
  }
}

/**
 * Bulk expire pending signals for a halftime-eligible window
 * (signalMinute >= 41) across multiple matches. Used by
 * expireSignalsForHalftime to avoid N round trips.
 */
export async function expireHalftimeBatch(
  matchCodes: number[],
): Promise<number> {
  if (matchCodes.length === 0) return 0;
  try {
    const result = await db.signal.updateMany({
      where: {
        matchCode: { in: matchCodes },
        goalHappened: null,
        signalMinute: { gte: 41 },
      },
      data: { goalHappened: false, minutesAfterSignal: 15 },
    });
    return result.count;
  } catch (err) {
    logError('signalRepository', 'expireHalftimeBatch failed:', err);
    return 0;
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
	    ? (() => {
	        // Zaman ağırlıklı Brier: eski sinyaller düşük ağırlık
	        // 7 gün half-life ile üstel decay
	        const now = Date.now();
	        let weightedSum = 0;
	        let totalWeight = 0;
	        for (const s of resolved) {
	          const daysAgo = (now - (s.signalTimestamp || now)) / (24 * 60 * 60 * 1000);
	          const weight = Math.exp(-daysAgo / 7);
	          const p = s.calibratedP;
	          const o = s.goalHappened === true ? 1 : 0;
	          weightedSum += weight * (p - o) ** 2;
	          totalWeight += weight;
	        }
	        return totalWeight > 0 ? weightedSum / totalWeight : 0;
	      })()
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

  const escalationSignals = allSignals.filter(
    (s) => s.escalated === true,
  ).length;
  const escalationWithGoal = allSignals.filter(
    (s) => s.escalated === true && s.goalHappened === true,
  ).length;

	  const recentSignals = [...allSignals]
	    .sort((a, b) => (b.signalTimestamp || 0) - (a.signalTimestamp || 0))
	    .slice(0, 200);

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

  // ── 🥇 PRIMARY: Goal success by time window ─────────────
  // Ana başarı metriği: "Gol olacak" dedik, oldu mu?
  // Excellent = 5dk içinde, Good = 10dk içinde, Late = 15dk içinde
  const excellent = resolvedWithGoal.filter(s => (s.minutesAfterSignal ?? 999) <= 5).length;
  const good = resolvedWithGoal.filter(s => {
    const m = s.minutesAfterSignal ?? 999;
    return m > 5 && m <= 10;
  }).length;
  const late = resolvedWithGoal.filter(s => {
    const m = s.minutesAfterSignal ?? 999;
    return m > 10 && m <= 15;
  }).length;
  const gFail = signalsWithoutGoal;
  const gPending = signalsPending;
  const gResolved = resolved.length;

  const excellentRate = gResolved > 0 ? excellent / gResolved : 0;
  const goodRate = gResolved > 0 ? good / gResolved : 0;
  const lateRate = gResolved > 0 ? late / gResolved : 0;
  const failRate = gResolved > 0 ? gFail / gResolved : 0;
  const successRate = gResolved > 0 ? (excellent + good + late) / gResolved : 0;

  // ── 🥈 SECONDARY: Side accuracy (sadece gol olanlarda) ──
  const sideCorrect = resolvedWithGoal.filter(s => s.correctPrediction === true).length;
  const sideIncorrect = resolvedWithGoal.filter(s => s.correctPrediction === false).length;
  const sideTotal = sideCorrect + sideIncorrect;

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

    // 🥇 PRIMARY — Goal success by time
    goalPrimary: {
      excellent, good, late,
      fail: gFail,
      pending: gPending,
      excellentRate, goodRate, lateRate, failRate, successRate,
    },

    // 🥈 SECONDARY — Direction accuracy (only on signals with goals)
    sideAccuracy: {
      correct: sideCorrect,
      incorrect: sideIncorrect,
      rate: sideTotal > 0 ? sideCorrect / sideTotal : 0,
    },
  };
}
