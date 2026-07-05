/**
 * Data Leakage Fix — Regression Tests
 *
 * REGRESSION BUG (2026-07-05): backfillPredictionLogLabels labels ALL
 * PredictionLog rows with a 15-min horizon, but exportTrainingData was
 * using goalScored directly for all horizons (5, 10, 15). This meant
 * the 5-min and 10-min models were trained on labels that were too
 * optimistic — a goal 12 minutes after the prediction was labeled 1
 * (correct for 15-min) but should be 0 for 5-min and 10-min horizons.
 *
 * FIX: Use minutesToGoal to recompute horizon-aware labels.
 */

import { describe, test, expect } from "bun:test";
import { horizonAwareLabel } from "../lib/featureEngineering";

describe("horizonAwareLabel — data leakage fix", () => {
  test("10-min goal → false for 5-min horizon (recomputed)", () => {
    const result = horizonAwareLabel(true, 10, 5);
    expect(result.label).toBe(0);
    expect(result.recomputed).toBe(true);
  });

  test("10-min goal → true for 15-min horizon (not recomputed)", () => {
    const result = horizonAwareLabel(true, 10, 15);
    expect(result.label).toBe(1);
    expect(result.recomputed).toBe(false);
  });

  test("3-min goal → true for 5-min horizon", () => {
    const result = horizonAwareLabel(true, 3, 5);
    expect(result.label).toBe(1);
    expect(result.recomputed).toBe(false);
  });

  test("5-min goal → true for 5-min horizon (boundary)", () => {
    const result = horizonAwareLabel(true, 5, 5);
    expect(result.label).toBe(1);
    expect(result.recomputed).toBe(false);
  });

  test("6-min goal → false for 5-min horizon (exclusive)", () => {
    const result = horizonAwareLabel(true, 6, 5);
    expect(result.label).toBe(0);
    expect(result.recomputed).toBe(true);
  });

  test("no goal stays false for any horizon", () => {
    const r5 = horizonAwareLabel(false, null, 5);
    const r10 = horizonAwareLabel(false, null, 10);
    const r15 = horizonAwareLabel(false, null, 15);
    expect(r5.label).toBe(0);
    expect(r10.label).toBe(0);
    expect(r15.label).toBe(0);
  });

  test("null goalScored → safe default 0", () => {
    const result = horizonAwareLabel(null, null, 5);
    expect(result.label).toBe(0);
    expect(result.recomputed).toBe(false);
  });

  test("true goalScored + null minutesToGoal → keeps 1", () => {
    const result = horizonAwareLabel(true, null, 5);
    expect(result.label).toBe(1);
  });

  test("8-min → true for 10-min, false for 5-min", () => {
    expect(horizonAwareLabel(true, 8, 10).label).toBe(1);
    expect(horizonAwareLabel(true, 8, 5).label).toBe(0);
  });
});
