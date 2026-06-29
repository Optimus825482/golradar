'use client';

import { useEffect, useState } from 'react';
import {
  Settings2,
  ToggleLeft,
  SlidersHorizontal,
  BookOpen,
} from 'lucide-react';

interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  value: string | undefined;
  type: 'toggle' | 'number' | 'select' | 'text';
  default: string;
  group: 'ensemble' | 'corrector' | 'rating' | 'system';
}

const GROUP_LABELS: Record<string, string> = {
  ensemble: 'Ensemble & Stacking',
  corrector: 'Corrector (ZISM/Weibull)',
  rating: 'Rating Sistemleri',
  system: 'Sistem',
};

const GROUP_ORDER = ['ensemble', 'corrector', 'rating', 'system'] as const;

export default function SettingsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data.flags) setFlags(data.flags);
        else setError('Unexpected response');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    items: flags.filter((f) => f.group === group),
  })).filter((g) => g.items.length > 0);

  const activeCount = flags.filter((f) => f.value === 'true').length;
  const totalToggles = flags.filter((f) => f.type === 'toggle').length;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Settings2 className="size-5 text-indigo-500" />
            Özellik Flag'leri & Parametreler
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Aktif flag: {activeCount} / {totalToggles} toggles
          </p>
        </div>
        <a
          href="/docs/FEATURE_FLAGS.md"
          target="_blank"
          className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-md px-3 py-1.5 hover:bg-indigo-50 transition"
        >
          <BookOpen className="size-3.5" />
          Doküman
        </a>
      </div>

      {grouped.map((g) => (
        <div key={g.group} className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <SlidersHorizontal className="size-4 text-gray-400" />
            {g.label}
          </h2>
          <div className="grid gap-2">
            {g.items.map((flag) => (
              <div
                key={flag.key}
                className="rounded-lg border border-gray-200 bg-white px-4 py-3 flex items-start justify-between gap-4 hover:border-gray-300 transition"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                      {flag.key}
                    </code>
                    <span className="text-sm font-medium text-gray-800">
                      {flag.label}
                    </span>
                    {flag.type === 'toggle' && (
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                          flag.value === 'true'
                            ? 'bg-green-100 text-green-700'
                            : flag.default === 'true'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        <ToggleLeft className="size-3" />
                        {flag.value === 'true' ? 'AÇIK' : flag.default === 'true' ? 'VARSAYILAN AÇIK' : 'KAPALI'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    {flag.description}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {flag.type === 'number' ? (
                    <span className="text-sm font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                      {flag.value ?? flag.default}
                    </span>
                  ) : flag.type === 'select' ? (
                    <span className="text-sm font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                      {flag.value ?? flag.default}
                    </span>
                  ) : flag.type === 'toggle' ? (
                    <span className="text-[11px] text-gray-400">
                      varsayılan: {flag.default}
                    </span>
                  ) : (
                    <span className="text-[11px] text-gray-400">
                      {flag.value ?? flag.default}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Info box */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-xs text-blue-700 leading-relaxed">
        <strong>Not:</strong> Tüm flag&apos;ler ortam değişkeni (env) olarak tanımlanır.
        Varsayılan değerler <code className="text-indigo-600 bg-indigo-50 px-1 rounded">config.ts</code>&apos;te
        tanımlıdır. Aktifleştirme sonrası değişiklikler için deployment yeniden başlatılmalıdır.
        Detaylı bilgi için{' '}
        <a
          href="/docs/FEATURE_FLAGS.md"
          target="_blank"
          className="text-indigo-600 underline"
        >
          FEATURE_FLAGS.md
        </a>{' '}
        dosyasına bakın.
      </div>
    </div>
  );
}
