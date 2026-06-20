'use client'

import { memo } from 'react'
import type { GoalProbability } from '@/lib/nesine'
import type { FotMobMatchDetails } from '@/lib/fotmob'
import type { MomentumBarDataPoint, xGFlowPoint, ThreatIndex } from '@/lib/advancedAnalytics'
import type { Match, MatchStats } from './types'
import { statKeys } from './types'
import { calculatePressure } from './utils'
import { CountryFlag, MatchStatusBadge, StatBar, RedCardIndicator } from './shared-components'
import { MomentumChart } from '@/components/charts/MomentumChart'
import { StatsLineChart } from '@/components/charts/StatsLineChart'
import { UnifiedMatchMomentumChart } from '@/components/charts/UnifiedMatchMomentumChart'
import { FotMobSection } from '@/components/fotmob/FotMobSection'
import { estimateXgFromShots } from '@/lib/advancedAnalytics'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export interface MatchDetailContentProps {
  match: Match
  currentPressure: { home: number; away: number }
  selectedGoalProb: GoalProbability | null
  pressureChartData: { index: number; minute: string; homePressure: number; awayPressure: number }[]
  statsChartData: { index: number; minute: string; homeDangerousAttacks: number; awayDangerousAttacks: number; homeShotsTotal: number; awayShotsTotal: number; homeCorners: number; awayCorners: number; homePossession: number; awayPossession: number }[]
  momentumBars: MomentumBarDataPoint[]
  xgFlowData: xGFlowPoint[]
  threatIndex: ThreatIndex | null
  filteredStats: MatchStats
  statsHalf: 'full' | '1h' | '2h'
  setStatsHalf: (h: 'full' | '1h' | '2h') => void
  fotmobData: FotMobMatchDetails | null
  fotmobLoading: boolean
  fotmobTab: 'events' | 'stats' | 'info'
  setFotmobTab: (tab: 'events' | 'stats' | 'info') => void
  scoremerStats?: Record<string, { home: number | null; away: number | null }> | null
  scoremerHtStats?: Record<string, { home: number | null; away: number | null }> | null
  scoremerLoading?: boolean
  goalooMatchId?: number
  activeChartTab: string
  setActiveChartTab: (tab: string) => void
}

export const MatchDetailContent = memo(function MatchDetailContent({
  match,
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
  fotmobTab,
  setFotmobTab,
  scoremerStats,
  scoremerHtStats,
  scoremerLoading,
  goalooMatchId,
  activeChartTab,
  setActiveChartTab,
}: MatchDetailContentProps) {
  const POLL_INTERVAL = 15000

  return (
    <div style={{ contain: 'paint layout style' }}>
      {/* Match Header */}
      <div className="bg-gradient-to-r from-orange-50 via-white to-blue-50 p-4 sm:p-6 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CountryFlag code={match.country} />
            <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">{match.league}</span>
          </div>
          <MatchStatusBadge match={match} />
        </div>

        <div className="flex items-center justify-center gap-4 sm:gap-8">
          <div className="text-center flex-1 min-w-0">
            <div className="relative mx-auto mb-2" style={{ width: 72, height: 72 }}>
              {/* Gauge arc */}
              <svg width="72" height="72" viewBox="0 0 72 72" className="absolute inset-0">
                <circle cx="36" cy="36" r="32" fill="none" stroke="#f1f5f9" strokeWidth="6" />
                <circle cx="36" cy="36" r="32" fill="none" stroke="#f97316" strokeWidth="6"
                  strokeDasharray={`${(currentPressure.home / 100) * 201} 201`}
                  strokeLinecap="round" transform="rotate(-90 36 36)"
                  className="transition-all duration-700 ease-out" />
              </svg>
              {/* Center value */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-black text-orange-600">{currentPressure.home}%</span>
              </div>
            </div>
            <p className="text-sm font-bold text-gray-900 truncate flex items-center justify-center gap-1">{match.home}<RedCardIndicator count={match.homeRedCards} /></p>
            <p className="text-[9px] text-gray-400">Baskı</p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-4xl sm:text-5xl font-black text-gray-900">{match.homeGoals}</span>
            <span className="text-2xl sm:text-3xl text-gray-300">:</span>
            <span className="text-4xl sm:text-5xl font-black text-gray-900">{match.awayGoals}</span>
          </div>

          <div className="text-center flex-1 min-w-0">
            <div className="relative mx-auto mb-2" style={{ width: 72, height: 72 }}>
              {/* Gauge arc */}
              <svg width="72" height="72" viewBox="0 0 72 72" className="absolute inset-0">
                <circle cx="36" cy="36" r="32" fill="none" stroke="#f1f5f9" strokeWidth="6" />
                <circle cx="36" cy="36" r="32" fill="none" stroke="#3b82f6" strokeWidth="6"
                  strokeDasharray={`${(currentPressure.away / 100) * 201} 201`}
                  strokeLinecap="round" transform="rotate(-90 36 36)"
                  className="transition-all duration-700 ease-out" />
              </svg>
              {/* Center value */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-black text-blue-600">{currentPressure.away}%</span>
              </div>
            </div>
            <p className="text-sm font-bold text-gray-900 truncate flex items-center justify-center gap-1">{match.away}<RedCardIndicator count={match.awayRedCards} /></p>
            <p className="text-[9px] text-gray-400">Baskı</p>
          </div>
        </div>

        {match.firstHalfScore !== '-' && (
          <div className="text-center mt-2">
            <span className="text-xs text-gray-400">İY: {match.firstHalfScore}</span>
          </div>
        )}

        {/* Goal Radar Indicator */}
        {selectedGoalProb && selectedGoalProb.score >= 60 && selectedGoalProb.goalProbability5min >= 0.25 && (
          <div className={`mt-4 p-3 rounded-xl border-2 ${
            selectedGoalProb.level === 'critical' ? 'bg-red-50 border-red-300' :
            selectedGoalProb.level === 'high' ? 'bg-orange-50 border-orange-300' :
            'bg-yellow-50 border-yellow-300'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`relative ${selectedGoalProb.level === 'critical' ? 'animate-pulse' : ''}`}>
                  <svg className={`w-5 h-5 ${
                    selectedGoalProb.level === 'critical' ? 'text-red-500' :
                    selectedGoalProb.level === 'high' ? 'text-orange-500' :
                    'text-yellow-500'
                  }`} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                  </svg>
                  {selectedGoalProb.level === 'critical' && (
                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-400 rounded-full animate-ping" />
                  )}
                </div>
                <div>
                  <span className={`text-sm font-bold ${
                    selectedGoalProb.level === 'critical' ? 'text-red-700' :
                    selectedGoalProb.level === 'high' ? 'text-orange-700' :
                    'text-yellow-700'
                  }`}>
                    GOL RADARI
                  </span>
                  <span className={`ml-2 text-xs ${
                    selectedGoalProb.level === 'critical' ? 'text-red-500' :
                    selectedGoalProb.level === 'high' ? 'text-orange-500' :
                    'text-yellow-500'
                  }`}>
                    İhtimal: %{selectedGoalProb.score}
                  </span>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                selectedGoalProb.level === 'critical' ? 'bg-red-200 text-red-800' :
                selectedGoalProb.level === 'high' ? 'bg-orange-200 text-orange-800' :
                'bg-yellow-200 text-yellow-800'
              }`}>
                {selectedGoalProb.level === 'critical' ? 'KRİTİK' :
                 selectedGoalProb.level === 'high' ? 'YÜKSEK' : 'ORTA'}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-600 w-20 truncate">{match.home}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      selectedGoalProb.level === 'critical' ? 'bg-red-500' :
                      selectedGoalProb.level === 'high' ? 'bg-orange-500' : 'bg-yellow-500'
                    }`}
                    style={{ width: `${Math.min(100, selectedGoalProb.homeScore)}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono font-semibold w-8 text-right">{selectedGoalProb.homeScore}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-600 w-20 truncate">{match.away}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      selectedGoalProb.level === 'critical' ? 'bg-red-500' :
                      selectedGoalProb.level === 'high' ? 'bg-orange-500' : 'bg-yellow-500'
                    }`}
                    style={{ width: `${Math.min(100, selectedGoalProb.awayScore)}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono font-semibold w-8 text-right">{selectedGoalProb.awayScore}</span>
              </div>
            </div>

            {selectedGoalProb.factors.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {selectedGoalProb.factors.map((f, i) => (
                  <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                    selectedGoalProb.level === 'critical' ? 'bg-red-100 text-red-600' :
                    selectedGoalProb.level === 'high' ? 'bg-orange-100 text-orange-600' :
                    'bg-yellow-100 text-yellow-600'
                  }`}>
                    {f}
                  </span>
                ))}
              </div>
            )}

            {(selectedGoalProb.calibratedP > 0 || selectedGoalProb.poissonP > 0) && (
              <div className="mt-2 space-y-1.5">
                <div className="grid grid-cols-3 gap-1.5">
                  {selectedGoalProb.calibratedP > 0 && (
                    <div className="bg-blue-50 rounded px-2 py-1 text-center">
                      <div className="text-[8px] text-blue-500 font-medium">Kalibre</div>
                      <div className="text-[11px] font-bold text-blue-700">{(selectedGoalProb.calibratedP * 100).toFixed(0)}%</div>
                    </div>
                  )}
                  {selectedGoalProb.poissonP > 0 && (
                    <div className="bg-purple-50 rounded px-2 py-1 text-center">
                      <div className="text-[8px] text-purple-500 font-medium">Poisson</div>
                      <div className="text-[11px] font-bold text-purple-700">{(selectedGoalProb.poissonP * 100).toFixed(0)}%</div>
                    </div>
                  )}
                  {selectedGoalProb.overUnder25 > 0 && (
                    <div className="bg-green-50 rounded px-2 py-1 text-center">
                      <div className="text-[8px] text-green-500 font-medium">O2.5</div>
                      <div className="text-[11px] font-bold text-green-700">{(selectedGoalProb.overUnder25 * 100).toFixed(0)}%</div>
                    </div>
                  )}
                  {selectedGoalProb.btts > 0 && (
                    <div className="bg-amber-50 rounded px-2 py-1 text-center">
                      <div className="text-[8px] text-amber-500 font-medium">BTTS</div>
                      <div className="text-[11px] font-bold text-amber-700">{(selectedGoalProb.btts * 100).toFixed(0)}%</div>
                    </div>
                  )}
                  {selectedGoalProb.timeMultiplier !== 1.0 && (
                    <div className="bg-gray-50 rounded px-2 py-1 text-center">
                      <div className="text-[8px] text-gray-500 font-medium">Zaman</div>
                      <div className="text-[11px] font-bold text-gray-700">{selectedGoalProb.timeMultiplier.toFixed(2)}x</div>
                    </div>
                  )}
                  {selectedGoalProb.eloAdj && (Math.abs(selectedGoalProb.eloAdj.homeAdjust) >= 2 || Math.abs(selectedGoalProb.eloAdj.awayAdjust) >= 2) && (
                    <div className="bg-indigo-50 rounded px-2 py-1 text-center">
                      <div className="text-[8px] text-indigo-500 font-medium">Elo</div>
                      <div className="text-[11px] font-bold text-indigo-700">{selectedGoalProb.eloAdj.homeAdjust > 0 ? '+' : ''}{selectedGoalProb.eloAdj.homeAdjust}/{selectedGoalProb.eloAdj.awayAdjust > 0 ? '+' : ''}{selectedGoalProb.eloAdj.awayAdjust}</div>
                    </div>
                  )}
                </div>
                <div className="bg-gradient-to-r from-slate-50 to-sky-50 rounded px-2.5 py-1.5 border border-slate-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[9px] font-bold text-slate-600">ENSEMBLE AKTIF</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] text-slate-400">Kural</span>
                      <div className="w-8 h-1 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-400 rounded-full" style={{ width: '40%' }} />
                      </div>
                      <span className="text-[8px] text-slate-400">Poisson</span>
                      <div className="w-8 h-1 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-400 rounded-full" style={{ width: '25%' }} />
                      </div>
                      <span className="text-[8px] text-slate-400">ML</span>
                      <div className="w-8 h-1 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: '20%' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Charts Section */}
      <div className="p-4 sm:p-5 border-b border-gray-100 space-y-4" style={{ contain: 'paint layout style' }}>
        {(pressureChartData.length > 2 || fotmobData?.momentum?.main?.data?.length || momentumBars.length >= 2 || xgFlowData.length >= 1 || match?.hasStats || fotmobLoading) ? (
          <>
            <ErrorBoundary context="UnifiedMatchMomentumChart">
            <UnifiedMatchMomentumChart
              momentumBars={momentumBars}
              xgFlowData={xgFlowData}
              homeTeam={match.home}
              awayTeam={match.away}
              homeScore={match.homeGoals}
              awayScore={match.awayGoals}
              homeColor={match.homeColor || '#f97316'}
              awayColor={match.awayColor || '#3b82f6'}
              threatIndex={threatIndex}
              fotmobMomentum={fotmobData?.momentum ?? null}
              fotmobShots={fotmobData?.shotmap ?? null}
              fotmobHomeTeamId={fotmobData?.homeTeam?.id}
              fotmobAwayTeamId={fotmobData?.awayTeam?.id}
              goalEvents={fotmobData?.events?.filter(e => e.type === 'Goal')}
              isFotmobLoading={fotmobLoading}
            />
            </ErrorBoundary>
            <ErrorBoundary context="MomentumChart">
            <MomentumChart data={pressureChartData} homeTeam={match.home} awayTeam={match.away} />
            </ErrorBoundary>
            <ErrorBoundary context="StatsLineChart">
            <StatsLineChart data={statsChartData} homeKey="homeDangerousAttacks" awayKey="awayDangerousAttacks" homeName={`${match.home} Tehl. Hücum`} awayName={`${match.away} Tehl. Hücum`} homeTeam={match.home} awayTeam={match.away} title="Tehlikeli Hücum" />
            </ErrorBoundary>
          </>
        ) : (
          <div className="h-[200px] flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
            <div className="text-center">
              <div className="animate-spin w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-sm text-gray-400">Grafik için veri toplanıyor...</p>
              <p className="text-[11px] text-gray-500 mt-1">Her {POLL_INTERVAL / 1000} saniyede bir veri noktası eklenir</p>
            </div>
          </div>
        )}
      </div>

      {/* Match Statistics */}
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Maç İstatistikleri
          </h3>
          <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
            {([
              { key: 'full' as const, label: 'Toplam' },
              { key: '1h' as const, label: '1. Yarı' },
              { key: '2h' as const, label: '2. Yarı' },
            ]).map(h => (
              <button
                key={h.key}
                onClick={() => setStatsHalf(h.key)}
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-all ${
                  statsHalf === h.key
                    ? 'bg-orange-500 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>

        {match.hasStats ? (
          <div className="space-y-0.5">
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="font-semibold text-orange-600">{match.home}</span>
              <span className="text-gray-300">vs</span>
              <span className="font-semibold text-blue-600">{match.away}</span>
            </div>
            {statKeys.map(({ key, label, suffix, isEstimated }) => {
              let stat = filteredStats[key]
              if (key === 'xg' && (!stat || (stat.home == null && stat.away == null) || (stat.home === 0 && stat.away === 0))) {
                const estimated = estimateXgFromShots(filteredStats)
                if (estimated.home > 0 || estimated.away > 0) {
                  stat = { home: estimated.home, away: estimated.away }
                }
              }
              if (!stat) return null
              return (
                <StatBar
                  key={key}
                  label={isEstimated ? 'xG (est.)' : label}
                  home={stat.home}
                  away={stat.away}
                  suffix={suffix}
                  isPossession={key === 'possession'}
                />
              )
            })}
          </div>
        ) : (
          <div className="py-8 text-center bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-400">Bu maç için istatistik bulunmuyor</p>
          </div>
        )}
      </div>

      {/* Scoremer Enhanced Stats Section */}
      {match.isFinished && (scoremerLoading || scoremerStats) && (
        <div className="border-b border-gray-100">
          <div className="px-4 pt-3 pb-1 flex items-center gap-2">
            <span className="text-xs font-bold text-purple-700 uppercase tracking-wider">Maç İstatistikleri</span>
            {scoremerLoading && (
              <div className="w-3 h-3 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
            )}
          </div>

          {scoremerLoading && !scoremerStats ? (
            <div className="px-4 pb-4 py-6 flex items-center justify-center gap-2 text-purple-400">
              <div className="w-4 h-4 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
              <span className="text-sm">İstatistikler yükleniyor...</span>
            </div>
          ) : scoremerStats ? (
            <div className="px-4 pb-4">
              <div className="mb-3">
                <div className="text-center text-[10px] text-gray-500 font-semibold mb-1">Maç Sonu</div>
                <StatBar label="İsabetli Şut" home={scoremerStats.shots_on_target?.home} away={scoremerStats.shots_on_target?.away} />
                <StatBar label="İsabetsiz Şut" home={scoremerStats.shots_off_target?.home} away={scoremerStats.shots_off_target?.away} />
                <StatBar label="Tehlikeli Hücum" home={scoremerStats.dangerous_attacks?.home} away={scoremerStats.dangerous_attacks?.away} />
                <StatBar label="Hücum" home={scoremerStats.attacks?.home} away={scoremerStats.attacks?.away} />
                <StatBar label="Top Sahipliği %" home={scoremerStats.possession?.home} away={scoremerStats.possession?.away} isPossession />
                {scoremerStats.xg && (
                  <StatBar label="xG" home={scoremerStats.xg.home} away={scoremerStats.xg.away} />
                )}
              </div>

              {scoremerHtStats && (scoremerHtStats.shots_on_target || scoremerHtStats.dangerous_attacks || scoremerHtStats.possession) && (
                <div className="border-t border-gray-100 pt-3">
                  <div className="text-center text-[10px] text-gray-500 font-semibold mb-1">İlk Yarı</div>
                  {scoremerHtStats.shots_on_target && (
                    <StatBar label="İsabetli Şut" home={scoremerHtStats.shots_on_target.home} away={scoremerHtStats.shots_on_target.away} />
                  )}
                  {scoremerHtStats.shots_off_target && (
                    <StatBar label="İsabetsiz Şut" home={scoremerHtStats.shots_off_target.home} away={scoremerHtStats.shots_off_target.away} />
                  )}
                  {scoremerHtStats.dangerous_attacks && (
                    <StatBar label="Tehlikeli Hücum" home={scoremerHtStats.dangerous_attacks.home} away={scoremerHtStats.dangerous_attacks.away} />
                  )}
                  {scoremerHtStats.attacks && (
                    <StatBar label="Hücum" home={scoremerHtStats.attacks.home} away={scoremerHtStats.attacks.away} />
                  )}
                  {scoremerHtStats.possession && (
                    <StatBar label="Top Sahipliği %" home={scoremerHtStats.possession.home} away={scoremerHtStats.possession.away} isPossession />
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      <ErrorBoundary context="FotMobSection">
      <FotMobSection
        fotmobData={fotmobData}
        fotmobLoading={fotmobLoading}
        fotmobTab={fotmobTab}
        setFotmobTab={setFotmobTab}
        homeTeam={match.home}
        awayTeam={match.away}
      />
      </ErrorBoundary>
    </div>
  )
})
