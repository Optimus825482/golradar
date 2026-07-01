// ── Goal Probability Radar System ──────────────────────────────────
// Orchestration layer: calls independent factor functions from
// goalRadar/factors.ts, then applies post-processing blend.

import type { MatchStats } from './nesineTypes';
import { estimateXgFromShots } from './estimateXg';
import { eloGoalAdjustment, getRating } from './eloRating';
import {
  extractMatchIntelligence,
  formationGoalMultiplier,
  formScoreAdjustment,
} from './fotmobIntelligence';
import { calculateOddsF8Compound, calibrateF8Sync, loadCalibrationModeSync } from './smartCalibration';
import { inPlayGoalProbability, calculateExpectedGoals, calculateMatchProbabilities } from './dixonColes';
import {
  applyCorrector,
  buildBasePoissonMatrix,
  deriveStats as deriveCorrectorStats,
  DEFAULT_CORRECTOR_PARAMS,
  type CorrectorParams,
} from './dixonColesCorrector';
import { calibrateScore } from './calibration';
import { logError } from '@/lib/devLog';
import { SIGNAL_5MIN_THRESHOLD, ENSEMBLE_SCORE_CAP, RADAR_THRESHOLD } from '@/config';
import { determineSide } from './goalRadar/side';
import { computeTrendBoost } from './ml/trendLSTM';
import { detectGoalCooldown, applyGoalCooldown } from './goalRadar/cooldown';
import { computeMomentumBoost } from './goalRadar/momentum';
import type { PressureSnapshotLite, GoalProbability } from './goalRadar/types';
import { parseMinute } from './goalSignalTracker';
import {
  calcExpectedGoals,
  calcMinuteMultiplier,
  calcConcurrentThreat,
  calcScoreSituation,
  calcBayesianAdjustment,
  calcFactorNetScores,
  calcFactorPressure,
  calcFactorDangerousAttack,
  calcFactorShotQuality,
  calcFactorXgAccumulation,
  calcFactorSpikeDetection,
  calcFactorMomentum,
  calcFactorSustainedPressure,
  calcFactorCornerSetPiece,
  calcFactorXgDominance,
  calcFactorCompositeThreat,
  calcFactorXgFlow,
  calcFactorDangerousSequence,
  calcFactorPassQuality,
  calcFactorGoalkeeper,
  calcFactorOffside,
  calcFactorCardAdvantage,
  calcFactorSetPieceThreat,
} from './goalRadar/factors';

// ── Goaloo canlı zenginleştirme verisi (opsiyonel) ──────────────
export interface GoalooEnrichment {
  oddsMovement?: {
    homeBoost: number;
    awayBoost: number;
    significance: string;
  } | null;
  momentumTrend?: {
    homeAvg: number;
    awayAvg: number;
    homeDirection: 'rising' | 'falling' | 'stable';
    awayDirection: 'rising' | 'falling' | 'stable';
  } | null;
}

// ── Apply helper: factor result'u ctx'e ekle ────────────────────
function apply(
  ctx: { hs: number; as: number; hf: string[]; af: string[]; sf: string[]; pf: string[] },
  r: { homePts: number; awayPts: number; homeFactors: string[]; awayFactors: string[]; sharedFactors: string[] },
) {
  ctx.hs += r.homePts;
  ctx.as += r.awayPts;
  ctx.hf.push(...r.homeFactors);
  ctx.af.push(...r.awayFactors);
  ctx.sf.push(...r.sharedFactors);
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
  oddsMovementBoost?: {
    homeBoost: number;
    awayBoost: number;
    significance: string;
  } | null,
  leagueId?: number | null,
  fotmobData?: import('./fotmob').FotMobMatchDetails | null,
  goalooData?: GoalooEnrichment | null,
): GoalProbability {
  const emptyResult: GoalProbability = {
    score: 0, homeScore: 0, awayScore: 0, side: null, level: 'low',
    factors: [], calibratedP: 0, poissonP: 0, eloAdj: null,
    overUnder25: 0, btts: 0, timeMultiplier: 1.0, goalProbability5min: 0,
  };
  if (!isLive) return emptyResult;

  const _calMode = loadCalibrationModeSync();
  const { goalCooldownHome, goalCooldownAway, recentGoalSide } = detectGoalCooldown(
    pressureHistory, currentHomeGoals, currentAwayGoals,
  );

  // ── Context ───────────────────────────────────────────────────
  const ctx = { hs: 0, as: 0, hf: [] as string[], af: [] as string[], sf: [] as string[], pf: [] as string[] };
  const blendedThreatScore = (h: number, a: number): number =>
    Math.round(0.7 * Math.max(h, a) + 0.3 * ((h + a) / 2));

  let minNum = parseMinute(minute);
  if (minNum === 0) minNum = 1;
  if (minNum < 5) minNum = 5;

  const xg = calcExpectedGoals(stats);

  // ── Faktörler (sıralı, bağımsız) ──────────────────────────────
  apply(ctx, calcFactorPressure(stats));
  apply(ctx, calcFactorDangerousAttack(stats, minNum));
  apply(ctx, calcFactorShotQuality(stats, minNum));
  apply(ctx, calcFactorXgAccumulation(xg, minNum));
  if (pressureHistory) apply(ctx, calcFactorSpikeDetection(pressureHistory));
  if (pressureHistory) apply(ctx, calcFactorMomentum(pressureHistory));
  if (pressureHistory) apply(ctx, calcFactorSustainedPressure(pressureHistory));
  apply(ctx, calcFactorCornerSetPiece(stats, minNum));
  apply(ctx, calcFactorXgDominance(xg));
  apply(ctx, calcFactorCompositeThreat(stats, minNum, pressureHistory));
  if (pressureHistory) apply(ctx, calcFactorXgFlow(pressureHistory, minNum));
  if (pressureHistory) apply(ctx, calcFactorDangerousSequence(pressureHistory));
  apply(ctx, calcFactorPassQuality(stats));
  apply(ctx, calcFactorGoalkeeper(stats));
  apply(ctx, calcFactorOffside(stats));
  apply(ctx, calcFactorCardAdvantage(stats));
  if (pressureHistory) apply(ctx, calcFactorSetPieceThreat(pressureHistory));
  apply(ctx, calcScoreSituation(currentHomeGoals ?? 0, currentAwayGoals ?? 0, minNum));
  apply(ctx, calcFactorNetScores(fotmobData));

  // ── Concurrent threat multiplier ──────────────────────────────
  const ht = calcConcurrentThreat(ctx.hf.length);
  const at = calcConcurrentThreat(ctx.af.length);
  ctx.hs += ht.pts; if (ht.label) ctx.hf.push(ht.label);
  ctx.as += at.pts; if (at.label) ctx.af.push(at.label);

  // ── Goal cooldown ─────────────────────────────────────────────
  const cd = applyGoalCooldown(ctx.hs, ctx.as, goalCooldownHome, goalCooldownAway, recentGoalSide);
  ctx.hs = cd.homeScore; ctx.as = cd.awayScore;
  if (cd.factors.length > 0) ctx.pf.push(...cd.factors);

  // ── Minute multiplier (F8) ────────────────────────────────────
  const minuteMultiplier = /\d/.test(minute) ? calcMinuteMultiplier(minNum, leagueId) : 1.0;
  ctx.hs = Math.round(ctx.hs * minuteMultiplier);
  ctx.as = Math.round(ctx.as * minuteMultiplier);

  // ── Odds movement boost ───────────────────────────────────────
  if (oddsMovementBoost && oddsMovementBoost.significance !== 'none') {
    if (oddsMovementBoost.homeBoost > 0) {
      ctx.hs = Math.min(100, ctx.hs + oddsMovementBoost.homeBoost);
      ctx.hf.push(`Oran düşüşü ev +${oddsMovementBoost.homeBoost}`);
    }
    if (oddsMovementBoost.awayBoost > 0) {
      ctx.as = Math.min(100, ctx.as + oddsMovementBoost.awayBoost);
      ctx.af.push(`Oran düşüşü dep +${oddsMovementBoost.awayBoost}`);
    }
    if (oddsMovementBoost.significance === 'critical' || oddsMovementBoost.significance === 'high')
      ctx.sf.push(`Piyasa sinyali: ${oddsMovementBoost.significance}`);
    try {
      const cal = calibrateF8Sync(leagueId ?? null, _calMode);
      const compound = calculateOddsF8Compound(
        cal,
        oddsMovementBoost.significance as 'none' | 'low' | 'medium' | 'high' | 'critical',
        minNum,
        oddsMovementBoost.homeBoost,
        oddsMovementBoost.awayBoost,
      );
      if (compound.homeCompoundPts > 0 || compound.awayCompoundPts > 0) {
        ctx.hs = Math.min(100, ctx.hs + compound.homeCompoundPts);
        ctx.as = Math.min(100, ctx.as + compound.awayCompoundPts);
        if (compound.homeCompoundPts >= 2) ctx.hf.push(`Oran+F8 bileşik +${compound.homeCompoundPts}`);
        if (compound.awayCompoundPts >= 2) ctx.af.push(`Oran+F8 bileşik +${compound.awayCompoundPts}`);
      }
    } catch (e) { logError('goalRadar', e); }
  }

  // ── Momentum burst (P2) ──────────────────────────────────────
  try {
    const mm = computeMomentumBoost(pressureHistory, minNum);
    ctx.hs += mm.homeBoost; ctx.as += mm.awayBoost;
    ctx.hf.push(...mm.homeFactors); ctx.af.push(...mm.awayFactors);
  } catch { /* momentum optional */ }

  // ── Bayesian win-prob adjustment ──────────────────────────────
  const homeYellowCards = stats.yellow_cards?.home ?? 0;
  const awayYellowCards = stats.yellow_cards?.away ?? 0;
  const homeRedCards = (stats.red_cards?.home ?? 0) + (stats.two_yellow_red?.home ?? 0);
  const awayRedCards = (stats.red_cards?.away ?? 0) + (stats.two_yellow_red?.away ?? 0);
  const bayesAdj = calcBayesianAdjustment(
    currentHomeGoals ?? 0, currentAwayGoals ?? 0, minNum,
    homeRedCards, awayRedCards, homeYellowCards, awayYellowCards,
  );
  ctx.hs += bayesAdj.homeAdj; ctx.as += bayesAdj.awayAdj;

  // ── Elo adjustment ────────────────────────────────────────────
  let eloAdj: { homeAdjust: number; awayAdjust: number } | null = null;
  if (homeTeam && awayTeam) {
    try {
      eloAdj = eloGoalAdjustment(homeTeam, awayTeam);
      if (eloAdj) {
        ctx.hs += eloAdj.homeAdjust; ctx.as += eloAdj.awayAdjust;
        if (Math.abs(eloAdj.homeAdjust) >= 4)
          ctx.hf.push(`Elo ${eloAdj.homeAdjust > 0 ? '+' : ''}${eloAdj.homeAdjust}`);
        if (Math.abs(eloAdj.awayAdjust) >= 4)
          ctx.af.push(`Elo ${eloAdj.awayAdjust > 0 ? '+' : ''}${eloAdj.awayAdjust}`);
        const homeRating = getRating(homeTeam);
        const awayRating = getRating(awayTeam);
        const homeReliable = homeRating && homeRating.matchesPlayed > 10;
        const awayReliable = awayRating && awayRating.matchesPlayed > 10;
        if (homeReliable && eloAdj.homeAdjust >= 5) { ctx.hs += 2; ctx.hf.push('Form güçlü'); }
        if (awayReliable && eloAdj.awayAdjust >= 5) { ctx.as += 2; ctx.af.push('Form güçlü'); }
        if (!homeReliable && eloAdj.homeAdjust < -4) ctx.hs = Math.max(0, ctx.hs - 1);
        if (!awayReliable && eloAdj.awayAdjust < -4) ctx.as = Math.max(0, ctx.as - 1);
      }
    } catch (err) {
      if (process.env.NODE_ENV === 'development')
        console.warn('[GoalRadar] Elo prior unavailable:', (err as Error).message);
    }
  }

  // ── Side determination ───────────────────────────────────────
  let side: GoalProbability['side'] = determineSide(ctx.hs, ctx.as, pressureHistory);

  // ── Clamp ─────────────────────────────────────────────────────
  ctx.hs = Math.max(0, Math.min(ENSEMBLE_SCORE_CAP, ctx.hs));
  ctx.as = Math.max(0, Math.min(ENSEMBLE_SCORE_CAP, ctx.as));

  // ── Poisson blend ─────────────────────────────────────────────
	  let poissonP = 0, overUnder25 = 0, bttsP = 0;
	  try {
	    const safeXgHome = Math.max(0, xg.home ?? 0);
	    const safeXgAway = Math.max(0, xg.away ?? 0);
	    const pr = inPlayGoalProbability(safeXgHome, safeXgAway, minNum);
	    poissonP = Math.max(0, Math.min(0.99, pr.anyGoalP));
    const homeAS = xg.home > 0 ? ((xg.home / Math.max(1, minNum)) * 90) / 1.3 : 1.0;
    const awayAS = xg.away > 0 ? ((xg.away / Math.max(1, minNum)) * 90) / 1.3 : 1.0;
    const params = calculateExpectedGoals(homeAS, 1.0, awayAS, 1.0);
    const mp = calculateMatchProbabilities(params);
    overUnder25 = mp.overUnder[2.5]?.over ?? 0;
    bttsP = mp.btts.yes;

    // Faz 5 / Yol D — Dixon-Coles corrector (Frank's Copula / ZISM).
    // ENV gate: ENABLE_ZISM_CORRECTOR=true. Kapalıyken corrector uygulanmaz
    // (mevcut davranışla birebir aynı; sinyal sayısı invariant).
    // SKOR_KAPPA, ZISM_BETA env flag'leri sırasıyla κ ve β'yi override eder.
    // Faz 5 — ZISM Corrector. Default AÇIK. env=false ile kapat.
    if (process.env.ZISM_CORRECTOR !== 'false') {
      const correctorParams: CorrectorParams = {
        mode: (process.env.ZISM_MODE as 'off' | 'frank' | 'zism') ?? 'frank',
        kappa: parseFloat(process.env.SKOR_KAPPA ?? '-0.30'),
        beta: parseFloat(process.env.ZISM_BETA ?? '0.10'),
      };
      const baseMatrix = buildBasePoissonMatrix(mp.params?.lambdaHome ?? homeAS, mp.params?.lambdaAway ?? awayAS, 5);
      const corrected = applyCorrector(baseMatrix, correctorParams);
      const stats = deriveCorrectorStats(corrected);
      // Corrector uygulanmış over/under + BTTS kullan (Dixon-Coles rho/gamma
      // corrector'ından zenginleştirilmiş). Yumuşak blend: %50 corrector etkisi.
      overUnder25 = 0.5 * overUnder25 + 0.5 * stats.over25;
      bttsP = 0.5 * bttsP + 0.5 * stats.btts;
      // Corrector corrector corrector corrector cap (sinyal sayısı korunması
      // için): btts ve overUnder25'i %5 bound içinde tutar.
      overUnder25 = Math.max(0.01, Math.min(0.99, overUnder25));
      bttsP = Math.max(0.01, Math.min(0.99, bttsP));
    }

    const bw = minNum < 30 ? 0.15 : minNum < 60 ? 0.12 : minNum < 75 ? 0.10 : 0.08;
    ctx.hs = Math.round(ctx.hs * (1 - bw) + pr.homeGoalP * 100 * bw);
    ctx.as = Math.round(ctx.as * (1 - bw) + pr.awayGoalP * 100 * bw);
  } catch (e) { logError('goalRadar', e); }

  // ── LSTM trend boost ─────────────────────────────────────────
  try {
    const pw = (pressureHistory ?? []).map(s => [s.homePressure ?? 50, s.awayPressure ?? 50] as [number, number]);
    if (pw.length >= 3) {
      const tb = computeTrendBoost({ windows: pw, minute: minNum });
      if (tb > 0) {
        const lp = pressureHistory![pressureHistory!.length - 1].homePressure;
        const la = pressureHistory![pressureHistory!.length - 1].awayPressure;
        const bs = tb * 100;
        if (lp > la + 10) ctx.hs = Math.min(ENSEMBLE_SCORE_CAP, Math.round(ctx.hs + bs));
        else if (la > lp + 10) ctx.as = Math.min(ENSEMBLE_SCORE_CAP, Math.round(ctx.as + bs));
        else { const h = Math.round(bs / 2); ctx.hs = Math.min(ENSEMBLE_SCORE_CAP, Math.round(ctx.hs + h)); ctx.as = Math.min(ENSEMBLE_SCORE_CAP, Math.round(ctx.as + h)); }
      }
    }
  } catch { /* LSTM optional */ }

  // ── Final clamp ──────────────────────────────────────────────
  ctx.hs = Math.max(0, Math.min(ENSEMBLE_SCORE_CAP, ctx.hs));
  ctx.as = Math.max(0, Math.min(ENSEMBLE_SCORE_CAP, ctx.as));
  const finalHomeScore = ctx.hs;
  const finalAwayScore = ctx.as;
  let finalScore = blendedThreatScore(finalHomeScore, finalAwayScore);

  // ── 5-minute goal probability ────────────────────────────────
  let goalProbability5min = 0;
  try {
    const hxr = estimateXgFromShots(stats, 'home', minNum);
    const axr = estimateXgFromShots(stats, 'away', minNum);
    goalProbability5min = Math.min(0.95, 1 - Math.exp(-Math.max(0, (hxr + axr) * 5)));
  } catch { /* fallback */ }

  // ── Level determination + multi-confirmation gate ─────────────
  let level: GoalProbability['level'] = 'low';
  if (finalScore >= 80) {
    const xgThreat = xg.home > 0.4 || xg.away > 0.4;
    const possessionHigh = (stats.possession?.home ?? 50) > 55 || (stats.possession?.away ?? 50) > 55;
    const daHigh = (stats.dangerous_attacks?.home ?? 0) > 5 || (stats.dangerous_attacks?.away ?? 0) > 5;
    const pressure = possessionHigh || daHigh;
    const factorsConfirm = (ctx.hf.length + ctx.af.length) >= 3;
    const goalProbConfirm = goalProbability5min >= 0.20;
    const confirms = [xgThreat, pressure, factorsConfirm, goalProbConfirm];
    level = confirms.filter(Boolean).length >= 3 ? 'critical' : 'high';
  } else if (finalScore >= 70) level = 'high';
  else if (finalScore >= 60) level = 'medium';

  // ── FotMob Intelligence Integration ────────────────────────────
  if (fotmobData) {
    try {
      const intel = extractMatchIntelligence(fotmobData);
      if (intel.weatherImpact.multiplier !== 1.0) {
        ctx.hs = Math.round(ctx.hs * intel.weatherImpact.multiplier);
        ctx.as = Math.round(ctx.as * intel.weatherImpact.multiplier);
        if (intel.weatherImpact.factors.length > 0) ctx.sf.push(...intel.weatherImpact.factors);
      }
      if (intel.squadImpact.homeAdj !== 0 || intel.squadImpact.awayAdj !== 0) {
        ctx.hs = Math.max(0, Math.min(85, ctx.hs + intel.squadImpact.homeAdj));
        ctx.as = Math.max(0, Math.min(85, ctx.as + intel.squadImpact.awayAdj));
        ctx.hf.push(...intel.squadImpact.factors.filter(f => f.includes('Ev')));
        ctx.af.push(...intel.squadImpact.factors.filter(f => f.includes('Dep')));
      }
      if (intel.h2h && intel.h2h.avgGoals >= 3.0 && intel.h2h.recentMatches >= 3) {
        ctx.hs += 2; ctx.as += 2;
        ctx.sf.push(`H2H yüksek gol (${intel.h2h.avgGoals.toFixed(1)}/maç)`);
      } else if (intel.h2h && intel.h2h.avgGoals <= 1.5 && intel.h2h.recentMatches >= 3) {
        ctx.hs = Math.max(0, ctx.hs - 1); ctx.as = Math.max(0, ctx.as - 1);
        ctx.sf.push(`H2H düşük gol (${intel.h2h.avgGoals.toFixed(1)}/maç)`);
      }
      if (intel.form) {
        const hfa = formScoreAdjustment(intel.form.home);
        if (hfa.adj !== 0) { ctx.hs = Math.max(0, Math.min(85, ctx.hs + hfa.adj)); if (hfa.factors.length > 0) ctx.hf.push(...hfa.factors); }
        const afa = formScoreAdjustment(intel.form.away);
        if (afa.adj !== 0) { ctx.as = Math.max(0, Math.min(85, ctx.as + afa.adj)); if (afa.factors.length > 0) ctx.af.push(...afa.factors); }
      }
      if (intel.squad) {
        const hf = intel.squad.homeFormation;
        if (hf) { const fm = formationGoalMultiplier(hf); if (fm.attackMult !== 1.0) { ctx.hs = Math.max(0, Math.min(85, ctx.hs + Math.round((fm.attackMult - 1) * 10))); if (fm.description) ctx.hf.push(fm.description); } }
        const _af = intel.squad.awayFormation;
        if (_af) { const fm = formationGoalMultiplier(_af); if (fm.attackMult !== 1.0) { ctx.as = Math.max(0, Math.min(85, ctx.as + Math.round((fm.attackMult - 1) * 10))); if (fm.description) ctx.af.push(fm.description); } }
      }
    } catch (err) {
      if (process.env.NODE_ENV === 'development')
        console.warn('[GoalRadar] FotMob intel processing failed:', (err as Error).message);
    }

    // ── FotMob shot-level xG ──────────────────────────────────────
    try {
      const shotmap = fotmobData.shotmap;
      if (shotmap && Array.isArray(shotmap) && shotmap.length > 0) {
        let fXgH = 0, fXgA = 0;
        for (const shot of shotmap) {
          if (shot.expectedGoals != null) {
            if (shot.teamId === fotmobData.homeTeam?.id) fXgH += shot.expectedGoals;
            else fXgA += shot.expectedGoals;
          }
        }
        if (fXgH > xg.home) { const bp = Math.min(5, Math.round((fXgH - xg.home) * 7)); if (bp >= 2) { ctx.hs += bp; ctx.hf.push(`FotMob xG +${fXgH.toFixed(2)}`); } }
        if (fXgA > xg.away) { const bp = Math.min(5, Math.round((fXgA - xg.away) * 7)); if (bp >= 2) { ctx.as += bp; ctx.af.push(`FotMob xG +${fXgA.toFixed(2)}`); } }
      }
    } catch { /* FotMob xG optional */ }
  }

  // ── Goaloo momentum ────────────────────────────────────────────
  try {
    const gmt = goalooData?.momentumTrend;
    if (gmt) {
      if (gmt.homeAvg > 65 && gmt.homeDirection === 'rising') { const pts = Math.min(8, Math.round((gmt.homeAvg - 60) * 0.4)); ctx.hs += pts; if (pts >= 3) ctx.hf.push(`Goaloo momentum ${Math.round(gmt.homeAvg)}`); }
      else if (gmt.homeAvg > 75) { const pts = Math.min(5, Math.round((gmt.homeAvg - 70) * 0.3)); ctx.hs += pts; if (pts >= 3) ctx.hf.push(`Goaloo momentum ${Math.round(gmt.homeAvg)}`); }
      if (gmt.awayAvg > 65 && gmt.awayDirection === 'rising') { const pts = Math.min(8, Math.round((gmt.awayAvg - 60) * 0.4)); ctx.as += pts; if (pts >= 3) ctx.af.push(`Goaloo momentum ${Math.round(gmt.awayAvg)}`); }
      else if (gmt.awayAvg > 75) { const pts = Math.min(5, Math.round((gmt.awayAvg - 70) * 0.3)); ctx.as += pts; if (pts >= 3) ctx.af.push(`Goaloo momentum ${Math.round(gmt.awayAvg)}`); }
    }
  } catch { /* Goaloo optional */ }

  // ── Son clamp + final score ───────────────────────────────────
  ctx.hs = Math.max(0, Math.min(ENSEMBLE_SCORE_CAP, ctx.hs));
  ctx.as = Math.max(0, Math.min(ENSEMBLE_SCORE_CAP, ctx.as));
  let finalFinalHome = Math.round(ctx.hs);
  let finalFinalAway = Math.round(ctx.as);
  const finalFinalScore = blendedThreatScore(finalFinalHome, finalFinalAway);

  // ── Calibrated probability (FotMob/Goaloo sonrası final score ile) ──
  let calibratedP: number;
  try { calibratedP = calibrateScore(finalFinalScore); }
  catch { calibratedP = 0.5; }

  // ── 5-min signal gate ─────────────────────────────────────────
  const isMomentumRising = ctx.hf.length + ctx.af.length >= 3;
  const baseThreshold = minNum <= 30 ? SIGNAL_5MIN_THRESHOLD : minNum <= 60 ? 0.20 : minNum <= 75 ? 0.12 : 0.08;
  const effectiveThreshold = isMomentumRising ? Math.max(0.06, baseThreshold - 0.04) : baseThreshold;
  const gateThreshold = level === 'critical' ? 0.06 : effectiveThreshold;

  if (goalProbability5min < gateThreshold) {
    level = 'low';
    side = null;
    if (finalFinalScore < RADAR_THRESHOLD) {
      finalScore = Math.min(finalFinalScore, 59);
      finalFinalHome = Math.min(finalFinalHome, 59);
      finalFinalAway = Math.min(finalFinalAway, 59);
    } else {
      finalScore = finalFinalScore;
    }
  } else {
    finalScore = finalFinalScore;
  }

  const allFactors = [...new Set([...ctx.sf, ...ctx.hf, ...ctx.af, ...ctx.pf])];

  return {
    score: finalScore,
    homeScore: finalFinalHome,
    awayScore: finalFinalAway,
    side,
    level,
    factors: allFactors,
    calibratedP,
    poissonP,
    eloAdj,
    overUnder25,
    btts: bttsP,
    timeMultiplier: 1.0,
    goalProbability5min,
  };
}

// ── Side helper re-export (geriye uyumluluk) ────────────────────
export { determineSide, determineSideByStats } from './goalRadar/side';
export type { PressureSnapshotLite, GoalProbability } from './goalRadar/types';
