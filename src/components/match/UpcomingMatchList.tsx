"use client";

import { useEffect, useState } from "react";
import type { Match, MatchStats } from "./types";
import type { UpcomingMatch } from "@/hooks/useUpcomingMatches";

interface UpcomingMatchListProps {
  upcomingMatches: UpcomingMatch[];
  matches: Match[];
  onSelectMatch: (match: Match) => void;
}

/** "07.07.2026" + "00:30" → remaining minutes. Negative if past. */
function minutesUntil(dateStr: string, time: string): number {
  try {
    const [d, m, y] = dateStr.split('.');
    const matchTime = new Date(`${y}-${m}-${d}T${time}:00+03:00`);
    return Math.round((matchTime.getTime() - Date.now()) / 60_000);
  } catch {
    return Infinity;
  }
}

function Countdown({ date, time }: { date: string; time: string }) {
  const [mins, setMins] = useState(() => minutesUntil(date, time));

  useEffect(() => {
    setMins(minutesUntil(date, time));
    const id = setInterval(() => {
      setMins(minutesUntil(date, time));
    }, 30_000); // every 30s
    return () => clearInterval(id);
  }, [date, time]);

  if (!isFinite(mins)) return null;
  if (mins <= 0) return <span className="text-[10px] text-emerald-600 font-semibold">BASLIYOR</span>;
  if (mins < 60) return <span className="text-[10px] text-amber-600 font-bold">{mins}dk</span>;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return <span className="text-[10px] text-gray-500">{h}s {m}dk</span>;
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
            <div className="flex items-center gap-3">
              {/* Time + countdown */}
              <div className="text-center w-14 shrink-0">
                <div className="text-[11px] font-bold text-indigo-600">
                  {m.time}
                </div>
                <div className="text-[8px] text-gray-400 uppercase">
                  {m.day?.slice(0, 3)}
                </div>
                <Countdown date={m.date} time={m.time} />
              </div>
              {/* Teams + league */}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-gray-800 truncate">
                  {m.home}
                </div>
                <div className="text-[13px] font-medium text-gray-800 truncate">
                  {m.away}
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5 truncate">
                  {m.league}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
