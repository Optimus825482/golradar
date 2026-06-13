import type { BacktestResult } from '@/lib/backtestEngine'

export function BucketsTab({ bt }: { bt: BacktestResult }) {
  return (
    <div className="space-y-3">
      <div className="text-[10px] text-gray-400 mb-1">Ihtimal araliklarina gore sinyal kalitesi</div>

      {bt.buckets.filter(b => b.total > 0).map(b => (
        <div key={b.range} className="bg-gray-50 rounded-lg p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-gray-700">{b.range}</span>
            <span className={`text-[10px] font-bold ${b.goalRate >= 40 ? 'text-emerald-600' : b.goalRate >= 20 ? 'text-amber-600' : 'text-red-500'}`}>
              {b.goalRate}% gol orani
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1 text-[8px]">
            <div><span className="text-gray-400">Sinyal:</span> <span className="font-mono font-bold">{b.total}</span></div>
            <div><span className="text-gray-400">Gol:</span> <span className="font-mono font-bold">{b.goals}</span></div>
            <div><span className="text-gray-400">Dogru taraf:</span> <span className="font-mono font-bold">{b.correctSideRate}%</span></div>
            <div><span className="text-gray-400">Ort. sure:</span> <span className="font-mono font-bold">{b.avgMinutesToGoal}dk</span></div>
          </div>
          <div className="mt-1.5 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${b.goalRate >= 40 ? 'bg-emerald-500' : b.goalRate >= 20 ? 'bg-amber-400' : 'bg-red-400'}`}
              style={{ width: `${Math.min(100, b.goalRate)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
