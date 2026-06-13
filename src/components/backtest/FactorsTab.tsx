import type { BacktestResult } from '@/lib/backtestEngine'

export function FactorsTab({ bt }: { bt: BacktestResult }) {
  if (bt.factorImportance.length === 0) {
    return <div className="text-xs text-gray-400">Faktor verisi yetersiz</div>
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-gray-400 mb-1">Sinyal faktorlerinin gol uzerindeki etkisi (Lift &gt; 1 = pozitif etki)</div>

      <div className="grid grid-cols-6 gap-1 text-[8px] font-bold text-gray-500 bg-gray-50 rounded p-1.5">
        <span>Faktor</span>
        <span className="text-center">Gorulme</span>
        <span className="text-center">Varken Gol</span>
        <span className="text-center">Yokken Gol</span>
        <span className="text-center">Lift</span>
        <span className="text-center">Etki</span>
      </div>

      {bt.factorImportance.map(fi => (
        <div key={fi.factor} className="grid grid-cols-6 gap-1 text-[8px] py-1 border-b border-gray-50">
          <span className="text-gray-700 truncate" title={fi.factor}>{fi.factor}</span>
          <span className="text-center text-gray-500">{fi.occurrenceRate}%</span>
          <span className="text-center text-gray-600 font-mono">{fi.goalRateWhenPresent}%</span>
          <span className="text-center text-gray-400 font-mono">{fi.goalRateWhenAbsent}%</span>
          <span className={`text-center font-mono font-bold ${fi.lift > 1.2 ? 'text-emerald-600' : fi.lift < 0.8 ? 'text-red-500' : 'text-gray-500'}`}>
            {fi.lift}x
          </span>
          <span className="text-center">
            {fi.lift > 1.2 ? '↑' : fi.lift < 0.8 ? '↓' : '→'}
          </span>
        </div>
      ))}
    </div>
  )
}
