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
import {
  getGapState,
  predictGapMatch,
} from './ml/gapRating';
import { computeEnsembleWeights, applyOnlineAdjustments } from './ml/weightTuner';
import { getChampionBrier } from './ml/modelRouter';
import { getMeasuredBrier } from './ml/brierCache';
import { getStackingSamplesCount } from './ml/stackingEnsemble';
import {
  predictPiFromRating as predictPi,
  updatePiRating,
} from './piRating';
import {
  predictGlicko2 as predictGlicko2Fn,
} from './glicko2';
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
import { bayesianModelAverage, bmaToEnsembleWeights } from './ml/bayesianAveraging';
import { parseMinute } from './goalSignalTracker';

// ── Types ──────────────────────────────────────────────────────────

export interface EnsembleWeights {
  ruleBased: number;   // 12-factor rule model weight
  poisson: number;     // Dixon-Coles Poisson weight
  elo: number;         // Elo-based weight
  ml: number;          // GBDT ML model weight
  teamStrength: number; // Kalman team-strength weight
  inplay: number;      // 5-min ahead in-play XGBoost (active only when minute > 20)
  gap: number;         // Faz 4 (Yol B) — Lite GAP rating weight (lite mode; ENV-gated)
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

  // Parse minute — stoppage time "45+2" → 47 doğru handle edilir
  let minNum = parseMinute(minute);
  if (!minNum || minNum === 0) minNum = 45;
  minNum = Math.max(1, Math.min(120, minNum));

  // ── Pre-fetch all Brier data in parallel (Faz 4.9) ─────────────
  // Tek Promise.all ile tüm champion/measured Brier'ları önceden al.
  const [
    champBrierXgb, champBrierGbdt, champBrierInplay, champBrierTs,
    measBrierRule, measBrierPoisson, measBrierElo,
    measBrierGap, measBrierPi, measBrierGlicko2,
  ] = await Promise.all([
    getChampionBrier('xgb').catch(() => null),
    getChampionBrier('gbdt').catch(() => null),
    getChampionBrier('inplay').catch(() => null),
    getChampionBrier('team-strength').catch(() => null),
    getMeasuredBrier('rule').catch(() => null),
    getMeasuredBrier('poisson').catch(() => null),
    null, // Elo has no champion Brier
    getMeasuredBrier('gap').catch(() => null),
    getMeasuredBrier('pi').catch(() => null),
    getMeasuredBrier('glicko2').catch(() => null),
  ]);
  const cachedBrier = {
    ml: champBrierXgb ?? champBrierGbdt,
    inplay: champBrierInplay,
    teamStrength: champBrierTs,
    rule: measBrierRule,
    poisson: measBrierPoisson,
    elo: null,
    gap: measBrierGap,
    pi: measBrierPi,
    glicko2: measBrierGlicko2,
  };

  // ── Models 1-3: parallel (sync, independent) ──────────────────
  const [ruleResult, poissonResult, eloResult] = await Promise.all([
    Promise.resolve().then(() => {
      // Model 1: Rule-based Goal Radar
      const ruleBasedP = ruleBasedScore != null ? Math.min(1, ruleBasedScore / 100) : 0;
      const ruleBasedConf = ruleBasedScore != null ? Math.min(1, ruleBasedScore / 70) : 0.1;
      return { ruleBasedP, ruleBasedConf };
    }),
    Promise.resolve().then(() => {
      // Model 2: Dixon-Coles Poisson
      let poissonP = 0, poissonOverUnder = 0, poissonBTTS = 0;
      let poissonHomeWin = 0, poissonDraw = 0, poissonAwayWin = 0;
      try {
        const xgHome = estimateXgFromShots(stats, 'home', minNum);
        const xgAway = estimateXgFromShots(stats, 'away', minNum);
        if (homeAttackStrength && awayDefenseStrength) {
          const params = calculateExpectedGoals(homeAttackStrength, awayDefenseStrength, awayAttackStrength ?? 1.0, homeDefenseStrength ?? 1.0);
          const probs = calculateMatchProbabilities(params);
          poissonP = 1 - (probs.overUnder[0.5]?.under || 0);
          poissonOverUnder = probs.overUnder[2.5]?.over ?? 0;
          poissonBTTS = probs.btts.yes;
          poissonHomeWin = probs.homeWin;
          poissonDraw = probs.draw;
          poissonAwayWin = probs.awayWin;
        } else {
          const inPlay = inPlayGoalProbability(xgHome, xgAway, minNum);
          poissonP = inPlay.anyGoalP;
          poissonOverUnder = Math.min(0.9, poissonP * 1.2);
          poissonBTTS = Math.min(0.8, poissonP * 0.6);
          poissonHomeWin = inPlay.homeGoalP;
          poissonAwayWin = inPlay.awayGoalP;
          poissonDraw = 0.26;
        }
      } catch { poissonP = 0; }
      return { poissonP, poissonOverUnder, poissonBTTS, poissonHomeWin, poissonDraw, poissonAwayWin };
    }),
    Promise.resolve().then(() => {
      // Model 3: Elo Rating
      let eloP = 0, eloHomeWin = 0, eloDraw = 0, eloAwayWin = 0;
      try {
        if (homeTeam && awayTeam) {
          const eloPrediction = predictFromElo(homeTeam, awayTeam);
          const eloAdj = eloGoalAdjustment(homeTeam, awayTeam);
          eloP = Math.max(0, Math.min(0.8, 0.15 + (Math.abs(eloAdj.homeAdjust) + Math.abs(eloAdj.awayAdjust)) * 0.03));
          eloHomeWin = eloPrediction.homeWinP;
          eloDraw = eloPrediction.drawP;
          eloAwayWin = eloPrediction.awayWinP;
        }
      } catch { eloP = 0.15; }
      return { eloP, eloHomeWin, eloDraw, eloAwayWin };
    }),
  ]);

  const { ruleBasedP, ruleBasedConf } = ruleResult;
  const { poissonP, poissonOverUnder, poissonBTTS, poissonHomeWin, poissonDraw, poissonAwayWin } = poissonResult;
  const { eloP, eloHomeWin, eloDraw, eloAwayWin } = eloResult;

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
      const mlChampionBrier = cachedBrier.ml;
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
        const inplayChampionBrier = cachedBrier.inplay;
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
      const teamStrengthChampionBrier = cachedBrier.teamStrength;
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

  // ── Model 6: Lite GAP (Faz 4 / Yol B) — singleton state ──
  // Singleton GAP state, MatchSnapshot verisiyle kademeli olarak doldurulur.
  // İlk çağrıda initializeGapState() tetiklenir (background).
  // gapP > 0 olduğunda BMA'ya gerçek katkı sağlar.
  let gapP = 0;
  let gapDetails = "GAP inactive (no data)";
  // Faz 4 — Lite GAP. Default AÇIK.
  if (process.env.GAP_RATING !== 'false' && homeTeam && awayTeam) {
    try {
      const gapState = getGapState();
      // İlk çağrıda background init tetikle (bekleme, sonraki predict'te veri hazır olur)
      import('./ml/gapRating').then(m => m.initializeGapState()).catch(() => {});
      const gapPred = predictGapMatch(gapState, homeTeam, awayTeam);
      gapP = gapPred.gapP;
      gapDetails = `λ_h=${gapPred.lambdaHome.toFixed(2)} λ_a=${gapPred.lambdaAway.toFixed(2)} c=${gapPred.confidence} (matches=${Math.min(gapPred.matchesHome, gapPred.matchesAway)})`;
    } catch (e) {
      logError('ensemble', 'predictGapMatch failed', e);
      gapP = 0;
    }
  }

  // ── Model 7: Pi-Rating (Constantinou 2013) ──
  // ENABLE_PI_RATING=false ise eski elo davranışı korunur.
  let piRatingP = 0;
  let piRatingHomeWin = eloHomeWin;
  let piRatingDraw = eloDraw;
  let piRatingAwayWin = eloAwayWin;
  // Faz 7 — Pi-Rating (Constantinou 2013). Default AÇIK. env=false ile kapatılabilir.
  if (process.env.PI_RATING !== 'false' && homeTeam && awayTeam) {
    try {
      const piPred = predictPi(homeTeam, awayTeam);
      // Pi-Rating any-goal = homeWinP + 0.5·drawP.
      // Cold-start'ta predictPi 0 döner → probability=0 → BMA filtresi atlar.
      const piRawP = piPred.homeWinP + 0.5 * piPred.drawP;
      // Cold-start'ta predictPiFromRating 0 döner → eloP fallback kullan
      if (piRawP <= 0 || (piPred.homeWinP === 0 && piPred.drawP === 0 && piPred.awayWinP === 0)) {
        piRatingP = Math.min(0.85, eloP);
        piRatingHomeWin = eloHomeWin;
        piRatingDraw = eloDraw;
        piRatingAwayWin = eloAwayWin;
      } else {
        piRatingP = Math.min(0.85, piRawP);
        piRatingHomeWin = piPred.homeWinP;
        piRatingDraw = piPred.drawP;
        piRatingAwayWin = piPred.awayWinP;
      }
    } catch (e) {
      logError('ensemble', 'predictPiFromRating failed', e);
      piRatingP = 0;
    }
  }

  // ── Model 8: Glicko-2 (Glickman) ──
  let glicko2P = 0;
  let glicko2HomeWin = eloHomeWin;
  let glicko2Draw = eloDraw;
  let glicko2AwayWin = eloAwayWin;
  // Faz 7 — Glicko-2 (Glickman 2013). Default AÇIK. env=false ile kapat.
  if (process.env.GLICKO2 !== 'false' && homeTeam && awayTeam) {
    try {
      const gPred = predictGlicko2Fn(homeTeam, awayTeam);
      const gRawP = gPred.homeWinP + 0.5 * gPred.drawP;
      if (gRawP <= 0 || (gPred.homeWinP === 0 && gPred.drawP === 0 && gPred.awayWinP === 0)) {
        glicko2P = Math.min(0.85, eloP);
        glicko2HomeWin = eloHomeWin;
        glicko2Draw = eloDraw;
        glicko2AwayWin = eloAwayWin;
      } else {
        glicko2P = Math.min(0.85, gRawP);
        glicko2HomeWin = gPred.homeWinP;
        glicko2Draw = gPred.drawP;
        glicko2AwayWin = gPred.awayWinP;
      }
    } catch (e) {
      logError('ensemble', 'predictGlicko2 failed', e);
      glicko2P = 0;
    }
  }

  // ── Calculate dynamic weights (Brier tier-based) ──
  // Replaces the old calculateDynamicWeights() heuristic with a
  // Brier-driven tuner. Champion Brier values are extracted from
  // artifact metadata when known; null falls back to 0.20 default
  // (unranked baseline). The in-play minute gate (0 before min 20,
  // ramp 20→30, cap 0.30 after) is now inside computeEnsembleWeights.
  const mlAvailable = mlP > 0;
  const hasHistory = !!(pressureHistory && pressureHistory.length >= 3);
  // Use pre-fetched Brier data (Faz 4.9 — fetched at top in parallel)
  const mlBrier = mlAvailable ? cachedBrier.ml : null;
  const inplayBrier = inPlayP > 0 ? cachedBrier.inplay : null;
  const teamStrengthBrier = teamStrengthP > 0 ? cachedBrier.teamStrength : null;
  // Faz 1 (A1) — Rule/Poisson/Elo bireysel Brier'ları SystemConfig'ten
  const ruleMeasured = cachedBrier.rule;
  const poissonMeasured = cachedBrier.poisson;
  const eloMeasured = cachedBrier.elo;
  const weights = computeEnsembleWeights({
    inplayBrier,
    mlBrier,
    teamStrengthBrier,
    gapBrier: null, // GAP — singleton state, Brier henüz ölçülmedi
    piBrier: null, // Pi-Rating cold-start; commit edilmiş ölçümler DB'de
    glicko2Brier: null, // Glicko-2 aynı şekilde cold-start
    ruleBrier: ruleMeasured,
    poissonBrier: poissonMeasured,
    eloBrier: eloMeasured,
    minute: minNum,
    hasPressureHistory: hasHistory,
  });
  // Faz 3 (A3) — Online drift'i aktif et. ENV gate: ENABLE_ONLINE_ADJUSTMENTS=true.
  // Kapalıyken eski davranışla birebir aynı (sinyal sayısı invariant).
  if (process.env.ENABLE_ONLINE_ADJUSTMENTS === 'true') {
    try {
      applyOnlineAdjustments(weights);
    } catch (e) {
      logError('ensemble', 'applyOnlineAdjustments failed', e);
    }
  }

		  // ── Bayesian Model Averaging ──
  // Weighted average yerine Brier-based posterior weights.
  // Her modelin Brier score'undan weight türet: düşük Brier = yüksek weight.
  const bmaModels = [
    { name: 'Rule-Based', probability: ruleBasedP, brierScore: null as number | null },
    { name: 'Poisson', probability: poissonP, brierScore: null as number | null },
    { name: 'Elo', probability: eloP, brierScore: null as number | null },
    { name: 'ML', probability: mlP, brierScore: null as number | null },
    { name: 'TeamStrength', probability: teamStrengthP, brierScore: null as number | null },
    { name: 'InPlay5m', probability: inPlayP, brierScore: null as number | null },
    { name: 'GAP', probability: gapP, brierScore: null as number | null },
    { name: 'PiRating', probability: piRatingP, brierScore: null as number | null },
    { name: 'Glicko2', probability: glicko2P, brierScore: null as number | null },
  ].filter(m => m.probability > 0);

  // Get Brier scores from pre-fetched cached data (Faz 4.9)
  const brierMap: Record<string, number | null> = {};
  brierMap['Rule-Based'] = cachedBrier.rule;
  brierMap['Poisson'] = cachedBrier.poisson;
  brierMap['Elo'] = cachedBrier.elo;
  brierMap['ML'] = cachedBrier.ml;
  brierMap['TeamStrength'] = cachedBrier.teamStrength;
  brierMap['InPlay5m'] = cachedBrier.inplay;
  brierMap['GAP'] = cachedBrier.gap;
  brierMap['PiRating'] = cachedBrier.pi;
  brierMap['Glicko2'] = cachedBrier.glicko2;

  const bmaInputs = bmaModels.map(m => ({
    name: m.name,
    probability: m.probability,
    brierScore: brierMap[m.name] ?? null,
  }));

  const bmaResult = bmaInputs.length > 0
    ? bayesianModelAverage(bmaInputs)
    : { probability: ruleBasedP, modelWeights: {}, modelProbs: {}, bayesianBrier: 0 };

  const ensembleP = bmaResult.probability;

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
    gap: gapP,
    pi: piRatingP,
    glicko2: glicko2P,
  };
  const stackingP = predictStacking(stackingInput);
  // Stacking şu an sadece loglanır, kullanılmaz. İleride ensembleP yerine geçebilir.
  if (process.env.NODE_ENV === 'development' && stackingP > 0.1) {
    console.log(`[Stacking] ensemble=${ensembleP.toFixed(3)} stacking=${stackingP.toFixed(3)}`);
  }

  // ── Model agreement (excluding zero predictions) ──
  const allPredictions = [ruleBasedP, poissonP, eloP, mlP, teamStrengthP, inPlayP, gapP, piRatingP, glicko2P].filter((p) => p > 0.01);
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

  // Faz 2 (C) — alpha-blend gating. Production feature flag
  // STACKING_BLEND_ALPHA ∈ [0, 1]: 0=devre dışı (BMA-only), 1=full stacking.
  // Yalnız ring buffer eğitim verisi yeterliyse ve model agreement yüksekse
  // aktif olur (cold-start guard + agreement gate).
  // Faz 2 — Stacking α-blend. Default α=0.5 (önerilen). env override edilebilir.
  const stackingAlpha = parseFloat(process.env.STACKING_BLEND_ALPHA ?? '0.0');
  const STACKING_MIN_SAMPLES = 200; // trainStackingMetaModel n<100 reddeder; burada 200 ile conservative
  const stackingSampleCount = getStackingSamplesCount();
  const stackingEligible =
    stackingAlpha > 0 &&
    stackingSampleCount >= STACKING_MIN_SAMPLES &&
    agreement >= 0.4; // model-uyumu yüksekken stacking daha güvenli
  let finalEnsembleP = ensembleP;
  if (stackingEligible) {
    finalEnsembleP = (1 - stackingAlpha) * ensembleP + stackingAlpha * stackingP;
    finalEnsembleP = Math.max(0, Math.min(1, finalEnsembleP));
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[Stacking-Blend] alpha=${stackingAlpha} samples=${stackingSampleCount} ` +
        `agreement=${agreement.toFixed(3)} bma=${ensembleP.toFixed(3)} ` +
        `stack=${stackingP.toFixed(3)} -> ${finalEnsembleP.toFixed(3)}`,
      );
    }
  }

  // ── Ensemble derived predictions ──
  // A4-fix: rule-based ham skordan türetilmiş O2.5/BTTS tahminleri Poisson'a
  // tercih edilir; bu sayede `ensembleP · 1.5 / 0.7` gibi keyfi scaling ortadan
  // kalkar (ruleP yüksek → O2.5 yüksek yöndeki korelasyon doğal).
  // BASE_RATE_OVER25=0.53, BASE_RATE_BTTS=0.50 ligler-arası ortalama (Open
  // International Soccer DB / Wheatcroft 2024 istatistikleri). ruleScore/100
  // offset ile smoothed: ruleScore=60 → +0.05 push üzerinde base.
  const ruleScoreNorm = Math.max(0, Math.min(1, ruleBasedP));
  const BASE_RATE_OVER25 = 0.53;
  const BASE_RATE_BTTS = 0.5;
  const ruleOverUnder = Math.max(
    0,
    Math.min(1, BASE_RATE_OVER25 + (ruleScoreNorm - 0.5) * 0.5),
  );
  const ruleBTTS = Math.max(
    0,
    Math.min(1, BASE_RATE_BTTS + (ruleScoreNorm - 0.5) * 0.6),
  );
  const ensembleOverUnder =
    poissonOverUnder > 0 ? poissonOverUnder : ruleOverUnder;
  const ensembleBTTS = poissonBTTS > 0 ? poissonBTTS : ruleBTTS;

  // Blend 1X2 predictions from Poisson, Elo, and Kalman team strength.
  // Team strength contributes 0.20 weight when both teams are rated,
  // tapers to 0.05 when only one is rated, 0 otherwise.
  // A4-fix: tsRated artık oransal güven yerine eşik-tabanlı binary karar.
  // Önceki implementasyon `Math.min(teamStrengthConf>0?1:0, 1)` şeklindeydi
  // ve Math.min no-op'tu; okunabilirliği ve niyeti netleştirmek için düzeltildi.
  const tsRated = teamStrengthConf >= 0.5 ? 1 : 0; // 0.5 üstü tam katılım
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
    { name: "GAP", weight: weights.gap * gapP },
    { name: "PiRating", weight: piRatingP },
    { name: "Glicko2", weight: glicko2P },
  ];
  const dominantModel = modelWeights.reduce((a, b) =>
    a.weight > b.weight ? a : b,
  ).name;

  // ── Determine side ──
  // Faz 7 — stats-tabanlı helper'a yönlendirildi. score-based determineSide
  // goalRadar.ts içinde, burada ensemble kendi heuristic'ini kullanır.
  const side: "home" | "away" | "both" | null = determineSideByStats(stats);

  // ── Score (0-100 for compatibility) ──
  // Faz 2 (C) — finalEnsembleP stacking-blend'i içerir (alpha > 0 ise).
  // Sinyal sayısı invariant'ı alpha-blend kapalıyken (default) korunur.
  const score = Math.round(finalEnsembleP * 100);

  // ── Alert level ──
  let level: "low" | "medium" | "high" | "critical";
  if (finalEnsembleP < 0.2) level = "low";
  else if (finalEnsembleP < 0.4) level = "medium";
  else if (finalEnsembleP < 0.6) level = "high";
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
    probability: Math.round(finalEnsembleP * 1000) / 1000,
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
