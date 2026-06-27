// ── Real-time Pipeline Service ─────────────────────────────────
// Replaces HTTP cron polling with WebSocket-based live data pipeline.
//
// Architecture:
//   Nesine Socket.IO (WebSocket) → pipeline → 
//     ├── Signal processing (HTTP call to Next.js API)
//     ├── DB write (via Next.js API)
//     └── Frontend push (Socket.IO)
//
// Fallback: HTTP cron poll still handles Goaloo/FotMob enrichment.

import { Server } from "socket.io";
import { io as clientIo } from "socket.io-client";

const PORT = 3010;
const NEXTJS_API = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3028";

// ── Nesine Socket.IO Client (WebSocket, no HTTP polling!) ──
const nesineSocket = clientIo("https://rt.nesine.com", {
  transports: ["websocket"],  // SADECE WebSocket, HTTP polling yok
  query: { platformid: "1" },
  reconnection: true,
  reconnectionDelay: 10000,
  reconnectionDelayMax: 60000,
  timeout: 20000,
  autoConnect: false,
});

// ── Our Socket.IO Server (frontend + internal) ──
const corsOrigins = (process.env.SOCKET_CORS_ORIGIN || 'http://localhost:3028')
  .split(',').map(s => s.trim()).filter(Boolean);

const io = new Server(PORT, {
  cors: { origin: corsOrigins, methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 20000,
});

// ── In-memory state ──
const matchUpdates = new Map<number, any>();
const EXCLUDED_STATUSES = new Set([15, 17, 23, 27, 46, 47, 54, 55, 56, 57]);

// ── Signal Processing via Next.js API ──
// Her match update'te Next.js'e sinyal işleme isteği gönder.
// Bu HTTP çağrısı, 30sn'de bir tüm maçları poll etmekten DAHA HAFİF.
async function processSignal(bid: number, payload: any): Promise<void> {
  try {
    const response = await fetch(`${NEXTJS_API}/api/cron/poll`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Cron-Secret': process.env.CRON_SECRET || '',
        'X-Pipeline-Source': 'websocket',
      },
      body: JSON.stringify({
        matchCode: bid,
        homeTeam: payload.HT,
        awayTeam: payload.AT,
        league: payload.L,
        minute: String(payload.M || '0'),
        homeGoals: payload.ES?.[0]?.H ?? 0,
        awayGoals: payload.ES?.[0]?.A ?? 0,
        stats: payload.SE,
        status: payload.S,
      }),
      signal: AbortSignal.timeout(5000), // 5sn timeout
    });
    if (!response.ok) {
      console.error(`[PIPELINE] Signal processing failed for ${bid}: ${response.status}`);
    }
  } catch (err: any) {
    // Sessiz geç — Next.js hazır değilse (ilk başlangıç) hata fırlatma
    if (err.name !== 'AbortError') {
      console.error(`[PIPELINE] Signal error for ${bid}: ${err.message}`);
    }
  }
}

// ── Batch processing ──
// Her 10 saniyede bir bekleyen update'leri toplu işle
let pendingBatch = new Map<number, any>();

function flushBatch(): void {
  if (pendingBatch.size === 0) return;
  const batch = pendingBatch;
  pendingBatch = new Map();
  
  for (const [bid, payload] of batch) {
    processSignal(bid, payload);
  }
}

// Her 10sn'de batch flush
setInterval(flushBatch, 10000);

// ── Nesine Socket Events ──
nesineSocket.on("connect", () => {
  console.log("[PIPELINE] Connected to rt.nesine.com via WebSocket");
  nesineSocket.emit("joinroom", "Football_V3");
  console.log("[PIPELINE] Joined room: Football_V3");
});

nesineSocket.on("disconnect", (reason) => {
  console.log(`[PIPELINE] Disconnected: ${reason}`);
});

nesineSocket.on("connect_error", (err) => {
  console.log(`[PIPELINE] Connection error: ${err.message}`);
});

// Ana veri akışı — Nesine'den anlık maç güncellemeleri
nesineSocket.on("Football", (messages: any[]) => {
  if (!Array.isArray(messages)) return;

  for (const msg of messages) {
    const mt = msg.MT;
    const payload = msg.M;
    if (!payload) continue;

    const bid = payload.BID;
    if (!bid) continue;

    // Store for frontend
    matchUpdates.set(bid, { ...matchUpdates.get(bid), ...payload, MT: mt });

    // Sinyal işleme kuyruğuna ekle
    pendingBatch.set(bid, payload);

    // Frontend'e anlık push
    io.emit("match_update", {
      type: mt,
      bid: bid,
      data: payload,
    });
  }
});

// ── Frontend Events ──
io.on("connection", (socket) => {
  socket.on("get_cached_updates", () => {
    socket.emit("cached_updates", Object.fromEntries(matchUpdates));
  });

  socket.on("subscribe_match", (bid: number) => {
    socket.join(`match_${bid}`);
    const cached = matchUpdates.get(bid);
    if (cached) {
      socket.emit("match_update", { type: cached.MT, bid, data: cached });
    }
  });

  socket.on("unsubscribe_match", (bid: number) => {
    socket.leave(`match_${bid}`);
  });
});

// ── Start ──
console.log(`[PIPELINE] Real-time pipeline service on port ${PORT}`);
console.log(`[PIPELINE] Processing signals via ${NEXTJS_API}/api/cron/poll`);
console.log("[PIPELINE] Connecting to Nesine rt.nesine.com via WebSocket...");
nesineSocket.connect();
