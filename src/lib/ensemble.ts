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
import { determineSideByStats } from './goalRadar';
import {
  calculateExpectedGoals,
  calculateMatchProbabilities,
  inPlayGoalProbability,
  getTimeBasedGoalMultiplier,
} from './dixonColes';
import { predictFromElo, eloGoalAdjustment, getFormIndex } from './eloRating';
import { predictMatch as predictKalmanMatch, type TeamStrengthModel } from './ml/teamStrengthKalman';
import { computeEnsembleWeights } from './ml/weightTuner';
import { getChampionBrier } from './ml/modelRouter';
	import { estimateXgFromShots } from './estimateXg';
	// teamHistoryBackfill pulls in sofascore.ts (uses child_process via
	// Python bridge) — keep it out of the client bundle by deferring
	// the import to call time.
	import { loadXgbChampion } from "./ml/modelRouter";
	import { predictXgb, type XgbModel } from "./ml/xgbLoader";
import { logError } from '@/lib/devLog';
import { brierToConfidence, UNRANKED_MODEL_BRIER } from '@/config';
import { FEATURE_NAMES } from './featureEngineering';
import { predictStacking, type StackingInput } from './ml/stackingEnsemble';

// ── Types ──────────────────────────────────────────────────────────

export interface EnsembleWeights {
  ruleBased: number;   // 12-factor rule model weight
  poisson: number;     // Dixon-Coles Poisson weight
  elo: number;         // Elo-based weight
  ml: number;          // GBDT ML model weight
  teamStrength: number; // Kalman team-strength weight
  inplay: number;      // 5-min ahead in-play XGBoost (active only when minute > 20)
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

export async function predictEnsemble(
  input: EnsembleInput,
): Promise<EnsembleResult> {
  const {
    stats,
    minute,
    isLive,
    homeGoals,
    awayGoals,
    homeTeam,
    awayTeam,
    pressureHistory,
    ruleBasedScore,
    homeAttackStrength,
    awayDefenseStrength,
    awayAttackStrength,
    homeDefenseStrength,
    weather,
  } = input;

  // Parse minute
  let minNum = parseInt(minute.replace(/[^0-9]/g, ""), 10);
  if (!minNum || minNum === 0) minNum = 45;
  minNum = Math.max(1, Math.min(120, minNum));

  // ── Model 1: Rule-based Goal Radar ──
  // Faz 4 — tek kalibrasyon kanalı: ensemble ham score alır; route
  // seviyesinde applyCalibration ile kalibre edilir. Burada sigmoid/PAVA
  // uygulamıyoruz — çift katman riski kalkar.
  const ruleBasedP =
    ruleBasedScore != null ? Math.min(1, ruleBasedScore / 100) : 0;
  const ruleBasedConf =
    ruleBasedScore != null ? Math.min(1, ruleBasedScore / 70) : 0.1;

  // ── Model 2: Dixon-Coles Poisson ──
  let poissonP = 0;
  let poissonOverUnder = 0;
  let poissonBTTS = 0;
  let poissonHomeWin = 0;
  let poissonDraw = 0;
  let poissonAwayWin = 0;

  try {
    // Estimate xG for Poisson input using shared formula (avoids formula duplication)
    const xgHome = estimateXgFromShots(stats, 'home', minNum);
    const xgAway = estimateXgFromShots(stats, 'away', minNum);

    if (homeAttackStrength && awayDefenseStrength) {
      const params = calculateExpectedGoals(
        homeAttackStrength,
        awayDefenseStrength,
        awayAttackStrength ?? 1.0,
        homeDefenseStrength ?? 1.0,
      );
      const probs = calculateMatchProbabilities(params);
      poissonP = 1 - (probs.overUnder[0.5]?.under || 0);
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
      eloP = Math.max(
        0,
        Math.min(
          0.8,
          0.15 +
            (Math.abs(eloAdj.homeAdjust) + Math.abs(eloAdj.awayAdjust)) * 0.03,
        ),
      );
      eloHomeWin = eloPrediction.homeWinP;
      eloDraw = eloPrediction.drawP;
      eloAwayWin = eloPrediction.awayWinP;
    }
  } catch {
    eloP = 0.15;
  }

  // ── Model 4: Champion ML (XGB/GBDT promoted artifact, or built-in GBDT) ──
  // Priority: xgb champion > gbdt champion > built-in GBDT
  let mlP = 0;
  let mlConfidence = 0;
  let mlTopFactors: Array<{
    feature: string;
    importance: number;
    value: number;
  }> = [];
  let mlModelName = "GBDT (built-in)";

	  // Extract features lazily, caching the result for multiple ML model calls
	  let mlFeaturesCache: Promise<{ features: MatchFeatures; featureArray: number[] }> | null = null;
	  async function getMlFeaturesCached(): Promise<{ features: MatchFeatures; featureArray: number[] }> {
	    if (mlFeaturesCache) return mlFeaturesCache;
	    mlFeaturesCache = (async () => {
	      const features = await extractFeatures(input);
	      const featureArray = featuresToArray(features);
	      return { features, featureArray };
	    })();
	    return mlFeaturesCache;
	  }

  try {
    let mlModel: XgbModel | null = null;

    // Try promoted champion artifacts first
    const championOrder: Array<"xgb" | "gbdt"> = ["xgb", "gbdt"];
    for (const championName of championOrder) {
      try {
        const champ = await loadXgbChampion(championName);
        if (champ) {
          mlModel = champ.model;
          mlModelName = `${championName} v${champ.version}`;
          break;
        }
      } catch (e) { logError('ensemble', e); /* continue to next */ }
    }

    if (mlModel) {
      // Champion XGB model — extract features once
      const { featureArray } = await getMlFeaturesCached();
      mlP = Math.max(0, Math.min(1, predictXgb(mlModel, featureArray)));
      // Faz 6 — confidence champion Brier'dan türetilir. Brier mevcut değilse
      // (henüz backtest edilmemiş şampiyon) 0.7 fallback.
      const mlChampionBrier = await getChampionBrier("xgb");
      mlConfidence =
        mlChampionBrier != null
          ? brierToConfidence(mlChampionBrier)
          : 0.7;

      // Extract top feature contributions — importance artık Brier-skalasına göre
      // göreceli olarak artık bilinen ML model kullanılır; aksi hâlde heuristic.
      const sorted = featureArray
        .map((v, i) => ({ index: i, value: Math.abs(v) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
      const factorImportance =
        mlChampionBrier != null ? Math.max(0.05, brierToConfidence(mlChampionBrier)) : 0.3;
	      mlTopFactors = sorted.map((s) => ({
	        feature: FEATURE_NAMES[s.index] ?? `f${s.index}`,
	        importance: Math.round(factorImportance * 1000) / 1000,
	        value: featureArray[s.index] ?? 0,
	      }));
    } else {
      // Fall back to built-in GBDT
      const builtin = loadModel();
      if (builtin) {
        const { featureArray } = await getMlFeaturesCached();
        const mlResult = predictGBDT(builtin, featureArray);
        mlP = mlResult.probability;
        mlConfidence = mlResult.confidence;
        mlTopFactors = mlResult.topFactors.map((f) => ({
          feature: f.feature,
          importance: f.importance,
          value: f.value,
        }));
      }
    }
  } catch {
    mlP = 0;
  }

  // ── Model 4b: In-play 5-min ahead XGBoost ──
  // Loads the dedicated in-play artifact (when promoted) and runs
  // it on the same 50-feature vector. The in-play model specializes
  // in 5-min-horizon goal probability for the LATTER half of the
  // match (minNum > 20). Before 20 min, the noise is too high to
  // trust a 5-min signal — gate weight to 0.
  let inPlayP = 0;
  let inPlayConf = 0;
  let inPlayDetails = "No in-play model loaded";
  if (minNum > 20) {
    try {
      const ipChampion = await loadXgbChampion("inplay");
      if (ipChampion) {
        // Use cached features from previous extraction
        const { featureArray } = await getMlFeaturesCached();
        inPlayP = Math.max(
          0,
          Math.min(1, predictXgb(ipChampion.model, featureArray)),
        );
        // Faz 6 — in-play confidence champion Brier'dan türetilir.
        const inplayChampionBrier = await getChampionBrier("inplay");
        inPlayConf =
          inplayChampionBrier != null
            ? brierToConfidence(inplayChampionBrier)
            : 0.7;
        inPlayDetails = `v${ipChampion.version} (horizon=5m, minute=${minNum})`;
      }
    } catch {
      inPlayP = 0;
    }
  }

  // ── Model 5: Kalman team strength ──
  // Slow-changing prior on team quality. Best contribution as a
  // smoothing term that nudges predictions toward the long-run
  // goal rate (lambda_h, lambda_a) rather than as the dominant
  // signal. Best when both teams are rated (>= 5 matches each).
  let teamStrengthP = 0;
  let teamStrengthConf = 0;
  let teamStrengthDetails = "No team-strength model loaded";
  let teamStrengthHomeWin = 0;
  let teamStrengthDraw = 0;
  let teamStrengthAwayWin = 0;
  try {
    if (homeTeam && awayTeam) {
      const { loadLatestTeamStrength } = await import('./ml/teamHistoryBackfill');
      const tsModel: TeamStrengthModel = await loadLatestTeamStrength();
      const tsPred = predictKalmanMatch(tsModel, homeTeam, awayTeam);
      // Convert 1X2 to a goal-imminent probability: the larger of
      // the team-specific Poisson rate (lambda) and a base rate.
      // When both teams are rated, this is signal. When only one or
      // neither is rated, fall back to lambda~1.0 (no info).
      const lambdaImminent =
        1 - Math.exp(-(tsPred.lambdaHome + tsPred.lambdaAway) * 0.2);
      teamStrengthP = Math.max(0, Math.min(0.6, lambdaImminent));
      teamStrengthConf =
        Math.min(tsPred.matches.home, tsPred.matches.away) >= 5 ? 0.7 : 0.3;
      const teamStrengthChampionBrier = await getChampionBrier("team-strength");
      teamStrengthConf =
        teamStrengthChampionBrier != null
          ? brierToConfidence(teamStrengthChampionBrier)
          : teamStrengthConf;
      teamStrengthHomeWin = tsPred.homeWinP;
      teamStrengthDraw = tsPred.drawP;
      teamStrengthAwayWin = tsPred.awayWinP;
      teamStrengthDetails = `λ_h=${tsPred.lambdaHome.toFixed(2)} λ_a=${tsPred.lambdaAway.toFixed(2)} (m=${Math.min(tsPred.matches.home, tsPred.matches.away)})`;
    }
  } catch {
    teamStrengthP = 0;
  }

  // ── Calculate dynamic weights (Brier tier-based) ──
  // Replaces the old calculateDynamicWeights() heuristic with a
  // Brier-driven tuner. Champion Brier values are extracted from
  // artifact metadata when known; null falls back to 0.20 default
  // (unranked baseline). The in-play minute gate (0 before min 20,
  // ramp 20→30, cap 0.30 after) is now inside computeEnsembleWeights.
  const mlAvailable = mlP > 0;
  const hasHistory = !!(pressureHistory && pressureHistory.length >= 3);
  // Read champion Briers dynamically — a freshly promoted model
  // automatically gets a recalibrated ensemble weight on the next
  // prediction. weightTuner treats null as the unranked baseline (0.20).
  const mlBrier = mlAvailable
    ? (await getChampionBrier('xgb')) ?? (await getChampionBrier('gbdt'))
    : null;
  const inplayBrier = inPlayP > 0 ? await getChampionBrier('inplay') : null;
  const teamStrengthBrier = teamStrengthP > 0 ? await getChampionBrier('team-strength') : null;
  const weights = computeEnsembleWeights({
    inplayBrier,
    mlBrier,
    teamStrengthBrier,
    ruleBrier: null,
    poissonBrier: null,
    eloBrier: null,
    minute: minNum,
    hasPressureHistory: hasHistory,
  });

	  // ── Weighted ensemble blend ──
	  // Yeni: sadece prediction > 0 olan modeller normalize edilir.
	  // 0 çıktı üreten modeller (ör: inPlayP=0, teamStrengthP=0) ağırlık
	  // tüketmez, böylece aktif modeller seyreltilmez.
	  const activeModels: { weight: number; pred: number }[] = [];
	  if (ruleBasedP > 0) activeModels.push({ weight: weights.ruleBased, pred: ruleBasedP });
	  if (poissonP > 0) activeModels.push({ weight: weights.poisson, pred: poissonP });
	  if (eloP > 0) activeModels.push({ weight: weights.elo, pred: eloP });
	  if (mlP > 0) activeModels.push({ weight: weights.ml, pred: mlP });
	  if (teamStrengthP > 0) activeModels.push({ weight: weights.teamStrength, pred: teamStrengthP });
	  if (inPlayP > 0) activeModels.push({ weight: weights.inplay, pred: inPlayP });

	  const totalActiveWeight = activeModels.reduce((s, m) => s + m.weight, 0);
		  const ensembleP = totalActiveWeight > 0
		    ? activeModels.reduce((s, m) => s + m.pred * (m.weight / totalActiveWeight), 0)
		    : ruleBasedP; // fallback: hiçbir model aktif değilse rule-based kullan

  // ── Stacking Ensemble (meta-model alternatifi) ──
  // Logistic regression meta-model: tüm modellerin çıktılarını öğrenip birleştirir.
  // Şu an deneme aşamasında — ensembleP kullanılmaya devam eder.
  const stackingInput: StackingInput = {
    ruleBased: ruleBasedP,
    poisson: poissonP,
    elo: eloP,
    ml: mlP,
    teamStrength: teamStrengthP,
    inplay: inPlayP,
  };
  const stackingP = predictStacking(stackingInput);
  // Stacking şu an sadece loglanır, kullanılmaz. İleride ensembleP yerine geçebilir.
  if (process.env.NODE_ENV === 'development' && stackingP > 0.1) {
    console.log(`[Stacking] ensemble=${ensembleP.toFixed(3)} stacking=${stackingP.toFixed(3)}`);
  }

  // ── Model agreement (excluding zero predictions) ──
  const allPredictions = [ruleBasedP, poissonP, eloP, mlP].filter((p) => p > 0.01);
  const hasPredictions = allPredictions.length > 0;
  const avgP = hasPredictions
    ? allPredictions.reduce((a, b) => a + b, 0) / allPredictions.length
    : 0;
  const variance = hasPredictions
    ? allPredictions.reduce((s, p) => s + (p - avgP) ** 2, 0) / allPredictions.length
    : 0;
  // Agreement only meaningful when we have positive predictions
  const agreement = hasPredictions
    ? Math.max(0, 1 - Math.sqrt(variance) * 5)
    : 0; // Low variance = high agreement

  // ── Ensemble derived predictions ──
  const ensembleOverUnder =
    poissonOverUnder > 0 ? poissonOverUnder : ensembleP * 1.5;
  const ensembleBTTS = poissonBTTS > 0 ? poissonBTTS : ensembleP * 0.7;

  // Blend 1X2 predictions from Poisson, Elo, and Kalman team strength.
  // Team strength contributes 0.20 weight when both teams are rated,
  // tapers to 0.05 when only one is rated, 0 otherwise.
  const tsRated = Math.min(teamStrengthConf > 0 ? 1 : 0, 1); // binary
  const ts1x2Weight = tsRated > 0 ? Math.min(0.2, teamStrengthConf * 0.25) : 0;
  const baseWeight = 1 - ts1x2Weight;
  const tsHome = tsRated > 0 ? teamStrengthHomeWin : 0;
  const tsDraw = tsRated > 0 ? teamStrengthDraw : 0;
  const tsAway = tsRated > 0 ? teamStrengthAwayWin : 0;
  const ensembleHomeWin =
    poissonHomeWin > 0 || eloHomeWin > 0
      ? (poissonHomeWin * 0.6 + eloHomeWin * 0.4) * baseWeight +
        tsHome * ts1x2Weight
      : tsHome;
  const ensembleDraw =
    poissonDraw > 0 || eloDraw > 0
      ? (poissonDraw * 0.6 + eloDraw * 0.4) * baseWeight + tsDraw * ts1x2Weight
      : tsDraw;
  const ensembleAwayWin =
    poissonAwayWin > 0 || eloAwayWin > 0
      ? (poissonAwayWin * 0.6 + eloAwayWin * 0.4) * baseWeight +
        tsAway * ts1x2Weight
      : tsAway;

  // ── Determine dominant model ──
  const modelWeights = [
    { name: "Rule-Based", weight: weights.ruleBased * ruleBasedP },
    { name: "Poisson", weight: weights.poisson * poissonP },
    { name: "Elo", weight: weights.elo * eloP },
    { name: "ML", weight: weights.ml * mlP },
    { name: "TeamStrength", weight: weights.teamStrength * teamStrengthP },
    { name: "InPlay5m", weight: weights.inplay * inPlayP },
  ];
  const dominantModel = modelWeights.reduce((a, b) =>
    a.weight > b.weight ? a : b,
  ).name;

  // ── Determine side ──
  // Faz 7 — stats-tabanlı helper'a yönlendirildi. score-based determineSide
  // goalRadar.ts içinde, burada ensemble kendi heuristic'ini kullanır.
  const side: "home" | "away" | "both" | null = determineSideByStats(stats);

  // ── Score (0-100 for compatibility) ──
  const score = Math.round(ensembleP * 100);

  // ── Alert level ──
  let level: "low" | "medium" | "high" | "critical";
  if (ensembleP < 0.2) level = "low";
  else if (ensembleP < 0.4) level = "medium";
  else if (ensembleP < 0.6) level = "high";
  else level = "critical";

  // ── Build result ──
  const models: ModelPrediction[] = [
    {
      name: "Rule-Based",
      probability: Math.round(ruleBasedP * 1000) / 1000,
      confidence: Math.round(ruleBasedConf * 100) / 100,
      weight: Math.round(weights.ruleBased * 100) / 100,
      details:
        ruleBasedScore != null ? `Score: ${ruleBasedScore}/100` : "No data",
    },
    {
      name: "Poisson",
      probability: Math.round(poissonP * 1000) / 1000,
      // Faz 6 — Poisson/Elo champion metadata yok (sadece gbdt/xgb/inplay/team-strength
      // için). Unranked sentinel Brier (0.20) ile türetilir; ileride gerçek Brier eklenecek.
      confidence: poissonP > 0 ? brierToConfidence(UNRANKED_MODEL_BRIER) : 0,
      weight: Math.round(weights.poisson * 100) / 100,
      details: `O2.5: ${(poissonOverUnder * 100).toFixed(0)}% | BTTS: ${(poissonBTTS * 100).toFixed(0)}%`,
    },
    {
      name: "Elo",
      probability: Math.round(eloP * 1000) / 1000,
      // Faz 6 — bkz. Poisson confidence yorumu.
      confidence: homeTeam && awayTeam ? brierToConfidence(UNRANKED_MODEL_BRIER) : 0,
      weight: Math.round(weights.elo * 100) / 100,
      details:
        homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : "No team data",
    },
    {
      name: `ML (${mlModelName})`,
      probability: Math.round(mlP * 1000) / 1000,
      confidence: Math.round(mlConfidence * 100) / 100,
      weight: Math.round(weights.ml * 100) / 100,
      details:
        mlP > 0
          ? `Conf: ${(mlConfidence * 100).toFixed(0)}%`
          : "Model not loaded",
    },
    {
      name: "TeamStrength",
      probability: Math.round(teamStrengthP * 1000) / 1000,
      confidence: Math.round(teamStrengthConf * 100) / 100,
      weight: Math.round(weights.teamStrength * 100) / 100,
      details: teamStrengthDetails,
    },
    {
      name: "InPlay5m",
      probability: Math.round(inPlayP * 1000) / 1000,
      confidence: Math.round(inPlayConf * 100) / 100,
      weight: Math.round(weights.inplay * 100) / 100,
      details: inPlayDetails,
    },
  ];

  return {
    probability: Math.round(ensembleP * 1000) / 1000,
    score: Math.max(0, Math.min(100, score)),
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
