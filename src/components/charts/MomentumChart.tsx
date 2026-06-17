'use client'

import { useEffect, useRef, useMemo, memo } from 'react'
import { useGoogleCharts } from '@/lib/useGoogleCharts'
import { CleanChartCard } from './CleanChartCard'

export const MomentumChart = memo(function MomentumChart({ data, homeTeam, awayTeam }: {
  data: { minute: string; homePressure: number; awayPressure: number }[]
  homeTeam: string
  awayTeam: string
}) {
  const chartRef = useRef<HTMLDivElement>(null)
  const gaugeHomeRef = useRef<HTMLDivElement>(null)
  const gaugeAwayRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<any>(null)
  const gaugeHomeInstance = useRef<any>(null)
  const gaugeAwayInstance = useRef<any>(null)
  const gaugesDrawn = useRef(false)
  const lastGaugeKey = useRef('')
  const lastAreaKey = useRef('')
  const { loaded } = useGoogleCharts(['corechart', 'gauge'])

  // Son veri noktasi - Gauge'lar icin
  const lastPoint = useMemo(() => {
    if (!data?.length) return { homePressure: 50, awayPressure: 50, minute: "0'" }
    const last = data[data.length - 1]
    return {
      homePressure: last.homePressure ?? 0,
      awayPressure: last.awayPressure ?? 0,
      minute: last.minute,
    }
  }, [data])

  // Baski farki hangi takim lehine?
  const dominantTeam = useMemo(() => {
    const diff = lastPoint.homePressure - lastPoint.awayPressure
    if (Math.abs(diff) < 5) return null
    return diff > 0 ? homeTeam : awayTeam
  }, [lastPoint, homeTeam, awayTeam])

  const htIndex = useMemo(() => {
    return data.findIndex(d => {
      const minStr = d.minute.replace(/[+'']/g, '')
      const min = parseInt(minStr, 10)
      return min >= 44 && min <= 46
    })
  }, [data])

  const maxMinute = useMemo(() => {
    if (!data?.length) return 90
    const mins = data.map(d => parseInt(String(d.minute).replace(/[^0-9]/g, ''), 10))
    return Math.max(...mins, 90)
  }, [data])

  // ── Gauge cizimi ──
  useEffect(() => {
    if (!loaded) return

    const gk = `${lastPoint.homePressure}-${lastPoint.awayPressure}`
    if (gk === lastGaugeKey.current && gaugesDrawn.current) return
    lastGaugeKey.current = gk

    // Ev gauge
    if (gaugeHomeRef.current) {
      const homeDt = new window.google.visualization.DataTable()
      homeDt.addColumn('number', homeTeam)
      homeDt.addColumn({ type: 'string', role: 'annotation' })
      homeDt.addRows([[lastPoint.homePressure, `${Math.round(lastPoint.homePressure)}%`]])

      if (!gaugeHomeInstance.current) {
        gaugeHomeInstance.current = new window.google.visualization.Gauge(gaugeHomeRef.current)
      }
      gaugeHomeInstance.current.draw(homeDt, {
        width: gaugeHomeRef.current.clientWidth || 160,
        height: 130,
        min: 0,
        max: 100,
        greenFrom: 50,
        greenTo: 100,
        yellowFrom: 25,
        yellowTo: 50,
        redFrom: 0,
        redTo: 25,
        minorTicks: 5,
        majorTicks: ['0', '25', '50', '75', '100'],
        animation: { startup: true, duration: 600 },
      })
    }

    // Deplasman gauge
    if (gaugeAwayRef.current) {
      const awayDt = new window.google.visualization.DataTable()
      awayDt.addColumn('number', awayTeam)
      awayDt.addColumn({ type: 'string', role: 'annotation' })
      awayDt.addRows([[lastPoint.awayPressure, `${Math.round(lastPoint.awayPressure)}%`]])

      if (!gaugeAwayInstance.current) {
        gaugeAwayInstance.current = new window.google.visualization.Gauge(gaugeAwayRef.current)
      }
      gaugeAwayInstance.current.draw(awayDt, {
        width: gaugeAwayRef.current.clientWidth || 160,
        height: 130,
        min: 0,
        max: 100,
        greenFrom: 50,
        greenTo: 100,
        yellowFrom: 25,
        yellowTo: 50,
        redFrom: 0,
        redTo: 25,
        minorTicks: 5,
        majorTicks: ['0', '25', '50', '75', '100'],
        animation: { startup: true, duration: 600 },
      })
    }

    gaugesDrawn.current = true
  }, [loaded, lastPoint, homeTeam, awayTeam])

  // ── Area Chart cizimi ──
  useEffect(() => {
    if (!loaded || !chartRef.current || !data?.length) return

    // Skip if data content hasn't changed
    const lastEl = data[data.length - 1]
    const ak = `${data.length}_${lastEl.minute}_${lastEl.homePressure}_${lastEl.awayPressure}`
    if (ak === lastAreaKey.current && chartInstance.current) return
    lastAreaKey.current = ak

    const container = chartRef.current
    const dt = new window.google.visualization.DataTable()
    dt.addColumn('number', 'Dakika')
    dt.addColumn('number', homeTeam)
    dt.addColumn('number', awayTeam)
    dt.addRows(data.map(d => {
      const min = parseInt(String(d.minute).replace(/[^0-9]/g, ''), 10)
      return [min, d.homePressure, d.awayPressure]
    }))

    const options = {
      title: 'Momentum',
      titleTextStyle: { fontSize: 13, bold: true, color: '#1e293b', fontName: 'Inter' },
      legend: {
        position: 'bottom',
        textStyle: { fontSize: 11, color: '#64748b', fontName: 'Inter' },
        alignment: 'center',
      },
      colors: ['#f97316', '#3b82f6'],
      areaOpacity: 0.05,
      lineWidth: 3,
      pointSize: 2,
      pointShape: 'circle',
      curveType: 'function',
      chartArea: { left: 52, right: 20, top: 24, bottom: 48 },
      animation: { startup: true, duration: 800, easing: 'out' },
      explorer: { actions: ['dragToZoom', 'rightClickToReset'], maxZoomIn: 0.1, keepInBounds: true },
      focusTarget: 'category',
      tooltip: { isHtml: true, trigger: 'focus' },
      hAxis: {
        textStyle: { fontSize: 10, color: '#94a3b8', fontName: 'Inter' },
        gridlines: { color: '#f1f5f9', count: -1 },
        minorGridlines: { count: 0 },
        format: "#'",
        slantedText: false,
      },
      vAxis: {
        textStyle: { fontSize: 10, color: '#94a3b8', fontName: 'Inter' },
        gridlines: { color: '#f1f5f9', count: 5 },
        minorGridlines: { count: 0 },
        viewWindow: { min: 0, max: 100 },
        ticks: [0, 25, 50, 75, 100],
        baselineColor: '#e5e7eb',
      },
      backgroundColor: 'transparent',
      width: container.clientWidth,
      height: 320,
      interpolateNulls: true,
    }

    const draw = () => {
      if (!chartInstance.current) {
        chartInstance.current = new window.google.visualization.AreaChart(container)
      }
      chartInstance.current.draw(dt, options)

      // HT referans cizgisi
      if (htIndex >= 0 && wrapperRef.current) {
        try {
          const layout = chartInstance.current.getChartLayoutInterface()
          const chartBounds = layout.getChartAreaBoundingBox()
          const htMinute = parseInt(String(data[htIndex].minute).replace(/[^0-9]/g, ''), 10)
          const hAxisLeft = layout.getHAxisValue(0)
          const hAxisRight = layout.getHAxisValue(maxMinute)
          const xRange = hAxisRight - hAxisLeft || 1
          const xPos = chartBounds.left + ((htMinute - hAxisLeft) / xRange) * chartBounds.width

          let lineEl = wrapperRef.current.querySelector('.ht-ref-line') as HTMLElement | null
          if (!lineEl) {
            lineEl = document.createElement('div')
            lineEl.className = 'ht-ref-line'
            wrapperRef.current.appendChild(lineEl)
          }
          lineEl.style.cssText = `
            position:absolute;top:${chartBounds.top}px;
            bottom:${chartBounds.top + chartBounds.height}px;
            left:${xPos}px;width:2px;
            background:repeating-linear-gradient(0deg,#16a34a80,#16a34a80 4px,transparent 4px,transparent 8px);
            pointer-events:none;z-index:5;
          `
          // HT label
          let labelEl = wrapperRef.current.querySelector('.ht-ref-label') as HTMLElement | null
          if (!labelEl) {
            labelEl = document.createElement('div')
            labelEl.className = 'ht-ref-label'
            wrapperRef.current.appendChild(labelEl)
          }
          labelEl.style.cssText = `
            position:absolute;top:${chartBounds.top - 2}px;
            left:${xPos + 4}px;
            font-size:9px;font-weight:700;color:#16a34a;
            pointer-events:none;z-index:5;
            font-family:Inter,sans-serif;
          `
          labelEl.textContent = 'HT'
        } catch {
        // Layout not ready yet
        }
      }
    }

    draw()

    const handleResize = () => {
      if (!chartRef.current) return
      options.width = chartRef.current.clientWidth
      draw()
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, data, homeTeam, awayTeam, htIndex, maxMinute])

  return (
    <CleanChartCard title="Momentum & Baski" homeTeam={homeTeam} awayTeam={awayTeam}>
      {/* ── Gauge Row ── */}
      <div className="px-2 pt-1 pb-0">
        <div className="flex items-center justify-center gap-4 mb-1">
          {/* Ev gauge */}
          <div className="flex flex-col items-center">
            <div ref={gaugeHomeRef} className="w-37.5 h-27.5" style={{ contain: 'layout paint style', willChange: 'transform' }} />
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
            <div ref={gaugeAwayRef} className="w-37.5 h-27.5" style={{ contain: 'layout paint style', willChange: 'transform' }} />
            <div className="flex items-center gap-1.5 -mt-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-[10px] font-semibold text-gray-700 truncate max-w-20">{awayTeam}</span>
            </div>
          </div>
        </div>

        {/* Baski seviyesi bar */}
        <div className="relative h-6 mx-8 mb-2">
          <div className="absolute inset-0 flex items-center">
            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden flex">
              <div
                className="h-full rounded-l-full transition-all duration-500"
                style={{
                  width: `${lastPoint.homePressure / (lastPoint.homePressure + lastPoint.awayPressure || 1) * 100}%`,
                  background: `linear-gradient(90deg, #f97316, #fb923c)`,
                }}
              />
              <div
                className="h-full rounded-r-full transition-all duration-500"
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

      {/* ── Area Chart ── */}
      <div ref={wrapperRef} className="relative h-80 w-full" style={{ contain: 'layout paint style' }}>
        <div ref={chartRef} className="h-full w-full" style={{ willChange: 'transform' }} />
      </div>
    </CleanChartCard>
  )
})
