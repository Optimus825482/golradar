"use client";

import type { Match, MatchStats } from "./types";
import type { UpcomingMatch } from "@/hooks/useUpcomingMatches";

interface UpcomingMatchListProps {
  upcomingMatches: UpcomingMatch[];
  matches: Match[];
  onSelectMatch: (match: Match) => void;
}

export function UpcomingMatchList({
  upcomingMatches,
  matches,
  onSelectMatch,
}: UpcomingMatchListProps) {
  if (upcomingMatches.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 px-3 py-1.5 mb-0.5">
        <svg
          className="w-4 h-4 text-indigo-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <h2 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
          Yaklasan Maclar
        </h2>
        <span className="text-[10px] text-gray-400 ml-auto">
          {upcomingMatches.length}
        </span>
      </div>
      <div className="bg-white rounded-xl border border-indigo-100 overflow-hidden shadow-sm">
        {upcomingMatches.map((m) => (
          <div
            key={m.code}
            className="px-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-indigo-50/30 transition-colors cursor-pointer"
            onClick={() => {
              const liveMatch = matches.find((mm) => mm.code === m.code);
              if (liveMatch) {
                onSelectMatch(liveMatch);
                return;
              }
              // Upcoming match icin minimal match objesi olustur
              onSelectMatch({
                code: m.code,
                bid: 0,
                league: m.league || "",
                leagueId: 0,
                home: m.home,
                away: m.away,
                homeTr: m.home,
                awayTr: m.away,
                homeGoals: 0,
                awayGoals: 0,
                firstHalfScore: "-",
                minute: m.time,
                status: 1,
                statusText: "Baslamadi",
                time: m.time || "",
                isLive: false,
                isFinished: false,
                isUpcoming: true,
                country: "",
                stats: {} as MatchStats,
                hasStats: false,
                homeColor: null,
                awayColor: null,
                homeAbbrev: null,
                awayAbbrev: null,
                homeLogoUrl: null,
                awayLogoUrl: null,
                homeRedCards: 0,
                awayRedCards: 0,
              } as Match);
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="text-center w-12 shrink-0">
                  <div className="text-[11px] font-bold text-indigo-600">
                    {m.time}
                  </div>
                  <div className="text-[9px] text-gray-400">
                    {m.day?.slice(0, 3)}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-gray-800 truncate">
                      {m.home}
                    </span>
                    {m.homeOdds && (
                      <span className="text-[12px] font-mono font-bold text-gray-500 ml-2 w-8 text-right">
                        {m.homeOdds.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-gray-800 truncate">
                      {m.away}
                    </span>
                    {m.awayOdds && (
                      <span className="text-[12px] font-mono font-bold text-gray-500 ml-2 w-8 text-right">
                        {m.awayOdds.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-gray-400 mt-0.5">
                    {m.league}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
