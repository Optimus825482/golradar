// ── Presence Engine ──────────────────────────────────────────────
// Server-side active user tracking. TTL'd heartbeat Map.
// Each client identifies itself with a session ID (baked at first
// page load). Expired entries (>120s since last ping) are pruned
// on every read.

const g = globalThis as unknown as {
  __presenceMap?: Map<string, number> // sessionId → lastPingUnixMs
};

function getMap(): Map<string, number> {
  if (!g.__presenceMap) g.__presenceMap = new Map();
  return g.__presenceMap;
}

const TTL_MS = 120_000; // 2 minutes without ping = dead

export function presencePing(sessionId: string): number {
  const m = getMap();
  const now = Date.now();
  // Prune stale
  for (const [k, ts] of m) {
    if (now - ts > TTL_MS) m.delete(k);
  }
  m.set(sessionId, now);
  return m.size;
}

export function presenceLeave(sessionId: string): number {
  const m = getMap();
  m.delete(sessionId);
  return m.size;
}

export function activeUserCount(): number {
  const m = getMap();
  const now = Date.now();
  for (const [k, ts] of m) {
    if (now - ts > TTL_MS) m.delete(k);
  }
  return m.size;
}
