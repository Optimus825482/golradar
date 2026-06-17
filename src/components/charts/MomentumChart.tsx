'use client'

import { useEffect, useRef, useMemo, memo } from 'react'
import { useGoogleCharts } from '@/lib/useGoogleCharts'
import { CleanChartCard } from './CleanChartCard'

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
  const { loaded } = useGoogleCharts(['gauge'])

  // Son veri noktasi
  const lastPoint = useMemo(() => {
    if (!data?.length) return { homePressure: 50, awayPressure: 50, minute: "0'" }
    const last = data[data.length - 1]
    return {
      homePressure: last.homePressure ?? 0,
      awayPressure: last.awayPressure ?? 0,
      minute: last.minute,
    }
  }, [data])

  // Baski farki
  const dominantTeam = useMemo(() => {
    const diff = lastPoint.homePressure - lastPoint.awayPressure
    if (Math.abs(diff) < 5) return null
    return diff > 0 ? homeTeam : awayTeam
  }, [lastPoint, homeTeam, awayTeam])

  // ── Tek seferlik Gauge kurulumu + deger guncelleme ──
  useEffect(() => {
    if (!loaded) return

    // Initial draw only once
    if (!gaugeReady.current) {
      if (gaugeHomeRef.current) {
        const homeDt = new window.google.visualization.DataTable()
        homeDt.addColumn('number', homeTeam)
        homeDt.addColumn({ type: 'string', role: 'annotation' })
        homeDt.addRows([[lastPoint.homePressure, `${Math.round(lastPoint.homePressure)}%`]])
        gaugeHomeInstance.current = new window.google.visualization.Gauge(gaugeHomeRef.current)
        gaugeHomeInstance.current.draw(homeDt, {
          width: gaugeHomeRef.current.clientWidth || 160,
          height: 130,
          min: 0, max: 100,
          greenFrom: 50, greenTo: 100,
          yellowFrom: 25, yellowTo: 50,
          redFrom: 0, redTo: 25,
          minorTicks: 5,
          majorTicks: ['0', '25', '50', '75', '100'],
        })
      }

      if (gaugeAwayRef.current) {
        const awayDt = new window.google.visualization.DataTable()
        awayDt.addColumn('number', awayTeam)
        awayDt.addColumn({ type: 'string', role: 'annotation' })
        awayDt.addRows([[lastPoint.awayPressure, `${Math.round(lastPoint.awayPressure)}%`]])
        gaugeAwayInstance.current = new window.google.visualization.Gauge(gaugeAwayRef.current)
        gaugeAwayInstance.current.draw(awayDt, {
          width: gaugeAwayRef.current.clientWidth || 160,
          height: 130,
          min: 0, max: 100,
          greenFrom: 50, greenTo: 100,
          yellowFrom: 25, yellowTo: 50,
          redFrom: 0, redTo: 25,
          minorTicks: 5,
          majorTicks: ['0', '25', '50', '75', '100'],
        })
      }

      gaugeReady.current = true
      lastHomeVal.current = lastPoint.homePressure
      lastAwayVal.current = lastPoint.awayPressure
      return
    }

    // Subsequent updates: only redraw if value actually changed
    const homeChanged = lastPoint.homePressure !== lastHomeVal.current
    const awayChanged = lastPoint.awayPressure !== lastAwayVal.current

    if (homeChanged && gaugeHomeInstance.current) {
      const dt = new window.google.visualization.DataTable()
      dt.addColumn('number', homeTeam)
      dt.addColumn({ type: 'string', role: 'annotation' })
      dt.addRows([[lastPoint.homePressure, `${Math.round(lastPoint.homePressure)}%`]])
      gaugeHomeInstance.current.draw(dt, { width: gaugeHomeRef.current?.clientWidth || 160, height: 130 })
      lastHomeVal.current = lastPoint.homePressure
    }

    if (awayChanged && gaugeAwayInstance.current) {
      const dt = new window.google.visualization.DataTable()
      dt.addColumn('number', awayTeam)
      dt.addColumn({ type: 'string', role: 'annotation' })
      dt.addRows([[lastPoint.awayPressure, `${Math.round(lastPoint.awayPressure)}%`]])
      gaugeAwayInstance.current.draw(dt, { width: gaugeAwayRef.current?.clientWidth || 160, height: 130 })
      lastAwayVal.current = lastPoint.awayPressure
    }
  }, [loaded, lastPoint.homePressure, lastPoint.awayPressure, homeTeam, awayTeam])

  return (
    <CleanChartCard title="Baski" homeTeam={homeTeam} awayTeam={awayTeam}>
      <div className="px-2 pt-1 pb-2" style={{ transform: 'translateZ(0)' }}>
        <div className="flex items-center justify-center gap-4 mb-1">
          {/* Ev gauge */}
          <div className="flex flex-col items-center">
            <div ref={gaugeHomeRef} className="w-37.5 h-27.5" style={{ contain: 'strict', willChange: 'transform' }} />
            <div className="flex items-center gap-1.5 -mt-1">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="text-[10px] font-semibold text-gray-700 truncate max-w-20">{homeTeam}</span>
            </div>
          </div>

          {/* Dominant gosterge */}
          <div className="flex flex-col items-center justify-center px-2">
            {dominantTeam ? (
              <>
                <div className={`text-[18px] font-black tracking-tight ${dominantTeam === homeTeam ? 'text-orange-500' : 'text-blue-500'}`}>
                  {dominantTeam === homeTeam ? homeTeam.substring(0, 10) : awayTeam.substring(0, 10)}
                </div>
                <div className="text-[9px] text-gray-400 font-medium -mt-0.5">Baskin</div>
              </>
            ) : (
              <>
                <div className="text-[18px] font-black text-gray-400">=</div>
                <div className="text-[9px] text-gray-400 font-medium -mt-0.5">Dengeli</div>
              </>
            )}
          </div>

          {/* Away gauge */}
          <div className="flex flex-col items-center">
            <div ref={gaugeAwayRef} className="w-37.5 h-27.5" style={{ contain: 'strict', willChange: 'transform' }} />
            <div className="flex items-center gap-1.5 -mt-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-[10px] font-semibold text-gray-700 truncate max-w-20">{awayTeam}</span>
            </div>
          </div>
        </div>

        {/* Baski seviyesi bar */}
        <div className="relative h-6 mx-8 mb-1">
          <div className="absolute inset-0 flex items-center">
            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden flex">
              <div
                className="h-full rounded-l-full"
                style={{
                  width: `${lastPoint.homePressure / (lastPoint.homePressure + lastPoint.awayPressure || 1) * 100}%`,
                  background: `linear-gradient(90deg, #f97316, #fb923c)`,
                }}
              />
              <div
                className="h-full rounded-r-full"
                style={{
                  width: `${lastPoint.awayPressure / (lastPoint.homePressure + lastPoint.awayPressure || 1) * 100}%`,
                  background: `linear-gradient(270deg, #3b82f6, #60a5fa)`,
                }}
              />
            </div>
          </div>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-full bg-gray-300 rounded-full" />
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-400 rounded-full border border-white" />
        </div>
      </div>
    </CleanChartCard>
  )
})
