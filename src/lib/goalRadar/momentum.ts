// ── Momentum & Shot Burst Detector ──────────────────────────────
// Tracks short-window attacking bursts to detect breakthrough moments.
// A "burst" = sustained shot/dangerous-attack volume over last 5 min
// that exceeds the match's baseline rate by a significant margin.
//
// Integrated via `computeMomentumBoost()` → returns points (0-18) + factor.

import type { PressureSnapshotLite } from './types';

/** Thresholds for burst detection */
const BURST_WINDOW_MINUTES = 5;
const DA_BURST_THRESHOLD = 3;   // DA delta over window
const SOT_BURST_THRESHOLD = 2;  // SOT delta over window
const CORNER_BURST_THRESHOLD = 2;

/** Result from momentum analysis */
export interface MomentumResult {
  homeBoost: number;
  awayBoost: number;
  homeFactors: string[];
  awayFactors: string[];
}

/**
 * Compute momentum boost from pressure history.
 * Looks at the last N snapshots (covering ~5 min of match time)
 * and detects bursts in dangerous attacks, shots on target, and corners.
 */
export function computeMomentumBoost(
  pressureHistory: PressureSnapshotLite[] | undefined,
  currentMinute: number,
): MomentumResult {
  const empty: MomentumResult = {
    homeBoost: 0, awayBoost: 0,
    homeFactors: [], awayFactors: [],
  };

  if (!pressureHistory || pressureHistory.length < 3 || currentMinute < 15) {
    return empty;
  }

  // Use at most last 12 snapshots (~5 min at 30s poll intervals)
  const window = pressureHistory.slice(-12);
  const first = window[0];
  const last = window[window.length - 1];

  const homeBoost = computeSideBoost(first, last, 'home', currentMinute);
  const awayBoost = computeSideBoost(first, last, 'away', currentMinute);

  return {
    homeBoost: homeBoost.boost,
    awayBoost: awayBoost.boost,
    homeFactors: homeBoost.factors,
    awayFactors: awayBoost.factors,
  };
}

function computeSideBoost(
  first: PressureSnapshotLite,
  last: PressureSnapshotLite,
  side: 'home' | 'away',
  _minute: number,
): { boost: number; factors: string[] } {
  const factors: string[] = [];
  let boost = 0;

  const firstDA = side === 'home'
    ? (first.stats.dangerous_attacks?.home ?? 0)
    : (first.stats.dangerous_attacks?.away ?? 0);
  const lastDA = side === 'home'
    ? (last.stats.dangerous_attacks?.home ?? 0)
    : (last.stats.dangerous_attacks?.away ?? 0);
  const daDelta = lastDA - firstDA;

  const firstSOT = side === 'home'
    ? (first.stats.shots_on_target?.home ?? 0)
    : (first.stats.shots_on_target?.away ?? 0);
  const lastSOT = side === 'home'
    ? (last.stats.shots_on_target?.home ?? 0)
    : (last.stats.shots_on_target?.away ?? 0);
  const sotDelta = lastSOT - firstSOT;

  const firstCorner = side === 'home'
    ? (first.stats.corners?.home ?? 0)
    : (first.stats.corners?.away ?? 0);
  const lastCorner = side === 'home'
    ? (last.stats.corners?.home ?? 0)
    : (last.stats.corners?.away ?? 0);
  const cornerDelta = lastCorner - firstCorner;

  // Dangerous attack burst
  if (daDelta >= DA_BURST_THRESHOLD) {
    const pts = Math.min(8, Math.round(daDelta * 1.8));
    boost += pts;
    if (pts >= 3) factors.push(`Hücum patlaması +${daDelta} (son ${BURST_WINDOW_MINUTES}dk)`);
  }

  // Shot on target burst
  if (sotDelta >= SOT_BURST_THRESHOLD) {
    const pts = Math.min(6, Math.round(sotDelta * 2.5));
    boost += pts;
    if (pts >= 3) factors.push(`Şut patlaması +${sotDelta} (son ${BURST_WINDOW_MINUTES}dk)`);
  }

  // Corner burst (set-piece pressure)
  if (cornerDelta >= CORNER_BURST_THRESHOLD) {
    const pts = Math.min(4, Math.round(cornerDelta * 1.5));
    boost += pts;
    if (pts >= 2) factors.push(`Korner patlaması +${cornerDelta} (son ${BURST_WINDOW_MINUTES}dk)`);
  }

  // Multi-indicator confirmation: if ALL three show activity, bonus
  if (daDelta >= DA_BURST_THRESHOLD && sotDelta >= SOT_BURST_THRESHOLD && cornerDelta >= 1) {
    boost += 3;
    factors.push('Tam baskı!');
  }

  // ponytail: global lock, per-side locks if throughput matters (unlikely for 30s poll)
  return { boost: Math.min(boost, 18), factors };
}
