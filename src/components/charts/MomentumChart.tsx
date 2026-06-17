'use client'

import { useEffect, useRef, useMemo } from 'react'
import { useGoogleCharts } from '@/lib/useGoogleCharts'
import { CleanChartCard } from './CleanChartCard'

export function MomentumChart({ data, homeTeam, awayTeam }: {
  data: { minute: string; homePressure: number; awayPressure: number }[]
  homeTeam: string
  awayTeam: string
}) {
  const chartRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<any>(null)
  const { loaded } = useGoogleCharts(['corechart'])

  const htIndex = useMemo(() => {
    return data.findIndex(d => {
      const minStr = d.minute.replace(/[+'']/g, '')
      const min = parseInt(minStr, 10)
      return min >= 44 && min <= 46
    })
  }, [data])

  const maxMinute = useMemo(() => {
    const mins = data.map(d => parseInt(String(d.minute).replace(/[^0-9]/g, ''), 10))
    return Math.max(...mins, 90)
  }, [data])

  useEffect(() => {
    if (!loaded || !chartRef.current || !data?.length) return

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
      vAxis: {
        textStyle: { fontSize: 10, color: '#9ca3af' },
        gridlines: { color: '#f1f5f9' },
        minorGridlines: { count: 0 },
        viewWindow: { min: 0, max: 100 },
        ticks: [0, 25, 50, 75, 100],
      },
      backgroundColor: 'transparent',
      tooltip: { trigger: 'focus' },
      focusTarget: 'category',
    }

    const draw = () => {
      if (!chartInstance.current) {
        chartInstance.current = new window.google.visualization.AreaChart(chartRef.current!)
      }
      chartInstance.current.draw(dt, options)

      // Position HT reference line using chart layout interface
      if (htIndex >= 0 && wrapperRef.current) {
        const layout = chartInstance.current.getChartLayoutInterface()
        const chartBounds = layout.getChartAreaBoundingBox()
        const htMinute = parseInt(String(data[htIndex].minute).replace(/[^0-9]/g, ''), 10)
        const hAxisLeft = layout.getHAxisValue(0)
        const hAxisRight = layout.getHAxisValue(maxMinute)
        // Normalize: find pixel position of htMinute
        const xRange = hAxisRight - hAxisLeft || 1
        const xPos = chartBounds.left + ((htMinute - hAxisLeft) / xRange) * chartBounds.width

        let lineEl = wrapperRef.current.querySelector('.ht-ref-line') as HTMLElement | null
        if (!lineEl) {
          lineEl = document.createElement('div')
          lineEl.className = 'ht-ref-line'
          lineEl.style.cssText = 'position:absolute;top:0;bottom:0;width:1px;background:rgba(22,163,74,0.5);pointer-events:none'
          wrapperRef.current.appendChild(lineEl)
        }
        lineEl.style.left = `${xPos}px`
      }
    }

    draw()

    const handleResize = () => draw()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, data, homeTeam, awayTeam, htIndex, maxMinute])

  return (
    <CleanChartCard title="Momentum" homeTeam={homeTeam} awayTeam={awayTeam}>
      <div ref={wrapperRef} className="relative h-80 w-full">
        <div ref={chartRef} className="h-full w-full" />
      </div>
    </CleanChartCard>
  )
}
