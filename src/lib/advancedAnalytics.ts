// ── Advanced Football Analytics Engine ──────────────────────────
// Implements approximations of:
//   1. Match Momentum (Opta Analyst / StatsPerform PV-inspired)
//   2. Expected Threat (xT) approximation from aggregate stats
//   3. xG Flow / xPG GameFlow-inspired momentum bars
//   4. Threat Index (simplified xT from available data)
//
// NOTE: True xT, PV, xPG require event-level coordinate data
// (pass/dribble/shot x,y locations) which our APIs don't provide.
// These implementations use the richest available data (aggregated
// stats over time) to create meaningful approximations.

// ── Types ────────────────────────────────────────────────────────

export type { MatchStats } from './nesineTypes';
import type { MatchStats } from './nesineTypes';

export interface _LegacyRemoved {
  [key: string]: { home: number | null; away: number | null }
}

export interface PressureSnapshot {
  minute: string
  timestamp: number
  homePressure: number
  awayPressure: number
  stats: MatchStats
  homeGoals?: number
  awayGoals?: number
}

// ── 1. OPTA-STYLE MATCH MOMENTUM ────────────────────────────────
// Inspired by Opta Match Momentum (StatsPerform PV model):
//   Momentum_t = PV_max(team_A, window_t) - PV_max(team_B, window_t)
//   PV ∈ [0, 0.1], weighted by recency (last 3-4 min dominant)
//
// Our approximation:
//   - Use pressure index as proxy for "threat of scoring"
//   - Apply exponential decay weighting (recent minutes dominate)
//   - Center around 0 (positive = home dominant, negative = away dominant)
//   - Cap and smooth to prevent wild fluctuations

interface MomentumDataPoint {
  minute: string
  minuteNum: number
  momentum: number      // -100 to +100 (positive=home, negative=away)
  homeThreat: number    // 0-100
  awayThreat: number    // 0-100
  smoothing: number     // smoothed momentum
  isGoalHome: boolean
  isGoalAway: boolean
}

function calculateMatchMomentum(
  snapshots: PressureSnapshot[]
): MomentumDataPoint[] {
  if (!snapshots || snapshots.length < 2) return []

  const DECAY_FACTOR = 0.3  // Exponential decay for recency weighting (λ)
  const SMOOTHING_WINDOW = 3 // Moving average window for smoothing
  const CAP_VALUE = 85       // Cap extreme values

  const points: MomentumDataPoint[] = []

  // Extract minute numbers for proper indexing
  const parseMin = (m: string): number => {
    const num = parseInt(m.replace(/[^0-9]/g, ''), 10)
    if (m.includes('DA')) return 45
    if (!num) return 0
    // Handle "45+3'" format
    const plus = m.match(/\+(\d+)/)
    if (plus) return num + parseInt(plus[1], 10) * 0.1 // fractional for stoppage
    return num
  }

  // Apply exponential decay weighting to pressure values
  // More recent snapshots get higher weight
  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]
    const minNum = parseMin(snap.minute)

    // Calculate weighted threat using recency
    // Look back up to 4 snapshots (~40 seconds) with exponential decay
    let weightedHome = 0
    let weightedAway = 0
    let totalWeight = 0

    const lookback = Math.min(4, i + 1)
    for (let j = 0; j < lookback; j++) {
      const idx = i - j
      const s = snapshots[idx]
      const weight = Math.exp(-DECAY_FACTOR * j)
      weightedHome += s.homePressure * weight
      weightedAway += s.awayPressure * weight
      totalWeight += weight
    }

    const homeThreat = totalWeight > 0 ? weightedHome / totalWeight : snap.homePressure
    const awayThreat = totalWeight > 0 ? weightedAway / totalWeight : snap.awayPressure

    // Momentum = home threat - away threat (centered at 0)
    let momentum = homeThreat - awayThreat

    // Cap extreme values
    momentum = Math.max(-CAP_VALUE, Math.min(CAP_VALUE, momentum))

    // Detect goals
    let isGoalHome = false
    let isGoalAway = false
    if (i > 0) {
      const prev = snapshots[i - 1]
      const prevHG = prev.homeGoals ?? 0
      const prevAG = prev.awayGoals ?? 0
      const curHG = snap.homeGoals ?? 0
      const curAG = snap.awayGoals ?? 0
      isGoalHome = curHG > prevHG
      isGoalAway = curAG > prevAG
    }

    points.push({
      minute: snap.minute,
      minuteNum: minNum,
      momentum: Math.round(momentum * 10) / 10,
      homeThreat: Math.round(homeThreat * 10) / 10,
      awayThreat: Math.round(awayThreat * 10) / 10,
      smoothing: 0, // Will be filled below
      isGoalHome,
      isGoalAway,
    })
  }

  // Apply moving average smoothing
  for (let i = 0; i < points.length; i++) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - SMOOTHING_WINDOW); j <= Math.min(points.length - 1, i + SMOOTHING_WINDOW); j++) {
      sum += points[j].momentum
      count++
    }
    points[i].smoothing = Math.round((sum / count) * 10) / 10
  }

  return points
}

// ── 2. EXPECTED THREAT (xT) APPROXIMATION ───────────────────────
// True xT uses a 16×12 pitch grid with Markov chain transitions.
// Since we lack coordinate data, we approximate using:
//   - Shot quality (xG from Nesine when available)
//   - Dangerous attack frequency and trend
//   - Shot accuracy (on-target ratio)
//   - Corner frequency (set-piece threat)
//   - Possession dominance (territorial control proxy)
//
// The result is a "Threat Index" per team per minute window.

export interface ThreatIndex {
  home: number       // 0-100
  away: number       // 0-100
  homeComponents: ThreatComponents
  awayComponents: ThreatComponents
  interpretation: string  // Human-readable
}

export interface ThreatComponents {
  shotQuality: number     // xG + on-target efficiency
  attackPressure: number  // Dangerous attacks rate & trend
  setPiece: number        // Corner + free kick threat
  territorial: number    // Possession dominance
  momentum: number       // Pressure trend acceleration
  total: number          // Weighted sum
}

export function calculateThreatIndex(
  stats: MatchStats,
  minute: string,
  pressureHistory?: PressureSnapshot[]
): ThreatIndex {
  // Parse minute
  let minNum = parseInt(minute.replace(/[^0-9]/g, ''), 10)
  if (minute.includes('DA') || !minNum) minNum = 45
  minNum = Math.max(1, Math.min(120, minNum))

  // Helper to get stat value
  const getStat = (key: string, side: 'home' | 'away'): number => {
    const s = stats[key]
    if (!s) return 0
    return (side === 'home' ? s.home : s.away) ?? 0
  }

  // ── Component 1: Shot Quality (0-25 pts) ──
  // xG is ideal but Nesine API rarely provides it (ET=121).
  // When unavailable, estimate from shots using industry-average conversion:
  //   SOT × 0.38 + off_target × 0.05 + blocked × 0.03 + corners × 0.04 + DA × 0.01
  const homeShotsTotal = getStat('shots_total', 'home')
  const awayShotsTotal = getStat('shots_total', 'away')
  const homeShotsOnTarget = getStat('shots_on_target', 'home')
  const awayShotsOnTarget = getStat('shots_on_target', 'away')
  const homeShotsBlocked = getStat('shots_blocked', 'home')
  const awayShotsBlocked = getStat('shots_blocked', 'away')
  const homeCorners = getStat('corners', 'home')
  const awayCorners = getStat('corners', 'away')
  const homeDangerAttacks = getStat('dangerous_attacks', 'home')
  const awayDangerAttacks = getStat('dangerous_attacks', 'away')
  const apiXgHome = getStat('xg', 'home')
  const apiXgAway = getStat('xg', 'away')

  // Use API xG when available; otherwise estimate from absolute shot counts
  const homeXg = apiXgHome > 0
    ? apiXgHome
    : homeShotsOnTarget * 0.38 + Math.max(0, homeShotsTotal - homeShotsOnTarget - homeShotsBlocked) * 0.05 + homeShotsBlocked * 0.03 + homeCorners * 0.04 + homeDangerAttacks * 0.01
  const awayXg = apiXgAway > 0
    ? apiXgAway
    : awayShotsOnTarget * 0.38 + Math.max(0, awayShotsTotal - awayShotsOnTarget - awayShotsBlocked) * 0.05 + awayShotsBlocked * 0.03 + awayCorners * 0.04 + awayDangerAttacks * 0.01

  // Scale estimated xG to 0-25 points for shot quality component
  const homeShotQuality = Math.min(25, homeXg * 12)
  const awayShotQuality = Math.min(25, awayXg * 12)

  // ── Component 2: Attack Pressure (0-25 pts) ──
  // Based on dangerous attack rate per 15 minutes
  const elapsed15minWindows = Math.max(1, minNum / 15)
  const homeAttackRate = homeDangerAttacks / elapsed15minWindows
  const awayAttackRate = awayDangerAttacks / elapsed15minWindows

  // Detect acceleration in recent snapshots
  let homeAccel = 0
  let awayAccel = 0
  if (pressureHistory && pressureHistory.length >= 6) {
    const recent = pressureHistory.slice(-3)
    const older = pressureHistory.slice(-6, -3)
    const recentHomeDA = recent.reduce((s, p) => s + (p.stats.dangerous_attacks?.home ?? 0), 0) / 3
    const olderHomeDA = older.reduce((s, p) => s + (p.stats.dangerous_attacks?.home ?? 0), 0) / 3
    const recentAwayDA = recent.reduce((s, p) => s + (p.stats.dangerous_attacks?.away ?? 0), 0) / 3
    const olderAwayDA = older.reduce((s, p) => s + (p.stats.dangerous_attacks?.away ?? 0), 0) / 3
    homeAccel = Math.max(0, recentHomeDA - olderHomeDA)
    awayAccel = Math.max(0, recentAwayDA - olderAwayDA)
  }

  const homeAttackPressure = Math.min(25, homeAttackRate * 4 + homeAccel * 2)
  const awayAttackPressure = Math.min(25, awayAttackRate * 4 + awayAccel * 2)

  // ── Component 3: Set Piece Threat (0-15 pts) ──
  const homeFreeKicks = getStat('free_kicks', 'home')
  const awayFreeKicks = getStat('free_kicks', 'away')

  const homeSetPiece = Math.min(15, homeCorners * 1.5 + homeFreeKicks * 0.3)
  const awaySetPiece = Math.min(15, awayCorners * 1.5 + awayFreeKicks * 0.3)

  // ── Component 4: Territorial Control (0-15 pts) ──
  const homePoss = getStat('possession', 'home')
  const awayPoss = getStat('possession', 'away')
  const possTotal = homePoss + awayPoss

  const homeTerritorial = possTotal > 0 ? Math.min(15, Math.max(0, (homePoss - 50) * 0.75 + 7.5)) : 7.5
  const awayTerritorial = possTotal > 0 ? Math.min(15, Math.max(0, (awayPoss - 50) * 0.75 + 7.5)) : 7.5

  // ── Component 5: Momentum / Trend (0-20 pts) ──
  let homeMomentumScore = 10 // neutral
  let awayMomentumScore = 10
  if (pressureHistory && pressureHistory.length >= 4) {
    const recent3 = pressureHistory.slice(-3)
    const older3 = pressureHistory.slice(-6, -3)
    if (older3.length >= 2) {
      const recentHomeP = recent3.reduce((s, p) => s + p.homePressure, 0) / recent3.length
      const olderHomeP = older3.reduce((s, p) => s + p.homePressure, 0) / older3.length
      const recentAwayP = recent3.reduce((s, p) => s + p.awayPressure, 0) / recent3.length
      const olderAwayP = older3.reduce((s, p) => s + p.awayPressure, 0) / older3.length

      // Hockey stick detection: rapid upward trend
      const homeTrend = recentHomeP - olderHomeP
      const awayTrend = recentAwayP - olderAwayP

      homeMomentumScore = Math.min(20, Math.max(0, 10 + homeTrend * 0.8))
      awayMomentumScore = Math.min(20, Math.max(0, 10 + awayTrend * 0.8))
    }
  }

  // ── Assemble ──
  const homeComponents: ThreatComponents = {
    shotQuality: Math.round(homeShotQuality * 10) / 10,
    attackPressure: Math.round(homeAttackPressure * 10) / 10,
    setPiece: Math.round(homeSetPiece * 10) / 10,
    territorial: Math.round(homeTerritorial * 10) / 10,
    momentum: Math.round(homeMomentumScore * 10) / 10,
    total: 0,
  }
  homeComponents.total = Math.round(
    homeComponents.shotQuality + homeComponents.attackPressure +
    homeComponents.setPiece + homeComponents.territorial + homeComponents.momentum
  )

  const awayComponents: ThreatComponents = {
    shotQuality: Math.round(awayShotQuality * 10) / 10,
    attackPressure: Math.round(awayAttackPressure * 10) / 10,
    setPiece: Math.round(awaySetPiece * 10) / 10,
    territorial: Math.round(awayTerritorial * 10) / 10,
    momentum: Math.round(awayMomentumScore * 10) / 10,
    total: 0,
  }
  awayComponents.total = Math.round(
    awayComponents.shotQuality + awayComponents.attackPressure +
    awayComponents.setPiece + awayComponents.territorial + awayComponents.momentum
  )

  // Interpretation
  const gap = homeComponents.total - awayComponents.total
  let interpretation = ''
  if (Math.abs(gap) < 5) {
    interpretation = 'Dengeli — İki takım da eşit tehdit oluşturuyor'
  } else if (gap >= 5 && gap < 15) {
    interpretation = 'Ev sahibi hafif üstün tehdit'
  } else if (gap >= 15 && gap < 30) {
    interpretation = 'Ev sahibi baskın — Gol tehdidi yüksek'
  } else if (gap >= 30) {
    interpretation = 'Ev sahibi çok baskın — Kritik gol tehdidi!'
  } else if (gap <= -5 && gap > -15) {
    interpretation = 'Deplasman hafif üstün tehdit'
  } else if (gap <= -15 && gap > -30) {
    interpretation = 'Deplasman baskın — Gol tehdidi yüksek'
  } else {
    interpretation = 'Deplasman çok baskın — Kritik gol tehdidi!'
  }

  return {
    home: Math.min(100, homeComponents.total),
    away: Math.min(100, awayComponents.total),
    homeComponents,
    awayComponents,
    interpretation,
  }
}

// ── 3. xG FLOW / xPG GAMEFLOW-INSPIRED MOMENTUM BARS ───────────
// Inspired by xPG GameFlow: Momentum_bar_t = xPG(Home, t) - xPG(Away, t)
//
// Our approximation:
//   - Use per-snapshot stat changes as "possession value" proxy
//   - Each snapshot's stat delta = how much each team "produced" in that window
//   - Weight by how threatening each stat change is (similar to xT zone values)

export interface MomentumBarDataPoint {
  minute: string
  minuteNum: number
  homeFlow: number     // positive = home created threat
  awayFlow: number     // positive = away created threat
  netFlow: number      // homeFlow - awayFlow (positive=home dominant)
  isGoalHome: boolean
  isGoalAway: boolean
}

export function calculateMomentumBars(
  snapshots: PressureSnapshot[]
): MomentumBarDataPoint[] {
  if (!snapshots || snapshots.length < 2) return []

  const parseMin = (m: string): number => {
    const num = parseInt(m.replace(/[^0-9]/g, ''), 10)
    if (m.includes('DA')) return 45
    return num || 0
  }

  // Weight each stat delta by "threat value" (approximation of xT zone values)
  const threatWeights: Record<string, number> = {
    xg: 10,                // Direct goal probability
    shots_on_target: 6,    // Near-goal actions
    dangerous_attacks: 4,  // Threatening possession
    shots_total: 3,        // Shot attempts
    corners: 2.5,          // Set piece in dangerous area
    free_kicks: 1.5,       // Potential set piece
    possession: 0.5,       // Low-threat territorial control
    shots_off_target: 1.5,
    shots_blocked: 1,
  }

  const bars: MomentumBarDataPoint[] = []

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1]
    const cur = snapshots[i]
    const minNum = parseMin(cur.minute)

    let homeFlow = 0
    let awayFlow = 0

    // Calculate delta for each stat and weight by threat value
    for (const [key, weight] of Object.entries(threatWeights)) {
      const prevStat = prev.stats[key]
      const curStat = cur.stats[key]
      if (prevStat && curStat) {
        const homeDelta = (curStat.home ?? 0) - (prevStat.home ?? 0)
        const awayDelta = (curStat.away ?? 0) - (prevStat.away ?? 0)
        if (homeDelta > 0) homeFlow += homeDelta * weight
        if (awayDelta > 0) awayFlow += awayDelta * weight
      }
    }

    // Also factor in pressure change as "territorial momentum"
    const homePressureDelta = cur.homePressure - prev.homePressure
    const awayPressureDelta = cur.awayPressure - prev.awayPressure
    homeFlow += Math.max(0, homePressureDelta) * 0.2
    awayFlow += Math.max(0, awayPressureDelta) * 0.2

    // Cap extreme values
    homeFlow = Math.min(50, homeFlow)
    awayFlow = Math.min(50, awayFlow)

    // Goal detection
    const isGoalHome = (cur.homeGoals ?? 0) > (prev.homeGoals ?? 0)
    const isGoalAway = (cur.awayGoals ?? 0) > (prev.awayGoals ?? 0)

    bars.push({
      minute: cur.minute,
      minuteNum: minNum,
      homeFlow: Math.round(homeFlow * 10) / 10,
      awayFlow: Math.round(awayFlow * 10) / 10,
      netFlow: Math.round((homeFlow - awayFlow) * 10) / 10,
      isGoalHome,
      isGoalAway,
    })
  }

  return bars
}

// ── 4. xG ACCUMULATION CURVE ────────────────────────────────────
// Shows how xG builds up over the match for each team.
// When xG is not available from the API (Nesine rarely provides ET=121),
// we estimate from shot data using industry-average conversion rates:
//   - Shot on target: ~0.30 xG (varies by league, 0.25-0.35)
//   - Shot off target: ~0.06 xG
//   - Shot blocked: ~0.04 xG
//
// KEY FIX: Previous version only looked at DELTAS between snapshots,
// which meant if the server restarted mid-match, all existing shots
// were invisible. Now we estimate xG from ABSOLUTE shot counts at
// each snapshot, ensuring values are always meaningful.

export interface xGFlowPoint {
  minute: string
  minuteNum: number
  homeXg: number       // Cumulative xG for home
  awayXg: number       // Cumulative xG for away
  homeXgDelta: number  // xG added in this snapshot
  awayXgDelta: number  // xG added in this snapshot
  isGoalHome: boolean
  isGoalAway: boolean
  isEstimated: boolean  // Whether xG is estimated (true) or from API (false)
}

import { estimateXgFromShotsBoth } from './estimateXg';

/**
 * Estimate xG from shot stats when API xG is not available.
 * Uses absolute shot counts, not deltas, so it works even with
 * a single snapshot or after server restart.
 * Delegates to the shared, research-backed estimateXg module.
 */
export function estimateXgFromShots(stats: MatchStats): { home: number; away: number } {
  return estimateXgFromShotsBoth(stats);
}

/**
 * Check if the API provides real xG data for a snapshot
 */
function hasApiXg(stats: MatchStats): boolean {
  return (stats.xg?.home != null && stats.xg!.home! > 0) ||
         (stats.xg?.away != null && stats.xg!.away! > 0)
}

export function calculateXgFlow(
  snapshots: PressureSnapshot[]
): xGFlowPoint[] {
  if (!snapshots || snapshots.length < 1) return []

  const parseMin = (m: string): number => {
    const num = parseInt(m.replace(/[^0-9]/g, ''), 10)
    if (m.includes('DA')) return 45
    return num || 0
  }

  // Determine if we should use API xG or shot-based estimation
  // Check the latest snapshot — if it has real xG, use API xG throughout
  const latestStats = snapshots[snapshots.length - 1].stats
  const useApiXg = hasApiXg(latestStats)

  const points: xGFlowPoint[] = []

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]
    const minNum = parseMin(snap.minute)

    let homeXg = 0
    let awayXg = 0
    let homeXgDelta = 0
    let awayXgDelta = 0

    if (useApiXg) {
      // API provides real xG — use it directly
      homeXg = snap.stats.xg?.home ?? 0
      awayXg = snap.stats.xg?.away ?? 0
      if (i > 0) {
        const prev = snapshots[i - 1]
        const prevHomeXg = prev.stats.xg?.home ?? 0
        const prevAwayXg = prev.stats.xg?.away ?? 0
        homeXgDelta = Math.max(0, homeXg - prevHomeXg)
        awayXgDelta = Math.max(0, awayXg - prevAwayXg)
      } else {
        homeXgDelta = homeXg
        awayXgDelta = awayXg
      }
    } else {
      // No API xG — estimate from absolute shot counts
      const estimated = estimateXgFromShots(snap.stats)
      homeXg = estimated.home
      awayXg = estimated.away

      if (i > 0) {
        const prev = snapshots[i - 1]
        const prevEstimated = estimateXgFromShots(prev.stats)
        homeXgDelta = Math.max(0, homeXg - prevEstimated.home)
        awayXgDelta = Math.max(0, awayXg - prevEstimated.away)
      } else {
        homeXgDelta = homeXg
        awayXgDelta = awayXg
      }
    }

    // Goal detection
    let isGoalHome = false
    let isGoalAway = false
    if (i > 0) {
      const prev = snapshots[i - 1]
      isGoalHome = (snap.homeGoals ?? 0) > (prev.homeGoals ?? 0)
      isGoalAway = (snap.awayGoals ?? 0) > (prev.awayGoals ?? 0)
    }

    points.push({
      minute: snap.minute,
      minuteNum: minNum,
      homeXg: Math.round(homeXg * 100) / 100,
      awayXg: Math.round(awayXg * 100) / 100,
      homeXgDelta: Math.round(homeXgDelta * 100) / 100,
      awayXgDelta: Math.round(awayXgDelta * 100) / 100,
      isGoalHome,
      isGoalAway,
      isEstimated: !useApiXg,
    })
  }

  return points
}

// ── 5. PRESSURE INTENSITY CLASSIFICATION ────────────────────────
// Classifies each minute window by pressure intensity
// Similar to how Opta colors their momentum graph

type PressureZone = 'calm' | 'building' | 'intense' | 'critical'

function classifyPressure(momentum: number): PressureZone {
  const abs = Math.abs(momentum)
  if (abs < 10) return 'calm'
  if (abs < 25) return 'building'
  if (abs < 45) return 'intense'
  return 'critical'
}

function getPressureZoneColor(zone: PressureZone, side: 'home' | 'away'): string {
  const colors = {
    calm: '#e5e7eb',
    building: side === 'home' ? '#fed7aa' : '#bfdbfe',
    intense: side === 'home' ? '#fb923c' : '#60a5fa',
    critical: side === 'home' ? '#ea580c' : '#2563eb',
  }
  return colors[zone]
}

// ── 6. MATCH NARRATIVE GENERATOR ────────────────────────────────
// Generates a minute-by-minute narrative using momentum data
// Like Opta Analyst's match commentary

interface NarrativeEvent {
  minuteNum: number
  minute: string
  type: 'goal' | 'shift' | 'dominance' | 'surge' | 'calm'
  side: 'home' | 'away' | 'neutral'
  text: string
  momentum: number
}

function generateNarrative(
  momentumData: MomentumDataPoint[],
  homeTeam: string,
  awayTeam: string
): NarrativeEvent[] {
  if (!momentumData || momentumData.length < 5) return []

  const events: NarrativeEvent[] = []
  let lastDominantSide: 'home' | 'away' | 'neutral' = 'neutral'
  let dominanceStart = 0

  for (let i = 0; i < momentumData.length; i++) {
    const d = momentumData[i]
    const m = d.smoothing // Use smoothed momentum

    // Goal events
    if (d.isGoalHome) {
      events.push({
        minuteNum: d.minuteNum,
        minute: d.minute,
        type: 'goal',
        side: 'home',
        text: `⚽ ${homeTeam} gol! ${d.minute}`,
        momentum: m,
      })
      continue
    }
    if (d.isGoalAway) {
      events.push({
        minuteNum: d.minuteNum,
        minute: d.minute,
        type: 'goal',
        side: 'away',
        text: `⚽ ${awayTeam} gol! ${d.minute}`,
        momentum: m,
      })
      continue
    }

    // Momentum shift detection
    if (i >= 3) {
      const prev3 = momentumData.slice(i - 3, i)
      const avgPrev = prev3.reduce((s, p) => s + p.smoothing, 0) / 3
      const shift = m - avgPrev

      if (Math.abs(shift) > 15) {
        const shiftSide = shift > 0 ? 'home' : 'away'
        const shiftTeam = shiftSide === 'home' ? homeTeam : awayTeam
        events.push({
          minuteNum: d.minuteNum,
          minute: d.minute,
          type: 'shift',
          side: shiftSide,
          text: `${d.minute} ${shiftTeam} momentum kazandı`,
          momentum: m,
        })
        continue
      }
    }

    // Sustained dominance detection
    if (Math.abs(m) > 30) {
      const dominantSide: 'home' | 'away' = m > 0 ? 'home' : 'away'
      if (dominantSide !== lastDominantSide) {
        dominanceStart = i
        lastDominantSide = dominantSide
      }
      // Check if dominance sustained for 5+ snapshots
      if (i - dominanceStart >= 5 && (i - dominanceStart) % 5 === 0) {
        const team = dominantSide === 'home' ? homeTeam : awayTeam
        events.push({
          minuteNum: d.minuteNum,
          minute: d.minute,
          type: 'dominance',
          side: dominantSide,
          text: `${d.minute} ${team}持续 baskı (${Math.abs(m).toFixed(0)})`,
          momentum: m,
        })
      }
    } else {
      lastDominantSide = 'neutral'
    }
  }

  return events
}

// ── 7. SYNTHETIC PRESSURE SNAPSHOTS FROM SCOREMER DATA ──────────
// When the user first opens a match, we have no pressure history
// from the beginning. But Scoremer provides HT (1st half) and FT (full-time)
// aggregate stats. We can reconstruct approximate pressure snapshots
// by interpolating stat values between 0→HT and HT→FT.
//
// This gives the momentum chart data to draw from minute 1,
// instead of showing an empty chart until enough snapshots accumulate.

/**
 * Generate synthetic pressure snapshots from Scoremer HT+FT stats.
 *
 * @param ftStats  Full-time aggregate stats (from Scoremer)
 * @param htStats  Half-time aggregate stats (from Scoremer, optional)
 * @param homeScore  Final home score
 * @param awayScore  Final away score
 * @param firstHalfScore  "H-A" format half-time score (optional)
 * @returns PressureSnapshot[] with 5-minute intervals from 0' to 90'
 */
export function generateSyntheticSnapshots(
  ftStats: MatchStats,
  htStats: MatchStats | null,
  homeScore: number,
  awayScore: number,
  firstHalfScore?: string,
): PressureSnapshot[] {
  const snapshots: PressureSnapshot[] = []

  // Parse HT score if available (supports both "1:2" and "1-2" formats)
  let htHomeGoals = 0
  let htAwayGoals = 0
  if (firstHalfScore && firstHalfScore !== '-') {
    const parts = firstHalfScore.split(/[-:]/)
    if (parts.length === 2) {
      htHomeGoals = parseInt(parts[0], 10) || 0
      htAwayGoals = parseInt(parts[1], 10) || 0
    }
  }

  // Helper: interpolate a stat value linearly from 0 to target over elapsed minutes
  const interpStat = (
    targetVal: number | null,
    elapsed: number,
    total: number,
  ): number | null => {
    if (targetVal === null) return null
    if (total <= 0) return targetVal // edge case
    // Simple linear: at minute M of a T-minute half, expect M/T of the stats
    const ratio = Math.max(0, Math.min(1, elapsed / total))
    return Math.round(targetVal * ratio * 10) / 10
  }

  // Generate snapshots at 5-minute intervals
  // 1st half: 5, 10, 15, 20, 25, 30, 35, 40, 45
  // 2nd half: 50, 55, 60, 65, 70, 75, 80, 85, 90
  const minutes = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]

  // Determine which stats keys to interpolate
  const statKeys = Object.keys(ftStats).length > 0
    ? Object.keys(ftStats)
    : ['possession', 'dangerous_attacks', 'shots_total', 'shots_on_target', 'shots_off_target', 'corners', 'offsides', 'fouls', 'free_kicks', 'yellow_cards', 'red_cards']

  for (const min of minutes) {
    const is1h = min <= 45
    const halfMin = is1h ? min : min - 45
    const halfTotal = 45

    // Pick the target stats for this half
    const targetStats = is1h
      ? (htStats && Object.keys(htStats).length > 0 ? htStats : ftStats)
      : ftStats

    // For 2nd half, we need the diff (FT - HT)
    const baseStats = is1h ? null : htStats

    // Interpolate each stat
    const stats: MatchStats = {
      shots_on_target: { home: 0, away: 0 },
      shots_off_target: { home: 0, away: 0 },
      dangerous_attacks: { home: 0, away: 0 },
      attacks: { home: 0, away: 0 },
      possession: { home: 50, away: 50 },
      corners: { home: 0, away: 0 },
      yellow_cards: { home: 0, away: 0 },
      red_cards: { home: 0, away: 0 },
      shots_blocked: { home: 0, away: 0 },
      shots_total: { home: 0, away: 0 },
    }
    for (const key of statKeys) {
      const target = targetStats[key]
      if (!target) continue

      const targetHome = target.home ?? 0
      const targetAway = target.away ?? 0

      if (is1h) {
        // 1st half: interpolate from 0 to HT target
        ;(stats as Record<string, { home: number; away: number }>)[key] = {
          home: interpStat(targetHome, halfMin, halfTotal) ?? 0,
          away: interpStat(targetAway, halfMin, halfTotal) ?? 0,
        }
      } else {
        // 2nd half: interpolate from HT values to FT values
        const baseHome = baseStats?.[key]?.home ?? 0
        const baseAway = baseStats?.[key]?.away ?? 0
        const diffHome = targetHome - baseHome
        const diffAway = targetAway - baseAway

        // For possession, it doesn't accumulate — use FT value
        if (key === 'possession') {
          stats[key] = { home: targetHome, away: targetAway }
        } else {
          stats[key] = {
            home: baseHome + (interpStat(diffHome, halfMin, halfTotal) ?? 0),
            away: baseAway + (interpStat(diffAway, halfMin, halfTotal) ?? 0),
          }
        }
      }
    }

    // Calculate pressure from stats
    const homePressure = calcPressureFromStats(stats, 'home')
    const awayPressure = calcPressureFromStats(stats, 'away')

    // Estimate goals at this minute
    let homeGoals = 0
    let awayGoals = 0
    if (is1h) {
      // Rough: goals are distributed evenly across the half
      homeGoals = Math.round(htHomeGoals * (halfMin / halfTotal))
      awayGoals = Math.round(htAwayGoals * (halfMin / halfTotal))
    } else {
      homeGoals = htHomeGoals + Math.round((homeScore - htHomeGoals) * (halfMin / halfTotal))
      awayGoals = htAwayGoals + Math.round((awayScore - htAwayGoals) * (halfMin / halfTotal))
    }

    snapshots.push({
      minute: `${min}'`,
      timestamp: Date.now() - (90 - min) * 60000, // fake timestamps going back
      homePressure,
      awayPressure,
      stats,
      homeGoals,
      awayGoals,
    })
  }

  return snapshots
}

/**
 * Calculate pressure from stats (same weights as page.tsx calculatePressure)
 */
function calcPressureFromStats(stats: MatchStats, side: 'home' | 'away'): number {
  const weights: Record<string, number> = {
    possession: 0.075,          // Faz 1: Halved per Klemp 2021 (was 0.15)
    dangerous_attacks: 0.30,    // Faz 1: Boosted (was 0.25)
    shots_total: 0.15,
    shots_on_target: 0.25,      // Faz 1: Boosted per Fan & Wang 2024 (was 0.20)
    corners: 0.125,             // Faz 1: Boosted per Fan & Wang 2024 (was 0.10)
  }

  let pressure = 0
  for (const [key, weight] of Object.entries(weights)) {
    const stat = stats[key]
    if (stat && stat.home != null && stat.away != null) {
      const total = stat.home + stat.away
      if (total > 0) {
        const val = side === 'home' ? stat.home : stat.away
        pressure += (val / total) * weight * 100
      }
    }
  }

  return Math.round(pressure)
}
