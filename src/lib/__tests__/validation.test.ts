import { describe, expect, test } from "bun:test";
import {
  signalRecordSchema,
  expireHalftimeSchema,
  predictRecordSchema,
  mlTrainSchema,
  authLoginSchema,
  authChangePasswordSchema,
  formatZodError,
} from "../validation";

describe("validation: signalRecordSchema", () => {
  test("accepts a valid signal record", () => {
    const input = {
      matchCode: 12345,
      homeTeam: "Galatasaray",
      awayTeam: "Fenerbahce",
      league: "Super Lig",
      matchTime: "19:00",
      minute: "67",
      score: 72,
      side: "home",
      level: "high",
      factors: ["Pressure 75%"],
      calibratedP: 0.42,
      poissonP: 0.18,
      homeScore: 60,
      awayScore: 30,
      homeGoals: 1,
      awayGoals: 0,
    };
    const r = signalRecordSchema.safeParse(input);
    expect(r.success).toBe(true);
  });

  test("rejects invalid side", () => {
    const r = signalRecordSchema.safeParse({
      matchCode: 1,
      homeTeam: "A", awayTeam: "B", league: "L",
      minute: "1", score: 50, side: "weird",
      factors: [], calibratedP: 0, poissonP: 0,
      homeScore: 0, awayScore: 0, homeGoals: 0, awayGoals: 0,
    });
    expect(r.success).toBe(false);
  });

  test("rejects out-of-range score", () => {
    const r = signalRecordSchema.safeParse({
      matchCode: 1,
      homeTeam: "A", awayTeam: "B", league: "L",
      minute: "1", score: 150, side: "home",
      factors: [], calibratedP: 0, poissonP: 0,
      homeScore: 0, awayScore: 0, homeGoals: 0, awayGoals: 0,
    });
    expect(r.success).toBe(false);
  });

  test("strict mode rejects unknown fields", () => {
    const r = signalRecordSchema.safeParse({
      matchCode: 1,
      homeTeam: "A", awayTeam: "B", league: "L",
      minute: "1", score: 50, side: "home",
      factors: [], calibratedP: 0, poissonP: 0,
      homeScore: 0, awayScore: 0, homeGoals: 0, awayGoals: 0,
      extraField: "nope",
    });
    expect(r.success).toBe(false);
  });
});

describe("validation: expireHalftimeSchema", () => {
  test("accepts non-empty array of positive ints", () => {
    const r = expireHalftimeSchema.safeParse({ matchCodes: [1, 2, 3] });
    expect(r.success).toBe(true);
  });

  test("rejects empty array", () => {
    const r = expireHalftimeSchema.safeParse({ matchCodes: [] });
    expect(r.success).toBe(false);
  });
});

describe("validation: predictRecordSchema", () => {
  test("accepts valid record", () => {
    const r = predictRecordSchema.safeParse({
      matchCode: 1, minute: 30, score: 60,
      side: "home", calibratedP: 0.3, goalScored: false,
      minutesToGoal: null, modelVariant: "champion",
    });
    expect(r.success).toBe(true);
  });

  test("rejects negative minute", () => {
    const r = predictRecordSchema.safeParse({
      matchCode: 1, minute: -5, score: 60,
      side: "home", calibratedP: 0.3, goalScored: false,
      minutesToGoal: null,
    });
    expect(r.success).toBe(false);
  });
});

describe("validation: mlTrainSchema", () => {
  test("accepts valid model name", () => {
    const r = mlTrainSchema.safeParse({ name: "xgb" });
    expect(r.success).toBe(true);
  });

  test("rejects unknown model", () => {
    const r = mlTrainSchema.safeParse({ name: "unknown" });
    expect(r.success).toBe(false);
  });

  test("accepts semantic version", () => {
    const r = mlTrainSchema.safeParse({ name: "gbdt", version: "1.2.3" });
    expect(r.success).toBe(true);
  });

  test("rejects invalid version format", () => {
    const r = mlTrainSchema.safeParse({ name: "gbdt", version: "v1" });
    expect(r.success).toBe(false);
  });
});

describe("validation: authLoginSchema", () => {
  test("accepts valid login", () => {
    const r = authLoginSchema.safeParse({
      action: "login", username: "admin", password: "x",
    });
    expect(r.success).toBe(true);
  });

  test("rejects wrong action", () => {
    const r = authLoginSchema.safeParse({
      action: "register", username: "admin", password: "x",
    });
    expect(r.success).toBe(false);
  });
});

describe("validation: authChangePasswordSchema", () => {
  test("accepts valid change-password", () => {
    const r = authChangePasswordSchema.safeParse({
      action: "change-password", password: "old", newPassword: "newpass123",
    });
    expect(r.success).toBe(true);
  });

  test("rejects short new password (< 6)", () => {
    const r = authChangePasswordSchema.safeParse({
      action: "change-password", password: "old", newPassword: "x",
    });
    expect(r.success).toBe(false);
  });
});

describe("validation: formatZodError", () => {
  test("formats issues into field→message map", () => {
    const result = signalRecordSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const map = formatZodError(result.error.issues);
      expect(typeof map).toBe("object");
      expect(Object.keys(map).length).toBeGreaterThan(0);
    }
  });
});
