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
//
// Faz 10 (iyileştirme): artık threshold-based değil, homeScore/awayScore
// oranına dayalı. Böylece 100 puanlık skor bilgisinin tamamı kullanılır.

import type { PressureSnapshotLite } from './types';
import type { MatchStats } from '../nesineTypes';
import { RADAR_THRESHOLD, SUSTAINED_THRESHOLD } from '@/config';

// ── Thresholds (Faz 7 — score-based) ────────────────────────────
// SPIKE_THRESHOLD / SPIKE_MIN_COUNT not in config yet — kept local
const SPIKE_THRESHOLD = 55;
const SPIKE_MIN_COUNT = 2;

// ── determineSide: skor oranı + pressure spike ──────────────────
export function determineSide(
  homeScore: number,
  awayScore: number,
  pressureHistory?: PressureSnapshotLite[],
): "home" | "away" | "both" | null {
  const totalScore = homeScore + awayScore;
  if (totalScore < SUSTAINED_THRESHOLD) return null;

  // Yeni: oran-based belirleme — homeScore/awayScore dağılımını kullan
  const homeRatio = homeScore / Math.max(1, totalScore);
  const awayRatio = 1 - homeRatio;

  // Eşikler: away deplasmanda daha az baskı üretir → eşik 0.58
  // home 0.62, away 0.58 — deplasman baskısı daha değerli
  if (homeRatio > 0.62 && homeScore >= RADAR_THRESHOLD) return "home";
  if (awayRatio > 0.58 && awayScore >= RADAR_THRESHOLD) return "away";

  // Sustained pressure spike (eski logic koru)
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
    (homeRatio > 0.55 && homeSustained && homeSpike);
  const awayOn =
    (awayRatio > 0.55 && awaySustained && awaySpike);

  // Her iki taraf da eşit derecede yüksekse "both"
  if (homeScore >= RADAR_THRESHOLD && awayScore >= RADAR_THRESHOLD && Math.abs(homeRatio - 0.5) < 0.12) return "both";
  if (homeOn && awayOn) return "both";
  if (homeOn) return "home";
  if (awayOn) return "away";

  // Hiçbiri net değilse null — sinyal üretilmez
  return null;
}

// ── determineSideByStats: ensemble heuristic ──────────────────────
// Yeni: skor oranına dayalı — ensemble'dan gelen score bilgisini kullan
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

  const totalPressure = homePressure + awayPressure;
  if (totalPressure < 3) return null;

  const homeRatio = homePressure / Math.max(1, totalPressure);
  if (homeRatio > 0.62) return "home";
  if (homeRatio < 0.35) return "away";
  if (homePressure > 3 && awayPressure > 3) return "both";
  return null;
}
