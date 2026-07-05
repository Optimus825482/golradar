// ── Zombie Cleanup Loop ───────────────────────────────────────────
// Periodic sweep to kill stale Python subprocesses (> 5min runtime).
// Runs every 60s; calls are best-effort. Logs to devLog.

import { logError } from '@/lib/devLog';

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startZombieCleanup(intervalMs = 60_000): void {
  if (typeof window !== 'undefined') return;
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    try {
      // Best-effort: kill stale Python processes older than 5 min
      if (process.platform === 'linux') {
        require('child_process').exec('pkill -f "python3.*scrap" -o 300', () => {});
      }
    } catch (e) { logError('zombie', String(e)); }
  }, intervalMs);
  if (typeof cleanupInterval.unref === 'function') cleanupInterval.unref();
}

export function stopZombieCleanup(): void {
  if (cleanupInterval) { clearInterval(cleanupInterval); cleanupInterval = null; }
}
