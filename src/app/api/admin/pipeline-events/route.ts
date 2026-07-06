// ── Pipeline Events API ────────────────────────────────────────
// Admin paneli için pipeline olaylarını döndürür.
// GET  /api/admin/pipeline-events?limit=50&level=error&source=cron&since=ISO
// POST /api/admin/pipeline-events — yeni olay ekle (pipeline-service kullanır)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  getRecentEvents,
  type PipelineEventLevel,
  type PipelineEventSource,
} from '@/lib/pipelineLogger';

export const dynamic = 'force-dynamic';

// ── GET: olayları oku ─────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', '10'), 500);
  const level = searchParams.get('level') as PipelineEventLevel | null;
  const source = searchParams.get('source') as PipelineEventSource | null;
  const since = searchParams.get('since') ? new Date(searchParams.get('since')!) : null;

  try {
    // Önce ring buffer'dan dene (hızlı)
    const ring = getRecentEvents(limit, level ?? undefined, source ?? undefined);
    if (ring.length > 0 && !since) {
      return NextResponse.json({ ok: true, events: ring, source: 'ring' });
    }

    // Ring buffer boş veya since filtresi var → DB'den oku
    const where: Record<string, unknown> = {};
    if (level) where.level = level;
    if (source) where.source = source;
    if (since) where.createdAt = { gte: since };

    const events = await db.pipelineEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ ok: true, events, source: 'db' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// ── POST: yeni olay ekle (pipeline-service'ten HTTP çağrısı) ──
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { level, source, matchCode, message, details } = body;

    if (!level || !source || !message) {
      return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
    }

    const row = await db.pipelineEvent.create({
      data: {
        level,
        source,
        matchCode: matchCode ?? null,
        message,
        details: details ?? undefined,
      },
    });

    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
