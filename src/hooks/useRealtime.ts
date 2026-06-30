'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const PUSH_URL = process.env.NEXT_PUBLIC_PUSH_URL ?? 'http://localhost:3004';

interface PushPayload {
  matches: any[];
  signals: any[];
  signalStats: {
    totalSignals: number;
    signalsWithGoal: number;
    signalsWithoutGoal: number;
    signalsPending: number;
    accuracyRate: number;
    goalAfterSignalRate: number;
  };
  timestamp: number;
}

/**
 * Socket.io baglantisi. Ilk denemede basarisiz olursa pes eder
 * ve sadece HTTP poll'a guvenir. Konsol spam'i yapmaz.
 * Production'da push server yoksa sorunsuz calisir.
 */
export function useRealtime() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [wsData, setWsData] = useState<PushPayload | null>(null);
  const [wsTimestamp, setWsTimestamp] = useState<number | null>(null);
  const gaveUpRef = useRef(false);

  useEffect(() => {
    if (gaveUpRef.current) return;
    if (typeof window === 'undefined') return;

    // Sadece development'ta logla
    const isDev = process.env.NODE_ENV === 'development';

    const socket = io(PUSH_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 2,    // sadece 2 kez dene
      reconnectionDelay: 5000,
      timeout: 5000,              // 5sn timeout
      autoConnect: true,
    });

    socket.on('connect', () => {
      if (isDev) console.log('[WS] Connected');
      setConnected(true);
    });

    socket.on('update', (data: PushPayload) => {
      setWsData(data);
      setWsTimestamp(data.timestamp);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', () => {
      // Ilk hatada pes et — HTTP poll yeterli
      gaveUpRef.current = true;
      setConnected(false);
      socket.disconnect();
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, []);

  return { connected, wsData, wsTimestamp };
}
