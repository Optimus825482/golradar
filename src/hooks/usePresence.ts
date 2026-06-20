"use client";

import { useEffect, useRef, useState } from "react";
import type { Tier } from "@/lib/tier";

const STORAGE_KEY = "golradari.sessionId";
const HEARTBEAT_MS = 30_000;
const PRESENCE_PATH = "/api/presence";

interface UsePresenceResult {
  sessionId: string;
  activeUsers: number;
  tier: Tier;
}

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = window.localStorage.getItem(STORAGE_KEY);
  if (!id) {
    // crypto.randomUUID requires secure context (https or localhost).
    // Fallback to crypto.getRandomValues for older browsers.
    if (window.crypto?.randomUUID) {
      id = window.crypto.randomUUID();
    } else {
      const arr = new Uint8Array(16);
      window.crypto.getRandomValues(arr);
      id = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    window.localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

async function sendAction(action: "ping" | "join" | "leave", sessionId: string): Promise<{ activeUsers: number; tier: Tier } | null> {
  try {
    const resp = await fetch(PRESENCE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, sessionId }),
      keepalive: action === "leave", // sendBeacon-equivalent: survives unload
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (typeof data.activeUsers !== "number" || typeof data.tier !== "string") return null;
    return { activeUsers: data.activeUsers, tier: data.tier as Tier };
  } catch {
    return null;
  }
}

function sendBeaconLeave(sessionId: string): void {
  if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
  try {
    const blob = new Blob(
      [JSON.stringify({ action: "leave", sessionId })],
      { type: "application/json" },
    );
    navigator.sendBeacon(PRESENCE_PATH, blob);
  } catch {
    // best-effort
  }
}

/**
 * Reports this client's presence to the server. Sends an initial
 * "join" on mount, a "ping" every 30s, and a "leave" on unmount
 * or page hide. Tracks the active user count + tier from the
 * server's response so the caller can adapt polling cadence.
 */
export function usePresence(enabled = true): UsePresenceResult {
  const [sessionId] = useState<string>(() => getOrCreateSessionId());
  const [activeUsers, setActiveUsers] = useState<number>(0);
  const [tier, setTier] = useState<Tier>("LITE");
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    if (!enabled) return undefined;
    mountedRef.current = true;

    const ping = async () => {
      const r = await sendAction("ping", sessionId);
      if (r && mountedRef.current) {
        setActiveUsers(r.activeUsers);
        setTier(r.tier);
      }
    };

    // Initial join (use ping — idempotent, updates timestamp)
    ping();

    const hb = setInterval(ping, HEARTBEAT_MS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        sendBeaconLeave(sessionId);
      } else if (document.visibilityState === "visible") {
        ping();
      }
    };
    const onPageHide = () => sendBeaconLeave(sessionId);
    const onBeforeUnload = () => sendBeaconLeave(sessionId);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      mountedRef.current = false;
      clearInterval(hb);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      sendBeaconLeave(sessionId);
    };
  }, [enabled, sessionId]);

  return { sessionId, activeUsers, tier };
}
