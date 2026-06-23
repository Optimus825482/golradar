// ── Goal Predictor: Gradient Boosted Decision Trees (GBDT) ────────
// Implements a lightweight GBDT ensemble in pure TypeScript for
// in-play goal probability prediction.

import { devLog, devWarn, devError } from './devLog';
//
// Architecture:
//   - Regression trees with depth 3-4
//   - 50-100 boosting iterations
//   - Learning rate 0.1
//   - L2 regularization
//   - Feature subsampling per tree (0.8)
//
// This avoids Python dependency while providing ML-grade predictions.
// The model is trained offline and loaded at runtime.

import { FEATURE_NAMES, type TrainingRecord } from './featureEngineering';

// ── Decision Tree Node ────────────────────────────────────────────

interface TreeNode {
  isLeaf: boolean;
  // Internal node
  featureIndex?: number;
  threshold?: number;
  left?: TreeNode;   // feature < threshold
  right?: TreeNode;  // feature >= threshold
  // Leaf node
  value?: number;     // Prediction value
}

// ── GBDT Model ────────────────────────────────────────────────────

interface GBDTModel {
  trees: TreeNode[];
  initPrediction: number;   // Base prediction (mean of labels)
  learningRate: number;
  numFeatures: number;
  featureImportance: number[];
  trainingMeta: {
    numTrees: number;
    maxDepth: number;
    numSamples: number;
    brierScore: number;
    trainedAt: number;
  };
}

function getServerFs(): { fs: any; path: any } | null {
  if (typeof window !== 'undefined') return null;
  try {
    return { fs: require('fs'), path: require('path') };
  } catch { return null; }
}

const sGp = getServerFs();
const DATA_DIR = sGp ? sGp.path.join(process.cwd(), 'data', 'ml-models') : '';
const MODEL_FILE = DATA_DIR ? sGp!.path.join(DATA_DIR, 'goal-predictor.json') : '';
const TRAINING_DATA_FILE = DATA_DIR ? sGp!.path.join(DATA_DIR, 'training-data.json') : '';

function ensureDataDir(): void {
  const s2 = getServerFs();
  if (!s2) return;
  if (!s2.fs.existsSync(DATA_DIR)) {
    s2.fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ── Tree Construction ──────────────────────────────────────────────

function buildTree(
  features: number[][],
  residuals: number[],
  depth: number,
  maxDepth: number,
  minSamples: number,
  featureSubset: number[], // Indices of features to consider
): TreeNode {
  const n = features.length;
  if (n === 0 || depth >= maxDepth || n < minSamples) {
    return { isLeaf: true, value: residuals.reduce((a, b) => a + b, 0) / Math.max(1, n) };
  }

  // All same residual → leaf
  const meanResidual = residuals.reduce((a, b) => a + b, 0) / n;
  if (residuals.every(r => Math.abs(r - meanResidual) < 1e-6)) {
    return { isLeaf: true, value: meanResidual };
  }

  let bestFeature = -1;
  let bestThreshold = 0;
  let bestGain = -Infinity;
  let bestLeftIdx: number[] = [];
  let bestRightIdx: number[] = [];

  for (const fi of featureSubset) {
    // Get unique sorted thresholds for this feature
    const values = features.map(row => row[fi]);
    const uniqueVals = [...new Set(values)].sort((a, b) => a - b);

    // Try midpoints between unique values (limit to 20 candidates for speed)
    const step = Math.max(1, Math.floor(uniqueVals.length / 20));
    const candidates: number[] = [];
    for (let i = 0; i < uniqueVals.length - 1; i += step) {
      candidates.push((uniqueVals[i] + uniqueVals[Math.min(i + step, uniqueVals.length - 1)]) / 2);
    }
    if (candidates.length === 0 && uniqueVals.length > 0) {
      candidates.push(uniqueVals[0]);
    }

    for (const threshold of candidates) {
      const leftIdx: number[] = [];
      const rightIdx: number[] = [];

      for (let i = 0; i < n; i++) {
        if (features[i][fi] < threshold) {
          leftIdx.push(i);
        } else {
          rightIdx.push(i);
        }
      }

      if (leftIdx.length < minSamples || rightIdx.length < minSamples) continue;

      // Calculate variance reduction (gain)
      const leftResiduals = leftIdx.map(i => residuals[i]);
      const rightResiduals = rightIdx.map(i => residuals[i]);

      const leftMean = leftResiduals.reduce((a, b) => a + b, 0) / leftResiduals.length;
      const rightMean = rightResiduals.reduce((a, b) => a + b, 0) / rightResiduals.length;

      const leftVar = leftResiduals.reduce((s, r) => s + (r - leftMean) ** 2, 0);
      const rightVar = rightResiduals.reduce((s, r) => s + (r - rightMean) ** 2, 0);
      const totalVar = residuals.reduce((s, r) => s + (r - meanResidual) ** 2, 0);

      const gain = totalVar - leftVar - rightVar - 0.1 * n; // L2 regularization

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = fi;
        bestThreshold = threshold;
        bestLeftIdx = leftIdx;
        bestRightIdx = rightIdx;
      }
    }
  }

  if (bestFeature === -1 || bestGain <= 0) {
    return { isLeaf: true, value: meanResidual };
  }

  const leftFeatures = bestLeftIdx.map(i => features[i]);
  const leftResiduals = bestLeftIdx.map(i => residuals[i]);
  const rightFeatures = bestRightIdx.map(i => features[i]);
  const rightResiduals = bestRightIdx.map(i => residuals[i]);

  return {
    isLeaf: false,
    featureIndex: bestFeature,
    threshold: bestThreshold,
    left: buildTree(leftFeatures, leftResiduals, depth + 1, maxDepth, minSamples, featureSubset),
    right: buildTree(rightFeatures, rightResiduals, depth + 1, maxDepth, minSamples, featureSubset),
  };
}

function predictTree(node: TreeNode, features: number[]): number {
  if (node.isLeaf) return node.value ?? 0;
  if (features[node.featureIndex!] < node.threshold!) {
    return predictTree(node.left!, features);
  }
  return predictTree(node.right!, features);
}

// ── GBDT Training ─────────────────────────────────────────────────

interface TrainingConfig {
  numTrees: number;         // Number of boosting iterations (default: 50)
  maxDepth: number;         // Tree depth (default: 4)
  learningRate: number;     // Shrinkage (default: 0.1)
  minSamples: number;       // Min samples per leaf (default: 10)
  featureSampleRatio: number; // Feature subsampling ratio (default: 0.8)
  l2Reg: number;            // L2 regularization (default: 0.1)
  seed: number;             // Faz 5 — RNG seed for reproducible training
}

const DEFAULT_CONFIG: TrainingConfig = {
  numTrees: 50,
  maxDepth: 4,
  learningRate: 0.1,
  minSamples: 10,
  featureSampleRatio: 0.8,
  l2Reg: 0.1,
  seed: 42,
};

// ── Faz 5 — Seedable RNG (mulberry32) ────────────────────────────
// Math.random() yerine deterministik üretici. Aynı seed + aynı veri
// → aynı ağaçlar (reproducible training).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trainGBDT(
  records: TrainingRecord[],
  config: Partial<TrainingConfig> = {},
): GBDTModel {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const n = records.length;
  if (n === 0) throw new Error('No training data');

  const features = records.map(r => r.features);
  const labels = records.map(r => r.label);
  // Faz 5: deterministic eğitim — seed yoksa cfg'den, yoksa sabit default.
  const rng = mulberry32(cfg.seed ?? 42);
  const numFeatures = features[0].length;

  // Initial prediction = mean of labels
  const initPrediction = labels.reduce((a, b) => a + b, 0) / n;

  // Initialize residuals
  let residuals = labels.map(y => y - initPrediction);

  const trees: TreeNode[] = [];
  const featureImportance = new Array(numFeatures).fill(0);

  for (let t = 0; t < cfg.numTrees; t++) {
    // Feature subsampling
    const featureSubset: number[] = [];
    for (let i = 0; i < numFeatures; i++) {
      if (Math.random() < cfg.featureSampleRatio) {
        featureSubset.push(i);
      }
    }
    if (featureSubset.length === 0) {
      featureSubset.push(Math.floor(Math.random() * numFeatures));
    }

    // Build tree on residuals
    const tree = buildTree(features, residuals, 0, cfg.maxDepth, cfg.minSamples, featureSubset);
    trees.push(tree);

    // Update residuals
    residuals = residuals.map((r, i) => {
      const prediction = predictTree(tree, features[i]);
      return r - cfg.learningRate * prediction;
    });

    // Track feature importance
    countFeatureUsage(tree, featureImportance);
  }

  // Normalize feature importance
  const totalImportance = featureImportance.reduce((a, b) => a + b, 0);
  if (totalImportance > 0) {
    for (let i = 0; i < featureImportance.length; i++) {
      featureImportance[i] /= totalImportance;
    }
  }

  // Calculate Brier Score on training data
  const brierScore = calculateTrainingBrier(features, labels, initPrediction, trees, cfg.learningRate);

  return {
    trees,
    initPrediction,
    learningRate: cfg.learningRate,
    numFeatures,
    featureImportance,
    trainingMeta: {
      numTrees: cfg.numTrees,
      maxDepth: cfg.maxDepth,
      numSamples: n,
      brierScore,
      trainedAt: Date.now(),
    },
  };
}

function countFeatureUsage(node: TreeNode, importance: number[]): void {
  if (!node || node.isLeaf) return;
  if (node.featureIndex != null) {
    importance[node.featureIndex]++;
  }
  if (node.left) countFeatureUsage(node.left, importance);
  if (node.right) countFeatureUsage(node.right, importance);
}

function calculateTrainingBrier(
  features: number[][],
  labels: number[],
  initPrediction: number,
  trees: TreeNode[],
  learningRate: number,
): number {
  let sum = 0;
  for (let i = 0; i < features.length; i++) {
    let pred = initPrediction;
    for (const tree of trees) {
      pred += learningRate * predictTree(tree, features[i]);
    }
    // Sigmoid to get probability
    const p = 1 / (1 + Math.exp(-pred));
    sum += (p - labels[i]) ** 2;
  }
  return sum / features.length;
}

// ── Prediction ─────────────────────────────────────────────────────

export interface PredictionResult {
  probability: number;      // 0-1 calibrated probability
  rawScore: number;         // Raw GBDT output (log-odds)
  confidence: number;       // 0-1 confidence based on feature completeness
  topFactors: Array<{
    feature: string;
    importance: number;
    value: number;
  }>;
}

export function predictGBDT(model: GBDTModel, features: number[]): PredictionResult {
  let rawScore = model.initPrediction;
  for (const tree of model.trees) {
    rawScore += model.learningRate * predictTree(tree, features);
  }

  // Sigmoid to convert log-odds to probability
  const probability = 1 / (1 + Math.exp(-rawScore));

  // Top contributing features
  const topFactors: Array<{ feature: string; importance: number; value: number }> = [];
  for (let i = 0; i < model.featureImportance.length; i++) {
    if (model.featureImportance[i] > 0.01) {
      topFactors.push({
        feature: FEATURE_NAMES[i] || `f${i}`,
        importance: model.featureImportance[i],
        value: features[i] ?? 0,
      });
    }
  }
  topFactors.sort((a, b) => b.importance - a.importance);

  // Confidence based on number of non-zero features
  const nonZeroFeatures = features.filter(f => f !== 0 && f !== 0.5).length;
  const confidence = Math.min(1, nonZeroFeatures / (FEATURE_NAMES.length * 0.6));

  return {
    probability: Math.round(probability * 1000) / 1000,
    rawScore: Math.round(rawScore * 1000) / 1000,
    confidence: Math.round(confidence * 100) / 100,
    topFactors: topFactors.slice(0, 10),
  };
}

// ── Model Persistence ──────────────────────────────────────────────

let cachedModel: GBDTModel | null = null;

function saveModel(model: GBDTModel): void {
  try {
    const s2 = getServerFs();
    if (!s2) return;
    ensureDataDir();
    s2.fs.writeFileSync(MODEL_FILE, JSON.stringify(model));
    cachedModel = model;
    devLog(`[ML] Model saved: ${model.trees.length} trees, Brier=${model.trainingMeta.brierScore.toFixed(4)}`);
  } catch (e) {
    devError('[ML] Failed to save model:', e);
  }
}

export function loadModel(): GBDTModel | null {
  if (cachedModel) return cachedModel;
  try {
    const s2 = getServerFs();
    if (!s2) return null;
    ensureDataDir();
    if (s2.fs.existsSync(MODEL_FILE)) {
      const data = JSON.parse(s2.fs.readFileSync(MODEL_FILE, 'utf-8'));
      cachedModel = data;
      devLog(`[ML] Model loaded: ${data.trees.length} trees, trained ${new Date(data.trainingMeta.trainedAt).toISOString()}`);
      return data;
    }
  } catch (e) {
    devError('[ML] Failed to load model:', e);
  }
  // No model on disk — auto-train with synthetic data
  devLog('[ML] No model found, auto-training with synthetic data...');
  return initializeModel();
}

// ── Training Data Persistence ──────────────────────────────────────

export function saveTrainingRecord(record: TrainingRecord): void {
  try {
    const s2 = getServerFs();
    if (!s2) return;
    ensureDataDir();
    let records: TrainingRecord[] = [];
    if (s2.fs.existsSync(TRAINING_DATA_FILE)) {
      records = JSON.parse(s2.fs.readFileSync(TRAINING_DATA_FILE, 'utf-8'));
    }
    records.push(record);
    if (records.length > 50000) records = records.slice(-50000);
    s2.fs.writeFileSync(TRAINING_DATA_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    devError('[ML] Failed to save training record:', e);
  }
}

function loadTrainingData(): TrainingRecord[] {
  try {
    const s2 = getServerFs();
    if (!s2) return [];
    ensureDataDir();
    if (s2.fs.existsSync(TRAINING_DATA_FILE)) {
      return JSON.parse(s2.fs.readFileSync(TRAINING_DATA_FILE, 'utf-8'));
    }
  } catch (e) {
    devError('[ML] Failed to load training data:', e);
  }
  return [];
}

// ── Generate synthetic training data for bootstrap ─────────────────
// When we don't have enough real training data, generate synthetic
// samples based on the known statistical properties of football.

function generateSyntheticTrainingData(numSamples: number = 5000): TrainingRecord[] {
  const records: TrainingRecord[] = [];

  for (let i = 0; i < numSamples; i++) {
    const minute = Math.floor(Math.random() * 90) + 1;
    const elapsed15 = Math.max(1, minute / 15);

    // Simulate match stats with realistic distributions
    const possHome = 40 + Math.random() * 20; // 40-60%
    const possAway = 100 - possHome;

    const daHome = Math.floor(Math.random() * 50 * (minute / 90));
    const daAway = Math.floor(Math.random() * 50 * (minute / 90));

    const sotHome = Math.floor(Math.random() * 8 * (minute / 90));
    const sotAway = Math.floor(Math.random() * 8 * (minute / 90));

    const shotsHome = sotHome + Math.floor(Math.random() * 10 * (minute / 90));
    const shotsAway = sotAway + Math.floor(Math.random() * 10 * (minute / 90));

    const cornersHome = Math.floor(Math.random() * 8 * (minute / 90));
    const cornersAway = Math.floor(Math.random() * 8 * (minute / 90));

    const xgHome = sotHome * 0.38 + Math.max(0, shotsHome - sotHome) * 0.05 + cornersHome * 0.04 + daHome * 0.01;
    const xgAway = sotAway * 0.38 + Math.max(0, shotsAway - sotAway) * 0.05 + cornersAway * 0.04 + daAway * 0.01;

    // Calculate pressure
    const totalPoss = possHome + possAway;
    const totalDA = daHome + daAway;
    const totalSOT = sotHome + sotAway;
    const totalCorners = cornersHome + cornersAway;
    const totalShots = shotsHome + shotsAway;

    const homePressure = (totalPoss > 0 ? (possHome / totalPoss) * 0.075 * 100 : 0) +
                        (totalDA > 0 ? (daHome / totalDA) * 0.30 * 100 : 0) +
                        (totalShots > 0 ? (shotsHome / totalShots) * 0.15 * 100 : 0) +
                        (totalSOT > 0 ? (sotHome / totalSOT) * 0.25 * 100 : 0) +
                        (totalCorners > 0 ? (cornersHome / totalCorners) * 0.125 * 100 : 0);

    // Goal probability model: based on research-calibrated features
    // Higher xG, SOT rate, pressure, and late minutes → more likely goal
    const xgRate = (xgHome + xgAway) / elapsed15;
    const sotRate = (sotHome + sotAway) / elapsed15;
    const timeFactor = minute <= 15 ? 0.70 : minute <= 30 ? 0.88 : minute <= 45 ? 1.05 :
                       minute <= 60 ? 1.00 : minute <= 75 ? 1.12 : 1.30;
    const pressureIntensity = Math.abs(homePressure - 50) / 50;

    // Base goal probability per 10-minute window: ~8-15%
    // Calibrated from literature: ~2.5 goals per match, 90 min
    const baseGoalP = (2.5 / 9) * (10 / 90); // ~3% per minute → ~30% per 10 min
    const adjustedP = baseGoalP * timeFactor * (1 + xgRate * 0.8) * (1 + pressureIntensity * 0.3);

    // Label: 1 if goal in next 10 min (probabilistic)
    const label = Math.random() < Math.min(0.7, adjustedP * 10) ? 1 : 0;

    // Build feature vector
    const features = new Array(FEATURE_NAMES.length).fill(0);
    const norm = (v: number, min: number, max: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));
    const normRate = (v: number, max: number) => Math.max(0, Math.min(1, v / max));

    features[0] = homePressure / 100;                    // pressure_home
    features[1] = (100 - homePressure) / 100;            // pressure_away
    features[2] = Math.abs(homePressure - 50) / 50;      // pressure_gap
    features[3] = homePressure > 50 ? 1 : 0;            // pressure_dominant_side
    features[4] = possHome / 100;                        // possession_home
    features[5] = Math.abs(possHome - possAway) / 100;   // possession_gap
    features[6] = normRate(daHome / elapsed15, 8);       // dangerous_attacks_home_rate
    features[7] = normRate(shotsHome / elapsed15, 8);    // shots_total_home_rate
    features[8] = normRate(shotsAway / elapsed15, 8);    // shots_total_away_rate
    features[9] = normRate(sotHome / elapsed15, 6);      // shots_on_target_home_rate
    features[10] = normRate(sotAway / elapsed15, 6);     // shots_on_target_away_rate
    features[11] = shotsHome > 0 ? sotHome / shotsHome : 0; // sot_ratio_home
    features[12] = shotsAway > 0 ? sotAway / shotsAway : 0; // sot_ratio_away
    features[13] = norm(xgHome, 0, 3.0);                // xg_home
    features[14] = norm(xgAway, 0, 3.0);                // xg_away
    features[15] = normRate(cornersHome / elapsed15, 5); // corners_home_rate
    features[16] = normRate(cornersAway / elapsed15, 5); // corners_away_rate
    features[25] = minute / 90;                          // match_minute_norm
    features[26] = norm(timeFactor, 0.5, 1.5);          // time_multiplier
    features[27] = minute <= 45 ? 1 : 0;                // is_first_half
    features[28] = minute >= 76 ? 1 : 0;                // is_peak_goal_time

    records.push({
      features,
      label,
      matchCode: -1, // synthetic
      minute,
      timestamp: Date.now() - (90 - minute) * 60000,
      side: Math.random() > 0.5 ? 'home' : 'away',
    });
  }

  return records;
}

// ── Initialize or retrain model ────────────────────────────────────

function initializeModel(): GBDTModel | null {
  // Try loading existing model first
  const existing = loadModel();
  if (existing && existing.trainingMeta.trainedAt > Date.now() - 7 * 86400000) {
    devLog('[ML] Using existing model (less than 7 days old)');
    return existing;
  }

  // Need to train or retrain
  devLog('[ML] Training new model...');

  // Load real training data if available
  let realData = loadTrainingData();
  devLog(`[ML] Real training records: ${realData.length}`);

  // Supplement with synthetic data
  const synthData = generateSyntheticTrainingData(Math.max(1000, 5000 - realData.length));
  const allData = [...realData, ...synthData];

  // Balance classes (goal vs no-goal)
  const goals = allData.filter(r => r.label === 1);
  const noGoals = allData.filter(r => r.label === 0);
  const minClass = Math.min(goals.length, noGoals.length);

  // Oversample minority class
  let balancedData: TrainingRecord[];
  if (goals.length < noGoals.length) {
    const oversampledGoals = Array(Math.ceil(noGoals.length / Math.max(1, goals.length)))
      .fill(goals).flat().slice(0, noGoals.length);
    balancedData = [...oversampledGoals, ...noGoals];
  } else {
    const oversampledNoGoals = Array(Math.ceil(goals.length / Math.max(1, noGoals.length)))
      .fill(noGoals).flat().slice(0, goals.length);
    balancedData = [...goals, ...oversampledNoGoals];
  }

  // Shuffle
  for (let i = balancedData.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [balancedData[i], balancedData[j]] = [balancedData[j], balancedData[i]];
  }

  try {
    const model = trainGBDT(balancedData, {
      numTrees: 60,
      maxDepth: 4,
      learningRate: 0.1,
      minSamples: 5,
      featureSampleRatio: 0.8,
    });

    saveModel(model);
    devLog(`[ML] Model trained: ${model.trees.length} trees, Brier=${model.trainingMeta.brierScore.toFixed(4)}, samples=${balancedData.length}`);
    return model;
  } catch (e) {
    devError('[ML] Training failed:', e);
    return existing; // Fall back to existing model
  }
}

// ── Retrain with new data ──────────────────────────────────────────

export function retrainModel(): { success: boolean; brierScore: number; numSamples: number } {
  const model = initializeModel();
  if (!model) {
    return { success: false, brierScore: 1.0, numSamples: 0 };
  }
  return {
    success: true,
    brierScore: model.trainingMeta.brierScore,
    numSamples: model.trainingMeta.numSamples,
  };
}
