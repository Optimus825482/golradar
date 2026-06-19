'use client'

import { useEffect, useRef, memo } from 'react'
import { useGoogleCharts } from '@/lib/useGoogleCharts'
import { CleanChartCard } from './CleanChartCard'

export const StatsLineChart = memo(function StatsLineChart({ data, homeKey, awayKey, homeName, awayName, yDomain, homeTeam, awayTeam, title }: {
  data: { minute: string | number; [key: string]: unknown }[]
  homeKey: string
  awayKey: string
  homeName: string
  awayName: string
  yDomain?: [number, number]
  homeTeam: string
  awayTeam: string
  title: string
}) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<any>(null)
  const lastDataKey = useRef('')
  const { loaded } = useGoogleCharts(['corechart'])

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
      const min = typeof d.minute === 'number' ? d.minute : parseInt(String(d.minute ?? '').replace(/[^0-9]/g, ''), 10)
      return [isNaN(min) ? 0 : min, d[homeKey] ?? 0, d[awayKey] ?? 0]
    }))

    const vAxisOpts: Record<string, unknown> = yDomain
      ? {
        textStyle: { fontSize: 10, color: '#94a3b8', fontName: 'Inter' },
        gridlines: { color: '#f1f5f9', count: 5 },
        minorGridlines: { count: 0 },
        viewWindow: { min: yDomain[0], max: yDomain[1] },
        baselineColor: '#e5e7eb',
      }
      : {
        textStyle: { fontSize: 10, color: '#94a3b8', fontName: 'Inter' },
        gridlines: { color: '#f1f5f9', count: 5 },
        minorGridlines: { count: 0 },
        baselineColor: '#e5e7eb',
      }

    const options: Record<string, unknown> = {
      title,
      titleTextStyle: { fontSize: 13, bold: true, color: '#1e293b', fontName: 'Inter' },
      legend: {
        position: 'bottom',
        textStyle: { fontSize: 11, color: '#64748b', fontName: 'Inter' },
        alignment: 'center',
      },
      colors: ['#f97316', '#3b82f6'],
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

    const handleResize = () => {
      if (!chartInstance.current || !chartRef.current) return
      options.width = chartRef.current.clientWidth
      chartInstance.current.draw(dt, options)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [loaded, data, homeKey, awayKey, homeName, awayName, yDomain, title])

  return (
    <CleanChartCard title={title} homeTeam={homeTeam} awayTeam={awayTeam} homeColor="#f97316" awayColor="#3b82f6">
      <div ref={chartRef} className="h-70 w-full" style={{ contain: 'layout paint style', willChange: 'transform', transform: 'translateZ(0)' }} />
    </CleanChartCard>
  )
})
