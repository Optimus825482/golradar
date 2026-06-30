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
 * Socket.io baglantisi yonetir.
 * pushServer'dan gelen canli mac + sinyal verilerini doner.
 * 
 * - connected: WS baglantisi aktif mi
 * - wsData: son guncel veri (null = henuz veri gelmedi)
 * - wsTimestamp: son verinin sunucu zamani
 */
export function useRealtime() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [wsData, setWsData] = useState<PushPayload | null>(null);
  const [wsTimestamp, setWsTimestamp] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(PUSH_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      console.log('[WS] Connected to push server');
      setConnected(true);
      setError(null);
    });

    socket.on('update', (data: PushPayload) => {
      setWsData(data);
      setWsTimestamp(data.timestamp);
    });

    socket.on('disconnect', (reason) => {
      console.log('[WS] Disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.warn('[WS] Connection error:', err.message);
      setConnected(false);
      setError(err.message);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, []);

  return { connected, wsData, wsTimestamp, error };
}
