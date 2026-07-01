// ── SSE Stream: Real-time match updates ────────────────────────────
// Why SSE not WebSocket? Live score updates are server→client only.
// SSE is one-way, reuses HTTP infrastructure, survives proxies
// (including Coolify's Caddy), and reconnects automatically on
// the client side. WebSocket would add bidirectional capability
// we don't need and require sticky-session routing on multi-replica
// setups. See IMPLEMENTATION_PLAN.md "FAZ E" for the full analysis.
//
// Wire format (text/event-stream):
//   event: snapshot
//   data: { "matches": [...], "byLeague": {...}, ... }
//
//   event: heartbeat
//   data: { "ts": 1720000000 }
//
//   : comment line  (treated as keep-alive, ignored by client)
//
// Connection lifecycle:
//   - Subscribe on connect; receive one immediate "snapshot" event
//     if the cache has fresh data (so the client renders instantly).
//   - On every "snapshot" publish from the writer, forward to client.
//   - Send ": keep-alive" every 25s to prevent proxy timeouts.
//   - On disconnect (close/error), cleanup subscriber.

import { logError, logInfo } from "@/lib/devLog";
import { getMatchesCache } from "@/lib/server/matchesCache";
import {
  publishMatchEvent,
  subscribeMatchEvents,
  matchEventListenerCount,
  type MatchEvent,
} from "@/lib/server/matchEvents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // SSE needs streaming, not edge

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  // Use a TransformStream to convert our event writes into SSE wire format.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const closedRef = { closed: false };

      // Safe write helper — checks closed before each send.
      const safeWrite = (chunk: string) => {
        if (closedRef.closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed (e.g. client disconnect mid-write).
          closedRef.closed = true;
        }
      };

      // Send a Server-Sent Event frame.
      const sendEvent = (event: MatchEvent) => {
        if (closedRef.closed) return;
        const data = event.data !== undefined ? JSON.stringify(event.data) : "{}";
        safeWrite(`event: ${event.type}\ndata: ${data}\n\n`);
      };

      // Send a comment line — used as keep-alive. Browsers and
      // proxies ignore these, but they keep the TCP connection open.
      const sendComment = (text: string) => {
        safeWrite(`: ${text}\n\n`);
      };

      // Initial frame — confirm the connection is open.
      sendComment("connected");

      // Immediate snapshot if cache is warm — clients render
      // without waiting for the next cron tick.
      const cached = getMatchesCache("matches:v=writer-latest");
      if (cached) {
        sendEvent({ type: "snapshot", timestamp: Date.now(), data: cached.body });
      } else {
        // Cold cache: tell the client to fall back to polling
        // until the writer catches up. /api/matches will fill the
        // cache on the first request.
        sendComment("cache_miss_client_should_poll");
      }

      // Subscribe to the event bus. Each push = 1 SSE frame.
      const unsubscribe = subscribeMatchEvents((event) => {
        if (closedRef.closed) return;
        sendEvent(event);
      });

      // Heartbeat — prevents Coolify's Caddy from closing the
      // connection at 60s idle. 25s is safely under any reasonable
      // proxy timeout.
      const heartbeat = setInterval(() => {
        if (closedRef.closed) return;
        sendComment(`hb ${Date.now()}`);
      }, HEARTBEAT_MS);

      // Client disconnected — tear down.
      const cleanup = () => {
        if (closedRef.closed) return;
        closedRef.closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
        logInfo("matches-stream", `Client disconnected. Active listeners: ${matchEventListenerCount() - 1}`);
      };

      request.signal.addEventListener("abort", cleanup);
      logInfo("matches-stream", `Client connected. Active listeners: ${matchEventListenerCount()}`);

      // Safety net — if nothing else fires, ensure we don't leak the
      // interval. Already covered by `abort` listener on real client
      // disconnect, but the in-process cleanup also runs after
      // heartbeat misses.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable buffering on proxies that support it (nginx, Caddy).
      "X-Accel-Buffering": "no",
    },
  });
}
