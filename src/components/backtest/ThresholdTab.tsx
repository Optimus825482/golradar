import type { BacktestResult } from '@/lib/backtestEngine'

export function ThresholdTab({ bt }: { bt: BacktestResult }) {
  return (
    <div className="space-y-3">
      <div className="text-[10px] text-gray-400 mb-1">Farkli esik degerlerinde model performansi</div>

      <div className="grid grid-cols-7 gap-1 text-[8px] font-bold text-gray-500 bg-gray-50 rounded p-1.5">
        <span>Esik</span>
        <span className="text-center">Sinyal</span>
        <span className="text-center">Gol</span>
        <span className="text-center">Prec.</span>
        <span className="text-center">Dogru Taraf</span>
        <span className="text-center">FP Orani</span>
        <span className="text-center">F1</span>
      </div>

      {bt.thresholdAnalysis.map(ta => (
        <div key={ta.threshold} className="grid grid-cols-7 gap-1 text-[9px] py-1 border-b border-gray-50">
          <span className="font-mono font-bold text-indigo-600">%{ta.threshold}</span>
          <span className="text-center text-gray-700">{ta.signalCount}</span>
          <span className="text-center text-gray-700">{ta.goalCount}</span>
          <span className={`text-center font-bold ${ta.precision >= 40 ? 'text-emerald-600' : ta.precision >= 25 ? 'text-amber-600' : 'text-red-500'}`}>
            {ta.precision}%
          </span>
          <span className="text-center text-gray-600">{ta.correctSideRate}%</span>
          <span className="text-center text-gray-500">{ta.falsePositiveRate}%</span>
          <span className="text-center font-bold text-indigo-500">{ta.f1Score}%</span>
        </div>
      ))}

      {bt.thresholdAnalysis.length > 0 && (() => {
        const best = bt.thresholdAnalysis.reduce((a, b) => a.f1Score > b.f1Score ? a : b)
        return (
          <div className="bg-indigo-50 rounded-lg p-2 border border-indigo-100">
            <div className="text-[9px] text-indigo-700 font-bold">
              Onerilen esik: %{best.threshold} (F1: {best.f1Score}%, Prec: {best.precision}%, {best.goalCount} gol)
            </div>
          </div>
        )
      })()}
    </div>
  )
}
