// ── Backfill: PredictionLog goalScored Labels ────────────────
// Existing kayıtlarda goalScored=NULL olanları Goaloo events ile doldurur.
// POST /api/admin/ml/backfill-labels
// Body: { maxMatches?: number }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logError } from '@/lib/devLog';

export const dynamic = 'force-dynamic';
export const maxDuration = 600; // 10 dk

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const maxMatches = Math.min(body.maxMatches ?? 5000, 50000);

    // PredictionLog'dan goalScored=NULL olan eşsiz maçları bul
    const nullRecords = await db.predictionLog.findMany({
      where: { goalScored: null },
      select: { matchCode: true, homeTeam: true, awayTeam: true, league: true },
      distinct: ['matchCode'],
      take: maxMatches,
    });

    const { findGoalooMatchForNesine, fetchGoalooMatchEvents } = await import('@/lib/goaloo');

    let updated = 0;
    let errors = 0;

    for (const rec of nullRecords) {
      try {
        // Goaloo mapping
        const mapping = await findGoalooMatchForNesine(rec.homeTeam, rec.awayTeam, '');
        if (!mapping) continue;

        const events = await fetchGoalooMatchEvents(mapping.goalooMatchId).catch(() => []);
        const goalMinutes = events
          .filter((e: any) => e.type === 'goal' && e.minute)
          .map((e: any) => e.minute);

        if (goalMinutes.length === 0) continue;

        // Her PredictionLog kaydını güncelle
        const logs = await db.predictionLog.findMany({
          where: { matchCode: rec.matchCode, goalScored: null },
          select: { id: true, minute: true },
        });

        for (const log of logs) {
          const goalAfter = goalMinutes.some((gm: number) => gm > log.minute);
          await db.predictionLog.update({
            where: { id: log.id },
            data: { goalScored: goalAfter },
          });
          updated++;
        }
      } catch {
        errors++;
      }
    }

    return NextResponse.json({
      ok: true,
      matchesProcessed: nullRecords.length,
      recordsUpdated: updated,
      errors,
    });
  } catch (err) {
    logError('backfill-labels', 'Failed:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
