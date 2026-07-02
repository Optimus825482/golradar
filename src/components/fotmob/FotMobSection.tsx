'use client'

import type { FotMobMatchDetails } from '@/lib/fotmob'
import { FotMobStatsTab } from './FotMobStatsTab'
import { NetScoresEventsTab } from './NetScoresEventsTab'
import { NetScoresInfoTab } from './NetScoresInfoTab'

// ——— Shared types ———

interface BlockProps {
  fotmobData: FotMobMatchDetails | null
  fotmobLoading: boolean
  homeTeam: string
  awayTeam: string
  homeScore?: number
  awayScore?: number
}

// ——— Loading skeleton ———

function BlockLoader() {
  return (
    <div className="flex items-center justify-center py-8 bg-gray-50 rounded-xl">
      <div className="animate-spin w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full mr-2" />
      <span className="text-sm text-gray-400">Yükleniyor...</span>
    </div>
  )
}

// ============================================================
//  FotMobStatsBlock
//  Shows shots, xG, cards, possession, etc.
// ============================================================

export function FotMobStatsBlock({ fotmobData, fotmobLoading, homeTeam, awayTeam }: BlockProps) {
  if (fotmobLoading) return <BlockLoader />
  if (!fotmobData || Object.keys(fotmobData.stats).length === 0) return null

  return <FotMobStatsTab stats={fotmobData.stats} homeTeam={homeTeam} awayTeam={awayTeam} />
}

// ============================================================
//  FotMobEventsBlock
//  Shows events timeline: goals, cards, subs
// ============================================================

export function FotMobEventsBlock({ fotmobData, fotmobLoading, homeTeam, awayTeam, homeScore, awayScore }: BlockProps) {
  if (fotmobLoading) return <BlockLoader />
  if (!fotmobData || (fotmobData.events?.length ?? 0) === 0) return null

  // Sanitize: biten maclarda event'lerdeki gol sayisi mac skorunu asiyorsa veri bozuk, gosterme
  if (homeScore != null && awayScore != null) {
    const totalGoalsInEvents = fotmobData.events.filter((e: any) => e.type === 'Goal').length;
    const actualTotal = homeScore + awayScore;
    if (totalGoalsInEvents > actualTotal) {
      // Try to filter events to only those consistent with match score
      let homeG = 0, awayG = 0;
      const validEvents = fotmobData.events.filter((e: any) => {
        if (e.type === 'Goal') {
          const isHome = e.isHome === true || e.isHome === 'true';
          if (isHome && homeG < homeScore) { homeG++; return true; }
          else if (!isHome && awayG < awayScore) { awayG++; return true; }
          else return false;
        }
        return true; // non-goal events pass through
      });
      // If filtering removed nothing but mismatch remains, hide entirely
      if (validEvents.length === fotmobData.events.length) return null;
      return <NetScoresEventsTab events={validEvents as any[]} homeTeamName={homeTeam} awayTeamName={awayTeam} />
    }
  }

  return <NetScoresEventsTab events={fotmobData.events as any[]} homeTeamName={homeTeam} awayTeamName={awayTeam} />
}

// ============================================================
//  FotMobInfoBlock
//  Shows weather, squad, formation, referee, H2H, etc.
// ============================================================

export function FotMobInfoBlock({ fotmobData, fotmobLoading, homeTeam, awayTeam }: BlockProps) {
  if (fotmobLoading) return <BlockLoader />
  if (!fotmobData) return null

  const hasInfo = !!(fotmobData.infoBox?.stadium || fotmobData._netscores?.leagueState)
  if (!hasInfo) return null

  return <NetScoresInfoTab data={fotmobData} homeTeam={homeTeam} awayTeam={awayTeam} />
}

// ============================================================
//  FotMobSection  (backward compat — stacks all 3 blocks)
// ============================================================

interface FotMobSectionProps {
  fotmobData: FotMobMatchDetails | null
  fotmobLoading: boolean
  fotmobTab?: 'events' | 'stats' | 'info'
  setFotmobTab?: (tab: 'events' | 'stats' | 'info') => void
  homeTeam: string
  awayTeam: string
}

export function FotMobSection({ fotmobData, fotmobLoading, homeTeam, awayTeam }: FotMobSectionProps) {
  if (fotmobLoading) {
    return (
      <div className="p-4 sm:p-5 border-t border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-4 h-4 rounded bg-emerald-500 flex items-center justify-center text-[8px] text-white font-bold">⚓</div>
          <span className="text-sm font-bold text-gray-800">Maç Verisi</span>
        </div>
        <BlockLoader />
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

  return (
    <div className="p-4 sm:p-5 border-t border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-4 h-4 rounded bg-emerald-500 flex items-center justify-center text-[8px] text-white font-bold">⚓</div>
        <span className="text-sm font-bold text-gray-800">Maç Verisi</span>
      </div>

      <div className="space-y-4">
        <FotMobStatsBlock fotmobData={fotmobData} fotmobLoading={fotmobLoading} homeTeam={homeTeam} awayTeam={awayTeam} />
        <FotMobEventsBlock fotmobData={fotmobData} fotmobLoading={fotmobLoading} homeTeam={homeTeam} awayTeam={awayTeam} />
        <FotMobInfoBlock fotmobData={fotmobData} fotmobLoading={fotmobLoading} homeTeam={homeTeam} awayTeam={awayTeam} />
      </div>
    </div>
  )
}
