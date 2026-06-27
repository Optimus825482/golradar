// ── Signal Tier System (AI Berkshire inspired) ─────────────────
// Force verdict + confidence tiers for goal signals.
// Every signal gets a verdict tier based on model agreement and probability.

export type SignalVerdict = 'HIGH' | 'MEDIUM' | 'LOW' | 'SKIP';

export interface VerdictResult {
  tier: SignalVerdict;
  probability: number;     // 0-1 ensemble probability
  score: number;           // 0-100 goal radar score
  level: 'low' | 'medium' | 'high' | 'critical';
  agreement: number;       // 0-1 model agreement ratio
  modelCount: number;      // models contributing
  reason: string;          // why this verdict
}

export interface ModelVote {
  name: string;
  probability: number;   // 0-1
  confidence: number;    // 0-1
}

/**
 * Force a verdict from individual model predictions.
 * AI Berkshire pattern: Pass / Fail / Gray Zone → HIGH / MEDIUM / LOW / SKIP.
 */
export function forceVerdict(models: ModelVote[]): VerdictResult {
  if (models.length === 0) {
    return {
      tier: 'SKIP',
      probability: 0,
      score: 0,
      level: 'low',
      agreement: 0,
      modelCount: 0,
      reason: 'No model predictions available',
    };
  }

  const totalWeight = models.reduce((s, m) => s + m.confidence, 0);
  const weightedProb = models.reduce((s, m) => s + m.probability * m.confidence, 0) / totalWeight;
  const score = Math.round(weightedProb * 100);

  // Agreement: models that agree on direction (all prob > 0.5 or all prob < 0.5)
  const aboveThreshold = models.filter(m => m.probability > 0.5).length;
  const belowThreshold = models.filter(m => m.probability <= 0.5).length;
  const agreeing = Math.max(aboveThreshold, belowThreshold);
  const agreement = agreeing / models.length;

  // Level based on score
  const level = score >= 75 ? 'critical'
    : score >= 65 ? 'high'
    : score >= 50 ? 'medium'
    : 'low';

  // Force verdict based on agreement + weighted probability
  if (agreeing >= 3 && weightedProb > 0.65) {
    return {
      tier: 'HIGH',
      probability: weightedProb,
      score,
      level,
      agreement,
      modelCount: models.length,
      reason: `${agreeing}/${models.length} models agree at ${(weightedProb * 100).toFixed(0)}%`,
    };
  }

  if (agreeing >= 2 && weightedProb > 0.50) {
    return {
      tier: 'MEDIUM',
      probability: weightedProb,
      score,
      level,
      agreement,
      modelCount: models.length,
      reason: `${agreeing}/${models.length} models agree, moderate confidence`,
    };
  }

  if (agreeing >= 1 && weightedProb > 0.40) {
    return {
      tier: 'LOW',
      probability: weightedProb,
      score,
      level,
      agreement,
      modelCount: models.length,
      reason: `Low agreement (${agreeing}/${models.length}), marginal probability`,
    };
  }

  return {
    tier: 'SKIP',
    probability: weightedProb,
    score,
    level,
    agreement,
    modelCount: models.length,
    reason: `No consensus (${agreeing}/${models.length}), prob too low`,
  };
}

/**
 * Check if a verdict should generate an alert.
 */
export function shouldAlert(verdict: VerdictResult): boolean {
  return verdict.tier === 'HIGH';
}

/**
 * Check if a verdict should be logged (but not alerted).
 */
export function shouldLog(verdict: VerdictResult): boolean {
  return verdict.tier === 'MEDIUM' || verdict.tier === 'LOW';
}
