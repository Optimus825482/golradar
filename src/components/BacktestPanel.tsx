'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import type { BacktestResult } from '@/lib/backtestEngine'
import type { SignalAccuracyStats, GoalSignalRecord } from '@/lib/goalSignalTracker'
import type { SimulationProgress } from '@/lib/backtestSimulator'

type TabView = 'overview' | 'calibration' | 'thresholds' | 'buckets' | 'factors' | 'time' | 'signals'
import { QuickCard } from '@/components/backtest/QuickCard'
import { OverviewTab } from '@/components/backtest/OverviewTab'
import { SignalsTab } from '@/components/backtest/SignalsTab'
import { CalibrationTab } from '@/components/backtest/CalibrationTab'
import { ThresholdTab } from '@/components/backtest/ThresholdTab'
import { BucketsTab } from '@/components/backtest/BucketsTab'
import { FactorsTab } from '@/components/backtest/FactorsTab'
import { TimeTab } from '@/components/backtest/TimeTab'

export default function BacktestPanel() {
  const [backtestData, setBacktestData] = useState<BacktestResult | null>(null)
  const [signalStats, setSignalStats] = useState<SignalAccuracyStats | null>(null)
  const [recentSignals, setRecentSignals] = useState<GoalSignalRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [simProgress, setSimProgress] = useState<SimulationProgress | null>(null)
  const [activeTab, setActiveTab] = useState<TabView>('overview')
  const [days, setDays] = useState(30)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [simDaysBack, setSimDaysBack] = useState(3)
  const [simMaxMatches, setSimMaxMatches] = useState(30)
  const prevSignalCountRef = useRef(0)
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch signal stats + recent signals
  const fetchSignalData = useCallback(async () => {
    try {
      const [sigResp, recResp] = await Promise.all([
        fetch(`/api/goal-signals?action=stats&days=${days}`),
        fetch(`/api/goal-signals?action=records&days=${days}`),
      ])
      if (sigResp.ok) {
        const sigData = await sigResp.json()
        setSignalStats(sigData)
      }
      if (recResp.ok) {
        const recData = await recResp.json()
        setRecentSignals(recData.records || [])
      }
    } catch (err) {
      console.error('Signal data fetch error:', err)
    }
    setLastUpdate(new Date())
  }, [days])

  // Run backtest on existing signal data
  const runBacktest = useCallback(async () => {
    setRunning(true)
    try {
      const [btResp] = await Promise.all([
        fetch(`/api/backtest?action=run&days=${days}`),
        fetchSignalData(),
      ])
      if (btResp.ok) {
        const btData = await btResp.json()
        setBacktestData(btData)
      }
    } catch (err) {
      console.error('Backtest fetch error:', err)
    }
    setRunning(false)
  }, [days, fetchSignalData])

  // Start historical simulation
  const startSimulation = useCallback(async () => {
    setSimulating(true)
    setSimProgress(null)
    try {
      // Simulation is now synchronous — API does all fetching and simulation server-side
      const resp = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'simulate',
          daysBack: simDaysBack,
          maxMatches: simMaxMatches,
          signalThreshold: 55,
        }),
      })

      if (resp.ok) {
        const data = await resp.json()
        if (data.progress) {
          setSimProgress(data.progress)
        }
        // Refresh backtest data
        await runBacktest()
      } else {
        const errData = await resp.json().catch(() => ({}))
        console.error('Simulation error:', errData)
      }
    } catch (err) {
      console.error('Simulation start error:', err)
    }
    setSimulating(false)
  }, [simDaysBack, simMaxMatches, runBacktest])

  // Initial load
  useEffect(() => {
    runBacktest()
  }, [runBacktest])

  // Auto-refresh every 15 seconds
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      fetchSignalData()
    }, 15000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchSignalData])

  // Cleanup progress polling on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
      }
    }
  }, [])

  const signalCount = signalStats?.totalSignals || 0
  const resolvedCount = signalStats ? signalStats.signalsWithGoal + signalStats.signalsWithoutGoal : 0
  const pendingCount = signalStats?.signalsPending || 0
  const hasNewSignals = signalCount > prevSignalCountRef.current
  useEffect(() => { prevSignalCountRef.current = signalCount }, [signalCount])

  const formatElapsed = (ms: number) => {
    const sec = Math.floor(ms / 1000)
    const min = Math.floor(sec / 60)
    if (min > 0) return `${min}dk ${sec % 60}sn`
    return `${sec}sn`
  }

  return (
    <div className="space-y-4">
      {/* ── Historical Simulation Card ── */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2">
          <h3 className="text-sm font-bold text-indigo-800 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Tarihsel Backtest Simulasyonu
          </h3>
          <p className="text-[10px] text-indigo-600 mt-1">
            Biten maclarin istatistiklerini kullanarak Goal Radar algoritmasini geriye donuk test eder.
            Gercek mac verileri uzerinde calisir — sentetik/test verisi kullanmaz.
          </p>
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* Config row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] font-medium text-indigo-700">Gun:</label>
              <select
                value={simDaysBack}
                onChange={(e) => setSimDaysBack(parseInt(e.target.value, 10))}
                disabled={simulating}
                className="text-[10px] border border-indigo-200 rounded px-1.5 py-0.5 bg-white disabled:opacity-50"
              >
                <option value={1}>1 gun</option>
                <option value={3}>3 gun</option>
                <option value={7}>7 gun</option>
                <option value={14}>14 gun</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <label className="text-[10px] font-medium text-indigo-700">Max mac:</label>
              <select
                value={simMaxMatches}
                onChange={(e) => setSimMaxMatches(parseInt(e.target.value, 10))}
                disabled={simulating}
                className="text-[10px] border border-indigo-200 rounded px-1.5 py-0.5 bg-white disabled:opacity-50"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <button
              onClick={startSimulation}
              disabled={simulating}
              className={`text-[10px] px-4 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all ${
                simulating
                  ? 'bg-indigo-200 text-indigo-400 cursor-wait'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 shadow-md'
              }`}
            >
              {simulating ? (
                <>
                  <div className="w-3 h-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                  Simulasyon Calisiyor...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Tarihsel Simulasyon Baslat
                </>
              )}
            </button>
          </div>

          {/* Simulation Progress */}
          {(simulating || simProgress) && simProgress && (
            <div className="bg-white/80 rounded-lg p-3 border border-indigo-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-indigo-700">
                  {simulating ? 'Simulasyon Devam Ediyor...' : 'Simulasyon Tamamlandi!'}
                </span>
                <span className="text-[10px] text-indigo-500 font-mono">
                  {simProgress.percentComplete}% · {formatElapsed(simProgress.elapsedMs)}
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-indigo-100 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                  style={{ width: `${simProgress.percentComplete}%` }}
                />
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-4 gap-2">
                <div className="text-center">
                  <div className="text-xs font-mono font-bold text-gray-800">{simProgress.processed}/{simProgress.total}</div>
                  <div className="text-[8px] text-gray-400">Mac islendi</div>
                </div>
                <div className="text-center">
                  <div className="text-xs font-mono font-bold text-indigo-600">{simProgress.signalsRecorded}</div>
                  <div className="text-[8px] text-gray-400">Sinyal tespit</div>
                </div>
                <div className="text-center">
                  <div className="text-xs font-mono font-bold text-emerald-600">{simProgress.goalsDetected}</div>
                  <div className="text-[8px] text-gray-400">Sinyal→Gol</div>
                </div>
                <div className="text-center">
                  <div className="text-xs font-mono font-bold text-gray-600">{simProgress.matchesWithStats}</div>
                  <div className="text-[8px] text-gray-400">Istatistikli mac</div>
                </div>
              </div>

              {/* Current match */}
              {simProgress.currentMatch && (
                <div className="mt-2 text-[9px] text-gray-500 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                  Su an: {simProgress.currentMatch}
                </div>
              )}

              {/* Errors */}
              {simProgress.errors > 0 && (
                <div className="mt-1 text-[9px] text-amber-600">
                  {simProgress.errors} hata · {simProgress.matchesWithoutStats} istatistiksiz mac
                </div>
              )}
            </div>
          )}

          {/* How it works */}
          {!simulating && !simProgress && (
            <div className="bg-white/60 rounded-lg p-2.5 border border-indigo-100">
              <div className="text-[9px] text-indigo-600 space-y-1">
                <div className="font-bold mb-1">Nasil calisir?</div>
                <div className="flex items-start gap-1.5">
                  <span className="text-indigo-400">1.</span>
                  <span>Biten maclarin istatistiklerini cek</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-indigo-400">2.</span>
                  <span>HT/FT istatistiklerinden sentetik snapshot olustur (5dk aralik)</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-indigo-400">3.</span>
                  <span>Her dakikada 12-faktorlu Goal Radar algoritmasini calistir</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-indigo-400">4.</span>
                  <span>Sinyal tespit edildiginde kaydet, gercekte gol olup olmadigini kontrol et</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-indigo-400">5.</span>
                  <span>Brier skoru, kalibrasyon, faktor analizi ile sonuclari raporla</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Control Bar ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Backtest Analiz Merkezi
          </h3>
          <div className="flex items-center gap-2">
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                autoRefresh ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
              {autoRefresh ? 'Canli' : 'Duraklat'}
            </button>
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
              className="text-[10px] border border-gray-200 rounded px-1.5 py-0.5 bg-white"
            >
              <option value={7}>Son 7 gun</option>
              <option value={14}>Son 14 gun</option>
              <option value={30}>Son 30 gun</option>
              <option value={60}>Son 60 gun</option>
              <option value={90}>Son 90 gun</option>
            </select>
            <button
              onClick={runBacktest}
              disabled={running}
              className={`text-[10px] px-3 py-1 rounded font-bold flex items-center gap-1 transition-all ${
                running
                  ? 'bg-indigo-100 text-indigo-400 cursor-wait'
                  : 'bg-indigo-500 text-white hover:bg-indigo-600 active:scale-95'
              }`}
            >
              {running ? (
                <>
                  <div className="w-3 h-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                  Hesapliyor...
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Yenile
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live status bar */}
        <div className="px-4 py-2 bg-gradient-to-r from-slate-50 to-gray-50 border-t border-gray-100 flex items-center justify-between text-[9px]">
          <div className="flex items-center gap-3">
            <span className="text-gray-500">
              <span className="font-bold text-gray-700">{signalCount}</span> sinyal
            </span>
            <span className="text-gray-300">|</span>
            <span className="text-emerald-600">
              <span className="font-bold">{resolvedCount}</span> cozuldu
            </span>
            {pendingCount > 0 && (
              <>
                <span className="text-gray-300">|</span>
                <span className="text-amber-600 flex items-center gap-0.5">
                  <span className="font-bold">{pendingCount}</span> bekliyor
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                </span>
              </>
            )}
            {hasNewSignals && (
              <span className="bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold">Yeni!</span>
            )}
          </div>
          {lastUpdate && (
            <span className="text-gray-300">
              Son guncelleme: {lastUpdate.toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}
            </span>
          )}
        </div>
      </div>

      {/* ── Quick Summary Cards ── */}
      {signalStats && signalCount > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <QuickCard
            label="Toplam Sinyal"
            value={String(signalCount)}
            sub={`${resolvedCount} cozuldu, ${pendingCount} bekliyor`}
            color="text-gray-800"
            bg="bg-white"
          />
          <QuickCard
            label="Gol Orani"
            value={`${signalStats.goalAfterSignalRate}%`}
            sub="Sinyal→Gol basari"
            color={signalStats.goalAfterSignalRate >= 40 ? 'text-emerald-600' : signalStats.goalAfterSignalRate >= 25 ? 'text-amber-600' : 'text-red-500'}
            bg={signalStats.goalAfterSignalRate >= 40 ? 'bg-emerald-50' : signalStats.goalAfterSignalRate >= 25 ? 'bg-amber-50' : 'bg-red-50'}
          />
          <QuickCard
            label="Taraf Dogrulugu"
            value={`${signalStats.accuracyRate}%`}
            sub={`Ev: ${signalStats.homeSideAccuracy}% · Dep: ${signalStats.awaySideAccuracy}%`}
            color={signalStats.accuracyRate >= 70 ? 'text-emerald-600' : signalStats.accuracyRate >= 50 ? 'text-amber-600' : 'text-red-500'}
            bg="bg-white"
          />
          <QuickCard
            label="Ort. Gol Oncesi"
            value={`${signalStats.avgMinutesAfterSignal}dk`}
            sub="Sinyal→Gol suresi"
            color="text-blue-600"
            bg="bg-blue-50"
          />
        </div>
      )}

      {/* ── No Data State (with call to action) ── */}
      {(!backtestData || backtestData.signalCount === 0) && !running && signalCount === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-bold text-gray-700 mb-1">Henuz Sinyal Verisi Yok</h4>
              <p className="text-xs text-gray-400 max-w-xs">
                Veri toplamanin 2 yolu var:
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-sm">
              <button
                onClick={startSimulation}
                disabled={simulating}
                className="w-full px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-md"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Tarihsel Simulasyon Baslat
                <span className="text-[9px] font-normal opacity-80">(Biten maclar uzerinde)</span>
              </button>
              <div className="text-[9px] text-gray-400 text-center">
                Veya canli mac izlenirken %55+ gol ihtimali tespit edildiginde otomatik kaydedilir
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      {(backtestData && backtestData.signalCount > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 pt-2 flex gap-1 overflow-x-auto border-b border-gray-100 pb-2">
            {[
              { key: 'overview' as TabView, label: 'Genel', icon: '📊' },
              { key: 'signals' as TabView, label: 'Sinyal Akisi', icon: '📡' },
              { key: 'calibration' as TabView, label: 'Kalibrasyon', icon: '🎯' },
              { key: 'thresholds' as TabView, label: 'Esikler', icon: '⚡' },
              { key: 'buckets' as TabView, label: 'Bucket', icon: '🪣' },
              { key: 'factors' as TabView, label: 'Faktorler', icon: '🔬' },
              { key: 'time' as TabView, label: 'Zaman', icon: '⏱' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`text-[10px] px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors flex items-center gap-1 ${
                  activeTab === tab.key
                    ? 'bg-indigo-500 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                <span className="text-[11px]">{tab.icon}</span>
                {tab.label}
                {tab.key === 'signals' && pendingCount > 0 && (
                  <span className="bg-amber-400 text-white text-[7px] px-1 rounded-full font-bold">{pendingCount}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="px-4 py-3">
            {activeTab === 'overview' && <OverviewTab bt={backtestData} stats={signalStats} />}
            {activeTab === 'signals' && <SignalsTab signals={recentSignals} stats={signalStats} />}
            {activeTab === 'calibration' && <CalibrationTab bt={backtestData} />}
            {activeTab === 'thresholds' && <ThresholdTab bt={backtestData} />}
            {activeTab === 'buckets' && <BucketsTab bt={backtestData} />}
            {activeTab === 'factors' && <FactorsTab bt={backtestData} />}
            {activeTab === 'time' && <TimeTab bt={backtestData} />}
          </div>
        </div>
      )}
    </div>
  )
}



