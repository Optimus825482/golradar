// ── Referee Stats Module — Unit Tests ─────────────────────────────
// Pure-function tests. The DB-touching code paths are exercised
// by integration tests in src/__tests__/.

import { describe, test, expect } from 'bun:test';
import { refereeStatsToFeatures, type RefereeStatsData } from '../refereeStats';

describe('refereeStatsToFeatures', () => {
  test('null stats → neutral defaults', () => {
    const f = refereeStatsToFeatures(null);
    expect(f.ref_card_rate).toBe(0.5);
    expect(f.ref_penalty_rate).toBe(0.1);
    expect(f.ref_foul_rate).toBe(0.5);
  });

  test('low cardRate maps to low ref_card_rate', () => {
    const f = refereeStatsToFeatures({
      refereeName: 'X',
      matchesCount: 100,
      avgYellowCards: 0.02,
      avgRedCards: 0,
      avgFouls: 20,
      avgPenalties: 0.001,
      penaltyRate: 0.001,
      cardRate: 0.02,
    });
    expect(f.ref_card_rate).toBeLessThan(0.1);
  });

  test('high cardRate saturates at 1.0', () => {
    const f = refereeStatsToFeatures({
      refereeName: 'X',
      matchesCount: 100,
      avgYellowCards: 8,
      avgRedCards: 2,
      avgFouls: 30,
      avgPenalties: 0.6,
      penaltyRate: 0.6,
      cardRate: 10,
    });
    expect(f.ref_card_rate).toBe(1);
  });

  test('penaltyRate normalization boundary', () => {
    // 0.5 / 0.5 = 1.0 (saturate)
    const f = refereeStatsToFeatures({
      refereeName: 'X',
      matchesCount: 100,
      avgYellowCards: 3,
      avgRedCards: 0.1,
      avgFouls: 25,
      avgPenalties: 0.5,
      penaltyRate: 0.5,
      cardRate: 3.1,
    });
    expect(f.ref_penalty_rate).toBe(1);
  });

  test('foul rate normalization maps 15-35 to 0-1', () => {
    const mkStats = (fouls: number): RefereeStatsData => ({
      refereeName: 'X',
      matchesCount: 50,
      avgYellowCards: 2,
      avgRedCards: 0,
      avgFouls: fouls,
      avgPenalties: 0.1,
      penaltyRate: 0.1,
      cardRate: 2,
    });
    expect(refereeStatsToFeatures(mkStats(15)).ref_foul_rate).toBe(0);
    expect(refereeStatsToFeatures(mkStats(25)).ref_foul_rate).toBe(0.5);
    expect(refereeStatsToFeatures(mkStats(35)).ref_foul_rate).toBe(1);
    // Clamping
    expect(refereeStatsToFeatures(mkStats(5)).ref_foul_rate).toBe(0);
    expect(refereeStatsToFeatures(mkStats(50)).ref_foul_rate).toBe(1);
  });
});

describe('refereeStats TTL cache helpers', () => {
  test('_resetRefereeCacheForTests is exported and callable', async () => {
    const mod = await import('../refereeStats');
    expect(typeof mod._resetRefereeCacheForTests).toBe('function');
    // Should not throw
    mod._resetRefereeCacheForTests();
  });
});

describe('refereeStatsToFeatures (Sofascore partial data)', () => {
  test('Sofascore has cardRate only — penalty/foul fall back to neutral', () => {
    // Sofascore: yellowCards + redCards only, no penalty or fouls
    const sofascoreStats: RefereeStatsData = {
      refereeName: 'Cuneyt Cakir',
      matchesCount: 389,
      avgYellowCards: 4.098,
      avgRedCards: 0.113,
      avgFouls: 0,    // Sofascore doesn't expose this
      avgPenalties: 0, // Sofascore doesn't expose this
      penaltyRate: 0,
      cardRate: 4.098,
    };
    const f = refereeStatsToFeatures(sofascoreStats);
    // cardRate: real data (4.098 sarı/maç → normalize 0-8 → ~0.51)
    expect(f.ref_card_rate).toBeGreaterThan(0.4);
    expect(f.ref_card_rate).toBeLessThan(0.6);
    // penalty/foul: NEUTRAL (0.1 / 0.5) because Sofascore = 0
    expect(f.ref_penalty_rate).toBe(0.1);
    expect(f.ref_foul_rate).toBe(0.5);
  });

  test('full stats from Transfermarkt/Sahadan path — all features real', () => {
    const fullStats: RefereeStatsData = {
      refereeName: 'Full Data Ref',
      matchesCount: 100,
      avgYellowCards: 5.0,
      avgRedCards: 0.1,
      avgFouls: 25,
      avgPenalties: 0.3,
      penaltyRate: 0.3,
      cardRate: 5.0,
    };
    const f = refereeStatsToFeatures(fullStats);
    expect(f.ref_card_rate).toBeGreaterThan(0);
    expect(f.ref_penalty_rate).toBeGreaterThan(0); // not neutral
    expect(f.ref_foul_rate).toBeGreaterThan(0);    // not neutral
  });
});
