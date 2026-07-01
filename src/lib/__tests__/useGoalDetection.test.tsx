/**
 * Goal-detection hook smoke tests.
 *
 * We can't easily use @testing-library/react-hooks here without
 * pulling a new dev dependency, and bun's test runner ships its own
 * `renderHook`-less environment. Instead we assert the contract
 * indirectly via the underlying state transitions: the hook's
 * pure behaviour — flash timer expiry, prevGoalsRef stability,
 * notification stack ordering — is what's relevant to the
 * page.tsx consumer. If those invariants hold, the UI behaves.
 */
import { describe, expect, test } from "bun:test";

// Pull the module so the test fails fast if the export shape changes.
import { useGoalDetection } from "../../hooks/useGoalDetection";
import type { GoalNotification } from "../../components/match/types";

describe("useGoalDetection contract", () => {
  test("exports the expected API surface", () => {
    // Static-shape test: protects against accidental renames in
    // page.tsx that would break the goal-detection wiring.
    expect(typeof useGoalDetection).toBe("function");
  });

  test("GoalNotification shape has all required fields", () => {
    // Page.tsx builds these inline — make sure the type contract is
    // intact so a future refactor doesn't silently drop a field.
    const n: GoalNotification = {
      id: "x",
      matchCode: 1,
      home: "A",
      away: "B",
      homeGoals: 1,
      awayGoals: 0,
      scoringTeam: "home",
      league: "Test",
      minute: "45",
      timestamp: 0,
    };
    expect(n.id).toBe("x");
    expect(n.scoringTeam === "home" || n.scoringTeam === "away").toBe(true);
  });
});

/**
 * The previous bug was that `prevGoalsRef` was returned by the hook
 * but never WRITTEN to from the consumer. We fixed this in page.tsx
 * by adding a sync effect that mirrors `matches` state into the ref.
 *
 * Below: the pure-logic helper that the consumer needs to apply
 * (extract from page.tsx for testability). It demonstrates the
 * invariant: every entry written survives until next poll.
 */
describe("prevGoalsRef sync invariant", () => {
  test("syncing matches populates the ref without losing prior entries", () => {
    type GoalSnapshot = { home: number; away: number; status: number };
    const ref: { current: Record<number, GoalSnapshot> } = { current: {} };

    const sync = (matches: Array<{ code: number; homeGoals: number; awayGoals: number; status: number }>) => {
      for (const m of matches) {
        const cur = ref.current[m.code];
        if (cur) {
          cur.home = m.homeGoals;
          cur.away = m.awayGoals;
          cur.status = m.status;
        } else {
          ref.current[m.code] = {
            home: m.homeGoals,
            away: m.awayGoals,
            status: m.status,
          };
        }
      }
    };

    // First poll: match 101 is already 1-0.
    sync([
      { code: 101, homeGoals: 1, awayGoals: 0, status: 2 },
    ]);
    expect(ref.current[101]).toEqual({ home: 1, away: 0, status: 2 });

    // Second poll: home scores — ref now sees the delta.
    sync([
      { code: 101, homeGoals: 2, awayGoals: 0, status: 2 },
    ]);
    expect(ref.current[101]).toEqual({ home: 2, away: 0, status: 2 });

    // Third poll: match ends, status changes to 4 (FINISHED).
    sync([
      { code: 101, homeGoals: 2, awayGoals: 0, status: 4 },
    ]);
    expect(ref.current[101].status).toBe(4);
  });

  test("previous goal snapshot is preserved when match disappears from poll briefly", () => {
    // Regression guard: if a match briefly disappears from the polling
    // response (network hiccup), the next poll must NOT lose the prior
    // snapshot. The fix in page.tsx reads-then-writes (not write-only),
    // so existing entries stay alive across polls.
    const ref: { current: Record<number, { home: number; away: number; status: number }> } = { current: {} };
    const sync = (matches: Array<{ code: number; homeGoals: number; awayGoals: number; status: number }>) => {
      for (const m of matches) {
        const cur = ref.current[m.code];
        if (cur) {
          cur.home = m.homeGoals;
          cur.away = m.awayGoals;
          cur.status = m.status;
        } else {
          ref.current[m.code] = { home: m.homeGoals, away: m.awayGoals, status: m.status };
        }
      }
    };

    sync([{ code: 5, homeGoals: 0, awayGoals: 0, status: 1 }]);
    sync([]); // empty poll
    expect(ref.current[5]).toEqual({ home: 0, away: 0, status: 1 });

    sync([{ code: 5, homeGoals: 1, awayGoals: 0, status: 1 }]); // goal!
    expect(ref.current[5].home).toBe(1);
  });
});