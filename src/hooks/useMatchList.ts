"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePresence } from "@/hooks/usePresence";
import { tierConfig } from "@/lib/tier";
import type { Match, PressureSnapshot } from "@/components/match/types";
import { HALFTIME_STATUSES } from "@/components/match/types";
import { logError } from "@/lib/devLog";

interface UseMatchListResult {
  matches: Match[];
  pressureData: Record<number, PressureSnapshot[]>;
  lastUpdate: Date | null;
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const MAX_RETRIES = 5;

/**
 * Live match list polling. Fetches /api/matches on a tier-aware
 * interval (LITE 60s / MID 30s / FULL 15s). Handles retry with
 * exponential backoff and cleans up on unmount.
 *
 * Side effects:
 *   - On each successful fetch, POSTs /api/goal-signals with
 *     `{ action: "expireHalftime", matchCodes: [...] }` to expire
 *     halftime signals for any match in HALFTIME status.
 */
export function useMatchList(): UseMatchListResult {
  const [matches, setMatches] = useState<Match[]>([]);
  const [pressureData, setPressureData] = useState<
    Record<number, PressureSnapshot[]>
  >({});
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const { tier } = usePresence(true);

  const fetchMatches = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const resp = await fetch("/api/matches", {
        cache: "no-store",
        signal: abortRef.current.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const newMatches: Match[] = data.matches || [];
      const newPressureData: Record<number, PressureSnapshot[]> =
        data.pressureData || {};

      if (!mountedRef.current) return;

      setMatches(newMatches);
      setPressureData(newPressureData);
      setLastUpdate(new Date());
      setError(null);
      retryCountRef.current = 0;

      // Fire-and-forget: expire halftime signals
      const halftimeCodes = new Set<number>();
      for (const m of newMatches) {
        if (HALFTIME_STATUSES.has(m.status)) halftimeCodes.add(m.code);
      }
      if (halftimeCodes.size > 0) {
        fetch("/api/goal-signals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "expireHalftime",
            matchCodes: [...halftimeCodes],
          }),
        }).catch((e: unknown) => logError("useMatchList", e));
      }
    } catch (err) {
      if (!mountedRef.current) return;
      logError("useMatchList", "Fetch error:", err);
      retryCountRef.current += 1;
      if (retryCountRef.current > MAX_RETRIES) {
        setError("Sunucuya bağlanılamadı. Lütfen daha sonra tekrar deneyin.");
      } else {
        setError("Veri alınamadı. Tekrar denenecek...");
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  // Stable polling — interval never resets due to fetchMatches ref stability
  useEffect(() => {
    mountedRef.current = true;
    fetchMatches();
    intervalRef.current = setInterval(
      fetchMatches,
      tierConfig(tier).pollIntervalMs,
    );
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier]);

  const reload = useCallback(async () => {
    await fetchMatches();
  }, [fetchMatches]);

  return {
    matches,
    pressureData,
    lastUpdate,
    isLoading,
    error,
    reload,
  };
}
