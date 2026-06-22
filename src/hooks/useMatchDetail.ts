"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildNetscoresMapping } from "@/lib/utils";
import type { Match } from "@/components/match/types";
import type { FotMobMatchDetails } from "@/lib/fotmob";
import { logError } from "@/lib/devLog";

interface ScoremerStat {
  home: number | null;
  away: number | null;
}

interface ScoremerStatsMap {
  [key: string]: ScoremerStat;
}

interface GoalooOddsMovement {
  homeBoost: number;
  awayBoost: number;
  significance: string;
}

export interface UseMatchDetailResult {
  // NetScores / FotMob
  fotmobData: FotMobMatchDetails | null;
  fotmobLoading: boolean;
  netscoresMapping: Record<number, string>;

  // Scoremer
  scoremerStats: ScoremerStatsMap | null;
  scoremerHtStats: ScoremerStatsMap | null;
  scoremerHtScore: string | null;
  scoremerLoading: boolean;
  scoremerMapping: Record<number, string>;

  // Goaloo
  goalooOddsMovement: GoalooOddsMovement | null;
  goalooMatchIdMap: Record<number, number>;

  // Actions
  fetchNetScoresDetails: (match: Match, mapping?: Record<number, string>) => Promise<void>;
  fetchScoremerDetails: (match: Match) => Promise<void>;
}

/**
 * Per-match detail enrichment. Owns NetScores, Scoremer and Goaloo
 * fetch state for the currently-selected match. Mounts once at the
 * page level; methods are no-op when called without a real match.
 */
export function useMatchDetail(matches: Match[]): UseMatchDetailResult {
  const [fotmobData, setFotmobData] = useState<FotMobMatchDetails | null>(null);
  const [fotmobLoading, setFotmobLoading] = useState(false);
  const [netscoresMapping, setNetscoresMapping] = useState<Record<number, string>>({});

  const [scoremerStats, setScoremerStats] = useState<ScoremerStatsMap | null>(null);
  const [scoremerHtStats, setScoremerHtStats] = useState<ScoremerStatsMap | null>(null);
  const [scoremerHtScore, setScoremerHtScore] = useState<string | null>(null);
  const [scoremerLoading, setScoremerLoading] = useState(false);
  const [scoremerMapping, setScoremerMapping] = useState<Record<number, string>>({});

  const [goalooOddsMovement, setGoalooOddsMovement] = useState<GoalooOddsMovement | null>(null);
  const [goalooMatchIdMap, setGoalooMatchIdMap] = useState<Record<number, number>>({});

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Build NetScores mapping when matches change
  useEffect(() => {
    if (matches.length === 0) return;
    buildNetscoresMapping(
      matches.map((m) => ({ code: m.code, home: m.home, away: m.away, time: m.time })),
    )
      .then(setNetscoresMapping)
      .catch((e: unknown) => { logError("useMatchDetail", e); });
  }, [matches]);

  const fetchNetScoresDetails = useCallback(
    async (match: Match, mapping?: Record<number, string>): Promise<void> => {
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
              setNetscoresMapping((prev) => ({ ...prev, [match.code]: data.netscoresUrl }));
            }
            return;
          }
        }
      } catch (err) {
        logError("useMatchDetail", "NetScores fetch error:", err);
      } finally {
        if (mountedRef.current) setFotmobLoading(false);
      }
    },
    [netscoresMapping],
  );

  const fetchScoremerDetails = useCallback(
    async (match: Match): Promise<void> => {
      setScoremerStats(null);
      setScoremerHtStats(null);
      setScoremerHtScore(null);
      setScoremerLoading(true);
      try {
        const scoremerId = scoremerMapping[match.code];
        if (!scoremerId) {
          // Lazy-build mapping then retry
          const matchList = [{ code: match.code, home: match.home, away: match.away, time: match.time }];
          const mapResp = await fetch(
            `/api/scoremer?action=mapping&matches=${encodeURIComponent(JSON.stringify(matchList))}`,
          );
          if (mapResp.ok) {
            const mapData = await mapResp.json();
            const map: Record<number, string> = {};
            for (const m of mapData.mappings || []) {
              map[m.nesineCode] = m.scoremerId;
            }
            setScoremerMapping(map);
          }
        }

        const params = new URLSearchParams({
          action: "details",
          matchCode: String(match.code),
          home: match.home,
          away: match.away,
          time: match.time,
        });
        const resp = await fetch(`/api/scoremer?${params.toString()}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.stats) setScoremerStats({ [match.code]: data.stats });
          if (data.htStats) setScoremerHtStats({ [match.code]: data.htStats });
          if (typeof data.htScore === "string") setScoremerHtScore(data.htScore);
        }
      } catch (err) {
        logError("useMatchDetail", "Scoremer fetch error:", err);
      } finally {
        if (mountedRef.current) setScoremerLoading(false);
      }
    },
    [scoremerMapping],
  );

  return {
    fotmobData,
    fotmobLoading,
    netscoresMapping,
    scoremerStats,
    scoremerHtStats,
    scoremerHtScore,
    scoremerLoading,
    scoremerMapping,
    goalooOddsMovement,
    goalooMatchIdMap,
    fetchNetScoresDetails,
    fetchScoremerDetails,
  };
}
