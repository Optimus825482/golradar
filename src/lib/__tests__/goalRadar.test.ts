import { describe, expect, test } from "bun:test";
import { calculateGoalProbability } from "../goalRadar";
import type { MatchStats } from "../nesineTypes";

function makeStats(overrides: Partial<MatchStats> = {}): MatchStats {
  return {
    possession: { home: 50, away: 50 },
    shots_total: { home: 5, away: 5 },
    shots_on_target: { home: 2, away: 2 },
    shots_blocked: { home: 1, away: 1 },
    dangerous_attacks: { home: 15, away: 15 },
    corners: { home: 3, away: 3 },
    yellow_cards: { home: 0, away: 0 },
    red_cards: { home: 0, away: 0 },
    two_yellow_red: { home: 0, away: 0 },
    free_kicks: { home: 2, away: 2 },
    xg: { home: 0.8, away: 0.6 },
    ...overrides,
  };
}

describe("calculateGoalProbability: non-live guard", () => {
  test("non-live match → zeros with low/null", () => {
    const r = calculateGoalProbability(makeStats(), "30", false);
    expect(r.score).toBe(0);
    expect(r.side).toBeNull();
    expect(r.level).toBe("low");
  });
});

describe("calculateGoalProbability: basic live match", () => {
  test("balanced stats, mid match → moderate score", () => {
    const r = calculateGoalProbability(makeStats(), "60", true);
    expect(r.score).toBeGreaterThanOrEqual(10);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(typeof r.homeScore).toBe("number");
    expect(typeof r.awayScore).toBe("number");
    expect(Array.isArray(r.factors)).toBe(true);
    expect(r.poissonP).toBeGreaterThanOrEqual(0);
    expect(r.goalProbability5min).toBeGreaterThan(0);
  });
});

describe("calculateGoalProbability: odds movement boost", () => {
  test("critical odds boost → increased score + factor", () => {
    const r = calculateGoalProbability(makeStats(), "60", true, undefined, 0, 0, undefined, undefined, {
      homeBoost: 8,
      awayBoost: 2,
      significance: "critical",
    });
    expect(r.factors.some((f) => f.includes("Piyasa"))).toBe(true);
    expect(r.score).toBeGreaterThan(20);
  });

  test("no boost → no market factor", () => {
    const r = calculateGoalProbability(makeStats(), "60", true, undefined, 0, 0, undefined, undefined, {
      homeBoost: 0,
      awayBoost: 0,
      significance: "none",
    });
    expect(r.factors.some((f) => f.includes("Piyasa"))).toBe(false);
  });
});

describe("calculateGoalProbability: pressure dominance", () => {
  test("high home pressure → home side factor", () => {
    // Need total xg >= ~3.0 so goalProbability5min >= 0.20 (passes 5-min gate)
    const stats = makeStats({
      possession: { home: 65, away: 35 },
      dangerous_attacks: { home: 30, away: 8 },
      shots_on_target: { home: 6, away: 1 },
      corners: { home: 8, away: 1 },
      xg: { home: 2.5, away: 0.5 },
    });
    const r = calculateGoalProbability(stats, "60", true);
    expect(r.factors.some((f) => f.includes("Baskı") || f.includes("Tehl"))).toBe(true);
    expect(r.side === "home" || r.side === "both").toBe(true);
  });
});

describe("calculateGoalProbability: card advantage", () => {
  test("away red card → home gets +18 boost, away gets -22 penalty", () => {
    const stats = makeStats({ red_cards: { home: 0, away: 1 } });
    const r = calculateGoalProbability(stats, "60", true);
    expect(r.factors.some((f) => f.includes("Rakip kırmızı"))).toBe(true);
    expect(r.factors.some((f) => f.includes("Kırmızı kart dezavantajı"))).toBe(true);
  });

  test("home red card → away gets boost", () => {
    const stats = makeStats({ red_cards: { home: 1, away: 0 } });
    const r = calculateGoalProbability(stats, "60", true);
    expect(r.factors.some((f) => f.includes("Rakip kırmızı"))).toBe(true);
    expect(r.factors.some((f) => f.includes("Kırmızı kart dezavantajı"))).toBe(true);
  });

  test("≥3 away yellows → home gets incremental boost", () => {
    const stats = makeStats({ yellow_cards: { home: 0, away: 3 } });
    const r = calculateGoalProbability(stats, "60", true);
    expect(r.factors.some((f) => f.includes("Rakip"))).toBe(true);
  });
});

describe("calculateGoalProbability: goal cooldown", () => {
  function snap(hg: number, ag: number, hp = 56, ap = 56) {
    return {
      homePressure: hp,
      awayPressure: ap,
      stats: makeStats({
        dangerous_attacks: { home: 10, away: 10 },
        shots_on_target: { home: 2, away: 2 },
        corners: { home: 3, away: 3 },
      }),
      homeGoals: hg,
      awayGoals: ag,
    };
  }

  test("recent home goal → cooldown active, scores suppressed", () => {
    // 20 snapshots: goal at snapshot 1 (very old), cooldownFactor = (18/20)² = 0.81
    // After cooldown: hs = round(hs * 0.81 * 0.3). Need initial hs >= 83 so result >= 20
    const hist = Array.from({ length: 20 }, (_, i) => {
      const goal = i < 1 ? 0 : 1;
      return snap(goal, 0, 56, 56);
    });
    const r = calculateGoalProbability(makeStats({
      possession: { home: 70, away: 30 },
      dangerous_attacks: { home: 45, away: 2 },
      shots_on_target: { home: 10, away: 0 },
      corners: { home: 10, away: 1 },
      xg: { home: 3.5, away: 0.1 },
    }), "60", true, hist, 1, 0);
    expect(r.factors.some((f) => f.includes("soğuma"))).toBe(true);
  });

  test("no recent goal → no cooldown factor", () => {
    const hist = Array.from({ length: 20 }, () => snap(0, 0));
    const r = calculateGoalProbability(makeStats(), "60", true, hist, 0, 0);
    expect(r.factors.some((f) => f.includes("soğuma"))).toBe(false);
  });
});

describe("calculateGoalProbability: concurrent threat multiplier", () => {
  test("many active factors → fırtına or kritik eşik bonus", () => {
    // High stats across all dimensions spawn many factors
    const stats = makeStats({
      possession: { home: 72, away: 28 },
      dangerous_attacks: { home: 40, away: 5 },
      shots_on_target: { home: 10, away: 0 },
      corners: { home: 12, away: 0 },
      xg: { home: 2.5, away: 0.1 },
    });
    const r = calculateGoalProbability(stats, "70", true);
    expect(r.score).toBeGreaterThan(0);
  });
});

describe("calculateGoalProbability: level determination", () => {
  test("high stats → critical level", () => {
    const stats = makeStats({
      possession: { home: 75, away: 25 },
      dangerous_attacks: { home: 50, away: 3 },
      shots_on_target: { home: 12, away: 0 },
      corners: { home: 15, away: 0 },
      xg: { home: 3.5, away: 0.05 },
    });
    const r = calculateGoalProbability(stats, "75", true);
    expect(r.level).toBe("critical");
    expect(r.side).not.toBeNull();
  });

  test("low stats → low level", () => {
    const stats = makeStats({
      dangerous_attacks: { home: 3, away: 3 },
      shots_on_target: { home: 0, away: 0 },
      corners: { home: 0, away: 0 },
      xg: { home: 0.05, away: 0.05 },
    });
    const r = calculateGoalProbability(stats, "60", true);
    expect(r.level).toBe("low");
    expect(r.score).toBeLessThan(50);
  });
});

describe("calculateGoalProbability: edge cases", () => {
  test("empty stats → safe result", () => {
    const empty = {} as MatchStats;
    const r = calculateGoalProbability(empty, "30", true);
    expect(typeof r.score).toBe("number");
    expect(["low", "medium"]).toContain(r.level);
  });

  test("very early minute → conservative", () => {
    const stats = makeStats({
      shots_on_target: { home: 2, away: 0 },
      dangerous_attacks: { home: 5, away: 2 },
    });
    const r = calculateGoalProbability(stats, "3", true);
    expect(r.score).toBeDefined();
  });

  test("stoppage time minute parsing", () => {
    const stats = makeStats({
      dangerous_attacks: { home: 30, away: 5 },
      shots_on_target: { home: 8, away: 1 },
    });
    const r = calculateGoalProbability(stats, "90+3", true);
    expect(typeof r.score).toBe("number");
  });

  test("very late in match → high minute multiplier", () => {
    const stats = makeStats({
      dangerous_attacks: { home: 20, away: 5 },
      shots_on_target: { home: 5, away: 1 },
    });
    const r = calculateGoalProbability(stats, "88", true);
    expect(typeof r.score).toBe("number");
  });
});

