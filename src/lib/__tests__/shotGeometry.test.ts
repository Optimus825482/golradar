// ── Shot Geometry Module — Unit Tests ─────────────────────────────
// Reference: Singh 2025 freeze-frame features.

import { describe, test, expect } from 'bun:test';
import {
  computeShotGeometry,
  aggregateShotGeometry,
} from '../shotGeometry';

describe('computeShotGeometry', () => {
  test('penalty-area central shot → high xG, inBox, central', () => {
    // x=95 → 1.5m from goal line; y=50 → center; xG typical ~0.55
    const g = computeShotGeometry(95, 50, 0.55);
    expect(g.inBox).toBe(true);
    expect(g.isCentral).toBe(true);
    expect(g.angle).toBeGreaterThan(0.4); // ~0.4 rad from ~30° cone
    expect(g.distance).toBeLessThan(15); // very close
    expect(g.gkDistanceProxy).toBeCloseTo(1.0, 1); // 0.55/0.5 clamped
  });

  test('far edge shot → low xG, not central, not in box', () => {
    // x=60 → ~44m; y=10 → near sideline; xG ~0.05
    const g = computeShotGeometry(60, 10, 0.05);
    expect(g.inBox).toBe(false);
    expect(g.isCentral).toBe(false);
    expect(g.angle).toBeLessThan(0.2);
    expect(g.distance).toBeGreaterThan(40);
    expect(g.gkDistanceProxy).toBeCloseTo(0.1, 1);
    expect(g.defendersInConeProxy).toBe(0); // below 0.05
  });

  test('mid-range ~20m central → moderate xG, in box (x=83 boundary)', () => {
    // x=84 (>83 = penalty box), y=50 (center), xG ~0.20
    const g = computeShotGeometry(84, 50, 0.20);
    expect(g.inBox).toBe(true);
    expect(g.isCentral).toBe(true);
    expect(g.gkDistanceProxy).toBeCloseTo(0.4, 1);
  });

  test('angle is capped at π/2', () => {
    // At x=100 the shot is on the goal line; angle should be ~π (impossible)
    // We cap to π/2.
    const g = computeShotGeometry(100, 50, 0.5);
    expect(g.angle).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
  });

  test('distance is non-negative', () => {
    const g = computeShotGeometry(0, 0, 0.5);
    expect(g.distance).toBeGreaterThanOrEqual(0);
  });

  test('gk proxy clamps at 1 for very high xG', () => {
    expect(computeShotGeometry(90, 50, 1.0).gkDistanceProxy).toBe(1.0);
    expect(computeShotGeometry(90, 50, 2.0).gkDistanceProxy).toBe(1.0);
  });

  test('defendersInConeProxy below 0.05 xG → 0', () => {
    expect(computeShotGeometry(50, 50, 0.0).defendersInConeProxy).toBe(0);
    expect(computeShotGeometry(50, 50, 0.04).defendersInConeProxy).toBe(0);
  });
});

describe('aggregateShotGeometry', () => {
  test('empty shot array returns neutral defaults', () => {
    const agg = aggregateShotGeometry([]);
    expect(agg.shotCount).toBe(0);
    expect(agg.avgAngle).toBe(0.3);
    expect(agg.centralShotRatio).toBe(0.5);
  });

  test('single shot → ratios = 0 or 1', () => {
    const agg = aggregateShotGeometry([{ x: 95, y: 50, expectedGoals: 0.5 }]);
    expect(agg.shotCount).toBe(1);
    expect(agg.centralShotRatio).toBe(1);
    expect(agg.inBoxRatio).toBe(1);
  });

  test('two shots — one central one not', () => {
    const agg = aggregateShotGeometry([
      { x: 90, y: 50, expectedGoals: 0.4 },  // central, in box
      { x: 70, y: 10, expectedGoals: 0.1 },  // not central, not in box
    ]);
    expect(agg.shotCount).toBe(2);
    expect(agg.centralShotRatio).toBe(0.5);
    expect(agg.inBoxRatio).toBe(0.5);
  });

  test('shot count is preserved', () => {
    const shots = Array.from({ length: 7 }, (_, i) => ({
      x: 80 + i,
      y: 50,
      expectedGoals: 0.2,
    }));
    const agg = aggregateShotGeometry(shots);
    expect(agg.shotCount).toBe(7);
  });

  test('averages are between min and max component values', () => {
    const shots = [
      { x: 60, y: 50, expectedGoals: 0.05 },
      { x: 95, y: 50, expectedGoals: 0.6 },
    ];
    const agg = aggregateShotGeometry(shots);
    expect(agg.avgGkDistanceProxy).toBeGreaterThan(0.1);
    expect(agg.avgGkDistanceProxy).toBeLessThan(1.0);
  });
});
