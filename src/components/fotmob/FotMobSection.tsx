'use client'

import type { FotMobMatchDetails } from '@/lib/fotmob'
import { FotMobStatsTab } from './FotMobStatsTab'
import { NetScoresEventsTab } from './NetScoresEventsTab'
import { NetScoresInfoTab } from './NetScoresInfoTab'

interface FotMobSectionProps {
  fotmobData: FotMobMatchDetails | null
  fotmobLoading: boolean
  fotmobTab: 'events' | 'stats' | 'info'
  setFotmobTab: (tab: 'events' | 'stats' | 'info') => void
  homeTeam: string
  awayTeam: string
}

export function FotMobSection({ fotmobData, fotmobLoading, fotmobTab, setFotmobTab, homeTeam, awayTeam }: FotMobSectionProps) {
  if (fotmobLoading) {
    return (
      <div className="p-4 sm:p-5 border-t border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-4 h-4 rounded bg-emerald-500 flex items-center justify-center text-[8px] text-white font-bold">⚓</div>
          <span className="text-sm font-bold text-gray-800">Maç Verisi</span>
        </div>
        <div className="flex items-center justify-center py-8 bg-gray-50 rounded-xl">
          <div className="animate-spin w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full mr-2" />
          <span className="text-sm text-gray-400">Maç verisi yükleniyor...</span>
        </div>
      </div>
    )
  }

  if (!fotmobData) {
    return (
      <div className="p-4 sm:p-5 border-t border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-4 h-4 rounded bg-gray-300 flex items-center justify-center text-[8px] text-white font-bold">⚓</div>
          <span className="text-sm font-bold text-gray-500">Maç Verisi</span>
          <span className="text-[10px] text-gray-400">Veri mevcut değil</span>
        </div>
      </div>
    )
  }

  const hasEvents = (fotmobData.events?.length ?? 0) > 0
  const hasStats = Object.keys(fotmobData.stats).length > 0
  const hasInfo = !!(fotmobData.infoBox?.stadium || fotmobData._netscores?.leagueState)

  const tabs: { key: 'events' | 'stats' | 'info'; label: string; available: boolean }[] = [
    { key: 'stats', label: 'Detay İstatistik', available: hasStats },
    { key: 'events', label: 'Olaylar', available: hasEvents },
    { key: 'info', label: 'Bilgi', available: hasInfo },
  ]

  const availableTabs = tabs.filter(t => t.available)
  const activeTab = availableTabs.find(t => t.key === fotmobTab) ? fotmobTab : (availableTabs[0]?.key || fotmobTab)

  return (
    <div className="p-4 sm:p-5 border-t border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-4 h-4 rounded bg-emerald-500 flex items-center justify-center text-[8px] text-white font-bold">⚓</div>
        <span className="text-sm font-bold text-gray-800">Maç Verisi</span>
      </div>

      {availableTabs.length > 0 && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5 mb-4 overflow-x-auto">
          {availableTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFotmobTab(tab.key)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'stats' && Object.keys(fotmobData.stats).length > 0 && (
        <FotMobStatsTab stats={fotmobData.stats} homeTeam={homeTeam} awayTeam={awayTeam} />
      )}
      {activeTab === 'events' && (fotmobData.events?.length ?? 0) > 0 && (
        <NetScoresEventsTab events={fotmobData.events as any[]} homeTeamName={homeTeam} awayTeamName={awayTeam} />
      )}
      {activeTab === 'info' && (
        <NetScoresInfoTab data={fotmobData} homeTeam={homeTeam} awayTeam={awayTeam} />
      )}
    </div>
  )
}
