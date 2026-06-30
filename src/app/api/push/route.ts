// ── SSE Push Endpoint (Server-Sent Events) ─────────────────────
// Browser buraya baglanir, sunucu her 15sn'de bir canli mac verisini
// push'lar. Tek port (3012), ek bagimlilik yok, socket.io yok.
//
// Baglanti: new EventSource('/api/push')

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 saniye timeout (heroku benzeri)

async function fetchMatches() {
  const base = process.env.PUSH_INTERNAL_URL ?? 'http://localhost:3012';
  const [mRes, sRes] = await Promise.all([
    fetch(`${base}/api/matches`, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null),
    fetch(`${base}/api/goal-signals?action=stats&days=1`, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null),
  ]);
  const m = mRes?.ok ? await mRes.json().catch(() => ({ matches: [] })) : { matches: [] };
  const s = sRes?.ok ? await sRes.json().catch(() => ({ recentSignals: [], totalSignals: 0 })) : { recentSignals: [], totalSignals: 0 };
  return { matches: m.matches ?? [], signals: s.recentSignals ?? [], signalStats: { totalSignals: s.totalSignals ?? 0 }, timestamp: Date.now() };
}

export async function GET(request: Request) {
  // SSE basliklari
  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx proxy icin
  });

  const stream = new ReadableStream({
    start(controller) {
      let running = true;

      // Ilk veriyi hemen gonder
      fetchMatches().then(data => {
        if (!running) return;
        try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      });

      // Her 15sn'de bir poll et
      const interval = setInterval(async () => {
        if (!running) { clearInterval(interval); return; }
        try {
          const data = await fetchMatches();
          try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
        } catch { /* client disconnected */ }
      }, 15000);

      // Baglanti kapaninca temizle
      request.signal.addEventListener('abort', () => {
        running = false;
        clearInterval(interval);
      });
    },
  });

  return new NextResponse(stream, { headers });
}
