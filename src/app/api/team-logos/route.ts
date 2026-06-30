// ── Team Logo Batch Lookup ───────────────────────────────────────
// GET /api/team-logos?teams=Galatasaray,Fenerbahce
// Returns: { "galatasaray": "https://...", "fenerbahce": "https://..." }
// Sources: TeamMapping.fotmobLogoUrl → CSV fallback

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loadTeamLogos, getTeamLogo } from '@/lib/teamLogos';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teamsRaw = searchParams.get('teams') ?? '';
  const teamNames = teamsRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  if (teamNames.length === 0) return NextResponse.json({ logos: {} });

  const logos: Record<string, string> = {};

  try {
    // Batch lookup from DB
    const mappings = await db.teamMapping.findMany({
      where: {
        OR: teamNames.map(n => ({
          OR: [
            { canonicalName: { contains: n, mode: 'insensitive' as const } },
            { nesineName: { contains: n, mode: 'insensitive' as const } },
          ],
        })),
      },
      select: { canonicalName: true, fotmobLogoUrl: true, nesineName: true },
      take: 200,
    });

    for (const m of mappings) {
      if (m.fotmobLogoUrl) {
        logos[m.canonicalName.toLowerCase()] = m.fotmobLogoUrl;
        if (m.nesineName) logos[m.nesineName.toLowerCase()] = m.fotmobLogoUrl;
      }
    }

    // CSV fallback
    await loadTeamLogos();
    for (const name of teamNames) {
      if (!logos[name]) {
        const url = getTeamLogo(name);
        if (url) logos[name] = url;
      }
    }
  } catch {
    // Logos are cosmetic
  }

  return NextResponse.json({ logos });
}
