// ── Subprocess Pool ──────────────────────────────────────────────
// Limits concurrent Python subprocesses to prevent resource exhaustion.
// Queues excess calls instead of spawning unlimited processes.

import { execFile } from 'child_process'

const MAX_CONCURRENT = 3;
let active = 0;
const queue: Array<() => void> = [];

function drain() {
  while (queue.length > 0 && active < MAX_CONCURRENT) {
    const next = queue.shift()!;
    next();
  }
}

export function enqueueProcess(
  python: string, args: string[], opts: any,
  callback: (err: any, stdout: string, stderr: string) => void
): void {
  const run = () => {
    active++;
    execFile(python, args, opts, (err, stdout, stderr) => {
      active--;
      callback(err, String(stdout), String(stderr));
      drain();
    });
  };
  if (active < MAX_CONCURRENT) { run(); } else { queue.push(run); }
}

export function poolStats() { return { active, queued: queue.length, max: MAX_CONCURRENT }; }
