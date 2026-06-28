// ── Backfill: PredictionLog goalScored Labels (DB tabanlı) ───
// Existing kayıtlarda goalScored=NULL olanları Goaloo events ile doldurur.
// Goaloo mapping için findGoalooMatchForNesine API'si yerine
// veritabanındaki goaloo-bulk kayıtlarını kullanır — çok daha hızlı.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logError } from '@/lib/devLog';
import { adminRoute } from '@/lib/adminRoute';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

// FIX: Added auth wrapper (was missing)
export const POST = adminRoute(async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const maxMatches = Math.min(body.maxMatches ?? 5000, 50000);

    // PredictionLog'dan goalScored=NULL olan eşsiz maçları bul
    // Sadece champion ve nesine-historical variantları
    const nullRecords = await db.predictionLog.findMany({
      where: {
        goalScored: null,
        modelVariant: { in: ['champion', 'nesine-historical'] },
      },
      select: { matchCode: true, homeTeam: true, awayTeam: true },
      distinct: ['matchCode'],
      take: maxMatches,
    });

    // Goaloo-bulk kayıtlarından matchCode → goal minutes mapping oluştur
    // Bunlar Goaloo scheduleId'si içerir, Goaloo events ile eşleşir
    const goalooMatches = await db.predictionLog.findMany({
      where: { modelVariant: 'goaloo-bulk', goalScored: { not: null } },
      select: { matchCode: true, homeTeam: true, awayTeam: true, goalScored: true, minute: true },
    });

    // Group goal minutes by matchCode
    const goalsByMatch = new Map<number, number[]>();
    for (const gm of goalooMatches) {
      if (!gm.goalScored) continue;
      if (!goalsByMatch.has(gm.matchCode)) goalsByMatch.set(gm.matchCode, []);
      goalsByMatch.get(gm.matchCode)!.push(gm.minute);
    }

    // Fuzzy homeTeam eşleştirme cache
    const teamMatchCache = new Map<string, number>();
    for (const [matchCode, _goalMinutes] of goalsByMatch) {
      // matchCode = Goaloo scheduleId
    }

    let updated = 0;
    let errors = 0;

    for (const rec of nullRecords) {
      try {
        // Fuzzy team matching: goaloo-bulk kayıtları arasında aynı takım adını bul
        const homeLower = rec.homeTeam.toLowerCase();
        const awayLower = rec.awayTeam.toLowerCase();

        // Goaloo'dan eşleşen maç kodunu bul (fuzzy team name)
        let goalooMatchCode: number | null = null;
        for (const [matchCode, _goals] of goalsByMatch) {
          // Check if any goaloo-bulk record has same team names
          const goalooRec = goalooMatches.find(
            g => g.matchCode === matchCode &&
            (g.homeTeam.toLowerCase().includes(homeLower) || homeLower.includes(g.homeTeam.toLowerCase())) &&
            (g.awayTeam.toLowerCase().includes(awayLower) || awayLower.includes(g.awayTeam.toLowerCase()))
          );
          if (goalooRec) {
            goalooMatchCode = matchCode;
            break;
          }
        }

        if (!goalooMatchCode) continue;
        const goalMinutes = goalsByMatch.get(goalooMatchCode) || [];

        // Her PredictionLog kaydını güncelle
        const logs = await db.predictionLog.findMany({
          where: { matchCode: rec.matchCode, goalScored: null },
          select: { id: true, minute: true },
        });

        for (const log of logs) {
          const goalAfter = goalMinutes.some(gm => gm > log.minute);
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
      goalooMatchesInDb: goalsByMatch.size,
      recordsUpdated: updated,
      errors,
    });
  } catch (err) {
    logError('backfill-labels', 'Failed:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
