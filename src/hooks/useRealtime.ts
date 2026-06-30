'use client';

import { useEffect, useRef, useState } from 'react';

interface PushPayload {
  matches: any[];
  signals: any[];
  signalStats: { totalSignals: number };
  timestamp: number;
}

/**
 * SSE (Server-Sent Events) ile canli veri akisi.
 * /api/push endpoint'ine baglanir, her 15sn'de bir guncel veriyi alir.
 * Socket.io yok, ek bagimlilik yok, tek port (3012).
 *
 * - connected: SSE baglantisi aktif mi
 * - wsData: son guncel veri
 */
export function useRealtime() {
  const [connected, setConnected] = useState(false);
  const [wsData, setWsData] = useState<PushPayload | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const gaveUp = useRef(false);

  useEffect(() => {
    if (gaveUp.current) return;
    if (typeof window === 'undefined') return;

    const es = new EventSource('/api/push');

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as PushPayload;
        setWsData(data);
      } catch {}
    };

    es.onerror = () => {
      // Ilk hatada pes et — HTTP poll devam eder
      gaveUp.current = true;
      setConnected(false);
      es.close();
    };

    esRef.current = es;

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, []);

  return { connected, wsData };
}
