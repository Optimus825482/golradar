import { describe, expect, test, beforeEach } from "bun:test";
import {
  calibrateScore,
  applyCalibration,
  applyIsotonic,
  fitIsotonic,
  clearIsotonicCache,
  CALIBRATION_PARAMS,
  computeECE,
} from "../calibration";

describe("calibrateScore (sigmoid fallback)", () => {
  beforeEach(() => {
    clearIsotonicCache();
  });

  test("returns 0-1 range", () => {
    for (const s of [0, 25, 50, 75, 100]) {
      const p = calibrateScore(s);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  test("higher raw score => higher probability (monotonic)", () => {
    let prev = -1;
    for (let s = 0; s <= 100; s += 10) {
      const p = calibrateScore(s);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  test("at L=1, k→∞, x0=50, score=50 should equal ~0.5", () => {
    const orig = { L: 1, k: 100, x0: 50 };
    CALIBRATION_PARAMS.L = orig.L;
    CALIBRATION_PARAMS.k = orig.k;
    CALIBRATION_PARAMS.x0 = orig.x0;
    expect(calibrateScore(50)).toBeCloseTo(0.5, 1);
  });

  test("clamps to L ceiling", () => {
    CALIBRATION_PARAMS.L = 0.8;
    CALIBRATION_PARAMS.k = 1;
    CALIBRATION_PARAMS.x0 = 0;
    expect(calibrateScore(1000)).toBeLessThanOrEqual(0.8);
  });
});

describe("applyCalibration (0-1 input)", () => {
  test("multiplies input by 100 before calling calibrateScore", () => {
    const p1 = applyCalibration(0.5);
    const p2 = calibrateScore(50);
    expect(p1).toBeCloseTo(p2, 5);
  });

  test("clamps 0-1 input range", () => {
    const p1 = applyCalibration(2);
    const p2 = applyCalibration(1);
    expect(p1).toBe(p2);
  });
});

describe("applyIsotonic", () => {
  beforeEach(() => clearIsotonicCache());

  test("returns null when no table fitted", () => {
    expect(applyIsotonic(50)).toBeNull();
  });

  test("returns null for unfit input (< 50 samples)", () => {
    const xs = Array(20).fill(0).map((_, i) => i * 5);
    const ys = Array(20).fill(0).map((_, i) => (i > 10 ? 1 : 0));
    expect(fitIsotonic(xs, ys)).toBeNull();
  });

  test("interpolates monotonically after fit", () => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 100; i++) {
      xs.push(i);
      ys.push(i > 60 ? 1 : 0);
    }
    const table = fitIsotonic(xs, ys);
    expect(table).not.toBeNull();

    const pLow = applyIsotonic(20);
    const pMid = applyIsotonic(60);
    const pHigh = applyIsotonic(90);
    expect(pLow!).toBeLessThanOrEqual(pMid!);
    expect(pMid!).toBeLessThanOrEqual(pHigh!);
    expect(pLow!).toBeGreaterThanOrEqual(0);
    expect(pHigh!).toBeLessThanOrEqual(1);
  });
});

describe("computeECE", () => {
  test("returns 0 for empty input", () => {
    expect(computeECE([], [])).toBe(0);
  });

  test("returns 0 for perfectly calibrated (all correct with conf=1)", () => {
    const probs = [1, 1, 1, 1];
    const outcomes = [1, 1, 1, 1];
    expect(computeECE(probs, outcomes)).toBe(0);
  });

  test("returns higher ECE for miscalibrated predictions", () => {
    const wellCal = computeECE([0.1, 0.1, 0.9, 0.9], [0, 0, 1, 1]);
    const badCal = computeECE([0.9, 0.9, 0.9, 0.9], [0, 0, 1, 1]);
    expect(badCal).toBeGreaterThan(wellCal);
  });

  test("returns 0 for length mismatch", () => {
    expect(computeECE([0.5], [0, 1])).toBe(0);
  });
});
