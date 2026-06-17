'use client'

import { useState, useCallback, useRef, useMemo, memo } from 'react'
import type { FotMobEvent, FotMobShot, FotMobMomentum } from '@/lib/fotmob'
import type { MomentumBarDataPoint, xGFlowPoint, ThreatIndex } from '@/lib/advancedAnalytics'
import { ensureVisible, differentiateColors, catmullRomPath } from '@/components/match/utils'

interface UnifiedMatchMomentumChartProps {
  momentumBars: MomentumBarDataPoint[]
  xgFlowData: xGFlowPoint[]
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  homeColor: string
  awayColor: string
  threatIndex?: ThreatIndex | null
  fotmobMomentum?: FotMobMomentum | null
  fotmobShots?: FotMobShot[] | null
  fotmobHomeTeamId?: number
  fotmobAwayTeamId?: number
  goalEvents?: FotMobEvent[]
  isFotmobLoading?: boolean
}

export const UnifiedMatchMomentumChart = memo(function UnifiedMatchMomentumChart({
  momentumBars,
  xgFlowData,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  homeColor,
  awayColor,
  threatIndex,
  fotmobMomentum,
  fotmobShots,
  fotmobHomeTeamId,
  fotmobAwayTeamId,
  goalEvents: matchGoalEvents,
  isFotmobLoading,
}: UnifiedMatchMomentumChartProps) {
  const [vHome, vAway] = useMemo(() => differentiateColors(homeColor, awayColor), [homeColor, awayColor])

  const barData = useMemo(() => {
    const xtHomeBias = threatIndex ? (threatIndex.home / 100) * 25 : 0
    const xtAwayBias = threatIndex ? (threatIndex.away / 100) * 25 : 0

    // ── Path 1: FotMob momentum data (highest quality, full timeline) ──
    if (fotmobMomentum?.main?.data && fotmobMomentum.main.data.length > 0) {
      const fmData = fotmobMomentum.main.data
      const homeTeamId = fotmobHomeTeamId
      const awayTeamId = fotmobAwayTeamId

      const homeXgAcc = new Map<number, number>()
      const awayXgAcc = new Map<number, number>()
      let cumHomeXg = 0
      let cumAwayXg = 0

      if (fotmobShots && fotmobShots.length > 0 && homeTeamId && awayTeamId) {
        const sortedShots = [...fotmobShots].sort((a, b) => a.min - b.min)
        for (const shot of sortedShots) {
          if (shot.teamId === homeTeamId) {
            cumHomeXg += shot.expectedGoals || 0
          } else if (shot.teamId === awayTeamId) {
            cumAwayXg += shot.expectedGoals || 0
          }
          const min = Math.floor(shot.min)
          homeXgAcc.set(min, cumHomeXg)
          awayXgAcc.set(min, cumAwayXg)
        }
      }

      const goalHomeSet = new Set<number>()
      const goalAwaySet = new Set<number>()
      if (matchGoalEvents) {
        for (const ev of matchGoalEvents) {
          const min = typeof ev.time === 'number' ? ev.time : parseInt(String(ev.time).replace(/[^0-9]/g, ''), 10)
          if (!isNaN(min)) {
            if (ev.isHome) goalHomeSet.add(min)
            else goalAwaySet.add(min)
          }
        }
      }

      const maxFmVal = Math.max(...fmData.map(x => Math.abs(x.value)), 0.5)
      const targetMax = 85
      const scaleFactor = targetMax / maxFmVal

      return fmData.map(d => {
        const minNum = Math.floor(d.minute)
        const isGoalHome = goalHomeSet.has(minNum)
        const isGoalAway = goalAwaySet.has(minNum)

        let hxg = 0, axg = 0
        for (const [m, v] of homeXgAcc) { if (m <= minNum) hxg = v }
        for (const [m, v] of awayXgAcc) { if (m <= minNum) axg = v }

        const scaledValue = Math.max(-95, Math.min(95, d.value * scaleFactor))

        return {
          minute: `${minNum}'`,
          minuteNum: minNum,
          homeBar: scaledValue >= 0 ? scaledValue : 0,
          awayBar: scaledValue < 0 ? scaledValue : 0,
          homeXg: hxg,
          awayXg: axg,
          isGoalHome,
          isGoalAway,
        }
      })
    }

    // ── Path 2: Nesine momentum bars ──
    if (momentumBars && momentumBars.length >= 2) {
      const maxFlow = Math.max(
        ...momentumBars.map(d => Math.max(d.homeFlow, d.awayFlow)),
        1
      )

      const xgInfluence = xgFlowData.map(xf => {
        const homeDelta = xf.homeXgDelta ?? 0
        const awayDelta = xf.awayXgDelta ?? 0
        return { home: homeDelta * 50, away: awayDelta * 50 }
      })

      const minuteMap = new Map<number, {
        homeFlowSum: number; awayFlowSum: number;
        homeXgDelta: number; awayXgDelta: number;
        homeXg: number; awayXg: number;
        isGoalHome: boolean; isGoalAway: boolean;
        count: number;
      }>()

      for (let i = 0; i < momentumBars.length; i++) {
        const mb = momentumBars[i]
        const minNum = Math.floor(mb.minuteNum)
        const xgMatch = xgFlowData.find(xf => xf.minute === mb.minute) || xgFlowData[i]
        const xgI = xgInfluence[i] ?? { home: 0, away: 0 }

        const existing = minuteMap.get(minNum)
        if (existing) {
          existing.homeFlowSum += mb.homeFlow
          existing.awayFlowSum += mb.awayFlow
          existing.homeXgDelta += xgI.home
          existing.awayXgDelta += xgI.away
          existing.homeXg = xgMatch?.homeXg ?? existing.homeXg
          existing.awayXg = xgMatch?.awayXg ?? existing.awayXg
          existing.isGoalHome = existing.isGoalHome || mb.isGoalHome
          existing.isGoalAway = existing.isGoalAway || mb.isGoalAway
          existing.count++
        } else {
          minuteMap.set(minNum, {
            homeFlowSum: mb.homeFlow,
            awayFlowSum: mb.awayFlow,
            homeXgDelta: xgI.home,
            awayXgDelta: xgI.away,
            homeXg: xgMatch?.homeXg ?? 0,
            awayXg: xgMatch?.awayXg ?? 0,
            isGoalHome: mb.isGoalHome,
            isGoalAway: mb.isGoalAway,
            count: 1,
          })
        }
      }

      const rawResult: { minuteNum: number; rawMomentum: number; homeXg: number; awayXg: number; isGoalHome: boolean; isGoalAway: boolean }[] = []

      const sortedMins = [...minuteMap.keys()].sort((a, b) => a - b)
      for (const minNum of sortedMins) {
        const m = minuteMap.get(minNum)!
        const avgHome = m.homeFlowSum / m.count
        const avgAway = m.awayFlowSum / m.count

        const homePressure = (avgHome / maxFlow) * 100 + m.homeXgDelta * 0.3 + xtHomeBias
        const awayPressure = (avgAway / maxFlow) * 100 + m.awayXgDelta * 0.3 + xtAwayBias
        const rawMomentum = homePressure - awayPressure

        rawResult.push({
          minuteNum: minNum,
          rawMomentum,
          homeXg: m.homeXg,
          awayXg: m.awayXg,
          isGoalHome: m.isGoalHome,
          isGoalAway: m.isGoalAway,
        })
      }

      const maxAbsMomentum = Math.max(...rawResult.map(r => Math.abs(r.rawMomentum)), 0.1)
      const normTarget = 85
      const normScale = Math.max(normTarget / maxAbsMomentum, 5)

      return rawResult.map(r => {
        const momentum = Math.max(-95, Math.min(95, r.rawMomentum * normScale))
        return {
          minute: `${r.minuteNum}'`,
          minuteNum: r.minuteNum,
          homeBar: momentum >= 0 ? Math.round(momentum * 10) / 10 : 0,
          awayBar: momentum < 0 ? Math.round(momentum * 10) / 10 : 0,
          homeXg: r.homeXg,
          awayXg: r.awayXg,
          isGoalHome: r.isGoalHome,
          isGoalAway: r.isGoalAway,
        }
      })
    }

    return []
  }, [momentumBars, xgFlowData, threatIndex, fotmobMomentum, fotmobShots, fotmobHomeTeamId, fotmobAwayTeamId, matchGoalEvents])

  const htIndex = barData.findIndex(d => d.minuteNum >= 44 && d.minuteNum <= 46)
  const goalEvents = barData.filter(d => d.isGoalHome || d.isGoalAway)

  const fotmobHomeXg = useMemo(() => {
    if (fotmobShots && fotmobShots.length > 0 && fotmobHomeTeamId) {
      return fotmobShots.filter(s => s.teamId === fotmobHomeTeamId).reduce((sum, s) => sum + (s.expectedGoals || 0), 0)
    }
    return 0
  }, [fotmobShots, fotmobHomeTeamId])

  const fotmobAwayXg = useMemo(() => {
    if (fotmobShots && fotmobShots.length > 0 && fotmobAwayTeamId) {
      return fotmobShots.filter(s => s.teamId === fotmobAwayTeamId).reduce((sum, s) => sum + (s.expectedGoals || 0), 0)
    }
    return 0
  }, [fotmobShots, fotmobAwayTeamId])

  const hasFotmobXg = fotmobHomeXg > 0 || fotmobAwayXg > 0
  const finalHomeXg = hasFotmobXg ? fotmobHomeXg : (xgFlowData.length > 0 ? xgFlowData[xgFlowData.length - 1].homeXg : 0)
  const finalAwayXg = hasFotmobXg ? fotmobAwayXg : (xgFlowData.length > 0 ? xgFlowData[xgFlowData.length - 1].awayXg : 0)
  const isEstimated = !hasFotmobXg && (xgFlowData.length > 0 ? xgFlowData[xgFlowData.length - 1].isEstimated : false)

  const uidRef = useRef(`uid_${Math.random().toString(36).slice(2, 9)}`)
  const uid = uidRef.current

  const [hoverInfo, setHoverInfo] = useState<{
    minuteNum: number; momentum: number; x: number; y: number;
    homeBar: number; awayBar: number; homeXg: number; awayXg: number;
  } | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  const CHART_W = 1000
  const CHART_H = 420
  const PAD = { l: 62, r: 30, t: 30, b: 40 }
  const innerW = CHART_W - PAD.l - PAD.r
  const innerH = CHART_H - PAD.t - PAD.b
  const maxMinute = Math.max(...barData.map(d => d.minuteNum), 90)

  const xScale = (m: number) => PAD.l + (m / maxMinute) * innerW
  const yScale = (v: number) => PAD.t + (1 - (v + 100) / 200) * innerH

  const momentumData = useMemo(() => {
    return barData.map(d => ({
      ...d,
      momentum: (d.homeBar ?? 0) + (d.awayBar ?? 0),
    }))
  }, [barData])

  const { linePath, areaPath, zeroY, points } = useMemo(() => {
    const pts: [number, number][] = momentumData.map(d => [xScale(d.minuteNum), yScale(d.momentum)])
    const zy = yScale(0)
    if (pts.length < 2) return { linePath: '', areaPath: '', zeroY: zy, points: pts }
    const lp = catmullRomPath(pts)
    const ap = `${lp} L ${pts[pts.length - 1][0].toFixed(2)} ${zy.toFixed(2)} L ${pts[0][0].toFixed(2)} ${zy.toFixed(2)} Z`
    return { linePath: lp, areaPath: ap, zeroY: zy, points: pts }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [momentumData, maxMinute])

  const handleChartMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartRef.current || momentumData.length === 0) return
    const rect = chartRef.current.getBoundingClientRect()
    const xPct = (e.clientX - rect.left) / rect.width
    const svgX = xPct * CHART_W
    const minuteAt = ((svgX - PAD.l) / innerW) * maxMinute

    let nearest = momentumData[0]
    let bestDist = Math.abs(momentumData[0].minuteNum - minuteAt)
    for (const d of momentumData) {
      const dist = Math.abs(d.minuteNum - minuteAt)
      if (dist < bestDist) { nearest = d; bestDist = dist }
    }

    setHoverInfo({
      minuteNum: nearest.minuteNum,
      momentum: nearest.momentum,
      x: xScale(nearest.minuteNum),
      y: yScale(nearest.momentum),
      homeBar: nearest.homeBar,
      awayBar: nearest.awayBar,
      homeXg: nearest.homeXg,
      awayXg: nearest.awayXg,
    })
  }, [momentumData, maxMinute])

  const handleChartMouseLeave = useCallback(() => {
    setHoverInfo(null)
  }, [])

  if (barData.length < 2) {
    if (isFotmobLoading) {
      return (
        <div className="rounded-xl overflow-hidden bg-white border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-center gap-2 text-gray-400">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
            <span className="text-sm">Veri yükleniyor...</span>
          </div>
        </div>
      )
    }
    if (momentumBars.length < 2 && !fotmobMomentum?.main?.data?.length) {
      return (
        <div className="rounded-xl overflow-hidden bg-white border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-center gap-2 text-gray-400">
            <span className="text-sm">Momentum verisi toplanıyor...</span>
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="rounded-xl overflow-hidden bg-white border border-gray-200 shadow-sm">
      {threatIndex && (() => {
        const gap = threatIndex.home - threatIndex.away
        if (Math.abs(gap) < 5) return null
        const isHome = gap > 0
        const bannerColor = isHome ? vHome : vAway
        return (
          <div
            className="mx-3 mt-2 px-3 py-1 rounded-lg text-center"
            style={{
              background: `linear-gradient(135deg, ${bannerColor}12 0%, ${bannerColor}06 100%)`,
              border: `1px solid ${bannerColor}25`,
            }}
          >
            <span className="text-[11px] font-bold" style={{ color: bannerColor }}>
              {threatIndex.interpretation}
            </span>
          </div>
        )
      })()}

      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: vHome }} />
          <span className="text-gray-900 text-xs font-bold truncate max-w-22.5">{homeTeam}</span>
          <span className="text-gray-900 text-lg font-black mx-0.5">{homeScore}</span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono whitespace-nowrap"
            style={{ backgroundColor: `${vHome}12`, color: vHome }}
          >
            {(finalHomeXg ?? 0).toFixed(2)} xG
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono whitespace-nowrap"
            style={{ backgroundColor: `${vAway}12`, color: vAway }}
          >
            {(finalAwayXg ?? 0).toFixed(2)} xG
          </span>
          <span className="text-gray-900 text-lg font-black mx-0.5">{awayScore}</span>
          <span className="text-gray-900 text-xs font-bold truncate max-w-22.5">{awayTeam}</span>
          <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: vAway }} />
        </div>
      </div>

      {isEstimated && (
        <div className="px-4 pb-0.5">
          <span className="text-[8px] text-gray-400 font-mono">xG tahmini</span>
        </div>
      )}

      {/* ── Smooth Momentum Area Chart (SVG) ─────── */}
      <div className="px-2">
        <div
          ref={chartRef}
          style={{ position: 'relative', width: '100%', aspectRatio: '16 / 7', cursor: 'crosshair', willChange: 'transform' }}
          onMouseMove={handleChartMouseMove}
          onMouseLeave={handleChartMouseLeave}
        >
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: '100%', display: 'block' }}
          >
            <defs>
              <linearGradient id={`gradPos_${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={vHome} stopOpacity={0.55} />
                <stop offset="100%" stopColor={vHome} stopOpacity={0.03} />
              </linearGradient>
              <linearGradient id={`gradNeg_${uid}`} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={vAway} stopOpacity={0.55} />
                <stop offset="100%" stopColor={vAway} stopOpacity={0.03} />
              </linearGradient>
              <linearGradient id={`lineGrad_${uid}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={vHome} />
                <stop offset="50%" stopColor="#0f172a" />
                <stop offset="100%" stopColor={vAway} />
              </linearGradient>
              <filter id={`shadow_${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feOffset dx="0" dy="1" in="blur" result="offsetBlur" />
                <feComponentTransfer>
                  <feFuncA type="linear" slope="0.4" />
                </feComponentTransfer>
                <feMerge>
                  <feMergeNode in="offsetBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <clipPath id={`clipTop_${uid}`}>
                <rect x={PAD.l} y={PAD.t} width={innerW} height={Math.max(0, zeroY - PAD.t)} />
              </clipPath>
              <clipPath id={`clipBot_${uid}`}>
                <rect x={PAD.l} y={Math.max(PAD.t, zeroY)} width={innerW} height={Math.max(0, CHART_H - PAD.b - Math.max(PAD.t, zeroY))} />
              </clipPath>
            </defs>

            {/* ── Grid ── */}
            {[-100, -50, 0, 50, 100].map(v => {
              const yy = yScale(v)
              const isZero = v === 0
              const isExtreme = v === 100 || v === -100
              return (
                <g key={`gy-${v}`}>
                  <line
                    x1={PAD.l} y1={yy} x2={CHART_W - PAD.r} y2={yy}
                    stroke={isZero ? '#94a3b8' : '#f1f5f9'}
                    strokeWidth={isZero ? 1.5 : 0.75}
                    strokeDasharray={isZero ? '0' : '4 6'}
                  />
                  <text
                    x={PAD.l - 8} y={yy + 4}
                    textAnchor="end"
                    fill={isZero ? '#334155' : isExtreme ? (v === 100 ? vHome : vAway) : '#94a3b8'}
                    fontSize={isExtreme ? 10 : 10}
                    fontWeight={isZero ? 700 : isExtreme ? 700 : 400}
                  >
                    {v === 100 ? homeTeam.substring(0, 8) : v === -100 ? awayTeam.substring(0, 8) : (v > 0 ? '+' : '') + v}
                  </text>
                </g>
              )
            })}

            {[0, 15, 30, 45, 60, 75, 90].map(m => {
              const xx = xScale(m)
              const isHT = m === 45
              return (
                <g key={`gx-${m}`}>
                  <line
                    x1={xx} y1={PAD.t} x2={xx} y2={CHART_H - PAD.b}
                    stroke={isHT ? '#16a34a' : '#e2e8f0'}
                    strokeWidth={isHT ? 1 : 0.5}
                    strokeDasharray={isHT ? '0' : '2 4'}
                    opacity={isHT ? 0.6 : 0.7}
                  />
                  <text
                    x={xx} y={CHART_H - PAD.b + 18}
                    textAnchor="middle"
                    fill={isHT ? '#16a34a' : '#64748b'}
                    fontSize={11}
                    fontWeight={isHT ? 700 : 400}
                  >
                    {m}'{isHT ? '  Devre Arası' : ''}
                  </text>
                </g>
              )
            })}

            {/* ── Filled areas with clip paths ── */}
            <path d={areaPath} fill={`url(#gradPos_${uid})`} clipPath={`url(#clipTop_${uid})`} />
            <path d={areaPath} fill={`url(#gradNeg_${uid})`} clipPath={`url(#clipBot_${uid})`} />

            {/* ── Smooth line ── */}
            <path
              d={linePath}
              fill="none"
              stroke={`url(#lineGrad_${uid})`}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#shadow_${uid})`}
            />

            {/* ── Goal markers ── */}
            {goalEvents.map((ev, idx) => {
              const cx = xScale(ev.minuteNum)
              const evMomentum = (ev.homeBar ?? 0) + (ev.awayBar ?? 0)
              const cy = yScale(evMomentum)
              const isHome = ev.isGoalHome
              const color = isHome ? vHome : vAway
              const labelY = evMomentum >= 0 ? cy - 18 : cy + 22
              return (
                <g key={`goal-${idx}`}>
                  <line x1={cx} y1={cy} x2={cx} y2={zeroY}
                    stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.3} />
                  <circle cx={cx} cy={cy} r={6}
                    fill={color} stroke="#ffffff" strokeWidth={2} opacity={0.9} />
                  <text x={cx} y={labelY}
                    textAnchor="middle" fontSize={9} fontWeight={700} fill={color}>
                    {ev.minuteNum}'
                  </text>
                </g>
              )
            })}

            {/* ── Endpoints ── */}
            {points.length > 0 && (
              <>
                <circle cx={points[0][0]} cy={points[0][1]} r={4} fill="#ffffff" stroke="#0f172a" strokeWidth={2} />
                <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={4} fill="#ffffff" stroke="#0f172a" strokeWidth={2} />
              </>
            )}

            {/* ── Hover line & dot ── */}
            {hoverInfo && (
              <>
                <line
                  x1={hoverInfo.x} y1={PAD.t} x2={hoverInfo.x} y2={CHART_H - PAD.b}
                  stroke="#0f172a" strokeWidth={1} opacity={0.5} strokeDasharray="3 3"
                />
                <circle cx={hoverInfo.x} cy={hoverInfo.y} r={6}
                  fill="#ffffff" stroke="#0f172a" strokeWidth={2} />
              </>
            )}
          </svg>

          {/* ── Tooltip ── */}
          {hoverInfo && (() => {
            const xPct = (hoverInfo.x / CHART_W) * 100
            const yPct = (hoverInfo.y / CHART_H) * 100
            const team = hoverInfo.momentum > 5
              ? homeTeam
              : hoverInfo.momentum < -5
                ? awayTeam
                : null
            const dominantColor = hoverInfo.momentum > 0 ? vHome : vAway
            const isBalanced = Math.abs(hoverInfo.momentum) <= 5
            return (
              <div style={{
                position: 'absolute',
                left: `${xPct}%`,
                top: `${yPct}%`,
                transform: 'translate(-50%, -115%)',
                background: 'rgba(255,255,255,0.97)',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '6px 10px',
                fontSize: 11,
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 16px rgba(15, 23, 42, 0.10)',
                zIndex: 10,
                pointerEvents: 'none',
                color: '#0f172a',
              }}>
                <div style={{ fontWeight: 800, fontSize: 12, color: '#16a34a' }}>{hoverInfo.minuteNum}'</div>
                <div style={{ fontSize: 11, color: dominantColor, fontWeight: 700, marginTop: 1 }}>
                  {isBalanced ? 'Dengeli' : `${team} +${Math.abs(hoverInfo.momentum).toFixed(0)}`}
                </div>
                {(hoverInfo.homeXg > 0 || hoverInfo.awayXg > 0) && (
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, borderTop: '1px solid #f1f5f9', paddingTop: 2 }}>
                    xG <span style={{ fontWeight: 700, color: vHome }}>{hoverInfo.homeXg.toFixed(2)}</span>
                    {' — '}
                    <span style={{ fontWeight: 700, color: vAway }}>{hoverInfo.awayXg.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      </div>

      {/* ── Compact legend ── */}
      <div className="flex items-center justify-center gap-5 px-5 pb-1 pt-0.5 text-[10px]">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: vHome }} />
          <span className="text-gray-500 font-medium">{homeTeam}</span>
        </div>
        <div className="w-px h-2.5 bg-gray-300" />
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: vAway }} />
          <span className="text-gray-500 font-medium">{awayTeam}</span>
        </div>
        <div className="w-px h-2.5 bg-gray-300" />
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          <span className="text-gray-400">Gol</span>
        </div>
      </div>

      {threatIndex && (() => {
        const homeTotal = threatIndex.home
        const awayTotal = threatIndex.away
        const total = homeTotal + awayTotal || 1
        const homePct = Math.round((homeTotal / total) * 100)
        return (
          <div className="mx-3 mt-1 mb-2 rounded-lg bg-gray-50/70 border border-gray-100 px-3 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-gray-600">xT Tehdit</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black" style={{ color: vHome }}>{homeTotal}</span>
                <span className="text-[9px] text-gray-300">-</span>
                <span className="text-[10px] font-black" style={{ color: vAway }}>{awayTotal}</span>
              </div>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-200/50">
              <div className="rounded-l-full transition-all duration-700" style={{ width: `${homePct}%`, background: `linear-gradient(90deg, ${vHome}90, ${vHome})` }} />
              <div className="rounded-r-full transition-all duration-700" style={{ width: `${100 - homePct}%`, background: `linear-gradient(270deg, ${vAway}90, ${vAway})` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] font-semibold" style={{ color: vHome }}>{homeTeam} {homePct}%</span>
              <span className="text-[9px] font-semibold" style={{ color: vAway }}>{100 - homePct}% {awayTeam}</span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
