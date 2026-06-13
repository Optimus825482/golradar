'use client'

import type { GoalProbability } from '@/lib/nesine'
import type { Match } from './types'
import { calculatePressure } from './utils'
import { CountryFlag, GoalRadarIcon } from './shared-components'

export function MatchCard({ match, onClick, showLeague, goalProb, isSelected, isFavorite, onToggleFavorite, hasGoalFlash }: {
  match: Match
  onClick: () => void
  showLeague?: boolean
  goalProb?: GoalProbability | null
  isSelected?: boolean
  isFavorite?: boolean
  onToggleFavorite?: (e: React.MouseEvent) => void
  hasGoalFlash?: boolean
}) {
  const pressure = match.hasStats ? calculatePressure(match.stats) : null
  const isRadarAlert = goalProb && goalProb.score >= 60 && goalProb.goalProbability5min >= 0.25 && match.isLive
  const hasGoals = match.homeGoals > 0 || match.awayGoals > 0

  return (
    <div
      onClick={onClick}
      className={`px-3 py-2.5 cursor-pointer border-b border-gray-50 last:border-0 transition-all duration-150 hover:bg-orange-50/40 active:bg-orange-50 relative ${
        isSelected ? 'bg-orange-50/60 border-l-4 border-l-emerald-500' :
        isRadarAlert ? 'bg-red-50/50' : ''
      }`}
    >
      {isRadarAlert && (
        <div className={`absolute inset-0 pointer-events-none ${
          goalProb.level === 'critical'
            ? 'animate-pulse border-l-4 border-l-red-500'
            : goalProb.level === 'high'
            ? 'border-l-4 border-l-orange-400'
            : 'border-l-4 border-l-yellow-400'
        }`} />
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
            <span className="text-[11px] font-mono text-gray-400 font-semibold">MS</span>
          ) : (
            <span className="text-[11px] text-gray-400">{match.time}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {showLeague && (
            <div className="flex items-center gap-1 mb-0.5">
              <CountryFlag code={match.country} />
              <span className="text-[10px] text-gray-400 uppercase">{match.league}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 max-w-[35%]">
              <span className="text-[13px] text-gray-800 truncate font-medium">{match.home}</span>
              {isRadarAlert && goalProb?.side && (goalProb.side === 'home' || goalProb.side === 'both') && (
                <GoalRadarIcon level={goalProb.level} />
              )}
            </div>
            <span className="text-[13px] font-mono font-bold text-gray-900 px-2 min-w-[50px] text-center relative">
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
              {isRadarAlert && goalProb?.side && (goalProb.side === 'away' || goalProb.side === 'both') && (
                <GoalRadarIcon level={goalProb.level} />
              )}
              <span className="text-[13px] text-gray-800 truncate text-right font-medium">{match.away}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-0.5">
            {match.firstHalfScore !== '-' && (
              <span className="text-[9px] text-gray-400">İY: {match.firstHalfScore}</span>
            )}
            {pressure && (
              <span className="text-[9px] text-gray-400">
                <span className="text-orange-500">{pressure.home}%</span> - <span className="text-blue-500">{pressure.away}%</span>
              </span>
            )}
            {isRadarAlert && (
              <span className={`text-[9px] font-bold ${
                goalProb?.level === 'critical' ? 'text-red-600' :
                goalProb?.level === 'high' ? 'text-orange-600' :
                'text-yellow-600'
              }`}>
                %{goalProb?.score || 0}
              </span>
            )}
          </div>

          {pressure && (
            <div className="flex h-1 rounded-full overflow-hidden bg-gray-100 mt-1">
              <div className="bg-orange-400 transition-all duration-500" style={{ width: `${pressure.home}%` }} />
              <div className="bg-blue-400 transition-all duration-500" style={{ width: `${pressure.away}%` }} />
            </div>
          )}
        </div>

        <button
          onClick={onToggleFavorite}
          className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
            isFavorite
              ? 'text-amber-500 hover:text-amber-400'
              : 'text-gray-300 hover:text-amber-400'
          }`}
          aria-label={isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
