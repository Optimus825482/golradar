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

const TEAM_COLORS = { home: "#f97316", away: "#3b82f6" };

export function ensureVisible(
  hex: string,
  teamSide: "home" | "away" = "home",
): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return teamSide === "home" ? TEAM_COLORS.home : TEAM_COLORS.away;
  let r = parseInt(m[1], 16);
  let g = parseInt(m[2], 16);
  let b = parseInt(m[3], 16);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // If already visible and not too close to gray, use as-is
  if (luminance >= 55) return hex;
  // Boost to visible luminance
  const factor = (80 - luminance) / (255 - luminance + 1);
  const clampedFactor = Math.max(0.3, Math.min(0.7, factor));
  r = Math.round(r + (255 - r) * clampedFactor);
  g = Math.round(g + (255 - g) * clampedFactor);
  b = Math.round(b + (255 - b) * clampedFactor);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function differentiateColors(c1: string, c2: string): [string, string] {
  const p1 = ensureVisible(c1, "home");
  let p2 = ensureVisible(c2, "away");
  // Check color distance
  const m1 = p1.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  const m2 = p2.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m1 && m2) {
    const rDiff = Math.abs(parseInt(m1[1], 16) - parseInt(m2[1], 16));
    const gDiff = Math.abs(parseInt(m1[2], 16) - parseInt(m2[2], 16));
    const bDiff = Math.abs(parseInt(m1[3], 16) - parseInt(m2[3], 16));
    // If colors are too similar, force default pair
    if (rDiff + gDiff + bDiff < 120) {
      return [TEAM_COLORS.home, TEAM_COLORS.away];
    }
  }
  return [p1, p2];
}

export function catmullRomPath(points: [number, number][]): string {
  if (points.length < 2) return ''
  if (points.length === 2) {
    return `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)} L ${points[1][0].toFixed(2)} ${points[1][1].toFixed(2)}`;
  }

  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const gap = Math.abs(p2[0] - p1[0]);

    // For large gaps (>15% of chart width), use straight line to prevent overshoot
    if (gap > points[points.length - 1][0] * 0.15) {
      d += ` L ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
      continue;
    }

    const p0 = points[i - 1] || p1;
    const p3 = points[i + 2] || p2;

    // Reduced tension for stability (was /6, now /8)
    const tension = 8;
    let cp1x = p1[0] + (p2[0] - p0[0]) / tension;
    let cp1y = p1[1] + (p2[1] - p0[1]) / tension;
    let cp2x = p2[0] - (p3[0] - p1[0]) / tension;
    let cp2y = p2[1] - (p3[1] - p1[1]) / tension;

    // Clamp control points to prevent overshoot beyond data ranges
    const yMin = Math.min(p1[1], p2[1]);
    const yMax = Math.max(p1[1], p2[1]);
    const yRange = Math.max(yMax - yMin, 1);
    cp1y = Math.max(p1[1] - yRange * 2, Math.min(p1[1] + yRange * 2, cp1y));
    cp2y = Math.max(p2[1] - yRange * 2, Math.min(p2[1] + yRange * 2, cp2y));
    // Clamp x to prevent going backwards
    cp1x = Math.max(p1[0], Math.min(p2[0], cp1x));
    cp2x = Math.max(cp1x, Math.min(p2[0], cp2x));

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
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
