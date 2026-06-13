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

const POLL_INTERVAL = 15000
const GOAL_FLASH_DURATION = 15000

// loadFavorites, saveFavorites, GoalNotification, BottomTab, HALFTIME_STATUSES extracted to @/components/match/types & utils

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
  const [netscoresMapping, setNetscoresMapping] = useState<Record<number, string>>({}) // code→url
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
  const [scoremerMapping, setScoremerMapping] = useState<Record<number, string>>({}) // code→scoremerId
  const [scoremerHtScore, setScoremerHtScore] = useState<string | null>(null) // HT score from Scoremer

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
    // Set finishedDate on client to avoid server/client timezone mismatch
    const now = new Date()
    const istanbulOffset = 3 * 60 // UTC+3
    const localOffset = now.getTimezoneOffset()
    const istanbulMs = now.getTime() + (istanbulOffset + localOffset) * 60000
    const istanbulDate = new Date(istanbulMs)
    setFinishedDate(istanbulDate.toISOString().slice(0, 10))
    setFavoritesLoaded(true)
  }, [])

  const toggleFavorite = useCallback((matchCode: number, e?: React.MouseEvent) => {
    if (e) { e.stopPropagation() }
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

      // Expire signals for matches that entered halftime
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
      // Only show error on initial load (no existing data)
      // On subsequent polls, keep showing existing data and retry silently
      if (matches.length === 0) {
        if (retryCountRef.current > MAX_RETRIES) {
          setError('Sunucuya bağlanılamadı. Lütfen daha sonra tekrar deneyin.')
        } else {
          setError('Veri alınamadı. Tekrar denenecek...')
        }
      }
      setIsLoading(false)
      // Auto-retry with exponential backoff (3s, 6s, 12s, 24s, 48s, 96s)
      if (retryCountRef.current <= MAX_RETRIES + 3) {
        const delay = Math.min(3000 * Math.pow(2, Math.min(retryCountRef.current - 1, 5)), 120000)
        setTimeout(() => {
          fetchMatches()
        }, delay)
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

  // handleSelectMatch is defined after fetchScoremerDetails to avoid hoisting issues

  const handleCloseMatch = useCallback(() => {
    setDrawerOpen(false)
    // Delay clearing selectedMatch so drawer can animate out
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
      // Always send home/away/time so the API can auto-rebuild mapping if cache is missing
      const params = new URLSearchParams({
        action: 'details',
        matchCode: String(match.code),
        home: match.home,
        away: match.away,
        time: match.time,
      })
      if (netscoresUrl) {
        params.set('url', netscoresUrl)
      }
      const resp = await fetch(`/api/netscores?${params.toString()}`)
      if (resp.ok) {
        const data = await resp.json()
        if (data.details) {
          setFotmobData(data.details)
          // If the API found a mapping we didn't have, cache it locally
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
      setFinishedLoading(false)
    } catch (err) {
      console.error('Finished matches fetch error:', err)
      setFinishedError('Biten maçlar yüklenemedi')
      setFinishedLoading(false)
    }
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
      if (scoremerId) {
        params.set('scoremerId', scoremerId)
      }
      const resp = await fetch(`/api/scoremer?${params.toString()}`)
      if (resp.ok) {
        const data = await resp.json()
        if (data.stats) {
          setScoremerStats(data.stats)
          setScoremerHtStats(data.htStats || null)
          // Cache HT score from Scoremer (used for synthetic snapshots if Nesine doesn't have it)
          if (data.htScore) {
            setScoremerHtScore(data.htScore)
          }
          // Cache the mapping if we got one
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
    // Clear Scoremer stats for new match
    setScoremerStats(null)
    setScoremerHtStats(null)
    setScoremerHtScore(null)
    // Clear Goaloo odds movement
    setGoalooOddsMovement(null)
    // Use finished mapping if match is finished, live mapping otherwise
    const mapping = match.isFinished ? finishedNetscoresMapping : netscoresMapping
    fetchNetScoresDetails(match, mapping)
    // For finished matches, also fetch Scoremer stats
    if (match.isFinished) {
      fetchScoremerDetails(match)
    }

    // ── Resolve Goaloo match ID for this Nesine match ──
    const cachedGoalooId = goalooMatchIdMap[match.code]
    if (cachedGoalooId) {
      // Already resolved — fetch odds movement with Goaloo matchId
      fetch(`/api/goaloo?action=oddsMovement&matchId=${cachedGoalooId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && data.significance && data.significance !== 'none') {
            setGoalooOddsMovement({
              homeBoost: data.homeBoost || 0,
              awayBoost: data.awayBoost || 0,
              significance: data.significance,
            })
          }
        })
        .catch(() => {})
    } else {
      // Need to resolve Nesine → Goaloo match mapping
      const matchDate = match.isFinished
        ? (finishedDate || new Date().toISOString().slice(0, 10))
        : new Date().toISOString().slice(0, 10)
      fetch(`/api/goaloo?action=resolve&home=${encodeURIComponent(match.home)}&away=${encodeURIComponent(match.away)}&date=${matchDate}&time=${match.time || ''}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && data.found && data.goalooMatchId) {
            // Cache the mapping
            setGoalooMatchIdMap(prev => ({ ...prev, [match.code]: data.goalooMatchId }))
            // Now fetch odds movement with the correct Goaloo matchId
            fetch(`/api/goaloo?action=oddsMovement&matchId=${data.goalooMatchId}`)
              .then(r => r.ok ? r.json() : null)
              .then(odata => {
                if (odata && odata.significance && odata.significance !== 'none') {
                  setGoalooOddsMovement({
                    homeBoost: odata.homeBoost || 0,
                    awayBoost: odata.awayBoost || 0,
                    significance: odata.significance,
                  })
                }
              })
              .catch(() => {})
          }
        })
        .catch(() => {}) // Silent fail - Goaloo mapping is optional
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

        // Signal durumunu güncelle: gol olan maçın sinyallerini finalize et
        fetch(`/api/goal-signals?action=finalize&matchCode=${m.code}&homeScore=${m.homeGoals}&awayScore=${m.awayGoals}`)
          .catch(() => {})

        // SignalHistoryPanel'in güncel veriyi çekmesi için custom event fırlat
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('goal-scored', { detail: { matchCode: m.code } }))
        }

        if (favorites.has(m.code)) {
          playGoalSound()

          const notification: GoalNotification = {
            id: `${m.code}-${now}`,
            matchCode: m.code,
            home: m.home,
            away: m.away,
            homeGoals: m.homeGoals,
            awayGoals: m.awayGoals,
            scoringTeam: homeScored ? 'home' : 'away',
            league: m.league,
            minute: m.minute,
            timestamp: now,
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
          if (now - ts < GOAL_FLASH_DURATION) {
            next[Number(code)] = ts
          }
        }
        return next
      })
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Goal probabilities + Signal tracking (via API for persistence)
  // THRESHOLD RAISED: 30 → 55 — only matches with REAL 5-min goal probability
  const goalProbabilities = useMemo(() => {
    const map = new Map<number, GoalProbability>()
    for (const m of matches) {
      if (!m.isLive || !m.hasStats || (m.status === 3 || m.status === 28)) continue
      if (m.goalRadar && m.goalRadar.score >= 60 && m.goalRadar.goalProbability5min >= 0.25) {
        map.set(m.code, m.goalRadar)
        // Record signal via POST API (>60% score + 25% 5-min probability)
        if (m.goalRadar.score >= 60 && m.goalRadar.side) {
          fetch('/api/goal-signals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              matchCode: m.code,
              homeTeam: m.home,
              awayTeam: m.away,
              league: m.league,
              matchTime: m.time,
              minute: m.minute,
              score: m.goalRadar.score,
              side: m.goalRadar.side,
              homeGoals: m.homeGoals,
              awayGoals: m.awayGoals,
              homeScore: m.goalRadar.homeScore,
              awayScore: m.goalRadar.awayScore,
              level: m.goalRadar.level,
              factors: m.goalRadar.factors,
              calibratedP: m.goalRadar.calibratedP,
              poissonP: m.goalRadar.poissonP,
            }),
          }).catch(() => {})
        }
        continue
      }
      const history = allPressureData[m.code]
      const prob = calculateGoalProbability(
        m.stats, m.minute, m.isLive, history, m.homeGoals, m.awayGoals,
        m.home, m.away  // Faz 1: Pass team names for Elo
      )
      if (prob.score >= 60 && prob.goalProbability5min >= 0.25) {
        map.set(m.code, prob)
        // Record signal via POST API (>60% score + 25% 5-min probability)
        if (prob.score >= 60 && prob.side) {
          fetch('/api/goal-signals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              matchCode: m.code,
              homeTeam: m.home,
              awayTeam: m.away,
              league: m.league,
              matchTime: m.time,
              minute: m.minute,
              score: prob.score,
              side: prob.side,
              homeGoals: m.homeGoals,
              awayGoals: m.awayGoals,
              homeScore: prob.homeScore,
              awayScore: prob.awayScore,
              level: prob.level,
              factors: prob.factors,
              calibratedP: prob.calibratedP,
              poissonP: prob.poissonP,
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
      if (prevNum <= 45 && (curMin.includes('DA') || curNum >= 46)) {
        return i - 1
      }
    }
    return -1
  }, [pressureSnapshots])

  const filteredSnapshots = useMemo(() => {
    if (statsHalf === 'full' || !pressureSnapshots || pressureSnapshots.length === 0) {
      return pressureSnapshots
    }
    if (statsHalf === '1h') {
      if (halftimeIdx === -1) return pressureSnapshots
      return pressureSnapshots.slice(0, halftimeIdx + 1)
    }
    if (statsHalf === '2h') {
      if (halftimeIdx === -1) return []
      return pressureSnapshots.slice(halftimeIdx + 1)
    }
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

  // Synthetic snapshots from Scoremer data (fallback when no live snapshots exist)
  const syntheticSnapshots = useMemo(() => {
    if (!selectedMatch) return []
    // Only generate synthetic data if we have Scoremer stats AND not enough live data
    if (pressureSnapshots.length >= 10) return [] // enough real data
    if (!scoremerStats || Object.keys(scoremerStats).length === 0) return []
    // Use Scoremer HT score if Nesine doesn't have it
    const effectiveHtScore = (selectedMatch.firstHalfScore && selectedMatch.firstHalfScore !== '-')
      ? selectedMatch.firstHalfScore
      : scoremerHtScore || undefined
    return generateSyntheticSnapshots(
      scoremerStats,
      scoremerHtStats,
      selectedMatch.homeGoals,
      selectedMatch.awayGoals,
      effectiveHtScore,
    )
  }, [selectedMatch, pressureSnapshots.length, scoremerStats, scoremerHtStats, scoremerHtScore])

  // Merge real + synthetic snapshots (real data takes priority)
  const mergedSnapshots = useMemo(() => {
    if (syntheticSnapshots.length === 0) return pressureSnapshots
    if (pressureSnapshots.length < 2) return syntheticSnapshots

    // Build a map of real data by minute
    const realByMinute = new Map<number, typeof pressureSnapshots[0]>()
    for (const snap of pressureSnapshots) {
      const min = parseInt(snap.minute.replace(/[^0-9]/g, ''), 10) || 0
      realByMinute.set(min, snap)
    }

    // Start with synthetic, override with real where available
    const merged = [...syntheticSnapshots]
    for (let i = 0; i < merged.length; i++) {
      const min = parseInt(merged[i].minute.replace(/[^0-9]/g, ''), 10) || 0
      // Find closest real snapshot within 3 minutes
      for (const [realMin, realSnap] of realByMinute) {
        if (Math.abs(realMin - min) <= 3) {
          merged[i] = realSnap
          realByMinute.delete(realMin) // used
          break
        }
      }
    }

    // Add any remaining real snapshots that didn't match
    for (const [, snap] of realByMinute) {
      merged.push(snap)
    }

    // Sort by minute
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

    if (statsHalf === '1h') {
      if (halftimeIdx === -1) return selectedMatch.stats
      return snapshots[halftimeIdx].stats
    }

    if (statsHalf === '2h') {
      if (halftimeIdx === -1) {
        const empty: MatchStats = {}
        for (const key of Object.keys(selectedMatch.stats)) {
          empty[key] = { home: 0, away: 0 }
        }
        return empty
      }

      const htStats = snapshots[halftimeIdx].stats
      const currentStats = selectedMatch.stats
      const secondHalfStats: MatchStats = {}

      for (const key of Object.keys(currentStats)) {
        const cur = currentStats[key]
        const ht = htStats[key]
        if (cur && ht) {
          if (key === 'possession') {
            secondHalfStats[key] = cur
          } else {
            const homeDiff = (cur.home ?? 0) - (ht.home ?? 0)
            const awayDiff = (cur.away ?? 0) - (ht.away ?? 0)
            secondHalfStats[key] = {
              home: homeDiff > 0 ? homeDiff : 0,
              away: awayDiff > 0 ? awayDiff : 0,
            }
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
      selectedMatch.stats,
      selectedMatch.minute,
      selectedMatch.isLive,
      pressureSnapshots,
      selectedMatch.homeGoals,
      selectedMatch.awayGoals,
      selectedMatch.home,
      selectedMatch.away,  // Faz 1: Pass team names for Elo
      goalooOddsMovement   // Faz 2: Goaloo odds movement boost (F13)
    )
    if (serverRadar && clientCalc.score < serverRadar.score && pressureSnapshots.length < 3) {
      return serverRadar
    }
    return clientCalc.score >= 60 && clientCalc.goalProbability5min >= 0.25 ? clientCalc : (serverRadar || null)
  }, [selectedMatch, pressureSnapshots, goalooOddsMovement])

  // Render finished matches section
  const renderFinishedMatches = () => {
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
          <button onClick={() => fetchFinishedMatches()} className="text-blue-600 text-sm underline hover:no-underline">
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

    // Group by league
    const byLeague: Record<string, Match[]> = {}
    for (const m of finishedMatches) {
      if (!byLeague[m.league]) byLeague[m.league] = []
      byLeague[m.league].push(m)
    }

    return (
      <div>
        {/* Date picker */}
        <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-white rounded-xl border border-gray-200 shadow-sm">
          <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <input
            type="date"
            value={finishedDate}
            onChange={(e) => {
              setFinishedDate(e.target.value)
              setFinishedMatches([])
              fetchFinishedMatches(e.target.value)
            }}
            className="text-sm font-medium text-gray-700 bg-transparent border-none outline-none cursor-pointer"
          />
          <span className="text-[10px] text-gray-400 ml-auto">{finishedMatches.length} maç</span>
        </div>

        {/* Finished matches by league */}
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
                  onClick={() => handleSelectMatch(match)}
                  isSelected={selectedMatch?.code === match.code}
                  isFavorite={favorites.has(match.code)}
                  onToggleFavorite={(e) => toggleFavorite(match.code, e)}
                  hasNetScores={!!finishedNetscoresMapping[match.code]}
                  hasScoremer={!!scoremerMapping[match.code]}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Signal Accuracy Stats */}
        <SignalStatsPanel />

        {/* Backtest Giriş Butonu */}
        <button
          onClick={() => setActiveTab('signal-history')}
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

  // Render match list based on sort mode
  const renderMatchList = () => {
    // Backtest tab
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

    // Finished matches tab
    if (activeTab === 'finished') {
      return renderFinishedMatches()
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
          <button onClick={fetchMatches} className="text-emerald-600 text-sm underline hover:no-underline">
            Tekrar dene
          </button>
          <button
            onClick={() => setActiveTab('finished')}
            className="text-blue-600 text-sm underline hover:no-underline mt-2"
          >
            Biten maçlara göz at →
          </button>
        </div>
      )
    }
    if (filteredMatches.length === 0) {
      const tabLabel = activeTab === 'live' ? 'canlı' : activeTab === 'radar' ? 'radar' : activeTab === 'favorites' ? 'favori' : ''
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="text-5xl mb-4">⚽</div>
          <p className="text-gray-500 text-sm mb-3">Şu an {tabLabel} maç yok</p>
          {(activeTab as string) !== 'finished' && (activeTab as string) !== 'signal-history' && (
            <button
              onClick={() => setActiveTab('finished')}
              className="px-4 py-2 bg-blue-50 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-100 transition-colors"
            >
              Biten maçlara göz at →
            </button>
          )}
        </div>
      )
    }

    if (activeTab === 'radar') {
      const radarMatches = [...filteredMatches].sort((a, b) => {
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
            <span className="text-[10px] text-red-400 ml-auto">{radarMatches.length} maç · Yüksek gol ihtimali</span>
          </div>
          <div className="bg-white rounded-xl border-2 border-red-200 overflow-hidden shadow-sm">
            {radarMatches.map(match => (
              <MatchCard key={match.code} match={match} onClick={() => handleSelectMatch(match)} goalProb={goalProbabilities.get(match.code)} showLeague isSelected={selectedMatch?.code === match.code} isFavorite={favorites.has(match.code)} onToggleFavorite={(e) => toggleFavorite(match.code, e)} hasGoalFlash={!!goalFlashMap[match.code]} />
            ))}
          </div>
        </div>
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
              <MatchCard key={match.code} match={match} onClick={() => handleSelectMatch(match)} goalProb={goalProbabilities.get(match.code)} isSelected={selectedMatch?.code === match.code} isFavorite={favorites.has(match.code)} onToggleFavorite={(e) => toggleFavorite(match.code, e)} hasGoalFlash={!!goalFlashMap[match.code]} />
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
              <MatchCard key={match.code} match={match} onClick={() => handleSelectMatch(match)} showLeague goalProb={goalProbabilities.get(match.code)} isSelected={selectedMatch?.code === match.code} isFavorite={favorites.has(match.code)} onToggleFavorite={(e) => toggleFavorite(match.code, e)} hasGoalFlash={!!goalFlashMap[match.code]} />
            ))}
          </div>
        </div>
      )
    }
  }

  // Detail content props shared between desktop and mobile
  const detailProps = selectedMatch ? {
    match: selectedMatch,
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
    goalooMatchId: goalooMatchIdMap[selectedMatch.code] || 0,
    activeChartTab,
    setActiveChartTab,
  } : null

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col touch-manipulation">
      {/* ── Compact App Header ─────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm safe-top">
        <div className="max-w-[1400px] mx-auto px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="/logo-192.png"
              alt="Gol Radarı"
              className="w-8 h-8 rounded-lg shadow-sm object-cover"
            />
            <div>
              <h1 className="text-base font-bold text-gray-900 tracking-tight leading-tight">Gol Radarı</h1>
              <p className="text-[10px] text-gray-400 leading-tight">
                {lastUpdate ? lastUpdate.toLocaleTimeString('tr-TR') : '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Sort toggle */}
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
            {/* Live count */}
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
        {/* Match List - full width on mobile, left panel on desktop */}
        <div className={`transition-all duration-300 ease-in-out overflow-y-auto -webkit-overflow-scrolling-touch ${
          selectedMatch ? 'md:w-[40%] w-full' : 'w-full'
        }`}>
          <div className={`${selectedMatch ? 'max-w-full' : 'max-w-[1400px]'} mx-auto p-3 pb-20`}>
            {renderMatchList()}
          </div>
        </div>

        {/* Desktop Side Panel - Match Detail */}
        {selectedMatch && detailProps && (
          <div className="hidden md:flex w-[60%] border-l border-gray-200 overflow-y-auto bg-white flex-col">
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600">Maç Detayı</span>
              <button
                onClick={handleCloseMatch}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                aria-label="Kapat"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div>
              <MatchDetailContent {...detailProps} />
            </div>
          </div>
        )}
      </div>

      {/* ── Match Detail Panel ── */}
      {isMobile ? (
        <Drawer
          open={drawerOpen}
          onOpenChange={(open) => {
            if (!open) handleCloseMatch()
          }}
          shouldScaleBackground
        >
          <DrawerContent className="max-h-[92dvh]">
            <DrawerHeader className="p-3 pb-0">
              <DrawerTitle className="text-sm font-semibold text-gray-700">
                {selectedMatch ? `${selectedMatch.home} vs ${selectedMatch.away}` : 'Maç Detayı'}
              </DrawerTitle>
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <DrawerDescription className="text-[10px] text-gray-400">
                  {selectedMatch?.league}
                </DrawerDescription>
                <span className="text-gray-300">·</span>
                <MatchStatusBadge match={selectedMatch!} />
              </div>
            </DrawerHeader>
            <div className="overflow-y-auto -webkit-overflow-scrolling-touch" style={{ maxHeight: 'calc(92dvh - 80px)' }}>
              {selectedMatch && detailProps && (
                <MatchDetailContent {...detailProps} />
              )}
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}

      {/* ── Sticky Footer Navigation Bar ──────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-gray-200 safe-bottom shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <div className="max-w-3xl mx-auto flex items-center justify-around h-[56px] md:h-[52px]">
          {([
            { key: 'all' as BottomTab, label: 'Ana Sayfa', icon: (active: boolean) => (
              <svg className={`w-5 h-5 ${active ? 'text-emerald-600' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 2}>
                {active ? (
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                )}
              </svg>
            )},
            { key: 'live' as BottomTab, label: 'Canlı', badge: liveCount, icon: (active: boolean) => (
              <div className="relative">
                <svg className={`w-5 h-5 ${active ? 'text-emerald-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {liveCount > 0 && !active && (
                  <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
                )}
              </div>
            )},
            { key: 'radar' as BottomTab, label: 'Gol Radarı', badge: radarCount, icon: (active: boolean) => (
              <div className="relative">
                <svg className={`w-5 h-5 ${active ? 'text-red-600' : 'text-gray-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                {radarCount > 0 && !active && (
                  <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                )}
              </div>
            )},
            { key: 'favorites' as BottomTab, label: 'Favoriler', badge: favCount, icon: (active: boolean) => (
              <svg className={`w-5 h-5 ${active ? 'text-amber-500' : 'text-gray-400'}`} viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            )},
            { key: 'finished' as BottomTab, label: 'Biten', badge: finishedMatches.length || undefined, icon: (active: boolean) => (
              <svg className={`w-5 h-5 ${active ? 'text-blue-600' : 'text-gray-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )},
            { key: 'signal-history' as BottomTab, label: 'Sinyaller', icon: (active: boolean) => (
              <svg className={`w-5 h-5 ${active ? 'text-indigo-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )},
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors relative ${
                activeTab === tab.key
                  ? tab.key === 'radar'
                    ? 'text-red-600'
                    : tab.key === 'favorites'
                    ? 'text-amber-500'
                    : tab.key === 'finished'
                    ? 'text-blue-600'
                    : tab.key === 'signal-history'
                    ? 'text-indigo-600'
                    : 'text-emerald-600'
                  : 'text-gray-400'
              }`}
            >
              {tab.icon(activeTab === tab.key)}
              <span className={`text-[10px] font-medium ${activeTab === tab.key ? 'font-bold' : ''}`}>
                {tab.label}
              </span>
              {tab.badge && tab.badge > 0 && (
                <span className={`absolute -top-0.5 right-1/2 translate-x-4 text-[8px] font-bold px-1 rounded-full ${
                  tab.key === 'radar' ? 'bg-red-100 text-red-600' :
                  tab.key === 'live' ? 'bg-emerald-100 text-emerald-600' :
                  tab.key === 'finished' ? 'bg-blue-100 text-blue-600' :
                  'bg-amber-100 text-amber-600'
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Goal Notifications Portal — rendered only on client after mount */}
      {goalNotifications.length > 0 && favoritesLoaded && createPortal(
        <div className="fixed top-16 right-3 z-[100] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: '340px' }}>
          {goalNotifications.map(notif => (
            <div
              key={notif.id}
              className="pointer-events-auto animate-[slideInRight_0.4s_ease-out] bg-gradient-to-r from-green-500 via-emerald-500 to-green-600 rounded-xl shadow-2xl border border-green-400 p-3 text-white"
              style={{ animation: 'slideInRight 0.4s ease-out' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="relative">
                  <div className="text-lg">⚽</div>
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-ping" />
                </div>
                <span className="font-black text-sm tracking-wide animate-pulse">GOL!</span>
                <span className="text-[10px] text-green-200 ml-auto">{notif.minute}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold ${notif.scoringTeam === 'home' ? 'text-yellow-200' : ''}`}>
                  {notif.home}
                </span>
                <span className="text-xl font-black mx-2">{notif.homeGoals} - {notif.awayGoals}</span>
                <span className={`text-xs font-bold ${notif.scoringTeam === 'away' ? 'text-yellow-200' : ''}`}>
                  {notif.away}
                </span>
              </div>
              <div className="text-[10px] text-green-200 mt-0.5">{notif.league}</div>
            </div>
          ))}
        </div>,
        document.body
      )}

      {/* Animations are defined in globals.css */}
    </div>
  )
}
