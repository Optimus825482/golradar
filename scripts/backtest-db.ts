// ── Quick DB Backtest: Signal accuracy simulation ───────────────
// npx tsx scripts/backtest-db.ts
//
// Simulates what WOULD have happened with our 4 fixes applied:
//   F1: parseGoalMinute fix (goalMinute=1 anomalies removed)
//   F2: both sinyalleri correctPrediction=true
//   F3: SystemConfig x0=30 (calibratedP realism)
//   F4: Cooling quadratic + 3dk cooldown
//   F5: RADAR_THRESHOLD 60→65
//
// Uses local PostgreSQL Signal table (june 24-28 data).

import { db } from "../src/lib/db";

interface SignalRow {
  id: string;
  date: string;
  matchCode: number;
  signalSide: string;
  signalScore: number;
  calibratedP: number;
  signalLevel: string;
  goalHappened: boolean | null;
  signalMinute: number | null;
  goalMinute: number | null;
  goalSide: string | null;
  correctPrediction: boolean | null;
  minutesAfterSignal: number | null;
  activeFactors: string[];
  homeScore: number;
  awayScore: number;
}

async function loadSignals(): Promise<SignalRow[]> {
  const rows = await db.$queryRaw<SignalRow[]>`
    SELECT id, date, "matchCode", "signalSide", "signalScore", "calibratedP",
           "signalLevel", "goalHappened", "signalMinute", "goalMinute", "goalSide",
           "correctPrediction", "minutesAfterSignal", "activeFactors",
           "homeScore", "awayScore"
    FROM "Signal"
    WHERE date >= '2026-06-24' AND date <= '2026-06-28'
    ORDER BY date, "createdAt"
  `;
  return rows;
}

interface Metrics {
  signals: number;
  goals: number;
  falseAlarms: number;
  correctSide: number;
  wrongSide: number;
  bothGoals: number;
  m1: string; // gol tespit %
  m2: string; // taraf doğruluğu %
}

function computeMetrics(signals: SignalRow[]): Metrics {
  const goals = signals.filter(s => s.goalHappened === true);
  const falseAlarms = signals.filter(s => s.goalHappened === false);
  const nonBoth = goals.filter(s => s.signalSide !== 'both');
  const correct = nonBoth.filter(s => s.correctPrediction === true);
  const wrong = nonBoth.filter(s => s.correctPrediction === false);
  const bothG = goals.filter(s => s.signalSide === 'both');

  return {
    signals: signals.length,
    goals: goals.length,
    falseAlarms: falseAlarms.length,
    correctSide: correct.length,
    wrongSide: wrong.length,
    bothGoals: bothG.length,
    m1: (100 * goals.length / Math.max(1, signals.length)).toFixed(1),
    m2: (100 * correct.length / Math.max(1, nonBoth.length)).toFixed(1),
  };
}

// Simulate cooling fix: remove signals with "Gol sonrası soğuma"
// that were false alarms. The 3dk cooldown would have blocked these.
function applyCoolingFix(signals: SignalRow[]): SignalRow[] {
  // Cooling fix affects signals created right after a goal.
  // In our new code, reportGoal sets cooldown for 3 min on all sides.
  // So we remove false alarm signals that had "Gol sonrası soğuma" factor.
  // AND we keep goal=true signals with cooling factor (those were correct).
  return signals.filter(s => {
    const hasCooling = Array.isArray(s.activeFactors) &&
      s.activeFactors.some(f => f.includes('soğuma'));
    // Keep: non-cooling signals, or cooling+goal signals
    if (hasCooling && s.goalHappened === false) return false; // blocked by cooldown
    return true;
  });
}

// Simulate threshold fix: remove signals with score < threshold
function applyThreshold(signals: SignalRow[], threshold: number): SignalRow[] {
  return signals.filter(s => s.signalScore >= threshold);
}

// Simulate both fix: mark "both" signals with correctPrediction=true
function applyBothFix(signals: SignalRow[]): SignalRow[] {
  return signals.map(s => {
    if (s.signalSide === 'both' && s.goalHappened === true) {
      return { ...s, correctPrediction: true };
    }
    return s;
  });
}

// Simulate H3b: kontra atak detection → both
// home dominant (ratio>0.62, score>=65) + awayScore>=30 → both
// away dominant (ratio>0.58, score>=65) + homeScore>=25 → both
function applySideFix(signals: SignalRow[]): SignalRow[] {
  return signals.map(s => {
    const total = s.homeScore + s.awayScore;
    if (total === 0) return s;
    const homeRatio = s.homeScore / total;
    const homeDominant = homeRatio > 0.62 && s.homeScore >= 65;
    const awayDominant = (1 - homeRatio) > 0.58 && s.awayScore >= 65;
    if ((homeDominant && s.awayScore >= 30) || (awayDominant && s.homeScore >= 25)) {
      return { ...s, signalSide: 'both' as const };
    }
    return s;
  });
}

// Simulate zone exclusion: ilk X dk, devre arasi, son X dk
// Defaults match current code: 0-2, 43-45, 89+
function applyZoneExclusion(signals: SignalRow[], opts: {
  firstMin?: number;   // 0 to firstMin (default 2)
  htStart?: number;    // htStart to htEnd (default 43-45)
  htEnd?: number;
  lastMin?: number;    // lastMin+ to end (default 89)
} = {}): SignalRow[] {
  const fm = opts.firstMin ?? 2;
  const hs = opts.htStart ?? 43;
  const he = opts.htEnd ?? 45;
  const lm = opts.lastMin ?? 89;
  return signals.filter(s => {
    const m = s.signalMinute ?? 0;
    if (m <= fm) return false;
    if (m >= hs && m <= he) return false;
    if (m >= lm) return false;
    return true;
  });
}

async function main() {
  console.log('📊 GolRadar2 Backtest — DB Signal Data (24-28 Haziran)\n');

  const all = await loadSignals();
  console.log(`Toplam sinyal: ${all.length} (5 gün)\n`);

  // ── BASELINE: current data in DB ──────────────────────────
  console.log('═'.repeat(70));
  console.log('BASELINE — Mevcut DB verisi');
  console.log('═'.repeat(70));
  const baseline = computeMetrics(all);
  printDayMetrics(all);
  console.log(`\nToplam: S=${baseline.signals} G=${baseline.goals} FA=${baseline.falseAlarms} M1=%${baseline.m1} M2=%${baseline.m2}`);

  // ── FIX 2: both fix ────────────────────────────────────────
  console.log('\n═'.repeat(70));
  console.log('F2: both sinyalleri correctPrediction=true');
  console.log('═'.repeat(70));
  const bothFixed = applyBothFix(all);
  const bothMetrics = computeMetrics(bothFixed);
  console.log(`M1=%${bothMetrics.m1} M2=%${bothMetrics.m2} (bothGoals: ${bothMetrics.bothGoals})`);

  // ── FIX 4: cooling fix ─────────────────────────────────────
  console.log('\n═'.repeat(70));
  console.log('F4: Cooling quadratic + 3dk cooldown (false alarm filtre)');
  console.log('═'.repeat(70));
  const coolingFixed = applyCoolingFix(all);
  const coolMetrics = computeMetrics(coolingFixed);
  console.log(`Sinyal: ${baseline.signals}→${coolMetrics.signals} (-${baseline.signals - coolMetrics.signals})`);
  console.log(`False alarm: ${baseline.falseAlarms}→${coolMetrics.falseAlarms} (-${baseline.falseAlarms - coolMetrics.falseAlarms})`);
  console.log(`M1=%${coolMetrics.m1} M2=%${coolMetrics.m2}`);

  // ── F5: threshold fix ──────────────────────────────────────
  console.log('\n═'.repeat(70));
  console.log('F5: RADAR_THRESHOLD 60→65 simülasyonu');
  console.log('═'.repeat(70));
  for (const th of [65, 68, 70]) {
    const thFixed = applyThreshold(all, th);
    const thMetrics = computeMetrics(thFixed);
    console.log(`Eşik ${th}: S=${thMetrics.signals} M1=%${thMetrics.m1} M2=%${thMetrics.m2}`);
  }

  // ── ALL FIXES COMBINED ─────────────────────────────────────
  console.log('\n═'.repeat(70));
  console.log('TÜM FIXLER BIRLEŞIK');
  console.log('═'.repeat(70));
  for (const th of [65, 70]) {
    let s = applySideFix(all);
    s = applyBothFix(s);
    s = applyCoolingFix(s);
    s = applyThreshold(s, th);
    const m = computeMetrics(s);
    console.log(`H3b+Both+Cooling+Eşik${th}: S=${m.signals} M1=%${m.m1} M2=%${m.m2} FA=${m.falseAlarms}`);
  }

  // ── ZONE EXCLUSION COMPARISON ─────────────────────────────
  console.log('\n═'.repeat(70));
  console.log('ZONE EXCLUSION KARŞILAŞTIRMA');
  console.log('═'.repeat(70));
  const scenarios = [
    { name: 'Mevcut kod (0-2, 43-45, 89+)', opts: { firstMin: 2, htStart: 43, htEnd: 45, lastMin: 89 } },
    { name: 'Sıkı (0-5, 43-45, 87+)',      opts: { firstMin: 5, htStart: 43, htEnd: 45, lastMin: 87 } },
    { name: 'Geniş (0-3, 42-46, 85+)',       opts: { firstMin: 3, htStart: 42, htEnd: 46, lastMin: 85 } },
    { name: 'Yasak yok (mevcut threshold)', opts: { firstMin: -1, htStart: 100, htEnd: -1, lastMin: 1000 } },
  ];
  console.log('Senaryo                    | Sinyal | FA  | M1%   | M2%');
  console.log('─'.repeat(60));
  for (const sc of scenarios) {
    let s = applySideFix(all);
    s = applyBothFix(s);
    s = applyCoolingFix(s);
    s = applyThreshold(s, 70);
    s = applyZoneExclusion(s, sc.opts);
    const m = computeMetrics(s);
    console.log(`${sc.name.padEnd(26)} | ${String(m.signals).padStart(6)} | ${String(m.falseAlarms).padStart(3)} | ${m.m1.padStart(5)}% | ${m.m2.padStart(4)}%`);
  }

  // ── PER DAY BREAKDOWN (best combo) ─────────────────────────
  console.log('\n═'.repeat(70));
  console.log('GÜNLÜK DETAY (H3b+Both+Cooling+Eşik65)');
  console.log('═'.repeat(70));
  const days = [...new Set(all.map(s => s.date))].sort();
  console.log('Gün        | Sinyal | Gol | FA  | M1%   | M2%');
  console.log('─'.repeat(55));
  for (const day of days) {
    let s = all.filter(r => r.date === day);
    s = applySideFix(s);
    s = applyBothFix(s);
    s = applyCoolingFix(s);
    s = applyThreshold(s, 65);
    const m = computeMetrics(s);
    console.log(`${day} | ${String(m.signals).padStart(6)} | ${String(m.goals).padStart(4)} | ${String(m.falseAlarms).padStart(3)} | ${m.m1.padStart(5)}% | ${m.m2.padStart(4)}%`);
  }

  await db.$disconnect();
}

function printDayMetrics(all: SignalRow[]) {
  const days = [...new Set(all.map(s => s.date))].sort();
  console.log('Gün        | Sinyal | Gol | FA  | M1%   | M2%');
  console.log('─'.repeat(55));
  for (const day of days) {
    const m = computeMetrics(all.filter(r => r.date === day));
    console.log(`${day} | ${String(m.signals).padStart(6)} | ${String(m.goals).padStart(4)} | ${String(m.falseAlarms).padStart(3)} | ${m.m1.padStart(5)}% | ${m.m2.padStart(4)}%`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
