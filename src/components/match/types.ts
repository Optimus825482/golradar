import type { GoalProbability } from '@/lib/nesine'
import type {
  FotMobMatchDetails,
  FotMobEvent,
  FotMobStatGroup,
  FotMobWeather,
  FotMobMomentum,
  FotMobShot,
} from '@/lib/fotmob'
import type {
  NetScoresConvertedEvent,
} from '@/lib/netscores'
import type {
  MatchStats,
  PressureSnapshot,
  MomentumBarDataPoint,
  xGFlowPoint,
  ThreatIndex,
} from '@/lib/advancedAnalytics'

export type { MatchStats, PressureSnapshot }

export interface Match {
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
  stats: MatchStats;
  hasStats: boolean;
  homeColor: string | null;
  awayColor: string | null;
  homeAbbrev: string | null;
  awayAbbrev: string | null;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  goalRadar?: GoalProbability;
  homeRedCards: number;
  awayRedCards: number;
}

export interface GoalNotification {
  id: string
  matchCode: number
  home: string
  away: string
  homeGoals: number
  awayGoals: number
  scoringTeam: 'home' | 'away'
  league: string
  minute: string
  timestamp: number
}

export type BottomTab = 'all' | 'live' | 'radar' | 'favorites' | 'finished' | 'signal-history'

export const statKeys: { key: string; label: string; suffix: string; isEstimated?: boolean }[] = [
  { key: 'possession', label: 'Topa Sahip %', suffix: '%' },
  { key: 'dangerous_attacks', label: 'Tehlikeli Hücum', suffix: '' },
  { key: 'shots_total', label: 'Toplam Şut', suffix: '' },
  { key: 'shots_on_target', label: 'İsabetli Şut', suffix: '' },
  { key: 'shots_off_target', label: 'İsabetsiz Şut', suffix: '' },
  { key: 'shots_blocked', label: 'Bloklanan Şut', suffix: '' },
  { key: 'corners', label: 'Korner', suffix: '' },
  { key: 'offsides', label: 'Ofsayt', suffix: '' },
  { key: 'fouls', label: 'Faul', suffix: '' },
  { key: 'free_kicks', label: 'Serbest Vuruş', suffix: '' },
  { key: 'yellow_cards', label: 'Sarı Kart', suffix: '' },
  { key: 'red_cards', label: 'Kırmızı Kart', suffix: '' },
  { key: 'xg', label: 'xG', suffix: '', isEstimated: true },
]

export const HALFTIME_STATUSES = new Set([3, 28])
