import { describe, expect, test } from 'bun:test';
import { computeEnsembleWeights, type WeightTunerInput } from '../ml/weightTuner';

describe('weightTuner: computeEnsembleWeights', () => {
  test('baseline (default) returns valid weights summing to 1.0', () => {
    const w = computeEnsembleWeights({});
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 4);
    for (const v of Object.values(w)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  test('excellent Brier (InPlay 0.0859) → inplay contributes meaningfully', () => {
    const w = computeEnsembleWeights({
      inplayBrier: 0.0859,
      mlBrier: null,
      ruleBrier: null,
      poissonBrier: null,
      eloBrier: null,
      teamStrengthBrier: null,
    });
    expect(w.inplay).toBeGreaterThan(0);
    expect(w.inplay).toBeLessThanOrEqual(0.30);
  });

  test('fair Brier (TeamStrength 0.2564) → teamStrength gets meaningful share', () => {
    const w = computeEnsembleWeights({
      teamStrengthBrier: 0.2564,
    });
    expect(w.teamStrength).toBeGreaterThan(0);
    expect(w.teamStrength).toBeLessThanOrEqual(0.30);
  });

  test('disabled Brier (0.50) → ml weight reduced vs default', () => {
    const wDefault = computeEnsembleWeights({});
    const wDisabled = computeEnsembleWeights({ mlBrier: 0.50 });
    expect(wDisabled.ml).toBe(0);
    expect(wDisabled.ml).toBeLessThan(wDefault.ml);
  });

  test('disabled Brier (0.45) → ml weight drops below default', () => {
    const wDefault = computeEnsembleWeights({});
    const wDisabled = computeEnsembleWeights({ mlBrier: 0.45 });
    expect(wDisabled.ml).toBeLessThan(wDefault.ml);
  });

  test('early minute (5) boosts elo and poisson', () => {
    const wEarly = computeEnsembleWeights({ minute: 5 });
    const wLate = computeEnsembleWeights({ minute: 75 });
    expect(wEarly.elo).toBeGreaterThan(wLate.elo);
    expect(wEarly.poisson).toBeGreaterThan(wLate.poisson);
  });

  test('late minute (75) boosts ruleBased', () => {
    const wEarly = computeEnsembleWeights({ minute: 5 });
    const wLate = computeEnsembleWeights({ minute: 75 });
    expect(wLate.ruleBased).toBeGreaterThan(wEarly.ruleBased);
  });

  test('inplay weight gate: minute <= 20 → inplay = 0', () => {
    const w = computeEnsembleWeights({ minute: 15 });
    expect(w.inplay).toBe(0);
  });

  test('inplay weight gate: minute > 20 → inplay ramps up', () => {
    const w = computeEnsembleWeights({ minute: 25 });
    expect(w.inplay).toBeGreaterThan(0);
    expect(w.inplay).toBeLessThanOrEqual(0.30);
  });

  test('pressure history boosts ruleBased and ml', () => {
    const wWith = computeEnsembleWeights({ hasPressureHistory: true });
    const wWithout = computeEnsembleWeights({ hasPressureHistory: false });
    expect(wWith.ruleBased).toBeGreaterThanOrEqual(wWithout.ruleBased);
    expect(wWith.ml).toBeGreaterThanOrEqual(wWithout.ml);
  });

  test('all weights always sum to 1.0 regardless of inputs', () => {
    const inputs: WeightTunerInput[] = [
      {},
      { minute: 5 },
      { minute: 75 },
      { inplayBrier: 0.0859, mlBrier: 0.1691, teamStrengthBrier: 0.2564 },
      { mlBrier: 0.55, poissonBrier: 0.45 },
      { hasPressureHistory: true, minute: 30 },
    ];
    for (const input of inputs) {
      const w = computeEnsembleWeights(input);
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 4);
    }
  });
});
