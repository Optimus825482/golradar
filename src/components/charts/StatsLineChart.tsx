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
  const { loaded } = useGoogleCharts(['corechart'])

  useEffect(() => {
    if (!loaded || !chartRef.current || !data?.length) return

    const dt = new window.google.visualization.DataTable()
    dt.addColumn('number', 'Dakika')
    dt.addColumn('number', homeName)
    dt.addColumn('number', awayName)
    dt.addRows(data.map(d => {
      const min = typeof d.minute === 'number' ? d.minute : parseInt(String(d.minute).replace(/[^0-9]/g, ''), 10)
      return [min, d[homeKey] ?? 0, d[awayKey] ?? 0]
    }))

    const options = {
      title,
      titleTextStyle: { fontSize: 12, bold: true, color: '#374151' },
      legend: { position: 'none' },
      colors: ['#f97316', '#3b82f6'],
      areaOpacity: 0.08,
      lineWidth: 2.5,
      pointSize: 0,
      curveType: 'monotone',
      chartArea: { left: 55, right: 20, top: 15, bottom: 40 },
      hAxis: {
        textStyle: { fontSize: 10, color: '#9ca3af' },
        gridlines: { color: '#f1f5f9' },
        minorGridlines: { count: 0 },
        format: "#'",
      },
      vAxis: yDomain
        ? {
          textStyle: { fontSize: 10, color: '#9ca3af' },
          gridlines: { color: '#f1f5f9' },
          minorGridlines: { count: 0 },
          viewWindow: { min: yDomain[0], max: yDomain[1] },
          format: yFormatter ? '#.#' : undefined,
        }
        : {
          textStyle: { fontSize: 10, color: '#9ca3af' },
          gridlines: { color: '#f1f5f9' },
          minorGridlines: { count: 0 },
        },
      backgroundColor: 'transparent',
      tooltip: { trigger: 'focus' },
      focusTarget: 'category',
    }

    if (!chartInstance.current) {
      chartInstance.current = new window.google.visualization.AreaChart(chartRef.current)
    }
    chartInstance.current.draw(dt, options)

    const handleResize = () => chartInstance.current.draw(dt, options)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [loaded, data, homeKey, awayKey, homeName, awayName, yDomain, title])

  return (
    <CleanChartCard title={title} homeTeam={homeTeam} awayTeam={awayTeam}>
      <div ref={chartRef} className="h-70 w-full" />
    </CleanChartCard>
  )
}
