'use client'

import { useEffect, useRef, useMemo, memo } from 'react'
import { useGoogleCharts } from '@/lib/useGoogleCharts'
import { CleanChartCard } from './CleanChartCard'

const TEAM_COLORS = { home: '#f97316', away: '#3b82f6' } as const

export const MomentumChart = memo(function MomentumChart({ data, homeTeam, awayTeam }: {
  data: { minute: string; homePressure: number; awayPressure: number }[]
  homeTeam: string
  awayTeam: string
}) {
  const gaugeHomeRef = useRef<HTMLDivElement>(null)
  const gaugeAwayRef = useRef<HTMLDivElement>(null)
  const gaugeHomeInstance = useRef<any>(null)
  const gaugeAwayInstance = useRef<any>(null)
  const lastHomeVal = useRef(-1)
  const lastAwayVal = useRef(-1)
  const gaugeReady = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { loaded } = useGoogleCharts(['gauge'])

  // Stable width tracking via ResizeObserver
  const gaugeWidthRef = useRef(160)

  const lastPoint = useMemo(() => {
    if (!data?.length) return { homePressure: 50, awayPressure: 50, minute: "0'" }
    const last = data[data.length - 1]
    return {
      homePressure: last.homePressure ?? 0,
      awayPressure: last.awayPressure ?? 0,
      minute: last.minute,
    }
  }, [data])

  const dominantTeam = useMemo(() => {
    const diff = lastPoint.homePressure - lastPoint.awayPressure
    if (Math.abs(diff) < 5) return null
    return diff > 0 ? homeTeam : awayTeam
  }, [lastPoint, homeTeam, awayTeam])

  const gaugeOpts = (teamColor: string) => ({
    width: gaugeWidthRef.current,
    height: 130,
    min: 0, max: 100,
    greenFrom: 55, greenTo: 100,
    greenColor: teamColor,
    yellowFrom: 30, yellowTo: 55,
    yellowColor: '#fbbf24',
    redFrom: 0, redTo: 30,
    redColor: '#fca5a5',
    minorTicks: 5,
    majorTicks: ['0', '25', '50', '75', '100'],
  })

  function drawGauge(instance: any, ref: HTMLDivElement | null, value: number, opts: any) {
    if (!ref || !instance) return
    const dt = new window.google.visualization.DataTable()
    dt.addColumn('number', '')
    dt.addColumn({ type: 'string', role: 'annotation' })
    dt.addRows([[value, `${Math.round(value)}%`]])
    instance.draw(dt, opts)
  }

  // ResizeObserver for responsive gauge width
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.max(120, Math.min(200, e.contentRect.width / 2 - 24))
        gaugeWidthRef.current = w
        // Redraw on resize if already initialized
        if (gaugeReady.current) {
          const homeOpts = gaugeOpts(TEAM_COLORS.home)
          const awayOpts = gaugeOpts(TEAM_COLORS.away)
          homeOpts.width = w
          awayOpts.width = w
          drawGauge(gaugeHomeInstance.current, gaugeHomeRef.current, lastPoint.homePressure, homeOpts)
          drawGauge(gaugeAwayInstance.current, gaugeAwayRef.current, lastPoint.awayPressure, awayOpts)
        }
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [loaded, homeTeam, awayTeam, lastPoint])

  // Initial draw + update
  useEffect(() => {
    if (!loaded) return

    const homeOpts = gaugeOpts(TEAM_COLORS.home)
    const awayOpts = gaugeOpts(TEAM_COLORS.away)

    if (!gaugeReady.current && gaugeHomeRef.current && gaugeAwayRef.current) {
      gaugeHomeInstance.current = new window.google.visualization.Gauge(gaugeHomeRef.current)
      gaugeAwayInstance.current = new window.google.visualization.Gauge(gaugeAwayRef.current)
      drawGauge(gaugeHomeInstance.current, gaugeHomeRef.current, lastPoint.homePressure, homeOpts)
      drawGauge(gaugeAwayInstance.current, gaugeAwayRef.current, lastPoint.awayPressure, awayOpts)
      gaugeReady.current = true
      lastHomeVal.current = lastPoint.homePressure
      lastAwayVal.current = lastPoint.awayPressure
      return
    }

    if (lastPoint.homePressure !== lastHomeVal.current && gaugeHomeInstance.current) {
      drawGauge(gaugeHomeInstance.current, gaugeHomeRef.current, lastPoint.homePressure, homeOpts)
      lastHomeVal.current = lastPoint.homePressure
    }
    if (lastPoint.awayPressure !== lastAwayVal.current && gaugeAwayInstance.current) {
      drawGauge(gaugeAwayInstance.current, gaugeAwayRef.current, lastPoint.awayPressure, awayOpts)
      lastAwayVal.current = lastPoint.awayPressure
    }
  }, [loaded, lastPoint.homePressure, lastPoint.awayPressure, homeTeam, awayTeam])

  return (
    <CleanChartCard title="Baskı" homeTeam={homeTeam} awayTeam={awayTeam} homeColor={TEAM_COLORS.home} awayColor={TEAM_COLORS.away}>
      <div ref={containerRef} className="px-2 pt-1 pb-2">
        <div className="flex items-center justify-center gap-4 mb-1">
          <div className="flex flex-col items-center flex-1 min-w-0">
            <div ref={gaugeHomeRef} style={{ width: gaugeWidthRef.current, height: 130 }} />
            <div className="flex items-center gap-1.5 -mt-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: TEAM_COLORS.home }} />
              <span className="text-[10px] font-semibold text-gray-700 truncate">{homeTeam}</span>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center px-1 shrink-0">
            <div className="text-[18px] font-black tracking-tight" style={{
              color: dominantTeam
                ? (dominantTeam === homeTeam ? TEAM_COLORS.home : TEAM_COLORS.away)
                : '#9ca3af'
            }}>
              {dominantTeam ? dominantTeam.substring(0, 12) : '='}
            </div>
            <div className="text-[9px] text-gray-400 font-medium -mt-0.5">
              {dominantTeam ? 'Baskın' : 'Dengeli'}
            </div>
          </div>

          <div className="flex flex-col items-center flex-1 min-w-0">
            <div ref={gaugeAwayRef} style={{ width: gaugeWidthRef.current, height: 130 }} />
            <div className="flex items-center gap-1.5 -mt-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: TEAM_COLORS.away }} />
              <span className="text-[10px] font-semibold text-gray-700 truncate">{awayTeam}</span>
            </div>
          </div>
        </div>

        <div className="relative h-6 mx-4 mb-1">
          <div className="absolute inset-0 flex items-center">
            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden flex">
              <div className="h-full rounded-l-full transition-all duration-500"
                style={{
                  width: `${lastPoint.homePressure / Math.max(1, lastPoint.homePressure + lastPoint.awayPressure) * 100}%`,
                  background: `linear-gradient(90deg, ${TEAM_COLORS.home}, ${TEAM_COLORS.home}cc)`,
                }} />
              <div className="h-full rounded-r-full transition-all duration-500"
                style={{
                  width: `${lastPoint.awayPressure / Math.max(1, lastPoint.homePressure + lastPoint.awayPressure) * 100}%`,
                  background: `linear-gradient(270deg, ${TEAM_COLORS.away}, ${TEAM_COLORS.away}cc)`,
                }} />
            </div>
          </div>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-full bg-gray-300 rounded-full" />
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-400 rounded-full border border-white" />
        </div>
      </div>
    </CleanChartCard>
  )
})
