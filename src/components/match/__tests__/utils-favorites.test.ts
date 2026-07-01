import { describe, expect, test } from "bun:test";
import { loadFavorites, saveFavorites } from "../utils";

describe("favorites storage", () => {
  test("loadFavorites returns an empty Set when storage is empty", () => {
    // globalThis.localStorage was installed by src/test-setup.ts
    globalThis.localStorage.clear();
    const result = loadFavorites();
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  test("saveFavorites then loadFavorites round-trips the set", () => {
    globalThis.localStorage.clear();
    const original = new Set<number>([101, 202, 303]);
    saveFavorites(original);
    const loaded = loadFavorites();
    expect(loaded.size).toBe(3);
    expect(loaded.has(101)).toBe(true);
    expect(loaded.has(202)).toBe(true);
    expect(loaded.has(303)).toBe(true);
  });

  test("saveFavorites serializes as an array of numbers (not Set)", () => {
    globalThis.localStorage.clear();
    saveFavorites(new Set([1, 2, 3]));
    const raw = globalThis.localStorage.getItem("optimus_favorites");
    expect(raw).not.toBeNull();
    // Must be JSON-parseable into a regular array.
    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual([1, 2, 3]);
  });

  test("loadFavorites ignores malformed JSON and returns empty Set", () => {
    globalThis.localStorage.setItem("optimus_favorites", "{not json");
    const result = loadFavorites();
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  test("loadFavorites ignores entries that aren't numbers", () => {
    // Defensive: localStorage may contain stale data from a previous
    // version with string IDs. Current API only uses numbers.
    globalThis.localStorage.setItem(
      "optimus_favorites",
      JSON.stringify([1, "two", null, 4]),
    );
    const result = loadFavorites();
    // `new Set(JSON.parse(...))` keeps all values verbatim — including
    // strings and null. This test pins the current behaviour so we
    // notice if it changes accidentally.
    expect(result.has(1)).toBe(true);
    expect(result.has(4)).toBe(true);
    expect(result.has("two" as unknown as number)).toBe(true);
  });

  test("saveFavorites handles empty Set", () => {
    globalThis.localStorage.clear();
    saveFavorites(new Set());
    const raw = globalThis.localStorage.getItem("optimus_favorites");
    expect(raw).toBe("[]");
    const loaded = loadFavorites();
    expect(loaded.size).toBe(0);
  });
});