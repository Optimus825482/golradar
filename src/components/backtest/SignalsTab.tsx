import { useState } from 'react'
import type { GoalSignalRecord, SignalAccuracyStats } from '@/lib/goalSignalTracker'

export function SignalsTab({ signals, stats }: { signals: GoalSignalRecord[]; stats: SignalAccuracyStats | null }) {
  const [filter, setFilter] = useState<'all' | 'goal' | 'nogoal' | 'pending'>('all')
  const [searchTeam, setSearchTeam] = useState('')

  const filtered = signals.filter(s => {
    if (filter === 'goal' && !s.goalHappened) return false
    if (filter === 'nogoal' && s.goalHappened !== false) return false
    if (filter === 'pending' && s.goalHappened !== null) return false
    if (searchTeam) {
      const q = searchTeam.toLowerCase()
      if (!s.homeTeam.toLowerCase().includes(q) && !s.awayTeam.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          placeholder="Takim ara..."
          value={searchTeam}
          onChange={(e) => setSearchTeam(e.target.value)}
          className="text-[10px] border border-gray-200 rounded px-2 py-1 bg-white w-32"
        />
        {(['all', 'goal', 'nogoal', 'pending'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[9px] px-2 py-0.5 rounded font-medium transition-colors ${
              filter === f
                ? f === 'goal' ? 'bg-emerald-500 text-white'
                  : f === 'nogoal' ? 'bg-gray-500 text-white'
                  : f === 'pending' ? 'bg-amber-500 text-white'
                  : 'bg-indigo-500 text-white'
                : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            {f === 'all' ? `Tumu (${signals.length})`
              : f === 'goal' ? `Gol (${signals.filter(s => s.goalHappened).length})`
              : f === 'nogoal' ? `Gol Yok (${signals.filter(s => s.goalHappened === false).length})`
              : `Bekliyor (${signals.filter(s => s.goalHappened === null).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-6">
          {signals.length === 0 ? 'Sinyal kaydi bulunmuyor. Tarihsel simulasyon calistirmayi veya canli mac izlemeyi deneyin.' : 'Filtreye uygun sinyal yok.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[9px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 font-bold">
                <th className="px-2 py-1.5 text-left">Mac</th>
                <th className="px-2 py-1.5 text-center">Dakika</th>
                <th className="px-2 py-1.5 text-center">Taraf</th>
                <th className="px-2 py-1.5 text-center">Ihtimal</th>
                <th className="px-2 py-1.5 text-center">Seviye</th>
                <th className="px-2 py-1.5 text-center">Gol?</th>
                <th className="px-2 py-1.5 text-center">Gol DK</th>
                <th className="px-2 py-1.5 text-center">Sonuc</th>
                <th className="px-2 py-1.5 text-center">Faktorler</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map((s, i) => {
                const sigMin = s.signalMinute ?? (s as any).signal1Minute ?? 0
                const sigScore = s.signalScore ?? (s as any).signal1Score ?? 0
                const sigSide = s.signalSide ?? (s as any).signal1Side ?? 'home'
                const sideLabel = sigSide === 'home' ? s.homeTeam : s.awayTeam
                const levelColors: Record<string, string> = {
                  low: 'bg-gray-100 text-gray-500',
                  medium: 'bg-amber-100 text-amber-600',
                  high: 'bg-orange-100 text-orange-600',
                  critical: 'bg-red-100 text-red-600',
                }
                return (
                  <tr key={`${s.matchCode}-${sigMin}-${i}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-2 py-1.5">
                      <div className="text-[9px] text-gray-700 font-medium">{s.homeTeam} vs {s.awayTeam}</div>
                      <div className="text-[8px] text-gray-400">{s.league} · {s.date}</div>
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono font-bold text-gray-700">{sigMin}&apos;</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`font-bold ${sigSide === 'home' ? 'text-orange-600' : 'text-blue-600'}`}>
                        {sideLabel.substring(0, 8)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono font-bold text-indigo-500">%{sigScore}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${levelColors[s.signalLevel] || 'bg-gray-100 text-gray-500'}`}>
                        {s.signalLevel}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {s.goalHappened === null ? (
                        <span className="text-amber-500 animate-pulse">⏳</span>
                      ) : s.goalHappened ? (
                        <span className="text-emerald-500 font-bold">✓</span>
                      ) : (
                        <span className="text-gray-400">✗</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono text-gray-600">
                      {s.goalMinute != null ? `${s.goalMinute}'` : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {s.correctPrediction === true ? (
                        <span className="bg-emerald-50 text-emerald-600 px-1 py-0.5 rounded font-bold">DOGRU</span>
                      ) : s.correctPrediction === false ? (
                        <span className="bg-red-50 text-red-500 px-1 py-0.5 rounded font-bold">YANLIS</span>
                      ) : s.goalHappened === false ? (
                        <span className="bg-gray-50 text-gray-400 px-1 py-0.5 rounded">FP</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                      {s.minutesAfterSignal != null && (
                        <div className="text-[7px] text-gray-400">{s.minutesAfterSignal}dk sonra</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-0.5 max-w-[120px]">
                        {(s.activeFactors || []).slice(0, 3).map((f, fi) => (
                          <span key={fi} className="bg-indigo-50 text-indigo-500 text-[7px] px-1 py-0.5 rounded">{f.substring(0, 8)}</span>
                        ))}
                        {(s.activeFactors || []).length > 3 && (
                          <span className="text-[7px] text-gray-400">+{(s.activeFactors || []).length - 3}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length > 50 && (
            <div className="text-[9px] text-gray-400 text-center py-2">
              Ilk 50 gosteriliyor (toplam {filtered.length})
            </div>
          )}
        </div>
      )}
    </div>
  )
}
