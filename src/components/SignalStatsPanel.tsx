'use client'

import { useEffect, useState } from 'react'
import type { SignalAccuracyStats, GoalSignalRecord } from '@/lib/goalSignalTracker'

// ── Enhanced Signal Stats Panel ─────────────────────────────────
// Displays detailed goal signal accuracy statistics.
// Now shows: probability buckets, level distribution, minute ranges,
// Brier score, side accuracy, and escalation analysis.

export default function SignalStatsPanel() {
  const [stats, setStats] = useState<SignalAccuracyStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const resp = await fetch('/api/goal-signals?action=stats&days=30')
        if (resp.ok) {
          const data = await resp.json()
          setStats(data)
        }
      } catch (err) {
        console.error('Signal stats fetch error:', err)
      }
      setLoading(false)
    }
    fetchStats()
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="mt-4 mx-3 p-4 bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl border border-gray-200 shadow-sm">
        <div className="animate-pulse h-4 bg-gray-200 rounded w-40 mb-3" />
        <div className="animate-pulse h-20 bg-gray-100 rounded" />
      </div>
    )
  }

  if (!stats || stats.totalSignals === 0) {
    return (
      <div className="mt-4 mx-3 p-4 bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl border border-gray-200 shadow-sm">
        <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1.5">
          <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Gol Sinyal İstatistikleri
        </h3>
        <p className="text-xs text-gray-400">Henüz sinyal kaydı yok. Canlı maçlarda %55+ gol ihtimali tespit edildiğinde kayıt başlayacak.</p>
      </div>
    )
  }

  const accuracyColor = stats.accuracyRate >= 70 ? 'text-emerald-600' : stats.accuracyRate >= 50 ? 'text-amber-600' : 'text-red-500'
  const goalRateColor = stats.goalAfterSignalRate >= 40 ? 'text-emerald-600' : stats.goalAfterSignalRate >= 25 ? 'text-amber-600' : 'text-red-500'

  return (
    <div className="mt-4 mx-3 bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
          <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Gol Sinyal İstatistikleri
          <span className="text-[9px] text-gray-400 font-normal ml-1">(Son 30 gün)</span>
        </h3>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[9px] text-indigo-500 hover:text-indigo-700 font-medium"
        >
          {expanded ? 'Daralt' : 'Detay'}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-5 gap-2 px-4 py-3">
        <div className="text-center">
          <div className="text-lg font-black text-gray-800">{stats.totalSignals}</div>
          <div className="text-[9px] text-gray-400 font-medium">Toplam Sinyal</div>
        </div>
        <div className="text-center">
          <div className={`text-lg font-black ${accuracyColor}`}>{stats.accuracyRate}%</div>
          <div className="text-[9px] text-gray-400 font-medium">Doğruluk</div>
        </div>
        <div className="text-center">
          <div className={`text-lg font-black ${goalRateColor}`}>{stats.goalAfterSignalRate}%</div>
          <div className="text-[9px] text-gray-400 font-medium">Gol Oranı</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-black text-blue-600">{stats.avgMinutesAfterSignal || '-'}dk</div>
          <div className="text-[9px] text-gray-400 font-medium">Ort. Süre</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-black text-gray-600">{stats.brierScore?.toFixed(3) || '-'}</div>
          <div className="text-[9px] text-gray-400 font-medium">Brier Skor</div>
        </div>
      </div>

      {/* Detail bar: correct vs incorrect vs FP */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] text-gray-500 w-20">Sinyal Sonuçları</span>
          <div className="flex-1 h-3 rounded-full overflow-hidden bg-gray-100 flex">
            {stats.signalsWithGoal > 0 && (
              <>
                <div
                  className="bg-emerald-500 transition-all duration-500"
                  style={{ width: `${(stats.correctPredictions / stats.totalSignals) * 100}%` }}
                  title={`Doğru tahmin: ${stats.correctPredictions}`}
                />
                <div
                  className="bg-red-400 transition-all duration-500"
                  style={{ width: `${(stats.incorrectPredictions / stats.totalSignals) * 100}%` }}
                  title={`Yanlış taraf: ${stats.incorrectPredictions}`}
                />
              </>
            )}
            <div
              className="bg-gray-200 transition-all duration-500"
              style={{ width: `${(stats.signalsWithoutGoal / stats.totalSignals) * 100}%` }}
              title={`Gol yok: ${stats.signalsWithoutGoal}`}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 text-[8px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Doğru {stats.correctPredictions}</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Yanlış {stats.incorrectPredictions}</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-gray-200" /> Gol yok {stats.signalsWithoutGoal}</span>
          {stats.signalsPending > 0 && (
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-300" /> Bekliyor {stats.signalsPending}</span>
          )}
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-2 space-y-3">
          {/* Side Accuracy */}
          <div>
            <div className="text-[10px] font-bold text-gray-500 mb-1">Taraf Doğruluğu</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-orange-50 rounded px-2 py-1 text-center">
                <div className="text-xs font-mono font-bold text-orange-600">{stats.homeSideAccuracy}%</div>
                <div className="text-[8px] text-gray-400">Ev Sahibi</div>
              </div>
              <div className="bg-blue-50 rounded px-2 py-1 text-center">
                <div className="text-xs font-mono font-bold text-blue-600">{stats.awaySideAccuracy}%</div>
                <div className="text-[8px] text-gray-400">Deplasman</div>
              </div>
            </div>
          </div>

          {/* Probability Buckets */}
          {stats.buckets && stats.buckets.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-gray-500 mb-1">İhtimal Aralıkları</div>
              <div className="space-y-1">
                {stats.buckets.filter(b => b.total > 0).map(b => (
                  <div key={b.range} className="flex items-center gap-2 text-[9px]">
                    <span className="w-14 text-gray-500 font-mono">{b.range}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${b.goalRate >= 40 ? 'bg-emerald-400' : b.goalRate >= 20 ? 'bg-amber-400' : 'bg-red-300'}`}
                        style={{ width: `${Math.min(100, b.goalRate)}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-gray-600">{b.total} sinyal · {b.goalRate}% gol</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Minute Range Distribution */}
          {stats.signalsByMinuteRange && (
            <div>
              <div className="text-[10px] font-bold text-gray-500 mb-1">Dakika Dağılımı</div>
              <div className="grid grid-cols-6 gap-1">
                {Object.entries(stats.signalsByMinuteRange).map(([range, data]) => (
                  <div key={range} className="text-center bg-gray-50 rounded px-1 py-1">
                    <div className="text-[9px] font-mono font-bold text-gray-700">{range}'</div>
                    <div className="text-[8px] text-gray-500">{data.total} sinyal</div>
                    <div className="text-[8px] font-bold text-blue-500">{data.goals} gol</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Level Distribution */}
          {stats.levelDistribution && (
            <div>
              <div className="text-[10px] font-bold text-gray-500 mb-1">Sinyal Seviyesi</div>
              <div className="grid grid-cols-4 gap-1">
                {Object.entries(stats.levelDistribution).map(([level, data]) => {
                  const levelColors: Record<string, string> = {
                    low: 'text-gray-500',
                    medium: 'text-amber-600',
                    high: 'text-orange-600',
                    critical: 'text-red-600',
                  }
                  return (
                    <div key={level} className="text-center bg-gray-50 rounded px-1 py-1">
                      <div className={`text-[9px] font-bold capitalize ${levelColors[level] || 'text-gray-600'}`}>{level}</div>
                      <div className="text-[8px] text-gray-500">{data.total} sinyal</div>
                      <div className="text-[8px] text-blue-500">{data.goals} gol</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Calibration Info */}
          <div className="bg-gray-50 rounded p-2">
            <div className="text-[10px] font-bold text-gray-500 mb-1">Kalibrasyon</div>
            <div className="grid grid-cols-3 gap-2 text-[8px]">
              <div className="text-center">
                <div className="font-mono font-bold text-gray-700">{(stats.avgPredictedP * 100).toFixed(1)}%</div>
                <div className="text-gray-400">Ort. Tahmin</div>
              </div>
              <div className="text-center">
                <div className="font-mono font-bold text-gray-700">{(stats.avgObservedP * 100).toFixed(1)}%</div>
                <div className="text-gray-400">Ort. Gözlem</div>
              </div>
              <div className="text-center">
                <div className={`font-mono font-bold ${stats.calibrationError < 10 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {stats.calibrationError.toFixed(1)}%
                </div>
                <div className="text-gray-400">Kal. Hata</div>
              </div>
            </div>
          </div>

          {/* Escalation */}
          {stats.escalationSignals > 0 && (
            <div className="bg-amber-50 rounded p-2">
              <div className="text-[10px] font-bold text-amber-700 mb-1">Eskalasyon Sinyalleri</div>
              <div className="grid grid-cols-2 gap-2 text-[8px]">
                <div className="text-center">
                  <div className="font-mono font-bold text-amber-600">{stats.escalationSignals}</div>
                  <div className="text-gray-400">Eskalasyon</div>
                </div>
                <div className="text-center">
                  <div className="font-mono font-bold text-amber-600">{stats.escalationGoalRate}%</div>
                  <div className="text-gray-400">Esk. Gol Oranı</div>
                </div>
              </div>
            </div>
          )}

          {/* Time Metrics */}
          <div className="grid grid-cols-3 gap-2 text-[8px]">
            <div className="text-center">
              <div className="font-mono font-bold text-gray-700">{stats.minMinutesAfterSignal ?? '-'}dk</div>
              <div className="text-gray-400">Min</div>
            </div>
            <div className="text-center">
              <div className="font-mono font-bold text-gray-700">{stats.medianMinutesAfterSignal ?? '-'}dk</div>
              <div className="text-gray-400">Medyan</div>
            </div>
            <div className="text-center">
              <div className="font-mono font-bold text-gray-700">{stats.maxMinutesAfterSignal ?? '-'}dk</div>
              <div className="text-gray-400">Max</div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Signals */}
      {stats.recentSignals.length > 0 && (
        <div className="border-t border-gray-100 px-3 py-2">
          <div className="text-[10px] font-bold text-gray-500 mb-1.5">Son Sinyaller</div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {stats.recentSignals.slice(0, 15).map((signal, idx) => (
              <SignalRow key={`sig-${idx}`} signal={signal} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Single signal row component ──

function SignalRow({ signal }: { signal: GoalSignalRecord }) {
  const sideLabel = signal.signalSide === 'home' ? signal.homeTeam : signal.awayTeam
  const sideColor = signal.signalSide === 'home' ? 'text-orange-600' : 'text-blue-600'

  let statusBadge: React.ReactNode
  if (signal.goalHappened === null) {
    statusBadge = <span className="text-[8px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-medium">Bekliyor</span>
  } else if (signal.goalHappened && signal.correctPrediction) {
    statusBadge = <span className="text-[8px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-bold">DOĞRU</span>
  } else if (signal.goalHappened && !signal.correctPrediction) {
    statusBadge = <span className="text-[8px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-bold">YANLIŞ</span>
  } else {
    statusBadge = <span className="text-[8px] bg-gray-50 text-gray-400 px-1.5 py-0.5 rounded font-medium">Gol Yok</span>
  }

  // Use signalMinute (v2) or signal1Minute (v1 compat)
  const sigMin = signal.signalMinute ?? (signal as any).signal1Minute ?? 0
  const sigScore = signal.signalScore ?? (signal as any).signal1Score ?? 0
  const sigSide = signal.signalSide ?? (signal as any).signal1Side ?? 'home'
  const sigIndex = signal.signalIndex ?? 0

  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded-lg bg-white/60 border border-gray-100">
      {/* Signal minute */}
      <div className="w-10 text-center">
        <span className="text-[10px] font-mono font-bold text-gray-700">{sigMin}'</span>
        <div className="text-[7px] text-gray-400">sinyal</div>
      </div>

      {/* Team + score */}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-gray-600 truncate">
          <span className={`font-bold ${sideColor}`}>{sideLabel}</span>
          <span className="text-gray-300 mx-0.5">|</span>
          <span className="text-gray-500">{signal.homeTeam} vs {signal.awayTeam}</span>
        </div>
        {signal.goalHappened && signal.goalMinute != null && (
          <div className="text-[8px] text-gray-400">
            Gol {signal.goalMinute}' · {signal.minutesAfterSignal}dk sonra
          </div>
        )}
      </div>

      {/* Probability score */}
      <div className="w-8 text-center">
        <span className="text-[10px] font-mono font-bold text-indigo-500">{sigScore}%</span>
      </div>

      {/* Signal index badge */}
      {sigIndex > 1 && (
        <span className="text-[7px] bg-indigo-50 text-indigo-500 px-1 py-0.5 rounded font-mono">#{sigIndex}</span>
      )}

      {/* Escalation badge */}
      {signal.isEscalation && (
        <span className="text-[7px] bg-amber-50 text-amber-600 px-1 py-0.5 rounded font-bold">↑</span>
      )}

      {/* Status badge */}
      {statusBadge}
    </div>
  )
}
