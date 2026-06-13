import { Server } from "socket.io";
import { io as clientIo } from "socket.io-client";
import { ET_MAP, parseStats } from "../shared/nesineLiveTypes";

const PORT = 3003;

// ── Nesine Socket.IO Client ──
const nesineSocket = clientIo("https://rt.nesine.com", {
  transports: ["websocket", "polling"],
  query: { platformid: "1" },
  reconnection: true,
  reconnectionDelay: 10000,
  reconnectionDelayMax: 60000,
  timeout: 20000,
  autoConnect: false,
});

// ── Our Socket.IO Server (for frontend) ──
const corsOrigins = (process.env.SOCKET_CORS_ORIGIN || 'http://localhost:3028')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const io = new Server(PORT, {
  cors: { origin: corsOrigins, methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 20000,
});

// Store latest match data from Socket.IO updates
const matchUpdates: Map<number, any> = new Map();

// Status codes that should be excluded
const EXCLUDED_STATUSES = new Set([15, 17, 23, 27, 46, 47, 54, 55, 56, 57]);

// Calculate pressure index from stats
function calculatePressure(stats: any): { home: number; away: number } {
  let homePressure = 0;
  let awayPressure = 0;

  const weights: Record<string, number> = {
    possession: 0.15,
    dangerous_attacks: 0.25,
    shots_total: 0.15,
    shots_on_target: 0.20,
    corners: 0.10,
    attacks: 0.15,
  };

  for (const [key, weight] of Object.entries(weights)) {
    const stat = stats[key];
    if (stat && stat.home != null && stat.away != null) {
      const total = (stat.home as number) + (stat.away as number);
      if (total > 0) {
        homePressure += ((stat.home as number) / total) * weight * 100;
        awayPressure += ((stat.away as number) / total) * weight * 100;
      }
    }
  }

  return { home: Math.round(homePressure), away: Math.round(awayPressure) };
}

// ── Nesine Socket Events ──
nesineSocket.on("connect", () => {
  console.log("[NESINE] Connected to rt.nesine.com");
  nesineSocket.emit("joinroom", "Football_V3");
  console.log("[NESINE] Joined room: Football_V3");
});

nesineSocket.on("disconnect", (reason) => {
  console.log(`[NESINE] Disconnected: ${reason}`);
});

nesineSocket.on("connect_error", (err) => {
  console.log(`[NESINE] Connection error: ${err.message}`);
});

// Listen for Football updates
nesineSocket.on("Football", (messages: any[]) => {
  if (!Array.isArray(messages)) return;

  for (const msg of messages) {
    const mt = msg.MT;
    const payload = msg.M;
    if (!payload) continue;

    const bid = payload.BID;
    if (!bid) continue;

    // Store the update
    matchUpdates.set(bid, { ...matchUpdates.get(bid), ...payload, MT: mt });

    // Broadcast to our frontend clients
    io.emit("match_update", {
      type: mt,
      bid: bid,
      data: payload,
    });
  }
});

// ── Our Server Events ──
io.on("connection", (socket) => {
  console.log(`[CLIENT] ${socket.id} connected`);

  // Send current cached updates
  socket.on("get_cached_updates", () => {
    socket.emit("cached_updates", Object.fromEntries(matchUpdates));
  });

  // Subscribe to specific match
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

  socket.on("disconnect", () => {
    console.log(`[CLIENT] ${socket.id} disconnected`);
  });
});

// ── Start ──
console.log(`[SERVER] Socket.IO server running on port ${PORT}`);
console.log("[SERVER] Connecting to Nesine rt.nesine.com...");
nesineSocket.connect();
