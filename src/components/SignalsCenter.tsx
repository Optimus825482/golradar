"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { logError } from "@/lib/devLog";
import type { GoalSignalRecord, SignalAccuracyStats } from "@/lib/goalSignalTracker";
import type { Match } from "@/components/match/types";

interface SignalsCenterProps {
  matches: Match[];
  onSelectMatch: (match: Match) => void;
}

type PeriodType = "1" | "7" | "30" | "90";
type FilterType = "all" | "success" | "failed" | "pending";

// ── Helpers ────────────────────────────────────────────────────
const fmtDate = (ts: number | null | undefined): string => {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const fmtDateShort = (ts: number | null | undefined): string => {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
  });
};

const asPct = (v: number | null | undefined, d = 0): string =>
  v == null ? "-" : `${(v * 100).toFixed(d)}%`;

// ── Status / Side / Level helpers ──────────────────────────────
const statusBadge = (s: GoalSignalRecord) => {
  if (s.goalHappened === null)
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold border border-gray-200">
        ⏳ Bekliyor
      </span>
    );
  if (s.goalHappened === true && s.correctPrediction === true)
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold border border-emerald-200">
        ✓ Gol
      </span>
    );
  if (s.goalHappened === true && s.correctPrediction === false)
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold border border-amber-200">
        ! Yanlış Yön
      </span>
    );
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold border border-red-200">
      ✗ Gol Yok
    </span>
  );
};

const sideBadge = (s: GoalSignalRecord) => {
  const isHome = s.signalSide === "home";
  const baseLabel = isHome ? "Ev" : "Dep";

  // Goal happened: green if correct, red if wrong
  if (s.goalHappened === true) {
    const correct = s.correctPrediction === true;
    return (
      <span
        className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
          correct
            ? "bg-emerald-100 text-emerald-700 border-emerald-300"
            : "bg-red-100 text-red-700 border-red-300"
        }`}
        title={correct ? "Doğru yön" : "Yanlış yön"}
      >
        {correct ? "✓" : "✗"} {baseLabel}
      </span>
    );
  }

  // Pending: orange/blue (no result yet)
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
        isHome
          ? "bg-orange-50 text-orange-700 border-orange-200"
          : "bg-blue-50 text-blue-700 border-blue-200"
      }`}
    >
      {baseLabel}
    </span>
  );
};

const levelBadge = (level: GoalSignalRecord["signalLevel"]) => {
  const map: Record<string, string> = {
    low: "bg-gray-100 text-gray-500 border-gray-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    high: "bg-orange-100 text-orange-700 border-orange-200",
    critical: "bg-red-100 text-red-700 border-red-200",
  };
  return (
    <span
      className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase border ${map[level] || map.low}`}
    >
      {level}
    </span>
  );
};

export default function SignalsCenter({ matches, onSelectMatch }: SignalsCenterProps) {
  const [signals, setSignals] = useState<GoalSignalRecord[]>([]);
  const [stats, setStats] = useState<SignalAccuracyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodType>("30");
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchTeam, setSearchTeam] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  const fetchSignals = useCallback(async () => {
    try {
      const resp = await fetch(`/api/goal-signals?action=stats&days=${period}`);
      if (resp.ok) {
        const data = await resp.json();
        setSignals(data.recentSignals || []);
        setStats(data as SignalAccuracyStats);
        setError(null);
      } else {
        setError(`API hatası: ${resp.status}`);
      }
    } catch (e) {
      logError("SignalsCenter", e);
      setError("Veri alınamadı.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  useEffect(() => {
    const i = setInterval(fetchSignals, 20000);
    return () => clearInterval(i);
  }, [fetchSignals]);

  useEffect(() => {
    const handler = () => fetchSignals();
    window.addEventListener("goal-scored", handler);
    return () => window.removeEventListener("goal-scored", handler);
  }, [fetchSignals]);

  // ── Filtered list ────────────────────────────────────────────
  const filteredSignals = useMemo(() => {
    return signals.filter((s) => {
      if (filter === "success" && s.goalHappened !== true) return false;
      if (filter === "failed" && s.goalHappened !== false) return false;
      if (filter === "pending" && s.goalHappened !== null) return false;
      if (searchTeam) {
        const q = searchTeam.toLowerCase();
        if (!s.homeTeam.toLowerCase().includes(q) && !s.awayTeam.toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [signals, filter, searchTeam]);

  // ── Click handler: open MatchDetail ──────────────────────────
  const handleSelectSignal = useCallback(
    async (s: GoalSignalRecord) => {
      // 1) Prefer live match (full data)
      const live = matches.find((m) => m.code === s.matchCode);
      if (live) {
        onSelectMatch(live);
        return;
      }
      // 2) Fall back: try scoremer for finished match
      try {
        const map = await fetch(
          `/api/scoremer?action=mapping&matches=${encodeURIComponent(
            JSON.stringify([
              { code: s.matchCode, home: s.homeTeam, away: s.awayTeam, time: s.matchTime },
            ]),
          )}`,
        ).then((r) => (r.ok ? r.json() : null));
        const scoremerId = map?.mappings?.[0]?.scoremerId;
        const params = new URLSearchParams({
          action: "details",
          matchCode: String(s.matchCode),
          home: s.homeTeam,
          away: s.awayTeam,
          time: s.matchTime,
        });
        if (scoremerId) params.set("scoremerId", scoremerId);
        const resp = await fetch(`/api/scoremer?${params.toString()}`);
        const data = resp.ok ? await resp.json() : null;
        const stats = data?.stats || {};
        const finalHome =
          s.finalHomeScore ?? data?.stats?.score?.home ?? s.currentHomeGoals ?? 0;
        const finalAway =
          s.finalAwayScore ?? data?.stats?.score?.away ?? s.currentAwayGoals ?? 0;
        const synthetic: Match = {
          code: s.matchCode,
          bid: 0,
          league: s.league,
          leagueId: 0,
          home: s.homeTeam,
          away: s.awayTeam,
          homeTr: s.homeTeam,
          awayTr: s.awayTeam,
          homeGoals: finalHome,
          awayGoals: finalAway,
          firstHalfScore: "-",
          minute: s.goalMinute != null ? `${s.goalMinute}` : "MS",
          status: 0,
          statusText: "Bitti",
          time: s.matchTime,
          isLive: false,
          isFinished: true,
          country: "",
          stats,
          hasStats: Object.keys(stats).length > 0,
          homeColor: null,
          awayColor: null,
          homeAbbrev: null,
          awayAbbrev: null,
          homeLogoUrl: null,
          awayLogoUrl: null,
          homeRedCards: 0,
          awayRedCards: 0,
        };
        onSelectMatch(synthetic);
      } catch (e) {
        logError("SignalsCenter.select", e);
      }
    },
    [matches, onSelectMatch],
  );

  // ── Stats for KPIs / charts ──────────────────────────────────
  const total = signals.length;
  const success = signals.filter((s) => s.goalHappened === true).length;
  const failed = signals.filter((s) => s.goalHappened === false).length;
  const pending = signals.filter((s) => s.goalHappened === null).length;
  const correct = signals.filter((s) => s.correctPrediction === true).length;
  const resolved = success + failed;
  const accuracyRate = resolved > 0 ? correct / resolved : 0;
  const goalRate = resolved > 0 ? success / resolved : 0;

  const gp = stats?.goalPrimary;
  const successRate = gp?.successRate ?? 0;
  const avgMinutes = stats?.avgMinutesAfterSignal ?? 0;
  const medianMinutes = stats?.medianMinutesAfterSignal ?? 0;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full mb-3" />
        <p className="text-xs text-gray-500">Sinyaller yükleniyor…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center bg-red-50 rounded-xl border border-red-200 mx-3 my-6">
        <div className="text-3xl mb-2">⚠️</div>
        <p className="text-sm font-semibold text-red-700 mb-1">Yükleme hatası</p>
        <p className="text-xs text-red-500 mb-3">{error}</p>
        <button
          onClick={fetchSignals}
          className="text-xs px-4 py-1.5 bg-red-100 text-red-700 rounded-full hover:bg-red-200 font-medium"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-3 space-y-4 pb-24">
      {/* ── Period Switcher ────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
          {(["1", "7", "30", "90"] as PeriodType[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-[11px] px-3 py-1.5 rounded-md font-semibold transition-all ${
                period === p
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {p === "1" ? "24s" : `${p}g`}
            </button>
          ))}
        </div>
        <div className="ml-auto text-[10px] text-gray-400 font-medium">
          {total} sinyal · {resolved} çözülmüş · {pending} bekliyor
        </div>
      </div>

      {/* ── Hero KPIs ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <HeroKPI
          label="Başarı Oranı"
          value={asPct(successRate, 0)}
          sub={`${gp ? gp.excellent + gp.good + gp.late : 0}/${resolved} çözülmüş`}
          color={
            successRate >= 0.6
              ? "#10b981"
              : successRate >= 0.4
                ? "#f59e0b"
                : "#ef4444"
          }
          icon="🏆"
        />
        <HeroKPI
          label="Gol %"
          value={asPct(goalRate, 0)}
          sub={`${success} gol / ${resolved}`}
          color={
            goalRate >= 0.4
              ? "#10b981"
              : goalRate >= 0.25
                ? "#f59e0b"
                : "#ef4444"
          }
          icon="⚽"
        />
        <HeroKPI
          label="Ort. Süre"
          value={avgMinutes ? `${avgMinutes.toFixed(1)}dk` : "-"}
          sub={`Medyan: ${medianMinutes}dk`}
          color="#3b82f6"
          icon="⏱️"
        />
        <HeroKPI
          label="Yön Doğruluğu"
          value={asPct(stats?.sideAccuracy?.rate ?? 0, 0)}
          sub={`${stats?.sideAccuracy?.correct ?? 0}/${(stats?.sideAccuracy?.correct ?? 0) + (stats?.sideAccuracy?.incorrect ?? 0)}`}
          color="#6366f1"
          icon="🎯"
        />
      </div>

      <Tabs defaultValue="signals">
        <TabsList className="bg-gray-100 border-0 h-9 w-full grid grid-cols-3">
          <TabsTrigger
            value="charts"
            className="text-xs data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-sm"
          >
            📊 Grafikler
          </TabsTrigger>
          <TabsTrigger
            value="signals"
            className="text-xs data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-sm"
          >
            📋 Sinyaller
          </TabsTrigger>
          <TabsTrigger
            value="insights"
            className="text-xs data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-sm"
          >
            💡 Detaylı Metrikler
          </TabsTrigger>
        </TabsList>

        {/* ═══ TAB 1: Grafikler ═══ */}
        <TabsContent value="charts" className="mt-3 space-y-3">
          <TimeToGoalChart gp={gp} resolved={resolved} />
          <CalibrationChart signals={signals} />
          <SideAccuracyChart signals={signals} />
          <DailyTrendChart signals={signals} />
        </TabsContent>

        {/* ═══ TAB 2: Sinyal Listesi ═══ */}
        <TabsContent value="signals" className="mt-3 space-y-3">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {(["all", "success", "failed", "pending"] as FilterType[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[11px] px-3 py-1.5 rounded-full font-semibold transition-all ${
                    filter === f
                      ? f === "success"
                        ? "bg-emerald-500 text-white shadow-sm"
                        : f === "failed"
                          ? "bg-red-500 text-white shadow-sm"
                          : f === "pending"
                            ? "bg-amber-500 text-white shadow-sm"
                            : "bg-indigo-500 text-white shadow-sm"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {f === "all"
                    ? "Tümü"
                    : f === "success"
                      ? "✓ Başarılı"
                      : f === "failed"
                        ? "✗ Başarısız"
                        : "⏳ Bekleyen"}
                </button>
              ))}
            </div>
          </div>

          <input
            type="text"
            placeholder="Takım ara..."
            value={searchTeam}
            onChange={(e) => setSearchTeam(e.target.value)}
            className="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />

          {pending > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 rounded-lg border border-indigo-100">
              <button
                onClick={async () => {
                  setChecking(true);
                  setCheckResult(null);
                  try {
                    const resp = await fetch("/api/goal-signals", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "checkPending" }),
                    });
                    if (resp.ok) {
                      const data = await resp.json();
                      setCheckResult(
                        `${data.expired} sinyal güncellendi, ${data.stillPending} bekliyor`,
                      );
                      fetchSignals();
                    }
                  } catch (e) {
                    logError("SignalsCenter", e);
                  } finally {
                    setChecking(false);
                  }
                }}
                disabled={checking}
                className="text-[11px] px-3 py-1.5 rounded-md bg-indigo-500 text-white font-semibold hover:bg-indigo-600 disabled:opacity-50"
              >
                {checking ? "Kontrol ediliyor…" : `Bekleyenleri Kontrol Et (${pending})`}
              </button>
              {checkResult && <span className="text-[10px] text-gray-600">{checkResult}</span>}
            </div>
          )}

          {/* ── Signal Cards ───────────────────────────────────── */}
          <div className="space-y-2">
            {filteredSignals.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-xs bg-white rounded-xl border border-gray-200">
                {signals.length === 0
                  ? "Henüz sinyal kaydı yok. Canlı maçlarda gol ihtimali %60+ olduğunda otomatik kayıt başlar."
                  : "Filtreye uygun sinyal yok."}
              </div>
            ) : (
              filteredSignals.slice(0, 100).map((s, i) => (
                <SignalCard
                  key={`${s.matchCode}-${s.signalTimestamp}-${i}`}
                  s={s}
                  onClick={() => handleSelectSignal(s)}
                />
              ))
            )}
            {filteredSignals.length > 100 && (
              <div className="text-center text-[10px] text-gray-400 pt-2">
                +{filteredSignals.length - 100} sinyal daha var. Filtre kullanarak daraltın.
              </div>
            )}
          </div>
        </TabsContent>

        {/* ═══ TAB 3: Detaylı Metrikler ═══ */}
        <TabsContent value="insights" className="mt-3 space-y-3">
          <DetailedMetrics stats={stats} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════

function HeroKPI({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">
          {label}
        </span>
        <span className="text-base">{icon}</span>
      </div>
      <div className="text-2xl font-black" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[9px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function SignalCard({ s, onClick }: { s: GoalSignalRecord; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all overflow-hidden group"
    >
      {/* Top: Match title + status */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-800 truncate">
              {s.homeTeam}
            </span>
            <span className="text-xs text-gray-400 font-mono">vs</span>
            <span className="text-sm font-bold text-gray-800 truncate">
              {s.awayTeam}
            </span>
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {s.league} · {fmtDate(s.signalTimestamp)}
          </div>
          {(s.finalHomeScore != null || s.finalAwayScore != null || s.currentHomeGoals != null) && (
            <div className="text-[10px] font-mono font-bold text-gray-700 mt-0.5">
              MS: {s.currentHomeGoals ?? s.finalHomeScore ?? 0}-{s.currentAwayGoals ?? s.finalAwayScore ?? 0}
            </div>
          )}
        </div>
        {statusBadge(s)}
      </div>

      {/* Middle: Metrics */}
      <div className="px-3 py-2.5 grid grid-cols-4 gap-2 items-center">
        <div className="text-center">
          <div className="text-[9px] text-gray-400 uppercase font-semibold">Dk</div>
          <div className="text-base font-black text-gray-800 font-mono">
            {s.signalMinute}
            <span className="text-[10px] text-gray-400">'</span>
          </div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-gray-400 uppercase font-semibold">Skor</div>
          <div className="text-base font-black text-indigo-600 font-mono">
            {s.signalScore}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-gray-400 uppercase font-semibold">Yön</div>
          <div className="mt-0.5 flex justify-center">{sideBadge(s)}</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-gray-400 uppercase font-semibold">Seviye</div>
          <div className="mt-0.5 flex justify-center">{levelBadge(s.signalLevel)}</div>
        </div>
      </div>

      {/* Bottom: Goal outcome + factors */}
      <div className="px-3 py-2 bg-gray-50 flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-3 text-gray-500">
          {s.goalHappened != null && (
            <span className="font-mono">
              {s.goalHappened ? (
                <>
                  <span className="text-emerald-600 font-bold">⚽ {s.goalMinute}</span>
                  <span className="text-gray-400">'</span>
                  <span className="ml-1 text-gray-400">
                    ({s.minutesAfterSignal ?? 0}dk sonra)
                  </span>
                </>
              ) : (
                <span className="text-gray-400">Gol yok</span>
              )}
            </span>
          )}
          {s.goalHappened === null && (
            <span className="text-amber-500 font-medium animate-pulse">
              ⏳ Bekleniyor…
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 max-w-[60%] overflow-hidden">
          {(s.activeFactors || []).slice(0, 3).map((f, i) => (
            <span
              key={i}
              className="bg-indigo-50 text-indigo-600 text-[9px] px-1.5 py-0.5 rounded font-medium border border-indigo-100 truncate max-w-[80px]"
            >
              {f}
            </span>
          ))}
          {(s.activeFactors || []).length > 3 && (
            <span className="text-[9px] text-gray-400 font-semibold">
              +{s.activeFactors.length - 3}
            </span>
          )}
        </div>
        <svg
          className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}

// ── Grafik 1: Time-to-Goal Distribution ──────────────────────────
function TimeToGoalChart({
  gp,
  resolved,
}: {
  gp: SignalAccuracyStats["goalPrimary"] | undefined;
  resolved: number;
}) {
  if (!gp || resolved === 0) {
    return (
      <ChartEmpty msg="Henüz çözülmüş sinyal yok. Canlı maçları bekleyin." />
    );
  }

  const segments = [
    { key: "excellent", label: "Excellent", desc: "≤ 5dk", count: gp.excellent, rate: gp.excellentRate, color: "#22c55e" },
    { key: "good", label: "Good", desc: "5-10dk", count: gp.good, rate: gp.goodRate, color: "#16a34a" },
    { key: "late", label: "Late", desc: "10-15dk", count: gp.late, rate: gp.lateRate, color: "#f59e0b" },
    { key: "fail", label: "Fail", desc: "Gol Yok", count: gp.fail, rate: gp.failRate, color: "#ef4444" },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">
          ⏱️ Gol Zamanı Dağılımı
        </h4>
        <span className="text-[10px] text-gray-400">{resolved} çözülmüş sinyal</span>
      </div>
      {/* Big stacked bar */}
      <div className="h-9 rounded-full overflow-hidden bg-gray-100 flex mb-3 shadow-inner">
        {segments.map((s) =>
          s.rate > 0 ? (
            <div
              key={s.key}
              className="h-full relative group transition-all"
              style={{ width: `${s.rate * 100}%`, background: s.color }}
            >
              {s.rate >= 0.07 && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white font-bold drop-shadow-sm">
                  {(s.rate * 100).toFixed(0)}%
                </span>
              )}
            </div>
          ) : null,
        )}
      </div>
      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {segments.map((s) => (
          <div
            key={s.key}
            className="rounded-lg p-2.5 text-center border transition-all hover:shadow-sm"
            style={{ borderColor: `${s.color}30`, background: `${s.color}08` }}
          >
            <div className="text-lg font-black" style={{ color: s.color }}>
              {s.count}
            </div>
            <div className="text-[10px] font-bold text-gray-700">{s.label}</div>
            <div className="text-[9px] text-gray-400">{s.desc}</div>
            <div className="text-[10px] font-bold mt-0.5" style={{ color: s.color }}>
              {(s.rate * 100).toFixed(0)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Grafik 2: Calibration scatter (tahmin vs gözlem) ─────────────
function CalibrationChart({ signals }: { signals: GoalSignalRecord[] }) {
  const buckets = useMemo(() => {
    const ranges = [
      { label: "0-60", min: 0, max: 60 },
      { label: "60-70", min: 60, max: 70 },
      { label: "70-80", min: 70, max: 80 },
      { label: "80-90", min: 80, max: 90 },
      { label: "90-100", min: 90, max: 100 },
    ];
    return ranges.map((r) => {
      const inRange = signals.filter(
        (s) => s.signalScore >= r.min && s.signalScore < r.max && s.goalHappened !== null,
      );
      const goals = inRange.filter((s) => s.goalHappened === true).length;
      const total = inRange.length;
      return {
        ...r,
        total,
        goals,
        goalRate: total > 0 ? goals / total : 0,
        predictedMid: (r.min + r.max) / 2 / 100,
      };
    });
  }, [signals]);

  const maxY = 1;
  const W = 600,
    H = 220,
    padL = 36,
    padR = 16,
    padT = 14,
    padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xFor = (v: number) => padL + v * innerW;
  const yFor = (v: number) => padT + (1 - v) * innerH;

  const hasData = buckets.some((b) => b.total > 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">
          🎯 Kalibrasyon (Tahmin vs Gerçek)
        </h4>
        <span className="text-[10px] text-gray-400">İdeal = Diyagonal çizgi</span>
      </div>
      {!hasData ? (
        <ChartEmpty msg="Çözülmüş sinyal yok." />
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            {/* Grid */}
            {[0, 0.25, 0.5, 0.75, 1].map((g) => (
              <g key={g}>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={yFor(g)}
                  y2={yFor(g)}
                  stroke="#f1f5f9"
                  strokeWidth={1}
                />
                <text
                  x={padL - 6}
                  y={yFor(g) + 3}
                  fontSize={9}
                  fill="#94a3b8"
                  textAnchor="end"
                >
                  {(g * 100).toFixed(0)}%
                </text>
              </g>
            ))}
            {/* Diagonal (ideal) */}
            <line
              x1={xFor(0)}
              y1={yFor(0)}
              x2={xFor(1)}
              y2={yFor(1)}
              stroke="#cbd5e1"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            {/* Bars */}
            {buckets.map((b, i) => {
              const x0 = xFor(b.predictedMid - 0.08);
              const x1 = xFor(b.predictedMid + 0.08);
              const y = yFor(b.goalRate);
              const fill = b.goalRate > b.predictedMid + 0.1
                ? "#10b981"
                : b.goalRate < b.predictedMid - 0.1
                  ? "#ef4444"
                  : "#6366f1";
              return (
                <g key={i}>
                  <rect
                    x={x0}
                    y={y}
                    width={x1 - x0}
                    height={H - padB - y}
                    fill={fill}
                    opacity={0.8}
                    rx={2}
                  />
                  {b.total > 0 && (
                    <text
                      x={(x0 + x1) / 2}
                      y={y - 3}
                      fontSize={9}
                      fill={fill}
                      textAnchor="middle"
                      fontWeight="bold"
                    >
                      {(b.goalRate * 100).toFixed(0)}%
                    </text>
                  )}
                  <text
                    x={(x0 + x1) / 2}
                    y={H - padB + 14}
                    fontSize={9}
                    fill="#64748b"
                    textAnchor="middle"
                  >
                    {b.label}
                  </text>
                  <text
                    x={(x0 + x1) / 2}
                    y={H - padB + 24}
                    fontSize={8}
                    fill="#94a3b8"
                    textAnchor="middle"
                  >
                    n={b.total}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="flex items-center justify-center gap-3 text-[9px] text-gray-500 mt-1">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-emerald-500" /> Üstünde (agresif)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-indigo-500" /> Kalibre
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-red-500" /> Altında (muhafazakâr)
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Grafik 3: Side (Ev/Dep) Distribution ─────────────────────────
function SideAccuracyChart({ signals }: { signals: GoalSignalRecord[] }) {
  const resolved = signals.filter((s) => s.goalHappened !== null);

  const homeSignals = resolved.filter((s) => s.signalSide === "home");
  const awaySignals = resolved.filter((s) => s.signalSide === "away");

  const homeGoals = homeSignals.filter((s) => s.goalHappened).length;
  const awayGoals = awaySignals.filter((s) => s.goalHappened).length;
  const homeCorrect = homeSignals.filter((s) => s.correctPrediction === true).length;
  const awayCorrect = awaySignals.filter((s) => s.correctPrediction === true).length;

  const homeRate = homeSignals.length > 0 ? homeGoals / homeSignals.length : 0;
  const awayRate = awaySignals.length > 0 ? awayGoals / awaySignals.length : 0;
  const homeDirRate =
    homeSignals.filter((s) => s.goalHappened === true).length > 0
      ? homeCorrect / homeSignals.filter((s) => s.goalHappened === true).length
      : 0;
  const awayDirRate =
    awaySignals.filter((s) => s.goalHappened === true).length > 0
      ? awayCorrect / awaySignals.filter((s) => s.goalHappened === true).length
      : 0;

  if (resolved.length === 0) {
    return <ChartEmpty msg="Henüz taraf verisi yok." />;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">
        🏠 Ev / ✈️ Dep Performansı
      </h4>
      <div className="grid grid-cols-2 gap-3">
        <SideBar
          label="Ev Sahibi"
          side="home"
          total={homeSignals.length}
          goals={homeGoals}
          correct={homeCorrect}
          goalRate={homeRate}
          directionRate={homeDirRate}
          color="#f97316"
        />
        <SideBar
          label="Deplasman"
          side="away"
          total={awaySignals.length}
          goals={awayGoals}
          correct={awayCorrect}
          goalRate={awayRate}
          directionRate={awayDirRate}
          color="#3b82f6"
        />
      </div>
    </div>
  );
}

function SideBar({
  label,
  side,
  total,
  goals,
  correct,
  goalRate,
  directionRate,
  color,
}: {
  label: string;
  side: "home" | "away";
  total: number;
  goals: number;
  correct: number;
  goalRate: number;
  directionRate: number;
  color: string;
}) {
  const wrong = total - goals;
  const goalPct = (goalRate * 100).toFixed(0);
  return (
    <div className="rounded-lg p-3 border" style={{ borderColor: `${color}40`, background: `${color}08` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-gray-700">{label}</span>
        <span className="text-[10px] text-gray-500">{total} sinyal</span>
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-2xl font-black" style={{ color }}>
          {goalPct}%
        </span>
        <span className="text-[10px] text-gray-500">
          gol ({goals}/{total})
        </span>
      </div>
      {/* Stacked bar: goal vs no-goal */}
      <div className="h-3 rounded-full overflow-hidden bg-gray-100 flex mb-2">
        <div
          className="h-full transition-all"
          style={{ width: `${goalRate * 100}%`, background: color }}
        />
        <div
          className="h-full bg-gray-300"
          style={{ width: `${(1 - goalRate) * 100}%` }}
        />
      </div>
      {/* Direction accuracy */}
      <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
        <span>Yön:</span>
        <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-400"
            style={{ width: `${directionRate * 100}%` }}
          />
        </div>
        <span className="font-bold text-gray-700">{(directionRate * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ── Grafik 4: Daily Trend (son 14 gün) ────────────────────────────
function DailyTrendChart({ signals }: { signals: GoalSignalRecord[] }) {
  const daily = useMemo(() => {
    const map = new Map<string, { total: number; goals: number; correct: number }>();
    for (const s of signals) {
      const day = fmtDateShort(s.signalTimestamp);
      const cur = map.get(day) || { total: 0, goals: 0, correct: 0 };
      cur.total++;
      if (s.goalHappened === true) cur.goals++;
      if (s.correctPrediction === true) cur.correct++;
      map.set(day, cur);
    }
    return Array.from(map.entries())
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-14);
  }, [signals]);

  if (daily.length === 0) {
    return <ChartEmpty msg="Henüz günlük veri yok." />;
  }

  const maxTotal = Math.max(...daily.map((d) => d.total), 1);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">
        📅 Son 14 Gün Aktivitesi
      </h4>
      <div className="space-y-1.5">
        {daily.map((d) => (
          <div key={d.day} className="flex items-center gap-2 text-[10px]">
            <span className="w-12 text-gray-500 font-mono shrink-0">{d.day}</span>
            <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden flex">
              <div
                className="h-full bg-emerald-400 flex items-center justify-center text-[9px] text-white font-bold"
                style={{ width: `${(d.goals / maxTotal) * 100}%` }}
              >
                {d.goals > 0 && d.goals}
              </div>
              <div
                className="h-full bg-blue-200"
                style={{ width: `${((d.total - d.goals) / maxTotal) * 100}%` }}
              />
            </div>
            <span className="w-10 text-right text-gray-700 font-mono font-semibold">
              {d.total}
            </span>
            <span className="w-12 text-right text-emerald-600 font-bold font-mono">
              {((d.goals / Math.max(1, d.total)) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 text-[9px] text-gray-500 mt-2 justify-end">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-emerald-400" /> Gol
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-blue-200" /> Gol yok
        </span>
      </div>
    </div>
  );
}

// ── Detaylı Metrikler Paneli ──────────────────────────────────────
function DetailedMetrics({ stats }: { stats: SignalAccuracyStats | null }) {
  if (!stats) return <ChartEmpty msg="Veri yüklenmedi." />;
  const gp = stats.goalPrimary;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">
          🥇 Birincil Metrikler
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
          <Row label="🏆 Excellent (≤5dk)" value={gp.excellent} color="#22c55e" />
          <Row label="✅ Good (5-10dk)" value={gp.good} color="#16a34a" />
          <Row label="👍 Late (10-15dk)" value={gp.late} color="#f59e0b" />
          <Row label="❌ Fail" value={gp.fail} color="#ef4444" />
          <Row label="Başarı Oranı" value={asPct(gp.successRate)} color="#6366f1" />
          <Row label="Excellent %" value={asPct(gp.excellentRate)} color="#22c55e" />
          <Row label="Good %" value={asPct(gp.goodRate)} color="#16a34a" />
          <Row label="Late %" value={asPct(gp.lateRate)} color="#f59e0b" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">
          🥈 İkincil Metrikler
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
          <Row label="Doğru Yön" value={stats.sideAccuracy?.correct ?? 0} color="#10b981" />
          <Row label="Yanlış Yön" value={stats.sideAccuracy?.incorrect ?? 0} color="#ef4444" />
          <Row label="Yön Doğruluğu" value={asPct(stats.sideAccuracy?.rate)} color="#6366f1" />
          <Row label="Klasik Doğruluk" value={asPct(stats.accuracyRate)} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">
          📐 Kalibrasyon & Süre
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
          <Row label="Brier Score" value={stats.brierScore.toFixed(4)} color={stats.brierScore < 0.2 ? "#10b981" : stats.brierScore < 0.3 ? "#f59e0b" : "#ef4444"} />
          <Row label="Kalibrasyon Hatası" value={asPct(stats.calibrationError)} />
          <Row label="Ort. Tahmin P" value={asPct(stats.avgPredictedP)} />
          <Row label="Ort. Gözlem P" value={asPct(stats.avgObservedP)} />
          <Row label="Ort. Süre" value={stats.avgMinutesAfterSignal ? `${stats.avgMinutesAfterSignal.toFixed(1)}dk` : "-"} />
          <Row label="Medyan Süre" value={stats.medianMinutesAfterSignal ? `${stats.medianMinutesAfterSignal}dk` : "-"} />
          <Row label="En Hızlı" value={stats.minMinutesAfterSignal ? `${stats.minMinutesAfterSignal}dk` : "-"} color="#22c55e" />
          <Row label="En Geç" value={stats.maxMinutesAfterSignal ? `${stats.maxMinutesAfterSignal}dk` : "-"} color="#f59e0b" />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 px-2 rounded bg-gray-50 border border-gray-100">
      <span className="text-[9px] text-gray-500">{label}</span>
      <span className="text-sm font-bold" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

function ChartEmpty({ msg }: { msg: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
      <div className="text-2xl mb-1 opacity-30">📊</div>
      <p className="text-xs text-gray-400">{msg}</p>
    </div>
  );
}
