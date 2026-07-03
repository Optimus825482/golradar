// ── Football-Data.co.uk → GBDT Training Record Dönüştürücü ──────
// 
// football-data-fetch.py ile toplanan JSONL verisini alır, GBDT
// modelinin beklediği TrainingRecord[] formatına çevirir.
//
// Feature vektörü: FEATURE_NAMES (67 eleman) ile birebir eşleşir.
// Eksik feature'lar (canlı maç verisi gerektirenler) 0.5 (nötr) olur.
//
// Kullanım:
//   npx tsx scripts/convert-football-data-to-training.ts \
//     --input data/ml-training/football-data.jsonl \
//     --output data/ml-models/training-data.json \
//     --min-season 2020-2021
//
// Pipeline:
//   python3 scripts/football-data-fetch.py --action backfill --output data/ml-training/football-data.jsonl
//   npx tsx scripts/convert-football-data-to-training.ts --input data/ml-training/football-data.jsonl
//

import * as fs from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { FEATURE_NAMES } from "../src/lib/featureEngineering";
import type { TrainingRecord } from "../src/lib/featureEngineering";

// ── Types ────────────────────────────────────────────────────────

interface FootballDataRow {
  league_code: string;
  league_name: string;
  season: string;
  date: string;
  home_team: string;
  away_team: string;
  full_time_result: string;
  home_goals?: number | null;
  away_goals?: number | null;
  home_shots?: number | null;
  away_shots?: number | null;
  home_shots_on_target?: number | null;
  away_shots_on_target?: number | null;
  home_corners?: number | null;
  away_corners?: number | null;
  home_fouls?: number | null;
  away_fouls?: number | null;
  home_yellow?: number | null;
  away_yellow?: number | null;
  home_red?: number | null;
  away_red?: number | null;
  home_xg?: number | null;
  away_xg?: number | null;
  [key: string]: unknown;
}

// ── CLI args ─────────────────────────────────────────────────────

function cliArg(key: string, def: string): string {
  const idx = process.argv.indexOf(`--${key}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${key}=`));
  if (eq) return eq.split("=")[1];
  return def;
}

function cliBool(key: string): boolean {
  return process.argv.includes(`--${key}`);
}

const INPUT = cliArg("input", "data/ml-training/football-data.jsonl");
const OUTPUT = cliArg("output", "data/ml-models/training-data.json");
const MIN_SEASON = cliArg("min-season", "2018-2019");
const MIN_GOALS = 30; // Alt sınır: en az bu kadar gol olayı olmalı

// ── Normalizasyon ────────────────────────────────────────────────

function norm(v: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

function safe(v: number | null | undefined, def = 0): number {
  return v ?? def;
}

// ── Tek maçı TrainingRecord'e çevir ─────────────────────────────

function rowToTrainingRecord(row: FootballDataRow): TrainingRecord | null {
  const features = new Array(FEATURE_NAMES.length).fill(0.5); // nötr default

  // --- Pressure & dominance (indeks 0-6) ---
  const possH = 50; // Football-Data'da possession yok, varsayılan 50
  const possA = 50;
  const daH = safe(row.home_shots_on_target) * 3 + safe(row.home_corners) * 1.5;
  const daA = safe(row.away_shots_on_target) * 3 + safe(row.away_corners) * 1.5;
  const totDA = daH + daA || 1;

  // Pressure hesapla
  const shotH = safe(row.home_shots);
  const shotA = safe(row.away_shots);
  const sotH = safe(row.home_shots_on_target);
  const sotA = safe(row.away_shots_on_target);
  const cornH = safe(row.home_corners);
  const cornA = safe(row.away_corners);
  const totalShot = shotH + shotA || 1;
  const totalSot = sotH + sotA || 1;
  const totalCorn = cornH + cornA || 1;

  const pressureH =
    (possH / 100) * 0.075 * 100 +
    (daH / totDA) * 0.30 * 100 +
    (shotH / totalShot) * 0.15 * 100 +
    (sotH / totalSot) * 0.25 * 100 +
    (cornH / totalCorn) * 0.125 * 100;
  const pressureA = 100 - pressureH;

  features[0] = pressureH / 100;                     // pressure_home
  features[1] = pressureA / 100;                     // pressure_away
  features[2] = Math.abs(pressureH - pressureA) / 100; // pressure_gap
  features[3] = pressureH > 50 ? 1 : 0;             // pressure_dominant_side
  features[4] = 0.5;                                 // possession_home (bilinmiyor)
  features[5] = 0;                                   // possession_gap
  features[6] = norm(daH / 90, 0, 8);               // dangerous_attacks_home_rate

  // --- Shot quality (indeks 7-14) ---
  const sotRateH = sotH / 90;
  const sotRateA = sotA / 90;
  features[7] = norm(shotH / 90, 0, 8);             // shots_total_home_rate
  features[8] = norm(shotA / 90, 0, 8);             // shots_total_away_rate
  features[9] = norm(sotRateH, 0, 6);               // shots_on_target_home_rate
  features[10] = norm(sotRateA, 0, 6);              // shots_on_target_away_rate
  features[11] = shotH > 0 ? sotH / shotH : 0;     // sot_ratio_home
  features[12] = shotA > 0 ? sotA / shotA : 0;     // sot_ratio_away

  // xG (Football-Data'da varsa PSxG kullan, yoksa SOT bazlı tahmin)
  const xgH = safe(row.home_xg) || (sotH * 0.085 + (shotH - sotH) * 0.03);
  const xgA = safe(row.away_xg) || (sotA * 0.085 + (shotA - sotA) * 0.03);
  features[13] = norm(xgH, 0, 3.0);                // xg_home
  features[14] = norm(xgA, 0, 3.0);                // xg_away

  // --- Set piece (indeks 15-18) ---
  features[15] = norm(cornH / 90, 0, 5);           // corners_home_rate
  features[16] = norm(cornA / 90, 0, 5);           // corners_away_rate
  features[17] = 0.5; // free_kicks_home_rate (Football-Data'da yok)
  features[18] = 0.5; // free_kicks_away_rate

  // --- Temporal features (indeks 25-28) ---
  // Maç sonu olduğu için 90. dakika
  features[25] = 1.0;                               // match_minute_norm
  features[26] = norm(1.3, 0.5, 1.5);              // time_multiplier (son 15dk)
  features[27] = 0;                                 // is_first_half
  features[28] = 1;                                 // is_peak_goal_time

  // --- Team strength features (indeks 29-34) ---
  // Football-Data'da Elo yok, nötr bırak
  features[29] = 0;    // elo_diff_norm
  features[30] = 0.5;  // home_form_index
  features[31] = 0.5;  // away_form_index
  features[32] = 0.5;  // home_elo_matches
  features[33] = 0.5;  // away_elo_matches
  features[34] = 0.53; // home_advantage_factor

  // --- Context features (indeks 35-40) ---
  const hg = safe(row.home_goals);
  const ag = safe(row.away_goals);
  features[35] = Math.abs(hg - ag) / 5;             // score_gap
  features[36] = (hg + ag) / 6;                     // total_goals_norm
  features[37] = hg === ag ? 1 : 0;                 // is_draw
  features[38] = hg > ag ? 1 : 0;                   // home_leading
  features[39] = safe(row.home_red) > 0 ? 1 : 0;   // red_cards_home
  features[40] = safe(row.away_red) > 0 ? 1 : 0;   // red_cards_away

  // --- Weather (indeks 41-43) ---
  features[41] = 0.5; // temperature_norm (bilinmiyor)
  features[42] = 0.5; // wind_speed_norm
  features[43] = 0.5; // precipitation_norm

  // --- xG advanced (indeks 44-47) ---
  const totalXg = xgH + xgA || 1;
  features[44] = norm(xgH / 90, 0, 0.5);           // xg_rate_home
  features[45] = norm(xgA / 90, 0, 0.5);           // xg_rate_away
  features[46] = xgH / totalXg;                     // xg_dominance_ratio
  features[47] = 0;                                  // xg_spike (canlı veri gerekli)

  // --- Canlı veri gerektiren feature'lar (indeks 48-66) ---
  // xT, momentum, shot geometry, PPDA, field tilt, press, kalman, CLV, referee
  // Bu feature'lar canlı maç verisi gerektirir, nötr 0.5 bırakılır
  // indeks 48-66 → zaten 0.5 ile başlatıldı

  // Etiket: bitmiş maçta gol olduysa ve sayı >= 1
  // 1=gol var, 0=gol yok
  const label = (hg + ag) > 0 ? 1 : 0;

  return {
    features,
    label,
    matchCode: -1, // Football-Data maçları, matchCode yok
    minute: 90,    // Bitmiş maç
    timestamp: new Date(row.date || "2020-01-01").getTime(),
    side: label === 1 ? (hg > ag ? "home" : hg < ag ? "away" : "both") : "both",
  };
}

// ── Ana dönüşüm ──────────────────────────────────────────────────

async function convert() {
  console.log(`[Convert] Reading ${INPUT}...`);

  if (!fs.existsSync(INPUT)) {
    console.error(`[Convert] Input file not found: ${INPUT}`);
    console.error(`[Convert] Run football-data-fetch.py first:`);
    console.error(`  python3 scripts/football-data-fetch.py --action backfill --output ${INPUT}`);
    process.exit(1);
  }

  // JSONL oku
  const lines: string[] = [];
  const rl = createInterface({
    input: fs.createReadStream(INPUT, "utf-8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) lines.push(line);
  }

  console.log(`[Convert] ${lines.length} raw rows loaded`);

  // Her satırı parse et ve dönüştür
  const records: TrainingRecord[] = [];
  let skipped = 0;

  for (const line of lines) {
    try {
      const row = JSON.parse(line) as FootballDataRow;

      // Min sezon filtresi
      if (row.season && row.season < MIN_SEASON) {
        skipped++;
        continue;
      }

      // Eksik veri filtresi
      if (!row.home_team || !row.away_team || row.home_goals == null || row.away_goals == null) {
        skipped++;
        continue;
      }

      const record = rowToTrainingRecord(row);
      if (record) {
        records.push(record);
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  console.log(`[Convert] ${records.length} valid training records (skipped ${skipped})`);

  // Sınıf dengesi kontrolü
  const goals = records.filter((r) => r.label === 1);
  const noGoals = records.filter((r) => r.label === 0);
  console.log(`[Convert] Class balance: ${goals.length} goals / ${noGoals.length} no-goals`);

  if (goals.length < MIN_GOALS) {
    console.warn(
      `[Convert] WARNING: Only ${goals.length} goal events. Minimum ${MIN_GOALS} required. ` +
        "Add more seasons or leagues.",
    );
  }

  // Mevcut training-data.json ile birleştir (varsa)
  const outputPath = path.resolve(OUTPUT);
  let existing: TrainingRecord[] = [];
  if (fs.existsSync(outputPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
      console.log(`[Convert] Existing training data: ${existing.length} records`);
    } catch {
      console.log("[Convert] Failed to parse existing data, starting fresh");
    }
  }

  // Birleştir (Football-Data kaydı olmayanları ekle)
  const existingMatchKeys = new Set(
    existing.map((r) => `${r.matchCode}-${r.minute}-${r.side}`),
  );
  const newRecords = records.filter(
    (r) => !existingMatchKeys.has(`${r.matchCode}-${r.minute}-${r.side}`),
  );

  const merged = [...existing, ...newRecords];
  const MAX_RECORDS = 50000;
  const finalRecords = merged.slice(-MAX_RECORDS);

  // Yaz
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(finalRecords, null, 2));

  console.log(`[Convert] Written ${finalRecords.length} records to ${outputPath}`);
  console.log(`[Convert] Added ${newRecords.length} new records from Football-Data.co.uk`);
  console.log(`[Convert] Feature vector size: ${FEATURE_NAMES.length}`);
}

convert().catch((err) => {
  console.error("[Convert] Fatal:", err);
  process.exit(1);
});
