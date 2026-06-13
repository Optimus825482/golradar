// ── Historical Backtest Simulator ───────────────────────────────────
// Replays finished matches using Scoremer HT/FT stats + Goaloo momentum
// to simulate the Goal Radar signal detection and measure accuracy.
//
// Priority for snapshot generation:
//   1. Goaloo real momentum data (per-minute attack intensities) — BEST
//   2. Synthetic snapshots from Scoremer HT/FT stats — FALLBACK
//
// This module handles ONLY the simulation logic.
// Data fetching (Nesine, Scoremer, Goaloo) is done by the API route before
// calling the simulator, to avoid complex import chains that crash
// the Next.js Turbopack compiler.

import { generateSyntheticSnapshots, type PressureSnapshot } from './advancedAnalytics';
import { calculateGoalProbability, type MatchStats, type PressureSnapshotLite } from './nesine';
import {
  checkAndRecordSignal,
  finalizeMatchSignals,
  calculateSignalStats,
} from './goalSignalTracker';
import { runBacktest, type BacktestResult, type BacktestConfig } from './backtestEngine';

// ── Types ────────────────────────────────────────────────────────

export interface SimulationConfig {
  daysBack?: number;
  minMatches?: number;
  maxMatches?: number;
  signalThreshold?: number;
  date?: string;
}

export interface SimulationProgress {
  total: number;
  processed: number;
  signalsRecorded: number;
  goalsDetected: number;
  matchesWithStats: number;
  matchesWithoutStats: number;
  matchesWithGoalooMomentum: number;
  matchesWithOddsMovement: number;
  errors: number;
  currentMatch: string | null;
  percentComplete: number;
  elapsedMs: number;
}

export interface SimulationResult {
  success: boolean;
  config: SimulationConfig;
  progress: SimulationProgress;
  matchResults: MatchSimulationResult[];
  signalStats: ReturnType<typeof calculateSignalStats> | null;
  backtestResult: BacktestResult | null;
  error?: string;
}

export interface MatchSimulationResult {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  homeScore: number;
  awayScore: number;
  htHomeScore: number;
  htAwayScore: number;
  signalsDetected: number;
  goalsAfterSignal: number;
  correctSidePredictions: number;
  snapshotsAnalyzed: number;
  hadStats: boolean;
  usedGoalooMomentum: boolean;
  hadOddsMovement: boolean;
  oddsSignificance: string;
  error?: string;
}

// Input match data (fetched by API route and passed to simulator)
export interface SimInputMatch {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  time: string;
  homeScore: number;
  awayScore: number;
  htScore: string;       // "1:0" or "-"
  ftStats: Record<string, { home: number | null; away: number | null }>;
  htStats: Record<string, { home: number | null; away: number | null }> | null;
  // ── Goaloo enrichment fields (optional) ──
  goalooMomentum?: {
    matchId: number;
    homeIntensities: number[];
    awayIntensities: number[];
    homeGoalMinutes: number[];
    awayGoalMinutes: number[];
    homeRedCardMinutes: number[];
    awayRedCardMinutes: number[];
    totalMinutes: number;
  } | null;
  goalooEvents?: Array<{
    id: number;
    minute: number;
    type: 'goal' | 'yellow_card' | 'red_card' | 'substitution';
    team: 'home' | 'away';
    player: string;
    detail: string;
  }> | null;
  goalooOddsMovement?: {
    matchId: number;
    homeWinDrop: number;
    awayWinDrop: number;
    overDrop: number;
    significance: string;
    homeBoost: number;
    awayBoost: number;
  } | null;
}

// ── In-memory state for progress tracking ──────────────────────

let currentProgress: SimulationProgress | null = null;
let isSimulating = false;

function getSimulationProgress(): SimulationProgress | null {
  return currentProgress;
}

function isSimulationRunning(): boolean {
  return isSimulating;
}

// ── Convert Goaloo momentum data to PressureSnapshot format ──

function convertGoalooMomentumToSnapshots(
  momentum: NonNullable<SimInputMatch['goalooMomentum']>,
  events: SimInputMatch['goalooEvents'],
  homeScore: number,
  awayScore: number,
  ftStats: Record<string, { home: number | null; away: number | null }>,
  htStats: Record<string, { home: number | null; away: number | null }> | null,
  htHomeScore: number,
  htAwayScore: number,
): PressureSnapshot[] {
  const snapshots: PressureSnapshot[] = [];
  const totalMinutes = momentum.totalMinutes || 90;

  // Goal minutes from momentum + events
  const homeGoalMins = new Set(momentum.homeGoalMinutes || []);
  const awayGoalMins = new Set(momentum.awayGoalMinutes || []);
  if (events) {
    for (const evt of events) {
      if (evt.type === 'goal') {
        if (evt.team === 'home') homeGoalMins.add(evt.minute);
        else awayGoalMins.add(evt.minute);
      }
    }
  }

  // Cumulative goal tracking
  let cumHomeGoals = 0;
  let cumAwayGoals = 0;

  // Find max intensity for pressure normalization
  const maxIntensity = Math.max(
    ...momentum.homeIntensities.slice(0, totalMinutes),
    ...momentum.awayIntensities.slice(0, totalMinutes),
    5
  );

  for (let min = 1; min <= totalMinutes; min++) {
    const idx = min - 1;
    const homeIntensity = idx < momentum.homeIntensities.length ? momentum.homeIntensities[idx] : 0;
    const awayIntensity = idx < momentum.awayIntensities.length ? momentum.awayIntensities[idx] : 0;

    if (homeGoalMins.has(min)) cumHomeGoals++;
    if (awayGoalMins.has(min)) cumAwayGoals++;

    // Convert intensity to pressure (0-100)
    const homePressure = Math.min(100, Math.round((homeIntensity / maxIntensity) * 85 + 8));
    const awayPressure = Math.min(100, Math.round((awayIntensity / maxIntensity) * 85 + 8));

    // Interpolate stats from FT/HT if available
    const stats: Record<string, { home: number | null; away: number | null }> = {};
    if (ftStats && Object.keys(ftStats).length > 0) {
      const is1h = min <= 45;
      const halfMin = is1h ? min : min - 45;
      const halfTotal = 45;
      const ratio = halfMin / halfTotal;
      const targetStats = is1h
        ? (htStats && Object.keys(htStats).length > 0 ? htStats : ftStats)
        : ftStats;

      for (const [key, val] of Object.entries(targetStats)) {
        if (!val) continue;
        const targetHome = val.home ?? 0;
        const targetAway = val.away ?? 0;

        if (is1h || key === 'possession') {
          stats[key] = {
            home: Math.round(targetHome * ratio * 10) / 10,
            away: Math.round(targetAway * ratio * 10) / 10,
          };
        } else {
          const baseHome = htStats?.[key]?.home ?? 0;
          const baseAway = htStats?.[key]?.away ?? 0;
          stats[key] = {
            home: Math.round((baseHome + (targetHome - baseHome) * ratio) * 10) / 10,
            away: Math.round((baseAway + (targetAway - baseAway) * ratio) * 10) / 10,
          };
        }
      }
    }

    snapshots.push({
      minute: `${min}'`,
      timestamp: Date.now() - (totalMinutes - min) * 60000,
      homePressure,
      awayPressure,
      stats,
      homeGoals: cumHomeGoals,
      awayGoals: cumAwayGoals,
    });
  }

  return snapshots;
}

// ── Main Simulation Function ───────────────────────────────────

export async function runHistoricalSimulation(
  matches: SimInputMatch[],
  config: SimulationConfig = {}
): Promise<SimulationResult> {
  if (isSimulating) {
    return {
      success: false,
      config,
      progress: currentProgress!,
      matchResults: [],
      signalStats: null,
      backtestResult: null,
      error: 'Simulation already running',
    };
  }

  isSimulating = true;
  const startTime = Date.now();
  const { signalThreshold = 55 } = config;

  // Initialize progress
  currentProgress = {
    total: matches.length,
    processed: 0,
    signalsRecorded: 0,
    goalsDetected: 0,
    matchesWithStats: 0,
    matchesWithoutStats: 0,
    matchesWithGoalooMomentum: 0,
    matchesWithOddsMovement: 0,
    errors: 0,
    currentMatch: null,
    percentComplete: 0,
    elapsedMs: 0,
  };

  const matchResults: MatchSimulationResult[] = [];

  try {
    // ── Process each match ──
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      currentProgress.currentMatch = `${match.homeTeam} vs ${match.awayTeam}`;
      currentProgress.percentComplete = Math.round((i / matches.length) * 100);
      currentProgress.elapsedMs = Date.now() - startTime;

      const result = await simulateSingleMatch(match, signalThreshold);
      matchResults.push(result);

      if (result.hadStats) {
        currentProgress.matchesWithStats++;
      } else {
        currentProgress.matchesWithoutStats++;
      }
      if (result.usedGoalooMomentum) {
        currentProgress.matchesWithGoalooMomentum++;
      }
      if (result.hadOddsMovement) {
        currentProgress.matchesWithOddsMovement++;
      }
      currentProgress.signalsRecorded += result.signalsDetected;
      currentProgress.goalsDetected += result.goalsAfterSignal;
      currentProgress.processed++;

      if (result.error) {
        currentProgress.errors++;
      }

      // Yield to event loop every 5 matches to prevent blocking
      if (i % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    // ── Calculate stats and run backtest ──
    let signalStats: ReturnType<typeof calculateSignalStats> | null = null;
    let backtestResult: BacktestResult | null = null;

    try {
      signalStats = calculateSignalStats(config.daysBack ? config.daysBack + 1 : 8);
    } catch (err) {
      console.error('[BacktestSim] Signal stats calculation failed:', err);
    }

    try {
      const btConfig: BacktestConfig = {};
      if (config.date) {
        btConfig.startDate = config.date;
      } else if (config.daysBack) {
        const start = new Date(Date.now() - (config.daysBack + 1) * 24 * 60 * 60 * 1000);
        btConfig.startDate = start.toISOString().slice(0, 10);
      }
      backtestResult = runBacktest(btConfig);
    } catch (err) {
      console.error('[BacktestSim] Backtest calculation failed:', err);
    }

    currentProgress.percentComplete = 100;
    currentProgress.elapsedMs = Date.now() - startTime;
    currentProgress.currentMatch = null;

    console.log(
      `[BacktestSim] Complete! ${currentProgress.processed} matches, ` +
      `${currentProgress.signalsRecorded} signals, ` +
      `${currentProgress.goalsDetected} goals after signal, ` +
      `${currentProgress.matchesWithStats} with stats, ` +
      `${currentProgress.matchesWithGoalooMomentum} with Goaloo momentum, ` +
      `${currentProgress.matchesWithOddsMovement} with odds movement`
    );

    return {
      success: true,
      config,
      progress: currentProgress,
      matchResults,
      signalStats,
      backtestResult,
    };
  } catch (error: any) {
    console.error('[BacktestSim] Fatal error:', error);
    return {
      success: false,
      config,
      progress: currentProgress!,
      matchResults,
      signalStats: null,
      backtestResult: null,
      error: error.message,
    };
  } finally {
    isSimulating = false;
  }
}

// ── Simulate a single match ────────────────────────────────────

async function simulateSingleMatch(
  match: SimInputMatch,
  signalThreshold: number,
): Promise<MatchSimulationResult> {
  const result: MatchSimulationResult = {
    matchCode: match.matchCode,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    league: match.league,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    htHomeScore: 0,
    htAwayScore: 0,
    signalsDetected: 0,
    goalsAfterSignal: 0,
    correctSidePredictions: 0,
    snapshotsAnalyzed: 0,
    hadStats: false,
    usedGoalooMomentum: false,
    hadOddsMovement: false,
    oddsSignificance: 'none',
  };

  try {
    // Parse HT score
    if (match.htScore && match.htScore !== '-') {
      const parts = match.htScore.split(/[-:]/);
      if (parts.length === 2) {
        result.htHomeScore = parseInt(parts[0], 10) || 0;
        result.htAwayScore = parseInt(parts[1], 10) || 0;
      }
    }

    // Check if stats are available
    if (!match.ftStats || Object.keys(match.ftStats).length === 0) {
      return result;
    }

    result.hadStats = true;

    // ── Generate snapshots ──
    // Priority 1: Goaloo real momentum data (per-minute attack intensities)
    // Priority 2: Synthetic snapshots from Scoremer HT/FT stats
    let snapshots: PressureSnapshot[];

    if (match.goalooMomentum && match.goalooMomentum.homeIntensities.length > 0) {
      // Use REAL Goaloo momentum data — much more accurate than synthetic
      snapshots = convertGoalooMomentumToSnapshots(
        match.goalooMomentum,
        match.goalooEvents ?? null,
        match.homeScore,
        match.awayScore,
        match.ftStats,
        match.htStats,
        result.htHomeScore,
        result.htAwayScore,
      );
      result.usedGoalooMomentum = true;
      console.log(
        `[BacktestSim] Using Goaloo momentum for ${match.homeTeam} vs ${match.awayTeam} ` +
        `(${snapshots.length} per-minute snapshots)`
      );
    } else {
      // Fallback: Generate synthetic snapshots from Scoremer data
      snapshots = generateSyntheticSnapshots(
        match.ftStats,
        match.htStats,
        match.homeScore,
        match.awayScore,
        match.htScore || undefined
      );
    }

    if (snapshots.length === 0) {
      return result;
    }

    // ── Check for odds movement enrichment ──
    let oddsHomeBoost = 0;
    let oddsAwayBoost = 0;
    if (match.goalooOddsMovement && match.goalooOddsMovement.significance !== 'none') {
      result.hadOddsMovement = true;
      result.oddsSignificance = match.goalooOddsMovement.significance;
      oddsHomeBoost = match.goalooOddsMovement.homeBoost || 0;
      oddsAwayBoost = match.goalooOddsMovement.awayBoost || 0;
    }

    // ── Simulate signal detection at each snapshot ──
    const pressureHistory: PressureSnapshotLite[] = [];

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const minuteStr = snap.minute;
      const minNum = parseInt(minuteStr.replace(/[^0-9]/g, ''), 10) || i * 5;

      result.snapshotsAnalyzed++;

      // Build pressure history for cooldown detection
      pressureHistory.push({
        homePressure: snap.homePressure,
        awayPressure: snap.awayPressure,
        stats: snap.stats,
        homeGoals: snap.homeGoals,
        awayGoals: snap.awayGoals,
      });

      // Run goal probability calculation
      const prob = calculateGoalProbability(
        snap.stats,
        minuteStr,
        true, // isLive
        pressureHistory,
        snap.homeGoals,
        snap.awayGoals,
        match.homeTeam,
        match.awayTeam,
      );

      // Apply odds movement boost (F13) if available
      let adjustedHomeScore = prob.homeScore;
      let adjustedAwayScore = prob.awayScore;
      let adjustedScore = prob.score;
      let oddsFactor = '';

      if (oddsHomeBoost > 0 || oddsAwayBoost > 0) {
        adjustedHomeScore = Math.min(100, adjustedHomeScore + oddsHomeBoost);
        adjustedAwayScore = Math.min(100, adjustedAwayScore + oddsAwayBoost);
        adjustedScore = Math.max(adjustedHomeScore, adjustedAwayScore);

        if (oddsHomeBoost > 0) oddsFactor = `Oran düşüşü ev +${oddsHomeBoost}`;
        if (oddsAwayBoost > 0) oddsFactor = `Oran düşüşü dep +${oddsAwayBoost}`;
      }

      // Check if signal threshold is met
      if (adjustedScore >= signalThreshold && prob.side && prob.side !== 'both') {
        // Record signal via the same tracker used for live matches
        const factors = [...prob.factors];
        if (oddsFactor) factors.push(oddsFactor);

        const signal = await checkAndRecordSignal(
          match.matchCode,
          match.homeTeam,
          match.awayTeam,
          match.league,
          match.time,
          minuteStr,
          {
            score: adjustedScore,
            homeScore: adjustedHomeScore,
            awayScore: adjustedAwayScore,
            side: prob.side,
            level: prob.level,
            factors,
            calibratedP: prob.calibratedP,
            poissonP: prob.poissonP,
          },
          snap.homeGoals ?? 0,
          snap.awayGoals ?? 0,
        );

        if (signal) {
          result.signalsDetected++;

          // Check if a goal happens after this signal in subsequent snapshots
          for (let j = i + 1; j < snapshots.length; j++) {
            const futureSnap = snapshots[j];
            const prevSnap = snapshots[j - 1];
            const homeGoalScored = (futureSnap.homeGoals ?? 0) > (prevSnap.homeGoals ?? 0);
            const awayGoalScored = (futureSnap.awayGoals ?? 0) > (prevSnap.awayGoals ?? 0);

            if (homeGoalScored || awayGoalScored) {
              result.goalsAfterSignal++;
              const goalSide = homeGoalScored ? 'home' : 'away';
              if (goalSide === prob.side) {
                result.correctSidePredictions++;
              }
              break; // Only count the first goal after signal
            }
          }
        }
      }
    }

    // Finalize match signals
    await finalizeMatchSignals(match.matchCode, match.homeScore, match.awayScore);
  } catch (err: any) {
    result.error = err.message;
  }

  return result;
}
