// ── Real-time Push Server (Socket.io) ───────────────────────────
// Her 15 saniyede bir /api/matches + /api/goal-signals endpoint'lerini
// internal HTTP cagrisi ile sorgular ve WebSocket'e bagli tum client'lara
// broadcast eder.
//
// Calistirma: bun src/lib/pushServer.ts
// Baglanti (browser): NEXT_PUBLIC_PUSH_URL=https://domain.com:3004
// Internal API: PUSH_INTERNAL_URL=http://localhost:3028 (override edilebilir)

import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT = parseInt(process.env.PUSH_PORT ?? '3004', 10);
const POLL_INTERVAL = 15_000;
// Internal URL: container icinde Next.js'e ulasmak icin
const INTERNAL_URL = process.env.PUSH_INTERNAL_URL ?? 'http://localhost:3028';

interface PushPayload {
  matches: any;
  signals: any[];
  signalStats: any;
  timestamp: number;
}

async function fetchFrom(url: string): Promise<any> {
  const resp = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json();
}

async function pollOnce(): Promise<PushPayload> {
  const [matchesData, signalData] = await Promise.all([
    fetchFrom(`${INTERNAL_URL}/api/matches`).catch(() => ({ matches: [] })),
    fetchFrom(`${INTERNAL_URL}/api/goal-signals?action=stats&days=1`).catch(() => ({ recentSignals: [], totalSignals: 0 })),
  ]);

  return {
    matches: matchesData.matches ?? [],
    signals: signalData.recentSignals ?? [],
    signalStats: {
      totalSignals: signalData.totalSignals ?? 0,
      signalsWithGoal: signalData.signalsWithGoal ?? 0,
      signalsWithoutGoal: signalData.signalsWithoutGoal ?? 0,
      signalsPending: signalData.signalsPending ?? 0,
      accuracyRate: signalData.accuracyRate ?? 0,
      goalAfterSignalRate: signalData.goalAfterSignalRate ?? 0,
    },
    timestamp: Date.now(),
  };
}

export function startPushServer(): Server {
  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.SOCKET_CORS_ORIGIN?.split(',') ?? ['http://localhost:3028'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.on('connection', (socket) => {
    console.error(`[PushServer] Client connected: ${socket.id}`);

    // Baglanan cliente hemen son durumu gonder
    pollOnce().then((data) => socket.emit('update', data)).catch(() => {});

    socket.on('disconnect', () => {
      console.error(`[PushServer] Client disconnected: ${socket.id}`);
    });
  });

  httpServer.listen(PORT, () => {
    console.error(`[PushServer] Running on port ${PORT}, polling ${INTERNAL_URL}/api/matches every ${POLL_INTERVAL}ms`);

    // Hemen ilk poll
    pollOnce().then((data) => io.emit('update', data)).catch(() => {});

    // Periyodik poll
    setInterval(async () => {
      try {
        const data = await pollOnce();
        io.emit('update', data);
      } catch (err) {
        console.error('[PushServer] Poll error:', err);
      }
    }, POLL_INTERVAL);
  });

  return io;
}

// Dogrudan calistirilirsa
if (require.main === module) {
  startPushServer();
  console.error(`[PushServer] Start with: PUSH_PORT=${PORT} INTERNAL_URL=${INTERNAL_URL}`);
}
