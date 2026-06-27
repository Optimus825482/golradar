// ── Stacking Ensemble Meta-Model ──────────────────────────────
// Instead of weighted averaging, train a small logistic regression
// meta-model that takes individual model probabilities as input.
// 
// Reference: Wolpert, D.H. (1992). "Stacked generalization."
// Training: use PredictionLog records with known outcomes.

export interface StackingInput {
  ruleBased: number;
  poisson: number;
  elo: number;
  ml: number;
  teamStrength: number;
  inplay: number;
}

export interface StackingWeights {
  intercept: number;
  ruleBased: number;
  poisson: number;
  elo: number;
  ml: number;
  teamStrength: number;
  inplay: number;
}

// In-memory stacking weights — varsayılan eşit ağırlık
let currentWeights: StackingWeights = {
  intercept: 0,
  ruleBased: 1,
  poisson: 1,
  elo: 1,
  ml: 1,
  teamStrength: 1,
  inplay: 1,
};

const MAX_TRAINING_SAMPLES = 2000;
const trainingData: Array<{ input: StackingInput; actual: number }> = [];

/**
 * Yeni bir eğitim örneği ekle (gerçek sonuç bilindikten sonra).
 */
export function addStackingSample(input: StackingInput, actualGoal: number): void {
  trainingData.push({ input, actual: actualGoal });
  if (trainingData.length > MAX_TRAINING_SAMPLES) {
    trainingData.shift();
  }
}

/**
 * Logistic regression meta-model train.
 * Features: her modelin probability'si.
 * Target: goal oldu mu (0/1).
 */
export function trainStackingMetaModel(): StackingWeights {
  const n = trainingData.length;
  if (n < 100) return currentWeights; // yeterli veri yok

  // Gradient descent for logistic regression
  let w = { ...currentWeights };
  const lr = 0.01;
  const epochs = 500;

  for (let epoch = 0; epoch < epochs; epoch++) {
    let gradIntercept = 0;
    let gradRule = 0, gradPoisson = 0, gradElo = 0, gradMl = 0, gradTs = 0, gradInplay = 0;

    for (const sample of trainingData) {
      const z = w.intercept
        + w.ruleBased * sample.input.ruleBased
        + w.poisson * sample.input.poisson
        + w.elo * sample.input.elo
        + w.ml * sample.input.ml
        + w.teamStrength * sample.input.teamStrength
        + w.inplay * sample.input.inplay;
      const pred = 1 / (1 + Math.exp(-z));
      const err = pred - sample.actual;

      gradIntercept += err;
      gradRule += err * sample.input.ruleBased;
      gradPoisson += err * sample.input.poisson;
      gradElo += err * sample.input.elo;
      gradMl += err * sample.input.ml;
      gradTs += err * sample.input.teamStrength;
      gradInplay += err * sample.input.inplay;
    }

    w.intercept -= lr * (gradIntercept / n);
    w.ruleBased -= lr * (gradRule / n);
    w.poisson -= lr * (gradPoisson / n);
    w.elo -= lr * (gradElo / n);
    w.ml -= lr * (gradMl / n);
    w.teamStrength -= lr * (gradTs / n);
    w.inplay -= lr * (gradInplay / n);
  }

  currentWeights = w;
  return w;
}

/**
 * Meta-model ile tahmin yap.
 * Önce linear kombinasyon, sonra sigmoid.
 */
export function predictStacking(input: StackingInput): number {
  const z = currentWeights.intercept
    + currentWeights.ruleBased * input.ruleBased
    + currentWeights.poisson * input.poisson
    + currentWeights.elo * input.elo
    + currentWeights.ml * input.ml
    + currentWeights.teamStrength * input.teamStrength
    + currentWeights.inplay * input.inplay;

  // Sigmoid
  const p = 1 / (1 + Math.exp(-z));
  return Math.round(p * 1000) / 1000;
}

/**
 * Mevcut stacking ağırlıklarını döndür.
 */
export function getStackingWeights(): StackingWeights {
  return { ...currentWeights };
}
