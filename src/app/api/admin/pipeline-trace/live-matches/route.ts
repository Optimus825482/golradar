// ── Live Matches API ────────────────────────────────────────────
// Admin debug sayfası için canlı maç listesi döndürür.
// GET /api/admin/pipeline-trace/live-matches

import { NextResponse } from 'next/server';
import { LIVESCORE_API, HEADERS, ACTIVE_STATUSES, FINISHED_STATUSES, calculateMinute } from '@/lib/nesine';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const resp = await fetch(`${LIVESCORE_API}?sportType=1&v=0`, {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const data = await resp.json();
    if (data.sc !== 200 || !Array.isArray(data.d)) {
      return NextResponse.json({ ok: false, matches: [] });
    }

    const matches = data.d
      .filter((m: any) => {
        const s = (m.S as number) || 0;
        return ACTIVE_STATUSES.has(s) && !FINISHED_STATUSES.has(s) && m.HT && m.AT;
      })
      .map((m: any) => {
        const rawMin = String(m.M || '');
        const minute = rawMin && rawMin !== "0"
          ? rawMin
          : calculateMinute(m, new Date()) || rawMin || "0";
        return {
          matchCode: m.C as number,
          homeTeam: m.HT as string,
          awayTeam: m.AT as string,
          league: (m.L as string) || '',
          status: (m.S as number) || 0,
          minute,
          homeGoals: (m.ES?.[0]?.H as number) ?? 0,
          awayGoals: (m.ES?.[0]?.A as number) ?? 0,
        };
      })
      .slice(0, 100); // max 100 maç

    return NextResponse.json({ ok: true, matches });
  } catch {
    return NextResponse.json({ ok: false, matches: [] });
  }
}
