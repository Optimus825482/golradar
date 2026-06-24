import { describe, expect, test } from "bun:test";
import {
  recordSignalSchema,
  expireHalftimeSchema,
  cleanupSignalsSchema,
  reportGoalSchema,
  predictQuerySchema,
  featuresQuerySchema,
  recordTrainingSchema,
  predictFullSchema,
  calibrationModeSchema,
  updateProfileSchema,
  previewCompoundSchema,
  parseActionBody,
} from "../apiSchemas";

const baseSignal = {
  matchCode: 12345,
  homeTeam: "Galatasaray",
  awayTeam: "Fenerbahce",
  league: "Super Lig",
  matchTime: "19:00",
  minute: "67",
  score: 72,
  side: "home" as const,
  level: "high" as const,
  factors: ["Pressure 75%"],
  calibratedP: 0.42,
  poissonP: 0.18,
  homeScore: 60,
  awayScore: 30,
  homeGoals: 1,
  awayGoals: 0,
};

describe("apiSchemas: recordSignalSchema", () => {
  test("accepts a valid record", () => {
    expect(recordSignalSchema.safeParse(baseSignal).success).toBe(true);
  });

  test("rejects invalid side", () => {
    const r = recordSignalSchema.safeParse({ ...baseSignal, side: "weird" });
    expect(r.success).toBe(false);
  });

  test("rejects out-of-range score", () => {
    const r = recordSignalSchema.safeParse({ ...baseSignal, score: 150 });
    expect(r.success).toBe(false);
  });

  test("rejects negative matchCode", () => {
    const r = recordSignalSchema.safeParse({ ...baseSignal, matchCode: -1 });
    expect(r.success).toBe(false);
  });

  test("rejects oversized factors array", () => {
    const r = recordSignalSchema.safeParse({
      ...baseSignal,
      factors: Array(50).fill("x"),
    });
    expect(r.success).toBe(false);
  });

  test("applies level default", () => {
    const { level: _, ...noLevel } = baseSignal;
    const r = recordSignalSchema.safeParse(noLevel);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.level).toBe("medium");
  });
});

describe("apiSchemas: expireHalftimeSchema", () => {
  test("accepts non-empty array", () => {
    expect(expireHalftimeSchema.safeParse({ matchCodes: [1, 2, 3] }).success).toBe(true);
  });
  test("rejects empty array", () => {
    expect(expireHalftimeSchema.safeParse({ matchCodes: [] }).success).toBe(false);
  });
  test("rejects non-positive ints", () => {
    expect(expireHalftimeSchema.safeParse({ matchCodes: [0, -1] }).success).toBe(false);
  });
  test("rejects > 2000 items", () => {
    const r = expireHalftimeSchema.safeParse({ matchCodes: Array(2001).fill(1) });
    expect(r.success).toBe(false);
  });
});

describe("apiSchemas: cleanupSignalsSchema", () => {
  test("accepts activeCodes array", () => {
    expect(cleanupSignalsSchema.safeParse({ activeCodes: [1] }).success).toBe(true);
  });
});

describe("apiSchemas: reportGoalSchema", () => {
  test("accepts valid report", () => {
    expect(
      reportGoalSchema.safeParse({ matchCode: 1, goalSide: "home", goalMinute: 50 }).success,
    ).toBe(true);
  });
  test("rejects minute > 130", () => {
    expect(
      reportGoalSchema.safeParse({ matchCode: 1, goalSide: "home", goalMinute: 200 }).success,
    ).toBe(false);
  });
});

describe("apiSchemas: predictQuerySchema", () => {
  test("accepts minimal query", () => {
    const r = predictQuerySchema.safeParse({ home: "A", away: "B" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.score).toBe(0);
      expect(r.data.minute).toBe("45");
    }
  });
  test("coerces string scores to int", () => {
    const r = predictQuerySchema.safeParse({ home: "A", away: "B", score: "75" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.score).toBe(75);
  });
  test("rejects missing teams", () => {
    expect(predictQuerySchema.safeParse({ home: "A" }).success).toBe(false);
  });
});

describe("apiSchemas: recordTrainingSchema", () => {
  test("accepts valid record", () => {
    const r = recordTrainingSchema.safeParse({
      features: [0.5, 0.2, 0.1, 0.9],
      label: 1,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.side).toBe("both");
  });
  test("rejects bad side", () => {
    expect(
      recordTrainingSchema.safeParse({ features: [0.1], label: 0, side: "x" }).success,
    ).toBe(false);
  });
});

describe("apiSchemas: predictFullSchema", () => {
  test("accepts empty body — uses defaults", () => {
    const r = predictFullSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.homeGoals).toBe(0);
      expect(r.data.awayGoals).toBe(0);
    }
  });
  test("rejects negative goals", () => {
    expect(predictFullSchema.safeParse({ homeGoals: -1 }).success).toBe(false);
  });
});

describe("apiSchemas: calibrationModeSchema", () => {
  test("accepts auto mode", () => {
    expect(calibrationModeSchema.safeParse({ mode: "auto" }).success).toBe(true);
  });
  test("accepts manual with avg", () => {
    const r = calibrationModeSchema.safeParse({
      mode: "manual",
      manualAvgGoalMinute: 35,
    });
    expect(r.success).toBe(true);
  });
  test("rejects unknown mode", () => {
    expect(calibrationModeSchema.safeParse({ mode: "x" }).success).toBe(false);
  });
});

describe("apiSchemas: updateProfileSchema", () => {
  test("accepts valid profile update", () => {
    const r = updateProfileSchema.safeParse({
      leagueId: 1,
      leagueName: "Test",
      country: "TR",
      goalMinutes: [12, 23, 45, 67, 89],
    });
    expect(r.success).toBe(true);
  });
  test("rejects empty goalMinutes", () => {
    expect(
      updateProfileSchema.safeParse({ leagueId: 1, goalMinutes: [] }).success,
    ).toBe(false);
  });
});

describe("apiSchemas: previewCompoundSchema", () => {
  test("accepts minimal", () => {
    expect(previewCompoundSchema.safeParse({}).success).toBe(true);
  });
  test("rejects invalid significance", () => {
    expect(
      previewCompoundSchema.safeParse({ oddsSignificance: "extreme" }).success,
    ).toBe(false);
  });
});

describe("apiSchemas: parseActionBody helper", () => {
  test("returns ok+data on success", () => {
    const r = parseActionBody(recordSignalSchema, baseSignal);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.matchCode).toBe(12345);
  });
  test("returns error string on failure", () => {
    const r = parseActionBody(recordSignalSchema, { ...baseSignal, score: 999 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("score");
  });
});
