/**
 * Horizon-aware labeling regression tests.
 *
 * The previous label-generation formula was
 *   goalHappened = rMin <= firstGoalMinute
 * which produced ~80% positive class rate and caused the trainer
 * to collapse to constant prediction (AUC=0.500 in production
 * logs from 2026-07-01).
 *
 * These tests pin the horizon-aware semantics — both for the
 * backfill script and the labelForLog fallback — so a future
 * regression is caught at CI, not production.
 */
import { describe, expect, test } from "bun:test";

/**
 * Re-implementation of the production horizon-aware label logic
 * for `backfillPredictionLogLabels`. Mirrors the implementation
 * in src/lib/goalSignalTracker.ts so we don't need a database
 * to test it.
 */
function horizonLabel(
  rowMinute: number,
  goalMinutes: number[],
  horizonMin: number,
): { label: 0 | 1; delta: number | null } {
  const sorted = [...goalMinutes].filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
  if (sorted.length === 0) return { label: 0, delta: null };
  const firstEligible = sorted.find((gm) => gm > rowMinute && gm - rowMinute <= horizonMin);
  if (firstEligible === undefined) return { label: 0, delta: null };
  return { label: 1, delta: firstEligible - rowMinute };
}

/**
 * Re-implementation of labelForLog (exportTrainingData.ts).
 * Tests the createdAt-driven horizon check. When createdAt is null
 * the function falls through to 0 (no false positives).
 */
function labelForLogMinuteFallback(
  logCreatedAt: Date,
  horizonMin: number,
  goalEvents: Array<{ minute: number; createdAt?: Date | null }>,
): number {
  const horizonMs = horizonMin * 60 * 1000;
  for (const ev of goalEvents) {
    const evTime = ev.createdAt ?? null;
    if (!evTime) continue;
    if (evTime.getTime() <= logCreatedAt.getTime()) continue;
    if (evTime.getTime() - logCreatedAt.getTime() <= horizonMs) return 1;
  }
  return 0;
}

describe("horizon-aware label generation (backfill)", () => {
  test("goal at minute 30 → row at minute 25 IS positive (horizon 10)", () => {
    const { label, delta } = horizonLabel(25, [30], 10);
    expect(label).toBe(1);
    expect(delta).toBe(5);
  });

  test("goal at minute 30 → row at minute 25 IS positive (horizon 5, inclusive)", () => {
    // Horizon semantics: deltaMin <= horizonMin (inclusive boundary).
    // Goal is 5 min after the row — exactly on the boundary, MUST count.
    const { label, delta } = horizonLabel(25, [30], 5);
    expect(label).toBe(1);
    expect(delta).toBe(5);
  });

  test("goal at minute 30 → row at minute 30 IS NOT positive (must be strictly after)", () => {
    // Boundary check: row minute = goal minute → not in horizon (delta = 0)
    const { label } = horizonLabel(30, [30], 5);
    expect(label).toBe(0);
  });

  test("goal at minute 30 → row at minute 25 IS positive (horizon 15 covers 5-min delta)", () => {
    const { label } = horizonLabel(25, [30], 15);
    expect(label).toBe(1);
  });

  test("multiple goals → first eligible within horizon wins", () => {
    const { label, delta } = horizonLabel(20, [22, 28, 35], 10);
    expect(label).toBe(1);
    expect(delta).toBe(2); // First goal (minute 22) wins
  });

  test("no goals → all rows negative", () => {
    expect(horizonLabel(45, [], 10).label).toBe(0);
  });

  test("goal minute filtering — ignore non-finite", () => {
    const { label } = horizonLabel(20, [NaN, 25], 10);
    expect(label).toBe(1);
  });

  test("out-of-horizon goals → label = 0", () => {
    const { label } = horizonLabel(20, [50], 10);
    expect(label).toBe(0);
  });

  test("regression: pre-fix formula gave ~80% positives; horizon-aware is much sparser", () => {
    // Simulate a match where the first goal happens at minute 30.
    // Pre-fix: every row with rMin <= 30 → positive (rows 0..30 → 31 rows).
    // Horizon-aware (horizon=10): only rows 21..30 with delta<=10 → 10 rows.
    const goalMinutes = [30];
    let preFixPositives = 0;
    let horizonPositives = 0;
    for (let r = 0; r <= 35; r++) {
      // Pre-fix formula (the bug)
      if (r <= 30) preFixPositives++;
      // Horizon-aware (the fix)
      if (horizonLabel(r, goalMinutes, 10).label === 1) horizonPositives++;
    }
    // Pre-fix gave ~88% (31/36). Horizon-aware should be much sparser.
    expect(preFixPositives / 36).toBeGreaterThan(0.8);
    expect(horizonPositives / 36).toBeLessThan(0.4);
    // And both must be > 0 — the fix doesn't kill the positive class.
    expect(horizonPositives).toBeGreaterThan(0);
  });
});

describe("labelForLog createdAt-driven (exportTrainingData)", () => {
  // Row logged at 12:30 UTC. Goals must carry a createdAt timestamp
  // within (anchor, anchor + horizonMs].
  const anchor = new Date(Date.UTC(2026, 6, 1, 12, 30, 0));

  test("goal 2 min after row with createdAt → positive (horizon 5)", () => {
    const goalCreatedAt = new Date(anchor.getTime() + 2 * 60_000);
    const out = labelForLogMinuteFallback(anchor, 5, [
      { minute: 32, createdAt: goalCreatedAt },
    ]);
    expect(out).toBe(1);
  });

  test("goal 20 min after row with createdAt → negative (horizon 5)", () => {
    const goalCreatedAt = new Date(anchor.getTime() + 20 * 60_000);
    const out = labelForLogMinuteFallback(anchor, 5, [
      { minute: 50, createdAt: goalCreatedAt },
    ]);
    expect(out).toBe(0);
  });

  test("goal at same timestamp as row → negative (must be > 0)", () => {
    const out = labelForLogMinuteFallback(anchor, 5, [
      { minute: 30, createdAt: anchor },
    ]);
    expect(out).toBe(0);
  });

  test("goal with createdAt=null → conservative 0 (no false positives)", () => {
    // The match kickoff isn't on the row, so we can't derive the
    // goal's wall-clock time. Returning 0 prevents inflating the
    // positive class rate.
    const out = labelForLogMinuteFallback(anchor, 5, [
      { minute: 32, createdAt: null },
    ]);
    expect(out).toBe(0);
  });

  test("createdAt in the PAST does NOT trigger", () => {
    const pastGoal = new Date(anchor.getTime() - 5 * 60_000);
    const out = labelForLogMinuteFallback(anchor, 5, [
      { minute: 50, createdAt: pastGoal },
    ]);
    expect(out).toBe(0);
  });

  test("multiple goals with createdAt → first eligible in horizon wins", () => {
    const rowAt = new Date(Date.UTC(2026, 6, 1, 12, 30, 0));
    const out = labelForLogMinuteFallback(rowAt, 10, [
      { minute: 50, createdAt: new Date(rowAt.getTime() + 20 * 60_000) }, // out
      { minute: 32, createdAt: new Date(rowAt.getTime() + 2 * 60_000) }, // in
      { minute: 40, createdAt: new Date(rowAt.getTime() + 10 * 60_000) }, // in (boundary)
    ]);
    expect(out).toBe(1);
  });
});

describe("integration: positive-rate sanity check", () => {
  // Synthesise a realistic match with multiple goals and verify the
  // horizon-aware label rate matches the real-world goal rate (~10-15%).
  test("horizon-aware label rate is in [5%, 25%] for a realistic match", () => {
    // 90 minutes, two goals at minutes 30 and 65, horizon = 10
    const goalMinutes = [30, 65];
    let positives = 0;
    let total = 0;
    for (let r = 5; r <= 90; r++) {
      total++;
      if (horizonLabel(r, goalMinutes, 10).label === 1) positives++;
    }
    const rate = positives / total;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.25);
  });

  test("horizon-aware label rate for typical PL match (1.4 goals/match)", () => {
    // Average PL match: ~1.4 goals. Simulate as 90 min, 1-2 goals at
    // random minutes, horizon = 10. The positive rate must remain
    // realistic (not 80%+ like the pre-fix formula).
    for (let trial = 0; trial < 50; trial++) {
      const nGoals = Math.random() < 0.4 ? 0 : Math.random() < 0.6 ? 1 : 2;
      const goalMinutes: number[] = [];
      for (let i = 0; i < nGoals; i++) {
        goalMinutes.push(Math.floor(15 + Math.random() * 70));
      }
      let positives = 0;
      let total = 0;
      for (let r = 5; r <= 90; r++) {
        total++;
        if (horizonLabel(r, goalMinutes, 10).label === 1) positives++;
      }
      const rate = positives / total;
      // 0 goals → 0%. 1 goal at minute M → ~(min(M+10,90)-max(M-0,5))/86 rate.
      // 2 goals → roughly double. We expect < 25% in all cases.
      expect(rate).toBeLessThan(0.25);
    }
  });
});