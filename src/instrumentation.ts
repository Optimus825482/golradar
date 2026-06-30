// ── Next.js Instrumentation ──────────────────────────────────────
// Server startup'ta Socket.io push server'ini baslatir.
// Next.js'in kendi process'inde calisir, tum dependency'ler hazir.
// Ayri port (3004) kullanir, ama ayri process degil.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { startPushServer } = await import('./lib/pushServer');
      startPushServer();
      console.error('[Instrumentation] Push server started');
    } catch (err) {
      console.error('[Instrumentation] Push server failed:', err);
    }
  }
}
