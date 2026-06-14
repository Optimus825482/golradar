'use client'

import { CountryFlag, MatchStatusBadge } from './shared-components'
import { FinishedMatchCard } from './FinishedMatchCard'
import SignalStatsPanel from '@/components/SignalStatsPanel'
import SignalHistoryPanel from '@/components/SignalHistoryPanel'
import type { Match, GoalNotification } from './types'

interface FinishedMatchesViewProps {
  finishedMatches: Match[]
  finishedLoading: boolean
  finishedError: string | null
  finishedDate: string
  finishedNetscoresMapping: Record<number, string>
  scoremerMapping: Record<number, string>
  selectedMatch: Match | null
  favorites: Set<number>
  onSelectMatch: (match: Match) => void
  onToggleFavorite: (code: number, e?: React.MouseEvent) => void
  onFetchFinished: (date?: string) => void
  onSetDate: (date: string) => void
  onSetActiveTab: (tab: string) => void
  setFinishedMatches: (m: Match[]) => void
}

export function FinishedMatchesView({
  finishedMatches, finishedLoading, finishedError,
  finishedDate, finishedNetscoresMapping, scoremerMapping,
  selectedMatch, favorites, onSelectMatch, onToggleFavorite,
  onFetchFinished, onSetDate, onSetActiveTab,
}: FinishedMatchesViewProps) {
  if (finishedLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full mb-4" />
        <p className="text-gray-500 text-sm">Biten maçlar yükleniyor...</p>
      </div>
    )
  }
  if (finishedError) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-red-500 text-sm mb-2">{finishedError}</p>
        <button onClick={() => onFetchFinished()} className="text-blue-600 text-sm underline hover:no-underline">
          Tekrar dene
        </button>
      </div>
    )
  }
  if (finishedMatches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-5xl mb-4">✅</div>
        <p className="text-gray-500 text-sm">Bu tarihte biten maç bulunmuyor</p>
      </div>
    )
  }

  const byLeague: Record<string, Match[]> = {}
  for (const m of finishedMatches) {
    if (!byLeague[m.league]) byLeague[m.league] = []
    byLeague[m.league].push(m)
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-white rounded-xl border border-gray-200 shadow-sm">
        <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <input
          type="date"
          value={finishedDate}
          onChange={(e) => {
            onSetDate(e.target.value)
            onFetchFinished(e.target.value)
          }}
          className="text-sm font-medium text-gray-700 bg-transparent border-none outline-none cursor-pointer"
        />
        <span className="text-[10px] text-gray-400 ml-auto">{finishedMatches.length} maç</span>
      </div>

      {Object.entries(byLeague).map(([league, leagueMatches]) => (
        <div key={league} className="mb-3">
          <div className="flex items-center gap-2 px-3 py-1.5 mb-0.5">
            <CountryFlag code={leagueMatches[0]?.country || ''} />
            <h2 className="text-xs font-bold text-gray-800 uppercase tracking-wide">{league}</h2>
            <span className="text-[10px] text-gray-400 ml-auto">{leagueMatches.length}</span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            {leagueMatches.map(match => (
              <FinishedMatchCard
                key={match.code}
                match={match}
                onClick={() => onSelectMatch(match)}
                isSelected={selectedMatch?.code === match.code}
                isFavorite={favorites.has(match.code)}
                onToggleFavorite={(e) => onToggleFavorite(match.code, e)}
                hasNetScores={!!finishedNetscoresMapping[match.code]}
                hasScoremer={!!scoremerMapping[match.code]}
              />
            ))}
          </div>
        </div>
      ))}

      <SignalStatsPanel />

      <button
        onClick={() => onSetActiveTab('signal-history')}
        className="w-full mt-4 py-3.5 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 hover:from-indigo-700 hover:via-indigo-600 hover:to-purple-700 transition-all active:scale-[0.98]"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Sinyal Geçmişi
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </button>
    </div>
  )
}
