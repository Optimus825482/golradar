import { describe, expect, test } from 'bun:test';
import { fitBatch, predictMatch, type ScoredMatch } from '../ml/teamStrengthKalman';

describe('teamStrengthKalman: xG-aware updates', () => {
  test('ScoredMatch accepts optional homeXG/awayXG fields', () => {
    const m: ScoredMatch = {
      date: '2026-01-01',
      homeTeam: 'A',
      awayTeam: 'B',
      homeGoals: 2,
      awayGoals: 1,
      homeXG: 1.8,
      awayXG: 0.9,
    };
    expect(m.homeXG).toBe(1.8);
    expect(m.awayXG).toBe(0.9);
  });

  test('xG fit produces same ratings as goals-only fit when xG equals goals', () => {
    const goalsOnly: ScoredMatch[] = [
      { date: '2026-01-01', homeTeam: 'A', awayTeam: 'B', homeGoals: 2, awayGoals: 1 },
      { date: '2026-01-08', homeTeam: 'A', awayTeam: 'C', homeGoals: 3, awayGoals: 0 },
    ];
    const xgSame: ScoredMatch[] = goalsOnly.map((m) => ({
      ...m,
      homeXG: m.homeGoals,
      awayXG: m.awayGoals,
    }));
    const modelGoals = fitBatch(goalsOnly);
    const modelXG = fitBatch(xgSame);
    const predGoals = predictMatch(modelGoals, 'A', 'B');
    const predXG = predictMatch(modelXG, 'A', 'B');
    expect(predXG.alphaHome).toBeCloseTo(predGoals.alphaHome, 4);
    expect(predXG.alphaAway).toBeCloseTo(predGoals.alphaAway, 4);
  });

  test('xG signal improves fit when shots were lucky/unlucky', () => {
    const opponents = ['B', 'C', 'D', 'E', 'F', 'G'];
    const goalsOnly: ScoredMatch[] = [
      { date: '2026-01-01', homeTeam: 'A', awayTeam: 'B', homeGoals: 1, awayGoals: 2 },
      { date: '2026-01-08', homeTeam: 'A', awayTeam: 'C', homeGoals: 2, awayGoals: 1 },
      { date: '2026-01-15', homeTeam: 'A', awayTeam: 'D', homeGoals: 1, awayGoals: 1 },
      { date: '2026-01-22', homeTeam: 'A', awayTeam: 'E', homeGoals: 2, awayGoals: 0 },
      { date: '2026-01-29', homeTeam: 'A', awayTeam: 'F', homeGoals: 1, awayGoals: 2 },
      { date: '2026-02-05', homeTeam: 'A', awayTeam: 'G', homeGoals: 2, awayGoals: 1 },
    ];
    const xgValues = [3.0, 2.8, 3.2, 3.5, 2.9, 3.1];
    const awayXgValues = [0.8, 1.0, 1.2, 0.5, 0.9, 1.1];
    const xgAware: ScoredMatch[] = goalsOnly.map((m, i) => ({
      ...m,
      homeXG: xgValues[i],
      awayXG: awayXgValues[i],
    }));
    const mGoals = fitBatch(goalsOnly);
    const mXG = fitBatch(xgAware);
    const pGoals = predictMatch(mGoals, 'A', 'H');
    const pXG = predictMatch(mXG, 'A', 'H');
    expect(pXG.alphaHome).toBeGreaterThan(pGoals.alphaHome);
  });

  test('predictMatch still works without xG (backward compat)', () => {
    const m: ScoredMatch[] = [
      { date: '2026-01-01', homeTeam: 'A', awayTeam: 'B', homeGoals: 2, awayGoals: 1 },
    ];
    const model = fitBatch(m);
    const pred = predictMatch(model, 'A', 'B');
    expect(pred.lambdaHome).toBeGreaterThan(0);
    expect(pred.lambdaAway).toBeGreaterThan(0);
  });
});
