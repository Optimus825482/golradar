/**
 * N-of-M Gate Fix — Regression Tests
 *
 * REGRESSION BUG (2026-07-05): checkAndRecordSignal's N-of-M tier
 * system requires modelAgreement >= 5/3/2 for elite/confirmed/watch
 * tiers, but the default modelAgreement=1 means these tiers NEVER
 * trigger. Only the 'radar' tier (score >= dynamicThreshold) works,
 * and dynamicThreshold is typically 55+. So signals with score 50-54
 * are silently dropped even though the user sees them in the UI.
 *
 * FIX: When modelAgreement is the default (1), use score-only tiers.
 * When modelAgreement is explicitly computed (>= 2), use N-of-M.
 */

import { describe, test, expect } from "bun:test";

// ── Extracted tier resolution for testability ──────────────────────

export function resolveSignalTier(
  score: number,
  modelAgreement: number,
  dynamicThreshold: number,
): { tier: "elite" | "confirmed" | "watch" | "radar" | null; reason: string } {
  const TIER_ELITE_THRESHOLD = 50;
  const TIER_CONFIRMED_THRESHOLD = 55;
  const TIER_WATCH_THRESHOLD = 60;

  // When ensemble is available (modelAgreement >= 2), use N-of-M
  const useNofM = modelAgreement >= 2;

  if (useNofM) {
    // N-of-M mode: requires both score AND model agreement
    if (score >= TIER_ELITE_THRESHOLD && modelAgreement >= 5) {
      return { tier: "elite", reason: `N-of-M: score≥${TIER_ELITE_THRESHOLD} + ${modelAgreement}≥5 models` };
    }
    if (score >= TIER_CONFIRMED_THRESHOLD && modelAgreement >= 3) {
      return { tier: "confirmed", reason: `N-of-M: score≥${TIER_CONFIRMED_THRESHOLD} + ${modelAgreement}≥3 models` };
    }
    if (score >= TIER_WATCH_THRESHOLD && modelAgreement >= 2) {
      return { tier: "watch", reason: `N-of-M: score≥${TIER_WATCH_THRESHOLD} + ${modelAgreement}≥2 models` };
    }
    if (score >= dynamicThreshold) {
      return { tier: "radar", reason: `N-of-M fallback: score≥${dynamicThreshold}` };
    }
    return { tier: null, reason: `N-of-M drop: score=${score} < dynamicThreshold=${dynamicThreshold} or no tier matched` };
  }

  // Score-only mode (modelAgreement unknown = default 1)
  // ponytail: use the TIER thresholds directly. Upgrade: per-league calibration.
  if (score >= TIER_WATCH_THRESHOLD) {
    return { tier: "watch", reason: `score-only: score=${score} ≥ ${TIER_WATCH_THRESHOLD}` };
  }
  if (score >= TIER_CONFIRMED_THRESHOLD) {
    return { tier: "confirmed", reason: `score-only: score=${score} ≥ ${TIER_CONFIRMED_THRESHOLD}` };
  }
  if (score >= TIER_ELITE_THRESHOLD) {
    return { tier: "elite", reason: `score-only: score=${score} ≥ ${TIER_ELITE_THRESHOLD}` };
  }
  // ponytail: dynamicThreshold guard for "unknown ensemble" path
  // — when we don't know model agreement, we still need some floor.
  if (score >= dynamicThreshold) {
    return { tier: "radar", reason: `score-only: score=${score} ≥ dynamicThreshold=${dynamicThreshold}` };
  }
  return { tier: null, reason: `drop: score=${score} < dynamicThreshold=${dynamicThreshold}` };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("resolveSignalTier — N-of-M gate fix", () => {
  // ── Score-only mode (modelAgreement=1, default path) ──
  test("score=52, modelAgreement=1 (default) → elite (score≥50)", () => {
    const r = resolveSignalTier(52, 1, 55);
    expect(r.tier).toBe("elite");
    expect(r.reason).toContain("score-only");
  });

  test("score=48, modelAgreement=1, threshold=55 → null (below all)", () => {
    const r = resolveSignalTier(48, 1, 55);
    expect(r.tier).toBeNull();
  });

  test("score=65, modelAgreement=1 → watch (score≥60)", () => {
    const r = resolveSignalTier(65, 1, 55);
    expect(r.tier).toBe("watch");
  });

  test("score=55, modelAgreement=1 → confirmed (score≥55)", () => {
    const r = resolveSignalTier(55, 1, 55);
    expect(r.tier).toBe("confirmed");
  });

  test("score=54, modelAgreement=1, threshold=53 → elite (54≥50 elite)", () => {
    const r = resolveSignalTier(54, 1, 53);
    expect(r.tier).toBe("elite"); // 54≥50 → score-only elite tier
  });

  // ── N-of-M mode (explicit ensemble) ──
  test("score=52, modelAgreement=6 → elite (N-of-M: 52≥50 + 6≥5)", () => {
    const r = resolveSignalTier(52, 6, 55);
    expect(r.tier).toBe("elite");
    expect(r.reason).toContain("N-of-M");
  });

  test("score=52, modelAgreement=2 → NOT elite (2 < 5 models)", () => {
    const r = resolveSignalTier(52, 2, 55);
    // In N-of-M mode: 2 models is not enough for elite (needs 5)
    // confirmed: 52 < 55 → no
    // watch: 52 < 60 → no
    // radar: 52 < 55 → drop
    expect(r.tier).toBeNull();
  });

  test("score=56, modelAgreement=3 → confirmed (N-of-M: 56≥55 + 3≥3)", () => {
    const r = resolveSignalTier(56, 3, 55);
    expect(r.tier).toBe("confirmed");
    expect(r.reason).toContain("N-of-M");
  });

  test("score=62, modelAgreement=4 → confirmed (N-of-M: 62≥55 + 4≥3)", () => {
    const r = resolveSignalTier(62, 4, 55);
    expect(r.tier).toBe("confirmed"); // 62≥55 + 4≥3 → confirmed (not watch, confirmed is higher tier)
    expect(r.reason).toContain("N-of-M");
  });

  // ── Dynamic threshold edge cases ──
  test("score=50, modelAgreement=1, threshold=50 → elite (boundary)", () => {
    const r = resolveSignalTier(50, 1, 50);
    expect(r.tier).toBe("elite");
  });

  test("score=50, modelAgreement=2, threshold=50 → radar (2<5 elite, but 50=50 radar)", () => {
    // N-of-M: elite needs 5, confirmed needs 55, watch needs 60
    // radar: score=50 >= threshold=50 → radar tier (not null, radar is the floor)
    const r = resolveSignalTier(50, 2, 50);
    expect(r.tier).toBe("radar");
  });

  test("score=50, modelAgreement=5, threshold=55 → N-of-M elite (50≥50 + 5≥5)", () => {
    const r = resolveSignalTier(50, 5, 55);
    expect(r.tier).toBe("elite");
    expect(r.reason).toContain("N-of-M");
  });

  test("dynamicThreshold=40 (Bundesliga) → score=45, ma=1 → radar", () => {
    const r = resolveSignalTier(45, 1, 40);
    expect(r.tier).toBe("radar");
  });
});
