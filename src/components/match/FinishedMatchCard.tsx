'use client'

import type { Match } from './types'
import { calculatePressure } from './utils'

export function FinishedMatchCard({ match, onClick, isSelected, isFavorite, onToggleFavorite, hasNetScores, hasScoremer }: {
  match: Match
  onClick: () => void
  isSelected?: boolean
  isFavorite?: boolean
  onToggleFavorite?: (e: React.MouseEvent) => void
  hasNetScores?: boolean
  hasScoremer?: boolean
}) {
  const pressure = match.hasStats ? calculatePressure(match.stats) : null
  const homeWon = match.homeGoals > match.awayGoals
  const awayWon = match.awayGoals > match.homeGoals
  const isDraw = match.homeGoals === match.awayGoals

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={`px-3 py-2.5 cursor-pointer border-b border-gray-50 last:border-0 transition-all duration-150 hover:bg-blue-50/40 active:bg-blue-50 relative ${
        isSelected ? 'bg-blue-50/60 border-l-4 border-l-blue-500' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="w-10 text-center shrink-0">
          <span className="text-[10px] font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">MS</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 max-w-[35%]">
              <span className={`text-[13px] truncate font-medium ${homeWon ? 'font-bold text-emerald-700' : 'text-gray-600'}`}>{match.home}</span>
            </div>
            <span className={`text-[14px] font-mono font-black px-2 min-w-[50px] text-center ${
              isDraw ? 'text-gray-600' : 'text-gray-900'
            }`}>
              {match.homeGoals} - {match.awayGoals}
            </span>
            <div className="flex items-center gap-1 max-w-[35%] justify-end">
              <span className={`text-[13px] truncate text-right font-medium ${awayWon ? 'font-bold text-emerald-700' : 'text-gray-600'}`}>{match.away}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-0.5">
            {match.firstHalfScore !== '-' && (
              <span className="text-[9px] text-gray-400">İY: {match.firstHalfScore}</span>
            )}
            {pressure && (
              <span className="text-[9px] text-gray-400">
                Baskı: <span className="text-orange-500">{pressure.home}%</span> - <span className="text-blue-500">{pressure.away}%</span>
              </span>
            )}
            {hasNetScores && (
              <span className="text-[9px] text-emerald-500 font-semibold">⚓ Detaylı</span>
            )}
            {hasScoremer && (
              <span className="text-[9px] text-purple-500 font-semibold">📊 İstatistik</span>
            )}
          </div>
        </div>

        <button
          onClick={onToggleFavorite}
          className="shrink-0 p-1"
        >
          <svg className={`w-4 h-4 ${isFavorite ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} fill={isFavorite ? 'currentColor' : 'none'}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
