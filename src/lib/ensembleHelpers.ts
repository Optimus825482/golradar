// ── Weather Impact Calculator ──────────────────────────────────────
export function calculateWeatherImpact(weather: {
  temperature: number;
  windSpeed: number;
  precipitation: number;
} | null): { multiplier: number; factors: string[] } {
  if (!weather) return { multiplier: 1.0, factors: [] };

  let multiplier = 1.0;
  const factors: string[] = [];

  if (weather.temperature > 30) {
    multiplier -= 0.05;
    factors.push(`Sıcak hava (${weather.temperature}°C): -5%`);
  } else if (weather.temperature < 5) {
    multiplier -= 0.03;
    factors.push(`Soğuk hava (${weather.temperature}°C): -3%`);
  }

  if (weather.windSpeed > 30) {
    multiplier -= 0.08;
    factors.push(`Rüzgarlı (${weather.windSpeed} km/s): -8%`);
  } else if (weather.windSpeed > 20) {
    multiplier -= 0.03;
    factors.push(`Hafif rüzgar (${weather.windSpeed} km/s): -3%`);
  }

  if (weather.precipitation > 5) {
    multiplier -= 0.07;
    factors.push(`Yoğun yağış (${weather.precipitation.toFixed(1)} mm): -7%`);
  } else if (weather.precipitation > 1) {
    multiplier -= 0.03;
    factors.push(`Hafif yağış (${weather.precipitation.toFixed(1)} mm): -3%`);
  }

  return { multiplier: Math.max(0.7, multiplier), factors };
}

// ── Squad/Injury Impact Calculator ────────────────────────────────
export function calculateSquadImpact(squadData: {
  homeMissingPlayers: number;
  awayMissingPlayers: number;
  homeRating?: number;
  awayRating?: number;
} | null): { homeAdj: number; awayAdj: number; factors: string[] } {
  if (!squadData) return { homeAdj: 0, awayAdj: 0, factors: [] };

  let homeAdj = 0;
  let awayAdj = 0;
  const factors: string[] = [];

  if (squadData.homeMissingPlayers > 0) {
    homeAdj -= Math.min(0.15, squadData.homeMissingPlayers * 0.03);
    factors.push(`Ev eksik oyuncu: ${squadData.homeMissingPlayers} (-${(squadData.homeMissingPlayers * 3)}%)`);
  }
  if (squadData.awayMissingPlayers > 0) {
    awayAdj -= Math.min(0.15, squadData.awayMissingPlayers * 0.03);
    factors.push(`Dep. eksik oyuncu: ${squadData.awayMissingPlayers} (-${(squadData.awayMissingPlayers * 3)}%)`);
  }

  if (squadData.homeRating && squadData.awayRating) {
    const ratingDiff = squadData.homeRating - squadData.awayRating;
    if (Math.abs(ratingDiff) > 0.3) {
      const adj = Math.min(0.08, Math.abs(ratingDiff) * 0.04);
      if (ratingDiff > 0) {
        homeAdj += adj;
        factors.push(`Ev kadro kalitesi +${(adj * 100).toFixed(0)}%`);
      } else {
        awayAdj += adj;
        factors.push(`Dep. kadro kalitesi +${(adj * 100).toFixed(0)}%`);
      }
    }
  }

  return { homeAdj, awayAdj, factors };
}

// ── H2H Impact Calculator ─────────────────────────────────────────
export function calculateH2HImpact(h2h: {
  homeWins: number;
  draws: number;
  awayWins: number;
  avgGoals: number;
} | null): { goalPAdjust: number; factors: string[] } {
  if (!h2h || (h2h.homeWins + h2h.draws + h2h.awayWins) < 3) {
    return { goalPAdjust: 0, factors: [] };
  }

  let goalPAdjust = 0;
  const factors: string[] = [];
  const totalMatches = h2h.homeWins + h2h.draws + h2h.awayWins;

  if (h2h.avgGoals > 3.0) {
    goalPAdjust += 0.05;
    factors.push(`H2H yüksek gol ort. (${h2h.avgGoals.toFixed(1)}): +5%`);
  } else if (h2h.avgGoals < 1.5) {
    goalPAdjust -= 0.05;
    factors.push(`H2H düşük gol ort. (${h2h.avgGoals.toFixed(1)}): -5%`);
  }

  const homeWinRate = h2h.homeWins / totalMatches;
  const awayWinRate = h2h.awayWins / totalMatches;
  if (homeWinRate > 0.6) {
    factors.push(`H2H ev üstünlük (${(homeWinRate * 100).toFixed(0)}%)`);
  } else if (awayWinRate > 0.6) {
    factors.push(`H2H dep. üstünlük (${(awayWinRate * 100).toFixed(0)}%)`);
  }

  return { goalPAdjust: Math.max(-0.1, Math.min(0.1, goalPAdjust)), factors };
}
