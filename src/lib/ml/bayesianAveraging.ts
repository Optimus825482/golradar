// ── Bayesian Model Averaging (BMA) ───────────────────────────
// Replace weighted average with Bayesian model averaging.
// Each model's weight is its posterior probability given the data.
// Better models (lower Brier) get naturally higher weight.
//
// Reference: Raftery, A.E. et al. (2005). "Bayesian Model Averaging
// for Linear Regression Models."

export interface BMAResult {
  probability: number;     // BMA-weighted probability
  modelWeights: Record<string, number>;  // posterior weights per model
  modelProbs: Record<string, number>;    // individual probabilities
  bayesianBrier: number;   // Expected Brier under BMA
}

interface ModelInput {
  name: string;
  probability: number;   // 0-1
  brierScore: number | null;  // null = unranked
}

/**
 * BMA hesaplama: her modelin Brier score'undan posterior weight türet.
 * 
 * Weight = exp(-Brier_i^2 / 2σ^2) / Σ exp(-Brier_j^2 / 2σ^2)
 * 
 * σ: Brier ölçeği (default 0.25). Düşük σ = keskin ayrım, yüksek σ = yumuşak.
 */
export function bayesianModelAverage(
  models: ModelInput[],
  sigma: number = 0.25,
): BMAResult {
  if (models.length === 0) {
    return { probability: 0, modelWeights: {}, modelProbs: {}, bayesianBrier: 0 };
  }

  // Default Brier for unranked models
  const DEFAULT_BRIER = 0.25;

  // Compute weights via Gaussian kernel on Brier
  let totalWeight = 0;
  const weights: Record<string, number> = {};
  const probs: Record<string, number> = {};

  for (const m of models) {
    const brier = m.brierScore ?? DEFAULT_BRIER;
    // Lower Brier → higher weight
    const w = Math.exp(-(brier * brier) / (2 * sigma * sigma));
    weights[m.name] = w;
    probs[m.name] = m.probability;
    totalWeight += w;
  }

  // Normalize weights
  if (totalWeight > 0) {
    for (const name of Object.keys(weights)) {
      weights[name] /= totalWeight;
    }
  }

  // BMA probability = weighted average with posterior weights
  let bmaProb = 0;
  let expectedBrier = 0;
  for (const m of models) {
    const w = weights[m.name] ?? 0;
    bmaProb += w * m.probability;
    expectedBrier += w * (m.brierScore ?? DEFAULT_BRIER);
  }

  // Clamp
  bmaProb = Math.max(0, Math.min(1, bmaProb));
  expectedBrier = Math.max(0, Math.min(1, expectedBrier));

  return {
    probability: Math.round(bmaProb * 1000) / 1000,
    modelWeights: weights,
    modelProbs: probs,
    bayesianBrier: Math.round(expectedBrier * 1000) / 1000,
  };
}

/**
 * BMA'yı ensemble weight'lerine dönüştür.
 * computeEnsembleWeights + BMA harmonizasyonu için.
 */
export function bmaToEnsembleWeights(
  models: Array<{ name: string; brier: number | null }>,
): Record<string, number> {
  const inputs: ModelInput[] = models.map(m => ({
    name: m.name,
    probability: 0.5, // placeholder, sadece weight istiyoruz
    brierScore: m.brier,
  }));
  const result = bayesianModelAverage(inputs);
  return result.modelWeights;
}
