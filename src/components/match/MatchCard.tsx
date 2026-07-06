import type { GoalProbability } from "@/lib/nesine";
import type { Match } from "./types";
import { calculatePressure } from "./utils";
import {
  CountryFlag,
  GoalRadarIcon,
  RedCardIndicator,
} from "./shared-components";
import { RADAR_THRESHOLD, SIGNAL_5MIN_THRESHOLD } from "@/config";
import { StarIcon } from "@/components/ui/icons";

export function MatchCard({
  match,
  onClick,
  showLeague,
  goalProb,
  isSelected,
  isFavorite,
  onToggleFavorite,
  hasGoalFlash,
}: {
  match: Match;
  onClick: () => void;
  showLeague?: boolean;
  goalProb?: GoalProbability | null;
  isSelected?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  hasGoalFlash?: boolean;
}) {
  const pressure = match.hasStats ? calculatePressure(match.stats) : null;
  const isRadarAlert =
    goalProb &&
    goalProb.score >= RADAR_THRESHOLD &&
    goalProb.goalProbability5min >= SIGNAL_5MIN_THRESHOLD &&
    match.isLive;
  const hasGoals = match.homeGoals > 0 || match.awayGoals > 0;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`${match.home} - ${match.away} · ${match.homeGoals}-${match.awayGoals} · ${match.isLive ? match.minute : match.isFinished ? "MS" : match.time}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`px-3 py-2.5 cursor-pointer border-b border-gray-50 last:border-0 transition-all duration-150 hover:bg-orange-50/40 active:bg-orange-50 relative ${
        isSelected
          ? "bg-orange-50/60 border-l-4 border-l-emerald-500"
          : isRadarAlert
            ? "bg-red-50/50"
            : ""
      }`}
    >
      {isRadarAlert && (
        <div
          className={`absolute inset-0 pointer-events-none ${
            goalProb.level === "critical"
              ? "animate-pulse border-l-4 border-l-red-500"
              : goalProb.level === "high"
                ? "border-l-4 border-l-orange-400"
                : "border-l-4 border-l-yellow-400"
          }`}
        />
      )}

      {isRadarAlert && (
        <div
          className={`absolute top-1 right-1 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider shadow-sm z-10 ${
            goalProb.level === "critical"
              ? "bg-red-500 text-white animate-pulse"
              : goalProb.level === "high"
                ? "bg-orange-500 text-white"
                : "bg-yellow-500 text-white"
          }`}
        >
          <span className="w-1 h-1 rounded-full bg-white inline-block animate-ping" />
          SİNYAL
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="w-10 text-center shrink-0">
          {match.isLive ? (
            <div>
              <span className="text-[11px] font-mono font-bold text-orange-600">
                {match.minute}
              </span>
              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse mx-auto mt-0.5" />
            </div>
          ) : match.isFinished ? (
            <span className="text-[11px] font-mono text-gray-400 font-semibold">
              MS
            </span>
          ) : (
            <span className="text-[11px] text-gray-400">{match.time}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {showLeague && (
            <div className="flex items-center gap-1 mb-0.5">
              <CountryFlag code={match.country} />
              <span className="text-[10px] text-gray-400 uppercase">
                {match.league}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 max-w-[35%]">
              <span className="text-[13px] text-gray-800 truncate font-medium">
                {match.home}
              </span>
              <RedCardIndicator count={match.homeRedCards} />
              {isRadarAlert &&
                goalProb?.side &&
                (goalProb.side === "home" || goalProb.side === "both") && (
                  <GoalRadarIcon level={goalProb.level} />
                )}
            </div>
            <span className="text-[13px] font-mono font-bold text-gray-900 px-2 min-w-12.5 text-center relative">
              {match.homeGoals} - {match.awayGoals}
              {hasGoals && hasGoalFlash && (
                <span className="absolute -top-2 -right-2 goal-badge-flash">
                  <span className="inline-flex items-center justify-center bg-green-500 text-white text-[8px] font-black px-1 py-0.5 rounded-full shadow-lg border border-green-300">
                    GOL
                  </span>
                </span>
              )}
            </span>
            <div className="flex items-center gap-1 max-w-[35%] justify-end">
              {isRadarAlert &&
                goalProb?.side &&
                (goalProb.side === "away" || goalProb.side === "both") && (
                  <GoalRadarIcon level={goalProb.level} />
                )}
              <span className="text-[13px] text-gray-800 truncate text-right font-medium">
                {match.away}
              </span>
              <RedCardIndicator count={match.awayRedCards} />
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-0.5">
            {match.firstHalfScore !== "-" && (
              <span className="text-[9px] text-gray-400">
                İY: {match.firstHalfScore}
              </span>
            )}
            {pressure && (
              <span className="text-[9px] text-gray-400">
                <span className="text-orange-500">{pressure.home}%</span> -{" "}
                <span className="text-blue-500">{pressure.away}%</span>
              </span>
            )}
            {match.isLive && goalProb && (
              <span
                className={`text-[9px] font-bold ${
                  goalProb.level === "critical"
                    ? "text-red-600"
                    : goalProb.level === "high"
                      ? "text-orange-600"
                      : goalProb.level === "medium"
                        ? "text-yellow-600"
                        : "text-gray-400"
                }`}
              >
                %{Math.round((goalProb.goalProbability5min || 0) * 100)} · S:
                {Math.round(goalProb.score)}
              </span>
            )}
          </div>

          {pressure && (
            <div className="flex h-1 rounded-full overflow-hidden bg-gray-100 mt-1">
              <div
                className="bg-orange-400 transition-all duration-500"
                style={{ width: `${pressure.home}%` }}
              />
              <div
                className="bg-blue-400 transition-all duration-500"
                style={{ width: `${pressure.away}%` }}
              />
            </div>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite?.(e);
          }}
          className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
            isFavorite
              ? "text-amber-500 hover:text-amber-400"
              : "text-gray-300 hover:text-amber-400"
          }`}
          aria-label={isFavorite ? "Favorilerden çıkar" : "Favorilere ekle"}
        >
          <StarIcon filled={!!isFavorite} className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
