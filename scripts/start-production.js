// ── Production Start Script (Node.js) ───────────────────────────
// Alpine uyumlu. Bun'un `&` kisitlamasini asmak icin Node.js
// child_process ile Next.js + Push Server'i ayri process'lerde baslatir.
//
// Kullanim: node scripts/start-production.js
// (package.json'daki "start" scripti bunu cagirir)

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUSH_PORT = process.env.PUSH_PORT ?? '3004';
const NEXT_PORT = process.env.PORT ?? '3012';

function log(tag, msg) {
  console.error(`[${tag}] ${msg}`);
}

// ── Push Server ──
const push = spawn('bun', ['src/lib/pushServer.ts'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PUSH_PORT },
});
push.stdout.on('data', (d) => process.stdout.write(`[Push] ${d}`));
push.stderr.on('data', (d) => process.stderr.write(`[Push] ${d}`));
push.on('exit', (code) => log('Push', `exited with code ${code}`));

// ── Next.js ──
const next = spawn('bun', ['.next/standalone/server.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: NEXT_PORT, HOSTNAME: '0.0.0.0' },
});
next.stdout.on('data', (d) => process.stdout.write(`[Next] ${d}`));
next.stderr.on('data', (d) => process.stderr.write(`[Next] ${d}`));
next.on('exit', (code) => log('Next', `exited with code ${code}`));

log('Start', `Push server on port ${PUSH_PORT}, Next.js on port ${NEXT_PORT}`);
log('Start', `PID push=${push.pid} next=${next.pid}`);

// Temizlik
process.on('SIGTERM', () => { push.kill(); next.kill(); process.exit(0); });
process.on('SIGINT', () => { push.kill(); next.kill(); process.exit(0); });
