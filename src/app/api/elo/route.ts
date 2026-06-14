import { NextResponse } from 'next/server';
import { getRating, predictFromElo, getAllRatings, updateRatings, getFormIndex } from '@/lib/eloRating';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'predict';
  const homeTeam = searchParams.get('home') || '';
  const awayTeam = searchParams.get('away') || '';

  try {
    switch (action) {
      case 'predict': {
        if (!homeTeam || !awayTeam) {
          return NextResponse.json({ error: 'home and away team names required' }, { status: 400 });
        }
        const prediction = predictFromElo(homeTeam, awayTeam);
        const homeForm = getFormIndex(homeTeam);
        const awayForm = getFormIndex(awayTeam);
        return NextResponse.json({ ...prediction, homeForm, awayForm });
      }

      case 'rating': {
        const team = searchParams.get('team');
        if (!team) {
          return NextResponse.json({ error: 'team name required' }, { status: 400 });
        }
        const rating = getRating(team);
        const form = getFormIndex(team);
        return NextResponse.json({ ...rating, formIndex: form });
      }

      case 'all': {
        const ratings = getAllRatings();
        const result: Record<string, any> = {};
        ratings.forEach((v, k) => { result[k] = { ...v, formIndex: getFormIndex(k) }; });
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, homeTeam, awayTeam, homeGoals, awayGoals, matches } = body;

    if (action === 'update' && homeTeam && awayTeam && homeGoals != null && awayGoals != null) {
      const result = updateRatings(homeTeam, awayTeam, homeGoals, awayGoals);
      return NextResponse.json(result);
    }

    if (action === 'batch' && Array.isArray(matches)) {
      const { importMatchResults } = await import('@/lib/eloRating');
      importMatchResults(matches);
      return NextResponse.json({ success: true, count: matches.length });
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
