"use client";

// Backward-compat re-export. The actual Signals Center UI lives in
// `./SignalsCenter` and receives the matches list + onSelectMatch callback
// directly from the page. This thin wrapper exists so any legacy import
// paths still resolve.

import SignalsCenter from "./SignalsCenter";
import type { Match } from "@/components/match/types";

interface LegacyPanelProps {
  matches?: Match[];
  onSelectMatch?: (match: Match) => void;
}

export default function SignalHistoryPanel({
  matches = [],
  onSelectMatch,
}: LegacyPanelProps) {
  const fallback = (m: Match) => {
    if (onSelectMatch) onSelectMatch(m);
  };
  return <SignalsCenter matches={matches} onSelectMatch={onSelectMatch ?? fallback} />;
}

interface GoalSignalRecord {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  signalMinute: number;
  signalSide: "home" | "away";
  signalScore: number;
  calibratedP: number;
  signalLevel: string;
  goalHappened: boolean | null;
  goalMinute: number | null;
  correctPrediction: boolean | null;
  minutesAfterSignal: number | null;
  signalTimestamp: number;
  lastScore?: number | null;
  lastCalibratedP?: number | null;
}

interface BacktestRun {
  id: string;
  createdAt: string;
  daysBack: number;
  maxMatches: number;
  totalMatches: number;
  signalsRecorded: number;
  goalsDetected: number;
  accuracy: number | null;
  avgTimeToGoal: number | null;
}

type FilterType = "all" | "success" | "failed" | "pending";
type PeriodType = "1" | "7" | "30" | "all";

export default function SignalHistoryPanel() {
  const [signals, setSignals] = useState<GoalSignalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [period, setPeriod] = useState<PeriodType>("7");
  const [searchTeam, setSearchTeam] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [backtestRuns, setBacktestRuns] = useState<BacktestRun[]>([]);

  const fetchSignals = useCallback(async () => {
    try {
      const days = period === "all" ? 90 : parseInt(period, 10);
      const resp = await fetch(`/api/goal-signals?action=stats&days=${days}`);
      if (resp.ok) {
        const data = await resp.json();
        setSignals(data.recentSignals || []);
        setFetchError(null);
      } else {
        setFetchError(`API hatası: ${resp.status}`);
      }
    } catch (e) {
      logError('SignalHistoryPanel', e);
      setFetchError('Veri alınamadı. Bağlantıyı kontrol edin.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  const fetchBacktestRuns = useCallback(async () => {
    try {
      const resp = await fetch("/api/backtest?action=runs");
      if (resp.ok) {
        const data = await resp.json();
        setBacktestRuns(data.runs || []);
      }
    } catch (e) { logError('SignalHistoryPanel', e); }
  }, []);

  useEffect(() => { fetchSignals(); }, [fetchSignals]);

  // Her 15 saniyede bir otomatik güncelle
  useEffect(() => {
    const interval = setInterval(fetchSignals, 15000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  // Gol olduğunda anında güncelle
  useEffect(() => {
    const handler = () => fetchSignals();
    window.addEventListener('goal-scored', handler);
    return () => window.removeEventListener('goal-scored', handler);
  }, [fetchSignals]);
  useEffect(() => { fetchBacktestRuns(); }, [fetchBacktestRuns]);

  // Filter signals
  const filtered = signals.filter(s => {
    if (filter === "success" && s.goalHappened !== true) return false;
    if (filter === "failed" && s.goalHappened !== false) return false;
    if (filter === "pending" && s.goalHappened !== null) return false;
    if (searchTeam) {
      const q = searchTeam.toLowerCase();
      if (!s.homeTeam.toLowerCase().includes(q) && !s.awayTeam.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Stats from filtered
  const total = signals.length;
  const success = signals.filter(s => s.goalHappened === true).length;
  const failed = signals.filter(s => s.goalHappened === false).length;
  const pending = signals.filter(s => s.goalHappened === null).length;
  // Accuracy: only count signals where a side prediction was actually made
  const withPrediction = signals.filter(s => s.correctPrediction !== null).length;
  const correct = signals.filter(s => s.correctPrediction === true).length;
  const resolved = success + failed;
  const accuracyRate = withPrediction > 0 ? correct / withPrediction : 0;
  const goalRate = resolved > 0 ? success / resolved : 0;

  const statusBadge = (s: GoalSignalRecord) => {
    if (s.goalHappened === null) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Bekliyor</span>;
    if (s.goalHappened === true && s.correctPrediction === true)
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold">✓ Gol</span>;
    if (s.goalHappened === true && s.correctPrediction === false)
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">! Yanlış Yön</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">✗ Gol Yok</span>;
  };

  const sideBadge = (s: GoalSignalRecord) => {
    const cls = s.signalSide === "home" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700";
    return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cls}`}>{s.signalSide === "home" ? "Ev" : "Dep"}</span>;
  };

  return (
    <div className="px-3 py-2 space-y-3">
      <Tabs defaultValue="signals">
        <TabsList className="bg-gray-100 border-0 h-8 w-full">
          <TabsTrigger value="signals" className="text-xs data-[state=active]:bg-orange-500 data-[state=active]:text-white h-7 flex-1">Sinyal Geçmişi</TabsTrigger>
          <TabsTrigger value="backtest" className="text-xs data-[state=active]:bg-orange-500 data-[state=active]:text-white h-7 flex-1">Backtest</TabsTrigger>
        </TabsList>

        {/* ── Tab: Sinyal Geçmişi ── */}
        <TabsContent value="signals" className="mt-3 space-y-3">
          {/* Stats summary */}
          <div className="grid grid-cols-5 gap-2">
            <div className="bg-white rounded-lg border border-gray-100 p-2 text-center">
              <div className="text-lg font-bold text-gray-800">{total}</div>
              <div className="text-[9px] text-gray-400">Toplam</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-2 text-center">
              <div className="text-lg font-bold text-emerald-600">{success}</div>
              <div className="text-[9px] text-gray-400">Başarılı</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-2 text-center">
              <div className="text-lg font-bold text-red-500">{failed}</div>
              <div className="text-[9px] text-gray-400">Başarısız</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-2 text-center">
              <div className={"text-lg font-bold " + (accuracyRate >= 0.7 ? "text-emerald-600" : accuracyRate >= 0.5 ? "text-amber-500" : "text-red-500")}>
                {(accuracyRate * 100).toFixed(0)}%
              </div>
              <div className="text-[9px] text-gray-400">Doğruluk</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-2 text-center">
              <div className={"text-lg font-bold " + (goalRate >= 0.4 ? "text-emerald-600" : goalRate >= 0.25 ? "text-amber-500" : "text-red-500")}>
                {(goalRate * 100).toFixed(0)}%
              </div>
              <div className="text-[9px] text-gray-400">Gol %</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {(["all","success","failed","pending"] as FilterType[]).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-[10px] px-2 py-1 rounded-full transition-colors ${
                    filter === f
                      ? "bg-orange-500 text-white font-semibold"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {f === "all" ? "Tümü" : f === "success" ? "Başarılı" : f === "failed" ? "Başarısız" : "Bekleyen"}
                </button>
              ))}
            </div>
            <div className="flex gap-1 ml-auto">
              {(["1","7","30","all"] as PeriodType[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`text-[10px] px-2 py-1 rounded-full transition-colors ${
                    period === p ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {p === "1" ? "24s" : p === "7" ? "7g" : p === "30" ? "30g" : "Tümü"}
                </button>
              ))}
            </div>
          </div>

          {/* Check pending button */}
          {pending > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  setChecking(true);
                  setCheckResult(null);
                  try {
                    const resp = await fetch('/api/goal-signals', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'checkPending' }),
                    });
                    if (resp.ok) {
                      const data = await resp.json();
                      setCheckResult(`${data.expired} sinyal güncellendi, ${data.stillPending} bekliyor`);
                      fetchSignals();
                    }
                  } catch (e) { logError('SignalHistoryPanel', e); } finally {
                    setChecking(false);
                  }
                }}
                disabled={checking}
                className="text-[11px] px-3 py-1.5 rounded-lg bg-indigo-500 text-white font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50"
              >
                {checking ? "Kontrol ediliyor..." : `Bekleyenleri Kontrol Et (${pending})`}
              </button>
              {checkResult && <span className="text-[10px] text-gray-500">{checkResult}</span>}
            </div>
          )}

          {/* Team search */}
          <input
            type="text"
            placeholder="Takım ara..."
            value={searchTeam}
            onChange={e => setSearchTeam(e.target.value)}
            className="w-full text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
          />

          {/* Signal table */}
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-xs text-gray-400">Sinyaller yükleniyor...</p>
            </div>
          ) : fetchError ? (
            <div className="text-center py-8 bg-red-50 rounded-lg border border-red-100">
              <p className="text-xs text-red-500 font-medium mb-1">Yükleme hatası</p>
              <p className="text-[10px] text-red-400">{fetchError}</p>
              <button
                onClick={fetchSignals}
                className="mt-2 text-[11px] px-3 py-1 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors"
              >
                Tekrar Dene
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-gray-400">Henüz sinyal kaydı yok</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-3">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400">
                    <th className="text-left py-1.5 px-2 font-medium">Maç</th>
                    <th className="text-center py-1.5 px-1 font-medium">Dk</th>
                    <th className="text-center py-1.5 px-1 font-medium">Yön</th>
                    <th className="text-center py-1.5 px-1 font-medium">Skor</th>
                    <th className="text-center py-1.5 px-1 font-medium">Ol.</th>
                    <th className="text-center py-1.5 px-1 font-medium">Sev.</th>
                    <th className="text-center py-1.5 px-1 font-medium">Durum</th>
                    <th className="text-center py-1.5 px-1 font-medium">Süre</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 100).map((s, i) => (
                    <tr key={`${s.matchCode}-${s.signalMinute}-${s.signalTimestamp}-${i}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-1.5 px-2">
                        <div className="font-medium text-gray-800 truncate max-w-[120px]">{s.homeTeam} vs {s.awayTeam}</div>
                        <div className="text-[8px] text-gray-400">{s.league}</div>
                      </td>
                      <td className="text-center py-1.5 px-1 font-mono text-gray-700">{s.signalMinute}'</td>
                      <td className="text-center py-1.5 px-1">{sideBadge(s)}</td>
                      <td className="text-center py-1.5 px-1 font-mono font-semibold text-gray-800">{s.signalScore}</td>
                      <td className="text-center py-1.5 px-1 font-mono text-gray-500">{s.calibratedP.toFixed(2)}</td>
                      <td className="text-center py-1.5 px-1">
                        <span className={`text-[9px] px-1 rounded ${
                          s.signalLevel === "critical" ? "bg-red-100 text-red-700" :
                          s.signalLevel === "high" ? "bg-orange-100 text-orange-700" :
                          s.signalLevel === "medium" ? "bg-yellow-100 text-yellow-700" :
                          "bg-gray-100 text-gray-500"
                        }`}>{s.signalLevel}</span>
                      </td>
                      <td className="text-center py-1.5 px-1">{statusBadge(s)}</td>
                      <td className="text-center py-1.5 px-1 font-mono text-gray-500">
                        {s.minutesAfterSignal != null ? `${s.minutesAfterSignal}dk` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filtered.length > 100 && (
            <p className="text-[10px] text-gray-400 text-center">+{filtered.length - 100} sinyal daha var. Filtre kullanarak daraltın.</p>
          )}
        </TabsContent>

        {/* ── Tab: Backtest ── */}
        <TabsContent value="backtest" className="mt-3 space-y-3">
          {/* Backtest Run History */}
          <div className="bg-white rounded-lg border border-gray-100">
            <div className="px-3 py-2 border-b border-gray-50">
              <div className="text-xs font-semibold text-gray-700">Backtest Geçmişi</div>
            </div>
            {backtestRuns.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-xs text-gray-400">Henüz backtest çalışması yok</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400">
                      <th className="text-left py-1.5 px-2 font-medium">Tarih</th>
                      <th className="text-center py-1.5 px-1 font-medium">Maç</th>
                      <th className="text-center py-1.5 px-1 font-medium">Sinyal</th>
                      <th className="text-center py-1.5 px-1 font-medium">Gol</th>
                      <th className="text-center py-1.5 px-1 font-medium">Doğruluk</th>
                      <th className="text-center py-1.5 px-1 font-medium">Ort. Dk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backtestRuns.map(r => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-1.5 px-2 text-gray-700">{new Date(r.createdAt).toLocaleDateString("tr-TR")}</td>
                        <td className="text-center py-1.5 px-1 font-mono text-gray-800">{r.totalMatches}</td>
                        <td className="text-center py-1.5 px-1 font-mono text-gray-800">{r.signalsRecorded}</td>
                        <td className="text-center py-1.5 px-1 font-mono text-gray-800">{r.goalsDetected}</td>
                        <td className="text-center py-1.5 px-1 font-mono font-semibold text-gray-800">
                          {r.accuracy != null ? `${(r.accuracy * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="text-center py-1.5 px-1 font-mono text-gray-500">
                          {r.avgTimeToGoal != null ? `${r.avgTimeToGoal.toFixed(1)}dk` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
