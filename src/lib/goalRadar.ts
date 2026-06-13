// ── Goal Probability Radar System ──────────────────────────────────
// Extracted from nesine.ts for modularity

import type { MatchStats } from './nesineTypes';
import { calculatePressure } from './nesineTypes';

export interface PressureSnapshotLite {
  homePressure: number;
  awayPressure: number;
  stats: MatchStats;
  homeGoals?: number;
  awayGoals?: number;
  timestamp?: number;
}

export interface GoalProbability {
  score: number;
  homeScore: number;
  awayScore: number;
  side: 'home' | 'away' | 'both' | null;
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  calibratedP: number;
  poissonP: number;
  eloAdj: { homeAdj: number; awayAdj: number } | null;
  overUnder25: number;
  btts: number;
  timeMultiplier: number;
  goalProbability5min: number;
}

export function calculateGoalProbability(
  stats: MatchStats,
  minute: string,
  isLive: boolean,
  pressureHistory?: PressureSnapshotLite[],
  currentHomeGoals?: number,
  currentAwayGoals?: number,
  homeTeam?: string,
  awayTeam?: string,
  oddsMovementBoost?: { homeBoost: number; awayBoost: number; significance: string } | null,
  leagueId?: number | null,
): GoalProbability {
  const emptyResult: GoalProbability = {
    score: 0, homeScore: 0, awayScore: 0, side: null, level: 'low', factors: [],
    calibratedP: 0, poissonP: 0, eloAdj: null, overUnder25: 0, btts: 0, timeMultiplier: 1.0,
    goalProbability5min: 0,
  };
  if (!isLive) return emptyResult;

  let goalCooldownHome = 0;
  let goalCooldownAway = 0;
  let recentGoalSide: 'home' | 'away' | 'both' | null = null;
  const GOAL_COOLDOWN_SNAPSHOTS = 6;

  if (pressureHistory && pressureHistory.length >= 2) {
    const currentHG = currentHomeGoals ?? pressureHistory[pressureHistory.length - 1].homeGoals;
    const currentAG = currentAwayGoals ?? pressureHistory[pressureHistory.length - 1].awayGoals;
    if (currentHG != null && currentAG != null) {
      for (let i = pressureHistory.length - 1; i >= 1; i--) {
        const snap = pressureHistory[i];
        const prev = pressureHistory[i - 1];
        const snapHG = snap.homeGoals, snapAG = snap.awayGoals;
        const prevHG = prev.homeGoals, prevAG = prev.awayGoals;
        if (snapHG == null || snapAG == null || prevHG == null || prevAG == null) continue;
        const homeGoalScored = snapHG > prevHG;
        const awayGoalScored = snapAG > prevAG;
        if (homeGoalScored || awayGoalScored) {
          const snapshotsAgo = pressureHistory.length - 1 - i;
          if (homeGoalScored && awayGoalScored) recentGoalSide = 'both';
          else if (homeGoalScored) recentGoalSide = 'home';
          else recentGoalSide = 'away';
          const progress = Math.min(1, snapshotsAgo / GOAL_COOLDOWN_SNAPSHOTS);
          const cooldownFactor = Math.pow(progress, 0.4);
          if (homeGoalScored) goalCooldownHome = cooldownFactor;
          if (awayGoalScored) goalCooldownAway = cooldownFactor;
          break;
        }
      }
    }
  }

  let homeScore = 0, awayScore = 0;
  const homeFactors: string[] = [], awayFactors: string[] = [], sharedFactors: string[] = [];

  let minNum = parseInt(minute.replace(/[^0-9]/g, ''), 10);
  if (!minNum || minNum === 0) minNum = 45;
  minNum = Math.max(1, Math.min(120, minNum));

  // Factor 1: Pressure dominance
  const pressure = calculatePressure(stats);
  const pressureGap = Math.abs(pressure.home - pressure.away);
  if (pressure.home > 55 && pressureGap > 8) {
    const pts = Math.min(12, Math.round((pressure.home - 50) * 0.65));
    homeScore += pts; if (pts >= 6) homeFactors.push(`Baskı ${pressure.home}%`);
  }
  if (pressure.away > 55 && pressureGap > 8) {
    const pts = Math.min(12, Math.round((pressure.away - 50) * 0.65));
    awayScore += pts; if (pts >= 6) awayFactors.push(`Baskı ${pressure.away}%`);
  }

  // Factor 2: Dangerous attack rate
  const dangerAttacks = stats.dangerous_attacks;
  if (dangerAttacks?.home != null) {
    const rate = (dangerAttacks.home / Math.max(1, minNum)) * 15;
    if (rate >= 1.5) { const pts = Math.min(14, Math.round(rate * 3.5)); homeScore += pts; homeFactors.push(`Tehl. hücum ${rate.toFixed(1)}/15dk`); }
  }
  if (dangerAttacks?.away != null) {
    const rate = (dangerAttacks.away / Math.max(1, minNum)) * 15;
    if (rate >= 1.5) { const pts = Math.min(14, Math.round(rate * 3.5)); awayScore += pts; awayFactors.push(`Tehl. hücum ${rate.toFixed(1)}/15dk`); }
  }

  // Factor 3: Shot quality + xG
  const shotsOnTarget = stats.shots_on_target;
  const homeSotCount = shotsOnTarget?.home ?? 0, awaySotCount = shotsOnTarget?.away ?? 0;
  const homeShotsTotal = stats.shots_total?.home ?? 0, awayShotsTotal = stats.shots_total?.away ?? 0;
  const homeBlocked = stats.shots_blocked?.home ?? 0, awayBlocked = stats.shots_blocked?.away ?? 0;
  const homeOffTarget = Math.max(0, homeShotsTotal - homeSotCount - homeBlocked);
  const awayOffTarget = Math.max(0, awayShotsTotal - awaySotCount - awayBlocked);
  const apiXg = stats.xg;
  const xgHome = apiXg?.home != null && apiXg.home > 0 ? apiXg.home : homeSotCount * 0.38 + homeOffTarget * 0.05 + homeBlocked * 0.03 + (stats.corners?.home ?? 0) * 0.04 + (dangerAttacks?.home ?? 0) * 0.01;
  const xgAway = apiXg?.away != null && apiXg.away > 0 ? apiXg.away : awaySotCount * 0.38 + awayOffTarget * 0.05 + awayBlocked * 0.03 + (stats.corners?.away ?? 0) * 0.04 + (dangerAttacks?.away ?? 0) * 0.01;
  const xg = { home: xgHome, away: xgAway };
  const homeSotRate = (homeSotCount / Math.max(1, minNum)) * 15;
  const awaySotRate = (awaySotCount / Math.max(1, minNum)) * 15;

  if (shotsOnTarget?.home != null && shotsOnTarget.home >= 1) {
    let pts = Math.min(6, Math.round(homeSotRate * 2.0));
    if (xg.home > 0 && shotsOnTarget.home > 0) { const xgPerShot = xg.home / shotsOnTarget.home; if (xgPerShot > 0.12) pts += Math.min(6, Math.round(xgPerShot * 18)); }
    if (homeSotRate >= 1.5) pts += Math.min(4, Math.round((homeSotRate - 1.0) * 3));
    homeScore += pts; if (pts >= 5) homeFactors.push(`${shotsOnTarget.home} isabetli şut (xGOT: ${homeSotRate.toFixed(1)}/15dk)`);
  }
  if (shotsOnTarget?.away != null && shotsOnTarget.away >= 1) {
    let pts = Math.min(6, Math.round(awaySotRate * 2.0));
    if (xg.away > 0 && shotsOnTarget.away > 0) { const xgPerShot = xg.away / shotsOnTarget.away; if (xgPerShot > 0.12) pts += Math.min(6, Math.round(xgPerShot * 18)); }
    if (awaySotRate >= 1.5) pts += Math.min(4, Math.round((awaySotRate - 1.0) * 3));
    awayScore += pts; if (pts >= 5) awayFactors.push(`${shotsOnTarget.away} isabetli şut (xGOT: ${awaySotRate.toFixed(1)}/15dk)`);
  }

  // Factor 4: xG accumulation + velocity
  if (xg.home > 0.3) { const xgPts = Math.min(10, Math.round(xg.home * 7)); const xgRate = (xg.home / Math.max(1, minNum)) * 15; const velocityPts = xgRate > 0.3 ? Math.min(4, Math.round(xgRate * 4)) : 0; homeScore += xgPts + velocityPts; homeFactors.push(`xG ${xg.home.toFixed(2)} (${xgRate.toFixed(2)}/15dk)`); }
  if (xg.away > 0.3) { const xgPts = Math.min(10, Math.round(xg.away * 7)); const xgRate = (xg.away / Math.max(1, minNum)) * 15; const velocityPts = xgRate > 0.3 ? Math.min(4, Math.round(xgRate * 4)) : 0; awayScore += xgPts + velocityPts; awayFactors.push(`xG ${xg.away.toFixed(2)} (${xgRate.toFixed(2)}/15dk)`); }

  // Factor 5: Stat spike detection
  if (pressureHistory && pressureHistory.length >= 3) {
    const current = pressureHistory[pressureHistory.length - 1];
    const compareIdx = Math.max(0, pressureHistory.length - 4);
    const previous = pressureHistory[compareIdx];
    const homeDangerDelta = (current.stats.dangerous_attacks?.home ?? 0) - (previous.stats.dangerous_attacks?.home ?? 0);
    const awayDangerDelta = (current.stats.dangerous_attacks?.away ?? 0) - (previous.stats.dangerous_attacks?.away ?? 0);
    if (homeDangerDelta >= 3) { const pts = Math.min(8, homeDangerDelta * 2.5); homeScore += pts; homeFactors.push(`Hücum patlaması +${homeDangerDelta}`); }
    if (awayDangerDelta >= 3) { const pts = Math.min(8, awayDangerDelta * 2.5); awayScore += pts; awayFactors.push(`Hücum patlaması +${awayDangerDelta}`); }
    const homeShotDelta = (current.stats.shots_on_target?.home ?? 0) - (previous.stats.shots_on_target?.home ?? 0);
    const awayShotDelta = (current.stats.shots_on_target?.away ?? 0) - (previous.stats.shots_on_target?.away ?? 0);
    if (homeShotDelta >= 2) { const pts = Math.min(6, homeShotDelta * 3); homeScore += pts; homeFactors.push(`Şut atağı +${homeShotDelta}`); }
    if (awayShotDelta >= 2) { const pts = Math.min(6, awayShotDelta * 3); awayScore += pts; awayFactors.push(`Şut atağı +${awayShotDelta}`); }
    const homeCornerDelta = (current.stats.corners?.home ?? 0) - (previous.stats.corners?.home ?? 0);
    const awayCornerDelta = (current.stats.corners?.away ?? 0) - (previous.stats.corners?.away ?? 0);
    if (homeCornerDelta >= 2) { homeScore += Math.min(4, homeCornerDelta * 2); homeFactors.push(`Korner atağı +${homeCornerDelta}`); }
    if (awayCornerDelta >= 2) { awayScore += Math.min(4, awayCornerDelta * 2); awayFactors.push(`Korner atağı +${awayCornerDelta}`); }
  }

  // Factor 6: Momentum acceleration
  if (pressureHistory && pressureHistory.length >= 5) {
    const recent = pressureHistory.slice(-5);
    const homeTrend = recent[4].homePressure - recent[0].homePressure;
    const awayTrend = recent[4].awayPressure - recent[0].awayPressure;
    const homeAccel = (recent[4].homePressure - recent[2].homePressure) - (recent[2].homePressure - recent[0].homePressure);
    const awayAccel = (recent[4].awayPressure - recent[2].awayPressure) - (recent[2].awayPressure - recent[0].awayPressure);
    if (homeTrend > 10) { const pts = Math.min(7, Math.round(homeTrend * 0.45)); homeScore += pts; if (pts >= 4) homeFactors.push('Baskı artışı'); }
    if (awayTrend > 10) { const pts = Math.min(7, Math.round(awayTrend * 0.45)); awayScore += pts; if (pts >= 4) awayFactors.push('Baskı artışı'); }
    if (homeAccel > 5) { homeScore += Math.min(3, Math.round(homeAccel * 0.4)); homeFactors.push('İvmeli baskı'); }
    if (awayAccel > 5) { awayScore += Math.min(3, Math.round(awayAccel * 0.4)); awayFactors.push('İvmeli baskı'); }
  } else if (pressureHistory && pressureHistory.length >= 3) {
    const last3 = pressureHistory.slice(-3);
    const homeTrend = last3[2].homePressure - last3[0].homePressure;
    const awayTrend = last3[2].awayPressure - last3[0].awayPressure;
    if (homeTrend > 12) { homeScore += Math.min(7, Math.round(homeTrend * 0.45)); homeFactors.push('Baskı artışı'); }
    if (awayTrend > 12) { awayScore += Math.min(7, Math.round(awayTrend * 0.45)); awayFactors.push('Baskı artışı'); }
  }

  // Factor 7: Sustained pressure
  if (pressureHistory && pressureHistory.length >= 3) {
    const last5 = pressureHistory.slice(-5);
    const homeSustained = last5.filter(s => s.homePressure > 55).length;
    const awaySustained = last5.filter(s => s.awayPressure > 55).length;
    if (homeSustained >= 3) { const pts = Math.min(6, homeSustained * 1.5); homeScore += pts; homeFactors.push(`Sürekli baskı ${homeSustained}/5`); }
    if (awaySustained >= 3) { const pts = Math.min(6, awaySustained * 1.5); awayScore += pts; awayFactors.push(`Sürekli baskı ${awaySustained}/5`); }
  }

  // Factor 8: Minute context
  const hasRealMinute = /\d/.test(minute);
  let minuteMultiplier = 1.0;
  if (hasRealMinute) {
    let useSmartCalibration = false;
    try {
      const { getSmartF8Adjustment } = require('./smartCalibration');
      const f8Adj = getSmartF8Adjustment(minNum, leagueId ?? null);
      minuteMultiplier = f8Adj.minuteMultiplier;
      if (f8Adj.factorDescription) sharedFactors.push(f8Adj.factorDescription);
      useSmartCalibration = true;
    } catch { /* fallback */ }
    if (!useSmartCalibration) {
      if ((minNum >= 1 && minNum <= 5) || (minNum >= 46 && minNum <= 50)) minuteMultiplier = 0.70;
      else if (minNum >= 35 && minNum <= 45) minuteMultiplier = 1.08;
      else if (minNum >= 60 && minNum < 86) minuteMultiplier = 1.05 + (minNum - 60) * 0.002;
      else if (minNum >= 86) minuteMultiplier = 1.18;
      else minuteMultiplier = 1.0;
    }
  }

  // Factor 9: Corner + SOT compound
  const corners = stats.corners;
  const homeCornerRate = (corners?.home ?? 0) / Math.max(1, minNum) * 15;
  const awayCornerRate = (corners?.away ?? 0) / Math.max(1, minNum) * 15;
  const secondHalfBoost = minNum >= 45 ? 1.2 : 1.0;
  if (corners?.home != null && homeCornerRate >= 1.5) {
    let pts = Math.min(8, Math.round(homeCornerRate * 2.5 * secondHalfBoost));
    if (homeShotsTotal > 0 && (homeSotCount / homeShotsTotal) > 0.5) pts += 2;
    homeScore += pts; homeFactors.push(`Korner ${homeCornerRate.toFixed(1)}/15dk${minNum >= 45 ? ' (2Y)' : ''}`);
  }
  if (corners?.away != null && awayCornerRate >= 1.5) {
    let pts = Math.min(8, Math.round(awayCornerRate * 2.5 * secondHalfBoost));
    if (awayShotsTotal > 0 && (awaySotCount / awayShotsTotal) > 0.5) pts += 2;
    awayScore += pts; awayFactors.push(`Korner ${awayCornerRate.toFixed(1)}/15dk${minNum >= 45 ? ' (2Y)' : ''}`);
  }

  // Factor 10: xG spike detection
  if (pressureHistory && pressureHistory.length >= 2) {
    const current = pressureHistory[pressureHistory.length - 1];
    const lookback = Math.min(4, pressureHistory.length - 1);
    const previous = pressureHistory[pressureHistory.length - 1 - lookback];
    const estimateXg = (s: MatchStats) => { const sot = s.shots_on_target?.home ?? 0; const total = s.shots_total?.home ?? 0; const blk = s.shots_blocked?.home ?? 0; const off = Math.max(0, total - sot - blk); const crn = s.corners?.home ?? 0; const da = s.dangerous_attacks?.home ?? 0; const apiVal = s.xg?.home; if (apiVal != null && apiVal > 0) return apiVal; return sot * 0.38 + off * 0.05 + blk * 0.03 + crn * 0.04 + da * 0.01; };
    const estimateXgAway = (s: MatchStats) => { const sot = s.shots_on_target?.away ?? 0; const total = s.shots_total?.away ?? 0; const blk = s.shots_blocked?.away ?? 0; const off = Math.max(0, total - sot - blk); const crn = s.corners?.away ?? 0; const da = s.dangerous_attacks?.away ?? 0; const apiVal = s.xg?.away; if (apiVal != null && apiVal > 0) return apiVal; return sot * 0.38 + off * 0.05 + blk * 0.03 + crn * 0.04 + da * 0.01; };
    const currentHomeXg = current.stats.xg?.home != null && current.stats.xg.home > 0 ? current.stats.xg.home : estimateXg(current.stats);
    const prevHomeXg = previous.stats.xg?.home != null && previous.stats.xg.home > 0 ? previous.stats.xg.home : estimateXg(previous.stats);
    const currentAwayXg = current.stats.xg?.away != null && current.stats.xg.away > 0 ? current.stats.xg.away : estimateXgAway(current.stats);
    const prevAwayXg = previous.stats.xg?.away != null && previous.stats.xg.away > 0 ? previous.stats.xg.away : estimateXgAway(previous.stats);
    const homeXgDelta = Math.max(0, currentHomeXg - prevHomeXg), awayXgDelta = Math.max(0, currentAwayXg - prevAwayXg);
    if (homeXgDelta >= 0.10) { const pts = Math.min(10, Math.round(homeXgDelta * 40)); homeScore += pts; homeFactors.push(`xG sıçraması +${homeXgDelta.toFixed(2)}`); }
    if (awayXgDelta >= 0.10) { const pts = Math.min(10, Math.round(awayXgDelta * 40)); awayScore += pts; awayFactors.push(`xG sıçraması +${awayXgDelta.toFixed(2)}`); }
  }

  // Factor 11: xG dominance ratio
  const totalXg = xg.home + xg.away;
  if (totalXg > 0.5) {
    const homeXgRatio = xg.home / totalXg, awayXgRatio = xg.away / totalXg;
    if (homeXgRatio > 0.65 && xg.home > 0.4) { const pts = Math.min(8, Math.round((homeXgRatio - 0.5) * 30)); homeScore += pts; if (pts >= 4) homeFactors.push(`xG üstünlük %${Math.round(homeXgRatio * 100)}`); }
    if (awayXgRatio > 0.65 && xg.away > 0.4) { const pts = Math.min(8, Math.round((awayXgRatio - 0.5) * 30)); awayScore += pts; if (pts >= 4) awayFactors.push(`xG üstünlük %${Math.round(awayXgRatio * 100)}`); }
  }

  // Factor 12: Threat index
  {
    const homeShotQ = Math.min(25, xg.home * 12), awayShotQ = Math.min(25, xg.away * 12);
    const elapsed15 = Math.max(1, minNum / 15);
    let homeAtkRate5min = (stats.dangerous_attacks?.home ?? 0) / elapsed15, awayAtkRate5min = (stats.dangerous_attacks?.away ?? 0) / elapsed15;
    if (pressureHistory && pressureHistory.length >= 6) {
      const window5min = pressureHistory.slice(-60);
      if (window5min.length >= 3) { const firstDA_h = window5min[0].stats.dangerous_attacks?.home ?? 0; const lastDA_h = window5min[window5min.length - 1].stats.dangerous_attacks?.home ?? 0; const firstDA_a = window5min[0].stats.dangerous_attacks?.away ?? 0; const lastDA_a = window5min[window5min.length - 1].stats.dangerous_attacks?.away ?? 0; homeAtkRate5min = Math.max(homeAtkRate5min, ((lastDA_h - firstDA_h) / 5) * 15); awayAtkRate5min = Math.max(awayAtkRate5min, ((lastDA_a - firstDA_a) / 5) * 15); }
    }
    const homeAtkP = Math.min(25, homeAtkRate5min * 4), awayAtkP = Math.min(25, awayAtkRate5min * 4);
    const sp2hBoost = minNum >= 45 ? 1.2 : 1.0;
    const homeSP = Math.min(15, ((stats.corners?.home ?? 0) * 1.5 + (stats.free_kicks?.home ?? 0) * 0.3) * sp2hBoost);
    const awaySP = Math.min(15, ((stats.corners?.away ?? 0) * 1.5 + (stats.free_kicks?.away ?? 0) * 0.3) * sp2hBoost);
    const homePoss = stats.possession?.home ?? 50, awayPoss = stats.possession?.away ?? 50;
    let homeTerrBase = Math.max(0, (homePoss - 52) * 0.75), awayTerrBase = Math.max(0, (awayPoss - 52) * 0.75);
    if (pressureHistory && pressureHistory.length >= 3) {
      const last3 = pressureHistory.slice(-3);
      const homePossCount = last3.filter(s => (s.stats.possession?.home ?? 50) > 52).length;
      const awayPossCount = last3.filter(s => (s.stats.possession?.away ?? 50) > 52).length;
      if (homePossCount < 2) homeTerrBase *= 0.5; if (awayPossCount < 2) awayTerrBase *= 0.5;
    }
    const homeTerr = Math.min(15, homeTerrBase), awayTerr = Math.min(15, awayTerrBase);
    let homeMom = 0, awayMom = 0;
    if (pressureHistory && pressureHistory.length >= 6) {
      const r3 = pressureHistory.slice(-3), o3 = pressureHistory.slice(-6, -3);
      if (o3.length >= 2) {
        const rHP = r3.reduce((s, p) => s + p.homePressure, 0) / r3.length, oHP = o3.reduce((s, p) => s + p.homePressure, 0) / o3.length;
        const rAP = r3.reduce((s, p) => s + p.awayPressure, 0) / r3.length, oAP = o3.reduce((s, p) => s + p.awayPressure, 0) / o3.length;
        homeMom = Math.min(20, Math.max(0, (rHP - oHP) * 0.8)); awayMom = Math.min(20, Math.max(0, (rAP - oAP) * 0.8));
      }
    }
    const homeThreatIdx = Math.min(100, homeShotQ + homeAtkP + homeSP + homeTerr + homeMom);
    const awayThreatIdx = Math.min(100, awayShotQ + awayAtkP + awaySP + awayTerr + awayMom);
    if (homeThreatIdx > 50) { const pts = Math.min(10, Math.round((homeThreatIdx - 50) * 0.20)); homeScore += pts; if (pts >= 3) homeFactors.push(`Tehdit indeksi ${Math.round(homeThreatIdx)}`); }
    if (awayThreatIdx > 50) { const pts = Math.min(10, Math.round((awayThreatIdx - 50) * 0.20)); awayScore += pts; if (pts >= 3) awayFactors.push(`Tehdit indeksi ${Math.round(awayThreatIdx)}`); }
    const threatGap = homeThreatIdx - awayThreatIdx;
    if (threatGap > 20) { homeScore += Math.min(3, Math.round(threatGap * 0.08)); if (threatGap > 30) homeFactors.push('Tehdit üstünlüğü'); }
    else if (threatGap < -20) { awayScore += Math.min(3, Math.round(Math.abs(threatGap) * 0.08)); if (threatGap < -30) awayFactors.push('Tehdit üstünlüğü'); }
  }

  // Factor 13: xG flow momentum
  if (pressureHistory && pressureHistory.length >= 6) {
    const recent = pressureHistory.slice(-3), older = pressureHistory.slice(-6, -3);
    const estimateXgForSnap = (s: PressureSnapshotLite, side: 'home' | 'away') => {
      const apiKey = side === 'home' ? s.stats.xg?.home : s.stats.xg?.away;
      if (apiKey != null && apiKey > 0) return apiKey;
      const sot = side === 'home' ? (s.stats.shots_on_target?.home ?? 0) : (s.stats.shots_on_target?.away ?? 0);
      const total = side === 'home' ? (s.stats.shots_total?.home ?? 0) : (s.stats.shots_total?.away ?? 0);
      const blk = side === 'home' ? (s.stats.shots_blocked?.home ?? 0) : (s.stats.shots_blocked?.away ?? 0);
      const off = Math.max(0, total - sot - blk); const crn = side === 'home' ? (s.stats.corners?.home ?? 0) : (s.stats.corners?.away ?? 0);
      const da = side === 'home' ? (s.stats.dangerous_attacks?.home ?? 0) : (s.stats.dangerous_attacks?.away ?? 0);
      return sot * 0.38 + off * 0.05 + blk * 0.03 + crn * 0.04 + da * 0.01;
    };
    const recentHomeXg = recent.reduce((s, p) => s + estimateXgForSnap(p, 'home'), 0) / recent.length;
    const olderHomeXg = older.reduce((s, p) => s + estimateXgForSnap(p, 'home'), 0) / older.length;
    const recentAwayXg = recent.reduce((s, p) => s + estimateXgForSnap(p, 'away'), 0) / recent.length;
    const olderAwayXg = older.reduce((s, p) => s + estimateXgForSnap(p, 'away'), 0) / older.length;
    const homeXgFlowTrend = recentHomeXg - olderHomeXg, awayXgFlowTrend = recentAwayXg - olderAwayXg;
    if (homeXgFlowTrend > 0.05) { const pts = Math.min(6, Math.round(homeXgFlowTrend * 20)); homeScore += pts; if (pts >= 3) homeFactors.push(`xG yükselişi +${homeXgFlowTrend.toFixed(2)}`); }
    if (awayXgFlowTrend > 0.05) { const pts = Math.min(6, Math.round(awayXgFlowTrend * 20)); awayScore += pts; if (pts >= 3) awayFactors.push(`xG yükselişi +${awayXgFlowTrend.toFixed(2)}`); }
  }

  // Factor 15: Burst risk
  if (pressureHistory && pressureHistory.length >= 2) {
    const BURST_SNAPSHOTS = 36;
    const currentHG = currentHomeGoals ?? pressureHistory[pressureHistory.length - 1].homeGoals;
    const currentAG = currentAwayGoals ?? pressureHistory[pressureHistory.length - 1].awayGoals;
    if (currentHG != null && currentAG != null) {
      for (let i = pressureHistory.length - 1; i >= 1; i--) {
        const snap = pressureHistory[i], prev = pressureHistory[i - 1];
        if (snap.homeGoals == null || snap.awayGoals == null || prev.homeGoals == null || prev.awayGoals == null) continue;
        const homeScored = snap.homeGoals > prev.homeGoals, awayScored = snap.awayGoals > prev.awayGoals;
        if (homeScored || awayScored) {
          const snapsAgo = pressureHistory.length - 1 - i;
          if (snapsAgo < BURST_SNAPSHOTS) { const burstProgress = snapsAgo / BURST_SNAPSHOTS; const burstMultiplier = 1.25 * (1 - burstProgress); if (homeScored) { const burstPts = Math.round(homeScore * (burstMultiplier - 1)); homeScore += burstPts; if (burstPts >= 3) homeFactors.push(`Gol sonrası atak rüzgarı +${burstPts}`); } if (awayScored) { const burstPts = Math.round(awayScore * (burstMultiplier - 1)); awayScore += burstPts; if (burstPts >= 3) awayFactors.push(`Gol sonrası atak rüzgarı +${burstPts}`); } }
          break;
        }
      }
    }
  }

  // Factor 16: Dangerous sequence detector
  if (pressureHistory && pressureHistory.length >= 12) {
    const window = pressureHistory.slice(-12), first = window[0], last = window[window.length - 1];
    const homeDADelta = (last.stats.dangerous_attacks?.home ?? 0) - (first.stats.dangerous_attacks?.home ?? 0);
    const awayDADelta = (last.stats.dangerous_attacks?.away ?? 0) - (first.stats.dangerous_attacks?.away ?? 0);
    const homeCornerDelta = (last.stats.corners?.home ?? 0) - (first.stats.corners?.home ?? 0);
    const awayCornerDelta = (last.stats.corners?.away ?? 0) - (first.stats.corners?.away ?? 0);
    const homeSOTDelta = (last.stats.shots_on_target?.home ?? 0) - (first.stats.shots_on_target?.home ?? 0);
    const awaySOTDelta = (last.stats.shots_on_target?.away ?? 0) - (first.stats.shots_on_target?.away ?? 0);
    const homeBlkDelta = (last.stats.shots_blocked?.home ?? 0) - (first.stats.shots_blocked?.home ?? 0);
    const awayBlkDelta = (last.stats.shots_blocked?.away ?? 0) - (first.stats.shots_blocked?.away ?? 0);
    const homeSequence = homeDADelta >= 2 && homeCornerDelta >= 1 && (homeSOTDelta >= 1 || homeBlkDelta >= 1);
    const awaySequence = awayDADelta >= 2 && awayCornerDelta >= 1 && (awaySOTDelta >= 1 || awayBlkDelta >= 1);
    if (homeSequence) { const seqBoost = Math.round(homeScore * 0.4); homeScore += seqBoost; homeFactors.push(`Tehlikeli sıralı atak! (+${seqBoost})`); }
    if (awaySequence) { const seqBoost = Math.round(awayScore * 0.4); awayScore += seqBoost; awayFactors.push(`Tehlikeli sıralı atak! (+${seqBoost})`); }
    if ((awaySOTDelta >= 1 || awayCornerDelta >= 1) && homeDADelta >= 3) { const resetBoost = Math.round(homeScore * 0.3); homeScore += resetBoost; if (resetBoost >= 3) homeFactors.push(`Karşı baskı +${resetBoost}`); }
    if ((homeSOTDelta >= 1 || homeCornerDelta >= 1) && awayDADelta >= 3) { const resetBoost = Math.round(awayScore * 0.3); awayScore += resetBoost; if (resetBoost >= 3) awayFactors.push(`Karşı baskı +${resetBoost}`); }
    const firstHomePoss = first.stats.possession?.home ?? 50, lastHomePoss = last.stats.possession?.home ?? 50;
    const possSwingHome = lastHomePoss - firstHomePoss, possSwingAway = (first.stats.possession?.away ?? 50) - (last.stats.possession?.away ?? 50);
    if (possSwingHome > 20 && homeDADelta >= 2 && firstHomePoss < 45 && lastHomePoss > 60) { const counterPts = Math.round(homeScore * 0.25); homeScore += counterPts; if (counterPts >= 3) homeFactors.push(`Kontra atak dalgası +${counterPts}`); }
    if (possSwingAway > 20 && awayDADelta >= 2) { const firstAwayPoss = first.stats.possession?.away ?? 50, lastAwayPoss = last.stats.possession?.away ?? 50; if (firstAwayPoss < 45 && lastAwayPoss > 60) { const counterPts = Math.round(awayScore * 0.25); awayScore += counterPts; if (counterPts >= 3) awayFactors.push(`Kontra atak dalgası +${counterPts}`); } }
  }

  // Concurrent threat multiplier
  const homeActiveCount = homeFactors.length, awayActiveCount = awayFactors.length;
  if (homeActiveCount >= 6) { homeScore += 10; homeFactors.push('Fırtına!'); } else if (homeActiveCount >= 5) { homeScore += 8; homeFactors.push('Kritik eşik!'); } else if (homeActiveCount >= 4) { homeScore += 5; } else if (homeActiveCount >= 3) { homeScore += 2; }
  if (awayActiveCount >= 6) { awayScore += 10; awayFactors.push('Fırtına!'); } else if (awayActiveCount >= 5) { awayScore += 8; awayFactors.push('Kritik eşik!'); } else if (awayActiveCount >= 4) { awayScore += 5; } else if (awayActiveCount >= 3) { awayScore += 2; }

  const allFactors = [...new Set([...sharedFactors, ...homeFactors, ...awayFactors])];

  // Goal cooldown
  if (goalCooldownHome < 1 || goalCooldownAway < 1) {
    if (recentGoalSide === 'home') { homeScore = Math.round(homeScore * goalCooldownHome * 0.3); awayScore = Math.round(awayScore * Math.max(goalCooldownAway, goalCooldownHome * 0.6)); }
    else if (recentGoalSide === 'away') { awayScore = Math.round(awayScore * goalCooldownAway * 0.3); homeScore = Math.round(homeScore * Math.max(goalCooldownHome, goalCooldownAway * 0.6)); }
    else if (recentGoalSide === 'both') { homeScore = Math.round(homeScore * goalCooldownHome * 0.3); awayScore = Math.round(awayScore * goalCooldownAway * 0.3); }
    if (recentGoalSide && (homeScore >= 20 || awayScore >= 20)) { const goalSideLabel = recentGoalSide === 'home' ? 'Ev sahibi' : recentGoalSide === 'away' ? 'Deplasman' : 'Her iki'; allFactors.push(`Gol sonrası soğuma (${goalSideLabel})`); }
  }

  homeScore = Math.round(homeScore * minuteMultiplier);
  awayScore = Math.round(awayScore * minuteMultiplier);

  // Odds movement boost
  if (oddsMovementBoost && oddsMovementBoost.significance !== 'none') {
    if (oddsMovementBoost.homeBoost > 0) { homeScore = Math.min(100, homeScore + oddsMovementBoost.homeBoost); homeFactors.push(`Oran düşüşü ev +${oddsMovementBoost.homeBoost}`); }
    if (oddsMovementBoost.awayBoost > 0) { awayScore = Math.min(100, awayScore + oddsMovementBoost.awayBoost); awayFactors.push(`Oran düşüşü dep +${oddsMovementBoost.awayBoost}`); }
    if (oddsMovementBoost.significance === 'critical' || oddsMovementBoost.significance === 'high') sharedFactors.push(`Piyasa sinyali: ${oddsMovementBoost.significance}`);
    try {
      const { calculateOddsF8Compound, calibrateF8 } = require('./smartCalibration');
      const cal = calibrateF8(leagueId ?? null);
      const compound = calculateOddsF8Compound(cal, oddsMovementBoost.significance as 'none' | 'low' | 'medium' | 'high' | 'critical', minNum, oddsMovementBoost.homeBoost, oddsMovementBoost.awayBoost);
      if (compound.homeCompoundPts > 0 || compound.awayCompoundPts > 0) { homeScore = Math.min(100, homeScore + compound.homeCompoundPts); awayScore = Math.min(100, awayScore + compound.awayCompoundPts); if (compound.homeCompoundPts >= 2) homeFactors.push(`Oran+F8 bileşik +${compound.homeCompoundPts}`); if (compound.awayCompoundPts >= 2) awayFactors.push(`Oran+F8 bileşik +${compound.awayCompoundPts}`); }
    } catch { /* fallback */ }
  }

  homeScore = Math.min(100, homeScore);
  awayScore = Math.min(100, awayScore);
  const score = Math.max(homeScore, awayScore);

  // Factor 17: Card advantage
  const homeYellowCards = stats.yellow_cards?.home ?? 0, awayYellowCards = stats.yellow_cards?.away ?? 0;
  const homeRedCards = (stats.red_cards?.home ?? 0) + ((stats as any).two_yellow_red?.home ?? 0);
  const awayRedCards = (stats.red_cards?.away ?? 0) + ((stats as any).two_yellow_red?.away ?? 0);
  if (awayRedCards > 0) { homeScore += 18; homeFactors.push(`Rakip kırmızı kart! (+18)`); }
  if (homeRedCards > 0) { awayScore += 18; awayFactors.push(`Rakip kırmızı kart! (+18)`); }
  if (homeRedCards > 0) { homeScore = Math.max(0, homeScore - 22); homeFactors.push(`Kırmızı kart dezavantajı (-22)`); }
  if (awayRedCards > 0) { awayScore = Math.max(0, awayScore - 22); awayFactors.push(`Kırmızı kart dezavantajı (-22)`); }
  if (awayYellowCards >= 2) { homeScore += Math.min(5, awayYellowCards * 2); if (awayYellowCards >= 3) homeFactors.push(`Rakip ${awayYellowCards} sarı kart`); }
  if (homeYellowCards >= 2) { awayScore += Math.min(5, homeYellowCards * 2); if (homeYellowCards >= 3) awayFactors.push(`Rakip ${homeYellowCards} sarı kart`); }

  // Set-piece threat spike
  if (pressureHistory && pressureHistory.length >= 6) {
    const window6 = pressureHistory.slice(-6), wFirst = window6[0], wLast = window6[window6.length - 1];
    const homeFKJump = (wLast.stats.free_kicks?.home ?? 0) - (wFirst.stats.free_kicks?.home ?? 0);
    const awayFKJump = (wLast.stats.free_kicks?.away ?? 0) - (wFirst.stats.free_kicks?.away ?? 0);
    const homeDARecent = (wLast.stats.dangerous_attacks?.home ?? 0) - (wFirst.stats.dangerous_attacks?.home ?? 0);
    const awayDARecent = (wLast.stats.dangerous_attacks?.away ?? 0) - (wFirst.stats.dangerous_attacks?.away ?? 0);
    if (homeFKJump >= 1 && homeDARecent >= 2) { homeScore += 8; homeFactors.push('Serbest vuruş tehdidi!'); }
    if (awayFKJump >= 1 && awayDARecent >= 2) { awayScore += 8; awayFactors.push('Serbest vuruş tehdidi!'); }
    const homeCardJump = (wLast.stats.yellow_cards?.home ?? 0) - (wFirst.stats.yellow_cards?.home ?? 0) + ((wLast.stats.red_cards?.home ?? 0) - (wFirst.stats.red_cards?.home ?? 0));
    const awayCardJump = (wLast.stats.yellow_cards?.away ?? 0) - (wFirst.stats.yellow_cards?.away ?? 0) + ((wLast.stats.red_cards?.away ?? 0) - (wFirst.stats.red_cards?.away ?? 0));
    if (awayCardJump >= 1 && homeDARecent >= 2) { homeScore += 5; homeFactors.push('Kart sonrası pozisyon'); }
    if (homeCardJump >= 1 && awayDARecent >= 2) { awayScore += 5; awayFactors.push('Kart sonrası pozisyon'); }
  }

  // Poisson anchor
  {
    const tRemaining = Math.max(1, 90 - minNum) / 90;
    const homeLambda = xg.home / Math.max(1, minNum), awayLambda = xg.away / Math.max(1, minNum);
    const homePoissonP = 1 - Math.exp(-homeLambda * (90 - minNum));
    const awayPoissonP = 1 - Math.exp(-awayLambda * (90 - minNum));
    const homePoissonPts = Math.round(homePoissonP * 100 * 0.20), awayPoissonPts = Math.round(awayPoissonP * 100 * 0.20);
    if (homePoissonPts >= 2) { homeScore += Math.min(10, homePoissonPts); if (homePoissonPts >= 5) homeFactors.push(`Poisson taban ${(homePoissonP * 100).toFixed(0)}% → +${homePoissonPts}`); }
    if (awayPoissonPts >= 2) { awayScore += Math.min(10, awayPoissonPts); if (awayPoissonPts >= 5) awayFactors.push(`Poisson taban ${(awayPoissonP * 100).toFixed(0)}% → +${awayPoissonPts}`); }
  }

  // Bayesian win-prob update
  {
    const scoreDiff = (currentHomeGoals ?? 0) - (currentAwayGoals ?? 0);
    const minutePct = minNum / 90;
    let homeWinAdj = 0, awayWinAdj = 0;
    if (scoreDiff < 0) { if (minutePct > 0.8) { homeWinAdj = -5; awayWinAdj = 5; } else homeWinAdj = 3; }
    else if (scoreDiff > 0) { if (minutePct > 0.8) { homeWinAdj = 5; awayWinAdj = -5; } else awayWinAdj = 3; }
    homeWinAdj -= homeRedCards * 3 + homeYellowCards * 0.5;
    awayWinAdj -= awayRedCards * 3 + awayYellowCards * 0.5;
    homeScore += Math.round(homeWinAdj * 0.30);
    awayScore += Math.round(awayWinAdj * 0.30);
  }

  // Elo rating adjustment
  let eloAdj: { homeAdj: number; awayAdj: number } | null = null;
  if (homeTeam && awayTeam) {
    try {
      const { eloGoalAdjustment } = require('./eloRating');
      eloAdj = eloGoalAdjustment(homeTeam, awayTeam);
      if (eloAdj) { homeScore += eloAdj.homeAdj; awayScore += eloAdj.awayAdj; if (Math.abs(eloAdj.homeAdj) >= 4) homeFactors.push(`Elo ${eloAdj.homeAdj > 0 ? '+' : ''}${eloAdj.homeAdj}`); if (Math.abs(eloAdj.awayAdj) >= 4) awayFactors.push(`Elo ${eloAdj.awayAdj > 0 ? '+' : ''}${eloAdj.awayAdj}`); }
    } catch { /* Elo module not available yet */ }
  }

  // Threshold + side determination
  const RADAR_THRESHOLD = 60, SUSTAINED_THRESHOLD = 55;
  let side: GoalProbability['side'] = null;
  const homeNeedsSustained = homeScore >= SUSTAINED_THRESHOLD && homeScore < RADAR_THRESHOLD;
  const awayNeedsSustained = awayScore >= SUSTAINED_THRESHOLD && awayScore < RADAR_THRESHOLD;
  const homeSustainedOk = homeNeedsSustained ? (pressureHistory && pressureHistory.length >= 3 && pressureHistory.slice(-3).filter(s => s.homePressure > 55).length >= 2) : true;
  const awaySustainedOk = awayNeedsSustained ? (pressureHistory && pressureHistory.length >= 3 && pressureHistory.slice(-3).filter(s => s.awayPressure > 55).length >= 2) : true;
  if (homeScore >= 60 && awayScore >= 60) side = 'both';
  else if (homeScore >= 60 || (homeNeedsSustained && homeSustainedOk)) side = 'home';
  else if (awayScore >= 60 || (awayNeedsSustained && awaySustainedOk)) side = 'away';
  if (side === 'home' && (awayScore >= 60 || (awayNeedsSustained && awaySustainedOk))) side = 'both';
  if (side === 'away' && (homeScore >= 60 || (homeNeedsSustained && homeSustainedOk))) side = 'both';

  let level: GoalProbability['level'] = 'low';
  if (score >= 75) level = 'critical';
  else if (score >= 55) level = 'high';
  else if (score >= RADAR_THRESHOLD) level = 'medium';

  homeScore = Math.max(0, Math.min(85, homeScore));
  awayScore = Math.max(0, Math.min(85, awayScore));
  const clampedScore = Math.max(homeScore, awayScore);

  // Dixon-Coles Poisson blend
  let poissonP = 0, overUnder25 = 0, bttsP = 0;
  try {
    const { inPlayGoalProbability, calculateExpectedGoals, calculateMatchProbabilities } = require('./dixonColes');
    const poissonResult = inPlayGoalProbability(xg.home, xg.away, minNum);
    poissonP = poissonResult.anyGoalP;
    const homeAttackStrength = xg.home > 0 ? (xg.home / Math.max(1, minNum)) * 90 / 1.30 : 1.0;
    const awayAttackStrength = xg.away > 0 ? (xg.away / Math.max(1, minNum)) * 90 / 1.30 : 1.0;
    const params = calculateExpectedGoals(homeAttackStrength, 1.0, awayAttackStrength, 1.0);
    const matchProbs = calculateMatchProbabilities(params);
    overUnder25 = matchProbs.overUnder[2.5]?.over ?? 0;
    bttsP = matchProbs.btts.yes;
    homeScore = Math.round(homeScore * 0.75 + poissonResult.homeGoalP * 100 * 0.25);
    awayScore = Math.round(awayScore * 0.75 + poissonResult.awayGoalP * 100 * 0.25);
  } catch { /* fallback */ }

  // Probability calibration
  let calibratedP = 0;
  try {
    const { calibrateScore } = require('./calibration');
    calibratedP = calibrateScore(clampedScore);
  } catch { calibratedP = Math.min(0.80, clampedScore / 100); }

  // Time multiplier
  let timeMultiplier = 1.0;
  try {
    const { getTimeBasedGoalMultiplier } = require('./dixonColes');
    timeMultiplier = getTimeBasedGoalMultiplier(minNum);
  } catch { /* fallback */ }

  let finalHomeScore = Math.round(Math.max(0, Math.min(85, Math.round(homeScore * timeMultiplier))));
  let finalAwayScore = Math.round(Math.max(0, Math.min(85, Math.round(awayScore * timeMultiplier))));
  let finalScore = Math.max(finalHomeScore, finalAwayScore);

  if (finalScore >= 75) level = 'critical';
  else if (finalScore >= 55) level = 'high';
  else if (finalScore >= RADAR_THRESHOLD) level = 'medium';
  else level = 'low';

  // 5-minute goal probability
  let goalProbability5min = 0;
  try {
    const homeXgRate = xg.home / Math.max(1, minNum), awayXgRate = xg.away / Math.max(1, minNum);
    const totalXgRate = homeXgRate + awayXgRate;
    const lambda5min = totalXgRate * 5;
    goalProbability5min = 1 - Math.exp(-lambda5min);
    const minuteScale = minNum <= 15 ? 0.7 : minNum <= 45 ? 1.0 : minNum <= 75 ? 1.15 : 1.35;
    goalProbability5min *= minuteScale;
    goalProbability5min = Math.min(0.95, goalProbability5min);
  } catch { /* fallback */ }

  const SIGNAL_5MIN_THRESHOLD = 0.25;
  if (goalProbability5min < SIGNAL_5MIN_THRESHOLD && level !== 'critical') {
    level = 'low'; side = null;
    if (finalScore < 75) { finalScore = Math.min(finalScore, RADAR_THRESHOLD - 1); finalHomeScore = Math.min(finalHomeScore, RADAR_THRESHOLD - 1); finalAwayScore = Math.min(finalAwayScore, RADAR_THRESHOLD - 1); }
  }

  return {
    score: finalScore, homeScore: finalHomeScore, awayScore: finalAwayScore, side, level,
    factors: allFactors, calibratedP, poissonP, eloAdj, overUnder25, btts: bttsP, timeMultiplier, goalProbability5min,
  };
}
