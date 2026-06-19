'use client'

import { useEffect, useRef, memo } from 'react'
import { useGoogleCharts } from '@/lib/useGoogleCharts'
import { CleanChartCard } from './CleanChartCard'

interface StatsLineChartProps {
  data: { minute: string | number; [key: string]: unknown }[]
  homeKey: string
  awayKey: string
  homeName: string
  awayName: string
  yDomain?: [number, number]
  homeTeam: string
  awayTeam: string
  title: string
}

export const StatsLineChart = memo(function StatsLineChart({
  data, homeKey, awayKey, homeName, awayName, yDomain, homeTeam, awayTeam, title
}: StatsLineChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<any>(null)
  const resizeHandlerRef = useRef<(() => void) | null>(null)
  const lastDataKey = useRef('')
  const { loaded } = useGoogleCharts(['corechart'])

  const TEAM_COLORS = { home: '#f97316', away: '#3b82f6' }

  useEffect(() => {
    if (!loaded || !chartRef.current || !data?.length) return

    const currentKey = data.length > 0
      ? `${data.length}_${JSON.stringify(data[data.length - 1])}`
      : `${data.length}`
    if (currentKey === lastDataKey.current && chartInstance.current) return
    lastDataKey.current = currentKey

    const container = chartRef.current
    const dt = new window.google.visualization.DataTable()
    dt.addColumn('number', 'Dakika')
    dt.addColumn('number', homeName)
    dt.addColumn('number', awayName)
    dt.addRows(data.map(d => {
      const raw = d.minute ?? ''
      const min = typeof d.minute === 'number' ? d.minute : parseInt(String(raw).replace(/[^0-9]/g, ''), 10)
      return [isNaN(min) ? 0 : min, d[homeKey] ?? 0, d[awayKey] ?? 0]
    }))

    const vAxisOpts: Record<string, unknown> = {
      textStyle: { fontSize: 10, color: '#94a3b8', fontName: 'Inter' },
      gridlines: { color: '#f1f5f9', count: 5 },
      minorGridlines: { count: 0 },
      baselineColor: '#e5e7eb',
      ...(yDomain ? { viewWindow: { min: yDomain[0], max: yDomain[1] } } : {}),
    }

    const options: Record<string, unknown> = {
      title,
      titleTextStyle: { fontSize: 13, bold: true, color: '#1e293b', fontName: 'Inter' },
      legend: {
        position: 'bottom',
        textStyle: { fontSize: 11, color: '#64748b', fontName: 'Inter' },
        alignment: 'center',
      },
      colors: [TEAM_COLORS.home, TEAM_COLORS.away],
      lineWidth: 3,
      pointSize: 3,
      pointShape: 'circle',
      pointsVisible: true,
      curveType: 'function',
      chartArea: { left: 52, right: 24, top: 24, bottom: 48 },
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
      vAxis: vAxisOpts,
      backgroundColor: 'transparent',
      width: container.clientWidth,
      height: 280,
      interpolateNulls: true,
    }

    if (!chartInstance.current) {
      chartInstance.current = new window.google.visualization.LineChart(container)
    }
    chartInstance.current.draw(dt, options)

    // Single stable resize handler (remove old one before adding new)
    if (resizeHandlerRef.current) {
      window.removeEventListener('resize', resizeHandlerRef.current)
    }
    const handleResize = () => {
      if (!chartInstance.current || !chartRef.current) return
      options.width = chartRef.current.clientWidth
      chartInstance.current.draw(dt, options)
    }
    resizeHandlerRef.current = handleResize
    window.addEventListener('resize', handleResize)

    return () => {
      if (resizeHandlerRef.current) {
        window.removeEventListener('resize', resizeHandlerRef.current)
        resizeHandlerRef.current = null
      }
    }
  }, [loaded, data, homeKey, awayKey, homeName, awayName, yDomain, title, TEAM_COLORS.home, TEAM_COLORS.away])

  return (
    <CleanChartCard title={title} homeTeam={homeTeam} awayTeam={awayTeam} homeColor={TEAM_COLORS.home} awayColor={TEAM_COLORS.away}>
      <div ref={chartRef} className="h-70 w-full" style={{ willChange: 'transform', transform: 'translateZ(0)' }} />
    </CleanChartCard>
  )
})
