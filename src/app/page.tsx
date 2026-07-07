"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { buildNetscoresMapping } from "@/lib/utils";
import {
  calculateGoalProbability,
  type GoalProbability,
  type MatchStats as NesineMatchStats,
  FINISHED_STATUSES,
} from "@/lib/nesine";
import { determineSideByStats } from "@/lib/goalRadar/side";
import { parseMinute } from "@/lib/goalSignalTracker";
import type { FotMobMatchDetails } from "@/lib/fotmob";

import {
  calculateThreatIndex,
  calculateMomentumBars,
  calculateXgFlow,
  generateSyntheticSnapshots,
} from "@/lib/advancedAnalytics";
import { RADAR_THRESHOLD, SIGNAL_5MIN_THRESHOLD } from "@/config";
import SignalsCenter from "@/components/SignalsCenter";
import { usePresence } from "@/hooks/usePresence";
import { useRealtime } from "@/hooks/useRealtime";
import { tierConfig } from "@/lib/tier";
import { useGoalDetection } from "@/hooks/useGoalDetection";
import { useUpcomingMatches } from "@/hooks/useUpcomingMatches";
import { armAudioUnlock } from "@/lib/playGoalSound";

import type {
  Match,
  MatchStats,
  PressureSnapshot,
  GoalNotification,
  BottomTab,
} from "@/components/match/types";
import { HALFTIME_STATUSES } from "@/components/match/types";
import {
  calculatePressure,
  loadFavorites,
  saveFavorites,
} from "@/components/match/utils";
import {
  CountryFlag,
} from "@/components/match/shared-components";
import { MatchCard } from "@/components/match/MatchCard";
import { BottomNavBar } from "@/components/match/BottomNavBar";
import { GoalRadarSection } from "@/components/match/GoalRadarSection";
import { logError } from "@/lib/devLog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppHeader } from "@/components/AppHeader";
import { RadarAlertBanner } from "@/components/RadarAlertBanner";
import { GoalNotificationToasts } from "@/components/GoalNotificationToasts";
import { UpcomingMatchList } from "@/components/match/UpcomingMatchList";
import { DesktopDetailPanel } from "@/components/match/DesktopDetailPanel";
import { MobileDrawerPanel } from "@/components/match/MobileDrawerPanel";

// Parse minute string handling stoppage time: "45+2" → 47, "90" → 90
// Upper clamp to 120 (extra time), non-numeric input returns 45 as midpoint.
export function parseGoalMinute(minute: string | number): number {
  if (typeof minute === "number")
    return Math.max(0, Math.min(120, Math.round(minute)));
  const plusMatch = String(minute).match(/^(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) {
    return Math.min(
      120,
      parseInt(plusMatch[1], 10) + parseInt(plusMatch[2], 10),
    );
  }
  const num = parseInt(String(minute).replace(/[^0-9]/g, ""), 10);
  // Non-numeric input (e.g. "MS", "HT", ""): return 45 as midpoint default.
  // The caller (reportGoal) will use signalMinute fallback per-signal.
  return isNaN(num) ? 45 : Math.max(0, Math.min(120, num));
}

export default function OptimusGolRadariPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [pressureSnapshots, setPressureSnapshots] = useState<
    PressureSnapshot[]
  >([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BottomTab>("all");
  const [sortBy, setSortBy] = useState<"league" | "time">("league");
  const [statsHalf, setStatsHalf] = useState<"full" | "1h" | "2h">("full");
  const [allPressureData, setAllPressureData] = useState<
    Record<number, PressureSnapshot[]>
  >({});
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const notifTimersRef = useRef<Set<NodeJS.Timeout>>(new Set());
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fetchMatchesRef = useRef<(() => Promise<void>) | null>(null);
  // Retry policy: show final error after ERROR_THRESHOLD,
  // but keep retrying up to MAX_TOTAL_RETRIES (the +3 extension).
  const ERROR_THRESHOLD = 5;
  const MAX_TOTAL_RETRIES = 8;

  // Favorites
  const [favorites, setFavorites] = useState<Set<number>>(new Set());

  // Goal detection (flash + notifications + prevGoals)
  const {
    goalFlashMap,
    goalNotifications,
    prevGoalsRef,
    addGoalNotification,
    clearGoalNotification,
  } = useGoalDetection();
  // Read current prev goals through the ref (avoids stale snapshot between renders)
  const prevGoals = prevGoalsRef.current;

  // NetScores integration (replaces FotMob)
  const [fotmobData, setFotmobData] = useState<FotMobMatchDetails | null>(null);
  const [fotmobLoading, setFotmobLoading] = useState(false);
  const [netscoresMapping, setNetscoresMapping] = useState<
    Record<number, string>
  >({});
  const [fotmobTab, _setFotmobTab] = useState<"events" | "stats" | "info">(
    "stats",
  );

  // Finished matches
  const [finishedMatches, setFinishedMatches] = useState<Match[]>([]);
  const [finishedLoading, setFinishedLoading] = useState(false);
  const [_finishedError, setFinishedError] = useState<string | null>(null);
  const [finishedDate, setFinishedDate] = useState<string>("");
  const [finishedNetscoresMapping, setFinishedNetscoresMapping] = useState<
    Record<number, string>
  >({});

  // ── Upcoming matches from Nesine prebulten ──
  const upcomingList = useUpcomingMatches(3);

  // Scoremer integration for finished matches
  const [scoremerStats, setScoremerStats] = useState<Record<
    string,
    { home: number | null; away: number | null }
  > | null>(null);
  const [scoremerHtStats, setScoremerHtStats] = useState<Record<
    string,
    { home: number | null; away: number | null }
  > | null>(null);
  const [scoremerLoading, setScoremerLoading] = useState(false);
  const [scoremerMapping, setScoremerMapping] = useState<
    Record<number, string>
  >({});
  const [scoremerHtScore, setScoremerHtScore] = useState<string | null>(null);

  // Goaloo odds movement for live matches
  const [goalooOddsMovement, setGoalooOddsMovement] = useState<{
    homeBoost: number;
    awayBoost: number;
    significance: string;
  } | null>(null);

  // Goaloo match ID mapping (Nesine code → Goaloo matchId)
  const [goalooMatchIdMap, setGoalooMatchIdMap] = useState<
    Record<number, number>
  >({});

  // Panel open state (drawer on mobile, sheet on desktop)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeChartTab, setActiveChartTab] = useState<string>("pressure");
  const isMobile = useIsMobile();

  // Load favorites on mount (after hydration to avoid mismatch)
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setFavorites(loadFavorites());
      // Istanbul date — use Intl for DST-safe TZ conversion
      const istanbulDateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      setFinishedDate(istanbulDateStr);
      setFavoritesLoaded(true);
    }, 0);
    // Arm audio unlock so the FIRST goal-sound chime isn't blocked by
    // browser autoplay policies. Detaches itself after the first gesture.
    armAudioUnlock();
    return () => clearTimeout(timeout);
  }, []);

  const toggleFavorite = useCallback(
    (matchCode: number, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(matchCode)) next.delete(matchCode);
        else next.add(matchCode);
        saveFavorites(next);
        return next;
      });
    },
    [],
  );

  // Refs to break stale closure cycles
  const selectedMatchRef = useRef<Match | null>(null);
  const matchesRef = useRef<Match[]>([]);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    selectedMatchRef.current = selectedMatch;
  }, [selectedMatch]);
  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Presence: track active users for tier-aware polling cadence
  const { tier } = usePresence(true);

  // Stable fetchMatches — no state deps to prevent interval reset loop
  const fetchMatches = useCallback(async () => {
    try {
      const resp = await fetch("/api/matches", { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const newMatches: Match[] = data.matches || [];
      const newPressureData: Record<number, PressureSnapshot[]> =
        data.pressureData || {};

      setMatches(newMatches);

      // Prune pressure data for finished matches to prevent memory leak
      const finishedCodes = new Set<number>();
      for (const m of newMatches) {
        if (FINISHED_STATUSES.has(m.status)) finishedCodes.add(m.code);
      }
      const selectedCode = selectedMatchRef.current?.code;
      if (finishedCodes.size > 0) {
        const pruned: Record<number, PressureSnapshot[]> = {};
        for (const [codeStr, snaps] of Object.entries(newPressureData)) {
          const code = Number(codeStr);
          // Keep if match is not finished OR it's the currently selected match
          if (!finishedCodes.has(code) || code === selectedCode) {
            pruned[code] = snaps;
          }
        }
        setAllPressureData(pruned);
      } else {
        setAllPressureData(newPressureData);
      }

      setLastUpdate(new Date());
      setError(null);
      retryCountRef.current = 0;

      // Expire halftime signals (fire-and-forget)
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
        }).catch((e) => {
          logError("page", e);
        });
      }

      // Update pressure snapshots for currently selected match (via ref, not state)
      const currentSelected = selectedMatchRef.current;
      if (currentSelected && newPressureData[currentSelected.code]) {
        const updatedMatch = newMatches.find(
          (m: Match) => m.code === currentSelected.code,
        );
        const isHalftime = updatedMatch
          ? HALFTIME_STATUSES.has(updatedMatch.status)
          : false;
        if (!isHalftime) {
          setPressureSnapshots(newPressureData[currentSelected.code]);
        }
      }

      // Update selected match data if still selected
      setSelectedMatch((prev) => {
        if (!prev) return prev;
        const updated = newMatches.find((m: Match) => m.code === prev.code);
        return updated || prev;
      });

      setIsLoading(false);
    } catch (err) {
      logError("page", "Fetch error:", err);
      retryCountRef.current += 1;
      if (matchesRef.current.length === 0) {
        if (retryCountRef.current > ERROR_THRESHOLD) {
          setError("Sunucuya bağlanılamadı. Lütfen daha sonra tekrar deneyin.");
        } else {
          setError("Veri alınamadı. Tekrar denenecek...");
        }
      }
      setIsLoading(false);
      // +3 extension: keep retrying beyond ERROR_THRESHOLD up to MAX_TOTAL_RETRIES
      if (retryCountRef.current <= MAX_TOTAL_RETRIES && mountedRef.current) {
        const delay = Math.min(
          3000 * Math.pow(2, Math.min(retryCountRef.current - 1, 5)),
          120000,
        );
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          if (mountedRef.current) void fetchMatchesRef.current?.();
        }, delay);
      }
    }
  }, []); // Stable: no state deps, uses refs for latest values

  useEffect(() => {
    fetchMatchesRef.current = fetchMatches;
  }, [fetchMatches]);

  // Stable polling — interval never resets due to fetchMatches reference stability
  useEffect(() => {
    const initialFetchTimeout = setTimeout(() => {
      void fetchMatches();
    }, 0);
    intervalRef.current = setInterval(
      fetchMatches,
      tierConfig(tier).pollIntervalMs,
    );
    return () => {
      clearTimeout(initialFetchTimeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Clean up retry timeout
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      // Clean up any pending notification timeouts
      for (const t of notifTimersRef.current) clearTimeout(t);
      notifTimersRef.current.clear();
    };
  }, [fetchMatches, tier]);

  // Notification izni iste (favori gollerinde push bildirimi icin)
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // WebSocket real-time — push server'dan gelen veri ile state guncelle
  // WS bagliyken HTTP poll yine calisir ama WS verisi daha guncel oldugu icin
  // UI WS verisi ile guncellenir. WS kesilince HTTP poll devreye girer.
  const { connected: wsConnected, wsData } = useRealtime();

  // WS'den gelen matches verisi varsa, mevcut matches state'ini guncelle
  // (sadece canli maclarin goalRadar/skor bilgileri WS uzerinden gelir)
  useEffect(() => {
    if (!wsData?.matches || !Array.isArray(wsData.matches)) return;

    // Timestamp guard: WS verisi poll verisinden daha eskiyse uygulama
    if (
      wsData.timestamp &&
      lastUpdate &&
      wsData.timestamp <= lastUpdate.getTime()
    )
      return;

    const timeout = setTimeout(() => {
      setMatches((prev) => {
        if (!prev || prev.length === 0) return prev;
        const wsMap = new Map(
          wsData.matches.map((m: Partial<Match> & { code: number }) => [
            m.code,
            m,
          ]),
        );

        return prev.map((m) => {
          const ws = wsMap.get(m.code);
          if (!ws) return m;
          // WS verisi varsa goalRadar, skor, dakika bilgilerini guncelle
          return {
            ...m,
            homeGoals: ws.homeGoals ?? m.homeGoals,
            awayGoals: ws.awayGoals ?? m.awayGoals,
            minute: ws.minute ?? m.minute,
            status: ws.status ?? m.status,
            statusText: ws.statusText ?? m.statusText,
            goalRadar: ws.goalRadar ?? m.goalRadar,
            stats: ws.stats ?? m.stats,
            firstHalfScore: ws.firstHalfScore ?? m.firstHalfScore,
          };
        });
      });

      if (wsData.timestamp) {
        setLastUpdate(new Date(wsData.timestamp));
      }
    }, 0);
    return () => clearTimeout(timeout);
  }, [lastUpdate, wsData]);

  // Bottom tab change handler
  const handleTabChange = useCallback((tab: BottomTab | "signal-history") => {
    setActiveTab(tab as BottomTab);
    setSelectedMatch(null);
    setDrawerOpen(false);
  }, []);

  // Close match handler — also used by drawer onOpenChange
  const handleCloseMatch = useCallback(() => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedMatch(null), 300);
  }, []);

  // Build NetScores mapping when matches change
  useEffect(() => {
    if (matches.length === 0) return;
    buildNetscoresMapping(
      matches.map((m) => ({
        code: m.code,
        home: m.home,
        away: m.away,
        time: m.time,
      })),
    )
      .then(setNetscoresMapping)
      .catch((e) => {
        logError("page", e);
      });
  }, [matches]);

  const fetchNetScoresDetails = useCallback(
    async (match: Match, mapping?: Record<number, string>) => {
      setFotmobData(null);
      setFotmobLoading(true);
      const mappingToUse = mapping || netscoresMapping;
      try {
        const netscoresUrl = mappingToUse[match.code];
        const params = new URLSearchParams({
          action: "details",
          matchCode: String(match.code),
          home: match.home,
          away: match.away,
          time: match.time,
        });
        if (netscoresUrl) params.set("url", netscoresUrl);
        const resp = await fetch(`/api/netscores?${params.toString()}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.details) {
            setFotmobData(data.details);
            if (data.netscoresUrl && !mappingToUse[match.code]) {
              setNetscoresMapping((prev) => ({
                ...prev,
                [match.code]: data.netscoresUrl,
              }));
            }
            setFotmobLoading(false);
            return;
          }
        }
      } catch (err) {
        logError("page", "NetScores fetch error:", err);
      }
      setFotmobLoading(false);
    },
    [netscoresMapping],
  );

  // Fetch finished matches
  const fetchFinishedMatches = useCallback(
    async (date?: string) => {
      setFinishedLoading(true);
      setFinishedError(null);
      try {
        const dateParam = date || finishedDate;
        const resp = await fetch(`/api/finished-matches?date=${dateParam}`, {
          cache: "no-store",
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        setFinishedMatches(data.matches || []);
      } catch (err) {
        logError("page", "Finished matches fetch error:", err);
        setFinishedError("Biten maçlar yüklenemedi");
      }
      setFinishedLoading(false);
    },
    [finishedDate],
  );

  // Build NetScores mapping for finished matches
  useEffect(() => {
    if (finishedMatches.length === 0) return;
    buildNetscoresMapping(
      finishedMatches.map((m) => ({
        code: m.code,
        home: m.home,
        away: m.away,
        time: m.time,
      })),
    )
      .then(setFinishedNetscoresMapping)
      .catch((e) => {
        logError("page", e);
      });
  }, [finishedMatches]);

  // Build Scoremer mapping for finished matches
  useEffect(() => {
    if (finishedMatches.length === 0) return;
    const buildScoremerMappingFn = async () => {
      try {
        const matchList = finishedMatches.map((m) => ({
          code: m.code,
          home: m.home,
          away: m.away,
          time: m.time,
        }));
        const resp = await fetch("/api/scoremer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mapping", matches: matchList }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const map: Record<number, string> = {};
          for (const m of data.mappings || []) {
            map[m.nesineCode] = m.scoremerId;
          }
          setScoremerMapping(map);
        }
      } catch (e) {
        logError("page", e);
      }
    };
    buildScoremerMappingFn();
  }, [finishedMatches]);

  // Fetch Scoremer stats for a match
  const fetchScoremerDetails = useCallback(
    async (match: Match) => {
      setScoremerStats(null);
      setScoremerHtStats(null);
      setScoremerHtScore(null);
      setScoremerLoading(true);
      try {
        const scoremerId = scoremerMapping[match.code];
        const params = new URLSearchParams({
          action: "details",
          matchCode: String(match.code),
          home: match.home,
          away: match.away,
          time: match.time,
        });
        if (scoremerId) params.set("scoremerId", scoremerId);
        const resp = await fetch(`/api/scoremer?${params.toString()}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.stats) {
            setScoremerStats(data.stats);
            setScoremerHtStats(data.htStats || null);
            if (data.htScore) setScoremerHtScore(data.htScore);
            if (data.scoremerId && !scoremerMapping[match.code]) {
              setScoremerMapping((prev) => ({
                ...prev,
                [match.code]: data.scoremerId,
              }));
            }
          }
        }
      } catch (err) {
        logError("page", "Scoremer fetch error:", err);
      }
      setScoremerLoading(false);
    },
    [scoremerMapping],
  );

  const handleSelectMatch = useCallback(
    (match: Match) => {
      setSelectedMatch(match);
      setStatsHalf("full");
      setPressureSnapshots(allPressureData[match.code] || []);
      setDrawerOpen(true);
      setScoremerStats(null);
      setScoremerHtStats(null);
      setScoremerHtScore(null);
      setGoalooOddsMovement(null);
      const mapping = match.isFinished
        ? finishedNetscoresMapping
        : netscoresMapping;
      fetchNetScoresDetails(match, mapping);
      if (match.isFinished) fetchScoremerDetails(match);

      const cachedGoalooId = goalooMatchIdMap[match.code];
      if (cachedGoalooId) {
        fetch(`/api/goaloo?action=oddsMovement&matchId=${cachedGoalooId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data && data.significance && data.significance !== "none") {
              setGoalooOddsMovement({
                homeBoost: data.homeBoost || 0,
                awayBoost: data.awayBoost || 0,
                significance: data.significance,
              });
            }
          })
          .catch((e) => {
            logError("page", e);
          });
      } else {
        const matchDate = match.isFinished
          ? finishedDate || new Date().toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        fetch(
          `/api/goaloo?action=resolve&home=${encodeURIComponent(match.home)}&away=${encodeURIComponent(match.away)}&date=${matchDate}&time=${match.time || ""}`,
        )
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data && data.found && data.goalooMatchId) {
              setGoalooMatchIdMap((prev) => ({
                ...prev,
                [match.code]: data.goalooMatchId,
              }));
              fetch(
                `/api/goaloo?action=oddsMovement&matchId=${data.goalooMatchId}`,
              )
                .then((r) => (r.ok ? r.json() : null))
                .then((odata) => {
                  if (
                    odata &&
                    odata.significance &&
                    odata.significance !== "none"
                  ) {
                    setGoalooOddsMovement({
                      homeBoost: odata.homeBoost || 0,
                      awayBoost: odata.awayBoost || 0,
                      significance: odata.significance,
                    });
                  }
                })
                .catch((e) => {
                  logError("page", e);
                });
            }
          })
          .catch((e) => {
            logError("page", e);
          });
      }
    },
    [
      allPressureData,
      netscoresMapping,
      finishedNetscoresMapping,
      fetchScoremerDetails,
      goalooMatchIdMap,
      finishedDate,
    ],
  );

  // Fetch finished matches on mount (for detail view when needed)
  useEffect(() => {
    if (
      matches.length === 0 &&
      finishedMatches.length === 0 &&
      !finishedLoading
    ) {
      const timeout = setTimeout(() => {
        void fetchFinishedMatches();
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [
    matches.length,
    finishedMatches.length,
    fetchFinishedMatches,
    finishedLoading,
  ]);

  // ── Goal Detection ─────────────────────────────────────────────
  // Compares current scores with prevGoalsRef to detect goals.
  // After processing, updates prevGoalsRef so the next poll sees
  // the delta correctly. The sync effect was removed because it ran
  // BEFORE this effect, making prev == current → no diff detected.
  useEffect(() => {
    const now = Date.now();

    for (const m of matches) {
      const prev = prevGoals[m.code];
      if (!prev) continue;

      const homeScored = m.homeGoals > prev.home;
      const awayScored = m.awayGoals > prev.away;

      if (homeScored || awayScored) {
        // Report each goal side independently via API
        if (homeScored) {
          fetch("/api/goal-signals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "reportGoal",
              matchCode: m.code,
              goalSide: "home",
              goalMinute: parseGoalMinute(m.minute),
            }),
          }).catch((e) => {
            logError("page", e);
          });
        }
        if (awayScored) {
          fetch("/api/goal-signals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "reportGoal",
              matchCode: m.code,
              goalSide: "away",
              goalMinute: parseGoalMinute(m.minute),
            }),
          }).catch((e) => {
            logError("page", e);
          });
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("goal-scored", { detail: { matchCode: m.code } }),
          );
        }

        if (favorites.has(m.code)) {
          const notification: GoalNotification = {
            id: `${m.code}-${now}`,
            matchCode: m.code,
            home: m.home,
            away: m.away,
            homeGoals: m.homeGoals,
            awayGoals: m.awayGoals,
            scoringTeam: homeScored ? "home" : "away",
            league: m.league,
            minute: m.minute,
            timestamp: now,
          };
          addGoalNotification(notification);

          // Browser push notification (izin varsa)
          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            const scorer = homeScored ? m.home : m.away;
            const opponent = homeScored ? m.away : m.home;
            try {
              // Permission might have been revoked after initial grant
              if (Notification.permission !== "granted") {
                /* skip */
              } else {
                new Notification(`⚽ Gol! ${scorer}`, {
                  body: `${scorer} ${m.homeGoals}-${m.awayGoals} ${opponent} · ${m.league}`,
                  icon: "/logo-192.png",
                  tag: `goal-${m.code}`,
                  silent: true,
                });
              }
            } catch (e) {
              logError("page", "Notification error:", e);
            }
          }

          const timer = setTimeout(() => {
            clearGoalNotification(notification.id);
            notifTimersRef.current.delete(timer);
          }, 8000);
          notifTimersRef.current.add(timer);
        }
      }

      // When match ends, finalize all pending signals for this match
      if (
        FINISHED_STATUSES.has(m.status) &&
        !FINISHED_STATUSES.has(prev.status)
      ) {
        fetch(
          `/api/goal-signals?action=finalize&matchCode=${m.code}&homeScore=${m.homeGoals}&awayScore=${m.awayGoals}`,
        ).catch((e) => {
          logError("page", e);
        });
      }
    }

    // ── Update prevGoalsRef for next poll ─────────────────────
    // Must happen AFTER detection so the next poll sees a proper delta.
    // Without this, the Sync effect (previously at line 491) was writing
    // CURRENT scores to prev BEFORE detection, making prev == current
    // and hiding every goal.
    for (const m of matches) {
      const cur = prevGoalsRef.current[m.code];
      if (cur) {
        cur.home = m.homeGoals;
        cur.away = m.awayGoals;
        cur.status = m.status;
      } else {
        prevGoalsRef.current[m.code] = {
          home: m.homeGoals,
          away: m.awayGoals,
          status: m.status,
        };
      }
    }
  }, [matches, favorites]);

  // Goal probabilities — tüm canlı maçlar için hesapla
  const goalProbabilities = useMemo(() => {
    const map = new Map<number, GoalProbability>();
    for (const m of matches) {
      if (!m.isLive || !m.hasStats || HALFTIME_STATUSES.has(m.status)) continue;
      // Server goalRadar varsa ve maç hala canlıysa kullan
      let prob: GoalProbability | undefined;
      if (m.goalRadar) {
        prob = m.goalRadar;
      } else {
        const history = allPressureData[m.code];
        // Eger bu maç seçili maçsa ve Goaloo odds movement varsa kullan
        const oddsBoost = selectedMatch?.code === m.code ? goalooOddsMovement : undefined;
        prob = calculateGoalProbability(
          m.stats,
          m.minute,
          m.isLive,
          history,
          m.homeGoals,
          m.awayGoals,
          m.home,
          m.away,
          oddsBoost,
        );
      }
      if (!prob) continue;
      // Side kontrolü: null ise determineSideByStats ile dene
      if (!prob.side) {
        try {
          const fallbackSide = determineSideByStats(m.stats);
          if (fallbackSide) {
            prob = { ...prob, side: fallbackSide };
          } else {
            continue;
          }
        } catch {
          continue;
        }
      }
      map.set(m.code, prob);
    }
    return map;
  }, [matches, allPressureData, goalooOddsMovement, selectedMatch]);

  // Signal posting — isolated in its own effect so fetch calls don't
  // fire inside a useMemo (React anti-pattern). A ref tracks which
  // match+side+minute combos have already been posted to prevent
  // duplicate signals on re-render.
  const postedSignalsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const posted = postedSignalsRef.current;
    for (const [code, prob] of goalProbabilities) {
      if (!prob || !prob.side) continue;
      // FIX: side='both' sinyallerini gecir — algoritma hangi takimdan
      // gol geleceginden emin degil ama gol olacagini dusunuyor demektir.
      // Sinyal kaybi yasanmasin. Dedup key'de side='both' kullanilir.
      const m = matches.find((x) => x.code === code);
      if (!m) continue;

      // ── Minute-based signal gate ─────────────────────────────
      // Block signals during 3 blind windows:
      // 1) First 5 min of match (min < 5)
      // 2) First half 43 → HT (43-45 + 45+N stoppage)
      // 3) Minute 88 → final whistle (88+, includes 90+N)
      // Override: Goaloo critical odds movement varsa blind window'da gec
      const minuteNum = parseGoalMinute(m.minute);
      const rawMin = String(m.minute);
      const goalooOverride = selectedMatch?.code === code && goalooOddsMovement?.significance === "critical";
      const isBlocked = !goalooOverride && (
        minuteNum < 5 ||
        minuteNum >= 88 ||
        (minuteNum >= 43 &&
          (minuteNum <= 45 || /^45\s*\+/.test(rawMin)))
      );
      if (isBlocked) continue;

      const signalKey = `${code}:${prob.side}:${minuteNum}`;
      if (posted.has(signalKey)) continue;
      posted.add(signalKey);
      fetch("/api/goal-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchCode: code,
          homeTeam: m.home,
          awayTeam: m.away,
          league: m.league,
          matchTime: m.time,
          minute: m.minute,
          score: prob.score,
          side: prob.side,
          homeGoals: m.homeGoals,
          awayGoals: m.awayGoals,
          homeScore: prob.homeScore,
          awayScore: prob.awayScore,
          level: prob.level,
          factors: prob.factors,
          calibratedP: prob.calibratedP,
          poissonP: prob.poissonP,
          // Faz A4 N-of-M — propagated end-to-end from
          // /api/matches → goalProbabilities → here. Default 1
          // for backward compatibility with cached/legacy data.
          modelAgreement: prob.modelAgreementCount ?? 1,
        }),
      }).catch((e) => {
        logError("page", e);
      });
    }
    // Keep set from growing unbounded — cap at 500 entries
    // Keep most RECENT 300 entries (not oldest) for dedup effectiveness
    if (posted.size > 500) {
      const arr = Array.from(posted);
      postedSignalsRef.current = new Set(arr.slice(-300));
    }
  }, [goalProbabilities, matches, goalooOddsMovement, selectedMatch]);

  const radarCount = useMemo(() => {
    let count = 0;
    for (const [, prob] of goalProbabilities) {
      if (
        prob.score >= RADAR_THRESHOLD &&
        prob.goalProbability5min >= SIGNAL_5MIN_THRESHOLD
      )
        count++;
    }
    return count;
  }, [goalProbabilities]);

  // Filter matches based on bottom tab
  const filteredMatches = useMemo(() => {
    if (activeTab === "live") return matches.filter((m) => m.isLive);
    if (activeTab === "radar")
      return matches.filter(
        (m) => (goalProbabilities.get(m.code)?.score || 0) >= RADAR_THRESHOLD,
      );
    if (activeTab === "favorites")
      return matches.filter((m) => favorites.has(m.code));
    // "all" tab: exclude upcoming (shown separately above)
    return matches.filter((m) => !m.isUpcoming);
  }, [matches, activeTab, goalProbabilities, favorites]);

  const upcomingMatches = useMemo(() => {
    if (activeTab !== "all") return [];
    return upcomingList;
  }, [activeTab, upcomingList]);

  const favCount = matches.filter((m) => favorites.has(m.code)).length;
  const liveCount = matches.filter((m) => m.isLive).length;

  // Sort & group matches
  const groupedMatches = useMemo(() => {
    if (sortBy === "league") {
      const groups: Record<string, Match[]> = {};
      for (const m of filteredMatches) {
        if (!groups[m.league]) groups[m.league] = [];
        groups[m.league].push(m);
      }
      return { mode: "league" as const, groups };
    } else {
      // "Zamana göre" = maç dakikasına göre AZALAN (en ileri → en geri).
      // parseMinute("90+5") → 95, "11'" → 11; 95 > 11 → 90+5 önce gelir.
      const sorted = [...filteredMatches].sort((a, b) => {
        const aMin = parseMinute(a.minute);
        const bMin = parseMinute(b.minute);
        if (aMin !== bMin) return bMin - aMin;
        return a.league.localeCompare(b.league, "tr");
      });
      return { mode: "time" as const, flat: sorted };
    }
  }, [filteredMatches, sortBy]);

  // Half-filtered snapshots
  const halftimeIdx = useMemo(() => {
    const snaps = pressureSnapshots;
    if (!snaps || snaps.length === 0) return -1;
    for (let i = 1; i < snaps.length; i++) {
      const prevMin = snaps[i - 1].minute;
      const curMin = snaps[i].minute;
      const prevNum = parseInt(prevMin.replace(/[^0-9]/g, ""), 10) || 0;
      const curNum = parseInt(curMin.replace(/[^0-9]/g, ""), 10) || 0;
      if (
        prevNum <= 45 &&
        (/^(?:DA|HT|Devre|Half)/i.test(curMin) || curNum >= 46)
      )
        return i - 1;
    }
    return -1;
  }, [pressureSnapshots]);

  const filteredSnapshots = useMemo(() => {
    if (
      statsHalf === "full" ||
      !pressureSnapshots ||
      pressureSnapshots.length === 0
    )
      return pressureSnapshots;
    if (statsHalf === "1h")
      return halftimeIdx === -1
        ? pressureSnapshots
        : pressureSnapshots.slice(0, halftimeIdx + 1);
    if (statsHalf === "2h")
      return halftimeIdx === -1 ? [] : pressureSnapshots.slice(halftimeIdx + 1);
    return pressureSnapshots;
  }, [pressureSnapshots, statsHalf, halftimeIdx]);

  const pressureChartData = useMemo(() => {
    return filteredSnapshots.map((snap, idx) => ({
      index: idx + 1,
      minute: snap.minute || `${idx + 1}`,
      homePressure: snap.homePressure,
      awayPressure: snap.awayPressure,
    }));
  }, [filteredSnapshots]);

  const statsChartData = useMemo(() => {
    if (statsHalf === "2h" && halftimeIdx >= 0) {
      const htStats = pressureSnapshots[halftimeIdx].stats;
      return filteredSnapshots.map((snap, idx) => ({
        index: idx + 1,
        minute: snap.minute || `${idx + 1}`,
        homeDangerousAttacks:
          (snap.stats.dangerous_attacks?.home ?? 0) -
          (htStats.dangerous_attacks?.home ?? 0),
        awayDangerousAttacks:
          (snap.stats.dangerous_attacks?.away ?? 0) -
          (htStats.dangerous_attacks?.away ?? 0),
        homeShotsTotal:
          (snap.stats.shots_total?.home ?? 0) -
          (htStats.shots_total?.home ?? 0),
        awayShotsTotal:
          (snap.stats.shots_total?.away ?? 0) -
          (htStats.shots_total?.away ?? 0),
        homeCorners:
          (snap.stats.corners?.home ?? 0) - (htStats.corners?.home ?? 0),
        awayCorners:
          (snap.stats.corners?.away ?? 0) - (htStats.corners?.away ?? 0),
        homePossession: snap.stats.possession?.home ?? 0,
        awayPossession: snap.stats.possession?.away ?? 0,
      }));
    }
    return filteredSnapshots.map((snap, idx) => ({
      index: idx + 1,
      minute: snap.minute || `${idx + 1}`,
      homeDangerousAttacks: snap.stats.dangerous_attacks?.home ?? 0,
      awayDangerousAttacks: snap.stats.dangerous_attacks?.away ?? 0,
      homeShotsTotal: snap.stats.shots_total?.home ?? 0,
      awayShotsTotal: snap.stats.shots_total?.away ?? 0,
      homeCorners: snap.stats.corners?.home ?? 0,
      awayCorners: snap.stats.corners?.away ?? 0,
      homePossession: snap.stats.possession?.home ?? 0,
      awayPossession: snap.stats.possession?.away ?? 0,
    }));
  }, [filteredSnapshots, statsHalf, halftimeIdx, pressureSnapshots]);

  const currentPressure = selectedMatch
    ? calculatePressure(selectedMatch.stats)
    : { home: 50, away: 50 };

  // Synthetic snapshots from Scoremer data
  const syntheticSnapshots = useMemo(() => {
    if (!selectedMatch) return [];
    if (pressureSnapshots.length >= 10) return [];
    if (!scoremerStats || Object.keys(scoremerStats).length === 0) return [];
    const effectiveHtScore =
      selectedMatch.firstHalfScore && selectedMatch.firstHalfScore !== "-"
        ? selectedMatch.firstHalfScore
        : scoremerHtScore || undefined;
    return generateSyntheticSnapshots(
      scoremerStats as NesineMatchStats,
      scoremerHtStats as NesineMatchStats,
      selectedMatch.homeGoals,
      selectedMatch.awayGoals,
      effectiveHtScore,
    );
  }, [
    selectedMatch,
    pressureSnapshots.length,
    scoremerStats,
    scoremerHtStats,
    scoremerHtScore,
  ]);

  // Merge real + synthetic snapshots
  const mergedSnapshots = useMemo(() => {
    if (syntheticSnapshots.length === 0) return pressureSnapshots;
    if (pressureSnapshots.length < 2) return syntheticSnapshots;
    const realByMinute = new Map<number, (typeof pressureSnapshots)[0]>();
    for (const snap of pressureSnapshots) {
      const min = parseInt(snap.minute.replace(/[^0-9]/g, ""), 10) || 0;
      realByMinute.set(min, snap);
    }
    const merged = [...syntheticSnapshots];
    for (let i = 0; i < merged.length; i++) {
      const min = parseInt(merged[i].minute.replace(/[^0-9]/g, ""), 10) || 0;
      for (const [realMin, realSnap] of realByMinute) {
        if (Math.abs(realMin - min) <= 3) {
          merged[i] = realSnap;
          realByMinute.delete(realMin);
          break;
        }
      }
    }
    for (const [, snap] of realByMinute) merged.push(snap);
    merged.sort((a, b) => {
      const ma = parseInt(a.minute.replace(/[^0-9]/g, ""), 10) || 0;
      const mb = parseInt(b.minute.replace(/[^0-9]/g, ""), 10) || 0;
      return ma - mb;
    });
    return merged;
  }, [pressureSnapshots, syntheticSnapshots]);

  // Advanced Analytics
  const momentumBars = useMemo(() => {
    if (!selectedMatch) return [];
    const snaps =
      mergedSnapshots.length >= 2 ? mergedSnapshots : pressureSnapshots;
    if (snaps.length < 2) return [];
    return calculateMomentumBars(snaps);
  }, [selectedMatch, pressureSnapshots, mergedSnapshots]);

  const xgFlowData = useMemo(() => {
    if (!selectedMatch) return [];
    const snaps =
      mergedSnapshots.length >= 1 ? mergedSnapshots : pressureSnapshots;
    if (snaps.length < 1) return [];
    return calculateXgFlow(snaps);
  }, [selectedMatch, pressureSnapshots, mergedSnapshots]);

  const threatIndex = useMemo(() => {
    if (!selectedMatch || !selectedMatch.isLive || !selectedMatch.hasStats)
      return null;
    const goalooTrend = goalooOddsMovement?.significance === "critical"
      ? { homeAvg: 65, awayAvg: 65 }
      : goalooOddsMovement?.significance === "high"
        ? { homeAvg: 55, awayAvg: 55 }
        : undefined;
    return calculateThreatIndex(
      selectedMatch.stats,
      selectedMatch.minute,
      pressureSnapshots,
      goalooTrend,
    );
  }, [selectedMatch, pressureSnapshots, goalooOddsMovement]);

  // Half-filtered stats
  const filteredStats = useMemo(() => {
    if (!selectedMatch || statsHalf === "full")
      return selectedMatch?.stats || {};
    const snapshots = pressureSnapshots;
    if (!snapshots || snapshots.length === 0) return selectedMatch.stats;
    if (statsHalf === "1h")
      return halftimeIdx === -1
        ? selectedMatch.stats
        : snapshots[halftimeIdx].stats;
    if (statsHalf === "2h") {
      if (halftimeIdx === -1) {
        const empty = {} as NesineMatchStats;
        for (const key of Object.keys(selectedMatch.stats))
          empty[key] = { home: 0, away: 0 };
        return empty;
      }
      const htStats = snapshots[halftimeIdx].stats;
      const currentStats = selectedMatch.stats;
      const secondHalfStats = {} as NesineMatchStats;
      for (const key of Object.keys(currentStats)) {
        const cur = currentStats[key];
        const ht = htStats[key];
        if (cur && ht) {
          if (key === "possession") {
            secondHalfStats[key] = cur;
          } else {
            const homeDiff = (cur.home ?? 0) - (ht.home ?? 0);
            const awayDiff = (cur.away ?? 0) - (ht.away ?? 0);
            secondHalfStats[key] = {
              home: homeDiff > 0 ? homeDiff : 0,
              away: awayDiff > 0 ? awayDiff : 0,
            };
          }
        } else if (cur) {
          secondHalfStats[key] = cur;
        }
      }
      return secondHalfStats;
    }
    return selectedMatch.stats;
  }, [selectedMatch, statsHalf, pressureSnapshots, halftimeIdx]);

  // Client-side goal prob for detail panel
  const selectedGoalProb = useMemo(() => {
    if (!selectedMatch) return null;
    const serverRadar = selectedMatch.goalRadar;
    const clientCalc = calculateGoalProbability(
      selectedMatch.stats,
      selectedMatch.minute,
      selectedMatch.isLive,
      pressureSnapshots,
      selectedMatch.homeGoals,
      selectedMatch.awayGoals,
      selectedMatch.home,
      selectedMatch.away,
      goalooOddsMovement,
    );
    if (
      serverRadar &&
      clientCalc.score < serverRadar.score &&
      pressureSnapshots.length < 3
    )
      return serverRadar;
    return clientCalc.score >= RADAR_THRESHOLD &&
      clientCalc.goalProbability5min >= SIGNAL_5MIN_THRESHOLD
      ? clientCalc
      : serverRadar || null;
  }, [selectedMatch, pressureSnapshots, goalooOddsMovement]);

  // Detail content props shared between desktop and mobile
  const detailProps = useMemo(
    () =>
      selectedMatch
        ? {
            match: selectedMatch,
            currentPressure,
            selectedGoalProb,
            pressureChartData,
            statsChartData,
            momentumBars,
            xgFlowData,
            threatIndex,
            filteredStats,
            statsHalf,
            setStatsHalf,
            fotmobData,
            fotmobLoading,
            scoremerStats,
            scoremerHtStats,
            scoremerLoading,
            goalooMatchId: goalooMatchIdMap[selectedMatch.code] || 0,
            activeChartTab,
            setActiveChartTab,
            fotmobTab,
          }
        : null,
    [
      selectedMatch,
      currentPressure,
      selectedGoalProb,
      pressureChartData,
      statsChartData,
      momentumBars,
      xgFlowData,
      threatIndex,
      filteredStats,
      statsHalf,
      fotmobData,
      fotmobLoading,
      scoremerStats,
      scoremerHtStats,
      scoremerLoading,
      goalooMatchIdMap,
      selectedMatch?.code ?? 0,
      activeChartTab,
      fotmobTab,
    ],
  );

  // Render match list based on sort mode
  const renderMatchList = () => {
    if (activeTab === "signal-history") {
      return (
        <SignalsCenter
          matches={matches}
          onSelectMatch={(m) => handleSelectMatch(m)}
        />
      );
    }

    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full mb-4" />
          <p className="text-gray-500 text-sm">Maçlar yükleniyor...</p>
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="text-5xl mb-4">📡</div>
          <p className="text-red-500 text-sm mb-2">{error}</p>
          <button
            onClick={fetchMatches}
            className="text-emerald-600 text-sm underline hover:no-underline"
          >
            Tekrar dene
          </button>
          <button
            onClick={() => setActiveTab("signal-history")}
            className="text-indigo-600 text-sm underline hover:no-underline mt-2"
          >
            Sinyallere göz at →
          </button>
        </div>
      );
    }
    if (filteredMatches.length === 0 && activeTab !== "all") {
      const tab = activeTab as BottomTab;
      const tabLabel =
        tab === "live"
          ? "canlı"
          : tab === "radar"
            ? "radar"
            : tab === "favorites"
              ? "favori"
              : tab === "signal-history"
                ? "sinyal"
                : "";
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="text-5xl mb-4">⚽</div>
          <p className="text-gray-500 text-sm mb-3">Şu an {tabLabel} maç yok</p>
          {tab !== "signal-history" && (
            <button
              onClick={() => setActiveTab("signal-history")}
              className="px-4 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-100 transition-colors"
            >
              Sinyallere göz at →
            </button>
          )}
        </div>
      );
    }

    if (activeTab === "radar") {
      return (
        <GoalRadarSection
          matches={filteredMatches}
          goalProbabilities={goalProbabilities}
          selectedMatch={selectedMatch}
          favorites={favorites}
          goalFlashMap={goalFlashMap}
          onSelectMatch={handleSelectMatch}
          onToggleFavorite={toggleFavorite}
        />
      );
    }

    // ── Upcoming matches section (all tab) ──
    const upcomingSection =
      activeTab === "all" && upcomingMatches.length > 0 ? (
        <UpcomingMatchList
          upcomingMatches={upcomingMatches}
          matches={matches}
          onSelectMatch={handleSelectMatch}
        />
      ) : null;

    if (groupedMatches.mode === "league") {
      return (
        <>
          {upcomingSection}
          {Object.entries(groupedMatches.groups).map(
            ([league, leagueMatches]) => (
              <div key={league} className="mb-3">
                <div className="flex items-center gap-2 px-3 py-1.5 mb-0.5">
                  <CountryFlag code={leagueMatches[0]?.country || ""} />
                  <h2 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    {league}
                  </h2>
                  <span className="text-[10px] text-gray-400 ml-auto">
                    {leagueMatches.length}
                  </span>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                  {leagueMatches.map((match) => (
                    <MatchCard
                      key={match.code}
                      match={match}
                      onClick={() => handleSelectMatch(match)}
                      goalProb={goalProbabilities.get(match.code)}
                      isSelected={selectedMatch?.code === match.code}
                      isFavorite={favorites.has(match.code)}
                      onToggleFavorite={(e) => toggleFavorite(match.code, e)}
                      hasGoalFlash={!!goalFlashMap[match.code]}
                    />
                  ))}
                </div>
              </div>
            ),
          )}
        </>
      );
    } else {
      return (
        <div>
          {upcomingSection}
          <div className="mb-3">
            <div className="flex items-center gap-2 px-3 py-1.5 mb-0.5">
              <svg
                className="w-4 h-4 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h2 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                Zamana Göre
              </h2>
              <span className="text-[10px] text-gray-400 ml-auto">
                {groupedMatches.flat.length}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              {groupedMatches.flat.map((match) => (
                <MatchCard
                  key={match.code}
                  match={match}
                  onClick={() => handleSelectMatch(match)}
                  showLeague
                  goalProb={goalProbabilities.get(match.code)}
                  isSelected={selectedMatch?.code === match.code}
                  isFavorite={favorites.has(match.code)}
                  onToggleFavorite={(e) => toggleFavorite(match.code, e)}
                  hasGoalFlash={!!goalFlashMap[match.code]}
                />
              ))}
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <ErrorBoundary
      context="OptimusGolRadariPage"
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center p-8">
            <div className="text-5xl mb-4">📡</div>
            <p className="text-red-500 text-sm mb-2">
              Bir hata oluştu. Sayfayı yenileyin.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="text-emerald-600 text-sm underline hover:no-underline"
            >
              Sayfayı yenile
            </button>
          </div>
        </div>
      }
    >
      <div className="min-h-screen bg-gray-50 flex flex-col touch-manipulation">
        {/* ── Compact App Header ─────────────────────────────────── */}
        <AppHeader
          lastUpdate={lastUpdate}
          wsConnected={wsConnected}
          sortBy={sortBy}
          onToggleSort={() => setSortBy(sortBy === "league" ? "time" : "league")}
          liveCount={liveCount}
        />

        {/* ── Goal Radar Alert Banner ──────────────────────────── */}
        {radarCount > 0 && activeTab !== "radar" && (
          <RadarAlertBanner
            radarCount={radarCount}
            onClick={() => setActiveTab("radar")}
          />
        )}

        {/* ── Main Content Area ──────────────────────────────────── */}
        <div
          className="flex flex-1 overflow-hidden"
          style={{
            height:
              "calc(100dvh - 56px - 60px - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
          }}
        >
          {/* Desktop: match list hidden when a match is selected */}
          <div
            className={`overflow-y-auto -webkit-overflow-scrolling-touch ${selectedMatch ? "hidden md:hidden" : "w-full"}`}
          >
            <div className="max-w-350 mx-auto p-3 pb-20">
              {renderMatchList()}
            </div>
          </div>

          {/* Desktop: full-page match detail when selected */}
          {selectedMatch && detailProps && (
            <DesktopDetailPanel
              selectedMatch={selectedMatch}
              detailProps={detailProps}
              onClose={handleCloseMatch}
            />
          )}
        </div>

        {/* ── Match Detail Panel (Mobile Drawer) ── */}
        <MobileDrawerPanel
          drawerOpen={drawerOpen}
          selectedMatch={selectedMatch}
          detailProps={detailProps}
          onClose={handleCloseMatch}
          isMobile={isMobile}
        />

        {/* ── Sticky Footer Navigation Bar ──────────────────────── */}
        <BottomNavBar
          activeTab={activeTab}
          liveCount={liveCount}
          radarCount={radarCount}
          favCount={favCount}
          onTabChange={handleTabChange}
        />

        {/* Goal Notifications Portal */}
        <GoalNotificationToasts
          goalNotifications={goalNotifications}
          favoritesLoaded={favoritesLoaded}
        />
      </div>
    </ErrorBoundary>
  );
}
