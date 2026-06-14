'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Tabs, TabsList, TabsTrigger,
} from '@/components/ui/tabs'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer'
import { useIsMobile } from '@/hooks/use-mobile'
import { buildNetscoresMapping } from '@/lib/utils'
import {
  calculateGoalProbability,
  type GoalProbability,
  type MatchStats as NesineMatchStats,
} from '@/lib/nesine'
import type {
  FotMobMatchDetails,
} from '@/lib/fotmob'

import {
  calculateThreatIndex,
  calculateMomentumBars,
  calculateXgFlow,
  estimateXgFromShots,
  generateSyntheticSnapshots,
} from '@/lib/advancedAnalytics'
import { playGoalSound } from '@/lib/playGoalSound'
import SignalStatsPanel from '@/components/SignalStatsPanel'
import BacktestPanel from '@/components/BacktestPanel'
import SignalHistoryPanel from '@/components/SignalHistoryPanel'

import { Badge } from '@/components/ui/badge'
import type { Match, MatchStats, PressureSnapshot, GoalNotification, BottomTab } from '@/components/match/types'
import { statKeys, HALFTIME_STATUSES } from '@/components/match/types'
import { calculatePressure, ensureVisible, catmullRomPath, loadFavorites, saveFavorites } from '@/components/match/utils'
import { CountryFlag, MatchStatusBadge, GoalRadarIcon, StatBar } from '@/components/match/shared-components'
import { MatchCard } from '@/components/match/MatchCard'
import { FinishedMatchCard } from '@/components/match/FinishedMatchCard'
import { MatchDetailContent } from '@/components/match/MatchDetailContent'
import { MomentumChart } from '@/components/charts/MomentumChart'
import { StatsLineChart } from '@/components/charts/StatsLineChart'
import { UnifiedMatchMomentumChart } from '@/components/charts/UnifiedMatchMomentumChart'
import { FotMobSection } from '@/components/fotmob/FotMobSection'
import { FinishedMatchesView } from '@/components/match/FinishedMatchesView'
import { BottomNavBar } from '@/components/match/BottomNavBar'
import { GoalRadarSection } from '@/components/match/GoalRadarSection'

const POLL_INTERVAL = 15000
const GOAL_FLASH_DURATION = 15000

export default function OptimusGolRadariPage() {
  const [matches, setMatches] = useState<Match[]>([])
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null)
  const [pressureSnapshots, setPressureSnapshots] = useState<PressureSnapshot[]>([])
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<BottomTab>('all')
  const [sortBy, setSortBy] = useState<'league' | 'time'>('league')
  const [statsHalf, setStatsHalf] = useState<'full' | '1h' | '2h'>('full')
  const [allPressureData, setAllPressureData] = useState<Record<number, PressureSnapshot[]>>({})
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const retryCountRef = useRef(0)
  const MAX_RETRIES = 5

  // Favorites
  const [favorites, setFavorites] = useState<Set<number>>(new Set())

  // Goal notifications
  const [goalNotifications, setGoalNotifications] = useState<GoalNotification[]>([])

  // Goal flash tracking
  const [goalFlashMap, setGoalFlashMap] = useState<Record<number, number>>({})

  // Previous goals tracking
  const prevGoalsRef = useRef<Record<number, { home: number; away: number }>>({})

  // NetScores integration (replaces FotMob)
  const [fotmobData, setFotmobData] = useState<FotMobMatchDetails | null>(null)
  const [fotmobLoading, setFotmobLoading] = useState(false)
  const [netscoresMapping, setNetscoresMapping] = useState<Record<number, string>>({})
  const [fotmobTab, setFotmobTab] = useState<'events' | 'stats' | 'info'>('stats')

  // Finished matches
  const [finishedMatches, setFinishedMatches] = useState<Match[]>([])
  const [finishedLoading, setFinishedLoading] = useState(false)
  const [finishedError, setFinishedError] = useState<string | null>(null)
  const [finishedDate, setFinishedDate] = useState<string>('')
  const [finishedNetscoresMapping, setFinishedNetscoresMapping] = useState<Record<number, string>>({})

  // Scoremer integration for finished matches
  const [scoremerStats, setScoremerStats] = useState<Record<string, { home: number | null; away: number | null }> | null>(null)
  const [scoremerHtStats, setScoremerHtStats] = useState<Record<string, { home: number | null; away: number | null }> | null>(null)
  const [scoremerLoading, setScoremerLoading] = useState(false)
  const [scoremerMapping, setScoremerMapping] = useState<Record<number, string>>({})
  const [scoremerHtScore, setScoremerHtScore] = useState<string | null>(null)

  // Goaloo odds movement for live matches
  const [goalooOddsMovement, setGoalooOddsMovement] = useState<{
    homeBoost: number; awayBoost: number; significance: string
  } | null>(null)

  // Goaloo match ID mapping (Nesine code → Goaloo matchId)
  const [goalooMatchIdMap, setGoalooMatchIdMap] = useState<Record<number, number>>({})

  // Panel open state (drawer on mobile, sheet on desktop)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeChartTab, setActiveChartTab] = useState<string>('pressure')
  const isMobile = useIsMobile()

  // Load favorites on mount (after hydration to avoid mismatch)
  const [favoritesLoaded, setFavoritesLoaded] = useState(false)
  useEffect(() => {
    setFavorites(loadFavorites())
    const now = new Date()
    const istanbulOffset = 3 * 60
    const localOffset = now.getTimezoneOffset()
    const istanbulMs = now.getTime() + (istanbulOffset + localOffset) * 60000
    const istanbulDate = new Date(istanbulMs)
    setFinishedDate(istanbulDate.toISOString().slice(0, 10))
    setFavoritesLoaded(true)
  }, [])

  const toggleFavorite = useCallback((matchCode: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(matchCode)) next.delete(matchCode)
      else next.add(matchCode)
      saveFavorites(next)
      return next
    })
  }, [])

  // Fetch matches
  const fetchMatches = useCallback(async () => {
    try {
      const resp = await fetch('/api/matches', { cache: 'no-store' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      setMatches(data.matches || [])
      setAllPressureData(data.pressureData || {})
      setLastUpdate(new Date())
      setError(null)
      retryCountRef.current = 0

      const halftimeCodes = new Set<number>()
      for (const m of (data.matches || [])) {
        if (HALFTIME_STATUSES.has(m.status)) halftimeCodes.add(m.code)
      }
      if (halftimeCodes.size > 0) {
        fetch('/api/goal-signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'expireHalftime', matchCodes: [...halftimeCodes] }),
        }).catch(() => {})
      }

      if (selectedMatch && data.pressureData && data.pressureData[selectedMatch.code]) {
        const updatedMatch = (data.matches || []).find((m: Match) => m.code === selectedMatch.code)
        const isHalftime = updatedMatch ? HALFTIME_STATUSES.has(updatedMatch.status) : false
        if (!isHalftime) {
          setPressureSnapshots(data.pressureData[selectedMatch.code])
        }
      }

      setSelectedMatch(prev => {
        if (!prev) return prev
        const updated = (data.matches || []).find((m: Match) => m.code === prev.code)
        return updated || prev
      })

      setIsLoading(false)
    } catch (err) {
      console.error('Fetch error:', err)
      retryCountRef.current += 1
      if (matches.length === 0) {
        if (retryCountRef.current > MAX_RETRIES) {
          setError('Sunucuya bağlanılamadı. Lütfen daha sonra tekrar deneyin.')
        } else {
          setError('Veri alınamadı. Tekrar denenecek...')
        }
      }
      setIsLoading(false)
      if (retryCountRef.current <= MAX_RETRIES + 3) {
        const delay = Math.min(3000 * Math.pow(2, Math.min(retryCountRef.current - 1, 5)), 120000)
        setTimeout(() => fetchMatches(), delay)
      }
    }
  }, [selectedMatch, matches.length])

  useEffect(() => {
    fetchMatches()
    intervalRef.current = setInterval(fetchMatches, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchMatches])

  const handleCloseMatch = useCallback(() => {
    setDrawerOpen(false)
    setTimeout(() => setSelectedMatch(null), 300)
  }, [])

  // Build NetScores mapping when matches change
  useEffect(() => {
    if (matches.length === 0) return
    buildNetscoresMapping(matches.map(m => ({ code: m.code, home: m.home, away: m.away, time: m.time })))
      .then(setNetscoresMapping)
      .catch(() => {})
  }, [matches])

  const fetchNetScoresDetails = useCallback(async (match: Match, mapping?: Record<number, string>) => {
    setFotmobData(null)
    setFotmobLoading(true)
    const mappingToUse = mapping || netscoresMapping
    try {
      const netscoresUrl = mappingToUse[match.code]
      const params = new URLSearchParams({
        action: 'details',
        matchCode: String(match.code),
        home: match.home,
        away: match.away,
        time: match.time,
      })
      if (netscoresUrl) params.set('url', netscoresUrl)
      const resp = await fetch(`/api/netscores?${params.toString()}`)
      if (resp.ok) {
        const data = await resp.json()
        if (data.details) {
          setFotmobData(data.details)
          if (data.netscoresUrl && !mappingToUse[match.code]) {
            setNetscoresMapping(prev => ({ ...prev, [match.code]: data.netscoresUrl }))
          }
          setFotmobLoading(false)
          return
        }
      }
    } catch (err) {
      console.error('NetScores fetch error:', err)
    }
    setFotmobLoading(false)
  }, [netscoresMapping])

  // Fetch finished matches
  const fetchFinishedMatches = useCallback(async (date?: string) => {
    setFinishedLoading(true)
    setFinishedError(null)
    try {
      const dateParam = date || finishedDate
      const resp = await fetch(`/api/finished-matches?date=${dateParam}`, { cache: 'no-store' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      setFinishedMatches(data.matches || [])
    } catch (err) {
      console.error('Finished matches fetch error:', err)
      setFinishedError('Biten maçlar yüklenemedi')
    }
    setFinishedLoading(false)
  }, [finishedDate])

  // Build NetScores mapping for finished matches
  useEffect(() => {
    if (finishedMatches.length === 0) return
    buildNetscoresMapping(finishedMatches.map(m => ({ code: m.code, home: m.home, away: m.away, time: m.time })))
      .then(setFinishedNetscoresMapping)
      .catch(() => {})
  }, [finishedMatches])

  // Build Scoremer mapping for finished matches
  useEffect(() => {
    if (finishedMatches.length === 0) return
    const buildScoremerMappingFn = async () => {
      try {
        const matchList = finishedMatches.map(m => ({
          code: m.code,
          home: m.home,
          away: m.away,
          time: m.time,
        }))
        const resp = await fetch(`/api/scoremer?action=mapping&matches=${encodeURIComponent(JSON.stringify(matchList))}`)
        if (resp.ok) {
          const data = await resp.json()
          const map: Record<number, string> = {}
          for (const m of data.mappings || []) {
            map[m.nesineCode] = m.scoremerId
          }
          setScoremerMapping(map)
        }
      } catch {}
    }
    buildScoremerMappingFn()
  }, [finishedMatches])

  // Fetch Scoremer stats for a match
  const fetchScoremerDetails = useCallback(async (match: Match) => {
    setScoremerStats(null)
    setScoremerHtStats(null)
    setScoremerHtScore(null)
    setScoremerLoading(true)
    try {
      const scoremerId = scoremerMapping[match.code]
      const params = new URLSearchParams({
        action: 'details',
        matchCode: String(match.code),
        home: match.home,
        away: match.away,
        time: match.time,
      })
      if (scoremerId) params.set('scoremerId', scoremerId)
      const resp = await fetch(`/api/scoremer?${params.toString()}`)
      if (resp.ok) {
        const data = await resp.json()
        if (data.stats) {
          setScoremerStats(data.stats)
          setScoremerHtStats(data.htStats || null)
          if (data.htScore) setScoremerHtScore(data.htScore)
          if (data.scoremerId && !scoremerMapping[match.code]) {
            setScoremerMapping(prev => ({ ...prev, [match.code]: data.scoremerId }))
          }
        }
      }
    } catch (err) {
      console.error('Scoremer fetch error:', err)
    }
    setScoremerLoading(false)
  }, [scoremerMapping])

  const handleSelectMatch = useCallback((match: Match) => {
    setSelectedMatch(match)
    setStatsHalf('full')
    setPressureSnapshots(allPressureData[match.code] || [])
    setDrawerOpen(true)
    setScoremerStats(null)
    setScoremerHtStats(null)
    setScoremerHtScore(null)
    setGoalooOddsMovement(null)
    const mapping = match.isFinished ? finishedNetscoresMapping : netscoresMapping
    fetchNetScoresDetails(match, mapping)
    if (match.isFinished) fetchScoremerDetails(match)

    const cachedGoalooId = goalooMatchIdMap[match.code]
    if (cachedGoalooId) {
      fetch(`/api/goaloo?action=oddsMovement&matchId=${cachedGoalooId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && data.significance && data.significance !== 'none') {
            setGoalooOddsMovement({ homeBoost: data.homeBoost || 0, awayBoost: data.awayBoost || 0, significance: data.significance })
          }
        })
        .catch(() => {})
    } else {
      const matchDate = match.isFinished
        ? (finishedDate || new Date().toISOString().slice(0, 10))
        : new Date().toISOString().slice(0, 10)
      fetch(`/api/goaloo?action=resolve&home=${encodeURIComponent(match.home)}&away=${encodeURIComponent(match.away)}&date=${matchDate}&time=${match.time || ''}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && data.found && data.goalooMatchId) {
            setGoalooMatchIdMap(prev => ({ ...prev, [match.code]: data.goalooMatchId }))
            fetch(`/api/goaloo?action=oddsMovement&matchId=${data.goalooMatchId}`)
              .then(r => r.ok ? r.json() : null)
              .then(odata => {
                if (odata && odata.significance && odata.significance !== 'none') {
                  setGoalooOddsMovement({ homeBoost: odata.homeBoost || 0, awayBoost: odata.awayBoost || 0, significance: odata.significance })
                }
              })
              .catch(() => {})
          }
        })
        .catch(() => {})
    }
  }, [allPressureData, netscoresMapping, finishedNetscoresMapping, fetchScoremerDetails, goalooMatchIdMap, finishedDate])

  // Fetch finished matches when tab changes to 'finished' OR when there are no live matches
  useEffect(() => {
    if ((activeTab === 'finished' || matches.length === 0) && finishedMatches.length === 0 && !finishedLoading) {
      fetchFinishedMatches()
    }
  }, [activeTab, matches.length, finishedMatches.length, fetchFinishedMatches, finishedLoading])

  // Goal Detection
  useEffect(() => {
    const prevGoals = prevGoalsRef.current
    const now = Date.now()

    for (const m of matches) {
      const prev = prevGoals[m.code]
      if (!prev) continue

      const homeScored = m.homeGoals > prev.home
      const awayScored = m.awayGoals > prev.away

      if (homeScored || awayScored) {
        setGoalFlashMap(p => ({ ...p, [m.code]: now }))

        fetch(`/api/goal-signals?action=finalize&matchCode=${m.code}&homeScore=${m.homeGoals}&awayScore=${m.awayGoals}`)
          .catch(() => {})

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('goal-scored', { detail: { matchCode: m.code } }))
        }

        if (favorites.has(m.code)) {
          playGoalSound()
          const notification: GoalNotification = {
            id: `${m.code}-${now}`,
            matchCode: m.code,
            home: m.home, away: m.away,
            homeGoals: m.homeGoals, awayGoals: m.awayGoals,
            scoringTeam: homeScored ? 'home' : 'away',
            league: m.league, minute: m.minute, timestamp: now,
          }
          setGoalNotifications(p => [...p, notification])
          setTimeout(() => {
            setGoalNotifications(p => p.filter(n => n.id !== notification.id))
          }, 8000)
        }
      }
    }

    const newPrev: Record<number, { home: number; away: number }> = {}
    for (const m of matches) {
      newPrev[m.code] = { home: m.homeGoals, away: m.awayGoals }
    }
    prevGoalsRef.current = newPrev
  }, [matches, favorites])

  // Clean up old goal flashes
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setGoalFlashMap(prev => {
        const next: Record<number, number> = {}
        for (const [code, ts] of Object.entries(prev)) {
          if (now - ts < GOAL_FLASH_DURATION) next[Number(code)] = ts
        }
        return next
      })
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Goal probabilities + Signal tracking (via API for persistence)
  const goalProbabilities = useMemo(() => {
    const map = new Map<number, GoalProbability>()
    for (const m of matches) {
      if (!m.isLive || !m.hasStats || (m.status === 3 || m.status === 28)) continue
      if (m.goalRadar && m.goalRadar.score >= 60 && m.goalRadar.goalProbability5min >= 0.25) {
        map.set(m.code, m.goalRadar)
        if (m.goalRadar.score >= 60 && m.goalRadar.side) {
          fetch('/api/goal-signals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              matchCode: m.code, homeTeam: m.home, awayTeam: m.away, league: m.league,
              matchTime: m.time, minute: m.minute, score: m.goalRadar.score,
              side: m.goalRadar.side, homeGoals: m.homeGoals, awayGoals: m.awayGoals,
              homeScore: m.goalRadar.homeScore, awayScore: m.goalRadar.awayScore,
              level: m.goalRadar.level, factors: m.goalRadar.factors,
              calibratedP: m.goalRadar.calibratedP, poissonP: m.goalRadar.poissonP,
            }),
          }).catch(() => {})
        }
        continue
      }
      const history = allPressureData[m.code]
      const prob = calculateGoalProbability(
        m.stats, m.minute, m.isLive, history, m.homeGoals, m.awayGoals, m.home, m.away,
      )
      if (prob.score >= 60 && prob.goalProbability5min >= 0.25) {
        map.set(m.code, prob)
        if (prob.score >= 60 && prob.side) {
          fetch('/api/goal-signals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              matchCode: m.code, homeTeam: m.home, awayTeam: m.away, league: m.league,
              matchTime: m.time, minute: m.minute, score: prob.score,
              side: prob.side, homeGoals: m.homeGoals, awayGoals: m.awayGoals,
              homeScore: prob.homeScore, awayScore: prob.awayScore,
              level: prob.level, factors: prob.factors,
              calibratedP: prob.calibratedP, poissonP: prob.poissonP,
            }),
          }).catch(() => {})
        }
      }
    }
    return map
  }, [matches, allPressureData])

  const radarCount = goalProbabilities.size

  // Filter matches based on bottom tab
  const filteredMatches = useMemo(() => {
    if (activeTab === 'live') return matches.filter(m => m.isLive)
    if (activeTab === 'radar') return matches.filter(m => goalProbabilities.has(m.code))
    if (activeTab === 'favorites') return matches.filter(m => favorites.has(m.code))
    return matches
  }, [matches, activeTab, goalProbabilities, favorites])

  const favCount = matches.filter(m => favorites.has(m.code)).length
  const liveCount = matches.filter(m => m.isLive).length

  // Sort & group matches
  const groupedMatches = useMemo(() => {
    if (sortBy === 'league') {
      const groups: Record<string, Match[]> = {}
      for (const m of filteredMatches) {
        if (!groups[m.league]) groups[m.league] = []
        groups[m.league].push(m)
      }
      return { mode: 'league' as const, groups }
    } else {
      const sorted = [...filteredMatches].sort((a, b) => {
        const timeCompare = a.time.localeCompare(b.time)
        if (timeCompare !== 0) return timeCompare
        return a.league.localeCompare(b.league, 'tr')
      })
      return { mode: 'time' as const, flat: sorted }
    }
  }, [filteredMatches, sortBy])

  // Half-filtered snapshots
  const halftimeIdx = useMemo(() => {
    const snaps = pressureSnapshots
    if (!snaps || snaps.length === 0) return -1
    for (let i = 1; i < snaps.length; i++) {
      const prevMin = snaps[i - 1].minute
      const curMin = snaps[i].minute
      const prevNum = parseInt(prevMin.replace(/[^0-9]/g, ''), 10) || 0
      const curNum = parseInt(curMin.replace(/[^0-9]/g, ''), 10) || 0
      if (prevNum <= 45 && (curMin.includes('DA') || curNum >= 46)) return i - 1
    }
    return -1
  }, [pressureSnapshots])

  const filteredSnapshots = useMemo(() => {
    if (statsHalf === 'full' || !pressureSnapshots || pressureSnapshots.length === 0) return pressureSnapshots
    if (statsHalf === '1h') return halftimeIdx === -1 ? pressureSnapshots : pressureSnapshots.slice(0, halftimeIdx + 1)
    if (statsHalf === '2h') return halftimeIdx === -1 ? [] : pressureSnapshots.slice(halftimeIdx + 1)
    return pressureSnapshots
  }, [pressureSnapshots, statsHalf, halftimeIdx])

  const pressureChartData = useMemo(() => {
    return filteredSnapshots.map((snap, idx) => ({
      index: idx + 1,
      minute: snap.minute || `${idx + 1}`,
      homePressure: snap.homePressure,
      awayPressure: snap.awayPressure,
    }))
  }, [filteredSnapshots])

  const statsChartData = useMemo(() => {
    if (statsHalf === '2h' && halftimeIdx >= 0) {
      const htStats = pressureSnapshots[halftimeIdx].stats
      return filteredSnapshots.map((snap, idx) => ({
        index: idx + 1,
        minute: snap.minute || `${idx + 1}`,
        homeDangerousAttacks: (snap.stats.dangerous_attacks?.home ?? 0) - (htStats.dangerous_attacks?.home ?? 0),
        awayDangerousAttacks: (snap.stats.dangerous_attacks?.away ?? 0) - (htStats.dangerous_attacks?.away ?? 0),
        homeShotsTotal: (snap.stats.shots_total?.home ?? 0) - (htStats.shots_total?.home ?? 0),
        awayShotsTotal: (snap.stats.shots_total?.away ?? 0) - (htStats.shots_total?.away ?? 0),
        homeCorners: (snap.stats.corners?.home ?? 0) - (htStats.corners?.home ?? 0),
        awayCorners: (snap.stats.corners?.away ?? 0) - (htStats.corners?.away ?? 0),
        homePossession: snap.stats.possession?.home ?? 0,
        awayPossession: snap.stats.possession?.away ?? 0,
      }))
    }
    return filteredSnapshots.map((snap, idx) => ({
      index: idx + 1,
      minute: snap.minute || `${idx + 1}`,
      homeDangerousAttacks: snap.stats.dangerous_attacks?.home ?? 0,
      awayDangerousAttacks: snap.stats.dangerous_attacks?.away ?? 0,
      homeShotsTotal: snap.stats.shots_total?.home ?? 0,
      awayShotsTotal: snap.stats.shots_total?.away ?? 0,
      homeCorners: snap.stats.corners?.home ?? 0,
      awayCorners: snap.stats.corners?.away ?? 0,
      homePossession: snap.stats.possession?.home ?? 0,
      awayPossession: snap.stats.possession?.away ?? 0,
    }))
  }, [filteredSnapshots, statsHalf, halftimeIdx, pressureSnapshots])

  const currentPressure = selectedMatch ? calculatePressure(selectedMatch.stats) : { home: 50, away: 50 }

  // Synthetic snapshots from Scoremer data
  const syntheticSnapshots = useMemo(() => {
    if (!selectedMatch) return []
    if (pressureSnapshots.length >= 10) return []
    if (!scoremerStats || Object.keys(scoremerStats).length === 0) return []
    const effectiveHtScore = (selectedMatch.firstHalfScore && selectedMatch.firstHalfScore !== '-')
      ? selectedMatch.firstHalfScore
      : scoremerHtScore || undefined
    return generateSyntheticSnapshots(scoremerStats as NesineMatchStats, scoremerHtStats as NesineMatchStats, selectedMatch.homeGoals, selectedMatch.awayGoals, effectiveHtScore)
  }, [selectedMatch, pressureSnapshots.length, scoremerStats, scoremerHtStats, scoremerHtScore])

  // Merge real + synthetic snapshots
  const mergedSnapshots = useMemo(() => {
    if (syntheticSnapshots.length === 0) return pressureSnapshots
    if (pressureSnapshots.length < 2) return syntheticSnapshots
    const realByMinute = new Map<number, typeof pressureSnapshots[0]>()
    for (const snap of pressureSnapshots) {
      const min = parseInt(snap.minute.replace(/[^0-9]/g, ''), 10) || 0
      realByMinute.set(min, snap)
    }
    const merged = [...syntheticSnapshots]
    for (let i = 0; i < merged.length; i++) {
      const min = parseInt(merged[i].minute.replace(/[^0-9]/g, ''), 10) || 0
      for (const [realMin, realSnap] of realByMinute) {
        if (Math.abs(realMin - min) <= 3) {
          merged[i] = realSnap
          realByMinute.delete(realMin)
          break
        }
      }
    }
    for (const [, snap] of realByMinute) merged.push(snap)
    merged.sort((a, b) => {
      const ma = parseInt(a.minute.replace(/[^0-9]/g, ''), 10) || 0
      const mb = parseInt(b.minute.replace(/[^0-9]/g, ''), 10) || 0
      return ma - mb
    })
    return merged
  }, [pressureSnapshots, syntheticSnapshots])

  // Advanced Analytics
  const momentumBars = useMemo(() => {
    if (!selectedMatch) return []
    const snaps = mergedSnapshots.length >= 2 ? mergedSnapshots : pressureSnapshots
    if (snaps.length < 2) return []
    return calculateMomentumBars(snaps)
  }, [selectedMatch, pressureSnapshots, mergedSnapshots])

  const xgFlowData = useMemo(() => {
    if (!selectedMatch) return []
    const snaps = mergedSnapshots.length >= 1 ? mergedSnapshots : pressureSnapshots
    if (snaps.length < 1) return []
    return calculateXgFlow(snaps)
  }, [selectedMatch, pressureSnapshots, mergedSnapshots])

  const threatIndex = useMemo(() => {
    if (!selectedMatch || !selectedMatch.isLive || !selectedMatch.hasStats) return null
    return calculateThreatIndex(selectedMatch.stats, selectedMatch.minute, pressureSnapshots)
  }, [selectedMatch, pressureSnapshots])

  // Half-filtered stats
  const filteredStats = useMemo(() => {
    if (!selectedMatch || statsHalf === 'full') return selectedMatch?.stats || {}
    const snapshots = pressureSnapshots
    if (!snapshots || snapshots.length === 0) return selectedMatch.stats
    if (statsHalf === '1h') return halftimeIdx === -1 ? selectedMatch.stats : snapshots[halftimeIdx].stats
    if (statsHalf === '2h') {
      if (halftimeIdx === -1) {
        const empty = {} as NesineMatchStats
        for (const key of Object.keys(selectedMatch.stats)) empty[key] = { home: 0, away: 0 }
        return empty
      }
      const htStats = snapshots[halftimeIdx].stats
      const currentStats = selectedMatch.stats
      const secondHalfStats = {} as NesineMatchStats
      for (const key of Object.keys(currentStats)) {
        const cur = currentStats[key]
        const ht = htStats[key]
        if (cur && ht) {
          if (key === 'possession') {
            secondHalfStats[key] = cur
          } else {
            const homeDiff = (cur.home ?? 0) - (ht.home ?? 0)
            const awayDiff = (cur.away ?? 0) - (ht.away ?? 0)
            secondHalfStats[key] = { home: homeDiff > 0 ? homeDiff : 0, away: awayDiff > 0 ? awayDiff : 0 }
          }
        } else if (cur) {
          secondHalfStats[key] = cur
        }
      }
      return secondHalfStats
    }
    return selectedMatch.stats
  }, [selectedMatch, statsHalf, pressureSnapshots, halftimeIdx])

  // Client-side goal prob for detail panel
  const selectedGoalProb = useMemo(() => {
    if (!selectedMatch) return null
    const serverRadar = selectedMatch.goalRadar
    const clientCalc = calculateGoalProbability(
      selectedMatch.stats, selectedMatch.minute, selectedMatch.isLive,
      pressureSnapshots, selectedMatch.homeGoals, selectedMatch.awayGoals,
      selectedMatch.home, selectedMatch.away, goalooOddsMovement,
    )
    if (serverRadar && clientCalc.score < serverRadar.score && pressureSnapshots.length < 3) return serverRadar
    return clientCalc.score >= 60 && clientCalc.goalProbability5min >= 0.25 ? clientCalc : (serverRadar || null)
  }, [selectedMatch, pressureSnapshots, goalooOddsMovement])

  // Detail content props shared between desktop and mobile
  const detailProps = selectedMatch ? {
    match: selectedMatch, currentPressure, selectedGoalProb,
    pressureChartData, statsChartData, momentumBars, xgFlowData, threatIndex,
    filteredStats, statsHalf, setStatsHalf, fotmobData, fotmobLoading,
    fotmobTab, setFotmobTab, scoremerStats, scoremerHtStats, scoremerLoading,
    goalooMatchId: goalooMatchIdMap[selectedMatch.code] || 0,
    activeChartTab, setActiveChartTab,
  } : null

  // Render match list based on sort mode
  const renderMatchList = () => {
    if (activeTab === 'signal-history') {
      return (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setActiveTab('finished')}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Biten Maçlar
            </button>
          </div>
          <SignalHistoryPanel />
        </div>
      )
    }

    if (activeTab === 'finished') {
      return (
        <FinishedMatchesView
          finishedMatches={finishedMatches}
          finishedLoading={finishedLoading}
          finishedError={finishedError}
          finishedDate={finishedDate}
          finishedNetscoresMapping={finishedNetscoresMapping}
          scoremerMapping={scoremerMapping}
          selectedMatch={selectedMatch}
          favorites={favorites}
          onSelectMatch={handleSelectMatch}
          onToggleFavorite={toggleFavorite}
          onFetchFinished={fetchFinishedMatches}
          onSetDate={setFinishedDate}
          onSetActiveTab={setActiveTab as any}
          setFinishedMatches={setFinishedMatches}
        />
      )
    }

    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full mb-4" />
          <p className="text-gray-500 text-sm">Maçlar yükleniyor...</p>
        </div>
      )
    }
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="text-5xl mb-4">📡</div>
          <p className="text-red-500 text-sm mb-2">{error}</p>
          <button onClick={fetchMatches} className="text-emerald-600 text-sm underline hover:no-underline">Tekrar dene</button>
          <button onClick={() => setActiveTab('finished')} className="text-blue-600 text-sm underline hover:no-underline mt-2">
            Biten maçlara göz at →
          </button>
        </div>
      )
    }
    if (filteredMatches.length === 0) {
      const tab = activeTab as BottomTab
      const tabLabel = tab === 'live' ? 'canlı'
        : tab === 'radar' ? 'radar'
        : tab === 'favorites' ? 'favori'
        : tab === 'finished' ? 'biten'
        : tab === 'signal-history' ? 'sinyal geçmişi'
        : ''
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="text-5xl mb-4">⚽</div>
          <p className="text-gray-500 text-sm mb-3">Şu an {tabLabel} maç yok</p>
          {tab !== 'finished' && tab !== 'signal-history' && (
            <button onClick={() => setActiveTab('finished')} className="px-4 py-2 bg-blue-50 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-100 transition-colors">
              Biten maçlara göz at →
            </button>
          )}
        </div>
      )
    }

    if (activeTab === 'radar') {
      return (
        <GoalRadarSection
          matches={filteredMatches}
          goalProbabilities={goalProbabilities}
          selectedMatch={selectedMatch}
          favorites={favorites}
          goalFlashMap={goalFlashMap}
          onSelectMatch={handleSelectMatch}
          onToggleFavorite={toggleFavorite}
        />
      )
    }

    if (groupedMatches.mode === 'league') {
      return Object.entries(groupedMatches.groups).map(([league, leagueMatches]) => (
        <div key={league} className="mb-3">
          <div className="flex items-center gap-2 px-3 py-1.5 mb-0.5">
            <CountryFlag code={leagueMatches[0]?.country || ''} />
            <h2 className="text-xs font-bold text-gray-800 uppercase tracking-wide">{league}</h2>
            <span className="text-[10px] text-gray-400 ml-auto">{leagueMatches.length}</span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            {leagueMatches.map(match => (
              <MatchCard key={match.code} match={match} onClick={() => handleSelectMatch(match)}
                goalProb={goalProbabilities.get(match.code)}
                isSelected={selectedMatch?.code === match.code}
                isFavorite={favorites.has(match.code)}
                onToggleFavorite={(e) => toggleFavorite(match.code, e)}
                hasGoalFlash={!!goalFlashMap[match.code]} />
            ))}
          </div>
        </div>
      ))
    } else {
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 px-3 py-1.5 mb-0.5">
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-xs font-bold text-gray-800 uppercase tracking-wide">Zamana Göre</h2>
            <span className="text-[10px] text-gray-400 ml-auto">{groupedMatches.flat.length}</span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            {groupedMatches.flat.map(match => (
              <MatchCard key={match.code} match={match} onClick={() => handleSelectMatch(match)} showLeague
                goalProb={goalProbabilities.get(match.code)}
                isSelected={selectedMatch?.code === match.code}
                isFavorite={favorites.has(match.code)}
                onToggleFavorite={(e) => toggleFavorite(match.code, e)}
                hasGoalFlash={!!goalFlashMap[match.code]} />
            ))}
          </div>
        </div>
      )
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col touch-manipulation">
      {/* ── Compact App Header ─────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm safe-top">
        <div className="max-w-[1400px] mx-auto px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo-192.png" alt="Gol Radarı" className="w-8 h-8 rounded-lg shadow-sm object-cover" />
            <div>
              <h1 className="text-base font-bold text-gray-900 tracking-tight leading-tight">Gol Radarı</h1>
              <p className="text-[10px] text-gray-400 leading-tight">
                {lastUpdate ? lastUpdate.toLocaleTimeString('tr-TR') : '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSortBy(sortBy === 'league' ? 'time' : 'league')}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 hover:bg-gray-200 transition-colors"
              aria-label={sortBy === 'league' ? 'Zamana göre sırala' : 'Lige göre sırala'}
              title={sortBy === 'league' ? 'Lig sıralaması' : 'Zaman sıralaması'}
            >
              {sortBy === 'league' ? (
                <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </button>
            {liveCount > 0 && (
              <Badge className="bg-emerald-50 text-emerald-700 text-[10px] hover:bg-emerald-50 border border-emerald-200 px-2 py-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />
                {liveCount}
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* ── Goal Radar Alert Banner ──────────────────────────── */}
      {radarCount > 0 && activeTab !== 'radar' && (
        <div className="bg-gradient-to-r from-red-500 via-red-600 to-red-500 border-b border-red-700">
          <div className="max-w-[1400px] mx-auto px-3 py-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="relative">
                <svg className="w-4 h-4 text-white animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full animate-ping" />
              </div>
              <span className="text-white text-xs font-bold">GOL RADARI</span>
              <span className="text-red-100 text-[10px]">{radarCount} maç</span>
            </div>
            <button
              onClick={() => setActiveTab('radar')}
              className="px-2.5 py-0.5 bg-white/20 hover:bg-white/30 text-white text-[10px] font-semibold rounded-full transition-all backdrop-blur-sm"
            >
              Görüntüle →
            </button>
          </div>
        </div>
      )}

      {/* ── Main Content Area ──────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100dvh - 56px - 60px - env(safe-area-inset-top) - env(safe-area-inset-bottom))' }}>
        <div className={`transition-all duration-300 ease-in-out overflow-y-auto -webkit-overflow-scrolling-touch ${selectedMatch ? 'md:w-[40%] w-full' : 'w-full'}`}>
          <div className={`${selectedMatch ? 'max-w-full' : 'max-w-[1400px]'} mx-auto p-3 pb-20`}>
            {renderMatchList()}
          </div>
        </div>

        {selectedMatch && detailProps && (
          <div className="hidden md:flex w-[60%] border-l border-gray-200 overflow-y-auto bg-white flex-col">
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600">Maç Detayı</span>
              <button onClick={handleCloseMatch} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600" aria-label="Kapat">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div><MatchDetailContent {...(detailProps as any)} /></div>
          </div>
        )}
      </div>

      {/* ── Match Detail Panel (Mobile Drawer) ── */}
      {isMobile ? (
        <Drawer open={drawerOpen} onOpenChange={(open) => { if (!open) handleCloseMatch() }} shouldScaleBackground>
          <DrawerContent className="max-h-[92dvh]">
            <DrawerHeader className="p-3 pb-0">
              <DrawerTitle className="text-sm font-semibold text-gray-700">
                {selectedMatch ? `${selectedMatch.home} vs ${selectedMatch.away}` : 'Maç Detayı'}
              </DrawerTitle>
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <DrawerDescription className="text-[10px] text-gray-400">{selectedMatch?.league}</DrawerDescription>
                <span className="text-gray-300">·</span>
                <MatchStatusBadge match={selectedMatch!} />
              </div>
            </DrawerHeader>
            <div className="overflow-y-auto -webkit-overflow-scrolling-touch" style={{ maxHeight: 'calc(92dvh - 80px)' }}>
              {selectedMatch && detailProps && <MatchDetailContent {...(detailProps as any)} />}
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}

      {/* ── Sticky Footer Navigation Bar ──────────────────────── */}
      <BottomNavBar
        activeTab={activeTab}
        liveCount={liveCount}
        radarCount={radarCount}
        favCount={favCount}
        finishedCount={finishedMatches.length || undefined}
        onTabChange={setActiveTab}
      />

      {/* Goal Notifications Portal */}
      {goalNotifications.length > 0 && favoritesLoaded && createPortal(
        <div className="fixed top-16 right-3 z-[100] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: '340px' }}>
          {goalNotifications.map(notif => (
            <div key={notif.id}
              className="pointer-events-auto animate-[slideInRight_0.4s_ease-out] bg-gradient-to-r from-green-500 via-emerald-500 to-green-600 rounded-xl shadow-2xl border border-green-400 p-3 text-white"
              style={{ animation: 'slideInRight 0.4s ease-out' }}>
              <div className="flex items-center gap-2 mb-1">
                <div className="relative">
                  <div className="text-lg">⚽</div>
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-ping" />
                </div>
                <span className="font-black text-sm tracking-wide animate-pulse">GOL!</span>
                <span className="text-[10px] text-green-200 ml-auto">{notif.minute}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold ${notif.scoringTeam === 'home' ? 'text-yellow-200' : ''}`}>{notif.home}</span>
                <span className="text-xl font-black mx-2">{notif.homeGoals} - {notif.awayGoals}</span>
                <span className={`text-xs font-bold ${notif.scoringTeam === 'away' ? 'text-yellow-200' : ''}`}>{notif.away}</span>
              </div>
              <div className="text-[10px] text-green-200 mt-0.5">{notif.league}</div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
