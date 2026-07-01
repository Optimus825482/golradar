// ── Match Event Bus (in-process pub/sub) ───────────────────────────
// Tiny synchronous pub/sub used by:
//   1. The cron writer (`/api/cron/poll-matches`) publishing a fresh
//      dataset every 5s.
//   2. The SSE endpoint (`/api/matches/stream`) subscribing and
//      forwarding updates to connected clients.
//
// In-process only — works for single-container deployments
// (our Coolify setup). Multi-container setups would need Redis
// pub/sub or a dedicated event broker.

export type MatchEventType =
  | "snapshot"      // Full /api/matches payload ready
  | "goal"          // A specific match scored
  | "status-change" // Match status transitioned
  | "heartbeat";    // Keepalive every 30s

export interface MatchEvent {
  type: MatchEventType;
  timestamp: number;
  /** Opaque payload. For "snapshot" this is the full /api/matches body. */
  data?: unknown;
}

type Listener = (event: MatchEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe; returns an unsubscribe function. */
export function subscribeMatchEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish synchronously to all subscribers. Errors are caught per-listener
 *  so a single buggy SSE connection can't break the cron writer. */
export function publishMatchEvent(event: MatchEvent): void {
  for (const l of listeners) {
    try {
      l(event);
    } catch (e) {
      // Don't let one bad listener poison the bus. The next event
      // will try again; if it keeps throwing, the subscriber's
      // transport layer should detect and disconnect.
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[matchEvents] listener threw:", e);
      }
    }
  }
}

/** Number of active subscribers — for /healthz monitoring. */
export function matchEventListenerCount(): number {
  return listeners.size;
}
