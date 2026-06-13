'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { CleanChartCard } from './CleanChartCard'
import { LightTooltip } from './LightTooltip'

export function MomentumChart({ data, homeTeam, awayTeam }: {
  data: { minute: string; homePressure: number; awayPressure: number }[]
  homeTeam: string
  awayTeam: string
}) {
  const htIndex = data.findIndex(d => {
    const minStr = d.minute.replace(/[+'']/g, '')
    const min = parseInt(minStr, 10)
    return min >= 44 && min <= 46
  })

  return (
    <CleanChartCard title="Momentum" homeTeam={homeTeam} awayTeam={awayTeam}>
      <div className="h-[320px] w-full min-h-[320px]">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data} margin={{ top: 10, right: 20, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id="momHomeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="momAwayGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="minute"
              stroke="#d1d5db"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              stroke="#d1d5db"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              tickFormatter={(v: number) => `${v}`}
              ticks={[0, 25, 50, 75, 100]}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<LightTooltip />} />
            {htIndex >= 0 && (
              <ReferenceLine
                x={data[htIndex].minute}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="4 4"
                label={{ value: 'HT', position: 'top', fill: '#64748b', fontSize: 10 }}
              />
            )}
            <ReferenceLine y={50} stroke="#e5e7eb" strokeWidth={1} strokeDasharray="2 2" />
            <Area
              type="monotone"
              dataKey="homePressure"
              name={`${homeTeam}`}
              stroke="#f97316"
              fill="url(#momHomeGrad)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: '#f97316', stroke: '#fff', strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="awayPressure"
              name={`${awayTeam}`}
              stroke="#3b82f6"
              fill="url(#momAwayGrad)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </CleanChartCard>
  )
}
