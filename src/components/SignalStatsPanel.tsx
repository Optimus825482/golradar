'use client'

import { useEffect, useState, useCallback } from 'react'
import type { SignalAccuracyStats, GoalSignalRecord } from '@/lib/goalSignalTracker'
import { logError } from '@/lib/devLog'

// ── Color palette ──────────────────────────────────────────────────
const C = {
  emerald: '#10b981', green: '#3cb15c', blue: '#5794f2',
  orange: '#f79520', red: '#e24d42', purple: '#9178d9',
  cyan: '#56a6d9', yellow: '#f2c94c', gray: '#8e8e8e',
  indigo: '#6366f1', slate: '#64748b',
} as const;

function asPct(v: number | null | undefined, d = 1): string {
  return v != null ? `${(v * 100).toFixed(d)}%` : '-';
}
function asFixed(v: number | null | undefined, d = 3): string {
  return v != null ? v.toFixed(d) : '-';
}
function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function SignalStatsPanel() {
  const [stats, setStats] = useState<SignalAccuracyStats | null>(null)
  const [allSignals, setAllSignals] = useState<GoalSignalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [searchTeam, setSearchTeam] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'gol' | 'nogol' | 'pending'>('all')
  const [sortField, setSortField] = useState<'signalTimestamp' | 'signalScore' | 'signalMinute'>('signalTimestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [activeTab, setActiveTab] = useState<'primary' | 'signals' | 'details'>('primary')

  const fetchStats = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const resp = await fetch(`/api/goal-signals?action=stats&days=${days}`)
      if (resp.ok) { const data = await resp.json(); setStats(data); setAllSignals(data.recentSignals || []) }
      else { setError(`API hatası: ${resp.status}`) }
    } catch (err) { logError('SignalStats', err); setError('Veri alınamadı') }
    setLoading(false)
  }, [days])

  useEffect(() => { fetchStats() }, [fetchStats])

  const filteredSignals = allSignals
    .filter(s => {
      if (filterStatus === 'gol' && s.goalHappened !== true) return false
      if (filterStatus === 'nogol' && s.goalHappened !== false) return false
      if (filterStatus === 'pending' && s.goalHappened !== null) return false
      if (searchTeam) {
        const q = searchTeam.toLowerCase()
        if (!s.homeTeam.toLowerCase().includes(q) && !s.awayTeam.toLowerCase().includes(q)) return false
      }
      return true
    })
    .sort((a, b) => {
      const aV = a[sortField] ?? 0; const bV = b[sortField] ?? 0
      return sortDir === 'desc' ? (bV as number) - (aV as number) : (aV as number) - (bV as number)
    })

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full mb-3" />
      <p className="text-xs text-gray-400">Sinyal istatistikleri yükleniyor...</p>
    </div>
  )
  if (error) return (
    <div className="p-6 text-center">
      <div className="text-red-400 text-lg mb-2">⚠️</div>
      <p className="text-xs text-gray-500 mb-3">{error}</p>
      <button onClick={fetchStats} className="text-xs px-4 py-1.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium">Tekrar Dene</button>
    </div>
  )
  if (!stats || stats.totalSignals === 0) return (
    <div className="p-6 text-center">
      <div className="text-gray-300 text-3xl mb-3">📡</div>
      <p className="text-sm font-semibold text-gray-600 mb-1">Henüz Sinyal Kaydı Yok</p>
      <p className="text-xs text-gray-400">Canlı maçlarda gol ihtimali %60+ olduğunda otomatik kayıt başlar.</p>
    </div>
  )

  const gp = stats.goalPrimary
  const resolved = stats.signalsWithGoal + stats.signalsWithoutGoal

  // ── Time categories for the bar chart ──
  const timeCategories = [
    { label: '🏆 Excellent', key: 'excellent', count: gp.excellent, pct: gp.excellentRate, color: '#22c55e', desc: '≤5dk' },
    { label: '✅ Good', key: 'good', count: gp.good, pct: gp.goodRate, color: '#16a34a', desc: '5-10dk' },
    { label: '👍 Late', key: 'late', count: gp.late, pct: gp.lateRate, color: '#f59e0b', desc: '10-15dk' },
    { label: '❌ Fail', key: 'fail', count: gp.fail, pct: gp.failRate, color: '#ef4444', desc: 'Gol Yok' },
  ]

  return (
    <div className="space-y-4">

      {/* ── Day Picker ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {[1, 7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`text-[11px] px-3 py-1.5 rounded font-medium transition-all ${days === d ? 'bg-indigo-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {d === 1 ? '24s' : d === 7 ? '7g' : d === 14 ? '14g' : d === 30 ? '30g' : '90g'}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-gray-400 ml-auto">
          {stats.totalSignals} sinyal · {resolved} çözülmüş · {gp.pending} bekliyor
        </span>
      </div>

      {/* ── Tab Navigation ── */}
      <div className="flex border-b border-gray-200">
        {[
          { key: 'primary', label: '🥇 Gol Başarısı', desc: 'Birincil Metrik' },
          { key: 'signals', label: '📋 Sinyal Listesi', desc: 'Tüm kayıtlar' },
          { key: 'details', label: '📊 Detaylı İstatistik', desc: 'İkincil metrikler' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 transition-all ${activeTab === tab.key ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
            <span className="text-[10px] text-gray-400 mr-1">{tab.desc}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════
          TAB 1: 🥇 PRIMARY — GOAL SUCCESS METRIC
          ════════════════════════════════════════════════════════════ */}
      {activeTab === 'primary' && (
        <div className="space-y-4">

          {/* ── 🏆 Success Rate Hero ── */}
          <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-xl border border-indigo-100 p-5 text-center">
            <div className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mb-1">🥇 Birincil Başarı Metriği</div>
            <div className="text-5xl font-black text-indigo-600 my-2">
              {(gp.successRate * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-gray-500 mb-3">
              Sinyal verilen maçlarda <strong>{resolved}</strong> çözülmüş sinyalden <strong>{gp.excellent + gp.good + gp.late}</strong>'inde gol oldu
            </div>
            <div className="flex justify-center gap-4 text-[10px] text-gray-400">
              <span>🏆 {gp.excellent} Excellent</span>
              <span>✅ {gp.good} Good</span>
              <span>👍 {gp.late} Late</span>
              <span>❌ {gp.fail} Fail</span>
            </div>
          </div>

          {/* ── Time-based Success Breakdown ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">
              🏆 Zamana Göre Başarı Dağılımı
            </h4>

            {/* Big stacked bar */}
            <div className="h-8 rounded-full overflow-hidden bg-gray-100 flex mb-4">
              {timeCategories.map(c => c.count > 0 && (
                <div key={c.key} className="h-full transition-all relative group" style={{ width: `${c.pct * 100}%`, background: c.color }}>
                  {c.pct >= 0.08 && (
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] text-white font-bold drop-shadow-sm">
                      {(c.pct * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Category cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {timeCategories.map(c => (
                <div key={c.key} className="rounded-lg p-3 text-center border" style={{ borderColor: c.color + '30', background: c.color + '08' }}>
                  <div className="text-lg font-black" style={{ color: c.color }}>{c.count}</div>
                  <div className="text-[11px] font-semibold text-gray-700">{c.label}</div>
                  <div className="text-[9px] text-gray-400">{c.desc}</div>
                  <div className="text-[10px] font-bold mt-1" style={{ color: c.color }}>{asPct(c.pct, 0)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 🥈 Secondary: Side Accuracy ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">🥈 Yön Doğruluğu (İkincil)</h4>
              <span className="text-[10px] text-gray-400">Sadece gol olan sinyallerde hesaplanır</span>
            </div>
            {stats.sideAccuracy && (
              <div className="flex items-center gap-4">
                <div className="text-center flex-1">
                  <div className="text-2xl font-black" style={{ color: stats.sideAccuracy.rate >= 0.6 ? C.green : C.orange }}>
                    {asPct(stats.sideAccuracy.rate, 0)}
                  </div>
                  <div className="text-[10px] text-gray-500">Yön Doğruluğu</div>
                </div>
                <div className="flex-1">
                  <div className="h-3 rounded-full overflow-hidden bg-gray-100 flex">
                    <div className="bg-green-400 h-full" style={{ width: `${(stats.sideAccuracy.correct / Math.max(1, stats.sideAccuracy.correct + stats.sideAccuracy.incorrect)) * 100}%` }} />
                    <div className="bg-red-300 h-full" style={{ width: `${(stats.sideAccuracy.incorrect / Math.max(1, stats.sideAccuracy.correct + stats.sideAccuracy.incorrect)) * 100}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                    <span>✅ Doğru: {stats.sideAccuracy.correct}</span>
                    <span>❌ Yanlış: {stats.sideAccuracy.incorrect}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Time Metrics + Brier ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniCard label="Ort. Süre" value={stats.avgMinutesAfterSignal ? `${stats.avgMinutesAfterSignal.toFixed(1)}dk` : '-'} color={C.cyan} />
            <MiniCard label="Medyan Süre" value={stats.medianMinutesAfterSignal ? `${stats.medianMinutesAfterSignal}dk` : '-'} color={C.blue} />
            <MiniCard label="En Hızlı" value={stats.minMinutesAfterSignal ? `${stats.minMinutesAfterSignal}dk` : '-'} color={C.emerald} />
            <MiniCard label="En Yavaş" value={stats.maxMinutesAfterSignal ? `${stats.maxMinutesAfterSignal}dk` : '-'} color={C.orange} />
          </div>

          {/* ── Ev/Dep Side Accuracy ── */}
          <div className="grid grid-cols-2 gap-3">
            <SideBox label="Ev Sahibi" side="home" signals={allSignals} color={C.orange} />
            <SideBox label="Deplasman" side="away" signals={allSignals} color={C.blue} />
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB 2: 📋 SIGNAL LIST
          ════════════════════════════════════════════════════════════ */}
      {activeTab === 'signals' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {(['all', 'gol', 'nogol', 'pending'] as const).map(f => (
                <button key={f} onClick={() => setFilterStatus(f)}
                  className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-all ${
                    filterStatus === f
                      ? f === 'gol' ? 'bg-emerald-500 text-white' : f === 'nogol' ? 'bg-red-400 text-white' : f === 'pending' ? 'bg-gray-400 text-white' : 'bg-indigo-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  {f === 'all' ? 'Tümü' : f === 'gol' ? '⚽ Gol' : f === 'nogol' ? '❌ Gol Yok' : '⏳ Bekleyen'}
                </button>
              ))}
            </div>
            <input type="text" value={searchTeam} onChange={e => setSearchTeam(e.target.value)}
              placeholder="Takım ara..."
              className="ml-auto text-[11px] px-3 py-1.5 rounded border border-gray-200 bg-white w-36 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-medium cursor-pointer hover:text-gray-700" onClick={() => { setSortField('signalTimestamp'); setSortDir(d => d === 'desc' ? 'asc' : 'desc') }}>
                      Tarih {sortField === 'signalTimestamp' && (sortDir === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="py-2.5 px-2 font-medium">Maç</th>
                    <th className="py-2.5 px-2 font-medium text-center">Dk</th>
                    <th className="py-2.5 px-2 font-medium text-center">Skor</th>
                    <th className="py-2.5 px-2 font-medium text-center">Yön</th>
                    <th className="py-2.5 px-2 font-medium text-center">Gol Süresi</th>
                    <th className="py-2.5 px-2 font-medium text-center">Başarı</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSignals.slice(0, 200).map((s, i) => {
                    // 🥇 PRIMARY: Time-based success category
                    let timeLabel: string, timeCls: string, timeIcon: string
                    if (s.goalHappened === null) {
                      timeLabel = '?'; timeCls = 'bg-gray-100 text-gray-400'; timeIcon = '⏳'
                    } else if (!s.goalHappened) {
                      timeLabel = 'Gol Yok'; timeCls = 'bg-red-50 text-red-400'; timeIcon = '❌'
                    } else {
                      const m = s.minutesAfterSignal ?? 999
                      if (m <= 5) { timeLabel = '🏆 Excellent'; timeCls = 'bg-emerald-50 text-emerald-600' }
                      else if (m <= 10) { timeLabel = '✅ Good'; timeCls = 'bg-green-50 text-green-600' }
                      else { timeLabel = '👍 Late'; timeCls = 'bg-amber-50 text-amber-600' }
                      timeIcon = ''
                    }

                    // 🥈 SECONDARY: Side direction badge
                    const sideCls = s.signalSide === 'home' ? 'text-orange-600 bg-orange-50' : 'text-blue-600 bg-blue-50'

                    return (
                      <tr key={`${s.matchCode}-${s.signalTimestamp}-${i}`} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                        <td className="py-2 px-3 text-gray-500 whitespace-nowrap">{fmtDate(s.signalTimestamp)}</td>
                        <td className="py-2 px-2">
                          <div className="font-medium text-gray-700 truncate max-w-[140px]">{s.homeTeam} vs {s.awayTeam}</div>
                          <div className="text-[9px] text-gray-400">{s.league}</div>
                        </td>
                        <td className="py-2 px-2 text-center font-mono text-gray-700">{s.signalMinute}'</td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-indigo-600">{s.signalScore}</td>
                        <td className="py-2 px-2 text-center">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sideCls}`}>
                            {s.signalSide === 'home' ? 'Ev' : 'Dep'}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center font-mono text-gray-500">
                          {s.goalHappened ? `${s.minutesAfterSignal ?? '?'}dk` : '-'}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${timeCls}`}>{timeIcon} {timeLabel}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {filteredSignals.length > 200 && (
              <div className="p-2 text-center text-[10px] text-gray-400 border-t border-gray-100">
                +{filteredSignals.length - 200} kayıt daha var. Filtre kullanarak daraltın.
              </div>
            )}
            {filteredSignals.length === 0 && (
              <div className="p-8 text-center"><p className="text-xs text-gray-400">Filtreye uygun sinyal bulunamadı.</p></div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB 3: 📊 DETAILED STATS
          ════════════════════════════════════════════════════════════ */}
      {activeTab === 'details' && (
        <div className="space-y-4">
          {/* All metrics table */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">🥇 Birincil Metrikler (Gol Başarısı)</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-[11px]">
              <MetricRow label="🏆 Excellent (≤5dk)" value={gp.excellent} valueColor={C.emerald} />
              <MetricRow label="✅ Good (5-10dk)" value={gp.good} valueColor={C.green} />
              <MetricRow label="👍 Late (10-15dk)" value={gp.late} valueColor={C.orange} />
              <MetricRow label="❌ Fail (Gol Yok)" value={gp.fail} valueColor={C.red} />
              <MetricRow label="Toplam Başarı Oranı" value={asPct(gp.successRate)} valueColor={gp.successRate >= 0.6 ? C.emerald : gp.successRate >= 0.4 ? C.orange : C.red} />
              <MetricRow label="Excellent Oranı" value={asPct(gp.excellentRate)} valueColor={C.emerald} />
              <MetricRow label="Good Oranı" value={asPct(gp.goodRate)} valueColor={C.green} />
              <MetricRow label="Late Oranı" value={asPct(gp.lateRate)} valueColor={C.orange} />
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">🥈 İkincil Metrikler (Yön Doğruluğu)</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-[11px]">
              <MetricRow label="Doğru Yön" value={stats.sideAccuracy?.correct ?? 0} valueColor={C.green} />
              <MetricRow label="Yanlış Yön" value={stats.sideAccuracy?.incorrect ?? 0} valueColor={C.red} />
              <MetricRow label="Yön Doğruluğu" value={asPct(stats.sideAccuracy?.rate)} valueColor={C.blue} />
              <MetricRow label="Ev Doğruluğu" value={asPct(stats.homeSideAccuracy)} valueColor={C.orange} />
              <MetricRow label="Dep Doğruluğu" value={asPct(stats.awaySideAccuracy)} valueColor={C.blue} />
              <MetricRow label="Toplam Doğru" value={stats.correctPredictions} valueColor={C.green} />
              <MetricRow label="Toplam Yanlış" value={stats.incorrectPredictions} valueColor={C.red} />
              <MetricRow label="Klasik Doğruluk" value={asPct(stats.accuracyRate)} />
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">📐 Kalibrasyon & Süre Metrikleri</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-[11px]">
              <MetricRow label="Brier Score" value={asFixed(stats.brierScore, 4)} valueColor={stats.brierScore < 0.2 ? C.green : stats.brierScore < 0.3 ? C.orange : C.red} />
              <MetricRow label="Kalibrasyon Hatası" value={asPct(stats.calibrationError)} valueColor={stats.calibrationError < 0.1 ? C.green : C.orange} />
              <MetricRow label="Ort. Tahmin P" value={asPct(stats.avgPredictedP)} />
              <MetricRow label="Ort. Gözlem P" value={asPct(stats.avgObservedP)} />
              <MetricRow label="Ort. Süre" value={stats.avgMinutesAfterSignal ? `${stats.avgMinutesAfterSignal.toFixed(1)}dk` : '-'} />
              <MetricRow label="Medyan Süre" value={stats.medianMinutesAfterSignal ? `${stats.medianMinutesAfterSignal}dk` : '-'} />
              <MetricRow label="En Hızlı Gol" value={stats.minMinutesAfterSignal ? `${stats.minMinutesAfterSignal}dk` : '-'} />
              <MetricRow label="En Geç Gol" value={stats.maxMinutesAfterSignal ? `${stats.maxMinutesAfterSignal}dk` : '-'} />
            </div>
          </div>

          {/* Day activity chart */}
          {stats.signalsByDay && Object.keys(stats.signalsByDay).length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Günlük Aktivite</h4>
              <div className="space-y-1">
                {Object.entries(stats.signalsByDay).slice(-14).map(([date, data]) => {
                  const maxCount = Math.max(...Object.values(stats.signalsByDay!).map(d => d.total), 1)
                  return (
                    <div key={date} className="flex items-center gap-3 text-[10px]">
                      <span className="w-20 text-gray-500">{date.slice(5)}</span>
                      <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden flex">
                        <div className="h-full bg-emerald-400" style={{ width: `${(data.goals / maxCount) * 100}%` }} />
                        <div className="h-full bg-blue-200" style={{ width: `${((data.total - data.goals) / maxCount) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right text-gray-600">{data.total}</span>
                      <span className="w-12 text-right font-bold text-emerald-600">{data.goals}g</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Probability buckets */}
          {stats.buckets && stats.buckets.some(b => b.total > 0) && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">İhtimal Aralıkları → Gerçekleşme</h4>
              <div className="space-y-2">
                {stats.buckets.filter(b => b.total > 0).map(b => (
                  <div key={b.range} className="flex items-center gap-3 text-[10px]">
                    <span className="w-16 font-mono text-gray-600">{b.range}</span>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: `${b.goalRate * 100}%` }} />
                    </div>
                    <span className="w-10 text-right text-gray-500">{b.total}</span>
                    <span className="w-14 text-right font-bold" style={{ color: b.goalRate >= 0.4 ? C.green : b.goalRate >= 0.2 ? C.orange : C.red }}>
                      {asPct(b.goalRate, 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function MiniCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
      <div className="text-lg font-black" style={{ color }}>{value}</div>
      <div className="text-[10px] text-gray-400 font-medium">{label}</div>
    </div>
  )
}

function MetricRow({ label, value, valueColor }: { label: string; value: string | number; valueColor?: string }) {
  return (
    <div className="flex justify-between py-1 border-b border-gray-50">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-800" style={valueColor ? { color: valueColor } : undefined}>{value}</span>
    </div>
  )
}

function SideBox({ label, side, signals, color }: { label: string; side: 'home' | 'away'; signals: GoalSignalRecord[]; color: string }) {
  const sideSignals = signals.filter(s => s.signalSide === side && s.goalHappened !== null)
  const correct = sideSignals.filter(s => s.correctPrediction === true).length
  const total = sideSignals.length
  const pct = total > 0 ? correct / total : 0
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-black" style={{ color }}>{(pct * 100).toFixed(0)}%</span>
        <span className="text-[10px] text-gray-400">{correct}/{total}</span>
      </div>
      <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
    </div>
  )
}
