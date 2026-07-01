"use client";

import { useEffect, useRef, useState } from "react";
import type { Match, PressureSnapshot } from "@/components/match/types";
import { logError, logInfo } from "@/lib/devLog";

interface UseMatchStreamOptions {
  /** When true, open an EventSource connection. Caller controls
   *  this so it can be disabled in tests / SSR. */
  enabled: boolean;
  /** Called on every "snapshot" event from the server. */
  onSnapshot: (data: {
    matches: Match[];
    pressureData: Record<number, PressureSnapshot[]>;
    timestamp: number;
  }) => void;
  /** Called when the stream disconnects. Caller can fall back to polling. */
  onDisconnect?: () => void;
  /** Called when the stream reconnects after a disconnect. */
  onReconnect?: () => void;
}

interface UseMatchStreamResult {
  /** True when the SSE connection is currently open. */
  connected: boolean;
  /** Number of consecutive errors (used to decide when to fall back to polling). */
  errorCount: number;
}

/**
 * Client-side SSE consumer for /api/matches/stream.
 *
 * Behaviour:
 *   1. Opens an EventSource to /api/matches/stream.
 *   2. Receives "snapshot" events → invokes onSnapshot with parsed
 *      payload.
 *   3. Receives "heartbeat" comments every 25s — keeps connection
 *      alive through proxies.
 *   4. On error/disconnect, increments errorCount. After 3 consecutive
 *      errors, calls onDisconnect so the parent can fall back to
 *      polling. Reconnects automatically when the network recovers.
 *
 * Why not call EventSource directly from useMatchList? Keeping the
 * SSE logic in its own hook makes it testable in isolation and lets
 * the polling code stay focused on its single concern.
 */
export function useMatchStream(options: UseMatchStreamOptions): UseMatchStreamResult {
  const { enabled, onSnapshot, onDisconnect, onReconnect } = options;
  const [connected, setConnected] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      // Tear down any existing connection.
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setConnected(false);
      return;
    }

    if (typeof EventSource === "undefined") {
      // SSR or old browser — skip silently.
      return;
    }

    let cancelled = false;
    setErrorCount(0);
    hasConnectedRef.current = false;

    try {
      const es = new EventSource("/api/matches/stream");
      esRef.current = es;

      es.addEventListener("open", () => {
        if (cancelled) return;
        if (!hasConnectedRef.current) {
          hasConnectedRef.current = true;
          onReconnect?.();
        }
        setConnected(true);
        setErrorCount(0);
      });

      es.addEventListener("snapshot", (e) => {
        if (cancelled) return;
        try {
          const event = e as MessageEvent<string>;
          const data = JSON.parse(event.data) as {
            matches?: Match[];
            pressureData?: Record<number, PressureSnapshot[]>;
            timestamp?: number;
          };
          onSnapshot({
            matches: data.matches ?? [],
            pressureData: data.pressureData ?? {},
            timestamp: data.timestamp ?? Date.now(),
          });
        } catch (err) {
          logError("useMatchStream", "Failed to parse snapshot:", err);
        }
      });

      es.addEventListener("error", () => {
        if (cancelled) return;
        // EventSource auto-reconnects, but we track errors so the
        // parent can switch to polling if the connection is sick.
        setConnected(false);
        setErrorCount((c) => {
          const next = c + 1;
          if (next >= 3) {
            onDisconnect?.();
            logInfo("useMatchStream", `Stream unhealthy (errors=${next}); parent should fall back to polling`);
          }
          return next;
        });
      });

      // Note: we intentionally don't add a "heartbeat" listener.
      // Heartbeat events are `: comment` lines that browsers ignore,
      // but we receive them in the onmessage handler — which we
      // also don't define, so they're effectively no-ops. They DO
      // keep the TCP connection alive through proxies.
    } catch (err) {
      logError("useMatchStream", "Failed to open EventSource:", err);
      setConnected(false);
      onDisconnect?.();
    }

    return () => {
      cancelled = true;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setConnected(false);
    };
  }, [enabled, onSnapshot, onDisconnect, onReconnect]);

  return { connected, errorCount };
}
