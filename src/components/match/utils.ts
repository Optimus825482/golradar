import type { MatchStats } from './types'

export function calculatePressure(stats: MatchStats): { home: number; away: number } {
  let homePressure = 0
  let awayPressure = 0

  const weights: Record<string, number> = {
    possession: 0.075,
    dangerous_attacks: 0.30,
    shots_total: 0.15,
    shots_on_target: 0.25,
    corners: 0.125,
  }

  for (const [key, weight] of Object.entries(weights)) {
    const stat = stats[key]
    if (stat && stat.home != null && stat.away != null) {
      const total = stat.home + stat.away
      if (total > 0) {
        homePressure += (stat.home / total) * weight * 100
        awayPressure += (stat.away / total) * weight * 100
      }
    }
  }

  return { home: Math.round(homePressure), away: Math.round(awayPressure) }
}

export function ensureVisible(hex: string): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return hex
  let r = parseInt(m[1], 16)
  let g = parseInt(m[2], 16)
  let b = parseInt(m[3], 16)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  if (luminance >= 60) return hex
  const factor = Math.min(0.6, (80 - luminance) / (255 - luminance + 1))
  r = Math.round(r + (255 - r) * factor)
  g = Math.round(g + (255 - g) * factor)
  b = Math.round(b + (255 - b) * factor)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function catmullRomPath(points: [number, number][]): string {
  if (points.length < 2) return ''
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
  }
  return d
}

export function loadFavorites(): Set<number> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem('optimus_favorites')
    if (raw) return new Set(JSON.parse(raw))
  } catch {}
  return new Set()
}

export function saveFavorites(favs: Set<number>) {
  try {
    localStorage.setItem('optimus_favorites', JSON.stringify([...favs]))
  } catch {}
}
