import type { BacktestResult } from '@/lib/backtestEngine'
import { MetricCard, PercentileBox } from './MetricCard'

export function TimeTab({ bt }: { bt: BacktestResult }) {
  return (
    <div className="space-y-3">
      <div className="bg-gray-50 rounded-lg p-3">
        <div className="text-[10px] font-bold text-gray-500 mb-2">Sinyal→Gol Sure Dagilimi</div>

        {bt.timeDistribution.histogram.length > 0 && (
          <div>
            {bt.timeDistribution.histogram.map(h => (
              <div key={h.range} className="flex items-center gap-2 mb-1">
                <span className="w-12 text-[8px] text-gray-400 text-right">{h.range}</span>
                <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-400 rounded-full"
                    style={{ width: `${(h.count / Math.max(...bt.timeDistribution.histogram.map(x => x.count))) * 100}%` }}
                  />
                </div>
                <span className="w-12 text-[8px] text-gray-500 font-mono">{h.count} ({h.goalRate}%)</span>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-5 gap-1 mt-2 pt-2 border-t border-gray-200">
          <PercentileBox label="P10" value={`${bt.timeDistribution.percentiles.p10}dk`} />
          <PercentileBox label="P25" value={`${bt.timeDistribution.percentiles.p25}dk`} />
          <PercentileBox label="P50" value={`${bt.timeDistribution.percentiles.p50}dk`} />
          <PercentileBox label="P75" value={`${bt.timeDistribution.percentiles.p75}dk`} />
          <PercentileBox label="P90" value={`${bt.timeDistribution.percentiles.p90}dk`} />
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-3">
        <div className="text-[10px] font-bold text-gray-500 mb-2">Dakika Araligina Gore Sinyal Performansi</div>
        {bt.signalDecayByMinute.map(sd => (
          <div key={sd.minuteRange} className="flex items-center gap-2 mb-1">
            <span className="w-12 text-[8px] text-gray-400 text-right">{sd.minuteRange}&apos;</span>
            <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-400 rounded-full"
                style={{ width: `${sd.goalRate}%` }}
              />
            </div>
            <span className="w-20 text-[8px] text-gray-500">
              {sd.signalCount} sinyal · {sd.goalRate}% gol
            </span>
          </div>
        ))}
      </div>

      {bt.dailyPerformance.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-[10px] font-bold text-gray-500 mb-2">Gunluk Performans</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {bt.dailyPerformance.slice(0, 10).map(dp => (
              <div key={dp.date} className="flex items-center justify-between text-[8px]">
                <span className="text-gray-500 font-mono">{dp.date}</span>
                <div className="flex items-center gap-3">
                  <span>{dp.totalSignals} sinyal</span>
                  <span className={dp.goalRate >= 30 ? 'text-emerald-600' : 'text-amber-500'}>
                    {dp.goalRate}% gol
                  </span>
                  <span>{dp.correctSideRate}% dogru</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
