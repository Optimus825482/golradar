// ── Admin: Clear Signals API ────────────────────────────────────
// POST /api/admin/clear-signals — Clear all signal records from DB
// GET /api/admin/clear-signals — Get signal table stats

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from '@/lib/devLog';

export const dynamic = "force-dynamic";

async function requireAdmin(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth) return { ok: false, reason: "no auth header" };
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, reason: "malformed auth header" };
  return validateSession(m[1].trim());
}

// GET — Signal tablosu istatistikleri + onay gerektiren bilgi
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const total = await db.signal.count();
    const pending = await db.signal.count({ where: { goalHappened: null } });
    const resolved = await db.signal.count({ where: { goalHappened: { not: null } } });
    const withGoal = await db.signal.count({ where: { goalHappened: true } });
    const oldest = await db.signal.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    const newest = await db.signal.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });

    return NextResponse.json({
      total,
      pending,
      resolved,
      withGoal,
      oldest: oldest?.createdAt || null,
      newest: newest?.createdAt || null,
    });
  } catch (err) {
    logError('admin/clear-signals', err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// POST — Signal tablosunu temizle (confirmCode ile korumalı)
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const confirmCode = b.confirmCode;
  const targetDate = b.targetDate as string | undefined; // optional: "2026-06-19" format

  // Güvenlik: confirmCode "SIGNAL-CLEAR" olmalı
  if (confirmCode !== "SIGNAL-CLEAR") {
    return NextResponse.json({ error: "invalid_confirm_code" }, { status: 400 });
  }

  try {
    let deletedCount: number;

    if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      // Belirli bir tarihten öncekileri temizle
      const date = new Date(targetDate);
      date.setDate(date.getDate() + 1); // o gün dahil
      const result = await db.signal.deleteMany({
        where: { createdAt: { lt: date } },
      });
      deletedCount = result.count;
    } else {
      // Tüm sinyalleri temizle
      const result = await db.signal.deleteMany({});
      deletedCount = result.count;
    }

    return NextResponse.json({
      ok: true,
      deleted: deletedCount,
      message: `${deletedCount} sinyal kaydı silindi`,
    });
  } catch (err) {
    logError('admin/clear-signals', err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
