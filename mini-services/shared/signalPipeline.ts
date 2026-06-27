// ── Real-time Signal Pipeline ──────────────────────────────────
// Shared pipeline for processing live match data from ANY source
// (WebSocket, HTTP poll, etc.). Runs signal processing chain:
//
//   Raw data → matchQuality → goalProbability → verdict → signal + thesis
//
// Imported by: mini-services/nesine-live (Socket.IO), src/app/api/cron/poll (HTTP)

import { assessMatchQuality } from '../../src/lib/matchQuality';
import { forceVerdict, type ModelVote } from '../../src/lib/signalVerdict';
import { createThesis, resolveThesis } from '../../src/lib/signalThesis';
import type { GoalSignalRecord } from '../../src/lib/goalSignalTracker';

// In-memory match state store (shared across pipeline consumers)
export interface MatchState {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  minute: string;
  homeGoals: number;
  awayGoals: number;
  stats: Record<string, { home: number | null; away: number | null }>;
  pressure: { home: number; away: number };
  lastScore: number;
  lastSigTimestamp: number;
}

const matchStates = new Map<number, MatchState>();

const SIGNAL_COOLDOWN_MS = 3 * 60 * 1000; // 3 dakika cooldown
const MATCH_STALE_MS = 30 * 60 * 1000;    // 30 dk sonra state temizle

/**
 * Process incoming match update through the signal pipeline.
 * Returns signal result if one was generated, null otherwise.
 */
export function processMatchUpdate(payload: any): {
  signalCreated: boolean;
  verdict: string;
  score: number;
} | null {
  const bid = payload.BID;
  if (!bid) return null;

  // Parse basic match info from payload
  const homeTeam = payload.HT || payload.homeTeam || '';
  const awayTeam = payload.AT || payload.awayTeam || '';
  const league = payload.L || payload.league || '';
  const minute = String(payload.M ?? payload.minute ?? '0');
  const homeGoals = (payload.ES?.[0]?.H as number) ?? payload.homeGoals ?? 0;
  const awayGoals = (payload.ES?.[0]?.A as number) ?? payload.awayGoals ?? 0;

  if (!homeTeam || !awayTeam) return null;

  // Get or create match state
  let state = matchStates.get(bid);
  if (!state) {
    state = {
      matchCode: bid,
      homeTeam,
      awayTeam,
      league,
      minute,
      homeGoals,
      awayGoals,
      stats: {},
      pressure: { home: 50, away: 50 },
      lastScore: 0,
      lastSigTimestamp: 0,
    };
    matchStates.set(bid, state);
  }

  // Update state
  state.minute = minute;
  state.homeGoals = homeGoals;
  state.awayGoals = awayGoals;
  if (payload.SE) {
    const { parseStats } = require('../shared/nesineLiveTypes');
    state.stats = parseStats(payload.SE);
  }

  // Cooldown check: aynı maç için son 3dk'da sinyal oluştuysa atla
  const now = Date.now();
  if (now - state.lastSigTimestamp < SIGNAL_COOLDOWN_MS) {
    return null;
  }

  // ── Match Quality Funnel ──
  const quality = assessMatchQuality({
    matchCode: bid,
    homeTeam,
    awayTeam,
    league,
    activeSources: ['nesine', 'netscores'],
  });
  if (!quality.passFunnel) return null;

  // ── Basit skor hesaplama (tam goalRadar hesaplaması için cron poll gerekli) ──
  // Burada basit bir pressure-based skor kullanıyoruz.
  // Tam hesaplama için calculateGoalProbability çağrılmalı (cron poll'da).
  const pressureScore = Math.round(
    state.pressure.home * 0.4 + calculateThreatFromStats(state.stats) * 0.6
  );

  if (pressureScore < 50) return null;

  // ── Force Verdict ──
  const models: ModelVote[] = [
    { name: 'pressure', probability: pressureScore / 100, confidence: 0.7 },
    { name: 'momentum', probability: Math.min(0.8, (pressureScore - 30) / 100), confidence: 0.6 },
  ];
  const verdict = forceVerdict(models);

  if (verdict.tier === 'SKIP') return null;

  // ── Thesis kaydet (cooldown için timestamp güncelle) ──
  state.lastScore = pressureScore;
  state.lastSigTimestamp = now;

  createThesis({
    matchCode: bid,
    homeTeam,
    awayTeam,
    league,
    predictedSide: 'home',
    predictedMinuteRange: [Math.max(0, parseInt(minute) - 5), Math.min(90, parseInt(minute) + 10)],
    predictedProbability: verdict.probability,
    expectedScore: pressureScore,
    tier: verdict.tier,
    keyFactors: ['pressure', 'momentum'],
    dominantModels: ['pressure', 'momentum'],
    dataSourceGrade: quality.sourceQuality,
  });

  return {
    signalCreated: true,
    verdict: verdict.tier,
    score: pressureScore,
  };
}

function calculateThreatFromStats(stats: Record<string, { home: number | null; away: number | null }>): number {
  let threat = 50;
  const da = stats.dangerous_attacks;
  const sot = stats.shots_on_target;
  const corners = stats.corners;

  if (da && da.home != null && da.away != null) {
    const total = da.home + da.away;
    if (total > 0) threat += ((da.home / total) - 0.5) * 40;
  }
  if (sot && sot.home != null && sot.away != null) {
    const total = sot.home + sot.away;
    if (total > 0) threat += ((sot.home / total) - 0.5) * 30;
  }
  if (corners && corners.home != null && corners.away != null) {
    const total = corners.home + corners.away;
    if (total > 0) threat += ((corners.home / total) - 0.5) * 20;
  }

  return Math.max(0, Math.min(100, threat));
}

/**
 * Periyodik temizlik: stale match state'leri sil
 */
export function cleanupStaleStates(): void {
  const cutoff = Date.now() - MATCH_STALE_MS;
  for (const [key, state] of matchStates) {
    if (state.lastSigTimestamp < cutoff) {
      matchStates.delete(key);
    }
  }
}

// Timer: her 10dk'da stale state temizle
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupStaleStates, 10 * 60 * 1000);
}

export { matchStates };
