/**
 * FinishedMatchCard GOL badge tests.
 *
 * Regression guard for the fix in this commit: previously a finished
 * match with a non-zero score rendered the score digits but no GOL
 * indicator. The fix renders a small static "GOL" pill on the score
 * column whenever homeGoals > 0 || awayGoals > 0.
 */
import { describe, expect, test } from "bun:test";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import * as React from "react";
import { FinishedMatchCard } from "../FinishedMatchCard";
import type { Match } from "../types";

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    code: 1,
    home: "Galatasaray",
    away: "Fenerbahçe",
    homeGoals: 0,
    awayGoals: 0,
    league: "Süper Lig",
    country: "TR",
    time: "MS",
    minute: "MS",
    status: 4,
    isLive: false,
    isFinished: true,
    hasStats: false,
    stats: {} as Match["stats"],
    firstHalfScore: "-",
    homeRedCards: 0,
    awayRedCards: 0,
    ...overrides,
  } as Match;
}

function renderCard(match: Match): HTMLDivElement {
  const container = document.createElement("div");
  const root: Root = createRoot(container);
  act(() => {
    root.render(<FinishedMatchCard match={match} onClick={() => {}} />);
  });
  // Caller must query the container, then call cleanup via unmount().
  (container as unknown as { _root?: Root })._root = root;
  return container;
}

function cleanup(container: HTMLDivElement): void {
  const root = (container as unknown as { _root?: Root })._root;
  if (root) {
    act(() => {
      root.unmount();
    });
  }
}

describe("FinishedMatchCard GOL badge", () => {
  test("renders GOL badge when home team scored", () => {
    const container = renderCard(makeMatch({ homeGoals: 2, awayGoals: 0 }));
    try {
      const badge = container.querySelector('[data-testid="finished-goal-badge"]');
      expect(badge).not.toBeNull();
      expect(badge!.textContent).toBe("GOL");
    } finally {
      cleanup(container);
    }
  });

  test("renders GOL badge when away team scored", () => {
    const container = renderCard(makeMatch({ homeGoals: 0, awayGoals: 1 }));
    try {
      const badge = container.querySelector('[data-testid="finished-goal-badge"]');
      expect(badge).not.toBeNull();
      expect(badge!.textContent).toBe("GOL");
    } finally {
      cleanup(container);
    }
  });

  test("renders GOL badge for high-scoring draws", () => {
    const container = renderCard(makeMatch({ homeGoals: 3, awayGoals: 3 }));
    try {
      const badge = container.querySelector('[data-testid="finished-goal-badge"]');
      expect(badge).not.toBeNull();
    } finally {
      cleanup(container);
    }
  });

  test("does NOT render GOL badge for goalless draws", () => {
    const container = renderCard(makeMatch({ homeGoals: 0, awayGoals: 0 }));
    try {
      const badge = container.querySelector('[data-testid="finished-goal-badge"]');
      expect(badge).toBeNull();
    } finally {
      cleanup(container);
    }
  });

  test("score display always renders homeGoals-awayGoals", () => {
    const container = renderCard(makeMatch({ homeGoals: 4, awayGoals: 2 }));
    try {
      expect(container.textContent).toContain("4 - 2");
    } finally {
      cleanup(container);
    }
  });

  test("finished GOL badge is static (no pulse animation)", () => {
    const container = renderCard(makeMatch({ homeGoals: 1, awayGoals: 0 }));
    try {
      const badge = container.querySelector('[data-testid="finished-goal-badge"]')!;
      expect(badge.querySelector(".goal-badge-flash")).toBeNull();
    } finally {
      cleanup(container);
    }
  });
});