import { describe, expect, test } from 'bun:test';
import { computeEnsembleWeights, type WeightTunerInput } from '../ml/weightTuner';

describe('ensemble integration: Brier tier-based weights feed ensemble', () => {
  test('inplay Brier 0.0859 (excellent) gets >= 0.12 share (9-model ensemble)', () => {
    // Real production data: inplay champion Brier = 0.0859
    // With 9-model ensemble normalization, excellent inplay Brier
    // gets proportional share above default 0.20 tier.
    const w = computeEnsembleWeights({
      inplayBrier: 0.0859,
      mlBrier: 0.1691,
    });
    expect(w.inplay).toBeGreaterThanOrEqual(0.12);
  });

  test('teamStrength Brier 0.2564 (fair) gets reduced share vs default', () => {
    // team-strength champion currently fair tier. With tier-based
    // weights, should be <= 0.15 (current 0.10 default was a heuristic).
    const w = computeEnsembleWeights({
      teamStrengthBrier: 0.2564,
    });
    expect(w.teamStrength).toBeLessThanOrEqual(0.15);
  });

  test('disabled Brier (0.55) zeros the model out of ensemble', () => {
    // A model with terrible Brier (>= 0.50) should not contribute
    // to the ensemble even if it produces a non-zero prediction.
    const w = computeEnsembleWeights({ mlBrier: 0.55 });
    expect(w.ml).toBe(0);
  });

  test('all 9 weights sum to 1.0 across realistic Brier matrix', () => {
    // Production-realistic inputs: all champions ranked.
    const w = computeEnsembleWeights({
      inplayBrier: 0.0859,
      mlBrier: 0.1691,
      teamStrengthBrier: 0.2564,
    });
    const sum = w.ruleBased + w.poisson + w.elo + w.ml + w.teamStrength + w.inplay + w.gap + w.pi + w.glicko2;
    expect(sum).toBeCloseTo(1.0, 4);
  });

  test('ensemble weights respect inplay gate (minute <= 20 → inplay = 0)', () => {
    const w = computeEnsembleWeights({
      minute: 15,
      inplayBrier: 0.0859,
    });
    expect(w.inplay).toBe(0);
  });
});
