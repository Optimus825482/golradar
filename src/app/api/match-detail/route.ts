import { NextRequest, NextResponse } from 'next/server'

// Reuse the same global stats history store
interface StatSnapshot {
  minute: number
  timestamp: number
  home: Record<string, number | null>
  away: Record<string, number | null>
  homePressure: number
  awayPressure: number
}

interface MatchHistory {
  homeTeam: string
  awayTeam: string
  league: string
  country: string
  snapshots: StatSnapshot[]
}

const globalForStats = globalThis as unknown as {
  statsHistory: Map<number, MatchHistory> | undefined
}
if (!globalForStats.statsHistory) {
  globalForStats.statsHistory = new Map()
}
const statsHistory = globalForStats.statsHistory

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = parseInt(searchParams.get('code') || '0', 10)

  if (!code) {
    return NextResponse.json({ error: 'Missing code parameter' }, { status: 400 })
  }

  const history = statsHistory.get(code)
  if (history) {
    return NextResponse.json({
      matchCode: code,
      homeTeam: history.homeTeam,
      awayTeam: history.awayTeam,
      league: history.league,
      country: history.country,
      snapshots: history.snapshots,
    })
  }

  return NextResponse.json({ matchCode: code, snapshots: [] })
}
