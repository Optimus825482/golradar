// ── Request Deduplicator ──────────────────────────────────────────
// Prevents duplicate concurrent outbound requests for the same key.
// If two callers request the same FotMob/Goaloo endpoint simultaneously,
// only one HTTP call is made; both get the same result.

const inFlight = new Map<string, Promise<unknown>>();

export async function deduplicate<T>(key: string, factory: () => Promise<T>, ttlMs = 5000): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = factory();
  inFlight.set(key, promise);

  try {
    const result = await promise;
    return result;
  } finally {
    setTimeout(() => inFlight.delete(key), ttlMs);
  }
}

export function dedupCount(): number {
  return inFlight.size;
}
