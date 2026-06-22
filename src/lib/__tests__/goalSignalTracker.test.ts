import { describe, expect, test } from "bun:test";
import { parseMinute, getLocalDateString } from "../goalSignalTracker";

describe("goalSignalTracker: parseMinute", () => {
  test("numeric input clamped to [0, 120]", () => {
    expect(parseMinute(0)).toBe(0);
    expect(parseMinute(45)).toBe(45);
    expect(parseMinute(90)).toBe(90);
    expect(parseMinute(120)).toBe(120);
    expect(parseMinute(-5)).toBe(0);
    expect(parseMinute(150)).toBe(120);
  });

  test("plain digit string parses to int", () => {
    expect(parseMinute("0")).toBe(0);
    expect(parseMinute("45")).toBe(45);
    expect(parseMinute("90")).toBe(90);
  });

  test("stoppage time '45+2' sums to 47", () => {
    expect(parseMinute("45+2")).toBe(47);
    expect(parseMinute("90+3")).toBe(93);
    expect(parseMinute("90+30")).toBe(120); // clamp to 120
  });

  test("non-numeric strings default to 0", () => {
    expect(parseMinute("HT")).toBe(0);
    expect(parseMinute("FT")).toBe(0);
    expect(parseMinute("")).toBe(0);
    expect(parseMinute("abc")).toBe(0);
  });

  test("mixed garbage extracts digits", () => {
    // "45'" → 45
    expect(parseMinute("45'")).toBe(45);
    // "12 min" → 12
    expect(parseMinute("12 min")).toBe(12);
  });

  test("negative numeric clamped to 0", () => {
    expect(parseMinute(-1)).toBe(0);
    expect(parseMinute(-999)).toBe(0);
  });

  test("excessive stoppage clamped to 120", () => {
    expect(parseMinute("100+50")).toBe(120);
  });
});

describe("goalSignalTracker: getLocalDateString", () => {
  test("formats date as YYYY-MM-DD with zero-padding", () => {
    // Use UTC to avoid timezone-dependent flakiness in CI.
    const d = new Date(Date.UTC(2026, 0, 5)); // Jan 5, 2026
    const s = getLocalDateString(d);
    // Local TZ may shift the day; accept either Jan 4 or Jan 5.
    expect(s).toMatch(/^2026-01-(04|05)$/);
  });

  test("pads single-digit month and day", () => {
    const d = new Date(2026, 2, 9); // Mar 9, 2026 (local)
    const s = getLocalDateString(d);
    expect(s).toMatch(/^2026-03-09$/);
  });

  test("two-digit month/day not padded", () => {
    const d = new Date(2026, 11, 25); // Dec 25, 2026 (local)
    const s = getLocalDateString(d);
    expect(s).toMatch(/^2026-12-25$/);
  });

  test("default arg uses current date", () => {
    const s = getLocalDateString();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Should be parseable
    const parsed = new Date(s + "T00:00:00");
    expect(isNaN(parsed.getTime())).toBe(false);
  });
});
