// ── Debug: Ham Nesine verisini göster ─────────────────────────────
// GET /api/debug-nesine — Nesine API'den gelen canlı maçların tüm
// alanlarını gösterir. Hangi alanın canlı bahis durumunu belirttiğini
// bulmak için kullanılır.
// NOT: Bu endpoint sadece debug amaçlıdır, production'da kaldırılmalıdır.

import { NextResponse } from 'next/server';
import { LIVESCORE_API, HEADERS, ACTIVE_STATUSES } from '@/lib/nesine';

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const resp = await fetch(`${LIVESCORE_API}?sportType=1&v=0`, {
      headers: HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      return NextResponse.json({ error: `API returned ${resp.status}` }, { status: 502 });
    }
    const text = await resp.text();
    const data = JSON.parse(text);
    const rawMatches = data.d || [];

    // Sadece canlı (aktif) maçları al, her birinin tüm alanlarını göster
    const liveMatches = rawMatches.filter((m: any) => {
      const status = m.S || 0;
      return ACTIVE_STATUSES.has(status);
    });

    const sample = liveMatches.slice(0, 5).map((m: any) => {
      // Tüm key'leri al (SE/SE1/SE2 gibi büyük array'leri hariç tut)
      const allKeys = Object.keys(m);
      const fields: Record<string, unknown> = {};
      for (const k of allKeys) {
        const v = m[k];
        if (Array.isArray(v)) {
          fields[k] = `Array[${v.length}]`;
        } else if (typeof v === 'object' && v !== null) {
          fields[k] = `Object`;
        } else {
          fields[k] = v;
        }
      }
      return fields;
    });

    return NextResponse.json({
      totalRaw: rawMatches.length,
      totalLive: liveMatches.length,
      // Tüm olası key'ler (ilk 3 maçtan)
      allPossibleKeys: [...new Set(liveMatches.slice(0, 3).flatMap((m: any) => Object.keys(m)))],
      sample,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
