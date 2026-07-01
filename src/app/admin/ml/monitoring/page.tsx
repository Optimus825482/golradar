"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/adminAuth";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Activity, BarChart3, Target, Brain, Zap, Shield,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

// ── Types ──────────────────────────────────────────────────────────
interface MonitorSerie {
  date: string;
  brierScore: number | null;
  logLoss: number | null;
  accuracy: number | null;
  calibrationError: number | null;
  totalPredictions: number | null;
  totalGoals: number | null;
  gbdtBrier: number | null;
  xgbBrier: number | null;
  inPlayBrier: number | null;
}

interface DriftReport {
  recentAvgBrier: number;
  priorAvgBrier: number;
  driftPct: number | null;
  direction: "better" | "worse" | "stable";
}

interface WeightEntry {
  name: string;
  version: string;
  isChampion: boolean;
  brierScore: number | null;
  weight: number;
  tier: string;
}

interface MonitorData {
  series: MonitorSerie[];
  drift: DriftReport;
  totalDays: number;
}

// ── Helpers ────────────────────────────────────────────────────────
function fmt(v: unknown, d = "—"): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(4) : d;
}

function fmtPct(v: unknown): string {
  return typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—";
}

function fmt1(v: unknown): string {
  return typeof v === "number" ? v.toFixed(1) : "0.0";
}

const TIER_COLORS: Record<string, string> = {
  excellent: "#16a34a",
  good: "#2563eb",
  medium: "#d97706",
  poor: "#dc2626",
  unranked: "#9ca3af",
};

function tierColor(weight: number): string {
  if (weight >= 0.75) return TIER_COLORS.excellent;
  if (weight >= 0.50) return TIER_COLORS.good;
  if (weight >= 0.25) return TIER_COLORS.medium;
  return TIER_COLORS.poor;
}

function aucColor(auc: number | null | undefined): string {
  if (auc == null) return "#9ca3af";
  if (auc >= 0.80) return "#16a34a";
  if (auc >= 0.70) return "#2563eb";
  if (auc >= 0.60) return "#d97706";
  return "#dc2626";
}

// ── KPI Card ───────────────────────────────────────────────────────
function KpiCard({
  title, value, subtitle, icon: Icon, trend, loading, color,
}: {
  title: string; value: string; subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "stable"; loading?: boolean; color?: string;
}) {
  if (loading) {
    return (
      <Card><CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-16 mb-1" /><Skeleton className="h-3 w-20" /></CardContent></Card>
    );
  }
  return (
    <Card className="transition-all duration-200 ease-out hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold" style={{ color: color ?? 'inherit' }}>{value}</span>
          {trend === "up" && <TrendingUp className="size-4 text-red-500" />}
          {trend === "down" && <TrendingDown className="size-4 text-green-500" />}
        </div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function ChartSkeleton() { return <Skeleton className="h-64 w-full rounded-xl" />; }

// ── Main Page ──────────────────────────────────────────────────────
export default function MonitoringPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [mlStatus, setMlStatus] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [monRes, wtRes, mlRes] = await Promise.all([
        authFetch(`/api/admin/ml/monitoring?days=${days}`),
        authFetch("/api/admin/ml/weights"),
        authFetch("/api/admin/ml/status"),
      ]);
      if (monRes.ok) setData(await monRes.json());
      if (wtRes.ok) { const wj = await wtRes.json(); setWeights(wj.weights ?? []); }
      if (mlRes.ok) setMlStatus(await mlRes.json());
    } catch { setError("Veri alınamadı"); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derive metrics ──────────────────────────────────────────
  let series: MonitorSerie[] = [];
  let drift: DriftReport | null = null;
  let latest: MonitorSerie | null = null;
  let avgBrier7: number | null = null;
  let recent7: MonitorSerie[] = [];
  let chartSeries: MonitorSerie[] = [];
  let gbdtSeries: MonitorSerie[] = [];
  let xgbSeries: MonitorSerie[] = [];
  let inplaySeries: MonitorSerie[] = [];
  let weightChartData: { name: string; weight: number; brier: number; auc: number | null; fill: string }[] = [];
  let driftBadge: { label: string; variant: "default" | "secondary" | "destructive" | "outline" } = { label: "—", variant: "outline" };

  try {
    series = data?.series ?? [];
    drift = data?.drift ?? null;
    latest = series.length > 0 ? series[series.length - 1] : null;
    recent7 = series.slice(-7);
    avgBrier7 = recent7.length > 0
      ? recent7.reduce((s, r) => s + (typeof r.brierScore === "number" ? r.brierScore : 0), 0) / recent7.length
      : null;

    chartSeries = series.filter(s => typeof s.brierScore === "number");
    gbdtSeries = series.filter(s => typeof s.gbdtBrier === "number");
    xgbSeries = series.filter(s => typeof s.xgbBrier === "number");
    inplaySeries = series.filter(s => typeof s.inPlayBrier === "number");

    // Champion weight chart with AUC
    const champs = mlStatus?.champions ?? {};
    weightChartData = weights
      .filter(w => w.isChampion)
      .map(w => ({
        name: w.name,
        weight: +(typeof w.weight === "number" ? w.weight * 100 : 0).toFixed(1),
        brier: typeof w.brierScore === "number" ? w.brierScore : 0,
        auc: champs[w.name]?.metrics?.auc ?? null,
        fill: tierColor(typeof w.weight === "number" ? w.weight : 0),
      }));

    driftBadge = !drift
      ? { label: "—", variant: "outline" as const }
      : drift.direction === "worse"
      ? { label: `⚠ ${typeof drift.driftPct === "number" ? drift.driftPct.toFixed(1) : "0.0"}%`, variant: "destructive" as const }
      : drift.direction === "better"
      ? { label: `✓ ${typeof drift.driftPct === "number" ? drift.driftPct.toFixed(1) : "0.0"}%`, variant: "default" as const }
      : { label: "✓ Stabil", variant: "secondary" as const };
  } catch { /* fallback */ }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500 gap-2">
        <AlertTriangle className="size-5" /> {error}
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300 ease-out">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">📊 Model Başarı Monitoring</h1>
          <p className="text-sm text-gray-500">Brier, AUC, drift, ağırlık dağılımı ve champion durumu</p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90, 180].map((d) => (
            <Button key={d} variant={days === d ? "default" : "outline"} size="sm" onClick={() => setDays(d)} className="text-xs">{d}g</Button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="Bugün Brier" value={loading ? "—" : fmt(latest?.brierScore)} subtitle={latest?.date ? `(${latest.date})` : undefined} icon={Target}
          trend={avgBrier7 != null && latest?.brierScore != null && latest.brierScore > avgBrier7 ? "up" : "down"} loading={loading} />
        <KpiCard title="7g Ortalama Brier" value={loading ? "—" : avgBrier7?.toFixed(4) ?? "—"} subtitle={recent7.length > 0 ? `${recent7.length} gün` : undefined} icon={Activity}
          trend={avgBrier7 != null && avgBrier7 > 0.20 ? "up" : avgBrier7 != null && avgBrier7 <= 0.20 ? "down" : undefined} loading={loading} />
        <KpiCard title="Drift" value={driftBadge.label} icon={TrendingUp} loading={loading} />
        <KpiCard title="Toplam Tahmin" value={loading ? "—" : latest?.totalPredictions?.toLocaleString() ?? "—"}
          subtitle={latest && (latest.totalPredictions ?? 0) > 0 ? `%${(((latest.totalGoals ?? 0) / (latest.totalPredictions ?? 1)) * 100).toFixed(1)} gol oranı` : undefined} icon={BarChart3} loading={loading} />
      </div>

      {/* Champion Model Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {loading ? [...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) :
         mlStatus?.champions ? Object.entries(mlStatus.champions).map(([name, c]: [string, any]) => (
          <Card key={name} className="overflow-hidden">
            <div className="h-1" style={{ background: aucColor(c.metrics?.auc) }} />
            <CardContent className="p-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">{name}</div>
              <div className="flex items-center justify-between">
                <span className="text-lg font-black" style={{ color: aucColor(c.metrics?.auc) }}>
                  {c.metrics?.auc != null ? c.metrics.auc.toFixed(3) : '?'}
                </span>
                <span className="text-xs font-mono text-gray-500">AUC</span>
              </div>
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>B:{typeof c.metrics?.brier === 'number' ? c.metrics.brier.toFixed(4) : '?'}</span>
                <span>v{c.version?.slice(0, 12)}</span>
              </div>
            </CardContent>
          </Card>
        )) : <p className="text-sm text-gray-400 col-span-full">Champion verisi yok</p>}
      </div>

      {/* Brier Trend Chart */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Brier Score Trendi (Günlük)</CardTitle></CardHeader>
        <CardContent>
          {loading ? <ChartSkeleton /> : chartSeries.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Henüz veri yok</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartSeries} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs><linearGradient id="brierGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5) ?? ""} stroke="#9ca3af" />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} tickFormatter={(v) => fmt1(v)} stroke="#9ca3af" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                    formatter={(value: unknown) => [typeof value === 'number' ? value.toFixed(4) : String(value ?? "—"), "Brier"]} />
                  <ReferenceLine y={0.20} stroke="#16a34a" strokeDasharray="4 4" label={{ value: "Hedef 0.20", fontSize: 10, fill: "#16a34a" }} />
                  <ReferenceLine y={0.15} stroke="#059669" strokeDasharray="4 4" label={{ value: "İdeal 0.15", fontSize: 10, fill: "#059669" }} />
                  <Area type="monotone" dataKey="brierScore" stroke="#6366f1" strokeWidth={2} fill="url(#brierGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-Model Brier Comparison */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Model Bazında Brier Karşılaştırması</CardTitle></CardHeader>
        <CardContent>
          {loading ? <ChartSkeleton /> : gbdtSeries.length === 0 && xgbSeries.length === 0 && inplaySeries.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Champion modeller henüz Brier verisine sahip değil</div>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5) ?? ""} stroke="#9ca3af" allowDuplicatedCategory={false} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {gbdtSeries.length > 0 && <Line data={gbdtSeries} type="monotone" dataKey="gbdtBrier" stroke="#6366f1" strokeWidth={2} dot={false} name="GBDT" />}
                  {xgbSeries.length > 0 && <Line data={xgbSeries} type="monotone" dataKey="xgbBrier" stroke="#f59e0b" strokeWidth={2} dot={false} name="XGBoost" />}
                  {inplaySeries.length > 0 && <Line data={inplaySeries} type="monotone" dataKey="inPlayBrier" stroke="#10b981" strokeWidth={2} dot={false} name="InPlay" />}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom Grid: Weights + Drift + Shadows */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Weight Distribution */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-sm">Ensemble Ağırlıkları (Champion)</CardTitle></CardHeader>
          <CardContent>
            {loading ? <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div> :
             weightChartData.length === 0 ? <p className="text-sm text-gray-400">Henüz ağırlık verisi yok</p> :
             <div className="space-y-3">
              {weightChartData.map((w) => (
                <div key={w.name} className="flex items-center gap-2 text-sm">
                  <div className="w-16 text-xs font-medium text-gray-600 truncate">{w.name}</div>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-300 ease-out" style={{ width: `${w.weight}%`, backgroundColor: w.fill }} />
                  </div>
                  <span className="w-8 text-right text-xs font-mono text-gray-700">{w.weight.toFixed(0)}%</span>
                  <span className="w-14 text-right text-[10px] text-gray-400">A:{w.auc?.toFixed(3) ?? '?'}</span>
                </div>
              ))}
             </div>
            }
          </CardContent>
        </Card>

        {/* Drift Detail */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-sm">Drift Analizi</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {loading ? <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /></div> :
             !drift ? <p className="text-sm text-gray-400">Drift analizi için yeterli veri yok</p> :
             <>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Son 7g Ort.</span><span className="text-sm font-mono font-bold">{drift.recentAvgBrier?.toFixed(4) ?? "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Önceki 7g Ort.</span><span className="text-sm font-mono">{drift.priorAvgBrier?.toFixed(4) ?? "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Yön</span><Badge variant={driftBadge.variant}>{driftBadge.label}</Badge></div>
              {drift.direction === "worse" && (
                <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-md px-2 py-1.5"><AlertTriangle className="size-3.5 shrink-0" />Model performansı düşüyor. Kalibrasyon veya retrain gerekebilir.</div>
              )}
              {drift.direction === "better" && (
                <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 rounded-md px-2 py-1.5"><CheckCircle2 className="size-3.5 shrink-0" />Model iyileşiyor.</div>
              )}
             </>
            }
          </CardContent>
        </Card>

        {/* Shadow + Champion Status */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-sm">Model Durumu</CardTitle></CardHeader>
          <CardContent>
            {loading ? <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div> :
             <div className="space-y-2">
              {["gbdt", "xgb", "inplay", "lightgbm", "team-strength"].map((model) => {
                const w = weights.find((x) => x.name === model && x.isChampion);
                const champ = mlStatus?.champions?.[model];
                const auc = champ?.metrics?.auc ?? null;
                return (
                  <div key={model} className="flex items-center justify-between text-sm p-1.5 rounded hover:bg-gray-50">
                    <span className="text-xs font-medium text-gray-600 capitalize">{model}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono" style={{ color: aucColor(auc) }}>A:{auc?.toFixed(3) ?? '?'}</span>
                      <span className="text-[10px] text-gray-400">B:{fmt(w?.brierScore)}</span>
                      {w?.isChampion ? <Badge variant="default" className="text-[9px] px-1 py-0">⭐</Badge> : <Badge variant="secondary" className="text-[9px] px-1 py-0">Shadow</Badge>}
                    </div>
                  </div>
                );
              })}
             </div>
            }
          </CardContent>
        </Card>
      </div>

      {/* Daily Detail Table */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Günlük Detay Tablosu</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-40 w-full rounded-lg" /> : series.length === 0 ? <p className="text-sm text-gray-400">Henüz veri yok</p> :
           <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-3 font-medium">Tarih</th>
                  <th className="py-2 pr-3 font-medium">Brier</th>
                  <th className="py-2 pr-3 font-medium">LogLoss</th>
                  <th className="py-2 pr-3 font-medium">Doğruluk</th>
                  <th className="py-2 pr-3 font-medium">Kal. Hata</th>
                  <th className="py-2 pr-3 font-medium">Tahmin</th>
                  <th className="py-2 pr-3 font-medium">GBDT</th>
                  <th className="py-2 pr-3 font-medium">XGB</th>
                  <th className="py-2 pr-3 font-medium">InPlay</th>
                </tr>
              </thead>
              <tbody>
                {[...series].reverse().slice(0, 30).map((s) => (
                  <tr key={s.date} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-2 pr-3 font-medium text-gray-800">{s.date}</td>
                    <td className={`py-2 pr-3 font-mono ${(s.brierScore ?? 1) > 0.20 ? 'text-red-600' : 'text-green-600'}`}>{fmt(s.brierScore)}</td>
                    <td className="py-2 pr-3 font-mono text-gray-600">{fmt(s.logLoss)}</td>
                    <td className="py-2 pr-3 font-mono text-gray-600">{fmtPct(s.accuracy)}</td>
                    <td className="py-2 pr-3 font-mono text-gray-600">{fmt(s.calibrationError)}</td>
                    <td className="py-2 pr-3 font-mono text-gray-600">{s.totalPredictions?.toLocaleString() ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-gray-600">{fmt(s.gbdtBrier)}</td>
                    <td className="py-2 pr-3 font-mono text-gray-600">{fmt(s.xgbBrier)}</td>
                    <td className="py-2 pr-3 font-mono text-gray-600">{fmt(s.inPlayBrier)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
           </div>
          }
        </CardContent>
      </Card>
    </div>
  );
}
