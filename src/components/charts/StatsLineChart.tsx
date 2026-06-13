'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { CleanChartCard } from './CleanChartCard'
import { LightTooltip } from './LightTooltip'

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
  const gradId = `${homeKey}_${awayKey}`.replace(/[^a-zA-Z0-9]/g, '')
  return (
    <CleanChartCard title={title} homeTeam={homeTeam} awayTeam={awayTeam}>
      <div className="h-[280px] w-full min-h-[280px]">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ top: 10, right: 20, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id={`hGrad_${gradId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`aGrad_${gradId}`} x1="0" y1="0" x2="0" y2="1">
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
              domain={yDomain || ['auto', 'auto']}
              stroke="#d1d5db"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              tickFormatter={yFormatter || ((v: number) => `${v}`)}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<LightTooltip />} />
            <Area
              type="monotone"
              dataKey={homeKey}
              name={homeName}
              stroke="#f97316"
              fill={`url(#hGrad_${gradId})`}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: '#f97316', stroke: '#fff', strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey={awayKey}
              name={awayName}
              stroke="#3b82f6"
              fill={`url(#aGrad_${gradId})`}
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
