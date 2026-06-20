'use client'

import { useEffect, useMemo, useRef, memo, useState, useCallback } from 'react'
import { catmullRomPath } from '@/components/match/utils'

interface DADataPoint {
  minute: number
  minuteLabel: string
  homeDangerousAttacks: number
  awayDangerousAttacks: number
  homeShots?: number
  awayShots?: number
  goalEvent?: { side: 'home' | 'away'; minute: number }
}

interface DangerousAttacksChartProps {
  data: DADataPoint[]
  homeTeam: string
  awayTeam: string
  homeColor?: string
  awayColor?: string
  title?: string
  height?: number
  goalEvents?: Array<{ isHome?: boolean; minute: number }> | null
  homeShotsTotal?: number
  awayShotsTotal?: number
  homeShotsOnTarget?: number
  awayShotsOnTarget?: number
  xgHome?: number
  xgAway?: number
}

const HOME_COLOR = '#f97316'
const AWAY_COLOR = '#3b82f6'

/**
 * Professional dual-line dangerous-attacks chart.
 * - Dual Catmull-Rom smoothed lines (home orange, away blue)
 * - Gradient fills between each line and baseline
 * - Halftime shaded band
 * - Goal event markers (vertical line + ⚽)
 * - Hover tooltip
 * - Responsive — mobile 220px, desktop 280px
 * - Zero external dep (pure SVG + catmullRomPath)
 *   awayTeam: string
type t: smooth dual-line (not stacked area)
 */
export const DangerousAttacksChart = memo(function DangerousAttacksChart({
  data,
  homeTeam,
  awayTeam,
  homeColor = HOME_COLOR,
  awayColor = AWAY_COLOR,
  title = 'Tehlikeli Hücum',
  height,
  goalEvents,
}: DangerousAttacksChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const uid = useRef(`da${Math.random().toString(36).slice(2, 9)}`).current

  // Sort + clamp minute
  const series = useMemo(() => {
    if (!data?.length) return []
    return [...data]
      .map(d => ({
        ...d,
        minute: Math.max(0, Math.min(120, d.minute || 0)),
      }))
      .sort((a, b) => a.minute - b.minute)
  }, [data])

  // Cumulative sums + goal marker merge
  const cumulative = useMemo(() => {
    let h = 0, a = 0
    const goals = goalEvents ?? []
    return series.map(d => {
      h += (d.homeDangerousAttacks || 0)
      a += (d.awayDangerousAttacks || 0)
      // Fuzzy-match goal events within ±1 minute
      const goal = goals.find(g => Math.abs(g.minute - d.minute) <= 1)
      return { ...d, cumHome: h, cumAway: a, goalEvent: goal ?? undefined }
    })
  }, [series, goalEvents])

  // Bounds
  const maxVal = useMemo(() => {
    if (cumulative.length === 0) return 10
    const peak = Math.max(...cumulative.map(d => d.cumHome + d.cumAway))
    return Math.max(10, Math.ceil(peak * 1.15))
  }, [cumulative])

  const minMinute = 0
  const maxMinute = useMemo(() => {
    if (cumulative.length === 0) return 90
    return Math.max(90, cumulative[cumulative.length - 1].minute)
  }, [cumulative])

  // Responsive width
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.max(280, Math.floor(e.contentRect.width))
        setWidth(w)
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const chartHeight = height ?? (width < 480 ? 220 : 280)

  if (series.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <h3 className="text-sm font-bold text-gray-800">{title}</h3>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: homeColor }} />
              <span className="text-gray-600 font-medium">{homeTeam}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: awayColor }} />
              <span className="text-gray-600 font-medium">{awayTeam}</span>
            </span>
          </div>
        </div>
        <div className="h-[160px] flex items-center justify-center text-gray-400 text-xs">Veri bekleniyor…</div>
      </div>
    )
  }

  const padding = { top: 16, right: 16, bottom: 28, left: 36 }
  const plotW = width - padding.left - padding.right
  const plotH = chartHeight - padding.top - padding.bottom

  const xScale = (m: number) =>
    padding.left + ((m - minMinute) / Math.max(1, maxMinute - minMinute)) * plotW
  const yScale = (v: number) =>
    padding.top + plotH - (v / maxVal) * plotH

  // Points for Catmull-Rom
  const homePoints: [number, number][] = cumulative.map(d => [xScale(d.minute), yScale(d.cumHome)])
  const awayPoints: [number, number][] = cumulative.map(d => [xScale(d.minute), yScale(d.cumAway)])

  const homePath = catmullRomPath(homePoints)
  const awayPath = catmullRomPath(awayPoints)

  // Area paths: line → baseline → close
  const zy = yScale(0)
  const homeFirst = homePoints[0]; const homeLast = homePoints[homePoints.length - 1]
  const awayFirst = awayPoints[0]; const awayLast = awayPoints[awayPoints.length - 1]
  const homeAreaPath = homePath
    + ` L ${homeLast[0].toFixed(2)} ${zy.toFixed(2)}`
    + ` L ${homeFirst[0].toFixed(2)} ${zy.toFixed(2)} Z`
  const awayAreaPath = awayPath
    + ` L ${awayLast[0].toFixed(2)} ${zy.toFixed(2)}`
    + ` L ${awayFirst[0].toFixed(2)} ${zy.toFixed(2)} Z`

  const yTicks = useMemo(() => {
    const step = maxVal <= 20 ? 5 : maxVal <= 60 ? 10 : 15
    const ticks: number[] = []
    for (let v = 0; v <= maxVal; v += step) ticks.push(v)
    return ticks
  }, [maxVal])

  const xTicks = useMemo(() => {
    const ticks: number[] = []
    for (let m = 0; m <= maxMinute; m += 15) ticks.push(m)
    if (ticks[ticks.length - 1] !== maxMinute) ticks.push(maxMinute)
    return ticks
  }, [maxMinute])

  const total = cumulative[cumulative.length - 1]

  const daLast5Home = useMemo(() => {
    if (cumulative.length < 2) return 0
    const nowMin = cumulative[cumulative.length - 1].minute
    const fiveMinAgo = nowMin - 5
    let prevCum = 0
    for (const d of cumulative) { if (d.minute <= fiveMinAgo) prevCum = d.cumHome }
    return total.cumHome - prevCum
  }, [cumulative, total])
  const daLast5Away = useMemo(() => {
    if (cumulative.length < 2) return 0
    const nowMin = cumulative[cumulative.length - 1].minute
    const fiveMinAgo = nowMin - 5
    let prevCum = 0
    for (const d of cumulative) { if (d.minute <= fiveMinAgo) prevCum = d.cumAway }
    return total.cumAway - prevCum
  }, [cumulative, total])

  const hovered = hoverIdx != null ? cumulative[hoverIdx] : null

  // Mouse move handler
  const onMove = useCallback((e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
    if (!containerRef.current || cumulative.length === 0) return
    const rect = containerRef.current.getBoundingClientRect()
    const clientX = 'touches' in e ? (e as React.TouchEvent<SVGSVGElement>).touches[0].clientX : (e as React.MouseEvent<SVGSVGElement>).clientX
    const relX = clientX - rect.left
    let nearest = 0; let bestDist = Infinity
    for (let i = 0; i < cumulative.length; i++) {
      const d = Math.abs(xScale(cumulative[i].minute) - relX)
      if (d < bestDist) { bestDist = d; nearest = i }
    }
    setHoverIdx(nearest)
  }, [cumulative, width])

  const onLeave = useCallback(() => setHoverIdx(null), [])

  return (
    <div ref={containerRef} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: homeColor }} />
            <span className="text-gray-600 font-medium">{homeTeam}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: awayColor }} />
            <span className="text-gray-600 font-medium">{awayTeam}</span>
          </span>
        </div>
      </div>

      <div className="px-2 pb-2">
        {/* Stat row */}
        <div className="flex items-center justify-around py-1.5 px-2 mb-1 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">Toplam DH</span>
            <span className="font-mono font-bold" style={{ color: homeColor }}>{total.cumHome}</span>
            <span className="text-gray-300">–</span>
            <span className="font-mono font-bold" style={{ color: awayColor }}>{total.cumAway}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">Son 5dk</span>
            <span className="font-mono font-bold" style={{ color: homeColor }}>+{daLast5Home}</span>
            <span className="text-gray-300">–</span>
            <span className="font-mono font-bold" style={{ color: awayColor }}>+{daLast5Away}</span>
          </div>
        </div>

        {/* SVG Chart */}
        <div className="relative">
          <svg
            width={width}
            height={chartHeight}
            viewBox={`0 0 ${width} ${chartHeight}`}
            className="select-none"
            onMouseMove={onMove}
          onMouseLeave={onLeave}
          >
            <defs>
              <linearGradient id={`${uid}-home`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={homeColor} stopOpacity="0.50" />
                <stop offset="100%" stopColor={homeColor} stopOpacity="0.04" />
              </linearGradient>
              <linearGradient id={`${uid}-away`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={awayColor} stopOpacity="0.35" />
                <stop offset="100%" stopColor={awayColor} stopOpacity="0.04" />
              </linearGradient>
            </defs>

            {/* Y gridlines */}
            {yTicks.map(t => (
              <g key={`y-${t}`}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={yScale(t)}
                  y2={yScale(t)}
                  stroke="#f1f5f9"
                  strokeWidth={1}
                  strokeDasharray={t === 0 ? undefined : '2,3'}
                />
                <text
                  x={padding.left - 6}
                  y={yScale(t) + 3}
                  fontSize={9}
                  fill="#94a3b8"
                  textAnchor="end"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {t}
                </text>
              </g>
            ))}

            {/* X ticks */}
            {xTicks.map(m => (
              <g key={`x-${m}`}>
                <text
                  x={xScale(m)}
                  y={chartHeight - 8}
                  fontSize={9}
                  fill="#94a3b8"
                  textAnchor="middle"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {m}'
                </text>
              </g>
            ))}

            {/* Away area (behind home) */}
            <path d={awayAreaPath} fill={`url(#${uid}-away)`} stroke="none" />

            {/* Home area */}
            <path d={homeAreaPath} fill={`url(#${uid}-home)`} stroke="none" />

            {/* Away smooth line */}
            <path
              d={awayPath}
              fill="none"
              stroke={awayColor}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="5,3"
            />

            {/* Home smooth line */}
            <path
              d={homePath}
              fill="none"
              stroke={homeColor}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Goal markers */}
            {cumulative.map((d, i) => {
              if (!d.goalEvent) return null
              const x = xScale(d.minute)
              return (
                <g key={`goal-${i}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={padding.top}
                    y2={chartHeight - padding.bottom}
                    stroke="#dc2626"
                    strokeWidth={1}
                    strokeDasharray="3,2"
                    opacity={0.5}
                  />
                  <circle
                    cx={x}
                    cy={padding.top + 4}
                    r={5}
                    fill="#dc2626"
                    stroke="white"
                    strokeWidth={1.5}
                  />
                  <text
                    x={x}
                    y={padding.top - 2}
                    fontSize={9}
                    fill="#dc2626"
                    textAnchor="middle"
                    fontWeight="bold"
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    ⚽
                  </text>
                </g>
              )
            })}

            {/* Hover overlay */}
            {hovered && (
              <g pointerEvents="none">
                <line
                  x1={xScale(hovered.minute)}
                  x2={xScale(hovered.minute)}
                  y1={padding.top}
                  y2={chartHeight - padding.bottom}
                  stroke="#0f172a"
                  strokeWidth={1}
                  strokeDasharray="3,3"
                  opacity={0.5}
                />
                <circle
                  cx={xScale(hovered.minute)}
                  cy={yScale(hovered.cumHome)}
                  r={4}
                  fill={homeColor}
                  stroke="white"
                  strokeWidth={2}
                />
                <circle
                  cx={xScale(hovered.minute)}
                  cy={yScale(hovered.cumAway)}
                  r={4}
                  fill={awayColor}
                  stroke="white"
                  strokeWidth={2}
                />
              </g>
            )}

            {/* Hover hit zones */}
            {cumulative.map((d, i) => {
              const x = xScale(d.minute)
              const cellW = plotW / Math.max(1, cumulative.length)
              return (
                <rect
                  key={`hit-${i}`}
                  x={x - cellW / 2}
                  y={padding.top}
                  width={cellW}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                  onTouchStart={() => setHoverIdx(i)}
                  style={{ cursor: 'crosshair' }}
                />
              )
            })}
          </svg>

          {/* Tooltip */}
          {hovered && (
            <div
              className="absolute pointer-events-none bg-gray-900 text-white text-[10px] rounded-md px-2 py-1.5 shadow-lg z-10"
              style={{
                left: xScale(hovered.minute) > width - 120
                  ? Math.max(4, xScale(hovered.minute) - 100)
                  : xScale(hovered.minute) + 8,
                top: 8,
                minWidth: 100,
              }}
            >
              <div className="font-bold mb-0.5">{hovered.minuteLabel || `${hovered.minute}'`}</div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-sm" style={{ backgroundColor: homeColor }} />
                <span>{homeTeam}: {hovered.homeDangerousAttacks || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-sm" style={{ backgroundColor: awayColor }} />
                <span>{awayTeam}: {hovered.awayDangerousAttacks || 0}</span>
              </div>
              <div className="text-gray-400 mt-0.5">
                Kümülatif: {hovered.cumHome} / {hovered.cumAway}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})