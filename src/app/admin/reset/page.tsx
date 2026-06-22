'use client';

import { useState } from 'react';

function authFetch(path: string, init?: RequestInit) {
  const token = sessionStorage.getItem('admin_token');
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
}

interface AffectedRow {
  dryRun: boolean;
  affected: Record<string, number>;
  totalAffected: number;
  preserved: string[];
  timestamp: string;
}

export default function AdminResetPage() {
  const [result, setResult] = useState<AffectedRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const preview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/reset', {
        method: 'POST',
        body: JSON.stringify({ dryRun: true }),
      });
      const data = await res.json();
      if (data.ok) setResult(data);
      else setError(data.message || 'Önizleme başarısız');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bağlantı hatası');
    }
    setLoading(false);
  };

  const execute = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/reset', {
        method: 'POST',
        body: JSON.stringify({ dryRun: false }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult(data);
        setConfirming(false);
      } else {
        setError(data.message || 'Sıfırlama başarısız');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bağlantı hatası');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-800">♻️ Sistem Sıfırlama</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Tahmin, sinyal ve kalibrasyon tablolarını sıfırlayarak yeni eğitim
          döngüsü için temiz başlangıç. Eğitilmiş modeller ve eğitim verisi
          korunur.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          <b>Hata:</b> {error}
        </div>
      )}

      {/* Preserved tables */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <div className="text-sm font-bold text-emerald-800 mb-2">
          ✓ Korunacak Tablolar
        </div>
        <ul className="text-[11px] text-emerald-700 space-y-1">
          {result?.preserved.map((p) => (
            <li key={p}>• {p}</li>
          ))}
        </ul>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={preview}
          disabled={loading}
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-bold rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? '⏳ Hesaplanıyor…' : '👁 Önizleme (kaç satır silinir?)'}
        </button>
        <button
          onClick={() => setConfirming(true)}
          disabled={loading}
          className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? '⏳ Sıfırlanıyor…' : '🗑 Sıfırla'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="text-sm font-bold text-gray-800 mb-3">
            {result.dryRun ? '📋 Önizleme Sonucu' : '✅ Sıfırlama Tamamlandı'}
            {' '}— {new Date(result.timestamp).toLocaleString('tr-TR')}
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="text-left py-1.5 font-semibold">Tablo</th>
                <th className="text-right py-1.5 font-semibold">Silinen Satır</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.affected).map(([table, count]) => (
                <tr key={table} className="border-b border-gray-50">
                  <td className="py-1.5 font-mono text-gray-700">{table}</td>
                  <td className="py-1.5 text-right font-mono">
                    <span className={count > 0 ? 'text-red-600 font-bold' : 'text-gray-400'}>
                      {count.toLocaleString('tr-TR')}
                    </span>
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 font-bold">
                <td className="py-1.5 text-gray-800">Toplam</td>
                <td className="py-1.5 text-right font-mono text-gray-800">
                  {result.totalAffected.toLocaleString('tr-TR')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm dialog */}
      {confirming && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-5 max-w-md w-full shadow-2xl">
            <div className="text-lg font-bold text-red-700 mb-2">
              ⚠️ Sistem Sıfırlaması Onayı
            </div>
            <p className="text-sm text-gray-700 mb-4">
              <b>{result?.totalAffected ?? '?'}</b> satır silinecek. Eğitilmiş
              modeller ve takım geçmişi korunur, ancak tüm tahmin logları,
              sinyaller ve kalibrasyon metrikleri silinir. Bu işlem geri
              alınamaz.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirming(false)}
                disabled={loading}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200"
              >
                İptal
              </button>
              <button
                onClick={execute}
                disabled={loading}
                className="px-3 py-1.5 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700"
              >
                Evet, sıfırla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
