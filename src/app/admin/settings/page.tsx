'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Settings2, ToggleLeft, SlidersHorizontal, BookOpen,
  Info, X, Check, RefreshCw, AlertTriangle,
} from 'lucide-react';

interface FeatureFlag {
  key: string; label: string; description: string;
  value: string | undefined; effectiveValue: string;
  type: 'toggle' | 'number' | 'select' | 'text';
  default: string; overridden: boolean;
  group: 'ensemble' | 'corrector' | 'rating' | 'system';
}

interface FlagMeta {
  trName: string; trDesc: string;
  status: 'active' | 'inactive' | 'stub' | 'waiting_data';
  impact: string; whyDisabled?: string;
}

const FLAG_META: Record<string, FlagMeta> = {
  STACKING_BLEND_ALPHA: {
    trName: 'Stacking Karışım',
    trDesc: 'BMA (Bayesian Model Averaging) çıktısını stacking meta-model ile harmanlar. α=0 (tam BMA) ile α=1 (tam stacking) arası. Cold-start koruması: 200+ örnek ve en az 0.4 uyum gerekir.',
    status: 'active',
    impact: 'Brier −%23.6 iyileşme. α=0.5 optimal.',
  },
  ENABLE_ONLINE_ADJUSTMENTS: {
    trName: 'Çevrimiçi Ağırlık Kayması',
    trDesc: 'Son 500 tahminin doğruluğuna göre ensemble ağırlıklarını dinamik olarak yeniden dengeler. Çalışması için yeterli üretim verisi gerekir.',
    status: 'inactive',
    impact: 'Doğruluk artışı ~%1-2. Window=2000 önerilen.',
    whyDisabled: 'Henüz yeterli prediction verisi birikmedi. 500+ gerçek maç tahmini gerekiyor.',
  },
  DISABLE_PI_RATING: {
    trName: 'Pi-Rating (Constantinou)',
    trDesc: 'Takım başına 4 ayrı rating: iç saha hücum (Ha), iç saha defans (Hd), deplasman hücum (Aa), deplasman defans (Ad). Gol farkı bazlı güncelleme.',
    status: 'active',
    impact: 'Brier 0.1992 (644 maç backfill). Ensemble\'a rating bazlı katkı.',
  },
  DISABLE_GLICKO2: {
    trName: 'Glicko-2 Rating',
    trDesc: '3 parametreli rating sistemi: r (rating), RD (rating deviation), σ (volatility). RD=350 cold-start ile başlar. Zamanla daralan güven aralığı.',
    status: 'active',
    impact: 'Rating belirsizliğini ölçer. Soğuk başlangıçlı takımlar için idealdir.',
  },
  DISABLE_GAP_RATING: {
    trName: 'Lite GAP Rating',
    trDesc: 'Genelleştirilmiş Hücum Performansı. Her takım için 4 rating. Feature verisi (dangerous_attacks, shots_on_target, corners, xG) olmadığında stub modda çalışır.',
    status: 'stub',
    impact: 'Teorik katkı: Brier iyileşmesi bekleniyor. Şu an gapP=0 döndüğü için BMA\'ya katkısı 0.',
    whyDisabled: 'Feature verisi (MatchSnapshot.statsJson) canlı yayında dolu ama ensemble.ts her seferinde sıfır state oluşturuyor. Veri beslemesi yapılınca çalışır.',
  },
  DISABLE_CORRECTOR: {
    trName: 'ZISM Corrector',
    trDesc: 'Dixon-Coles corrector (Frank\'s Copula κ veya ZISM β). Over/under ve BTTS tahminini zenginleştirir. %50 yumuşak blend ile uygulanır.',
    status: 'active',
    impact: 'BTTS %2.16 iyileşme (κ=-0.30). Over/under düzeltmesi.',
  },
  SKOR_KAPPA: {
    trName: 'Corrector Kappa (κ)',
    trDesc: 'Frank Copula korelasyon parametresi. κ<0: pozitif korelasyon (beraberlik ve düşük skorlu maçları şişirir). κ=-0.30 BTTS için optimum.',
    status: 'active',
    impact: 'κ=-0.30: BTTS −%2.16 iyileşme. Default -0.30.',
  },
  ZISM_BETA: {
    trName: 'Corrector ZISM Beta (β)',
    trDesc: 'Zero-Inflated Skellam Model şişirme parametresi. 0-0 beraberlik olasılığını yapay olarak artırır. β=0.20: daha güçlü 0-0 şişirme.',
    status: 'active',
    impact: 'Düşük skorlu maçlarda kalibrasyon iyileşmesi.',
  },
  ZISM_MODE: {
    trName: 'Corrector Modu',
    trDesc: 'Corrector çalışma modu: "frank" (Frank\'s Copula κ tabanlı) veya "zism" (Zero-Inflated Skellam β tabanlı).',
    status: 'active',
    impact: 'Frank: genel amaçlı. ZISM: 0-0 şişirmede uzman.',
  },
  BACKTEST_PERSIST_JSON: {
    trName: 'Backtest JSON Yazıcı',
    trDesc: 'Her backtest çalışmasının sonucunu data/backtest-results/*.json dosyasına yazar. Trend analizi ve shadow run karşılaştırması için kullanılır.',
    status: 'inactive',
    impact: 'Sıfır — sadece diske yazma. Performans/test aracı.',
    whyDisabled: 'Varsayılan kapalı. Sadece analiz gerektiğinde açılır.',
  },
  RADAR_THRESHOLD: {
    trName: 'Radar Eşik Değeri',
    trDesc: 'Goal Radar skoru bu değerin altındaysa sinyal oluşturulmaz. 40-80 arası. Düşük değer: çok sinyal (düşük precision). Yüksek değer: az sinyal (yüksek precision).',
    status: 'active',
    impact: 'Sinyal sayısı ve precision dengesi. 65: optimum F1. Değişiklik için deployment restart gerekir.',
  },
  SIGNAL_5MIN_THRESHOLD: {
    trName: '5-Dk Gol Olasılık Eşiği',
    trDesc: '5 dakika içinde gol olma olasılığı bu değerin altındaysa sinyal "düşük" seviyeye düşer. 0.25: optimum.',
    status: 'active',
    impact: 'Sinyal seviyelemesini belirler. Değişiklik için deployment restart gerekir.',
  },
};

const GROUP_LABELS: Record<string, string> = {
  ensemble: 'Ensemble & Stacking',
  corrector: 'Corrector (ZISM/Weibull)',
  rating: 'Rating Sistemleri',
  system: 'Sistem',
};

const GROUP_ORDER = ['ensemble', 'corrector', 'rating', 'system'] as const;

function FlagValue({ flag }: { flag: FeatureFlag }) {
  if (flag.type === 'toggle') {
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
        flag.effectiveValue === 'true'
          ? 'bg-green-100 text-green-700'
          : 'bg-gray-100 text-gray-500'
      }`}>
        <ToggleLeft className="size-3" />
        {flag.effectiveValue === 'true' ? 'AÇIK' : 'KAPALI'}
      </span>
    );
  }
  return (
    <span className="text-sm font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-1">
      {flag.effectiveValue}
    </span>
  );
}

export default function SettingsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeatureFlag | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/settings');
      const d = await r.json();
      if (d.flags) setFlags(d.flags);
      else setError('Beklenmeyen yanıt');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(async (key: string, newVal: string) => {
    setSaving(key);
    setMsg(null);
    try {
      const r = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: newVal }),
      });
      const d = await r.json();
      if (d.ok) {
        setMsg({ type: 'ok', text: `${key} → ${d.effectiveValue}` });
        await load();
      } else {
        setMsg({ type: 'err', text: d.error || 'Başarısız' });
      }
    } catch { setMsg({ type: 'err', text: 'Bağlantı hatası' }); }
    setSaving(null);
  }, [load]);

  const grouped = GROUP_ORDER.map(g => ({
    group: g,
    label: GROUP_LABELS[g],
    items: flags.filter(f => f.group === g),
  })).filter(g => g.items.length > 0);

  const activeCount = flags.filter(f => f.type === 'toggle' && f.effectiveValue === 'true').length;
  const totalToggles = flags.filter(f => f.type === 'toggle').length;

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-gray-200 rounded" />
          <div className="h-64 bg-gray-100 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
          Yüklenemedi: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Settings2 className="size-5 text-indigo-500" />
            Özellik Flagleri & Parametreler
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {activeCount}/{totalToggles} toggle aktif &middot;{' '}
            {flags.filter(f => f.type !== 'toggle' && f.overridden).length} parametre override edilmiş
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400" title="Yenile">
            <RefreshCw className="size-4" />
          </button>
          <a href="/docs/FEATURE_FLAGS.md" target="_blank"
            className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-md px-3 py-1.5 hover:bg-indigo-50 transition">
            <BookOpen className="size-3.5" /> Doküman
          </a>
        </div>
      </div>

      {/* Status message */}
      {msg && (
        <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg border ${
          msg.type === 'ok'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {msg.type === 'ok' ? <Check className="size-4" /> : <AlertTriangle className="size-4" />}
          {msg.text}
        </div>
      )}

      {/* Flag groups */}
      {grouped.map(g => (
        <div key={g.group} className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <SlidersHorizontal className="size-4 text-gray-400" />
            {g.label}
          </h2>
          <div className="grid gap-2">
            {g.items.map(flag => {
              const meta = FLAG_META[flag.key];
              const isToggle = flag.type === 'toggle';
              return (
                <div key={flag.key}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-3 flex items-start justify-between gap-4 hover:border-gray-300 transition cursor-pointer"
                  onClick={() => setSelected(flag)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                        {flag.key}
                      </code>
                      <span className="text-sm font-medium text-gray-800">
                        {meta?.trName ?? flag.label}
                      </span>
                      <FlagValue flag={flag} />
                      {flag.overridden && (
                        <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">
                          Override
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-1">
                      {meta?.trDesc ?? flag.description}
                    </p>
                    {/* Status badge */}
                    {meta && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          meta.status === 'active' ? 'bg-emerald-50 text-emerald-600' :
                          meta.status === 'inactive' ? 'bg-gray-100 text-gray-500' :
                          meta.status === 'stub' ? 'bg-amber-50 text-amber-600' :
                          'bg-blue-50 text-blue-600'
                        }`}>
                          {meta.status === 'active' ? '✅ Aktif' :
                           meta.status === 'inactive' ? '🔴 Kapalı' :
                           meta.status === 'stub' ? '🟡 Stub mod' :
                           '⚠️ Veri eksik'}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {meta.impact}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Toggle switch */}
                  {isToggle && (
                    <div className="shrink-0 flex items-center" onClick={e => e.stopPropagation()}>
                      <button
                        disabled={saving === flag.key}
                        onClick={() => toggle(flag.key, flag.effectiveValue === 'true' ? 'false' : 'true')}
                        className={`relative w-10 h-5 rounded-full transition-colors ${
                          flag.effectiveValue === 'true' ? 'bg-indigo-500' : 'bg-gray-300'
                        } ${saving === flag.key ? 'opacity-50' : ''}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                          flag.effectiveValue === 'true' ? 'translate-x-5' : ''
                        }`} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Info box */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-xs text-blue-700 leading-relaxed space-y-1.5">
        <p><strong>Not:</strong> Toggle ile değiştirilen flagler anında process.env'e yazılır ve DB'ye kaydedilir. Deployment restart'ı gerektirmez. <strong>İstisna:</strong> <code className="text-indigo-600 bg-indigo-50 px-1 rounded">RADAR_THRESHOLD</code> ve <code className="text-indigo-600 bg-indigo-50 px-1 rounded">SIGNAL_5MIN_THRESHOLD</code> config.ts sabiti olduğu için restart gerektirir.</p>
        <p>Detaylı bilgi için <a href="/docs/FEATURE_FLAGS.md" target="_blank" className="text-indigo-600 underline">FEATURE_FLAGS.md</a> dosyasına bakın.</p>
      </div>

      {/* ── Detail Modal ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Info className="size-4 text-indigo-500" />
                <span className="font-bold text-sm text-gray-800">{selected.key}</span>
              </div>
              <button onClick={() => setSelected(null)} className="p-1 rounded-md hover:bg-gray-100 text-gray-400">
                <X className="size-4" />
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-4 space-y-4">
              {(() => {
                const meta = FLAG_META[selected.key];
                return (
                  <>
                    {/* Name & current value */}
                    <div>
                      <div className="text-lg font-bold text-gray-900">{meta?.trName ?? selected.label}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{selected.key}</code>
                        <FlagValue flag={selected} />
                        {selected.overridden && (
                          <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">Override</span>
                        )}
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Açıklama</div>
                      <p className="text-sm text-gray-700 leading-relaxed">{meta?.trDesc ?? selected.description}</p>
                    </div>

                    {/* Status */}
                    {meta && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-gray-50 rounded-lg p-3">
                          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Durum</div>
                          <div className={`text-sm font-bold ${
                            meta.status === 'active' ? 'text-emerald-600' :
                            meta.status === 'inactive' ? 'text-gray-500' :
                            meta.status === 'stub' ? 'text-amber-600' : 'text-blue-600'
                          }`}>
                            {meta.status === 'active' ? '✅ Aktif' :
                             meta.status === 'inactive' ? '🔴 Kapalı' :
                             meta.status === 'stub' ? '🟡 Stub mod (0 katkı)' :
                             '⚠️ Veri eksik'}
                          </div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Sisteme Katkısı</div>
                          <div className="text-sm font-medium text-gray-700">{meta.impact}</div>
                        </div>
                      </div>
                    )}

                    {/* Why disabled */}
                    {meta?.whyDisabled && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 mb-1">
                          <AlertTriangle className="size-3.5" /> Neden Kullanılmıyor?
                        </div>
                        <p className="text-xs text-amber-800 leading-relaxed">{meta.whyDisabled}</p>
                      </div>
                    )}

                    {/* Current value detail */}
                    <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Değer Detayı</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <span className="text-gray-500">Mevcut:</span>
                        <span className="font-mono font-bold text-gray-800">{selected.effectiveValue}</span>
                        <span className="text-gray-500">Varsayılan:</span>
                        <span className="font-mono text-gray-600">{selected.default}</span>
                        <span className="text-gray-500">Tip:</span>
                        <span className="text-gray-700 capitalize">{selected.type}</span>
                        <span className="text-gray-500">Override:</span>
                        <span className={selected.overridden ? 'text-amber-600 font-medium' : 'text-gray-400'}>
                          {selected.overridden ? 'Evet (DB)' : 'Hayır'}
                        </span>
                      </div>
                    </div>

                    {/* Toggle action */}
                    {selected.type === 'toggle' && (
                      <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                        <span className="text-sm text-gray-700 font-medium">
                          {selected.effectiveValue === 'true' ? 'Şu an AÇIK' : 'Şu an KAPALI'}
                        </span>
                        <button
                          disabled={saving === selected.key}
                          onClick={() => {
                            const newVal = selected.effectiveValue === 'true' ? 'false' : 'true';
                            toggle(selected.key, newVal);
                            setSelected(null);
                          }}
                          className={`px-4 py-2 text-sm font-bold rounded-lg text-white transition ${
                            selected.effectiveValue === 'true'
                              ? 'bg-red-500 hover:bg-red-600'
                              : 'bg-indigo-500 hover:bg-indigo-600'
                          } disabled:opacity-50`}
                        >
                          {saving === selected.key ? '⏳' : selected.effectiveValue === 'true' ? 'Kapat' : 'Aç'}
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
