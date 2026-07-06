'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PipelineDebugHomePage() {
  const [matchCode, setMatchCode] = useState('');
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (matchCode.trim()) {
      router.push(`/admin/pipeline/debug/${matchCode.trim()}`);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">🔬 Pipeline Debug</h1>
      <p className="text-sm text-gray-500 mb-6">
        Bir maç kodu girerek pipeline trace'ini başlat. Sistem Nesine'den canlı
        veriyi çeker, tüm hesaplama adımlarını kaydeder ve step-by-step gösterir.
      </p>

      <form onSubmit={handleSubmit} className="flex gap-3 mb-8">
        <input
          type="number"
          value={matchCode}
          onChange={(e) => setMatchCode(e.target.value)}
          placeholder="Maç kodu (ör: 2184558)"
          className="border rounded px-4 py-3 text-base flex-1 max-w-xs"
          autoFocus
        />
        <button
          type="submit"
          disabled={!matchCode.trim()}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
        >
          🔍 Debug Başlat
        </button>
      </form>

      <div className="bg-gray-50 border rounded-lg p-6 text-sm text-gray-500">
        <h2 className="font-semibold text-gray-700 mb-2">Nasıl çalışır?</h2>
        <ul className="space-y-1 list-disc list-inside">
          <li>Nesine API'den maçın canlı verisini çeker</li>
          <li>Pipeline'ı adım adım çalıştırır (processMatch → goalProbability → signal)</li>
          <li>Her adımın input/output JSON'ını kaydeder</li>
          <li>Sonuçları expandable kartlar halinde gösterir</li>
          <li>Hata varsa kırmızı işaretlenir, detayı görüntülenebilir</li>
        </ul>
        <p className="mt-3 text-xs text-gray-400">
          Son deployman loglarından maç kodlarını görebilirsin. Örnek: 2184558, 2180272
        </p>
      </div>
    </div>
  );
}
