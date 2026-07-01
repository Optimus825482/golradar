import { describe, expect, test } from "bun:test";
import {
  CALIBRATION_PARAMS,
  calibrateScore,
  applyCalibration,
  computeECE,
  fitIsotonic,
  applyIsotonic,
  clearIsotonicCache,
} from "../calibration";

describe("calibration: CALIBRATION_PARAMS", () => {
  test("L ceiling is 0.90 (config default)", () => {
    expect(CALIBRATION_PARAMS.L).toBe(0.90);
  });
  test("k steepness positive", () => {
    expect(CALIBRATION_PARAMS.k).toBeGreaterThan(0);
  });
  test("x0 midpoint reasonable", () => {
    expect(CALIBRATION_PARAMS.x0).toBeGreaterThanOrEqual(30);
    expect(CALIBRATION_PARAMS.x0).toBeLessThan(80);
  });
});

// Helper: ensure calibrateScore uses pure sigmoid, not isotonic table.
// isotonic.json is persisted by the fitIsotonic tests (later describe
// block) and would otherwise make calibrateScore return the PAVA-mapped
// value instead of the raw sigmoid.
function isolateSigmoid() {
  clearIsotonicCache();
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const f = path.join(process.cwd(), "data", "calibration", "isotonic.json");
  try { fs.unlinkSync(f); } catch { /* already absent */ }
}

describe("calibration: calibrateScore (sigmoid)", () => {
  test("returns 0-1 range for any input", () => {
    isolateSigmoid();
    for (let s = 0; s <= 100; s += 10) {
      const p = calibrateScore(s);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  test("score 0 → very low probability", () => {
    isolateSigmoid();
    const p = calibrateScore(0);
    expect(p).toBeLessThan(0.1);
  });

  test("score 100 → high probability (near L=0.95)", () => {
    isolateSigmoid();
    const p = calibrateScore(100);
    expect(p).toBeGreaterThan(0.8);
  });

  test("score at midpoint x0 ≈ L/2", () => {
    isolateSigmoid();
    const p = calibrateScore(CALIBRATION_PARAMS.x0);
    expect(p).toBeCloseTo(CALIBRATION_PARAMS.L / 2, 2);
  });

  test("monotonically increasing", () => {
    isolateSigmoid();
    let prev = -1;
    for (let s = 0; s <= 100; s += 5) {
      const p = calibrateScore(s);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe("calibration: applyCalibration (unified entry)", () => {
  test("input 0-1 mapped to 0-100 then calibrated", () => {
    isolateSigmoid();
    const p = applyCalibration(0.5);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  test("input clamped to [0,1]", () => {
    isolateSigmoid();
    const high = applyCalibration(2.0);
    const low = applyCalibration(-1.0);
    const valid = applyCalibration(0.5);
    expect(high).toBe(calibrateScore(100));
    expect(low).toBe(calibrateScore(0));
    expect(valid).toBe(calibrateScore(50));
  });
});

describe("calibration: computeECE", () => {
  test("perfect calibration → ECE ≈ 0 (large N per bin)", () => {
    // 100 predictions per bin: each bin has 10 samples with p=0.1, all outcomes=0.
    // Bin [0.1, 0.2): conf=0.1, acc=0, |diff|=0.1, weighted=10/100*0.1=0.01
    // Summed across 10 bins each with same contribution → ECE ≈ 0.1 in 10-bin setup
    // Better: use 1000 predictions with 100 per bin to converge to ECE=0
    const probs: number[] = [];
    const outs: number[] = [];
    for (let bin = 0; bin < 10; bin++) {
      const p = (bin + 0.5) / 10;
      for (let i = 0; i < 100; i++) {
        probs.push(p);
        // outcome matches confidence perfectly
        outs.push(Math.random() < p ? 1 : 0);
      }
    }
    const ece = computeECE(probs, outs, 10);
    // With perfect calibration (matching confidence) ECE is near zero.
    // MC variance: ~0.01-0.06 at N=1000 depending on RNG.
    expect(ece).toBeLessThan(0.08);
  });

  test("perfect miscalibration → ECE high", () => {
    // All predictions = 0.9, all outcomes = 0 → bad calibration
    const probs = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9];
    const outs = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const ece = computeECE(probs, outs, 10);
    expect(ece).toBeGreaterThan(0.5);
  });

  test("empty inputs → 0 ECE", () => {
    expect(computeECE([], [])).toBe(0);
  });

  test("mismatched array lengths → 0 (defensive)", () => {
    expect(computeECE([0.5, 0.6], [1])).toBe(0);
  });

  test("ECE in [0,1]", () => {
    const probs = Array.from({ length: 100 }, () => Math.random());
    const outs = probs.map(p => (Math.random() < p ? 1 : 0));
    const ece = computeECE(probs, outs, 10);
    expect(ece).toBeGreaterThanOrEqual(0);
    expect(ece).toBeLessThanOrEqual(1);
  });
});

describe("calibration: fitIsotonic (PAVA)", () => {
  test("returns null for insufficient samples", () => {
    expect(fitIsotonic([1, 2, 3], [0, 1, 0])).toBeNull();
  });

  test("returns null for empty arrays", () => {
    expect(fitIsotonic([], [])).toBeNull();
  });

  test("mismatched arrays returns null", () => {
    expect(fitIsotonic([1, 2, 3, 4], [0, 1])).toBeNull();
  });

  test("fitted table is monotonic non-decreasing", () => {
    clearIsotonicCache();
    const rawScores = Array.from({ length: 100 }, (_, i) => i);
    const actuals = rawScores.map(s => (s > 50 ? 1 : 0));
    const table = fitIsotonic(rawScores, actuals);
    expect(table).not.toBeNull();
    if (table) {
      for (let i = 1; i < table.y.length; i++) {
        expect(table.y[i]).toBeGreaterThanOrEqual(table.y[i - 1]);
      }
      expect(table.x.length).toEqual(table.y.length);
      expect(table.fittedN).toBe(100);
    }
  });
});

describe("calibration: applyIsotonic lookup", () => {
  test("returns null when no table fitted", () => {
    // clearIsotonicCache() only nulls in-memory; loadIsotonic() re-reads
    // the persisted file. We must also delete the file to force null state.
    clearIsotonicCache();
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const f = path.join(process.cwd(), "data", "calibration", "isotonic.json");
    try { fs.unlinkSync(f); } catch { /* already absent */ }
    expect(applyIsotonic(50)).toBeNull();
  });

  test("interpolation monotonic after fit", () => {
    clearIsotonicCache();
    const rawScores = Array.from({ length: 100 }, (_, i) => i);
    const actuals = rawScores.map(s => (s > 50 ? 1 : 0));
    fitIsotonic(rawScores, actuals);

    let prev = -1;
    for (let s = 0; s <= 100; s += 5) {
      const p = applyIsotonic(s);
      expect(p).not.toBeNull();
      if (p != null) {
        expect(p).toBeGreaterThanOrEqual(prev);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        prev = p;
      }
    }
    clearIsotonicCache();
  });
});