import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

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

// ── TTL cleanup: remove entries older than 1h every 5min ──
const TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function cleanupStaleEntries() {
  const cutoff = Date.now() - TTL_MS;
  let removed = 0;
  for (const [code, history] of statsHistory) {
    const lastSnap = history.snapshots[history.snapshots.length - 1];
    if (lastSnap && lastSnap.timestamp < cutoff) {
      statsHistory.delete(code);
      removed++;
    }
  }
  if (removed > 0) {
    logger.info({ removed, remaining: statsHistory.size }, '[StatsHistory] TTL cleanup');
  }
}

// Run cleanup immediately, then every 5 minutes
cleanupStaleEntries();
const cleanupInterval = setInterval(cleanupStaleEntries, CLEANUP_INTERVAL_MS);
// Allow the interval to keep running; no cleanup needed on serverless dispose
if (typeof cleanupInterval?.unref === 'function') cleanupInterval.unref();

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
