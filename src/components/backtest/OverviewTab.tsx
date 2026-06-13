import type { BacktestResult } from '@/lib/backtestEngine'
import type { SignalAccuracyStats } from '@/lib/goalSignalTracker'
import { MetricCard } from './MetricCard'

export function OverviewTab({ bt, stats }: { bt: BacktestResult; stats: SignalAccuracyStats | null }) {
  const brierColor = bt.brierScore <= 0.15 ? 'text-emerald-600' : bt.brierScore <= 0.25 ? 'text-amber-600' : 'text-red-500'
  const goalRateColor = bt.precision >= 40 ? 'text-emerald-600' : bt.precision >= 25 ? 'text-amber-600' : 'text-red-500'

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard label="Toplam Sinyal" value={String(bt.signalCount)} color="text-gray-800" />
        <MetricCard label="Brier Score" value={bt.brierScore.toFixed(4)} color={brierColor} subtitle="Dusuk = Iyi" />
        <MetricCard label="Gol Orani" value={`${bt.precision}%`} color={goalRateColor} subtitle="Sinyal→Gol" />
        <MetricCard label="Erken Uyari" value={`${bt.earlyWarningValue}dk`} color="text-blue-600" subtitle="Ort. gol oncesi" />
      </div>

      <div className="grid grid-cols-4 gap-2">
        <MetricCard label="Dogruluk" value={`${bt.accuracy}%`} color="text-gray-700" />
        <MetricCard label="Kalibrasyon H." value={`${(bt.calibrationError * 100).toFixed(1)}%`} color={bt.calibrationError < 0.1 ? 'text-emerald-600' : 'text-amber-600'} />
        <MetricCard label="Log Loss" value={bt.logLoss.toFixed(4)} color="text-gray-700" subtitle="Dusuk = Iyi" />
        <MetricCard label="F1 Score" value={`${bt.f1Score}%`} color="text-indigo-600" />
      </div>

      <div className="bg-gray-50 rounded-lg p-3">
        <div className="text-[10px] font-bold text-gray-500 mb-1.5">Brier Skor Ayristirma</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-xs font-mono font-bold text-red-500">{bt.brierDecomposition.reliability.toFixed(4)}</div>
            <div className="text-[8px] text-gray-400">Guvenilirlik</div>
            <div className="text-[7px] text-gray-300">(Dusuk = Iyi)</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-mono font-bold text-emerald-500">{bt.brierDecomposition.resolution.toFixed(4)}</div>
            <div className="text-[8px] text-gray-400">Ayirma</div>
            <div className="text-[7px] text-gray-300">(Yuksek = Iyi)</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-mono font-bold text-gray-500">{bt.brierDecomposition.uncertainty.toFixed(4)}</div>
            <div className="text-[8px] text-gray-400">Belirsizlik</div>
            <div className="text-[7px] text-gray-300">(Sabit)</div>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-3">
        <div className="text-[10px] font-bold text-gray-500 mb-1.5">Taraf Tahmini Dogrulugu</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-xs font-mono font-bold text-gray-700">{bt.sideAccuracy.overall}%</div>
            <div className="text-[8px] text-gray-400">Genel</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-mono font-bold text-orange-500">{bt.sideAccuracy.homeOnly}%</div>
            <div className="text-[8px] text-gray-400">Ev Sahibi</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-mono font-bold text-blue-500">{bt.sideAccuracy.awayOnly}%</div>
            <div className="text-[8px] text-gray-400">Deplasman</div>
          </div>
        </div>
      </div>

      {bt.escalationPerformance.totalEscalations > 0 && (
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-[10px] font-bold text-gray-500 mb-1.5">Eskalasyon Analizi</div>
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center">
              <div className="text-xs font-mono font-bold text-gray-700">{bt.escalationPerformance.totalEscalations}</div>
              <div className="text-[8px] text-gray-400">Eskalasyon</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-mono font-bold text-amber-500">{bt.escalationPerformance.goalRateEscalated}%</div>
              <div className="text-[8px] text-gray-400">Esk. Gol Orani</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-mono font-bold text-gray-500">{bt.escalationPerformance.goalRateNonEscalated}%</div>
              <div className="text-[8px] text-gray-400">Normal Gol Orani</div>
            </div>
            <div className="text-center">
              <div className={`text-xs font-mono font-bold ${bt.escalationPerformance.escalationLift > 1 ? 'text-emerald-500' : 'text-red-500'}`}>
                {bt.escalationPerformance.escalationLift}x
              </div>
              <div className="text-[8px] text-gray-400">Lift</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
