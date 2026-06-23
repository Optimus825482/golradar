import { describe, expect, test } from "bun:test";
import {
  isExcludedMinute,
  invalidateExcludedMinutesCache,
  type MinuteRange,
} from "../excludedMinutes";

const sampleZones: MinuteRange[] = [
  { start: 0, end: 5, reason: "kickoff" },
  { start: 45, end: 47, reason: "halftime" },
  { start: 88, end: 90, reason: "final whistle" },
];

describe("isExcludedMinute", () => {
  test("returns true for minute inside a zone", () => {
    expect(isExcludedMinute(3, sampleZones)).toBe(true);
    expect(isExcludedMinute(46, sampleZones)).toBe(true);
    expect(isExcludedMinute(90, sampleZones)).toBe(true);
  });

  test("returns false for minute outside all zones", () => {
    expect(isExcludedMinute(20, sampleZones)).toBe(false);
    expect(isExcludedMinute(70, sampleZones)).toBe(false);
  });

  test("returns false for empty zone list", () => {
    expect(isExcludedMinute(50, [])).toBe(false);
  });

  test("handles boundary inclusively", () => {
    expect(isExcludedMinute(0, sampleZones)).toBe(true);
    expect(isExcludedMinute(5, sampleZones)).toBe(true);
    expect(isExcludedMinute(91, sampleZones)).toBe(false);
  });

  test("returns false for negative or invalid minutes", () => {
    expect(isExcludedMinute(-1, sampleZones)).toBe(false);
    expect(isExcludedMinute(NaN, sampleZones)).toBe(false);
  });
});

describe("invalidateExcludedMinutesCache", () => {
  test("is a no-throw function (resets module state)", () => {
    expect(() => invalidateExcludedMinutesCache()).not.toThrow();
  });
});
