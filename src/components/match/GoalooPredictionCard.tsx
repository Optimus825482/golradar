'use client'

import { memo, useEffect, useState } from 'react'

interface GoalooOddsData {
  matchId: number
  bookmaker: string
  initial: {
    homeWin: number
    draw: number
    awayWin: number
    ouLine: number
    over: number
    under: number
    bttsYes: number
    bttsNo: number
  }
  live: {
    homeWin: number
    draw: number
    awayWin: number
    ouLine: number
    over: number
    under: number
    bttsYes: number
    bttsNo: number
  } | null
}

interface MatchInfo {
  home: string
  away: string
  isLive: boolean
  isFinished: boolean
}

function impliedProb(odds: number): number {
  if (!odds || odds <= 1) return 0
  return Math.min(99, Math.round((1 / odds) * 100))
}

function GoalBar({ label, homeProb, awayProb }: { label: string; homeProb: number; awayProb: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-gray-500">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono text-indigo-600 w-8 text-right">{homeProb}%</span>
        <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full bg-indigo-400 rounded-full transition-all duration-500" style={{ width: `${homeProb}%` }} />
        </div>
        <span className="text-[10px] font-mono text-purple-600 w-8 text-right">{awayProb}%</span>
      </div>
    </div>
  )
}

export const GoalooPredictionCard = memo(function GoalooPredictionCard({ goalooMatchId, match }: { goalooMatchId?: number; match: MatchInfo }) {
  const [odds, setOdds] = useState<GoalooOddsData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!goalooMatchId || match.isFinished) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/goaloo?action=odds&matchId=${goalooMatchId}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setOdds(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [goalooMatchId, match.isFinished])

  if (!goalooMatchId) return null

  const o = odds?.live ?? odds?.initial
  if (!o && !loading) return null

  const hp = o ? impliedProb(o.homeWin) : 0
  const dp = o ? impliedProb(o.draw) : 0
  const ap = o ? impliedProb(o.awayWin) : 0
  const overP = o && o.over ? impliedProb(o.over) : 0
  const underP = o && o.under ? impliedProb(o.under) : 0
  const bttsYesP = o && o.bttsYes ? impliedProb(o.bttsYes) : 0
  const bttsNoP = o && o.bttsNo ? impliedProb(o.bttsNo) : 0

  const totalProb = hp + dp + ap
  const margin = totalProb > 0 ? totalProb - 100 : 0

  return (
    <div className="px-3 sm:px-4 pb-3 border-b border-gray-100">
      <div className="bg-white rounded-xl border border-indigo-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-indigo-50/50">
          <div className="flex items-center gap-2">
            <span className="text-indigo-500">🎯</span>
            <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-wide">Maç Tahmini</h3>
          </div>
          {odds?.bookmaker && (
            <span className="text-[9px] text-indigo-400">{odds.bookmaker}{odds.live ? ' (canlı)' : ''}</span>
          )}
        </div>

        {loading ? (
          <div className="p-4 space-y-3 animate-pulse">
            <div className="h-4 w-40 bg-gray-200 rounded" />
            <div className="h-3 w-full bg-gray-100 rounded" />
            <div className="h-3 w-3/4 bg-gray-100 rounded" />
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {/* 1X2 */}
            <div>
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">1X2</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-indigo-50 rounded-lg p-2 text-center">
                  <div className="text-[9px] text-indigo-500 font-medium">{match.home}</div>
                  <div className="text-sm font-black text-indigo-700">{hp}%</div>
                  {o && <div className="text-[9px] text-indigo-400 font-mono">{o.homeWin.toFixed(2)}</div>}
                </div>
                <div className="bg-indigo-50 rounded-lg p-2 text-center">
                  <div className="text-[9px] text-indigo-500 font-medium">Berabere</div>
                  <div className="text-sm font-black text-indigo-700">{dp}%</div>
                  {o && <div className="text-[9px] text-indigo-400 font-mono">{o.draw.toFixed(2)}</div>}
                </div>
                <div className="bg-indigo-50 rounded-lg p-2 text-center">
                  <div className="text-[9px] text-indigo-500 font-medium">{match.away}</div>
                  <div className="text-sm font-black text-indigo-700">{ap}%</div>
                  {o && <div className="text-[9px] text-indigo-400 font-mono">{o.awayWin.toFixed(2)}</div>}
                </div>
              </div>
            </div>

            {/* O/U + BTTS */}
            <div className="grid grid-cols-2 gap-2">
              {overP > 0 && (
                <div className="bg-emerald-50 rounded-lg p-2">
                  <div className="text-[9px] text-emerald-500 font-medium mb-1">Over/Under {o?.ouLine ?? 2.5}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-700">Over {overP}%</span>
                    <span className="text-xs font-bold text-red-500">Under {underP}%</span>
                  </div>
                </div>
              )}
              {bttsYesP > 0 && (
                <div className="bg-amber-50 rounded-lg p-2">
                  <div className="text-[9px] text-amber-500 font-medium mb-1">Karşılıklı Gol</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-600">Var {bttsYesP}%</span>
                    <span className="text-xs font-bold text-red-500">Yok {bttsNoP}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Marj bilgisi */}
            {margin > 2 && (
              <div className="text-[9px] text-gray-400 text-center">
                Marj: %{margin.toFixed(1)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
