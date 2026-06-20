import { describe, expect, test } from "bun:test";
import {
  decayStrength,
  timeDecayWeight,
  calculateExpectedGoals,
  calculateMatchProbabilities,
  getTimeBasedGoalMultiplier,
  LEAGUE_GAMMA,
} from "../dixonColes";

describe("dixonColes: decayStrength", () => {
  test("zero days ago → identity (no decay)", () => {
    expect(decayStrength(1600, 0)).toBe(1600);
  });

  test("high decay (1000 days) → reverts toward mean (1500)", () => {
    const result = decayStrength(2000, 1000, 1500);
    // w = exp(-0.00325 * 1000) ≈ 0.039
    // result = 1500 + (2000 - 1500) * 0.039 ≈ 1519.6
    expect(result).toBeGreaterThan(1500);
    expect(result).toBeLessThan(1530);
  });

  test("daysAgo <= 0 returns current unchanged", () => {
    expect(decayStrength(1800, -5)).toBe(1800);
    expect(decayStrength(1800, 0)).toBe(1800);
  });

  test("below-mean rating fades UP toward mean", () => {
    const result = decayStrength(1200, 500, 1500);
    expect(result).toBeGreaterThan(1200);
    expect(result).toBeLessThan(1500);
  });

  test("custom xi parameter applies correctly", () => {
    // Fast decay (xi=0.01)
    const fast = decayStrength(2000, 100, 1500, 0.01);
    const slow = decayStrength(2000, 100, 1500, 0.001);
    expect(fast).toBeLessThan(slow);
  });

  test("timeDecayWeight is exposed and consistent", () => {
    expect(timeDecayWeight(0)).toBeCloseTo(1, 5);
    expect(timeDecayWeight(213)).toBeCloseTo(0.5, 2); // half-life ~213d @ xi=0.00325
  });
});

describe("dixonColes: calculateExpectedGoals", () => {
  test("returns valid PoissonParams for average teams", () => {
    const params = calculateExpectedGoals(1.0, 1.0, 1.0, 1.0);
    expect(params.lambdaHome).toBeCloseTo(1.35 * 1.10, 2);
    expect(params.lambdaAway).toBeCloseTo(1.15, 2);
    expect(params.rho).toBe(-0.13);
    expect(params.gamma).toBe(1.10);
  });

  test("clamps lambda to [0.01, ∞)", () => {
    const params = calculateExpectedGoals(0, 0, 0, 0);
    expect(params.lambdaHome).toBe(0.01);
    expect(params.lambdaAway).toBe(0.01);
  });

  test("uses LEAGUE_GAMMA fallback when gamma omitted", () => {
    const params = calculateExpectedGoals(1, 1, 1, 1);
    expect(params.gamma).toBe(1.10); // LEAGUE_GAMMA[0] default
  });

  test("explicit gamma override wins", () => {
    const params = calculateExpectedGoals(1, 1, 1, 1, 1.35, 1.15, 1.5);
    expect(params.gamma).toBe(1.5);
  });
});

describe("dixonColes: LEAGUE_GAMMA lookup", () => {
  test("Premier League (id=1) → 1.12", () => {
    expect(LEAGUE_GAMMA[1]).toBe(1.12);
  });
  test("Süper Lig (id=6) → 1.18", () => {
    expect(LEAGUE_GAMMA[6]).toBe(1.18);
  });
  test("Serie A (id=4) → 1.06 (defensive)", () => {
    expect(LEAGUE_GAMMA[4]).toBe(1.06);
  });
  test("default fallback (id=0) → 1.10", () => {
    expect(LEAGUE_GAMMA[0]).toBe(1.10);
  });
});

describe("dixonColes: getTimeBasedGoalMultiplier", () => {
  test("first 15 min → 0.70 (dampened)", () => {
    expect(getTimeBasedGoalMultiplier(10)).toBe(0.70);
  });
  test("76-90+ → 1.30 (peak danger)", () => {
    expect(getTimeBasedGoalMultiplier(88)).toBe(1.30);
  });
  test("minute 30 → 0.88", () => {
    expect(getTimeBasedGoalMultiplier(30)).toBe(0.88);
  });
});

describe("dixonColes: matrix sums to 1 (homeWin+draw+awayWin)", () => {
  test("normalized 1X2 for average teams", () => {
    const params = calculateExpectedGoals(1, 1, 1, 1);
    const probs = calculateMatchProbabilities(params);
    const total = probs.homeWin + probs.draw + probs.awayWin;
    expect(total).toBeCloseTo(1.0, 5);
  });

  test("BTTS and O2.5 in valid range", () => {
    const params = calculateExpectedGoals(1.2, 1.2, 0.9, 0.9);
    const probs = calculateMatchProbabilities(params);
    expect(probs.btts.yes + probs.btts.no).toBeCloseTo(1, 3);
    expect(probs.overUnder[2.5].over + probs.overUnder[2.5].under).toBeCloseTo(1, 3);
  });
});