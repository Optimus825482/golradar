// ── Side helpers (Faz 8 parçalama) ────────────────────────────────
// GoalRadar.ts dosyasından çıkarıldı. İki helper:
//   - determineSide: score-based, `goalRadar.ts:calculateGoalProbability`
//     içinden çağrılır (pressureHistory opsiyonel).
//   - determineSideByStats: stats-based, `ensemble.ts:predictEnsemble`
//     içinden çağrılır.
//
// Tek semantik (Faz 7 PR'ında belirlendi): score >= 60 ya da sustained
// (40-59) + son 3 pressure spike >= 2 → o taraf "on". İki taraf true
// ise "both", hiçbiri değil ise "null".

import type { PressureSnapshotLite } from '../goalRadar';
import type { MatchStats } from '../nesineTypes';

// ── Thresholds (Faz 7 — score-based) ────────────────────────────
const SUSTAINED_THRESHOLD = 40;
const RADAR_THRESHOLD = 60;
const SPIKE_THRESHOLD = 55;
const SPIKE_MIN_COUNT = 2;

// ── determineSide: score + son 3 pressure spike ──────────────────
export function determineSide(
  homeScore: number,
  awayScore: number,
  pressureHistory?: PressureSnapshotLite[],
): "home" | "away" | "both" | null {
  const last3 = pressureHistory?.slice(-3) ?? [];
  const homeSustained =
    homeScore >= SUSTAINED_THRESHOLD && homeScore < RADAR_THRESHOLD;
  const awaySustained =
    awayScore >= SUSTAINED_THRESHOLD && awayScore < RADAR_THRESHOLD;
  const homeSpike =
    last3.filter((s) => s.homePressure > SPIKE_THRESHOLD).length >= SPIKE_MIN_COUNT;
  const awaySpike =
    last3.filter((s) => s.awayPressure > SPIKE_THRESHOLD).length >= SPIKE_MIN_COUNT;
  const homeOn =
    homeScore >= RADAR_THRESHOLD || (homeSustained && homeSpike);
  const awayOn =
    awayScore >= RADAR_THRESHOLD || (awaySustained && awaySpike);
  if (homeOn && awayOn) return "both";
  if (homeOn) return "home";
  if (awayOn) return "away";
  return null;
}

// ── determineSideByStats: ensemble heuristic ──────────────────────
// Eski kod: dangerous_attacks + SoT×2 composite pressure, 1.5× ratio
// → tek taraf, > 3 + > 3 → both.
export function determineSideByStats(
  stats: MatchStats,
): "home" | "away" | "both" | null {
  const getStat = (key: string, side: "home" | "away"): number => {
    const s = stats[key];
    if (!s) return 0;
    return (side === "home" ? s.home : s.away) ?? 0;
  };
  const homePressure =
    getStat("dangerous_attacks", "home") +
    getStat("shots_on_target", "home") * 2;
  const awayPressure =
    getStat("dangerous_attacks", "away") +
    getStat("shots_on_target", "away") * 2;
  if (homePressure > awayPressure * 1.5) return "home";
  if (awayPressure > homePressure * 1.5) return "away";
  if (homePressure > 3 && awayPressure > 3) return "both";
  return null;
}
