"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import type { Match } from "@/components/match/types";

interface SignalRecord {
  id: string; matchCode: number; homeTeam: string; awayTeam: string;
  league: string; date: string; signalMinute: number;
  signalSide: string; signalScore: number; calibratedP: number;
  level: string; goalHappened: boolean | null;
  goalMinute: number | null; minutesAfterSignal: number | null;
  homeScore: number; awayScore: number;
  currentHomeGoals: number; currentAwayGoals: number;
  finalHomeScore: number | null; finalAwayScore: number | null;
}

interface SignalsCenterProps {
  matches: Match[];
  onSelectMatch: (match: Match) => void;
}

const levelColor = (level: string) => {
  switch (level) {
    case 'critical': return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' };
    case 'high': return { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' };
    case 'medium': return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' };
    default: return { bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200' };
  }
};

export default function SignalsCenter({ matches, onSelectMatch }: SignalsCenterProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [logos, setLogos] = useState<Record<string, string>>({});

  const load = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/goal-signals?action=records&date=${date}`);
      if (!resp.ok) { setSignals([]); return; }
      const data = await resp.json();
      const records = data.records ?? [];
      setSignals(records);

      if (records.length > 0) {
        const teamSet = new Set<string>();
        for (const r of records) { teamSet.add(r.homeTeam); teamSet.add(r.awayTeam); }
        const teamNames = [...teamSet].join(',');
        try {
          const lr = await fetch(`/api/team-logos?teams=${encodeURIComponent(teamNames)}`);
          const ld = await lr.json();
          if (ld.logos) setLogos(ld.logos);
        } catch {}
      }
    } catch { setSignals([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(selectedDate); }, [selectedDate, load]);

  const shift = (offset: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + offset);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const getLogo = (team: string): string | null => logos[team.toLowerCase()] ?? null;

  const total = signals.length;
  const withGoal = signals.filter(s => s.goalHappened === true).length;
  const withoutGoal = signals.filter(s => s.goalHappened === false).length;
  const pending = signals.filter(s => s.goalHappened == null).length;
  const resolved = withGoal + withoutGoal;
  const successRate = resolved > 0 ? withGoal / resolved : 0;

  return (
    <div className="px-3 py-3 space-y-3 pb-24">
      {/* Date selector */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => shift(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><ChevronLeft className="size-4" /></button>
          <div className="flex items-center gap-2 flex-1 justify-center">
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="text-sm font-bold text-center border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 w-44" />
            <button onClick={() => setSelectedDate(today)}
              className="text-[11px] px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-semibold border border-indigo-200">Bugun</button>
          </div>
          <button onClick={() => shift(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><ChevronRight className="size-4" /></button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
        </div>
      )}

      {/* No signals */}
      {!loading && signals.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
          <div className="text-4xl mb-2 opacity-20">📭</div>
          <p className="text-sm text-gray-400 font-medium">{selectedDate} tarihinde sinyal bulunamadi</p>
        </div>
      )}

      {/* Signals table */}
      {!loading && signals.length > 0 && (
        <>
          {/* Success bar */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs font-semibold text-gray-600">{selectedDate} &middot; {total} sinyal</div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {withGoal}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> {withoutGoal}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> {pending}</span>
                <span className={`font-bold ${successRate >= 0.5 ? 'text-emerald-600' : 'text-red-600'}`}>%{(successRate * 100).toFixed(1)}</span>
              </div>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
              {withGoal > 0 && <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(withGoal / total) * 100}%` }} />}
              {withoutGoal > 0 && <div className="h-full bg-red-400 transition-all" style={{ width: `${(withoutGoal / total) * 100}%` }} />}
              {pending > 0 && <div className="h-full bg-amber-400 transition-all" style={{ width: `${(pending / total) * 100}%` }} />}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-500">
                    <th className="text-left px-2.5 py-2 font-semibold">Mac</th>
                    <th className="text-center px-2 py-2 font-semibold">Dk</th>
                    <th className="text-center px-2 py-2 font-semibold">Yon</th>
                    <th className="text-right px-2 py-2 font-semibold">Skor</th>
                    <th className="text-center px-2 py-2 font-semibold">Seviye</th>
                    <th className="text-right px-2 py-2 font-semibold">P</th>
                    <th className="text-right px-2 py-2 font-semibold">Sonuc</th>
                    <th className="text-right px-2 py-2 font-semibold">Gol</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map(s => {
                    const isGoal = s.goalHappened === true;
                    const isNoGoal = s.goalHappened === false;
                    const isPending = s.goalHappened == null;
                    const lc = levelColor(s.level);

                    const handleClick = () => {
                      const live = matches.find(m => m.code === s.matchCode);
                      if (live) { onSelectMatch(live); return; }
                      // Create a minimal match object from signal data
                      onSelectMatch({
                        code: s.matchCode, bid: 0, league: s.league, leagueId: 0,
                        home: s.homeTeam, away: s.awayTeam, homeTr: s.homeTeam, awayTr: s.awayTeam,
                        homeGoals: s.finalHomeScore ?? s.currentHomeGoals ?? 0,
                        awayGoals: s.finalAwayScore ?? s.currentAwayGoals ?? 0,
                        firstHalfScore: "-",
                        minute: s.goalMinute != null ? `${s.goalMinute}` : "MS", status: 0, statusText: "Bitti",
                        time: "", isLive: false, isFinished: true, isUpcoming: false, country: "", stats: {}, hasStats: false,
                        homeColor: null, awayColor: null, homeAbbrev: null, awayAbbrev: null,
                        homeLogoUrl: null, awayLogoUrl: null, homeRedCards: 0, awayRedCards: 0,
                      });
                    };

                    return (
                      <tr key={s.id} onClick={handleClick}
                        className="border-b border-gray-50 hover:bg-indigo-50/40 cursor-pointer transition-colors">
                        <td className="px-2.5 py-2">
                          <div className="flex items-center gap-1.5">
                            {getLogo(s.homeTeam) ? (
                              <img src={getLogo(s.homeTeam)!} alt="" className="w-4 h-4 object-contain rounded-full"
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : null}
                            <span className="font-semibold text-gray-800 truncate max-w-[70px]">{s.homeTeam}</span>
                            <span className="text-[10px] text-gray-300">v</span>
                            <span className="font-semibold text-gray-800 truncate max-w-[70px]">{s.awayTeam}</span>
                            {getLogo(s.awayTeam) ? (
                              <img src={getLogo(s.awayTeam)!} alt="" className="w-4 h-4 object-contain rounded-full"
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : null}
                          </div>
                          <div className="text-[9px] text-gray-400 mt-0.5">{s.league} #{s.matchCode}</div>
                        </td>
                        <td className="px-2 py-2 text-center font-mono text-gray-600">{s.signalMinute}&apos;</td>
                        <td className="px-2 py-2 text-center">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            s.signalSide === 'home' ? 'bg-orange-100 text-orange-700' :
                            s.signalSide === 'away' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                          }`}>{s.signalSide === 'home' ? 'EV' : s.signalSide === 'away' ? 'DEP' : s.signalSide}</span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono font-bold text-gray-800">{s.signalScore}</td>
                        <td className="px-2 py-2 text-center">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${lc.bg} ${lc.text} ${lc.border} border`}>
                            {s.level === 'critical' ? 'KRITIK' : s.level === 'high' ? 'YUKSEK' : s.level === 'medium' ? 'ORTA' : 'DUSUK'}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          {s.calibratedP > 0 ? (
                            <div>
                              <span className="font-mono font-bold text-indigo-600">%{(s.calibratedP * 100).toFixed(0)}</span>
                              <div className="h-1 w-10 ml-auto bg-gray-100 rounded-full overflow-hidden mt-0.5">
                                <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${s.calibratedP * 100}%` }} />
                              </div>
                            </div>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {isGoal ? <div className="flex items-center justify-end gap-1"><CheckCircle2 className="size-3.5 text-emerald-500" /><span className="font-bold text-emerald-600 text-[11px]">GOL</span></div>
                           : isNoGoal ? <div className="flex items-center justify-end gap-1"><AlertCircle className="size-3.5 text-red-400" /><span className="text-red-500 text-[11px]">YOK</span></div>
                           : <div className="flex items-center justify-end gap-1"><Clock className="size-3.5 text-amber-400" /><span className="text-amber-500 text-[11px]">BEKLIYOR</span></div>}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {s.goalMinute != null ? <span className="font-bold text-gray-700">{s.goalMinute}&apos;</span>
                           : isPending ? <span className="text-gray-300">—</span> : <span className="text-gray-300">—</span>}
                          {s.minutesAfterSignal != null && isGoal && <div className="text-[9px] text-emerald-500 font-medium">+{s.minutesAfterSignal}dk</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 text-[10px] text-gray-400 border-t border-gray-100 bg-gray-50 flex items-center gap-1">
              <ExternalLink className="size-3" /> Satira tiklayarak mac detayini acin
            </div>
          </div>
        </>
      )}
    </div>
  );
}
