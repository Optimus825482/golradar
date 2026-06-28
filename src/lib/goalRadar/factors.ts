// ── Goal Radar Factor Functions ──────────────────────────────────
// Her faktör bağımsız, test edilebilir fonksiyon. calculateGoalProbability
// bunları sırayla çağırır, sonuçları toplar.

import type { MatchStats, PressureSnapshotLite } from '../nesineTypes';
import type { GoalooEnrichment } from '../goalRadar';
import { estimateXgFromShots } from '../estimateXg';
import { calibrateF8Sync, loadCalibrationModeSync } from '../smartCalibration';
import type { MatchIntelligence } from '../fotmobIntelligence';
import { calculatePressure } from '../nesineTypes';

// ── Shared types ────────────────────────────────────────────────
export interface FactorContext {
  stats: MatchStats;
  minNum: number;
  pressureHistory?: PressureSnapshotLite[];
  currentHomeGoals?: number;
  currentAwayGoals?: number;
  homeTeam?: string;
  awayTeam?: string;
  leagueId?: number | null;
  oddsMovementBoost?: { homeBoost: number; awayBoost: number; significance: string } | null;
  goalooData?: GoalooEnrichment | null;
  fotmobData?: import('../fotmob').FotMobMatchDetails | null;
}

export interface FactorResult {
  homePts: number;
  awayPts: number;
  homeFactors: string[];
  awayFactors: string[];
  sharedFactors: string[];
}

const noResult = (): FactorResult => ({ homePts: 0, awayPts: 0, homeFactors: [], awayFactors: [], sharedFactors: [] });

// ── F1: Pressure dominance ──────────────────────────────────────
export function calcFactorPressure(stats: MatchStats): FactorResult {
  const pressure = calculatePressure(stats);
  const r: FactorResult = noResult();
  if (pressure.home > 55) {
    const pts = Math.min(8, Math.round((pressure.home - 50) * 0.65));
    r.homePts = pts;
    if (pts >= 5) r.homeFactors.push(`Baskı ${pressure.home}%`);
  }
  if (pressure.away > 55) {
    const pts = Math.min(8, Math.round((pressure.away - 50) * 0.65));
    r.awayPts = pts;
    if (pts >= 5) r.awayFactors.push(`Baskı ${pressure.away}%`);
  }
  return r;
}

// ── F2: Dangerous attack rate ───────────────────────────────────
export function calcFactorDangerousAttack(stats: MatchStats, minNum: number): FactorResult {
  const dangerAttacks = stats.dangerous_attacks;
  const r: FactorResult = noResult();
  if (dangerAttacks?.home != null) {
    const rate = (dangerAttacks.home / Math.max(1, minNum)) * 15;
    if (rate >= 1.5) {
      r.homePts = Math.min(10, Math.round(rate * 3.5));
      r.homeFactors.push(`Tehl. hücum ${rate.toFixed(1)}/15dk`);
    }
  }
  if (dangerAttacks?.away != null) {
    const rate = (dangerAttacks.away / Math.max(1, minNum)) * 15;
    if (rate >= 1.5) {
      r.awayPts = Math.min(14, Math.round(rate * 3.5));
      r.awayFactors.push(`Tehl. hücum ${rate.toFixed(1)}/15dk`);
    }
  }
  return r;
}

// ── F3: Shot quality + xG ───────────────────────────────────────
export function calcFactorShotQuality(
  stats: MatchStats, minNum: number,
  xg: { home: number; away: number },
): FactorResult {
  const shotsOnTarget = stats.shots_on_target;
  const r: FactorResult = noResult();
  const homeSotCount = shotsOnTarget?.home ?? 0;
  const awaySotCount = shotsOnTarget?.away ?? 0;
  const homeSotRate = (homeSotCount / Math.max(1, minNum)) * 15;
  const awaySotRate = (awaySotCount / Math.max(1, minNum)) * 15;

  if (shotsOnTarget?.home != null && shotsOnTarget.home >= 1) {
    let pts = Math.min(6, Math.round(homeSotRate * 2.0));
    if (homeSotRate >= 1.5) pts += Math.min(4, Math.round((homeSotRate - 1.0) * 3));
    r.homePts = pts;
    if (pts >= 5) r.homeFactors.push(`${shotsOnTarget.home} isabetli şut (${homeSotRate.toFixed(1)}/15dk)`);
  }
  if (shotsOnTarget?.away != null && shotsOnTarget.away >= 1) {
    let pts = Math.min(6, Math.round(awaySotRate * 2.0));
    if (awaySotRate >= 1.5) pts += Math.min(4, Math.round((awaySotRate - 1.0) * 3));
    r.awayPts = pts;
    if (pts >= 5) r.awayFactors.push(`${shotsOnTarget.away} isabetli şut (${awaySotRate.toFixed(1)}/15dk)`);
  }
  return r;
}

// ── xG hesaplama (yardımcı) ─────────────────────────────────────
export function calcExpectedGoals(stats: MatchStats, minNum: number): { home: number; away: number } {
  const shotsOnTarget = stats.shots_on_target;
  const homeSotCount = shotsOnTarget?.home ?? 0;
  const awaySotCount = shotsOnTarget?.away ?? 0;
  const homeShotsTotal = stats.shots_total?.home ?? 0;
  const awayShotsTotal = stats.shots_total?.away ?? 0;
  const homeBlocked = stats.shots_blocked?.home ?? 0;
  const awayBlocked = stats.shots_blocked?.away ?? 0;
  const homeOffTarget = Math.max(0, homeShotsTotal - homeSotCount - homeBlocked);
  const awayOffTarget = Math.max(0, awayShotsTotal - awaySotCount - awayBlocked);
  const apiXg = stats.xg;
  const dangerAttacks = stats.dangerous_attacks;
  return {
    home: apiXg?.home != null && apiXg.home > 0
      ? apiXg.home
      : homeSotCount * 0.38 + homeOffTarget * 0.05 + homeBlocked * 0.03 + (stats.corners?.home ?? 0) * 0.04 + (dangerAttacks?.home ?? 0) * 0.01,
    away: apiXg?.away != null && apiXg.away > 0
      ? apiXg.away
      : awaySotCount * 0.38 + awayOffTarget * 0.05 + awayBlocked * 0.03 + (stats.corners?.away ?? 0) * 0.04 + (dangerAttacks?.away ?? 0) * 0.01,
  };
}

// ── F4: xG accumulation ─────────────────────────────────────────
export function calcFactorXgAccumulation(xg: { home: number; away: number }, minNum: number): FactorResult {
  const r: FactorResult = noResult();
  if (xg.home > 0.3) {
    const xgPts = Math.min(7, Math.round(xg.home * 7));
    const xgRate = (xg.home / Math.max(1, minNum)) * 15;
    const velocityPts = xgRate > 0.3 ? Math.min(4, Math.round(xgRate * 4)) : 0;
    r.homePts = xgPts + velocityPts;
    r.homeFactors.push(`xG birikim ${xg.home.toFixed(2)} (${xgRate.toFixed(2)}/15dk)`);
  }
  if (xg.away > 0.3) {
    const xgPts = Math.min(7, Math.round(xg.away * 7));
    const xgRate = (xg.away / Math.max(1, minNum)) * 15;
    const velocityPts = xgRate > 0.3 ? Math.min(4, Math.round(xgRate * 4)) : 0;
    r.awayPts = xgPts + velocityPts;
    r.awayFactors.push(`xG birikim ${xg.away.toFixed(2)} (${xgRate.toFixed(2)}/15dk)`);
  }
  return r;
}

// ── F5: Stat spike detection ────────────────────────────────────
export function calcFactorSpikeDetection(pressureHistory: PressureSnapshotLite[]): FactorResult {
  if (pressureHistory.length < 3) return noResult();
  const r: FactorResult = noResult();
  const current = pressureHistory[pressureHistory.length - 1];
  const compareIdx = Math.max(0, pressureHistory.length - 4);
  const previous = pressureHistory[compareIdx];

  const homeDADelta = (current.stats.dangerous_attacks?.home ?? 0) - (previous.stats.dangerous_attacks?.home ?? 0);
  const awayDADelta = (current.stats.dangerous_attacks?.away ?? 0) - (previous.stats.dangerous_attacks?.away ?? 0);
  const homeShotDelta = (current.stats.shots_on_target?.home ?? 0) - (previous.stats.shots_on_target?.home ?? 0);
  const awayShotDelta = (current.stats.shots_on_target?.away ?? 0) - (previous.stats.shots_on_target?.away ?? 0);
  const homeCornerDelta = (current.stats.corners?.home ?? 0) - (previous.stats.corners?.home ?? 0);
  const awayCornerDelta = (current.stats.corners?.away ?? 0) - (previous.stats.corners?.away ?? 0);

  if (homeDADelta >= 3) { r.homePts = Math.min(5, homeDADelta * 2.5); r.homeFactors.push(`Hücum patlaması +${homeDADelta}`); }
  if (awayDADelta >= 3) { r.awayPts = Math.min(5, awayDADelta * 2.5); r.awayFactors.push(`Hücum patlaması +${awayDADelta}`); }
  if (homeShotDelta >= 2) { r.homePts = (r.homePts || 0) + Math.min(4, homeShotDelta * 3); r.homeFactors.push(`Şut atağı +${homeShotDelta}`); }
  if (awayShotDelta >= 2) { r.awayPts = (r.awayPts || 0) + Math.min(4, awayShotDelta * 3); r.awayFactors.push(`Şut atağı +${awayShotDelta}`); }
  if (homeCornerDelta >= 2) { r.homePts = (r.homePts || 0) + Math.min(4, homeCornerDelta * 2); r.homeFactors.push(`Korner atağı +${homeCornerDelta}`); }
  if (awayCornerDelta >= 2) { r.awayPts = (r.awayPts || 0) + Math.min(4, awayCornerDelta * 2); r.awayFactors.push(`Korner atağı +${awayCornerDelta}`); }
  return r;
}

// ── F6: Momentum acceleration ───────────────────────────────────
export function calcFactorMomentum(pressureHistory: PressureSnapshotLite[]): FactorResult {
  const r: FactorResult = noResult();

  if (pressureHistory.length >= 5) {
    const recent = pressureHistory.slice(-5);
    const homeTrend = recent[4].homePressure - recent[0].homePressure;
    const awayTrend = recent[4].awayPressure - recent[0].awayPressure;
    const homeAccel = recent[4].homePressure - recent[2].homePressure - (recent[2].homePressure - recent[0].homePressure);
    const awayAccel = recent[4].awayPressure - recent[2].awayPressure - (recent[2].awayPressure - recent[0].awayPressure);

    if (homeTrend > 10) { r.homePts = Math.min(5, Math.round(homeTrend * 0.45)); if (r.homePts >= 3) r.homeFactors.push('Baskı artışı'); }
    if (awayTrend > 10) { r.awayPts = Math.min(5, Math.round(awayTrend * 0.45)); if (r.awayPts >= 3) r.awayFactors.push('Baskı artışı'); }
    if (homeAccel > 5) { r.homePts = (r.homePts || 0) + Math.min(3, Math.round(homeAccel * 0.4)); r.homeFactors.push('İvmeli baskı'); }
    if (awayAccel > 5) { r.awayPts = (r.awayPts || 0) + Math.min(3, Math.round(awayAccel * 0.4)); r.awayFactors.push('İvmeli baskı'); }
  } else if (pressureHistory.length >= 3) {
    const last3 = pressureHistory.slice(-3);
    const homeTrend = last3[2].homePressure - last3[0].homePressure;
    const awayTrend = last3[2].awayPressure - last3[0].awayPressure;
    if (homeTrend > 12) { r.homePts = Math.min(5, Math.round(homeTrend * 0.45)); r.homeFactors.push('Baskı artışı'); }
    if (awayTrend > 12) { r.awayPts = Math.min(5, Math.round(awayTrend * 0.45)); r.awayFactors.push('Baskı artışı'); }
  }
  return r;
}

// ── F7: Sustained pressure ──────────────────────────────────────
export function calcFactorSustainedPressure(pressureHistory: PressureSnapshotLite[]): FactorResult {
  if (pressureHistory.length < 3) return noResult();
  const r: FactorResult = noResult();
  const last5 = pressureHistory.slice(-5);
  const homeSustained = last5.filter(s => s.homePressure > 55).length;
  const awaySustained = last5.filter(s => s.awayPressure > 55).length;
  if (homeSustained >= 3) { r.homePts = Math.min(4, homeSustained * 1.5); r.homeFactors.push(`Sürekli baskı ${homeSustained}/5`); }
  if (awaySustained >= 3) { r.awayPts = Math.min(4, awaySustained * 1.5); r.awayFactors.push(`Sürekli baskı ${awaySustained}/5`); }
  return r;
}

// ── F8: Minute context multiplier ────────────────────────────────
export function calcMinuteMultiplier(minNum: number, leagueId?: number | null): number {
  const { calibrateF8Sync } = require('../smartCalibration');
  const { logError } = require('@/lib/devLog');
  try {
    const _calMode = loadCalibrationModeSync();
    const cal = calibrateF8Sync(leagueId ?? null, _calMode);
    const dangerStart = 86 + cal.dangerZoneShift;
    const halftimeStart = 35 + cal.halftimeSurgeShift;
    const dampenerEnd1H = 5 + cal.dampenerZoneShift;
    const dampenerStart2H = 46;
    const dampenerEnd2H = 50 + cal.dampenerZoneShift;

    if ((minNum >= 1 && minNum <= dampenerEnd1H) || (minNum >= dampenerStart2H && minNum <= dampenerEnd2H))
      return cal.calibratedDampener;
    if (minNum >= halftimeStart && minNum <= 45) return 1.15;
    if (minNum >= 60 && minNum < dangerStart) return 1.10 + (minNum - 60) * 0.004;
    if (minNum >= dangerStart) return cal.calibratedDangerBoost;
    return 1.0;
  } catch (e) {
    logError('goalRadar', 'F8 calibration failed, using defaults:', e);
    if ((minNum >= 1 && minNum <= 5) || (minNum >= 46 && minNum <= 50)) return 0.85;
    if (minNum >= 35 && minNum <= 45) return 1.15;
    if (minNum >= 60 && minNum < 86) return 1.10 + (minNum - 60) * 0.004;
    if (minNum >= 86) return 1.30;
    return 1.0;
  }
}

// ── F9: Corner + set-piece rate ─────────────────────────────────
export function calcFactorCornerSetPiece(stats: MatchStats, minNum: number, xg: { home: number; away: number }): FactorResult {
  const corners = stats.corners;
  const r: FactorResult = noResult();
  const secondHalfBoost = minNum >= 45 ? 1.2 : 1.0;

  const homeCornerRate = ((corners?.home ?? 0) / Math.max(1, minNum)) * 15;
  const awayCornerRate = ((corners?.away ?? 0) / Math.max(1, minNum)) * 15;

  if (corners?.home != null && homeCornerRate >= 1.5) {
    let pts = Math.min(6, Math.round(homeCornerRate * 2.5 * secondHalfBoost));
    const homeAttacks = stats.attacks?.home ?? 1;
    if (corners.home / Math.max(1, homeAttacks) > 0.15) pts += Math.min(3, Math.round((corners.home / Math.max(1, homeAttacks)) * 20));
    if ((stats.shots_total?.home ?? 0) > 0 && (stats.shots_on_target?.home ?? 0) / Math.max(1, stats.shots_total?.home ?? 0) > 0.4) pts += 4;
    r.homePts = pts;
    r.homeFactors.push(`Korner ${homeCornerRate.toFixed(1)}/15dk${minNum >= 45 ? ' (2Y)' : ''}`);
  }
  if (corners?.away != null && awayCornerRate >= 1.5) {
    let pts = Math.min(6, Math.round(awayCornerRate * 2.5 * secondHalfBoost));
    const awayAttacks = stats.attacks?.away ?? 1;
    if (corners.away / Math.max(1, awayAttacks) > 0.15) pts += Math.min(3, Math.round((corners.away / Math.max(1, awayAttacks)) * 20));
    if ((stats.shots_total?.away ?? 0) > 0 && (stats.shots_on_target?.away ?? 0) / Math.max(1, stats.shots_total?.away ?? 0) > 0.4) pts += 4;
    r.awayPts = pts;
    r.awayFactors.push(`Korner ${awayCornerRate.toFixed(1)}/15dk${minNum >= 45 ? ' (2Y)' : ''}`);
  }
  return r;
}

// ── F11: xG dominance ratio ─────────────────────────────────────
export function calcFactorXgDominance(xg: { home: number; away: number }): FactorResult {
  const totalXg = xg.home + xg.away;
  if (totalXg <= 0.5) return noResult();
  const r: FactorResult = noResult();
  const homeXgRatio = xg.home / totalXg;
  const awayXgRatio = xg.away / totalXg;
  if (homeXgRatio > 0.70 && xg.home > 0.4) {
    r.homePts = Math.min(5, Math.round((homeXgRatio - 0.5) * 30));
    if (r.homePts >= 4) r.homeFactors.push(`xG üstünlük %${Math.round(homeXgRatio * 100)}`);
  }
  if (awayXgRatio > 0.70 && xg.away > 0.4) {
    r.awayPts = Math.min(5, Math.round((awayXgRatio - 0.5) * 30));
    if (r.awayPts >= 4) r.awayFactors.push(`xG üstünlük %${Math.round(awayXgRatio * 100)}`);
  }
  return r;
}

// ── F12: Composite Threat ───────────────────────────────────────
export function calcFactorCompositeThreat(
  stats: MatchStats, minNum: number, pressureHistory?: PressureSnapshotLite[],
): FactorResult {
  const r: FactorResult = noResult();
  const elapsed15 = Math.max(1, minNum / 15);
  let homeAtkRate5min = (stats.dangerous_attacks?.home ?? 0) / elapsed15;
  let awayAtkRate5min = (stats.dangerous_attacks?.away ?? 0) / elapsed15;

  if (pressureHistory && pressureHistory.length >= 6) {
    const window5min = pressureHistory.slice(-60);
    if (window5min.length >= 3) {
      const firstDA_h = window5min[0].stats.dangerous_attacks?.home ?? 0;
      const lastDA_h = window5min[window5min.length - 1].stats.dangerous_attacks?.home ?? 0;
      const firstDA_a = window5min[0].stats.dangerous_attacks?.away ?? 0;
      const lastDA_a = window5min[window5min.length - 1].stats.dangerous_attacks?.away ?? 0;
      homeAtkRate5min = Math.max(homeAtkRate5min, ((lastDA_h - firstDA_h) / 5) * 15);
      awayAtkRate5min = Math.max(awayAtkRate5min, ((lastDA_a - firstDA_a) / 5) * 15);
    }
  }
  const homeAtkP = Math.min(15, homeAtkRate5min * 2.5);
  const awayAtkP = Math.min(15, awayAtkRate5min * 2.5);

  const homePoss = stats.possession?.home ?? 50;
  const awayPoss = stats.possession?.away ?? 50;
  let homeTerrBase = Math.max(0, (homePoss - 52) * 0.5);
  let awayTerrBase = Math.max(0, (awayPoss - 52) * 0.5);
  if (pressureHistory && pressureHistory.length >= 3) {
    const last3 = pressureHistory.slice(-3);
    if (last3.filter(s => (s.stats.possession?.home ?? 50) > 52).length < 2) homeTerrBase *= 0.5;
    if (last3.filter(s => (s.stats.possession?.away ?? 50) > 52).length < 2) awayTerrBase *= 0.5;
  }
  const homeTerr = Math.min(10, homeTerrBase);
  const awayTerr = Math.min(10, awayTerrBase);

  let homeFlow = 0, awayFlow = 0;
  if (pressureHistory && pressureHistory.length >= 4) {
    const r2 = pressureHistory.slice(-2);
    const o2 = pressureHistory.slice(-4, -2);
    if (o2.length >= 1) {
      const rDAh = r2.reduce((s, p) => s + (p.stats.dangerous_attacks?.home ?? 0), 0) / r2.length;
      const oDAh = o2.reduce((s, p) => s + (p.stats.dangerous_attacks?.home ?? 0), 0) / o2.length;
      const rDAa = r2.reduce((s, p) => s + (p.stats.dangerous_attacks?.away ?? 0), 0) / r2.length;
      const oDAa = o2.reduce((s, p) => s + (p.stats.dangerous_attacks?.away ?? 0), 0) / o2.length;
      homeFlow = Math.min(5, Math.max(0, (rDAh - oDAh) * 1.2));
      awayFlow = Math.min(5, Math.max(0, (rDAa - oDAa) * 1.2));
    }
  }
  const homeThreatIdx = Math.min(25, homeAtkP + homeTerr + homeFlow);
  const awayThreatIdx = Math.min(25, awayAtkP + awayTerr + awayFlow);

  if (homeThreatIdx > 15) {
    r.homePts = Math.min(6, Math.round((homeThreatIdx - 15) * 0.5));
    if (r.homePts >= 3) r.homeFactors.push(`Bileşik tehdit ${homeThreatIdx}`);
  }
  if (awayThreatIdx > 15) {
    r.awayPts = Math.min(6, Math.round((awayThreatIdx - 15) * 0.5));
    if (r.awayPts >= 3) r.awayFactors.push(`Bileşik tehdit ${awayThreatIdx}`);
  }
  const threatGap = homeThreatIdx - awayThreatIdx;
  if (threatGap > 20) {
    r.homePts = (r.homePts || 0) + Math.min(3, Math.round(threatGap * 0.08));
    if (threatGap > 30) r.homeFactors.push('Tehdit üstünlüğü');
  } else if (threatGap < -20) {
    r.awayPts = (r.awayPts || 0) + Math.min(3, Math.round(Math.abs(threatGap) * 0.08));
    if (threatGap < -30) r.awayFactors.push('Tehdit üstünlüğü');
  }
  return r;
}

// ── F13: xG flow momentum ──────────────────────────────────────
export function calcFactorXgFlow(pressureHistory: PressureSnapshotLite[], minNum: number): FactorResult {
  if (pressureHistory.length < 6) return noResult();
  const r: FactorResult = noResult();
  const recent = pressureHistory.slice(-3), older = pressureHistory.slice(-6, -3);
  const avgXg = (s: PressureSnapshotLite[], side: 'home' | 'away'): number =>
    s.reduce((sum, p) => sum + (p.stats.xg?.[side] ?? estimateXgFromShots(p.stats, side, minNum)), 0) / s.length;

  const homeXgFlowTrend = avgXg(recent, 'home') - avgXg(older, 'home');
  const awayXgFlowTrend = avgXg(recent, 'away') - avgXg(older, 'away');

  if (homeXgFlowTrend > 0.05) { r.homePts = Math.min(4, Math.round(homeXgFlowTrend * 15)); if (r.homePts >= 3) r.homeFactors.push(`xG yükselişi +${homeXgFlowTrend.toFixed(2)}`); }
  if (awayXgFlowTrend > 0.05) { r.awayPts = Math.min(4, Math.round(awayXgFlowTrend * 15)); if (r.awayPts >= 3) r.awayFactors.push(`xG yükselişi +${awayXgFlowTrend.toFixed(2)}`); }
  return r;
}

// ── F16: Dangerous sequence detector ────────────────────────────
export function calcFactorDangerousSequence(pressureHistory: PressureSnapshotLite[]): FactorResult {
  if (pressureHistory.length < 12) return noResult();
  const r: FactorResult = noResult();
  const window = pressureHistory.slice(-12), first = window[0], last = window[window.length - 1];

  const homeDADelta = (last.stats.dangerous_attacks?.home ?? 0) - (first.stats.dangerous_attacks?.home ?? 0);
  const awayDADelta = (last.stats.dangerous_attacks?.away ?? 0) - (first.stats.dangerous_attacks?.away ?? 0);
  const homeSOTDelta = (last.stats.shots_on_target?.home ?? 0) - (first.stats.shots_on_target?.home ?? 0);
  const awaySOTDelta = (last.stats.shots_on_target?.away ?? 0) - (first.stats.shots_on_target?.away ?? 0);
  const homeCornerDelta = (last.stats.corners?.home ?? 0) - (first.stats.corners?.home ?? 0);
  const awayCornerDelta = (last.stats.corners?.away ?? 0) - (first.stats.corners?.away ?? 0);
  const homeBlkDelta = (last.stats.shots_blocked?.home ?? 0) - (first.stats.shots_blocked?.home ?? 0);
  const awayBlkDelta = (last.stats.shots_blocked?.away ?? 0) - (first.stats.shots_blocked?.away ?? 0);

  const homeSequence = homeDADelta >= 2 && homeCornerDelta >= 1 && (homeSOTDelta >= 1 || homeBlkDelta >= 1);
  const awaySequence = awayDADelta >= 2 && awayCornerDelta >= 1 && (awaySOTDelta >= 1 || awayBlkDelta >= 1);
  if (homeSequence) {
    r.homePts = Math.min(12, 4 + homeDADelta * 1.5 + homeSOTDelta * 2);
    r.homeFactors.push(`Tehlikeli sıralı atak! (+${r.homePts})`);
  }
  if (awaySequence) {
    r.awayPts = Math.min(12, 4 + awayDADelta * 1.5 + awaySOTDelta * 2);
    r.awayFactors.push(`Tehlikeli sıralı atak! (+${r.awayPts})`);
  }

  // Counter-press: opponent possession drop + attack surge
  const homePossDrop = (first.stats.possession?.away ?? 50) - (last.stats.possession?.away ?? 50);
  const awayPossDrop = (first.stats.possession?.home ?? 50) - (last.stats.possession?.home ?? 50);
  if (homeDADelta >= 3 && homePossDrop > 10 && awaySOTDelta >= 1) {
    const boost = Math.min(8, 3 + homeDADelta * 1.5);
    r.homePts = (r.homePts || 0) + boost;
    if (boost >= 3) r.homeFactors.push(`Kontra atak +${boost}`);
  }
  if (awayDADelta >= 3 && awayPossDrop > 10 && homeSOTDelta >= 1) {
    const boost = Math.min(8, 3 + awayDADelta * 1.5);
    r.awayPts = (r.awayPts || 0) + boost;
    if (boost >= 3) r.awayFactors.push(`Kontra atak +${boost}`);
  }

  // Possession swing counter-attack wave
  const firstHomePoss = first.stats.possession?.home ?? 50, lastHomePoss = last.stats.possession?.home ?? 50;
  const possSwingHome = lastHomePoss - firstHomePoss;
  const possSwingAway = (first.stats.possession?.away ?? 50) - (last.stats.possession?.away ?? 50);
  if (possSwingHome > 20 && homeDADelta >= 2 && firstHomePoss < 45 && lastHomePoss > 60) {
    const pts = Math.min(6, 2 + Math.round(homeDADelta * 0.8));
    r.homePts = (r.homePts || 0) + pts;
    if (pts >= 3) r.homeFactors.push(`Kontra atak dalgası +${pts}`);
  }
  if (possSwingAway > 20 && awayDADelta >= 2) {
    const firstAwayPoss = first.stats.possession?.away ?? 50, lastAwayPoss = last.stats.possession?.away ?? 50;
    if (firstAwayPoss < 45 && lastAwayPoss > 60) {
      const pts = Math.min(6, 2 + Math.round(awayDADelta * 0.8));
      r.awayPts = (r.awayPts || 0) + pts;
      if (pts >= 3) r.awayFactors.push(`Kontra atak dalgası +${pts}`);
    }
  }
  return r;
}

// ── Concurrent threat multiplier ───────────────────────────────
export function calcConcurrentThreat(count: number): { pts: number; label?: string } {
  if (count >= 12) return { pts: 5, label: 'Fırtına!' };
  if (count >= 10) return { pts: 3, label: 'Kritik eşik!' };
  if (count >= 8) return { pts: 2 };
  if (count >= 6) return { pts: 1 };
  return { pts: 0 };
}

// ── F17: Pass quality + fouls ───────────────────────────────────
export function calcFactorPassQuality(stats: MatchStats): FactorResult {
  const r: FactorResult = noResult();
  const homePassAcc = stats.pass_accuracy?.home ?? null;
  const awayPassAcc = stats.pass_accuracy?.away ?? null;
  const homeFouls = stats.fouls?.home ?? 0;
  const awayFouls = stats.fouls?.away ?? 0;

  if (homePassAcc != null && homePassAcc > 0) {
    if (homePassAcc > 75) { r.homePts = Math.min(5, Math.round((homePassAcc - 75) * 0.2)); if (r.homePts >= 2) r.homeFactors.push(`Pas kalitesi %${homePassAcc}`); }
    if (homePassAcc < 65 && (stats.dangerous_attacks?.home ?? 0) > 5) { r.homePts = (r.homePts || 0) + Math.min(4, Math.round((65 - homePassAcc) * 0.15)); if (r.homePts >= 2) r.homeFactors.push('Kontra atak stili'); }
  }
  if (awayPassAcc != null && awayPassAcc > 0) {
    if (awayPassAcc > 75) { r.awayPts = Math.min(5, Math.round((awayPassAcc - 75) * 0.2)); if (r.awayPts >= 2) r.awayFactors.push(`Pas kalitesi %${awayPassAcc}`); }
    if (awayPassAcc < 65 && (stats.dangerous_attacks?.away ?? 0) > 5) { r.awayPts = (r.awayPts || 0) + Math.min(4, Math.round((65 - awayPassAcc) * 0.15)); if (r.awayPts >= 2) r.awayFactors.push('Kontra atak stili'); }
  }
  if (awayFouls >= 8) { r.homePts = (r.homePts || 0) + Math.min(5, awayFouls * 0.5); if (r.homePts >= 3) r.homeFactors.push(`Rakip ${awayFouls} faul`); }
  if (homeFouls >= 8) { r.awayPts = (r.awayPts || 0) + Math.min(5, homeFouls * 0.5); if (r.awayPts >= 3) r.awayFactors.push(`Rakip ${homeFouls} faul`); }
  return r;
}

// ── F18: Goalkeeper saves ──────────────────────────────────────
export function calcFactorGoalkeeper(stats: MatchStats): FactorResult {
  const r: FactorResult = noResult();
  const homeSaves = stats.saves?.home ?? 0;
  const awaySaves = stats.saves?.away ?? 0;
  const homeBlocks = stats.shots_blocked?.home ?? 0;
  const awayBlocks = stats.shots_blocked?.away ?? 0;
  if (awaySaves >= 3) { r.homePts = Math.min(8, awaySaves * 1.5 + awayBlocks * 0.5); if (r.homePts >= 4) r.homeFactors.push(`Kaleci ${awaySaves} kurtarış`); }
  if (homeSaves >= 3) { r.awayPts = Math.min(8, homeSaves * 1.5 + homeBlocks * 0.5); if (r.awayPts >= 4) r.awayFactors.push(`Kaleci ${homeSaves} kurtarış`); }
  return r;
}

// ── F19: Offside ────────────────────────────────────────────────
export function calcFactorOffside(stats: MatchStats): FactorResult {
  const r: FactorResult = noResult();
  const homeOffsides = stats.offsides?.home ?? 0;
  const awayOffsides = stats.offsides?.away ?? 0;
  if (awayOffsides >= 3) { r.homePts = Math.min(4, awayOffsides * 1); if (r.homePts >= 3) r.homeFactors.push(`Rakip ${awayOffsides} ofsayt`); }
  if (homeOffsides >= 3) { r.awayPts = Math.min(4, homeOffsides * 1); if (r.awayPts >= 3) r.awayFactors.push(`Rakip ${homeOffsides} ofsayt`); }
  return r;
}

// ── Card advantage ─────────────────────────────────────────────
export function calcFactorCardAdvantage(stats: MatchStats): FactorResult {
  const r: FactorResult = noResult();
  const homeYellowCards = stats.yellow_cards?.home ?? 0;
  const awayYellowCards = stats.yellow_cards?.away ?? 0;
  const homeRedCards = (stats.red_cards?.home ?? 0) + (stats.two_yellow_red?.home ?? 0);
  const awayRedCards = (stats.red_cards?.away ?? 0) + (stats.two_yellow_red?.away ?? 0);

  if (awayRedCards > 0) { r.homePts += 10; r.homeFactors.push('Rakip kırmızı kart +10'); }
  if (homeRedCards > 0) { r.awayPts += 10; r.awayFactors.push('Rakip kırmızı kart +10'); }
  if (homeRedCards > 0) { r.homePts -= 15; r.homePts = Math.max(0, r.homePts); r.homeFactors.push('Kırmızı kart -15'); }
  if (awayRedCards > 0) { r.awayPts -= 15; r.awayPts = Math.max(0, r.awayPts); r.awayFactors.push('Kırmızı kart -15'); }
  if (awayYellowCards >= 2) { r.homePts += Math.min(5, awayYellowCards * 2); if (awayYellowCards >= 3) r.homeFactors.push(`Rakip ${awayYellowCards} sarı kart`); }
  if (homeYellowCards >= 2) { r.awayPts += Math.min(5, homeYellowCards * 2); if (homeYellowCards >= 3) r.awayFactors.push(`Rakip ${homeYellowCards} sarı kart`); }
  return r;
}

// ── Set-piece threat spike ─────────────────────────────────────
export function calcFactorSetPieceThreat(pressureHistory: PressureSnapshotLite[]): FactorResult {
  if (pressureHistory.length < 6) return noResult();
  const r: FactorResult = noResult();
  const window6 = pressureHistory.slice(-6), wFirst = window6[0], wLast = window6[window6.length - 1];
  const hFK = (wLast.stats.free_kicks?.home ?? 0) - (wFirst.stats.free_kicks?.home ?? 0);
  const aFK = (wLast.stats.free_kicks?.away ?? 0) - (wFirst.stats.free_kicks?.away ?? 0);
  const hDA = (wLast.stats.dangerous_attacks?.home ?? 0) - (wFirst.stats.dangerous_attacks?.home ?? 0);
  const aDA = (wLast.stats.dangerous_attacks?.away ?? 0) - (wFirst.stats.dangerous_attacks?.away ?? 0);

  if (hFK >= 1 && hDA >= 2) { r.homePts += 8; r.homeFactors.push('Serbest vuruş tehdidi!'); }
  if (aFK >= 1 && aDA >= 2) { r.awayPts += 8; r.awayFactors.push('Serbest vuruş tehdidi!'); }

  const hCard = ((wLast.stats.yellow_cards?.home ?? 0) - (wFirst.stats.yellow_cards?.home ?? 0))
    + ((wLast.stats.red_cards?.home ?? 0) - (wFirst.stats.red_cards?.home ?? 0));
  const aCard = ((wLast.stats.yellow_cards?.away ?? 0) - (wFirst.stats.yellow_cards?.away ?? 0))
    + ((wLast.stats.red_cards?.away ?? 0) - (wFirst.stats.red_cards?.away ?? 0));

  if (aCard >= 1 && hDA >= 2) { r.homePts += 5; r.homeFactors.push('Kart sonrası pozisyon'); }
  if (hCard >= 1 && aDA >= 2) { r.awayPts += 5; r.awayFactors.push('Kart sonrası pozisyon'); }
  return r;
}

// ── Bayesian win-prob adjustment ────────────────────────────────
export function calcBayesianAdjustment(
  currentHomeGoals: number, currentAwayGoals: number, minNum: number,
  homeRedCards: number, awayRedCards: number, homeYellowCards: number, awayYellowCards: number,
): { homeAdj: number; awayAdj: number } {
  const scoreDiff = (currentHomeGoals ?? 0) - (currentAwayGoals ?? 0);
  const minutePct = minNum / 90;
  let homeAdj = 0, awayAdj = 0;
  if (scoreDiff < 0) {
    if (minutePct > 0.8) { homeAdj = -5; awayAdj = 5; }
    else homeAdj = 3;
  } else if (scoreDiff > 0) {
    if (minutePct > 0.8) { homeAdj = 5; awayAdj = -5; }
    else awayAdj = 3;
  }
  homeAdj -= homeRedCards * 3 + homeYellowCards * 0.5;
  awayAdj -= awayRedCards * 3 + awayYellowCards * 0.5;
  return { homeAdj: Math.round(homeAdj * 0.3), awayAdj: Math.round(awayAdj * 0.3) };
}

// ── Score situation factor (P1) ─────────────────────────────────
export function calcScoreSituation(
  currentHomeGoals?: number, currentAwayGoals?: number, minNum?: number,
): FactorResult {
  if (currentHomeGoals == null || currentAwayGoals == null || !minNum) return noResult();
  const r: FactorResult = noResult();
  const hg = currentHomeGoals, ag = currentAwayGoals, gd = Math.abs(hg - ag);
  if (gd === 0 && minNum > 60 && minNum < 85) {
    const pts = Math.min(6, Math.round((minNum - 60) / 5) * 1.5);
    r.homePts = Math.round(pts * 0.5);
    r.awayPts = Math.round(pts * 0.5);
    if (pts >= 3) r.sharedFactors.push('Beraberlikte risk');
  } else if (gd === 1 && minNum > 75) {
    const loserBoost = Math.min(5, (minNum - 75) * 0.3);
    if (hg < ag) { r.homePts = loserBoost; if (loserBoost >= 2) r.homeFactors.push('Farkı kovalıyor'); }
    else { r.awayPts = loserBoost; if (loserBoost >= 2) r.awayFactors.push('Farkı kovalıyor'); }
  }
  return r;
}

// ── Yakın dövüş: NetScores özel alanları ────────────────────────
export function calcFactorNetScores(fotmobData?: import('../fotmob').FotMobMatchDetails | null): FactorResult {
  const r: FactorResult = noResult();
  try {
    const ns = fotmobData?._netscores?.rawStats;
    if (!ns) return r;
    const homeCrosses = ns.crosses?.home != null ? Number(ns.crosses.home) : 0;
    const awayCrosses = ns.crosses?.away != null ? Number(ns.crosses.away) : 0;
    const homeCrossAcc = ns.crossing_accuracy?.home != null ? Number(ns.crossing_accuracy.home) : 0;
    const awayCrossAcc = ns.crossing_accuracy?.away != null ? Number(ns.crossing_accuracy.away) : 0;
    if (homeCrosses >= 3) { const pts = Math.min(6, homeCrosses * 0.8 + (homeCrossAcc > 30 ? 2 : 0)); r.homePts += pts; if (pts >= 3) r.homeFactors.push(`Kanat atak ${homeCrosses} orta`); }
    if (awayCrosses >= 3) { const pts = Math.min(6, awayCrosses * 0.8 + (awayCrossAcc > 30 ? 2 : 0)); r.awayPts += pts; if (pts >= 3) r.awayFactors.push(`Kanat atak ${awayCrosses} orta`); }
    const homePen = ns.penalties?.home != null ? Number(ns.penalties.home) : 0;
    const awayPen = ns.penalties?.away != null ? Number(ns.penalties.away) : 0;
    if (homePen > 0) { r.homePts += 15; r.homeFactors.push('Penaltı kazanıldı! (+15)'); }
    if (awayPen > 0) { r.awayPts += 15; r.awayFactors.push('Penaltı kazanıldı! (+15)'); }
    const homeKp = ns.key_passes?.home != null ? Number(ns.key_passes.home) : 0;
    const awayKp = ns.key_passes?.away != null ? Number(ns.key_passes.away) : 0;
    if (homeKp >= 3) { const pts = Math.min(5, homeKp * 0.7); r.homePts += pts; if (pts >= 3) r.homeFactors.push(`Anahtar pas ${homeKp}`); }
    if (awayKp >= 3) { const pts = Math.min(5, awayKp * 0.7); r.awayPts += pts; if (pts >= 3) r.awayFactors.push(`Anahtar pas ${awayKp}`); }
  } catch { /* NetScores optional */ }
  return r;
}
