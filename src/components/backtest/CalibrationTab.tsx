import type { BacktestResult } from '@/lib/backtestEngine'
import { MetricCard } from './MetricCard'

export function CalibrationTab({ bt }: { bt: BacktestResult }) {
  if (bt.calibrationCurve.length === 0) {
    return <div className="text-xs text-gray-400">Kalibrasyon verisi yetersiz</div>
  }

  const maxP = Math.max(...bt.calibrationCurve.map(c => Math.max(c.predictedP, c.observedP)), 0.5)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <MetricCard label="ECE" value={`${(bt.calibrationError * 100).toFixed(1)}%`} color={bt.calibrationError < 0.1 ? 'text-emerald-600' : 'text-amber-600'} subtitle="Beklenen Kal. Hata" />
        <MetricCard label="Ort. Tahmin" value={`${(bt.calibrationCurve.length > 0 ? (bt.calibrationCurve.reduce((s, c) => s + c.predictedP * c.count, 0) / bt.calibrationCurve.reduce((s, c) => s + c.count, 0)) * 100 : 0).toFixed(1)}%`} color="text-gray-700" />
        <MetricCard label="Ort. Gozlem" value={`${(bt.calibrationCurve.length > 0 ? (bt.calibrationCurve.reduce((s, c) => s + c.observedP * c.count, 0) / bt.calibrationCurve.reduce((s, c) => s + c.count, 0)) * 100 : 0).toFixed(1)}%`} color="text-gray-700" />
      </div>

      <div className="text-[10px] text-gray-400 mb-1">
        {bt.overconfidence > 0
          ? `⚠ Model asiri guvenli (${bt.overconfidence}% fazla tahmin ediyor)`
          : bt.overconfidence < 0
            ? `Model yetersiz guvenli (${Math.abs(bt.overconfidence)}% az tahmin ediyor)`
            : '✓ Model iyi kalibre edilmis'
        }
      </div>

      <div className="bg-gray-50 rounded-lg p-3">
        <div className="text-[10px] font-bold text-gray-500 mb-2">Kalibrasyon Egrisi</div>
        <div className="space-y-1.5">
          {bt.calibrationCurve.map((cp, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="w-16 text-[8px] text-gray-400 text-right font-mono">
                {(cp.predictedP * 100).toFixed(0)}%
              </div>
              <div className="flex-1">
                <div className="relative h-4 bg-gray-100 rounded overflow-hidden" style={{ minWidth: 60 }}>
                  <div
                    className="absolute top-0 left-0 h-full bg-indigo-200 rounded-l"
                    style={{ width: `${(cp.predictedP / maxP) * 100}%` }}
                  />
                  <div
                    className="absolute top-0 left-0 h-2 bg-emerald-500 rounded-l"
                    style={{ width: `${(cp.observedP / maxP) * 100}%` }}
                  />
                  <div
                    className="absolute top-0 h-full w-0.5 bg-red-400"
                    style={{ left: `${(cp.predictedP / maxP) * 100}%` }}
                  />
                </div>
              </div>
              <div className="w-20 text-[8px]">
                <span className="text-emerald-600 font-mono font-bold">{(cp.observedP * 100).toFixed(0)}%</span>
                <span className="text-gray-300 mx-0.5">/</span>
                <span className="text-gray-400 font-mono">{cp.count}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-2 text-[8px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-indigo-200 rounded" /> Tahmin</span>
          <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-emerald-500 rounded" /> Gercek</span>
          <span className="flex items-center gap-1"><span className="w-0.5 h-3 bg-red-400" /> Mukemmel</span>
        </div>
      </div>
    </div>
  )
}
