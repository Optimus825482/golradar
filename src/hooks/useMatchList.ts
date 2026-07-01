"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePresence } from "@/hooks/usePresence";
import { useMatchStream } from "@/hooks/useMatchStream";
import { tierConfig } from "@/lib/tier";
import type { Match, PressureSnapshot } from "@/components/match/types";
import { HALFTIME_STATUSES } from "@/components/match/types";
import { logError, logInfo } from "@/lib/devLog";

interface UseMatchListResult {
  matches: Match[];
  pressureData: Record<number, PressureSnapshot[]>;
  lastUpdate: Date | null;
  isLoading: boolean;
  error: string | null;
  /** True when the SSE stream is the active source. */
  streaming: boolean;
  reload: () => Promise<void>;
}

const MAX_RETRIES = 3;

/**
 * Live match list with two-tier refresh:
 *
 *   1. SSE stream (preferred) — receives push notifications from
 *      /api/matches/stream. Zero polling traffic, ~100ms latency
 *      from writer refresh to client render.
 *
 *   2. Polling fallback — kicks in when SSE disconnects (3+
 *      consecutive errors). Uses the tier-aware interval but on a
 *      slower schedule (3× the normal) so the fallback doesn't
 *      recreate the storm we're avoiding.
 *
 * Side effects on each successful refresh:
 *   - POSTs /api/goal-signals with `expireHalftime` for any match
 *     in HALFTIME status.
 */
export function useMatchList(): UseMatchListResult {
  const [matches, setMatches] = useState<Match[]>([]);
  const [pressureData, setPressureData] = useState<
    Record<number, PressureSnapshot[]>
  >({});
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  // Track whether the stream has been sick enough to fall back to polling.
  const streamFailedRef = useRef(false);

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

  // SSE stream — preferred path. When connected, the polling
  // interval below is a 3× slower safety net.
  useMatchStream({
    enabled: true,
    onSnapshot: ({ matches: m, pressureData: pd, timestamp }) => {
      if (!mountedRef.current) return;
      setMatches(m);
      setPressureData(pd);
      setLastUpdate(new Date(timestamp));
      setError(null);
      setIsLoading(false);
      retryCountRef.current = 0;
      setStreaming(true);

      // Same halftime expire side-effect.
      const halftimeCodes = new Set<number>();
      for (const match of m) {
        if (HALFTIME_STATUSES.has(match.status)) halftimeCodes.add(match.code);
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
    },
    onDisconnect: () => {
      if (streamFailedRef.current) return; // already in fallback
      streamFailedRef.current = true;
      logInfo("useMatchList", "SSE stream unhealthy — switching to slow polling fallback");
      setStreaming(false);
    },
    onReconnect: () => {
      if (!streamFailedRef.current) return;
      streamFailedRef.current = false;
      logInfo("useMatchList", "SSE stream recovered — switching back to push mode");
      setStreaming(true);
    },
  });

  // Polling — when streaming, this is a 3× slower safety net that
  // doesn't actually fire (SSE delivers data faster). When the
  // stream is sick, this becomes the active refresh path.
  useEffect(() => {
    mountedRef.current = true;
    fetchMatches();
    const cfg = tierConfig(tier);
    // Slow base interval when streaming (5 minutes), full tier
    // interval when polling. This keeps the client "warm" without
    // hammering the backend.
    const effectiveIntervalMs = streamFailedRef.current
      ? cfg.pollIntervalMs * 3 // fallback: 3× slower than baseline
      : 5 * 60_000; // safety net: 5 minutes when streaming
    intervalRef.current = setInterval(fetchMatches, effectiveIntervalMs);
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, streaming]);

  const reload = useCallback(async () => {
    await fetchMatches();
  }, [fetchMatches]);

  return {
    matches,
    pressureData,
    lastUpdate,
    isLoading,
    error,
    streaming,
    reload,
  };
}
