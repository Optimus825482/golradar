"use client";

import { useCallback, useEffect, useState } from "react";

export interface DailyMetricsToday {
  signalsTotal: number;
  goalsHit: number;
  fail: number;
  pending: number;
  successRate: number;
  resolved: number;
  analyzedMatches: number;
}

export interface DailyMetricsUpcoming {
  liveNow: number;
  startsSoon: number;
  total: number;
}

export interface DailyMetricsAllTime {
  successRate: number;
  totalSignals: number;
  totalGoals: number;
}

export interface DailyMetrics {
  ok: boolean;
  today: DailyMetricsToday;
  upcoming: DailyMetricsUpcoming;
  allTime: DailyMetricsAllTime;
  date: string;
  lastUpdated: number;
}

const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

/**
 * Daily KPI strip metrics. Polls /api/daily-metrics on mount +
 * every 5 minutes. Silent on error — KPI strip degrades gracefully
 * (stale data better than no data).
 */
export function useDailyMetrics(): {
  metrics: DailyMetrics | null;
  reload: () => Promise<void>;
} {
  const [metrics, setMetrics] = useState<DailyMetrics | null>(null);

  const fetchMetrics = useCallback(async (): Promise<void> => {
    try {
      const resp = await fetch("/api/daily-metrics", { cache: "no-store" });
      if (resp.ok) {
        const data = (await resp.json()) as DailyMetrics;
        setMetrics(data);
      }
    } catch {
      // Silent — KPI strip degrades gracefully
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const dm = setInterval(fetchMetrics, POLL_INTERVAL_MS);
    return () => clearInterval(dm);
  }, [fetchMetrics]);

  const reload = useCallback(async () => {
    await fetchMetrics();
  }, [fetchMetrics]);

  return { metrics, reload };
}
