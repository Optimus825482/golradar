'use client'

import { MatchCard } from './MatchCard'
import type { Match } from './types'
import type { GoalProbability } from '@/lib/nesine'

interface GoalRadarSectionProps {
  matches: Match[]
  goalProbabilities: Map<number, GoalProbability>
  selectedMatch: Match | null
  favorites: Set<number>
  goalFlashMap: Record<number, number>
  onSelectMatch: (match: Match) => void
  onToggleFavorite: (code: number, e?: React.MouseEvent) => void
}

export function GoalRadarSection({
  matches, goalProbabilities, selectedMatch, favorites,
  goalFlashMap, onSelectMatch, onToggleFavorite,
}: GoalRadarSectionProps) {
  const sorted = [...matches].sort((a, b) => {
    const aScore = goalProbabilities.get(a.code)?.score || 0
    const bScore = goalProbabilities.get(b.code)?.score || 0
    return bScore - aScore
  })

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 px-3 py-2 mb-1">
        <div className="relative">
          <svg className="w-4 h-4 text-red-500 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-400 rounded-full animate-ping" />
        </div>
        <h2 className="text-sm font-bold text-red-700 uppercase tracking-wide">Gol Radarı</h2>
        <span className="text-[10px] text-red-400 ml-auto">{sorted.length} maç · Yüksek gol ihtimali</span>
      </div>
      <div className="bg-white rounded-xl border-2 border-red-200 overflow-hidden shadow-sm">
        {sorted.map(match => (
          <MatchCard
            key={match.code}
            match={match}
            onClick={() => onSelectMatch(match)}
            goalProb={goalProbabilities.get(match.code)}
            showLeague
            isSelected={selectedMatch?.code === match.code}
            isFavorite={favorites.has(match.code)}
            onToggleFavorite={(e) => onToggleFavorite(match.code, e)}
            hasGoalFlash={!!goalFlashMap[match.code]}
          />
        ))}
      </div>
    </div>
  )
}
