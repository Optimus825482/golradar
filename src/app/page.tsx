'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
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
  FINISHED_STATUSES,
} from '@/lib/nesine'
import { determineSideByStats } from '@/lib/goalRadar/side'
import type {
  FotMobMatchDetails,
} from '@/lib/fotmob'

import {
  calculateThreatIndex,
  calculateMomentumBars,
  calculateXgFlow,
  generateSyntheticSnapshots,
} from '@/lib/advancedAnalytics'
import { SIGNAL_THRESHOLD, SIGNAL_5MIN_THRESHOLD } from '@/config'
import SignalsCenter from '@/components/SignalsCenter'
import { usePresence } from '@/hooks/usePresence'
import { tierConfig } from '@/lib/tier'
import { useMatchList } from '@/hooks/useMatchList'
import { useFinishedMatches } from '@/hooks/useFinishedMatches'
import { useDailyMetrics } from '@/hooks/useDailyMetrics'
import { useGoalDetection } from '@/hooks/useGoalDetection'

import { Badge } from '@/components/ui/badge'
import type { Match, PressureSnapshot, GoalNotification, BottomTab } from '@/components/match/types'
import { HALFTIME_STATUSES } from '@/components/match/types'
import { calculatePressure, loadFavorites, saveFavorites } from '@/components/match/utils'
import { CountryFlag, MatchStatusBadge } from '@/components/match/shared-components'
import { MatchCard } from '@/components/match/MatchCard'
import { MatchDetailContent } from '@/components/match/MatchDetailContent'
import type { MatchDetailContentProps } from '@/components/match/MatchDetailContent'
import { FinishedMatchesView } from '@/components/match/FinishedMatchesView'
import { BottomNavBar } from '@/components/match/BottomNavBar'
import { GoalRadarSection } from '@/components/match/GoalRadarSection'
import { logError } from '@/lib/devLog';

const GOAL_FLASH_DURATION = 15000

// Parse minute string handling stoppage time: "45+2" → 47, "90" → 90
function parseGoalMinute(minute: string | number): number {
  if (typeof minute === 'number') return Math.max(0, minute)
  const plusMatch = minute.match(/^(\d+)\s*\+\s*(\d+)/)
  if (plusMatch) {
    return parseInt(plusMatch[1], 10) + parseInt(plusMatch[2], 10)
  }
  const num = parseInt(minute.replace(/[^0-9]/g, ''), 10)
  return isNaN(num) ? 0 : num
}

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
  const [dailyMetrics, setDailyMetrics] = useState<{
    ok: boolean;
    today: {
      signalsTotal: number;
      goalsHit: number;
      fail: number;
      pending: number;
      successRate: number;
      resolved: number;
      analyzedMatches: number;
    };
    upcoming: { liveNow: number; startsSoon: number; total: number };
    allTime: { successRate: number; totalSignals: number; totalGoals: number };
    date: string;
    lastUpdated: number;
  } | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const retryCountRef = useRef(0)
  const MAX_RETRIES = 5

  // Favorites
  const [favorites, setFavorites] = useState<Set<number>>(new Set())

	  // Goal detection (flash + notifications + prevGoals)
	  const {
	    goalFlashMap,
	    goalNotifications,
	    prevGoalsRef,
	    addGoalNotification,
	    clearGoalNotification,
	  } = useGoalDetection()
	  // Read current prev goals through the ref (avoids stale snapshot between renders)
	  const prevGoals = prevGoalsRef.current

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
    // Istanbul date — use Intl for DST-safe TZ conversion
    const istanbulDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    setFinishedDate(istanbulDateStr)
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

  // Refs to break stale closure cycles
  const selectedMatchRef = useRef<Match | null>(null)
  const matchesRef = useRef<Match[]>([])
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  // Keep refs in sync with state
  useEffect(() => { selectedMatchRef.current = selectedMatch }, [selectedMatch])
  useEffect(() => { matchesRef.current = matches }, [matches])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; abortRef.current?.abort() }
  }, [])

  // Presence: track active users for tier-aware polling cadence
  const { tier } = usePresence(true)

  // Stable fetchMatches — no state deps to prevent interval reset loop
  const fetchMatches = useCallback(async () => {
    try {
      const resp = await fetch('/api/matches', { cache: 'no-store' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      const newMatches: Match[] = data.matches || []
      const newPressureData: Record<number, PressureSnapshot[]> = data.pressureData || {}

      setMatches(newMatches)
      setAllPressureData(newPressureData)
      setLastUpdate(new Date())
      setError(null)
      retryCountRef.current = 0

      // Expire halftime signals (fire-and-forget)
      const halftimeCodes = new Set<number>()
      for (const m of newMatches) {
        if (HALFTIME_STATUSES.has(m.status)) halftimeCodes.add(m.code)
      }
      if (halftimeCodes.size > 0) {
        fetch('/api/goal-signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'expireHalftime', matchCodes: [...halftimeCodes] }),
        }).catch((e) => { logError('page', e); })
      }

      // Update pressure snapshots for currently selected match (via ref, not state)
      const currentSelected = selectedMatchRef.current
      if (currentSelected && newPressureData[currentSelected.code]) {
        const updatedMatch = newMatches.find((m: Match) => m.code === currentSelected.code)
        const isHalftime = updatedMatch ? HALFTIME_STATUSES.has(updatedMatch.status) : false
        if (!isHalftime) {
          setPressureSnapshots(newPressureData[currentSelected.code])
        }
      }

      // Update selected match data if still selected
      setSelectedMatch(prev => {
        if (!prev) return prev
        const updated = newMatches.find((m: Match) => m.code === prev.code)
        return updated || prev
      })

      setIsLoading(false)
    } catch (err) {
      logError('page', 'Fetch error:', err)
      retryCountRef.current += 1
      if (matchesRef.current.length === 0) {
        if (retryCountRef.current > MAX_RETRIES) {
          setError('Sunucuya bağlanılamadı. Lütfen daha sonra tekrar deneyin.')
        } else {
          setError('Veri alınamadı. Tekrar denenecek...')
        }
      }
      setIsLoading(false)
      if (retryCountRef.current <= MAX_RETRIES + 3 && mountedRef.current) {
        const delay = Math.min(3000 * Math.pow(2, Math.min(retryCountRef.current - 1, 5)), 120000)
        setTimeout(() => { if (mountedRef.current) fetchMatches() }, delay)
      }
    }
  }, []) // Stable: no state deps, uses refs for latest values

  // Stable polling — interval never resets due to fetchMatches reference stability
  useEffect(() => {
    fetchMatches()
    intervalRef.current = setInterval(fetchMatches, tierConfig(tier).pollIntervalMs)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchMatches, tier])

  // Daily metrics fetch — refresh every 5 minutes
  const fetchDailyMetrics = useCallback(async () => {
    try {
      const resp = await fetch("/api/daily-metrics", { cache: "no-store" })
      if (resp.ok) {
        const data = await resp.json()
        setDailyMetrics(data)
      }
    } catch (e) {
      // Silent — KPI strip degrades gracefully
    }
  }, [])
  useEffect(() => {
    fetchDailyMetrics()
    const dm = setInterval(fetchDailyMetrics, 5 * 60_000)
    return () => clearInterval(dm)
  }, [fetchDailyMetrics])

  const handleCloseMatch = useCallback(() => {
    setDrawerOpen(false)
    setTimeout(() => setSelectedMatch(null), 300)
  }, [])

  // Build NetScores mapping when matches change
  useEffect(() => {
    if (matches.length === 0) return
    buildNetscoresMapping(matches.map(m => ({ code: m.code, home: m.home, away: m.away, time: m.time })))
      .then(setNetscoresMapping)
      .catch((e) => { logError('page', e); })
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
      logError('page', 'NetScores fetch error:', err);
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
      logError('page', 'Finished matches fetch error:', err);
      setFinishedError('Biten maçlar yüklenemedi')
    }
    setFinishedLoading(false)
  }, [finishedDate])

  // Build NetScores mapping for finished matches
  useEffect(() => {
    if (finishedMatches.length === 0) return
    buildNetscoresMapping(finishedMatches.map(m => ({ code: m.code, home: m.home, away: m.away, time: m.time })))
      .then(setFinishedNetscoresMapping)
      .catch((e) => { logError('page', e); })
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
	        const resp = await fetch('/api/scoremer', {
	          method: 'POST',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify({ action: 'mapping', matches: matchList }),
	        })
        if (resp.ok) {
          const data = await resp.json()
          const map: Record<number, string> = {}
          for (const m of data.mappings || []) {
            map[m.nesineCode] = m.scoremerId
          }
          setScoremerMapping(map)
        }
      } catch (e) { logError('page', e); }
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
      logError('page', 'Scoremer fetch error:', err);
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
        .catch((e) => { logError('page', e); })
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
              .catch((e) => { logError('page', e); })
          }
        })
        .catch((e) => { logError('page', e); })
    }
  }, [allPressureData, netscoresMapping, finishedNetscoresMapping, fetchScoremerDetails, goalooMatchIdMap, finishedDate])

  // Fetch finished matches when tab changes to 'finished' OR when there are no live matches
  useEffect(() => {
    if ((activeTab === 'finished' || matches.length === 0) && finishedMatches.length === 0 && !finishedLoading) {
      fetchFinishedMatches()
    }
  }, [activeTab, matches.length, finishedMatches.length, fetchFinishedMatches, finishedLoading, tier])

  // Goal Detection: report goals to signal tracker + UI notifications
  useEffect(() => {
    const now = Date.now()

    for (const m of matches) {
      const prev = prevGoals[m.code]
      if (!prev) continue

      const homeScored = m.homeGoals > prev.home
      const awayScored = m.awayGoals > prev.away

      if (homeScored || awayScored) {
        // Report each goal side independently via API
        if (homeScored) {
          fetch('/api/goal-signals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reportGoal', matchCode: m.code, goalSide: 'home', goalMinute: parseGoalMinute(m.minute) }),
          }).catch((e) => { logError('page', e); })
        }
        if (awayScored) {
          fetch('/api/goal-signals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reportGoal', matchCode: m.code, goalSide: 'away', goalMinute: parseGoalMinute(m.minute) }),
          }).catch((e) => { logError('page', e); })
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('goal-scored', { detail: { matchCode: m.code } }))
        }

        if (favorites.has(m.code)) {
	          const notification: GoalNotification = {
	            id: `${m.code}-${now}`,
	            matchCode: m.code,
	            home: m.home, away: m.away,
	            homeGoals: m.homeGoals, awayGoals: m.awayGoals,
	            scoringTeam: homeScored ? 'home' : 'away',
	            league: m.league, minute: m.minute, timestamp: now,
	          }
	          addGoalNotification(notification)
	          setTimeout(() => {
	            clearGoalNotification(notification.id)
	          }, 8000)
	        }
      }

      // When match ends, finalize all pending signals for this match
      if (FINISHED_STATUSES.has(m.status) && !FINISHED_STATUSES.has(prev.status)) {
        fetch(`/api/goal-signals?action=finalize&matchCode=${m.code}&homeScore=${m.homeGoals}&awayScore=${m.awayGoals}`)
          .catch((e) => { logError('page', e); })
      }
    }

  }, [matches, favorites])

	  // Goal probabilities — gösterim + kayıt tutarlılığı
	  // Sadece kaydedilebilecek sinyalleri göster (score + 5min prob + side)
	  const goalProbabilities = useMemo(() => {
	    const map = new Map<number, GoalProbability>()
	    for (const m of matches) {
	      if (!m.isLive || !m.hasStats || HALFTIME_STATUSES.has(m.status)) continue
	      // Server goalRadar varsa ve maç hala canlıysa kullan
	      let prob: GoalProbability | undefined
	      if (m.goalRadar && m.goalRadar.score >= SIGNAL_THRESHOLD && m.goalRadar.goalProbability5min >= SIGNAL_5MIN_THRESHOLD) {
	        prob = m.goalRadar
	      } else {
	        const history = allPressureData[m.code]
	        const cp = calculateGoalProbability(
	          m.stats, m.minute, m.isLive, history, m.homeGoals, m.awayGoals, m.home, m.away,
	        )
	        if (cp.score >= SIGNAL_THRESHOLD && cp.goalProbability5min >= SIGNAL_5MIN_THRESHOLD) {
	          prob = cp
	        }
	      }
	      if (!prob) continue
	      // Side kontrolü: null ise determineSideByStats ile dene, yine nullsa gösterme
	      if (!prob.side) {
	        try {
	          const fallbackSide = determineSideByStats(m.stats)
	          if (fallbackSide) {
	            prob = { ...prob, side: fallbackSide }
	          } else {
	            continue // side belirlenemiyor → gösterme
	          }
	        } catch { continue }
	      }
	      map.set(m.code, prob)
	    }
	    return map
	  }, [matches, allPressureData])

	  // Signal posting — isolated in its own effect so fetch calls don't
	  // fire inside a useMemo (React anti-pattern). A ref tracks which
	  // match+side+minute combos have already been posted to prevent
	  // duplicate signals on re-render.
	  const postedSignalsRef = useRef<Set<string>>(new Set())
	  useEffect(() => {
	    const posted = postedSignalsRef.current
        for (const [code, prob] of goalProbabilities) {
          if (!prob || !prob.side) continue
          // FIX: side='both' sinyallerini gecir — algoritma hangi takimdan
          // gol geleceginden emin degil ama gol olacagini dusunuyor demektir.
          // Sinyal kaybi yasanmasin. Dedup key'de side='both' kullanilir.
	      const m = matches.find(x => x.code === code)
	      if (!m) continue
	      const signalKey = `${code}:${prob.side}:${parseGoalMinute(m.minute)}`
	      if (posted.has(signalKey)) continue
	      posted.add(signalKey)
	      fetch('/api/goal-signals', {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        body: JSON.stringify({
	          matchCode: code, homeTeam: m.home, awayTeam: m.away, league: m.league,
	          matchTime: m.time, minute: m.minute, score: prob.score,
	          side: prob.side, homeGoals: m.homeGoals, awayGoals: m.awayGoals,
	          homeScore: prob.homeScore, awayScore: prob.awayScore,
	          level: prob.level, factors: prob.factors,
	          calibratedP: prob.calibratedP, poissonP: prob.poissonP,
	        }),
	      }).catch((e) => { logError('page', e); })
	    }
	    // Keep set from growing unbounded — cap at 500 entries
	    if (posted.size > 500) {
	      const arr = Array.from(posted)
	      postedSignalsRef.current = new Set(arr.slice(0, 300))
	    }
	  }, [goalProbabilities, matches])

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
	      if (prevNum <= 45 && (/^(?:DA|HT|Devre|Half)/i.test(curMin) || curNum >= 46)) return i - 1
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
  const detailProps = useMemo(() => selectedMatch ? {
    match: selectedMatch, currentPressure, selectedGoalProb,
    pressureChartData, statsChartData, momentumBars, xgFlowData, threatIndex,
    filteredStats, statsHalf, setStatsHalf, fotmobData, fotmobLoading,
    fotmobTab, setFotmobTab, scoremerStats, scoremerHtStats, scoremerLoading,
    goalooMatchId: goalooMatchIdMap[selectedMatch.code] || 0,
    activeChartTab, setActiveChartTab,
  } : null, [
    selectedMatch, currentPressure, selectedGoalProb,
    pressureChartData, statsChartData, momentumBars, xgFlowData, threatIndex,
    filteredStats, statsHalf, fotmobData, fotmobLoading,
    fotmobTab, scoremerStats, scoremerHtStats, scoremerLoading,
    goalooMatchIdMap, selectedMatch?.code ?? 0,
    activeChartTab, setStatsHalf, setFotmobTab, setActiveChartTab,
  ])

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
          <SignalsCenter
            matches={matches}
            onSelectMatch={(m) => handleSelectMatch(m)}
          />
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
          onSetActiveTab={(tab: string) => setActiveTab(tab as BottomTab)}
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
          goalFlashMap={goalFlashMap as unknown as Record<number, number>}
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
        <div className="max-w-350 mx-auto px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo-192.png" alt="Gol Radarı" className="w-8 h-8 rounded-lg shadow-sm object-cover" />
            <div>
              <h1 className="text-base font-bold text-gray-900 tracking-tight leading-tight">Gol Radarı</h1>
	              <p className="text-[10px] text-gray-400 leading-tight flex items-center gap-1">
	                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
	                {lastUpdate ? `Canlı · ${lastUpdate.toLocaleTimeString('tr-TR')}` : '—'}
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

      {/* ── Daily KPI Strip ──────────────────────────────────── */}
      {dailyMetrics && (
        <div className="bg-gradient-to-r from-indigo-50 via-white to-emerald-50 border-b border-gray-200">
          <div className="max-w-350 mx-auto px-3 py-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">
                📊 Bugünün Performansı
              </h2>
              <span className="text-[9px] text-gray-400">
                {dailyMetrics.date}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {/* 1. Bugün Gol Sinyali Başarısı */}
              <div className="bg-white rounded-lg border border-indigo-100 p-2.5 shadow-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">🎯</span>
                  <span className="text-[9px] text-gray-500 uppercase font-bold tracking-wide">
                    Bugün Başarı
                  </span>
                </div>
                <div className={`text-xl font-black ${
                  dailyMetrics.today.successRate >= 0.6 ? "text-emerald-600" :
                  dailyMetrics.today.successRate >= 0.4 ? "text-amber-500" : "text-red-500"
                }`}>
                  {(dailyMetrics.today.successRate * 100).toFixed(0)}%
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">
                  {dailyMetrics.today.goalsHit}/{dailyMetrics.today.resolved} gol
                </div>
              </div>

              {/* 2. Bugün Analiz Edilen Maç */}
              <div className="bg-white rounded-lg border border-blue-100 p-2.5 shadow-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">⚽</span>
                  <span className="text-[9px] text-gray-500 uppercase font-bold tracking-wide">
                    Analiz Edilen
                  </span>
                </div>
                <div className="text-xl font-black text-blue-600">
                  {dailyMetrics.today.analyzedMatches}
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">maç bugün</div>
              </div>

              {/* 3. Bugün Verilen Gol Sinyali */}
              <div className="bg-white rounded-lg border border-orange-100 p-2.5 shadow-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">📡</span>
                  <span className="text-[9px] text-gray-500 uppercase font-bold tracking-wide">
                    Verilen Sinyal
                  </span>
                </div>
                <div className="text-xl font-black text-orange-600">
                  {dailyMetrics.today.signalsTotal}
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">
                  {dailyMetrics.today.pending} bekliyor
                </div>
              </div>

              {/* 4. Bugün Başarılı Sinyal Sayısı */}
              <div className="bg-white rounded-lg border border-emerald-100 p-2.5 shadow-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">⚽</span>
                  <span className="text-[9px] text-gray-500 uppercase font-bold tracking-wide">
                    Bugün Gol
                  </span>
                </div>
                <div className="text-xl font-black text-emerald-600">
                  {dailyMetrics.today.goalsHit}
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">
                  / {dailyMetrics.today.fail} yanlış
                </div>
              </div>

              {/* 5. Bugün Oynanacak Maç */}
              <div className="bg-white rounded-lg border border-purple-100 p-2.5 shadow-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">🎬</span>
                  <span className="text-[9px] text-gray-500 uppercase font-bold tracking-wide">
                    Oynanacak
                  </span>
                </div>
                <div className="text-xl font-black text-purple-600">
                  {dailyMetrics.upcoming.total}
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">
                  🟢 {dailyMetrics.upcoming.liveNow} canlı · ⏰ {dailyMetrics.upcoming.startsSoon} başlayacak
                </div>
              </div>

              {/* 6. Genel Başarı Oranı */}
              <div className="bg-white rounded-lg border border-amber-100 p-2.5 shadow-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">🏆</span>
                  <span className="text-[9px] text-gray-500 uppercase font-bold tracking-wide">
                    Genel (90g)
                  </span>
                </div>
                <div className={`text-xl font-black ${
                  dailyMetrics.allTime.successRate >= 0.6 ? "text-emerald-600" :
                  dailyMetrics.allTime.successRate >= 0.4 ? "text-amber-500" : "text-red-500"
                }`}>
                  {(dailyMetrics.allTime.successRate * 100).toFixed(0)}%
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">
                  {dailyMetrics.allTime.totalGoals}/{dailyMetrics.allTime.totalSignals} sinyal
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Goal Radar Alert Banner ──────────────────────────── */}
      {radarCount > 0 && activeTab !== 'radar' && (
        <div className="bg-linear-to-r from-red-500 via-red-600 to-red-500 border-b border-red-700">
          <div className="max-w-350 mx-auto px-3 py-1.5 flex items-center justify-between">
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
        {/* Desktop: match list hidden when a match is selected */}
        <div className={`overflow-y-auto -webkit-overflow-scrolling-touch ${selectedMatch ? 'hidden md:hidden' : 'w-full'}`}>
          <div className="max-w-350 mx-auto p-3 pb-20">
            {renderMatchList()}
          </div>
        </div>

        {/* Desktop: full-page match detail when selected */}
        {selectedMatch && detailProps && (
          <div className="hidden md:flex w-full overflow-y-auto bg-white flex-col">
            {/* Sticky header with back button */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-2 flex items-center justify-between shadow-sm">
              <button onClick={handleCloseMatch} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 transition-colors group">
                <svg className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                <span className="text-sm font-medium">Geri</span>
              </button>
              <span className="text-sm font-semibold text-gray-600">
                {selectedMatch.home} vs {selectedMatch.away}
              </span>
              {/* Spacer for flex alignment */}
              <div className="w-16" />
            </div>
            <div className="flex-1 overflow-y-auto">
              <MatchDetailContent {...detailProps as MatchDetailContentProps} />
            </div>
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
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(92dvh - 80px)' }}>
              {selectedMatch && detailProps && <MatchDetailContent {...detailProps as MatchDetailContentProps} />}
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
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSelectedMatch(null);
          setDrawerOpen(false);
        }}
      />

      {/* Goal Notifications Portal */}
      {goalNotifications.length > 0 && favoritesLoaded && createPortal(
        <div className="fixed top-16 right-3 z-100 flex flex-col gap-2 pointer-events-none" style={{ maxWidth: '340px' }}>
          {goalNotifications.map(notif => (
            <div key={notif.id}
              className="pointer-events-auto animate-[slideInRight_0.4s_ease-out] bg-linear-to-r from-green-500 via-emerald-500 to-green-600 rounded-xl shadow-2xl border border-green-400 p-3 text-white"
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
