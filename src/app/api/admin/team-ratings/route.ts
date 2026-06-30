// ── Admin: Team Ratings API (paginated + searchable) ────────────
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
  const search = searchParams.get('search') ?? '';
  const sortBy = searchParams.get('sortBy') ?? 'elo';
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' as const : 'desc' as const;

  const where = search
    ? { teamName: { contains: search, mode: 'insensitive' as const } }
    : {};

  const [total, rows] = await Promise.all([
    db.teamRating.count({ where }),
    db.teamRating.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    rows,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
