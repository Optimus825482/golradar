// ── Dynamic Ensemble Weight Tuner ──────────────────────────────────
// Adjusts ensemble model weights based on per-model Brier tier and
// match context (minute, pressure history). Replaces the static
// base-weights in ensemble.ts calculateDynamicWeights with a
// tier-driven scheme: better-calibrated models (low Brier) get more
// weight, poorly-calibrated ones (Brier ≥ 0.50) are zeroed out.
//
// Tier mapping (shared via @/config BRIER_TIERS):
//   brier < 0.18         → tier "excellent" → contributes heavily
//   0.18 ≤ brier < 0.25   → tier "good"
//   0.25 ≤ brier < 0.32   → tier "fair"
//   0.32 ≤ brier < 0.40   → tier "poor"
//   0.40 ≤ brier < 0.50   → tier "disabled" (weight 0)
//   brier ≥ 0.50          → weight 0
//   brier == null         → fallback weight 0.20 (unranked)

import { tierWeight } from '@/config';

export interface WeightTunerInput {
  inplayBrier?: number | null;
  ruleBrier?: number | null;
  poissonBrier?: number | null;
  eloBrier?: number | null;
  mlBrier?: number | null;
  teamStrengthBrier?: number | null;
  gapBrier?: number | null;
  piBrier?: number | null;
  glicko2Brier?: number | null;
  minute?: number;
  hasPressureHistory?: boolean;
}

export interface EnsembleWeights {
  ruleBased: number;
  poisson: number;
  elo: number;
  ml: number;
  teamStrength: number;
  inplay: number;
  gap: number;
  pi: number;
  glicko2: number;
}

interface ModelSlot {
  name: keyof EnsembleWeights;
  brier: number | null | undefined;
  baseWeight: number; // tier-derived base weight
  earlyBonus: number;  // extra weight when minute <= 20
  lateBonus: number;   // extra weight when minute >= 60
  pressureBonus: number; // extra weight when hasPressureHistory
}

export function computeEnsembleWeights(input: WeightTunerInput): EnsembleWeights {
  const minute = input.minute ?? 45;
  const hasHistory = input.hasPressureHistory ?? false;

  const slots: ModelSlot[] = [
    {
      name: 'inplay',
      brier: input.inplayBrier,
      baseWeight: tierWeight(input.inplayBrier),
      earlyBonus: 0,
      lateBonus: 0.1,
      pressureBonus: 0.05,
    },
    {
      name: 'ml',
      brier: input.mlBrier,
      baseWeight: tierWeight(input.mlBrier),
      earlyBonus: -0.05,
      lateBonus: 0.05,
      pressureBonus: 0.03,
    },
    {
      name: 'ruleBased',
      brier: input.ruleBrier,
      baseWeight: tierWeight(input.ruleBrier),
      earlyBonus: -0.1,
      lateBonus: 0.1,
      pressureBonus: 0.05,
    },
    {
      name: 'poisson',
      brier: input.poissonBrier,
      baseWeight: tierWeight(input.poissonBrier),
      earlyBonus: 0.07,
      lateBonus: -0.07,
      pressureBonus: -0.04,
    },
    {
      name: 'elo',
      brier: input.eloBrier,
      baseWeight: tierWeight(input.eloBrier),
      earlyBonus: 0.08,
      lateBonus: -0.08,
      pressureBonus: -0.04,
    },
    {
      name: 'teamStrength',
      brier: input.teamStrengthBrier,
      baseWeight: tierWeight(input.teamStrengthBrier),
      earlyBonus: 0,
      lateBonus: 0,
      pressureBonus: 0,
    },
    {
      name: 'gap',
      brier: input.gapBrier,
      baseWeight: tierWeight(input.gapBrier),
      earlyBonus: 0.02,
      lateBonus: 0.02,
      pressureBonus: 0.01,
    },
    {
      name: 'pi',
      brier: input.piBrier,
      baseWeight: tierWeight(input.piBrier),
      earlyBonus: -0.03,
      lateBonus: 0.03,
      pressureBonus: 0.02,
    },
    {
      name: 'glicko2',
      brier: input.glicko2Brier,
      baseWeight: tierWeight(input.glicko2Brier),
      earlyBonus: 0.02,
      lateBonus: 0.02,
      pressureBonus: 0.01,
    },
  ];

  // Cap each slot's tier weight before applying bonuses, so bonuses
  // redistribute residual budget rather than inflate one model past
  // its tier ceiling. In-play gets a separate ramp gate (minute 20
  // → 30 → cap at 0.30) since early-match in-play data is too noisy.
  const TIER_CAPS: Record<keyof EnsembleWeights, number> = {
    inplay: 0.30,
    ml: 0.35,
    ruleBased: 0.45,    // grid search: 0.35→0.45
    poisson: 0.35,      // grid search: 0.30→0.35
    elo: 0.25,          // grid search: 0.20→0.25
    teamStrength: 0.15,
    gap: 0.15,          // Faz 4 (Yol B) — lite mode; ENV-gated, küçük cap
    pi: 0.20,           // Faz 7 (Yol C) — Pi-Rating ENV-gated, iç/deplasman
    glicko2: 0.20,      // Faz 7 (Yol C) — Glicko-2 ENV-gated, belirsizlik
  };
  // ⚠️  Applies grid search result but only on 51 records — recalibrate
  // when predictionLog reaches 500+ goalScored labels.

  for (const slot of slots) {
    // Cap the tier weight first.
    if (slot.baseWeight > TIER_CAPS[slot.name]) {
      slot.baseWeight = TIER_CAPS[slot.name];
    }
    if (minute <= 20) {
      slot.baseWeight += slot.earlyBonus;
    } else if (minute >= 60) {
      slot.baseWeight += slot.lateBonus;
    }
    if (hasHistory) {
      slot.baseWeight += slot.pressureBonus;
    }
    if (slot.baseWeight < 0) slot.baseWeight = 0;
    // Re-cap after bonuses so we never exceed the tier ceiling.
    if (slot.baseWeight > TIER_CAPS[slot.name]) {
      slot.baseWeight = TIER_CAPS[slot.name];
    }
  }

  // In-play gate: 0 before minute 20, ramps to cap after 30
  const inplaySlot = slots.find((s) => s.name === 'inplay')!;
  if (minute <= 20) {
    inplaySlot.baseWeight = 0;
  } else if (minute <= 30) {
    inplaySlot.baseWeight = inplaySlot.baseWeight * ((minute - 20) / 10);
  }

  const gapSlot = slots.find((s) => s.name === 'gap')!;
  const piSlot = slots.find((s) => s.name === 'pi')!;
  const glicko2Slot = slots.find((s) => s.name === 'glicko2')!;
  // Faz 4 — gap slot guardrail. brier null ise (henüz ölçülmediyse) slot
  // tier=0.20 unranked → küçük ağırlık. Tier ≥ 1.0 gelse bile max 0.15 cap.
  // Sinyal sayısı invariant: cap düşük → gap hiçbir zaman domine edemez.
  const raw: EnsembleWeights = {
    ruleBased: slots.find((s) => s.name === 'ruleBased')!.baseWeight,
    poisson: slots.find((s) => s.name === 'poisson')!.baseWeight,
    elo: slots.find((s) => s.name === 'elo')!.baseWeight,
    ml: slots.find((s) => s.name === 'ml')!.baseWeight,
    teamStrength: slots.find((s) => s.name === 'teamStrength')!.baseWeight,
    inplay: inplaySlot.baseWeight,
    gap: gapSlot.baseWeight,
    pi: piSlot.baseWeight,
    glicko2: glicko2Slot.baseWeight,
  };

  // Normalize to sum = 1.0
  const sum =
    raw.ruleBased + raw.poisson + raw.elo + raw.ml + raw.teamStrength + raw.inplay +
    raw.gap + raw.pi + raw.glicko2;
  if (sum <= 0) {
    return {
      ruleBased: 0.45, poisson: 0.15, elo: 0.08, ml: 0.05, teamStrength: 0.05,
      inplay: 0, gap: 0, pi: 0, glicko2: 0,
    };
  }
  return {
    ruleBased: raw.ruleBased / sum,
    poisson: raw.poisson / sum,
    elo: raw.elo / sum,
    ml: raw.ml / sum,
    teamStrength: raw.teamStrength / sum,
    inplay: raw.inplay / sum,
    gap: raw.gap / sum,
    pi: raw.pi / sum,
    glicko2: raw.glicko2 / sum,
  };
}

// ── Online Weight Update ──────────────────────────────────────
// Son N sinyalin doğruluğuna göre model ağırlıklarını dinamik ayarlar.
// Her golden sonra veya periyodik olarak çağrılır.

interface ModelPredictionRecord {
  model: string;
  predicted: number;  // 0-1 probability
  actual: number;     // 0 or 1 (goal or not)
  timestamp: number;
}

// Rolling window of recent predictions per model
const MAX_RECORDS = 500;
const recentRecords: ModelPredictionRecord[] = [];

/**
 * Yeni bir tahmin kaydı ekle. Her golden sonra veya expire'de çağrılır.
 */
export function recordPrediction(model: string, predicted: number, actual: number): void {
  recentRecords.push({ model, predicted, actual, timestamp: Date.now() });
  if (recentRecords.length > MAX_RECORDS) {
    recentRecords.shift();
  }
}

/**
 * Son N kayda göre per-model online weight adjustment factor hesapla.
 * Brier-based: düşük Brier score = iyi kalibrasyon → bonus weight.
 * Returns: { "modelName": adjustmentFactor } — 1.0 = nötr, >1 = bonus, <1 = ceza
 */
export function computeOnlineAdjustments(): Record<string, number> {
  const perModel: Record<string, { sumBrier: number; total: number }> = {};

  for (const r of recentRecords) {
    if (!perModel[r.model]) perModel[r.model] = { sumBrier: 0, total: 0 };
    perModel[r.model].total++;
    // Brier score: (predicted - actual)^2 — düşük iyi
    perModel[r.model].sumBrier += Math.pow(r.predicted - r.actual, 2);
  }

  const adjustments: Record<string, number> = {};
  let minBrier = Infinity;

  for (const [model, stats] of Object.entries(perModel)) {
    if (stats.total < 3) { adjustments[model] = 1.0; continue; }
    const avgBrier = stats.sumBrier / stats.total;
    adjustments[model] = avgBrier;
    if (avgBrier < minBrier) minBrier = avgBrier;
  }

  // Göreceli normalize: en iyi model (minBrier) 1.2x, en kötü 0.8x
  if (minBrier < Infinity) {
    for (const model of Object.keys(adjustments)) {
      const ratio = minBrier / Math.max(adjustments[model], 0.001);
      adjustments[model] = 0.8 + 0.4 * ratio;
    }
  }

  return adjustments;
}

/**
 * applyOnlineAdjustments: online adjustment'ları ensemble weight'lere uygula.
 * Çağrı: `const weights = computeEnsembleWeights(input); applyOnlineAdjustments(weights);`
 */
export function applyOnlineAdjustments(weights: EnsembleWeights): void {
  const adjustments = computeOnlineAdjustments();

  if (adjustments.inplay) weights.inplay *= adjustments.inplay;
  if (adjustments.ml) weights.ml *= adjustments.ml;
  if (adjustments.ruleBased) weights.ruleBased *= adjustments.ruleBased;
  if (adjustments.poisson) weights.poisson *= adjustments.poisson;
  if (adjustments.elo) weights.elo *= adjustments.elo;
  if (adjustments.teamStrength) weights.teamStrength *= adjustments.teamStrength;
  if (adjustments.gap) weights.gap *= adjustments.gap;
  if (adjustments.pi) weights.pi *= adjustments.pi;
  if (adjustments.glicko2) weights.glicko2 *= adjustments.glicko2;

  // Re-normalize
  const sum = weights.ruleBased + weights.poisson + weights.elo + weights.ml +
    weights.teamStrength + weights.inplay + weights.gap + weights.pi + weights.glicko2;
  if (sum > 0) {
    weights.ruleBased /= sum;
    weights.poisson /= sum;
    weights.elo /= sum;
    weights.ml /= sum;
    weights.teamStrength /= sum;
    weights.inplay /= sum;
    weights.gap /= sum;
    weights.pi /= sum;
    weights.glicko2 /= sum;
  }
}
