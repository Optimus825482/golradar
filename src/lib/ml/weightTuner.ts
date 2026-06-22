// ── Dynamic Ensemble Weight Tuner ──────────────────────────────────
// Adjusts ensemble model weights based on per-model Brier tier and
// match context (minute, pressure history). Replaces the static
// base-weights in ensemble.ts calculateDynamicWeights with a
// tier-driven scheme: better-calibrated models (low Brier) get more
// weight, poorly-calibrated ones (Brier ≥ 0.50) are zeroed out.
//
// Tier mapping (matches modelWeightRouter.tierForBrier):
//   brier < 0.18         → tier "excellent" → contributes heavily
//   0.18 ≤ brier < 0.25   → tier "good"
//   0.25 ≤ brier < 0.32   → tier "fair"
//   0.32 ≤ brier < 0.40   → tier "poor"
//   0.40 ≤ brier < 0.50   → tier "disabled" (weight 0)
//   brier ≥ 0.50          → weight 0
//   brier == null         → fallback weight 0.20 (unranked)

export interface WeightTunerInput {
  inplayBrier?: number | null;
  ruleBrier?: number | null;
  poissonBrier?: number | null;
  eloBrier?: number | null;
  mlBrier?: number | null;
  teamStrengthBrier?: number | null;
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
}

interface ModelSlot {
  name: keyof EnsembleWeights;
  brier: number | null | undefined;
  baseWeight: number; // tier-derived base weight
  earlyBonus: number;  // extra weight when minute <= 20
  lateBonus: number;   // extra weight when minute >= 60
  pressureBonus: number; // extra weight when hasPressureHistory
}

const TIER_BRIER_CAPS: Array<{ cap: number; weight: number }> = [
  { cap: 0.18, weight: 1.0 },
  { cap: 0.25, weight: 0.75 },
  { cap: 0.32, weight: 0.5 },
  { cap: 0.40, weight: 0.25 },
  { cap: 0.50, weight: 0.0 },
];

function tierWeight(brier: number | null | undefined): number {
  if (brier == null) return 0.2;
  for (const tier of TIER_BRIER_CAPS) {
    if (brier < tier.cap) return tier.weight;
  }
  return 0;
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
  ];

  // Cap each slot's tier weight before applying bonuses, so bonuses
  // redistribute residual budget rather than inflate one model past
  // its tier ceiling. In-play gets a separate ramp gate (minute 20
  // → 30 → cap at 0.30) since early-match in-play data is too noisy.
  const TIER_CAPS: Record<keyof EnsembleWeights, number> = {
    inplay: 0.30,
    ml: 0.30,
    ruleBased: 0.35,
    poisson: 0.30,
    elo: 0.20,
    teamStrength: 0.15,
  };

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

  const raw: EnsembleWeights = {
    ruleBased: slots.find((s) => s.name === 'ruleBased')!.baseWeight,
    poisson: slots.find((s) => s.name === 'poisson')!.baseWeight,
    elo: slots.find((s) => s.name === 'elo')!.baseWeight,
    ml: slots.find((s) => s.name === 'ml')!.baseWeight,
    teamStrength: slots.find((s) => s.name === 'teamStrength')!.baseWeight,
    inplay: inplaySlot.baseWeight,
  };

  // Normalize to sum = 1.0
  const sum =
    raw.ruleBased + raw.poisson + raw.elo + raw.ml + raw.teamStrength + raw.inplay;
  if (sum <= 0) {
    return { ruleBased: 0.5, poisson: 0.2, elo: 0.1, ml: 0.1, teamStrength: 0.1, inplay: 0 };
  }
  return {
    ruleBased: raw.ruleBased / sum,
    poisson: raw.poisson / sum,
    elo: raw.elo / sum,
    ml: raw.ml / sum,
    teamStrength: raw.teamStrength / sum,
    inplay: raw.inplay / sum,
  };
}
