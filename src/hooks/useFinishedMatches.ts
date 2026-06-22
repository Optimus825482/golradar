"use client";

import { useCallback, useEffect, useState } from "react";
import type { Match } from "@/components/match/types";
import { logError } from "@/lib/devLog";

interface UseFinishedMatchesResult {
  matches: Match[];
  isLoading: boolean;
  error: string | null;
  reload: (date?: string) => Promise<void>;
}

const DEFAULT_DATE_FETCHER = (): string => {
  // Istanbul TZ — DST-safe via Intl
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

/**
 * Finished match list fetcher. Pulls /api/finished-matches?date=...
 * with Istanbul TZ default. No polling — historical data.
 */
export function useFinishedMatches(): UseFinishedMatchesResult {
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFinishedMatches = useCallback(
    async (date?: string): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const dateParam = date || DEFAULT_DATE_FETCHER();
        const resp = await fetch(
          `/api/finished-matches?date=${dateParam}`,
          { cache: "no-store" },
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        setMatches(data.matches || []);
      } catch (err) {
        logError("useFinishedMatches", "Fetch error:", err);
        setError("Biten maçlar yüklenemedi");
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchFinishedMatches();
  }, [fetchFinishedMatches]);

  const reload = useCallback(
    async (date?: string) => {
      await fetchFinishedMatches(date);
    },
    [fetchFinishedMatches],
  );

  return { matches, isLoading, error, reload };
}
