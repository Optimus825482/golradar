// ── Next.js Server-Side Instrumentation ────────────────────────────
// Runs once when the Node.js server boots. Use to wire up long-lived
// background tasks (cache purges, schedulers, etc.) that shouldn't
// be triggered by individual route handlers.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Server-side only — kicks off the FotMob cache maintenance
    // scheduler (purge timer, stats logging, team-mapping rehydrate).
    // The module self-starts on import, so a side-effect import is
    // enough. Guarded against HMR re-entry by its internal singleton.
    await import('./lib/fotmobCacheMaintenance');
  }
}
