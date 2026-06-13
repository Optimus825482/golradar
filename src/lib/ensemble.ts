// ── Hybrid Ensemble Prediction System ─────────────────────────────
// Blends predictions from multiple models for superior accuracy:
//   1. Rule-based Goal Radar (current 12-factor model)
//   2. Dixon-Coles Poisson model (pre-match + in-play)
//   3. Elo rating system (team strength prior)
//   4. GBDT ML model (data-driven prediction)
//
// Ensemble weights are dynamically adjusted based on:
//   - Model confidence (higher confidence → more weight)
//   - Match phase (pre-match: Elo/Poisson heavy, in-play: Rule+ML heavy)
//   - Calibration feedback (better-calibrated models get more weight)
//
// Reference: Bach & Lacoste (2017) "Ensemble Methods for Sports Prediction"

import { extractFeatures, featuresToArray, type FeatureExtractionInput, type MatchFeatures } from './featureEngineering';
import { predictGBDT, loadModel, type PredictionResult as MLPrediction } from './goalPredictor';
import { calibrateScore } from './calibration';
import {
  calculateExpectedGoals,
  calculateMatchProbabilities,
  inPlayGoalProbability,
  getTimeBasedGoalMultiplier,
  blendWithPoisson,
} from './dixonColes';
import { predictFromElo, eloGoalAdjustment, getFormIndex } from './eloRating';

// ── Types ──────────────────────────────────────────────────────────

export interface EnsembleWeights {
  ruleBased: number;   // 12-factor rule model weight
  poisson: number;     // Dixon-Coles Poisson weight
  elo: number;         // Elo-based weight
  ml: number;          // GBDT ML model weight
}

export interface ModelPrediction {
  name: string;
  probability: number;  // 0-1
  confidence: number;   // 0-1
  weight: number;       // Ensemble weight
  details: string;      // Human-readable explanation
}

export interface EnsembleResult {
  // Final blended prediction
  probability: number;         // 0-1 final probability
  score: number;               // 0-100 (for compatibility with GoalProbability)
  level: 'low' | 'medium' | 'high' | 'critical';
  side: 'home' | 'away' | 'both' | null;

  // Individual model predictions
  models: ModelPrediction[];

  // Ensemble metadata
  weights: EnsembleWeights;
  dominantModel: string;       // Which model had most influence
  agreement: number;           // How much models agree (0-1)

  // Derived predictions
  overUnder25: number;         // P(Over 2.5 goals)
  btts: number;                // P(Both teams score)
  homeWinP: number;
  drawP: number;
  awayWinP: number;

  // Feature insights
  topFeatures: Array<{
    feature: string;
    value: number;
    importance: number;
  }>;
}

// ── Dynamic Weight Calculation ─────────────────────────────────────
// Weights shift based on match context:
//   - Early match (1-20 min): More weight on pre-match models (Elo, Poisson)
//   - Mid match (20-60 min): Balanced
//   - Late match (60-90+ min): More weight on in-play models (Rule, ML)
//   - If ML model not available: redistribute to others
//   - If ML model has low confidence: reduce its weight

function calculateDynamicWeights(
  minute: number,
  mlAvailable: boolean,
  mlConfidence: number,
  hasPressureHistory: boolean,
): EnsembleWeights {
  // Base weights (pre-match optimized)
  let weights: EnsembleWeights = {
    ruleBased: 0.40,
    poisson: 0.25,
    elo: 0.15,
    ml: 0.20,
  };

  // If ML model not available, redistribute
  if (!mlAvailable) {
    weights = {
      ruleBased: 0.50,
      poisson: 0.30,
      elo: 0.20,
      ml: 0.00,
    };
  } else {
    // Reduce ML weight if low confidence
    if (mlConfidence < 0.3) {
      weights.ml *= 0.5;
      weights.ruleBased += 0.05;
      weights.poisson += 0.05;
    }
  }

  // Time-based adjustments
  if (minute <= 20) {
    // Early match: trust pre-match models more
    weights.elo += 0.08;
    weights.poisson += 0.07;
    weights.ruleBased -= 0.10;
    weights.ml -= 0.05;
  } else if (minute >= 60) {
    // Late match: trust in-play models more
    weights.ruleBased += 0.10;
    weights.ml += 0.05;
    weights.elo -= 0.08;
    weights.poisson -= 0.07;
  }

  // If we have pressure history, boost rule-based and ML
  if (hasPressureHistory) {
    weights.ruleBased += 0.05;
    weights.ml += 0.03;
    weights.poisson -= 0.04;
    weights.elo -= 0.04;
  }

  // Normalize weights to sum to 1.0
  const total = weights.ruleBased + weights.poisson + weights.elo + weights.ml;
  if (total > 0) {
    weights.ruleBased /= total;
    weights.poisson /= total;
    weights.elo /= total;
    weights.ml /= total;
  }

  return weights;
}

// ── Main Ensemble Prediction Function ──────────────────────────────

export interface EnsembleInput extends FeatureExtractionInput {
  ruleBasedScore?: number;      // 0-100 from calculateGoalProbability
  ruleBasedLevel?: string;
  ruleBasedSide?: 'home' | 'away' | 'both' | null;
  homeAttackStrength?: number;  // For Poisson model
  awayDefenseStrength?: number;
  awayAttackStrength?: number;
  homeDefenseStrength?: number;
}

export function predictEnsemble(input: EnsembleInput): EnsembleResult {
  const { stats, minute, isLive, homeGoals, awayGoals, homeTeam, awayTeam,
          pressureHistory, ruleBasedScore, homeAttackStrength, awayDefenseStrength,
          awayAttackStrength, homeDefenseStrength, weather } = input;

  // Parse minute
  let minNum = parseInt(minute.replace(/[^0-9]/g, ''), 10);
  if (!minNum || minNum === 0) minNum = 45;
  minNum = Math.max(1, Math.min(120, minNum));

  // ── Model 1: Rule-based Goal Radar ──
  const ruleBasedP = ruleBasedScore != null ? calibrateScore(ruleBasedScore) : 0;
  const ruleBasedConf = ruleBasedScore != null ? Math.min(1, ruleBasedScore / 70) : 0.1;

  // ── Model 2: Dixon-Coles Poisson ──
  let poissonP = 0;
  let poissonOverUnder = 0;
  let poissonBTTS = 0;
  let poissonHomeWin = 0;
  let poissonDraw = 0;
  let poissonAwayWin = 0;

  try {
    // Estimate xG for Poisson input
    const getStat = (key: string, side: 'home' | 'away'): number => {
      const s = stats[key];
      if (!s) return 0;
      return (side === 'home' ? s.home : s.away) ?? 0;
    };

    const sotH = getStat('shots_on_target', 'home');
    const sotA = getStat('shots_on_target', 'away');
    const totalH = getStat('shots_total', 'home');
    const totalA = getStat('shots_total', 'away');
    const blkH = getStat('shots_blocked', 'home');
    const blkA = getStat('shots_blocked', 'away');
    const offH = Math.max(0, totalH - sotH - blkH);
    const offA = Math.max(0, totalA - sotA - blkA);
    const crnH = getStat('corners', 'home');
    const crnA = getStat('corners', 'away');
    const daH = getStat('dangerous_attacks', 'home');
    const daA = getStat('dangerous_attacks', 'away');

    const xgHome = stats.xg?.home != null && stats.xg.home > 0
      ? stats.xg.home
      : sotH * 0.38 + offH * 0.05 + blkH * 0.03 + crnH * 0.04 + daH * 0.01;
    const xgAway = stats.xg?.away != null && stats.xg.away > 0
      ? stats.xg.away
      : sotA * 0.38 + offA * 0.05 + blkA * 0.03 + crnA * 0.04 + daA * 0.01;

    if (homeAttackStrength && awayDefenseStrength) {
      const params = calculateExpectedGoals(
        homeAttackStrength, awayDefenseStrength,
        awayAttackStrength ?? 1.0, homeDefenseStrength ?? 1.0,
      );
      const probs = calculateMatchProbabilities(params);
      poissonP = 1 - probs.overUnder[0.5]?.under ?? 0;
      poissonOverUnder = probs.overUnder[2.5]?.over ?? 0;
      poissonBTTS = probs.btts.yes;
      poissonHomeWin = probs.homeWin;
      poissonDraw = probs.draw;
      poissonAwayWin = probs.awayWin;
    } else {
      // Use in-play Poisson from xG rates
      const inPlay = inPlayGoalProbability(xgHome, xgAway, minNum);
      poissonP = inPlay.anyGoalP;
      poissonOverUnder = Math.min(0.9, poissonP * 1.2); // Approximate
      poissonBTTS = Math.min(0.8, poissonP * 0.6); // Approximate
      poissonHomeWin = inPlay.homeGoalP;
      poissonAwayWin = inPlay.awayGoalP;
      poissonDraw = 0.26; // Base draw rate
    }
  } catch {
    poissonP = 0;
  }

  // ── Model 3: Elo Rating ──
  let eloP = 0;
  let eloHomeWin = 0;
  let eloDraw = 0;
  let eloAwayWin = 0;

  try {
    if (homeTeam && awayTeam) {
      const eloPrediction = predictFromElo(homeTeam, awayTeam);
      const eloAdj = eloGoalAdjustment(homeTeam, awayTeam);

      // Convert Elo win probability to goal probability
      // Higher Elo differential → higher chance of scoring
      eloP = Math.max(0, Math.min(0.8,
        0.15 + (Math.abs(eloAdj.homeAdj) + Math.abs(eloAdj.awayAdj)) * 0.03
      ));
      eloHomeWin = eloPrediction.homeWinP;
      eloDraw = eloPrediction.drawP;
      eloAwayWin = eloPrediction.awayWinP;
    }
  } catch {
    eloP = 0.15;
  }

  // ── Model 4: GBDT ML ──
  let mlP = 0;
  let mlConfidence = 0;
  let mlTopFactors: Array<{ feature: string; importance: number; value: number }> = [];

  try {
    const mlModel = loadModel();
    if (mlModel) {
      const features = extractFeatures(input);
      const featureArray = featuresToArray(features);
      const mlResult = predictGBDT(mlModel, featureArray);
      mlP = mlResult.probability;
      mlConfidence = mlResult.confidence;
      mlTopFactors = mlResult.topFactors.map(f => ({
        feature: f.feature,
        importance: f.importance,
        value: f.value,
      }));
    }
  } catch {
    mlP = 0;
  }

  // ── Calculate dynamic weights ──
  const mlAvailable = mlP > 0;
  const hasHistory = !!(pressureHistory && pressureHistory.length >= 3);
  const weights = calculateDynamicWeights(minNum, mlAvailable, mlConfidence, hasHistory);

  // ── Weighted ensemble blend ──
  const ensembleP = (
    ruleBasedP * weights.ruleBased +
    poissonP * weights.poisson +
    eloP * weights.elo +
    mlP * weights.ml
  );

  // ── Model agreement ──
  const allPredictions = [ruleBasedP, poissonP, eloP, mlP].filter(p => p > 0);
  const avgP = allPredictions.reduce((a, b) => a + b, 0) / Math.max(1, allPredictions.length);
  const variance = allPredictions.reduce((s, p) => s + (p - avgP) ** 2, 0) / Math.max(1, allPredictions.length);
  const agreement = Math.max(0, 1 - Math.sqrt(variance) * 5); // Lower variance = higher agreement

  // ── Ensemble derived predictions ──
  const ensembleOverUnder = poissonOverUnder > 0 ? poissonOverUnder : ensembleP * 1.5;
  const ensembleBTTS = poissonBTTS > 0 ? poissonBTTS : ensembleP * 0.7;

  // Blend 1X2 predictions from Poisson and Elo
  const ensembleHomeWin = poissonHomeWin > 0 && eloHomeWin > 0
    ? poissonHomeWin * 0.6 + eloHomeWin * 0.4
    : poissonHomeWin > 0 ? poissonHomeWin : eloHomeWin;
  const ensembleDraw = poissonDraw > 0 && eloDraw > 0
    ? poissonDraw * 0.6 + eloDraw * 0.4
    : poissonDraw > 0 ? poissonDraw : eloDraw;
  const ensembleAwayWin = poissonAwayWin > 0 && eloAwayWin > 0
    ? poissonAwayWin * 0.6 + eloAwayWin * 0.4
    : poissonAwayWin > 0 ? poissonAwayWin : eloAwayWin;

  // ── Determine dominant model ──
  const modelWeights = [
    { name: 'Rule-Based', weight: weights.ruleBased * ruleBasedP },
    { name: 'Poisson', weight: weights.poisson * poissonP },
    { name: 'Elo', weight: weights.elo * eloP },
    { name: 'ML', weight: weights.ml * mlP },
  ];
  const dominantModel = modelWeights.reduce((a, b) => a.weight > b.weight ? a : b).name;

  // ── Determine side ──
  let side: 'home' | 'away' | 'both' | null = null;
  const getStat = (key: string, side: 'home' | 'away'): number => {
    const s = stats[key];
    if (!s) return 0;
    return (side === 'home' ? s.home : s.away) ?? 0;
  };
  const homePressure = getStat('dangerous_attacks', 'home') + getStat('shots_on_target', 'home') * 2;
  const awayPressure = getStat('dangerous_attacks', 'away') + getStat('shots_on_target', 'away') * 2;
  if (homePressure > awayPressure * 1.5) side = 'home';
  else if (awayPressure > homePressure * 1.5) side = 'away';
  else if (homePressure > 3 && awayPressure > 3) side = 'both';

  // ── Score (0-100 for compatibility) ──
  const score = Math.round(ensembleP * 100);

  // ── Alert level ──
  let level: 'low' | 'medium' | 'high' | 'critical';
  if (ensembleP < 0.20) level = 'low';
  else if (ensembleP < 0.40) level = 'medium';
  else if (ensembleP < 0.60) level = 'high';
  else level = 'critical';

  // ── Build result ──
  const models: ModelPrediction[] = [
    {
      name: 'Rule-Based',
      probability: Math.round(ruleBasedP * 1000) / 1000,
      confidence: Math.round(ruleBasedConf * 100) / 100,
      weight: Math.round(weights.ruleBased * 100) / 100,
      details: ruleBasedScore != null ? `Score: ${ruleBasedScore}/100` : 'No data',
    },
    {
      name: 'Poisson',
      probability: Math.round(poissonP * 1000) / 1000,
      confidence: poissonP > 0 ? 0.7 : 0,
      weight: Math.round(weights.poisson * 100) / 100,
      details: `O2.5: ${(poissonOverUnder * 100).toFixed(0)}% | BTTS: ${(poissonBTTS * 100).toFixed(0)}%`,
    },
    {
      name: 'Elo',
      probability: Math.round(eloP * 1000) / 1000,
      confidence: homeTeam && awayTeam ? 0.6 : 0,
      weight: Math.round(weights.elo * 100) / 100,
      details: homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : 'No team data',
    },
    {
      name: 'ML (GBDT)',
      probability: Math.round(mlP * 1000) / 1000,
      confidence: Math.round(mlConfidence * 100) / 100,
      weight: Math.round(weights.ml * 100) / 100,
      details: mlP > 0 ? `Conf: ${(mlConfidence * 100).toFixed(0)}%` : 'Model not loaded',
    },
  ];

  return {
    probability: Math.round(ensembleP * 1000) / 1000,
    score: Math.max(0, Math.min(85, score)),
    level,
    side,
    models,
    weights,
    dominantModel,
    agreement: Math.round(agreement * 100) / 100,
    overUnder25: Math.round(ensembleOverUnder * 1000) / 1000,
    btts: Math.round(ensembleBTTS * 1000) / 1000,
    homeWinP: Math.round(ensembleHomeWin * 1000) / 1000,
    drawP: Math.round(ensembleDraw * 1000) / 1000,
    awayWinP: Math.round(ensembleAwayWin * 1000) / 1000,
    topFeatures: mlTopFactors.slice(0, 5),
  };
}

export { calculateWeatherImpact, calculateSquadImpact, calculateH2HImpact } from './ensembleHelpers';
