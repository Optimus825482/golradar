'use client'

import { useEffect, useRef } from 'react'
import { useGoogleCharts } from '@/lib/useGoogleCharts'
import { CleanChartCard } from './CleanChartCard'

export function StatsLineChart({ data, homeKey, awayKey, homeName, awayName, yDomain, yFormatter, homeTeam, awayTeam, title }: {
  data: any[]
  homeKey: string
  awayKey: string
  homeName: string
  awayName: string
  yDomain?: [number, number]
  yFormatter?: (v: number) => string
  homeTeam: string
  awayTeam: string
  title: string
}) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<any>(null)
  const { loaded } = useGoogleCharts(['corechart', 'gauge'])

  useEffect(() => {
    if (!loaded || !chartRef.current || !data?.length) return

    const container = chartRef.current
    const dt = new window.google.visualization.DataTable()
    dt.addColumn('number', 'Dakika')
    dt.addColumn('number', homeName)
    dt.addColumn('number', awayName)
    dt.addRows(data.map(d => {
      const min = typeof d.minute === 'number' ? d.minute : parseInt(String(d.minute).replace(/[^0-9]/g, ''), 10)
      return [min, d[homeKey] ?? 0, d[awayKey] ?? 0]
    }))

    const vOpts = yDomain ? {
      textStyle: { fontSize: 10, color: '#94a3b8', fontName: 'Inter' },
      gridlines: { color: '#f1f5f9', count: 5 },
      minorGridlines: { count: 0 },
      viewWindow: { min: yDomain[0], max: yDomain[1] },
      baselineColor: '#e5e7eb',
    } : {
      textStyle: { fontSize: 10, color: '#94a3b8', fontName: 'Inter' },
      gridlines: { color: '#f1f5f9', count: 5 },
      minorGridlines: { count: 0 },
      baselineColor: '#e5e7eb',
    }

    const options = {
      title,
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
      vAxis: vOpts,
      backgroundColor: 'transparent',
      width: container.clientWidth,
      height: 280,
      interpolateNulls: true,
    }

    if (!chartInstance.current) {
      chartInstance.current = new window.google.visualization.AreaChart(container)
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
    <CleanChartCard title={title} homeTeam={homeTeam} awayTeam={awayTeam}>
      <div ref={chartRef} className="h-70 w-full" />
    </CleanChartCard>
  )
}
