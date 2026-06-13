'use client'

import { useState } from 'react'
import type { FotMobStatGroup } from '@/lib/fotmob'

export function FotMobStatsTab({ stats, homeTeam, awayTeam }: { stats: Record<string, FotMobStatGroup[]>; homeTeam: string; awayTeam: string }) {
  const periods = Object.keys(stats)
  const [selectedPeriod, setSelectedPeriod] = useState(periods[0] || 'All')

  const currentStats = stats[selectedPeriod] || []

  const statLabels: Record<string, string> = {
    possession: 'Topa Sahip %',
    dangerous_attacks: 'Tehlikeli Hücum',
    attacks: 'Hücum',
    shots_on_target: 'İsabetli Şut',
    shots_off_target: 'İsabetsiz Şut',
    shots_total: 'Toplam Şut',
    shots_blocked: 'Bloklanan Şut',
    corners: 'Korner',
    fouls: 'Faul',
    offsides: 'Ofsayt',
    saves: 'Kurtarış',
    yellow_cards: 'Sarı Kart',
    red_cards: 'Kırmızı Kart',
    xg: 'xG',
    key_passes: 'Kilit Pas',
    crosses: 'Orta',
    crossing_accuracy: 'Orta İsabeti',
    passing_accuracy: 'Pas İsabeti',
    action_areas: 'Eylem Alanı %',
    ball_safe: 'Güvenli Top',
    goals: 'Gol',
    penalties: 'Penaltı',
    substitutions: 'Değişiklik',
    injuries: 'Sakatlık',
    yellow_red_cards: 'Sarı-Kırmızı',
    corner_h: 'Korner (Ev)',
  }

  return (
    <div>
      {periods.length > 1 && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5 mb-3">
          {periods.map(p => (
            <button
              key={p}
              onClick={() => setSelectedPeriod(p)}
              className={`px-3 py-0.5 rounded-full text-[10px] font-semibold transition-all ${
                selectedPeriod === p
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p === 'All' ? 'Toplam' : p === '1H' ? '1. Yarı' : p === '2H' ? '2. Yarı' : p === 'FirstHalf' ? '1. Yarı' : p === 'SecondHalf' ? '2. Yarı' : p}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1">
        {currentStats.map((group, gi) => {
          if (group.type === 'title') return null
          if (!group.stats || group.stats.length < 2) return null

          const homeVal = group.stats[0]
          const awayVal = group.stats[1]
          if (homeVal == null && awayVal == null) return null

          const statKey = `${selectedPeriod}-${group.key}-${gi}`
          const statLabel = statLabels[group.key] || group.title || group.key
          const homeNum = typeof homeVal === 'number' ? homeVal : parseFloat(String(homeVal)) || 0
          const awayNum = typeof awayVal === 'number' ? awayVal : parseFloat(String(awayVal)) || 0

          const isPossession = group.key === 'possession'
          const isXg = group.key === 'xg'
          const isAccuracy = group.key === 'passing_accuracy' || group.key === 'crossing_accuracy' || group.key === 'action_areas'

          if (isPossession || isAccuracy) {
            const homePercent = homeNum
            const awayPercent = awayNum
            return (
              <div key={statKey} className="flex items-center gap-2 py-1 text-xs">
                <span className={`w-12 text-right font-mono font-semibold ${homeNum > awayNum ? 'text-orange-600' : 'text-gray-600'}`}>
                  {isXg ? homeNum.toFixed(2) : `${homeNum}%`}
                </span>
                <div className="flex-1">
                  <div className="text-center text-[9px] text-gray-400 mb-0.5">{statLabel}</div>
                  <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
                    <div className="bg-orange-400 transition-all duration-500 rounded-l-full" style={{ width: `${homePercent}%` }} />
                    <div className="bg-blue-400 transition-all duration-500 rounded-r-full" style={{ width: `${awayPercent}%` }} />
                  </div>
                </div>
                <span className={`w-12 text-left font-mono font-semibold ${awayNum > homeNum ? 'text-blue-600' : 'text-gray-600'}`}>
                  {isXg ? awayNum.toFixed(2) : `${awayNum}%`}
                </span>
              </div>
            )
          }

          const total = homeNum + awayNum
          if (total === 0) return null

          const homePercent = total > 0 ? Math.round((homeNum / total) * 100) : 50
          const awayPercent = total > 0 ? Math.round((awayNum / total) * 100) : 50

          return (
            <div key={statKey} className="flex items-center gap-2 py-1 text-xs">
              <span className={`w-12 text-right font-mono font-semibold ${homeNum > awayNum ? 'text-orange-600' : 'text-gray-600'}`}>
                {isXg ? homeNum.toFixed(2) : String(homeNum)}
              </span>
              <div className="flex-1">
                <div className="text-center text-[9px] text-gray-400 mb-0.5">{statLabel}</div>
                <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
                  <div className={`transition-all duration-500 rounded-l-full ${homeNum > awayNum ? 'bg-orange-500' : 'bg-orange-300'}`} style={{ width: `${homePercent}%` }} />
                  <div className={`transition-all duration-500 rounded-r-full ${awayNum > homeNum ? 'bg-blue-500' : 'bg-blue-300'}`} style={{ width: `${awayPercent}%` }} />
                </div>
              </div>
              <span className={`w-12 text-left font-mono font-semibold ${awayNum > homeNum ? 'text-blue-600' : 'text-gray-600'}`}>
                {isXg ? awayNum.toFixed(2) : String(awayNum)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
