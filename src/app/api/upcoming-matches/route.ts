// ── Upcoming Matches from Nesine Pre-Bulten API ────────────────
// GET /api/upcoming-matches?days=3
// Fetches from cdnbulten.nesine.com/api/bulten/getprebultenfull
// Returns: array of { code, home, away, league, date, time, homeOdds, drawOdds, awayOdds }

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PREBULTEN_URL = 'https://cdnbulten.nesine.com/api/bulten/getprebultenfull';

// Known league name mappings (LC code -> league name)
const LEAGUE_MAP: Record<number, string> = {
  10151: 'Kadin Milli Maci',
  1814: 'Letonya 1. Lig',
  26050: 'ABD USL League Two',
  337: 'Belarus 1. Lig',
  10135: 'Isvec 1. Lig',
  10143: 'Hazirlik Maci',
  399: 'Isvec 2. Lig',
  1813: 'Letonya Kupasi',
  169: 'Finlandiya Kolmonen',
  10404: 'Dunya Kupasi',
  176: 'Litvanya 1. Lig',
  242: 'Estonya 1. Lig',
  350: 'Litvanya Kupasi',
  1072: 'Litvanya 2. Lig',
  150: 'Norvec 2. Lig',
  160: 'Izlanda 1. Lig',
  153: 'Isvec 3. Lig',
  155: 'Finlandiya Kakkonen',
  348: 'Brezilya Serie A',
  1873: 'Norvec Eliteserien',
  3001: 'Finlandiya Veikkausliiga',
  171: 'Danimarka 1. Lig',
  104: 'Avusturya 2. Lig',
  195: 'Isvec 1. Lig (K)',
  19114: 'Tanzanya Ligi',
  26788: 'U19 Milli Maci',
  10413: 'U20 Kadin Milli',
  10326: 'Sili Kupasi',
  10348: 'Hazirlik Maci',
  21: 'Brezilya Serie B',
  1304: 'Finlandiya Liigacup',
  5567: 'Avustralya NPL',
  16182: 'Yeni Zelanda Ligi',
  27121: 'WNBA',
  76401: 'Wimbledon (E)',
  76383: 'Wimbledon (E)',
  76384: 'Wimbledon (K)',
  76403: 'ITF (E)',
  76406: 'ITF (E)',
  76408: 'ITF (E)',
  76414: 'ITF (E)',
  76420: 'Wimbledon (E) Cift',
  76421: 'ITF (E) Cift',
  76422: 'ITF (E)',
  76423: 'ITF Cift',
  76438: 'ITF (E)',
};

interface PrebultenItem {
  C?: number;
  HN?: string;
  AN?: string;
  D?: string;
  T?: string;
  DAY?: string;
  LC?: number;
  BC?: string;
  TYPE?: number;
  MA?: Array<{
    MT?: number;
    OCA?: Array<{ N?: number; O?: number }>;
  }>;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const maxDays = Math.min(7, Math.max(1, parseInt(searchParams.get('days') ?? '3')));

  try {
    const resp = await fetch(PREBULTEN_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.nesine.com/',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      return NextResponse.json({ matches: [], error: `HTTP ${resp.status}` });
    }

    const data = await resp.json();
    const items: PrebultenItem[] = data?.sg?.EA ?? [];

    if (items.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    const now = new Date();
    const cutoff = new Date(now.getTime() + maxDays * 86400000);

    const matches = items
      .filter(item => {
        // Sadece TYPE=1 (futbol). TYPE=5 (tenis), TYPE=2 (basketbol), vb. degil.
        if (item.TYPE !== 1) return false;
        if (!item.HN || !item.AN) return false;
        if (!item.D) return false;

        // E-spor: takim adinda (X) formatinda oyuncu adi var (Bayern Munich (Leonardo))
        if (/\([A-Za-z]+\)/.test(item.HN) || /\([A-Za-z]+\)/.test(item.AN)) return false;

        // LC 10xxx = ozel bahisler (gol krali, sampiyon, vs.)
        const lc = item.LC ?? 0;
        if (lc === 10008 || lc === 10410) return false;

        // Parse date
        const [d, m, y] = item.D.split('.');
        const matchDate = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
        if (isNaN(matchDate.getTime())) return false;

        // Only upcoming (today or future, within maxDays)
        const matchEnd = new Date(matchDate.getTime() + 86400000); // +1 day
        return matchEnd >= now && matchDate <= cutoff;
      })
      .map(item => {
        // Extract odds from first market
        const market = item.MA?.[0];
        const oca = market?.OCA ?? [];
        const homeOdds = oca.find(o => o.N === 1)?.O ?? null;
        const drawOdds = oca.find(o => o.N === 2)?.O ?? null;
        const awayOdds = oca.find(o => o.N === 3)?.O ?? null;

        return {
          code: item.C ?? 0,
          home: item.HN ?? '',
          away: item.AN ?? '',
          league: LEAGUE_MAP[item.LC ?? 0] ?? '',
          date: item.D ?? '',
          time: item.T ?? '',
          day: item.DAY ?? '',
          homeOdds,
          drawOdds,
          awayOdds,
        };
      })
      .sort((a, b) => {
        // Sort by date then time
        const [ad, am, ay] = a.date.split('.');
        const [bd, bm, by] = b.date.split('.');
        const da = new Date(parseInt(ay), parseInt(am) - 1, parseInt(ad));
        const db = new Date(parseInt(by), parseInt(bm) - 1, parseInt(bd));
        if (da.getTime() !== db.getTime()) return da.getTime() - db.getTime();
        return a.time.localeCompare(b.time);
      });

    return NextResponse.json({ matches, count: matches.length });
  } catch (err) {
    return NextResponse.json({ matches: [], error: String(err) });
  }
}
