import { Badge } from '@/components/ui/badge'
import type { GoalProbability } from '@/lib/nesine'
import type { Match } from './types'

// ── Country Flag Helper ──

export function CountryFlag({ code }: { code: string }) {
  if (!code || code === 'FUTBOL-GENEL') return null
  const codeLower = code.toLowerCase()
  return (
    <img
      src={`https://flagcdn.com/w20/${codeLower}.png`}
      alt={code}
      className="w-4 h-3 rounded-sm object-cover inline-block mr-1"
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

// ── Match Status Badge ──

export function MatchStatusBadge({ match }: { match: Match }) {
  if (!match) return null
  if (match.isFinished) {
    return <Badge className="bg-gray-100 text-gray-500 text-xs hover:bg-gray-100 border-0">Maç Sonu</Badge>
  }
  if (match.status === 3) {
    return <Badge className="bg-amber-50 text-amber-600 text-xs hover:bg-amber-50 border border-amber-200">Devre Arası</Badge>
  }
  if (match.isLive) {
    return (
      <Badge className="bg-orange-50 text-orange-700 text-xs hover:bg-orange-50 border border-orange-200">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse mr-1" />
        {match.minute}
      </Badge>
    )
  }
  return <Badge className="bg-gray-100 text-gray-500 text-xs hover:bg-gray-100 border-0">{match.statusText}</Badge>
}

// ── Goal Radar Icon ──

export function GoalRadarIcon({ level }: { level: GoalProbability['level'] }) {
  const colorClass =
    level === 'critical' ? 'text-red-500' :
    level === 'high' ? 'text-orange-500' :
    'text-yellow-500'

  const glowClass =
    level === 'critical' ? 'drop-shadow-[0_0_6px_rgba(239,68,68,0.8)]' :
    level === 'high' ? 'drop-shadow-[0_0_4px_rgba(249,115,22,0.6)]' :
    'drop-shadow-[0_0_3px_rgba(234,179,8,0.5)]'

  return (
    <div className={`relative ${level === 'critical' ? 'animate-pulse' : ''}`}>
      <svg
        className={`w-3.5 h-3.5 ${colorClass} ${glowClass}`}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
      {level === 'critical' && (
        <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-400 rounded-full animate-ping" />
      )}
      {level === 'high' && (
        <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
      )}
    </div>
  )
}

// ── Stat Bar Component ──

export function StatBar({ label, home, away, suffix = '', isPossession = false }: {
  label: string
  home: number | null | undefined
  away: number | null | undefined
  suffix?: string
  isPossession?: boolean
}) {
  const h = home ?? 0
  const a = away ?? 0
  const total = h + a
  if (total === 0 && !isPossession) return null

  const homePercent = isPossession ? h : (total > 0 ? Math.round((h / total) * 100) : 50)
  const awayPercent = isPossession ? a : (total > 0 ? Math.round((a / total) * 100) : 50)

  const formatVal = (v: number) => {
    if (suffix === '%' || Number.isInteger(v)) return `${v}${suffix}`
    return `${v.toFixed(2)}${suffix}`
  }

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className={`text-right font-mono text-sm font-semibold text-gray-800 ${!Number.isInteger(h) ? 'w-12' : 'w-10'}`}>{formatVal(h)}</span>
      <div className="flex-1">
        <div className="text-center text-[10px] text-gray-400 mb-0.5">{label}</div>
        <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
          <div className="bg-emerald-500 transition-all duration-500 ease-out" style={{ width: `${homePercent}%` }} />
          <div className="bg-rose-500 transition-all duration-500 ease-out" style={{ width: `${awayPercent}%` }} />
        </div>
      </div>
      <span className={`text-left font-mono text-sm font-semibold text-gray-800 ${!Number.isInteger(a) ? 'w-12' : 'w-10'}`}>{formatVal(a)}</span>
    </div>
  )
}
