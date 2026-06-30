// ── Admin: National Team Elo Ratings API ─────────────────────────
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(200, parseInt(searchParams.get('limit') ?? '50'));
  const search = searchParams.get('search') ?? '';

  const where = search
    ? { OR: [
        { countryName: { contains: search, mode: 'insensitive' as const } },
        { countryCode: { contains: search, mode: 'insensitive' as const } },
      ]}
    : {};

  const [total, rows] = await Promise.all([
    db.nationalTeamElo.count({ where }),
    db.nationalTeamElo.findMany({
      where,
      orderBy: { rank: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({ rows, total, page, totalPages: Math.ceil(total / limit) });
}
