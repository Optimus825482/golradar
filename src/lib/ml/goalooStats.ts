// ── Goaloo Momentum → Realistic Stats Converter ─────────────
// Goaloo momentum per-minute intensity verilerinden gerçekçi
// maç istatistikleri üretir. ML model eğitimi için kullanılır.

import type { MatchStats } from '@/lib/nesineTypes';

/**
 * Goaloo momentum + events verisinden belirli bir dakikaya kadar
 * olan istatistikleri hesapla.
 */
export function statsFromGoaloo(
  homeIntensities: number[],
  awayIntensities: number[],
  totalMinutes: number,
  goalEvents: Array<{ minute: number; isHome: boolean }>,
  cardEvents: Array<{ minute: number; isHome: boolean }>,
  upToMinute: number,
): MatchStats {
  // İlgili dakikaya kadar olan veriyi al
  const windowEnd = Math.min(upToMinute, totalMinutes);
  const homeSlice = homeIntensities.slice(0, windowEnd);
  const awaySlice = awayIntensities.slice(0, windowEnd);

  // Toplam intensity
  const homeTotalInt = homeSlice.reduce((s, v) => s + v, 0);
  const awayTotalInt = awaySlice.reduce((s, v) => s + v, 0);
  const totalInt = homeTotalInt + awayTotalInt || 1;

  // Possession: intensity oranından
  const homePoss = Math.round((homeTotalInt / totalInt) * 100);
  const awayPoss = 100 - homePoss;

  // Dangerous attacks: intensity toplamı / 5 (kalibrasyon)
  const homeDA = Math.round(homeTotalInt / 5);
  const awayDA = Math.round(awayTotalInt / 5);

  // Shots: intensity yoğunluğuna göre
  const homeShots = Math.round(homeTotalInt / 12);
  const awayShots = Math.round(awayTotalInt / 12);
  const homeSOT = Math.round(homeShots * 0.35);
  const awaySOT = Math.round(awayShots * 0.35);

  // Corners: intensity'nin bir fonksiyonu
  const homeCorners = Math.round(homeTotalInt / 30);
  const awayCorners = Math.round(awayTotalInt / 30);

  // Yellow cards: event'lerden
  const homeYC = cardEvents.filter(e => e.isHome && e.minute <= upToMinute).length;
  const awayYC = cardEvents.filter(e => !e.isHome && e.minute <= upToMinute).length;

  return {
    possession: { home: Math.min(95, homePoss), away: Math.min(95, awayPoss) },
    dangerous_attacks: { home: homeDA, away: awayDA },
    shots_total: { home: homeShots, away: awayShots },
    shots_on_target: { home: homeSOT, away: awaySOT },
    corners: { home: homeCorners, away: awayCorners },
    yellow_cards: { home: homeYC, away: awayYC },
  };
}
