'use client'

import { useEffect, useState, useCallback } from 'react'
import type { SignalAccuracyStats, GoalSignalRecord } from '@/lib/goalSignalTracker'
import { logError } from '@/lib/devLog'

// ── Color palette ──────────────────────────────────────────────────
const COLORS = {
  green: '#3cb15c',
  blue: '#5794f2',
  orange: '#f79520',
  red: '#e24d42',
  purple: '#9178d9',
  cyan: '#56a6d9',
  yellow: '#f2c94c',
  gray: '#8e8e8e',
  indigo: '#6366f1',
  emerald: '#10b981',
  slate: '#64748b',
} as const;

// ── Helpers ────────────────────────────────────────────────────────
function asPct(v: number | null | undefined, d = 1): string {
  return v != null ? `${(v * 100).toFixed(d)}%` : '-';
}
function asFixed(v: number | null | undefined, d = 3): string {
  return v != null ? v.toFixed(d) : '-';
}
function formatDate(ts: number | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Props ─────────────────────────────────────────────────────────
interface SignalStatsPanelProps {
  /** Optional callback to refresh parent after signal operations */
  onRefresh?: () => void;
}

export default function SignalStatsPanel({ onRefresh }: SignalStatsPanelProps) {
  const [stats, setStats] = useState<SignalAccuracyStats | null>(null)
  const [allSignals, setAllSignals] = useState<GoalSignalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [searchTeam, setSearchTeam] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'failed' | 'wrong' | 'pending'>('all')
  const [sortField, setSortField] = useState<'signalTimestamp' | 'signalScore' | 'signalMinute'>('signalTimestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [activeTab, setActiveTab] = useState<'overview' | 'signals' | 'buckets'>('overview')

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`/api/goal-signals?action=stats&days=${days}`)
      if (resp.ok) {
        const data = await resp.json()
        setStats(data)
        setAllSignals(data.recentSignals || [])
      } else {
        setError(`API hatası: ${resp.status}`)
      }
    } catch (err) {
      logError('SignalStats', err)
      setError('Veri alınamadı')
    }
    setLoading(false)
  }, [days])

  useEffect(() => { fetchStats() }, [fetchStats])

  // ── Filtered signals ──
  const filteredSignals = allSignals
    .filter(s => {
      if (filterStatus === 'success' && s.goalHappened !== true) return false
      if (filterStatus === 'failed' && s.goalHappened !== false) return false
      if (filterStatus === 'wrong' && s.goalHappened !== true || s.correctPrediction !== false) return false
      if (filterStatus === 'pending' && s.goalHappened !== null) return false
      if (searchTeam) {
        const q = searchTeam.toLowerCase()
        if (!s.homeTeam.toLowerCase().includes(q) && !s.awayTeam.toLowerCase().includes(q)) return false
      }
      return true
    })
    .sort((a, b) => {
      const aVal = a[sortField] ?? 0
      const bVal = b[sortField] ?? 0
      return sortDir === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number)
    })

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mb-3" />
        <p className="text-xs text-gray-400">Sinyal istatistikleri yükleniyor...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <div className="text-red-400 text-lg mb-2">⚠️</div>
        <p className="text-xs text-gray-500 mb-3">{error}</p>
        <button onClick={fetchStats} className="text-xs px-4 py-1.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium">Tekrar Dene</button>
      </div>
    )
  }

  if (!stats || stats.totalSignals === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-gray-300 text-3xl mb-3">📡</div>
        <p className="text-sm font-semibold text-gray-600 mb-1">Henüz Sinyal Kaydı Yok</p>
        <p className="text-xs text-gray-400">Canlı maçlarda gol ihtimali %60+ olduğunda otomatik kayıt başlar.</p>
      </div>
    )
  }

  const resolved = stats.signalsWithGoal + stats.signalsWithoutGoal
  const goalRate = resolved > 0 ? stats.signalsWithGoal / resolved : 0
  const accuracyRate = (stats.correctPredictions + stats.incorrectPredictions) > 0
    ? stats.correctPredictions / (stats.correctPredictions + stats.incorrectPredictions)
    : 0

  return (
    <div className="space-y-4">
      {/* ── Day Picker ── */}
      <div className="flex items-center gap-2">
        {[1, 7, 14, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`text-[11px] px-3 py-1.5 rounded font-medium transition-all ${
              days === d
                ? 'bg-blue-500 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {d === 1 ? '24s' : d === 7 ? '7g' : d === 14 ? '14g' : d === 30 ? '30g' : '90g'}
          </button>
        ))}
        <span className="text-[10px] text-gray-400 ml-auto">
          {stats.totalSignals} sinyal · {resolved} çözülmüş
        </span>
      </div>

      {/* ── Tab Navigation ── */}
      <div className="flex border-b border-gray-200">
        {[
          { key: 'overview', label: 'Genel Bakış', icon: '📊' },
          { key: 'signals', label: 'Sinyal Listesi', icon: '📋' },
          { key: 'buckets', label: 'İstatistikler', icon: '📈' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 transition-all ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}>
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════
          TAB 1: OVERVIEW
          ════════════════════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-4">

          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Toplam Sinyal" value={stats.totalSignals} color={COLORS.blue} icon="🔵" />
            <KpiCard label="Doğruluk" value={asPct(accuracyRate)} color={accuracyRate >= 0.7 ? COLORS.green : accuracyRate >= 0.5 ? COLORS.orange : COLORS.red} icon="🎯" />
            <KpiCard label="Gol Oranı" value={asPct(goalRate)} color={goalRate >= 0.35 ? COLORS.green : goalRate >= 0.2 ? COLORS.orange : COLORS.red} icon="⚽" />
            <KpiCard label="Brier Skor" value={asFixed(stats.brierScore, 4)} color={COLORS.purple} icon="📐" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Bekleyen" value={stats.signalsPending} color={COLORS.orange} icon="⏳" />
            <KpiCard label="Başarılı" value={stats.signalsWithGoal} color={COLORS.green} icon="✅" />
            <KpiCard label="Başarısız" value={stats.signalsWithoutGoal} color={COLORS.red} icon="❌" />
            <KpiCard label="Ort. Süre" value={stats.avgMinutesAfterSignal ? `${stats.avgMinutesAfterSignal.toFixed(1)}dk` : '-'} color={COLORS.cyan} icon="⏱️" />
          </div>

          {/* ── Distribution Bars ── */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Sinyal Dağılımı</h4>
            <div className="space-y-3">
              {/* Status breakdown */}
              <div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                  <span>Durum Dağılımı</span>
                  <span>{stats.totalSignals} sinyal</span>
                </div>
                <div className="h-4 rounded-full overflow-hidden bg-gray-100 flex">
                  {stats.signalsWithGoal > 0 && (
                    <div className="bg-emerald-400 transition-all" style={{ width: `${(stats.signalsWithGoal / stats.totalSignals) * 100}%` }} title={`Gol: ${stats.signalsWithGoal}`} />
                  )}
                  {stats.signalsWithoutGoal > 0 && (
                    <div className="bg-red-300 transition-all" style={{ width: `${(stats.signalsWithoutGoal / stats.totalSignals) * 100}%` }} title={`Gol yok: ${stats.signalsWithoutGoal}`} />
                  )}
                  {stats.signalsPending > 0 && (
                    <div className="bg-amber-300 transition-all" style={{ width: `${(stats.signalsPending / stats.totalSignals) * 100}%` }} title={`Bekleyen: ${stats.signalsPending}`} />
                  )}
                </div>
                <div className="flex gap-3 mt-1 text-[9px] text-gray-400">
                  <span>✅ Gol: {stats.signalsWithGoal}</span>
                  <span>❌ Yok: {stats.signalsWithoutGoal}</span>
                  {stats.signalsPending > 0 && <span>⏳ Bekleyen: {stats.signalsPending}</span>}
                </div>
              </div>

              {/* Accuracy bar */}
              <div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                  <span>Tahmin Doğruluğu</span>
                  <span>{stats.correctPredictions} doğru / {stats.incorrectPredictions} yanlış</span>
                </div>
                <div className="h-3 rounded-full overflow-hidden bg-gray-100 flex">
                  <div className="bg-emerald-400 transition-all" style={{ width: `${(stats.correctPredictions / Math.max(1, stats.correctPredictions + stats.incorrectPredictions)) * 100}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* ── Side-by-side: Level + Minute ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Level Distribution */}
            {stats.levelDistribution && Object.keys(stats.levelDistribution).length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Sinyal Seviyesi</h4>
                <div className="space-y-2">
                  {Object.entries(stats.levelDistribution).map(([level, data]) => {
                    const lvlColor: Record<string, string> = { low: COLORS.gray, medium: COLORS.orange, high: COLORS.red, critical: '#dc2626' }
                    const pct = stats.totalSignals > 0 ? (data.total / stats.totalSignals) * 100 : 0
                    return (
                      <div key={level} className="flex items-center gap-3">
                        <span className="w-16 text-[10px] font-medium capitalize text-gray-600">{level}</span>
                        <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: lvlColor[level] || COLORS.gray }} />
                        </div>
                        <span className="w-14 text-right text-[10px] text-gray-500">{data.total}</span>
                        <span className="w-14 text-right text-[10px] font-bold text-gray-700">{data.goals} gol</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Minute Range Distribution */}
            {stats.signalsByMinuteRange && Object.keys(stats.signalsByMinuteRange).length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Dakika Aralığı</h4>
                <div className="space-y-2">
                  {Object.entries(stats.signalsByMinuteRange).map(([range, data]) => {
                    const pct = stats.totalSignals > 0 ? (data.total / stats.totalSignals) * 100 : 0
                    return (
                      <div key={range} className="flex items-center gap-3">
                        <span className="w-12 text-[10px] font-mono font-bold text-gray-700">{range}</span>
                        <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-14 text-right text-[10px] text-gray-500">{data.total}</span>
                        <span className="w-14 text-right text-[10px] font-bold text-blue-600">{data.goals} gol</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Calibration Panel ── */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Kalibrasyon</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <CalibItem label="Ort. Tahmin" value={asPct(stats.avgPredictedP)} color={COLORS.blue} />
              <CalibItem label="Ort. Gözlem" value={asPct(stats.avgObservedP)} color={COLORS.green} />
              <CalibItem label="Kalibrasyon Hatası" value={asPct(stats.calibrationError)} color={stats.calibrationError < 0.1 ? COLORS.green : COLORS.orange} />
              <CalibItem label="Medyan Süre" value={stats.medianMinutesAfterSignal ? `${stats.medianMinutesAfterSignal}dk` : '-'} color={COLORS.cyan} />
            </div>
            {stats.buckets && stats.buckets.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] text-gray-500 mb-1.5 font-medium">İhtimal → Gerçekleşme</div>
                <div className="space-y-1.5">
                  {stats.buckets.filter(b => b.total > 0).map(b => (
                    <div key={b.range} className="flex items-center gap-3 text-[10px]">
                      <span className="w-16 font-mono text-gray-600">{b.range}</span>
                      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden relative">
                        <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${b.goalRate * 100}%` }} />
                      </div>
                      <span className="w-10 text-right text-gray-500">{b.total}</span>
                      <span className="w-12 text-right font-bold" style={{ color: b.goalRate >= 0.4 ? COLORS.green : b.goalRate >= 0.2 ? COLORS.orange : COLORS.red }}>
                        {asPct(b.goalRate, 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Side Accuracy ── */}
          <div className="grid grid-cols-2 gap-4">
            <SideAccuracyCard label="Ev Sahibi" side="home" signals={allSignals} color={COLORS.orange} />
            <SideAccuracyCard label="Deplasman" side="away" signals={allSignals} color={COLORS.blue} />
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB 2: SIGNAL LIST
          ════════════════════════════════════════════════════════════ */}
      {activeTab === 'signals' && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {(['all', 'success', 'failed', 'wrong', 'pending'] as const).map(f => (
                <button key={f} onClick={() => setFilterStatus(f)}
                  className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-all ${
                    filterStatus === f
                      ? f === 'success' ? 'bg-emerald-500 text-white'
                        : f === 'failed' ? 'bg-red-400 text-white'
                        : f === 'wrong' ? 'bg-amber-400 text-white'
                        : f === 'pending' ? 'bg-gray-400 text-white'
                        : 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  {f === 'all' ? 'Tümü' : f === 'success' ? '✅ Başarılı' : f === 'failed' ? '❌ Başarısız' : f === 'wrong' ? '⚠️ Yanlış' : '⏳ Bekleyen'}
                </button>
              ))}
            </div>
            <input type="text" value={searchTeam} onChange={e => setSearchTeam(e.target.value)}
              placeholder="Takım ara..."
              className="ml-auto text-[11px] px-3 py-1.5 rounded border border-gray-200 bg-white w-36 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-medium cursor-pointer hover:text-gray-700" onClick={() => { setSortField('signalTimestamp'); setSortDir(d => d === 'desc' ? 'asc' : 'desc') }}>
                      Tarih {sortField === 'signalTimestamp' && (sortDir === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="py-2.5 px-2 font-medium">Maç</th>
                    <th className="py-2.5 px-2 font-medium cursor-pointer hover:text-gray-700 text-center" onClick={() => { setSortField('signalMinute'); setSortDir(d => d === 'desc' ? 'asc' : 'desc') }}>
                      Dk {sortField === 'signalMinute' && (sortDir === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="py-2.5 px-2 font-medium text-center">Yön</th>
                    <th className="py-2.5 px-2 font-medium cursor-pointer hover:text-gray-700 text-center" onClick={() => { setSortField('signalScore'); setSortDir(d => d === 'desc' ? 'asc' : 'desc') }}>
                      Skor {sortField === 'signalScore' && (sortDir === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="py-2.5 px-2 font-medium text-center">Ol.</th>
                    <th className="py-2.5 px-2 font-medium text-center">Seviye</th>
                    <th className="py-2.5 px-2 font-medium text-center">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSignals.slice(0, 200).map((s, i) => {
                    const sideCls = s.signalSide === 'home' ? 'text-orange-600 bg-orange-50' : 'text-blue-600 bg-blue-50'
                    let statusLabel: string, statusCls: string
                    if (s.goalHappened === null) { statusLabel = 'Bekliyor'; statusCls = 'bg-gray-100 text-gray-500' }
                    else if (s.goalHappened && s.correctPrediction) { statusLabel = '✅ Doğru'; statusCls = 'bg-emerald-50 text-emerald-600' }
                    else if (s.goalHappened && !s.correctPrediction) { statusLabel = '⚠️ Yanlış Yön'; statusCls = 'bg-amber-50 text-amber-600' }
                    else { statusLabel = '❌ Gol Yok'; statusCls = 'bg-red-50 text-red-400' }
                    return (
                      <tr key={`${s.matchCode}-${s.signalTimestamp}-${i}`} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                        <td className="py-2 px-3 text-gray-500 whitespace-nowrap">{formatDate(s.signalTimestamp)}</td>
                        <td className="py-2 px-2">
                          <div className="font-medium text-gray-700 truncate max-w-[140px]">{s.homeTeam} vs {s.awayTeam}</div>
                          <div className="text-[9px] text-gray-400">{s.league}</div>
                        </td>
                        <td className="py-2 px-2 text-center font-mono text-gray-700">{s.signalMinute}'</td>
                        <td className="py-2 px-2 text-center">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sideCls}`}>
                            {s.signalSide === 'home' ? 'Ev' : 'Dep'}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-indigo-600">{s.signalScore}</td>
                        <td className="py-2 px-2 text-center font-mono text-gray-500">{s.calibratedP.toFixed(2)}</td>
                        <td className="py-2 px-2 text-center">
                          <LevelBadge level={s.signalLevel} />
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${statusCls}`}>{statusLabel}</span>
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
              <div className="p-8 text-center">
                <p className="text-xs text-gray-400">Filtreye uygun sinyal bulunamadı.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB 3: BUCKETS / STATS
          ════════════════════════════════════════════════════════════ */}
      {activeTab === 'buckets' && (
        <div className="space-y-4">
          {/* Day signal chart */}
          {stats.signalsByDay && Object.keys(stats.signalsByDay).length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Günlük Sinyal Aktivitesi</h4>
              <div className="space-y-1">
                {Object.entries(stats.signalsByDay).slice(-14).map(([date, data]) => {
                  const maxCount = Math.max(...Object.values(stats.signalsByDay!).map(d => d.total), 1)
                  const pct = (data.total / maxCount) * 100
                  return (
                    <div key={date} className="flex items-center gap-3 text-[10px]">
                      <span className="w-20 text-gray-500">{date.slice(5)}</span>
                      <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden flex">
                        <div className="h-full bg-emerald-400 transition-all" style={{ width: `${(data.goals / Math.max(1, data.total)) * 100}%` }} />
                        <div className="h-full bg-blue-400 transition-all" style={{ width: `${((data.total - data.goals) / Math.max(1, data.total)) * 100}%`, opacity: 0.3 }} />
                      </div>
                      <span className="w-8 text-right text-gray-600">{data.total}</span>
                      <span className="w-12 text-right font-bold text-emerald-600">{data.goals}g</span>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-3 mt-2 text-[9px] text-gray-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-400" /> Gol olan</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-200" /> Toplam</span>
              </div>
            </div>
          )}

          {/* Comprehensive stats table */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Tüm Metrikler</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-[11px]">
              <MetricRow label="Toplam Sinyal" value={stats.totalSignals} />
              <MetricRow label="Çözülmüş" value={resolved} />
              <MetricRow label="Bekleyen" value={stats.signalsPending} />
              <MetricRow label="Gol Olan" value={stats.signalsWithGoal} />
              <MetricRow label="Gol Olmayan" value={stats.signalsWithoutGoal} />
              <MetricRow label="Doğru Tahmin" value={stats.correctPredictions} />
              <MetricRow label="Yanlış Tahmin" value={stats.incorrectPredictions} />
              <MetricRow label="Doğruluk Oranı" value={asPct(accuracyRate)} valueColor={accuracyRate >= 0.7 ? COLORS.green : accuracyRate >= 0.5 ? COLORS.orange : COLORS.red} />
              <MetricRow label="Gol Oranı" value={asPct(goalRate)} valueColor={goalRate >= 0.35 ? COLORS.green : COLORS.orange} />
              <MetricRow label="False Positive" value={asPct(stats.falsePositiveRate)} valueColor={stats.falsePositiveRate > 0.6 ? COLORS.red : COLORS.gray} />
              <MetricRow label="Brier Score" value={asFixed(stats.brierScore, 4)} valueColor={stats.brierScore < 0.2 ? COLORS.green : stats.brierScore < 0.3 ? COLORS.orange : COLORS.red} />
              <MetricRow label="Kalibrasyon Hatası" value={asPct(stats.calibrationError)} valueColor={stats.calibrationError < 0.1 ? COLORS.green : COLORS.orange} />
              <MetricRow label="Ort. Tahmin P" value={asPct(stats.avgPredictedP)} />
              <MetricRow label="Ort. Gözlem P" value={asPct(stats.avgObservedP)} />
              <MetricRow label="Ev Doğruluğu" value={asPct(stats.homeSideAccuracy)} />
              <MetricRow label="Dep Doğruluğu" value={asPct(stats.awaySideAccuracy)} />
              <MetricRow label="Ort. Süre" value={stats.avgMinutesAfterSignal ? `${stats.avgMinutesAfterSignal.toFixed(1)}dk` : '-'} />
              <MetricRow label="Medyan Süre" value={stats.medianMinutesAfterSignal ? `${stats.medianMinutesAfterSignal}dk` : '-'} />
              <MetricRow label="Eskalasyon" value={stats.escalationSignals} />
              <MetricRow label="Esk. Gol Oranı" value={asPct(stats.escalationGoalRate)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function KpiCard({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3.5 flex items-center gap-3 shadow-sm">
      <div className="text-lg">{icon}</div>
      <div>
        <div className="text-lg font-black" style={{ color }}>{value}</div>
        <div className="text-[10px] text-gray-400 font-medium">{label}</div>
      </div>
    </div>
  )
}

function CalibItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <div className="text-sm font-bold" style={{ color }}>{value}</div>
      <div className="text-[10px] text-gray-400">{label}</div>
    </div>
  )
}

function SideAccuracyCard({ label, side, signals, color }: { label: string; side: 'home' | 'away'; signals: GoalSignalRecord[]; color: string }) {
  const sideSignals = signals.filter(s => s.signalSide === side && s.goalHappened !== null)
  const correct = sideSignals.filter(s => s.correctPrediction === true).length
  const total = sideSignals.length
  const pct = total > 0 ? correct / total : 0
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h4 className="text-[10px] font-bold text-gray-500 uppercase mb-2">{label} Doğruluğu</h4>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-black" style={{ color }}>{(pct * 100).toFixed(0)}%</span>
        <span className="text-[10px] text-gray-400">{correct}/{total}</span>
      </div>
      <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
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

function LevelBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    low: 'bg-gray-100 text-gray-500',
    medium: 'bg-amber-50 text-amber-600',
    high: 'bg-orange-50 text-orange-600',
    critical: 'bg-red-50 text-red-600',
  }
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium capitalize ${colors[level] || 'bg-gray-100 text-gray-500'}`}>
      {level}
    </span>
  )
}
