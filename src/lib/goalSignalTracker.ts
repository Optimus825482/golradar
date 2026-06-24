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
  findAllPendingForMatch as repoFindAllPending,
  getAvailableDates as repoGetDates,
  calculateSignalStats as repoCalculateStats,
  updateVerification as repoUpdateVerification,
  updateVerificationBatch as repoUpdateVerificationBatch,
  expirePendingBatch as repoExpirePendingBatch,
  expirePendingBatchForCodes as repoExpirePendingBatchForCodes,
  expireHalftimeBatch as repoExpireHalftimeBatch,
  finalizeMatchBatch as repoFinalizeMatchBatch,
} from "./signalRepository";

import {
  SIGNAL_THRESHOLD,
  SIGNAL_EXPIRY_MINUTES,
  EXPIRY_CHECK_INTERVAL_MS,
  SIGNAL_COOLDOWN_MS,
} from "@/config";
import { db } from "./db";
import { loadExcludedMinutes, isExcludedMinute } from "./excludedMinutes";

// ── Local date helper ────────────────────────────────────
export const getLocalDateString = (d: Date = new Date()): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// ── Proper minute parser (handles "45+2" → 47) ──────────────
export function parseMinute(minute: string | number): number {
  if (typeof minute === 'number') return Math.max(0, Math.min(120, minute));
  const plusMatch = minute.match(/^(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) {
    // Stoppage time: clamp sum to [0, 120] (matches numeric branch below)
    const total = parseInt(plusMatch[1], 10) + parseInt(plusMatch[2], 10);
    return Math.max(0, Math.min(120, total));
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

// ── Internal state ─────────────────────────────────────────────
// Faz 2 — cooldown state artık DB-tabanlı (Signal.lastSignalTimestamp
// üzerinden). Eski in-memory activeMatches Map'i ve ActiveMatchState
// interface'i kaldırıldı; kullanım noktaları repoFindExisting ile
// hesaplanıyor. lastKnownHomeGoals/AwayGoals'a gerek kalmadı — gol
// sayısı zaten Signal.currentHomeGoals / currentAwayGoals'ta DB'de.

// ── Constants ──────────────────────────────────────────────────
// SIGNAL_THRESHOLD / SIGNAL_EXPIRY_MINUTES / EXPIRY_CHECK_INTERVAL_MS /
// SIGNAL_COOLDOWN_MS config'den import edilir (src/config.ts).

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

  // ── Signal threshold checks ───────────────────────────────────
  if (goalProbability.score < SIGNAL_THRESHOLD) return null;
  if (!goalProbability.side || goalProbability.side === "both") return null;

  // ── Excluded minute zones ─────────────────────────────────────
  // Faz 9 — DB backed (excludedMinutes.ts), cache TTL 5dk. Config
  // default fallback.
  const sigMin = parseMinute(minute);
  const excludedZones = await loadExcludedMinutes();
  if (isExcludedMinute(sigMin, excludedZones)) return null;

  const signalSide = goalProbability.side as "home" | "away";

  // ── Cooldown check: Aynı match+side için son 3 dk içinde sinyal oluşturuldu mu? ──
  // Faz 2 — DB-tabanlı: önce repoFindExisting ile fetch et, sonra lastSignalTimestamp
  // üzerinden cooldown kontrolü yap. Aktif pending sinyal varsa updateLastValues.
  const existingForCooldown = await repoFindExisting(matchCode, today, signalSide);
  if (existingForCooldown?.lastSignalTimestamp) {
    const lastMs = existingForCooldown.lastSignalTimestamp;
    if (now - lastMs < SIGNAL_COOLDOWN_MS) {
      if (existingForCooldown.goalHappened === null) {
        await repoUpdateLastValues(existingForCooldown.id!, {
          lastScore: goalProbability.score,
          lastCalibratedP: goalProbability.calibratedP,
          lastPoissonP: goalProbability.poissonP,
          lastFactors: goalProbability.factors,
          lastSignalTimestamp: now,
        });
      }
      return null;
    }
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
  // Cooldown artık DB'de: oluşturulan kaydın lastSignalTimestamp'ı bir sonraki
  // checkAndRecordSignal çağrısında repoFindExisting ile okunur.
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
  // Önce pending sinyalleri oku (batch update onları null→true yapmadan)
  const allPending = await repoFindAllPending(matchCode);
  const withId = allPending.filter((s): s is GoalSignalRecord & { id: string } => !!s.id);

  // Batch: ortak alanları tek updateMany ile yaz (goalHappened/goalMinute/goalSide/timestamp)
  await repoUpdateVerificationBatch(matchCode, {
    goalHappened: true,
    goalMinute,
    goalSide,
    goalTimestamp: Date.now(),
  });

  // Satır-bazlı correctPrediction + minutesAfterSignal'i paralel yaz
  await Promise.all(
    withId.map((s) =>
      repoUpdateVerification(s.id, {
        goalHappened: true,
        goalMinute,
        goalSide,
        correctPrediction: goalSide === s.signalSide,
        minutesAfterSignal: Math.max(0, goalMinute - s.signalMinute),
        goalTimestamp: Date.now(),
      }),
    ),
  );
}

// ════════════════════════════════════════════════════════════════
// SİNYAL SÜRE DOLUMU (EXPIRY)
// ════════════════════════════════════════════════════════════════

/**
 * Expire any pending signals that have been waiting longer than SIGNAL_EXPIRY_MINUTES.
 */
async function expireStaleSignals(): Promise<number> {
  // Faz 3 — tek updateMany. signalRepository.expirePendingBatch import
  // edildi mi kontrolü aşağıda.
  const expiryMs = SIGNAL_EXPIRY_MINUTES * 60 * 1000;
  const cutoff = new Date(Date.now() - expiryMs);
  return repoExpirePendingBatch(cutoff);
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
  // Faz 3 — tek updateMany: tüm halftime maçlarının pending'leri (signalMinute >= 41)
  // tek sorguda expire edilir. SIGNAL_EXPIRY_MINUTES DB-side sabit.
  return repoExpireHalftimeBatch(Array.from(halftimeMatchCodes));
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
  const stillPending = await db.signal.count({ where: { goalHappened: null } });
  return { total: expired, expired, stillPending };
}

// ════════════════════════════════════════════════════════════════
// BACKGROUND EXPIRY CHECKER
// ════════════════════════════════════════════════════════════════

let expiryInterval: ReturnType<typeof setInterval> | null = null;
let expiryStarted = false;

/**
 * Start the background expiry checker. Runs every EXPIRY_CHECK_INTERVAL_MS.
 *
 * Idempotent and process-global: hot-reload and multiple importers can
 * call this freely; only the first call attaches an interval. The
 * interval handle lives on globalThis so even if the module is
 * re-evaluated (Next.js dev fast refresh, serverless cold start
 * reusing the worker), we never end up with two loops.
 *
 * Server-only — guarded inline so this module stays safe to import
 * from any code path without accidentally registering intervals in
 * the client bundle.
 */
export function startExpiryChecker(): void {
  if (typeof window !== "undefined") return; // client-side guard
  if (expiryStarted) return;

  const g = globalThis as unknown as { __golradarExpiryInterval?: ReturnType<typeof setInterval> };
  if (g.__golradarExpiryInterval) {
    expiryInterval = g.__golradarExpiryInterval;
    expiryStarted = true;
    return;
  }

  const handle = setInterval(async () => {
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

  // Detach on shutdown so Node can exit cleanly.
  if (typeof handle.unref === 'function') handle.unref();

  expiryInterval = handle;
  g.__golradarExpiryInterval = handle;
  expiryStarted = true;
}

/**
 * Stop the background expiry checker. Useful for tests and graceful
 * shutdown hooks. Safe to call when no checker is running.
 */
export function stopExpiryChecker(): void {
  if (!expiryInterval) return;
  clearInterval(expiryInterval);
  expiryInterval = null;
  expiryStarted = false;
  const g = globalThis as unknown as { __golradarExpiryInterval?: ReturnType<typeof setInterval> };
  g.__golradarExpiryInterval = undefined;
}

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
  // Faz 3 — tek batch + paralel satır-bazlı. Pending'ler için iki paralel
  // updateVerification + updateFinalScore tek satırda; resolved'ler için
  // sadece final score backfill.
  await Promise.all([
    repoUpdateVerificationBatch(matchCode, {
      goalHappened: false,
      minutesAfterSignal: SIGNAL_EXPIRY_MINUTES,
    }),
    repoFinalizeMatchBatch(matchCode, homeScore, awayScore),
  ]);
}

// ════════════════════════════════════════════════════════════════
// TEMİZLİK
// ════════════════════════════════════════════════════════════════

/**
 * Remove stale matches from active tracking.
 *
 * Implementation: önce aktif maç dışındaki matchCode'ları DB'den oku,
 * sonra repoExpirePendingBatch ile expirePendingBatch'i matchCode
 * filtresi ile çağır. Repository katmanını BYPASS etmeden tek satır
 * update yapılır.
 */
export async function cleanupStaleSignals(
  activeMatchCodes: number[],
): Promise<void> {
  // Faz 3 — DB-tabanlı + tek batch: aktif listede OLMAYAN maçlardaki pending
  // sinyalleri tek updateMany ile expire et. JS tarafı yalnızca filtreleme.
  const activeSet = new Set(activeMatchCodes);
  const distinctCodes = await db.signal.findMany({
    where: { goalHappened: null },
    select: { matchCode: true },
    distinct: ['matchCode'],
  });
  const staleCodes = distinctCodes.map((r) => r.matchCode).filter((c) => !activeSet.has(c));
  if (staleCodes.length === 0) return;
  // Repo katmanı: expirePendingBatch zaten updateMany ile pending'leri expire
  // ediyor; burada staleCodes filtresi ekliyoruz (DB-side).
  await repoExpirePendingBatchForCodes(staleCodes);
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

// v3: checkForGoals kaldırıldı — goal detection tek kanaldan (reportGoal) yapılır.
// Bu fonksiyon daha önce checkAndRecordSignal içinden çağrılıyordu ve
// reportGoal ile race condition yaratıyordu.
// checkForGoals fonksiyonu kaldırılmıştır.
