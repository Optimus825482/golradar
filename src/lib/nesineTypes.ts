// ── Shared types used by nesine.ts and goalRadar.ts ──

export interface MatchStats {
  shots_on_target?: { home: number; away: number };
  shots_off_target?: { home: number; away: number };
  dangerous_attacks?: { home: number; away: number };
  attacks?: { home: number; away: number };
  possession?: { home: number; away: number };
  corners?: { home: number; away: number };
  yellow_cards?: { home: number; away: number };
  red_cards?: { home: number; away: number };
  two_yellow_red?: { home: number; away: number };
  shots_blocked?: { home: number; away: number };
  shots_total?: { home: number; away: number };
  xg?: { home: number; away: number };
  free_kicks?: { home: number; away: number };
  // ── Yeni eklenen Nesine alanları (ET_MAP'te var, algoritmada yeni kullanılıyor) ──
  fouls?: { home: number; away: number };
  saves?: { home: number; away: number };
  pass_accuracy?: { home: number; away: number };
  offsides?: { home: number; away: number };
  goal_kicks?: { home: number; away: number };
  throw_ins?: { home: number; away: number };
  corners_1h?: { home: number; away: number };
  corners_2h?: { home: number; away: number };
  rcs?: { home: number; away: number };
  [key: string]: { home: number; away: number } | undefined;
}

export function calculatePressure(stats: MatchStats): { home: number; away: number } {
  if (!stats) return { home: 50, away: 50 };

  const sotH = stats.shots_on_target?.home ?? 0;
  const sotA = stats.shots_on_target?.away ?? 0;
  const daH = stats.dangerous_attacks?.home ?? 0;
  const daA = stats.dangerous_attacks?.away ?? 0;
  const attH = stats.attacks?.home ?? 0;
  const attA = stats.attacks?.away ?? 0;
  const corH = stats.corners?.home ?? 0;
  const corA = stats.corners?.away ?? 0;
  // Yeni: saves — rakip kaleci kurtarıyorsa takım baskı altında
  // (ters mantık: rakibin saves'i senin baskını gösterir)
  const savesOppH = stats.saves?.away ?? 0;
  const savesOppA = stats.saves?.home ?? 0;

  const homeScore = sotH * 3 + daH * 1.5 + attH * 0.5 + corH * 1 + savesOppH * 1.5;
  const awayScore = sotA * 3 + daA * 1.5 + attA * 0.5 + corA * 1 + savesOppA * 1.5;
  const total = homeScore + awayScore;
  if (total === 0) return { home: 50, away: 50 };

  return {
    home: Math.round((homeScore / total) * 100),
    away: Math.round((awayScore / total) * 100),
  };
}
