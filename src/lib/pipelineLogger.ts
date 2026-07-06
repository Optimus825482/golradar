// ── Pipeline Event Logger ──────────────────────────────────────
// Fire-and-forget DB logger for pipeline events. Admin panelinde
// görüntülemek için her önemli olayı PipelineEvent tablosuna yazar.
//
// Kullanım:
//   pipelineLogger.info('cron', 'processMatch started', matchCode, {score: 65})
//   pipelineLogger.warn('signal', 'cooldown skip', matchCode, {side: 'home'})
//   pipelineLogger.error('pipeline-ws', 'POST failed', bid, {status: 400})
//
// Tüm yazma işlemleri async fire-and-forget — ana akışı bloklamaz.
// In-memory ring buffer son 200 olayı tutar (admin sayfası hızlı okuma).

import { db } from './db';

// ── Types ──────────────────────────────────────────────────────
export type PipelineEventLevel = 'info' | 'warn' | 'error';
export type PipelineEventSource = 'cron' | 'pipeline-ws' | 'signal' | 'reportGoal' | 'expiry' | 'ml';

export interface PipelineEventData {
  id: string;
  level: PipelineEventLevel;
  source: PipelineEventSource;
  matchCode: number | null;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

// ── In-memory ring buffer (son 200) ────────────────────────────
const RING_SIZE = 200;
const ringBuffer: PipelineEventData[] = [];

function pushRing(event: PipelineEventData): void {
  ringBuffer.push(event);
  if (ringBuffer.length > RING_SIZE) {
    ringBuffer.shift();
  }
}

// ── DB write (async, fire-and-forget) ─────────────────────────
async function writeToDb(
  level: PipelineEventLevel,
  source: PipelineEventSource,
  message: string,
  matchCode?: number | null,
  details?: Record<string, unknown> | null,
): Promise<PipelineEventData | null> {
  try {
    const row = await db.pipelineEvent.create({
      data: {
        level,
        source,
        matchCode: matchCode ?? null,
        message,
        details: details ?? undefined,
      },
    });
    const event: PipelineEventData = {
      id: row.id,
      level: row.level as PipelineEventLevel,
      source: row.source as PipelineEventSource,
      matchCode: row.matchCode,
      message: row.message,
      details: row.details as Record<string, unknown> | null,
      createdAt: row.createdAt,
    };
    pushRing(event);
    return event;
  } catch {
    // Logger hatası ana akışı bloklamaz — sessiz geç
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────
export const pipelineLogger = {
  info(source: PipelineEventSource, message: string, matchCode?: number | null, details?: Record<string, unknown> | null): void {
    writeToDb('info', source, message, matchCode, details);
  },
  warn(source: PipelineEventSource, message: string, matchCode?: number | null, details?: Record<string, unknown> | null): void {
    writeToDb('warn', source, message, matchCode, details);
  },
  error(source: PipelineEventSource, message: string, matchCode?: number | null, details?: Record<string, unknown> | null): void {
    writeToDb('error', source, message, matchCode, details);
  },
};

// ── Ring buffer reader (admin API kullanır) ────────────────────
export function getRecentEvents(
  limit: number = 50,
  level?: PipelineEventLevel,
  source?: PipelineEventSource,
): PipelineEventData[] {
  let result = ringBuffer;
  if (level) result = result.filter(e => e.level === level);
  if (source) result = result.filter(e => e.source === source);
  return result.slice(-limit).reverse();
}
