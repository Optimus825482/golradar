'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface LiveMatch {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  status: number;
  minute: string;
  homeGoals: number;
  awayGoals: number;
}

function fmtMinute(minute: string): string {
  const n = parseInt(minute, 10);
  if (isNaN(n) || n === 0) return '';
  return `${n}'`;
}

function fmtScore(m: LiveMatch): string {
  if (m.homeGoals === 0 && m.awayGoals === 0) return '0-0';
  return `${m.homeGoals}-${m.awayGoals}`;
}

function fmtStatus(s: number): string {
  if (s === 2) return '1Y';
  if (s === 3) return 'HT';
  if (s === 4) return '2Y';
  if (s === 16) return 'UZT';
  return `${s}`;
}

export default function PipelineDebugHomePage() {
  const [matchCode, setMatchCode] = useState('');
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/admin/pipeline-trace/live-matches')
      .then(r => r.json())
      .then(d => { if (d.ok) setLiveMatches(d.matches); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (matchCode.trim()) {
      router.push(`/admin/pipeline/debug/${matchCode.trim()}`);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">🔬 Pipeline Debug</h1>
      <p className="text-sm text-gray-500 mb-6">
        Bir maç seç veya kod girerek pipeline trace'ini başlat.
      </p>

      {/* Manuel giriş */}
      <form onSubmit={handleSubmit} className="flex gap-3 mb-8">
        <input
          type="number"
          value={matchCode}
          onChange={(e) => setMatchCode(e.target.value)}
          placeholder="Maç kodu (ör: 2184558)"
          className="border rounded px-4 py-3 text-base flex-1 max-w-xs"
        />
        <button
          type="submit"
          disabled={!matchCode.trim()}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
        >
          🔍 Debug Başlat
        </button>
        <button
          onClick={() => { setLoading(true); fetch('/api/admin/pipeline-trace/live-matches').then(r=>r.json()).then(d=>{if(d.ok)setLiveMatches(d.matches);}).catch(()=>{}).finally(()=>setLoading(false)); }}
          className="px-4 py-3 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 transition"
          title="Yenile"
        >
          ↻
        </button>
      </form>

      {/* Canlı maç listesi */}
      <h2 className="text-lg font-semibold text-gray-700 mb-3">
        {loading ? '⏳ Yükleniyor...' : `🔴 Canlı Maçlar (${liveMatches.length})`}
      </h2>

      {!loading && liveMatches.length === 0 && (
        <div className="bg-gray-50 border rounded-lg p-8 text-center text-gray-400">
          Şu an canlı maç yok
        </div>
      )}

      <div className="grid gap-2">
        {liveMatches.map((m) => (
          <button
            key={m.matchCode}
            onClick={() => router.push(`/admin/pipeline/debug/${m.matchCode}`)}
            className="flex items-center gap-4 w-full text-left px-4 py-3 bg-white border rounded-lg hover:bg-blue-50 hover:border-blue-200 transition text-sm group"
          >
            <span className="w-10 text-xs font-mono text-gray-400">#{m.matchCode}</span>
            <span className="w-8 text-center text-xs font-bold text-red-500 bg-red-50 rounded px-1 py-0.5">
              {fmtStatus(m.status)}
            </span>
            <span className="flex-1 font-medium text-gray-800 truncate group-hover:text-blue-700">
              {m.homeTeam} vs {m.awayTeam}
            </span>
            <span className="w-12 text-center font-bold text-gray-700">
              {fmtScore(m)}
            </span>
            <span className="w-12 text-xs text-gray-400 text-right">
              {fmtMinute(m.minute)}
            </span>
            <span className="w-16 text-xs text-gray-400 text-right truncate">
              {m.league}
            </span>
            <span className="text-blue-500 text-xs font-medium opacity-0 group-hover:opacity-100 transition ml-2">
              Debug →
            </span>
          </button>
        ))}
      </div>

      <details className="mt-8">
        <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-600">Nasıl çalışır?</summary>
        <div className="mt-2 bg-gray-50 border rounded-lg p-4 text-sm text-gray-500">
          <ul className="space-y-1 list-disc list-inside">
            <li>Nesine API'den maçın canlı verisini çeker</li>
            <li>Pipeline'ı adım adım çalıştırır (processMatch → goalProbability → signal)</li>
            <li>Her adımın input/output JSON'ını kaydeder</li>
            <li>Sonuçları expandable kartlar halinde gösterir</li>
            <li>Hata varsa kırmızı işaretlenir, detayı görüntülenebilir</li>
          </ul>
        </div>
      </details>
    </div>
  );
}
