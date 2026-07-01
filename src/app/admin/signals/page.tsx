'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, AlertCircle, CheckCircle2, Clock, Search, X } from 'lucide-react';

interface SignalRecord {
  id: string;
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;
  signalMinute: number;
  signalSide: string;
  signalScore: number;
  calibratedP: number;
  signalLevel: string;
  goalHappened: boolean | null;
  goalMinute: number | null;
  minutesAfterSignal: number | null;
  homeScore: number;
  awayScore: number;
  currentHomeGoals: number;
  currentAwayGoals: number;
  signalTimestamp: number;
  signalTier?: string | null;
}

export default function AdminSignalsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logos, setLogos] = useState<Record<string, string>>({});

  // Filters
  const [filterLeague, setFilterLeague] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [filterResult, setFilterResult] = useState('');

  const load = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/goal-signals?action=records&date=${date}`);
      if (!resp.ok) { setError('Veri alinamadi'); setSignals([]); return; }
      const data = await resp.json();
      const records = data.records ?? [];
      setSignals(records);

      // Fetch logos for all teams
      if (records.length > 0) {
        const teamSet = new Set<string>();
        for (const r of records) {
          teamSet.add(r.homeTeam);
          teamSet.add(r.awayTeam);
        }
        const teamNames = [...teamSet].join(',');
        try {
          const logoResp = await fetch(`/api/team-logos?teams=${encodeURIComponent(teamNames)}`);
          const logoData = await logoResp.json();
          if (logoData.logos) setLogos(logoData.logos);
        } catch {}
      }
    } catch { setError('Baglanti hatasi'); setSignals([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(selectedDate); }, [selectedDate, load]);

  // Sort: en yeni sinyal en ustte (signalTimestamp DESC)
  // Filter: lig, level, sonuc
  const filtered = useMemo(() => {
    let list = [...signals];
    // Sort newest first
    list.sort((a, b) => b.signalTimestamp - a.signalTimestamp);

    if (filterLeague) {
      list = list.filter(s => s.league.toLowerCase().includes(filterLeague.toLowerCase()));
    }
    if (filterLevel) {
      list = list.filter(s => s.signalLevel === filterLevel);
    }
    if (filterResult) {
      if (filterResult === 'goal') list = list.filter(s => s.goalHappened === true);
      else if (filterResult === 'nogoal') list = list.filter(s => s.goalHappened === false);
      else if (filterResult === 'pending') list = list.filter(s => s.goalHappened == null);
    }
    return list;
  }, [signals, filterLeague, filterLevel, filterResult]);

  // Benzersiz lig ve level listeleri
  const leagues = useMemo(() => [...new Set(signals.map(s => s.league))].sort(), [signals]);
  const levels = useMemo(() => [...new Set(signals.map(s => s.signalLevel))].sort(), [signals]);

  // Stats
  const total = filtered.length;
  const withGoal = filtered.filter(s => s.goalHappened === true).length;
  const withoutGoal = filtered.filter(s => s.goalHappened === false).length;
  const pending = filtered.filter(s => s.goalHappened == null).length;
  const resolved = withGoal + withoutGoal;
  const successRate = resolved > 0 ? withGoal / resolved : 0;

  const shiftDay = (offset: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + offset);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const getLogo = (team: string): string | null => {
    return logos[team.toLowerCase()] ?? null;
  };

  const levelColor = (level: string) => {
    switch (level) {
      case 'critical': return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' };
      case 'high': return { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' };
      case 'medium': return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' };
      default: return { bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200' };
    }
  };

  const resetFilters = () => {
    setFilterLeague('');
    setFilterLevel('');
    setFilterResult('');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-black text-gray-800">📡 Sinyal Kayitlari</h1>
        <p className="text-xs text-gray-500 mt-0.5">Tarih secin, filtreleyin, sinyalleri inceleyin</p>
      </div>

      {/* Date selector */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => shiftDay(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex items-center gap-3 flex-1 justify-center">
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="text-sm font-bold text-center border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 w-48"
            />
            <button onClick={() => setSelectedDate(today)}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-semibold border border-indigo-200">
              Bugun
            </button>
          </div>
          <button onClick={() => shiftDay(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      {signals.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 flex flex-wrap items-center gap-2">
          <Search className="size-3.5 text-gray-400" />
          
          {/* League filter */}
          <select
            value={filterLevel}
            onChange={e => setFilterLevel(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="">Tum seviyeler</option>
            {levels.map(l => (
              <option key={l} value={l}>{l === 'critical' ? 'KRITIK' : l === 'high' ? 'YUKSEK' : l === 'medium' ? 'ORTA' : 'DUSUK'}</option>
            ))}
          </select>

          {/* Level filter */}
          <select
            value={filterResult}
            onChange={e => setFilterResult(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="">Tum sonuclar</option>
            <option value="goal">Gol</option>
            <option value="nogoal">Basarisiz</option>
            <option value="pending">Bekleyen</option>
          </select>

          {/* League search */}
          <input
            type="text"
            value={filterLeague}
            onChange={e => setFilterLeague(e.target.value)}
            placeholder="Lig ara..."
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 w-32"
          />

          {/* Reset */}
          {(filterLeague || filterLevel || filterResult) && (
            <button onClick={resetFilters} className="text-xs text-gray-500 hover:text-red-500 flex items-center gap-1 px-2 py-1">
              <X className="size-3" /> Temizle
            </button>
          )}

          <span className="text-[10px] text-gray-400 ml-auto">{filtered.length} / {signals.length} sinyal</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
          <AlertCircle className="size-4" /> {error}
        </div>
      )}

      {/* No signals */}
      {!loading && !error && signals.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
          <div className="text-4xl mb-2 opacity-20">📭</div>
          <p className="text-sm text-gray-400 font-medium">{selectedDate} tarihinde sinyal bulunamadi</p>
          <p className="text-xs text-gray-400 mt-1">Farkli bir tarih secin veya canli maclari bekleyin</p>
        </div>
      )}

      {/* Signals table */}
      {!loading && signals.length > 0 && (
        <>
          {/* Success bar */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {selectedDate} &middot; {filtered.length} sinyal {filtered.length !== signals.length ? `(fitrelenmis)` : ''}
                <span className="text-gray-400 font-normal ml-2">
                  ({withGoal} gol, {withoutGoal} basarisiz, {pending} bekleyen)
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={`font-bold ${successRate >= 0.5 ? 'text-emerald-600' : 'text-red-600'}`}>
                  %{(successRate * 100).toFixed(1)} basari
                </span>
                {resolved > 0 && (
                  <span className="text-gray-400">({resolved} cozulmus)</span>
                )}
              </div>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
              {withGoal > 0 && (
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(withGoal / filtered.length) * 100}%` }} title={`${withGoal} gol`} />
              )}
              {withoutGoal > 0 && (
                <div className="h-full bg-red-400 transition-all" style={{ width: `${(withoutGoal / filtered.length) * 100}%` }} title={`${withoutGoal} basarisiz`} />
              )}
              {pending > 0 && (
                <div className="h-full bg-amber-400 transition-all" style={{ width: `${(pending / filtered.length) * 100}%` }} title={`${pending} bekleyen`} />
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-500">
                    <th className="text-left px-3 py-2.5 font-semibold">Mac</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Lig</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Dk</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Yon</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Radar</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Skor</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Seviye</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Olasilik</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Sonuc</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Gol</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => {
                    const isGoal = s.goalHappened === true;
                    const isNoGoal = s.goalHappened === false;
                    const isPending = s.goalHappened == null;
                    const lc = levelColor(s.signalLevel);
                    const homeLogo = getLogo(s.homeTeam);
                    const awayLogo = getLogo(s.awayTeam);

                    return (
                      <tr
                        key={s.id}
                        onClick={() => window.open(`/?matchCode=${s.matchCode}`, '_blank')}
                        className="border-b border-gray-50 hover:bg-indigo-50/40 cursor-pointer transition-colors group"
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col items-center gap-0.5 min-w-[40px]">
                              <span className="text-[10px] text-gray-400 font-mono">{s.signalMinute}&apos;</span>
                              <span className={`text-[10px] font-bold px-1 rounded ${
                                s.signalSide === 'home' ? 'bg-orange-100 text-orange-700' :
                                s.signalSide === 'away' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {s.signalSide === 'home' ? 'EV' : s.signalSide === 'away' ? 'DEP' : s.signalSide}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                {homeLogo ? (
                                  <img src={homeLogo} alt="" className="w-4 h-4 object-contain rounded-full"
                                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                ) : <div className="w-4 h-4 rounded-full bg-orange-100 flex items-center justify-center text-[8px] text-orange-600 font-bold">H</div>}
                                <span className="font-semibold text-gray-800 truncate">{s.homeTeam}</span>
                              </div>
                              <div className="text-[10px] text-gray-300 text-center leading-none my-0.5">vs</div>
                              <div className="flex items-center gap-1.5">
                                {awayLogo ? (
                                  <img src={awayLogo} alt="" className="w-4 h-4 object-contain rounded-full"
                                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                ) : <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center text-[8px] text-blue-600 font-bold">A</div>}
                                <span className="font-semibold text-gray-800 truncate">{s.awayTeam}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 text-[11px]">{s.league}</td>
                        <td className="px-3 py-2.5 text-center font-mono text-gray-600">{s.signalMinute}&apos;</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            s.signalSide === 'home' ? 'bg-orange-100 text-orange-700' :
                            s.signalSide === 'away' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {s.signalSide === 'home' ? 'EV' : s.signalSide === 'away' ? 'DEP' : s.signalSide}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="font-mono font-bold text-lg text-gray-800">{s.signalScore}</span>
                          <span className="text-[9px] text-gray-400 ml-1">/100</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="font-mono font-bold text-sm text-gray-700">
                            {s.currentHomeGoals} - {s.currentAwayGoals}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${lc.bg} ${lc.text} ${lc.border} border`}>
                            {s.signalLevel === 'critical' ? 'KRITIK' :
                             s.signalLevel === 'high' ? 'YUKSEK' :
                             s.signalLevel === 'medium' ? 'ORTA' : 'DUSUK'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {s.calibratedP > 0 ? (
                            <div>
                              <span className="font-mono font-bold text-indigo-600">%{(s.calibratedP * 100).toFixed(0)}</span>
                              <div className="h-1 w-12 ml-auto bg-gray-100 rounded-full overflow-hidden mt-0.5">
                                <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${s.calibratedP * 100}%` }} />
                              </div>
                            </div>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {isGoal ? (
                            <div className="flex items-center justify-end gap-1">
                              <CheckCircle2 className="size-3.5 text-emerald-500" />
                              <span className="font-bold text-emerald-600 text-[11px]">GOL</span>
                            </div>
                          ) : isNoGoal ? (
                            <div className="flex items-center justify-end gap-1">
                              <AlertCircle className="size-3.5 text-red-400" />
                              <span className="text-red-500 text-[11px]">YOK</span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Clock className="size-3.5 text-amber-400" />
                              <span className="text-amber-500 text-[11px]">BEKLIYOR</span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          {s.goalMinute != null ? (
                            <span className="font-bold text-gray-700">{s.goalMinute}&apos;</span>
                          ) : isPending ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                          {s.minutesAfterSignal != null && isGoal && (
                            <div className="text-[9px] text-emerald-500 font-medium">+{s.minutesAfterSignal}dk</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 text-[10px] text-gray-400 border-t border-gray-100 bg-gray-50">
              <span>Toplam {filtered.length} sinyal &middot; {withGoal} gol &middot; {withoutGoal} basarisiz &middot; {pending} bekleyen</span>
              <span className="flex items-center gap-1">
                <ExternalLink className="size-3" /> Satira tiklayarak mac detayini acin
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
