// Nesine API constants and helpers
import type { MatchStats as _MatchStats } from './nesineTypes';
import { calculatePressure as _calculatePressure } from './nesineTypes';
import { ET_MAP } from '../../mini-services/shared/nesineLiveTypes';

export type { MatchStats } from './nesineTypes';
export { calculatePressure } from './nesineTypes';
export { calculateGoalProbability, type GoalProbability, type PressureSnapshotLite } from './goalRadar';

export const LIVESCORE_API = "https://ls.nesine.com/api/v2/LiveScore/GetLiveMatchListWithVersion";
export const UNLIVE_API = "https://ls.nesine.com/api/v2/LiveScore/GetUnliveMatches";
const SOCKET_VERSION_API = "https://ls.nesine.com/api/v2/LiveScore/GetSocketVersionByRoomName";

export const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Referer: "https://www.nesine.com/",
  Origin: "https://www.nesine.com",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
};

// Status map (Turkish)
const STATUS_MAP: Record<number, string> = {
  0: "Tanımsız",
  1: "Başlamadı",
  2: "1. Yarı",
  3: "Devre Arası",
  4: "2. Yarı",
  5: "Maç Sonu",
  6: "1. Periyot",
  7: "2. Periyot",
  8: "3. Periyot",
  9: "4. Periyot",
  10: "5. Periyot",
  11: "1. Çeyrek",
  12: "2. Çeyrek",
  13: "3. Çeyrek",
  14: "4. Çeyrek",
  15: "Ertelendi",
  16: "Uzatma",
  17: "İptal",
  18: "Duraklama",
  19: "Penalti",
  20: "Uzt. 1. Yarı",
  21: "Uzt. 2. Yarı",
  22: "Uzt. Sonu",
  23: "Kesildi",
  24: "Penalti Sonu",
  25: "Uzatma Bekleniyor",
  26: "Penalti Bekleniyor",
  27: "Terk Edildi",
  28: "Uzt. Devre Arası",
};

// Excluded statuses (KSL/İptal/Ertelenen/Kesilen)
export const EXCLUDED_STATUSES = new Set([15, 17, 23, 27, 46, 47, 54, 55, 56, 57]);

// Active live statuses
export const ACTIVE_STATUSES = new Set([2, 3, 4, 16, 18, 19, 20, 21, 25, 26, 28]);

// Finished statuses
export const FINISHED_STATUSES = new Set([5, 22, 24]);

// Stats to display
const FOOTBALL_STAT_DISPLAY = [
  { key: "possession", label: "Topa Sahip", isPercent: true },
  { key: "dangerous_attacks", label: "Tehlikeli Hücum" },
  { key: "shots_total", label: "Toplam Şut" },
  { key: "shots_on_target", label: "İsabetli Şut" },
  { key: "shots_off_target", label: "İsabetsiz Şut" },
  { key: "shots_blocked", label: "Bloklanan Şut" },
  { key: "corners", label: "Korner" },
  { key: "offsides", label: "Ofsayt" },
  { key: "fouls", label: "Faul" },
  { key: "free_kicks", label: "Serbest Vuruş" },
  { key: "yellow_cards", label: "Sarı Kart" },
  { key: "red_cards", label: "Kırmızı Kart" },
  { key: "xg", label: "xG" },
];

export interface ParsedMatch {
  code: number;
  bid: number;
  league: string;
  leagueId: number;
  home: string;
  away: string;
  homeTr: string;
  awayTr: string;
  homeGoals: number;
  awayGoals: number;
  firstHalfScore: string;
  minute: string;
  status: number;
  statusText: string;
  time: string;
  isLive: boolean;
  isFinished: boolean;
  country: string;
  stats: _MatchStats;
  hasStats: boolean;
  homeColor: string | null;
  awayColor: string | null;
  homeAbbrev: string | null;
  awayAbbrev: string | null;
}

function parseStats(seArray: any[]): _MatchStats {
  const stats: _MatchStats = {};
  for (const e of seArray || []) {
    const et = e.ET as number;
    const key = ET_MAP[et];
    if (!key) continue;
    const h = e.H != null && e.H !== "-" ? Number(e.H) : null;
    const a = e.A != null && e.A !== "-" ? Number(e.A) : null;
    stats[key] = { home: h, away: a };
  }
  return stats;
}

// MDT (MatchDateTimes) Type codes from Nesine API:
//   T=1  = FirstHalfStartDate   (1. Yarı Başlangıcı)
//   T=2  = FirstHalfFinishDate  (1. Yarı Bitişi / Devre Arası Başlangıcı)
//   T=3  = SecondHalfStartDate  (2. Yarı Başlangıcı)
//   T=4  = SecondHalfFinishDate (2. Yarı Bitişi)
//   T=5  = OverTimeFirstHalfStartDate  (Uzatma 1. Yarı Başlangıcı)
//   T=6  = OverTimeFirstHalfFinishDate (Uzatma 1. Yarı Bitişi)
//   T=7  = OverTimeSecondHalfStartDate  (Uzatma 2. Yarı Başlangıcı)
//   T=8  = OverTimeSecondHalfFinishDate (Uzatma 2. Yarı Bitişi)
//   T=9  = GameStarted          (Maç Başlangıcı)
//   T=10 = GameEnded            (Maç Bitişi)
//   T=19 = HalftimeStart        (Devre Arası Başlangıcı - alternatif)

function getMdtTimestamp(mdtList: any[], mdtType: number): Date | null {
  for (const mdt of mdtList) {
    if (mdt.T === mdtType) {
      const v = mdt.V || mdt.value || "";
      if (v) {
        try {
          return new Date(v);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function calculateMinute(match: any, now: Date): string {
  const status = match.S || 0;
  const mdtList = match.MDT || [];

  if (status === 5) return "MS";
  if (status === 15) return "ERT";
  if (status === 17) return "İPT";
  if (status === 23) return "KSL";
  if (status === 27) return "TRK";
  if (status === 3) return "DA";

  if (status === 2) {
    // 1st half: started at T=1 (FirstHalfStartDate)
    const start = getMdtTimestamp(mdtList, 1);
    if (start) {
      const elapsed = Math.floor((now.getTime() - start.getTime()) / 60000);
      if (elapsed > 45) return `45+${elapsed - 45}'`;
      if (elapsed < 1) return `1'`;
      return `${elapsed}'`;
    }
  } else if (status === 4) {
    // 2nd half: started at T=3 (SecondHalfStartDate)
    // NOT T=2! T=2 = FirstHalfFinishDate (devre arası başlangıcı)
    // T=3 = SecondHalfStartDate (2. yarı başlangıcı - düdük)
    const start = getMdtTimestamp(mdtList, 3);
    if (start) {
      const elapsed = Math.floor((now.getTime() - start.getTime()) / 60000);
      const dk = 46 + elapsed;
      if (dk > 90) return `90+${dk - 90}'`;
      return `${dk}'`;
    }
    // Fallback: if T=3 not available, try T=2 but subtract estimated halftime
    const t2 = getMdtTimestamp(mdtList, 2);
    const t1 = getMdtTimestamp(mdtList, 1);
    if (t2 && t1) {
      // T2 = devre arası başlangıcı, tahmini 2. yarı başlangıcı = T2 + 15dk
      const halftimeDuration = Math.max(12, Math.min(20, Math.round((t2.getTime() - t1.getTime()) / 60000) - 45 + 15));
      const secondHalfStart = new Date(t2.getTime() + halftimeDuration * 60000);
      const elapsed = Math.floor((now.getTime() - secondHalfStart.getTime()) / 60000);
      const dk = 46 + elapsed;
      if (dk > 90) return `90+${dk - 90}'`;
      return `${dk}'`;
    }
  } else if (status === 20) {
    // Extra time 1st half: started at T=5 (OverTimeFirstHalfStartDate)
    const start = getMdtTimestamp(mdtList, 5);
    if (start) {
      const elapsed = Math.floor((now.getTime() - start.getTime()) / 60000);
      const dk = 91 + elapsed;
      if (dk > 105) return `105+${dk - 105}'`;
      return `${dk}'`;
    }
  } else if (status === 21) {
    // Extra time 2nd half: started at T=7 (OverTimeSecondHalfStartDate)
    // NOT T=6! T=6 = OverTimeFirstHalfFinishDate
    const start = getMdtTimestamp(mdtList, 7);
    if (start) {
      const elapsed = Math.floor((now.getTime() - start.getTime()) / 60000);
      const dk = 106 + elapsed;
      if (dk > 120) return `120+${dk - 120}'`;
      return `${dk}'`;
    }
  } else if (status === 16 || status === 18) {
    // Overtime / Suspended — show match time if available
    // Try to infer from MDT using correct type codes
    const t3 = getMdtTimestamp(mdtList, 3);
    if (t3) {
      const elapsed = Math.floor((now.getTime() - t3.getTime()) / 60000);
      const dk = 46 + elapsed;
      if (dk > 90) return `90+${dk - 90}'`;
      return `${dk}'`;
    }
    // Fallback to T=2 with halftime estimation
    const t2 = getMdtTimestamp(mdtList, 2);
    if (t2) {
      const t1 = getMdtTimestamp(mdtList, 1);
      if (t1) {
        const halftimeDuration = Math.max(12, Math.min(20, Math.round((t2.getTime() - t1.getTime()) / 60000) - 45 + 15));
        const secondHalfStart = new Date(t2.getTime() + halftimeDuration * 60000);
        const elapsed = Math.floor((now.getTime() - secondHalfStart.getTime()) / 60000);
        const dk = 46 + elapsed;
        if (dk > 90) return `90+${dk - 90}'`;
        return `${dk}'`;
      }
    }
    const t1 = getMdtTimestamp(mdtList, 1);
    if (t1) {
      const elapsed = Math.floor((now.getTime() - t1.getTime()) / 60000);
      if (elapsed > 45) return `45+${elapsed - 45}'`;
      return `${Math.max(1, elapsed)}'`;
    }
  }

  return "";
}

function extractScores(match: any): {
  homeTotal: number;
  awayTotal: number;
  fhHome: number;
  fhAway: number;
  shHome: number;
  shAway: number;
} {
  const esList = match.ES || [];
  let homeTotal = 0,
    awayTotal = 0,
    fhH = 0,
    fhA = 0,
    shH = 0,
    shA = 0;

  for (const es of esList) {
    const h = es.H || 0,
      a = es.A || 0,
      t = es.T || 0;
    if (t === 1) {
      fhH = h;
      fhA = a;
    } else if (t === 2) {
      shH = h;
      shA = a;
    }
    if (h > homeTotal) homeTotal = h;
    if (a > awayTotal) awayTotal = a;
  }

  return { homeTotal, awayTotal, fhHome: fhH, fhAway: fhA, shHome: shH, shAway: shA };
}

export function parseMatch(m: any): ParsedMatch {
  const status = m.S || 0;
  const scores = extractScores(m);
  const now = new Date();

  let matchTime = m.DT || "";
  const matchDate = m.MD || "";
  if (matchDate) {
    try {
      const md = new Date(matchDate);
      matchTime = md.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
    } catch {}
  }

  const firstHalfScore =
    scores.fhHome || scores.fhAway ? `${scores.fhHome}:${scores.fhAway}` : "-";

  const stats = parseStats(m.SE || []);

  return {
    code: m.C || 0,
    bid: m.BID || 0,
    league: m.L || "?",
    leagueId: m.LID || 0,
    home: m.HT || "?",
    away: m.AT || "?",
    homeTr: m.HTTR || m.HT || "?",
    awayTr: m.ATTR || m.AT || "?",
    homeGoals: scores.homeTotal,
    awayGoals: scores.awayTotal,
    firstHalfScore,
    minute: calculateMinute(m, now),
    status,
    statusText: STATUS_MAP[status] || String(status),
    time: matchTime,
    isLive: ACTIVE_STATUSES.has(status),
    isFinished: FINISHED_STATUSES.has(status),
    country: m.FC || "",
    stats,
    hasStats: !!(m.SE && m.SE.length > 0),
    homeColor: m.HBC || null,
    awayColor: m.ABC || null,
    homeAbbrev: m.HTA || null,
    awayAbbrev: m.ATA || null,
  };
}

// ── Goal Radar Algorithm (Enhanced) ──
