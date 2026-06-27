// ── Team Logo Lookup ───────────────────────────────────────────
// Fast name → logo URL lookup from fotmob_teams.csv.
// CSV'deki tüm takım logolarını belleğe yükler, fuzzy name matching yapar.
//
// Kullanım:
//   import { getTeamLogo, loadTeamLogos } from '@/lib/teamLogos';
//   await loadTeamLogos();
//   const url = getTeamLogo('Galatasaray');

import fs from 'fs';
import path from 'path';
import { logError } from './devLog';

let logoMap: Map<string, string> | null = null;
let slugMap: Map<string, string> | null = null;

/**
 * CSV'yi oku, logo map'lerini doldur.
 * Hem takım ismi (name) hem slug üzerinden arama yapılabilir.
 */
export async function loadTeamLogos(): Promise<void> {
  if (logoMap) return; // zaten yüklü

  logoMap = new Map();
  slugMap = new Map();

  const csvPath = path.join(process.cwd(), 'docs', 'fotmob_teams.csv');
  if (!fs.existsSync(csvPath)) {
    logError('teamLogos', `CSV not found: ${csvPath}`);
    return;
  }

  try {
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n');
    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // CSV parse — basit, tırnakları kaldır
      const cols = parseCSVLine(line);
      if (cols.length < 4) continue;

      const fotmobId = cols[0];
      const name = cols[1].toLowerCase().trim();
      const slug = cols[2].toLowerCase().trim();
      const logoUrl = cols[3];

      if (fotmobId && logoUrl) {
        // Tam URL oluştur (CSV'deki URL bazen eksik olabilir)
        const url = logoUrl.startsWith('http')
          ? logoUrl
          : `https://images.fotmob.com/image_resources/logo/teamlogo/${fotmobId}_large.png`;

        logoMap.set(name, url);
        slugMap.set(slug, url);

        // Kısa isimleri de ekle (ilk kelime)
        const shortName = name.split(/\s+/)[0];
        if (shortName && shortName.length > 2) {
          logoMap.set(shortName, url);
        }
      }
    }

    console.log(`[teamLogos] Loaded ${logoMap.size} team logos from CSV`);
  } catch (err) {
    logError('teamLogos', 'Failed to load CSV:', err);
  }
}

/**
 * Basit CSV satır parse (tırnak içindeki virgülleri korur)
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Takım isminden logo URL'si bul.
 * Önce tam isim, sonra slug, sonra fuzzy match dener.
 */
export function getTeamLogo(teamName: string): string | null {
  if (!logoMap || !slugMap) return null;

  const key = teamName.toLowerCase().trim();
  if (!key) return null;

  // 1. Tam eşleşme
  if (logoMap.has(key)) return logoMap.get(key)!;
  if (slugMap.has(key)) return slugMap.get(key)!;

  // 2. İçinde geçiyor mu? (örn: "Galatasaray A.Ş." → "galatasaray")
  for (const [name, url] of logoMap) {
    if (key.includes(name) || name.includes(key)) return url;
  }

  // 3. İlk kelime eşleşmesi
  const firstWord = key.split(/\s+/)[0];
  if (firstWord && firstWord.length > 2) {
    if (logoMap.has(firstWord)) return logoMap.get(firstWord)!;
  }

  return null;
}

/**
 * Logo map'in boyutunu döndür (debug için)
 */
export function getLogoCount(): number {
  return logoMap?.size ?? 0;
}

/**
 * CSV'deki logo URL'leri ile TeamMapping tablosunu backfill et.
 */
export async function backfillTeamLogos(): Promise<number> {
  const { db } = await import('./db');
  let updated = 0;

  if (!logoMap) await loadTeamLogos();
  if (!logoMap) return 0;

  try {
    const mappings = await db.teamMapping.findMany({
      where: { fotmobLogoUrl: null },
      select: { id: true, canonicalName: true, fotmobName: true, nesineName: true },
    });

    for (const m of mappings) {
      const names = [m.canonicalName, m.fotmobName, m.nesineName].filter(Boolean);
      for (const name of names) {
        const url = getTeamLogo(name!);
        if (url) {
          await db.teamMapping.update({
            where: { id: m.id },
            data: { fotmobLogoUrl: url },
          });
          updated++;
          break;
        }
      }
    }
  } catch (err) {
    logError('teamLogos', 'Backfill failed:', err);
  }

  return updated;
}

/**
 * Canlı olarak gelen logo URL'lerini kaydet (NetScores, API, vb).
 * CSV'de yoksa eklenir, varsa ezilmez.
 */
export function registerTeamLogo(teamName: string, logoUrl: string): void {
  if (!logoMap || !logoUrl || !teamName) return;
  const key = teamName.toLowerCase().trim();
  if (!key) return;
  if (!logoMap.has(key)) {
    logoMap.set(key, logoUrl);
  }
}

/**
 * Toplu logo kaydı.
 */
export function registerTeamLogos(teams: Array<{ name: string; logo: string | null }>): void {
  if (!logoMap) return;
  for (const t of teams) {
    if (t.name && t.logo) {
      registerTeamLogo(t.name, t.logo);
    }
  }
}
