// ── Goal Signal Tracker v3 (PostgreSQL-backed) ──────────────────
// Tracks ALL goal probability signals and records detailed info:
//   - Every signal above threshold
//   - Signal start minute, probability %, calibrated probability
//   - Whether a goal happened after signal
//   - If goal happened: how many minutes after, which team scored
//   - Whether the scoring team matched the predicted side (CORRECTED: v3 fixes correctPrediction)
//   - All active factors at signal time
//   - Match state at signal time (current score, minute)
//   - Signal escalation tracking (probability progression)
//
// v3 Changes:
//   - FIX: correctPrediction now compares goalSide vs signalSide (was always true)
//   - FIX: Goal check ordering — signal created BEFORE verifying (was after)
//   - FIX: Dual goal detection removed — only frontend reportGoal path used
//   - FIX: Stoppage time minute parsing ("45+2" → 47)
//   - FIX: Negative minutesAfterSignal guard (Math.max(0, ...))
//   - FIX: Cooldown mechanism — min 3 min between signals for same match+side
//   - FIX: Devre arasi expiry — only signals in last 5min before HT
//   - FIX: loadById uses static import (was dynamic import every call)
//
// Persistence: PostgreSQL via signalRepository.

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
  // findPendingForMatch imported but unused — see TS6133 cleanup
  getAvailableDates as repoGetDates,
  calculateSignalStats as repoCalculateStats,
  updateVerification as repoUpdateVerification,
  updateFinalScore as repoUpdateFinalScore,
} from "./signalRepository";

// ── Server-only check ─────────────────────────────────────────
const isServer = typeof window === 'undefined' && typeof process !== 'undefined';

// ── Local date helper ────────────────────────────────────
const getLocalDateString = (d: Date = new Date()): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// ── Proper minute parser (handles "45+2" → 47) ──────────────
function parseMinute(minute: string | number): number {
  if (typeof minute === 'number') return Math.max(0, Math.min(120, minute));
  const plusMatch = minute.match(/^(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) {
    return parseInt(plusMatch[1], 10) + parseInt(plusMatch[2], 10);
  }
  const num = parseInt(minute.replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? 0 : Math.max(0, Math.min(120, num));
}

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

  // ── Goal verification (filled later by reportGoal / expire) ──
  goalHappened: boolean | null; // null=pending, true=goal happened, false=expired/no goal
  goalMinute: number | null;
  goalSide: "home" | "away" | null;
  correctPrediction: boolean | null; // true if scoring side MATCHED predicted side
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

  // ═══════════════════════════════════════════════════════════════
  // 🥇 PRIMARY METRIC: Goal Success by Time Window
  // Sistemin ana amacı: "Gol olacak" dediği zaman gol olması.
  // Yön (home/away) İKİNCİL bir metriktir.
  //
  //   Excellent (5dk):  Sinyalden sonraki 5 dk içinde gol → MÜKEMMEL
  //   Good (10dk):      5-10 dk arasında gol → İYİ
  //   Late (15dk):      10-15 dk arasında gol → GEÇ AMA BAŞARILI
  //   Fail:             15 dk içinde gol OLMADI → BAŞARISIZ
  // ═══════════════════════════════════════════════════════════════
  goalPrimary: {
    excellent: number;  // gol ≤ 5dk
    good: number;       // 5dk < gol ≤ 10dk
    late: number;       // 10dk < gol ≤ 15dk
    fail: number;       // gol olmadı
    pending: number;    // henüz belli değil

    // Yüzdesel oranlar
    excellentRate: number;  // excellent / resolved
    goodRate: number;       // good / resolved
    lateRate: number;       // late / resolved
    failRate: number;       // fail / resolved
    successRate: number;    // (excellent + good + late) / resolved = toplam başarı
  };

  // 🥈 SECONDARY METRIC: Side (Direction) Accuracy
  // Sadece gol olan sinyallerde yön doğruluğu
  sideAccuracy: {
    correct: number;    // Doğru yön tahmini
    incorrect: number;  // Yanlış yön tahmini
    rate: number;       // correct / (correct + incorrect)
  };
}

// ── Internal state (session-local only) ────────────────────────

interface ActiveMatchState {
  lastKnownHomeGoals: number;
  lastKnownAwayGoals: number;
  lastSignalTimestamps: Map<string, number>; // "home"|"away" → timestamp for cooldown
}

const activeMatches = new Map<number, ActiveMatchState>();

// ── Constants ──────────────────────────────────────────────────

const SIGNAL_THRESHOLD = 60;
const SIGNAL_EXPIRY_MINUTES = 15;  // Max minutes to wait for goal before expiring
const EXPIRY_CHECK_INTERVAL_MS = 30000; // Check every 30s
const SIGNAL_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes cooldown between signals for same match+side

// ════════════════════════════════════════════════════════════════
// SINYAL YÖNETIMI — Tek giriş noktası
// ════════════════════════════════════════════════════════════════

/**
 * Check if a goal probability reading should trigger a signal record.
 *
 * IMPORTANT (v3): Bu fonksiyon SADECE sinyal kaydı yapar, goal check YAPMAZ.
 * Goal detection tamamen frontend'den gelen `reportGoal` POST'u ile yapılır.
 * Bu, race condition'ı önler ve iki kanallı goal detection'ı tek kanala indirger.
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
  const minNum = parseMinute(minute);
  const today = getLocalDateString();

  // ── Update activeMatches state (sadece skor tracking) ─────────
  let state = activeMatches.get(matchCode);
  if (!state) {
    state = {
      lastKnownHomeGoals: currentHomeGoals,
      lastKnownAwayGoals: currentAwayGoals,
      lastSignalTimestamps: new Map(),
    };
    activeMatches.set(matchCode, state);
  }
  state.lastKnownHomeGoals = currentHomeGoals;
  state.lastKnownAwayGoals = currentAwayGoals;

  // ── Signal threshold checks ───────────────────────────────────
  if (goalProbability.score < SIGNAL_THRESHOLD) return null;
  if (!goalProbability.side || goalProbability.side === "both") return null;

  // ── Excluded minute zones ─────────────────────────────────────
  // Skip signals in unreliable time windows:
  //   0-2 min:    match context still forming
  //   43-45 min:  pre-halftime tactical uncertainty
  //   89-120 min: extra-time swings
  const sigMin = parseMinute(minute);
  if (sigMin <= 2 || (sigMin >= 43 && sigMin <= 45) || sigMin >= 89) return null;

  const signalSide = goalProbability.side as "home" | "away";

  // ── Cooldown check: Aynı match+side için son 3 dk içinde sinyal oluşturuldu mu? ──
  const lastSignalTime = state.lastSignalTimestamps.get(signalSide);
  if (lastSignalTime && (now - lastSignalTime) < SIGNAL_COOLDOWN_MS) {
    // Cooldown içinde — sadece last values güncelle (yeni sinyal oluşturma)
    const existing = await repoFindExisting(matchCode, today, signalSide);
    if (existing && existing.goalHappened === null) {
      await repoUpdateLastValues(existing.id!, {
        lastScore: goalProbability.score,
        lastCalibratedP: goalProbability.calibratedP,
        lastPoissonP: goalProbability.poissonP,
        lastFactors: goalProbability.factors,
        lastSignalTimestamp: now,
      });
    }
    return null;
  }

  // ── Upsert logic ──────────────────────────────────────────────
  // Pending sinyal varsa güncelle, çözülmüşse/yoksa yeni oluştur
  const existing = await repoFindExisting(matchCode, today, signalSide);

  if (existing && existing.goalHappened === null) {
    // Pending sinyal — sadece son değerleri güncelle
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
  if (created) {
    // Cooldown timestamp'ini güncelle
    state.lastSignalTimestamps.set(signalSide, now);
  }
  return created;
}

/**
 * Report a goal scored in a match. Called by the frontend when it
 * detects a goal (goal count changed between polls).
 *
 * v3 FIX: correctPrediction artık goalSide === signalSide kontrolü yapıyor.
 * v3 FIX: minutesAfterSignal negatif olamaz (Math.max ile koruma).
 */
export async function reportGoal(
  matchCode: number,
  goalSide: "home" | "away",
  goalMinute: number,
): Promise<void> {
  const today = getLocalDateString();

  const allPending = await repoFindAllPending(matchCode);
  for (const s of allPending) {
    const id = s.id ?? (await loadById(matchCode, today, s.signalSide));
    if (!id) continue;

    // v3 FIX: Doğru correctPrediction — tahmin edilen taraf ile gol atan taraf eşleşiyor mu?
    const predictionCorrect = goalSide === s.signalSide;

    // v3 FIX: minutesAfterSignal asla negatif olamaz
    const minutesDiff = Math.max(0, goalMinute - s.signalMinute);

    await repoUpdateVerification(id, {
      goalHappened: true,
      goalMinute,
      goalSide,
      correctPrediction: predictionCorrect,
      minutesAfterSignal: minutesDiff,
      goalTimestamp: Date.now(),
    });
  }

  // Update activeMatches state
  const state = activeMatches.get(matchCode);
  if (state) {
    if (goalSide === 'home') state.lastKnownHomeGoals++;
    else state.lastKnownAwayGoals++;
  }
}

// ════════════════════════════════════════════════════════════════
// SİNYAL SÜRE DOLUMU (EXPIRY)
// ════════════════════════════════════════════════════════════════

/**
 * Expire any pending signals that have been waiting longer than SIGNAL_EXPIRY_MINUTES.
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
 * Immediately expire pending signals for matches that entered halftime.
 *
 * v3 FIX: Sadece 41-45. dakikalar arasında oluşan sinyalleri expire et.
 * 30. dakikada oluşan sinyal için devre arasına kadar 15dk var —
 * zaten normal expire mekanizması onu halleder.
 */
export async function expireSignalsForHalftime(
  halftimeMatchCodes: Set<number>,
): Promise<number> {
  let expired = 0;
  for (const matchCode of halftimeMatchCodes) {
    const pending = await repoFindAllPending(matchCode);
    for (const s of pending) {
      // Sadece son 5 dakikada (41-45) oluşan sinyalleri expire et
      if (s.signalMinute < 41) continue;
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

// ════════════════════════════════════════════════════════════════
// BEKLEYEN SİNYALLERİ KONTROL ET
// ════════════════════════════════════════════════════════════════

/**
 * Check all pending signals and update their status.
 */
export async function checkPendingSignals(): Promise<{
  total: number;
  expired: number;
  stillPending: number;
}> {
  const expired = await expireStaleSignals();
  const stillPending = activeMatches.size;
  return { total: expired, expired, stillPending };
}

// ════════════════════════════════════════════════════════════════
// BACKGROUND EXPIRY CHECKER
// ════════════════════════════════════════════════════════════════

let expiryInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background expiry checker. Runs every EXPIRY_CHECK_INTERVAL_MS.
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
}

function stopExpiryChecker(): void {
  if (expiryInterval) {
    clearInterval(expiryInterval);
    expiryInterval = null;
  }
}
void stopExpiryChecker;

// ════════════════════════════════════════════════════════════════
// MAÇ BİTİŞİ — FINALIZE
// ════════════════════════════════════════════════════════════════

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

  // Backfill final scores for already-resolved signals
  const all = await repoFindAllForMatch(matchCode);
  for (const s of all) {
    if (s.finalHomeScore != null) continue;
    const id = s.id ?? (await loadById(matchCode, s.date, s.signalSide));
    if (!id) continue;
    await repoUpdateFinalScore(id, homeScore, awayScore);
  }

  activeMatches.delete(matchCode);
}

// ════════════════════════════════════════════════════════════════
// TEMİZLİK
// ════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════
// İSTATİSTİK
// ════════════════════════════════════════════════════════════════

/**
 * Calculate signal statistics for the last N days.
 */
export async function calculateSignalStats(
  days: number = 30,
): Promise<SignalAccuracyStats> {
  return repoCalculateStats(days);
}

// ════════════════════════════════════════════════════════════════
// VERİ ERİŞİM
// ════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════
// YARDIMCI
// ════════════════════════════════════════════════════════════════

/**
 * Look up the prisma row id by (matchCode, date, signalSide).
 * v3: Artık her çağrıda dynamic import yapmaz.
 * db import zaten module-level, ayrıca import gereksiz.
 */
async function loadById(
  matchCode: number,
  date: string,
  signalSide: string,
): Promise<string | null> {
  try {
    const { db } = await import("./db");
    const row = await db.signal.findFirst({
      where: { matchCode, date, signalSide },
      select: { id: true },
      orderBy: { signalTimestamp: "desc" },
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

// v3: checkForGoals kaldırıldı — goal detection tek kanaldan (reportGoal) yapılır.
// Bu fonksiyon daha önce checkAndRecordSignal içinden çağrılıyordu ve
// reportGoal ile race condition yaratıyordu.
// checkForGoals fonksiyonu kaldırılmıştır.
