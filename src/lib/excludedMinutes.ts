// ── Excluded Minute Zones — DB-backed + cache fallback ──────────
// Runtime belirlenen dışlanan dakika bölgeleri. SystemConfig tablosunda
// `signal.excludedMinutes` JSON anahtarı altında persist edilir.
// Config default'u fallback olarak tutulur. Module-scope cache (5dk TTL)
// serverless hot instance reuse'da DB yükünü minimize eder.
// Faz 9 — magic sayıları kalibre (four-phase-finale.md).

import { db } from './db';
import { EXCLUDED_MINUTE_RANGES } from '@/config';
import type { MinuteRange } from '@/config';

// ── Cache ────────────────────────────────────────────────────────
let cachedZones: { value: readonly MinuteRange[]; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SYSTEM_KEY = 'signal.excludedMinutes';

/** DB'den excluded zones oku (cache'li). Her çağrı sync akışı bloke etmez. */
export async function loadExcludedMinutes(): Promise<readonly MinuteRange[]> {
  const now = Date.now();
  if (cachedZones && now - cachedZones.at < CACHE_TTL_MS) {
    return cachedZones.value;
  }
  try {
    const row = await db.systemConfig.findUnique({ where: { key: SYSTEM_KEY } });
    if (row && Array.isArray(row.value)) {
      const zones = (row.value as unknown as MinuteRange[]).map((z) => ({
        start: z.start,
        end: z.end,
        reason: z.reason ?? '',
      }));
      cachedZones = { value: zones, at: now };
      return zones;
    }
  } catch {
    // DB müsait değil — fallback
  }
  // Fallback: config default
  cachedZones = { value: EXCLUDED_MINUTE_RANGES, at: now };
  return EXCLUDED_MINUTE_RANGES;
}

/** Cache invalidate (optimize/route.ts yeni yazınca çağırılır). */
export function invalidateExcludedMinutesCache(): void {
  cachedZones = null;
}

/** Senkron helper: `minute` dışlanan bölgelerden birine düşüyor mu? */
export function isExcludedMinute(minute: number, zones: readonly MinuteRange[]): boolean {
  return zones.some((r) => minute >= r.start && minute <= r.end);
}

/** DB'ye yeni excluded zones yaz. Cache invalidate otomatik. */
export async function persistExcludedMinutes(zones: MinuteRange[]): Promise<void> {
  await db.systemConfig.upsert({
    where: { key: SYSTEM_KEY },
    create: { key: SYSTEM_KEY, value: zones as unknown as object, updatedBy: 'optimizeExcludedMinutes' },
    update: { value: zones as unknown as object, updatedBy: 'optimizeExcludedMinutes' },
  });
  invalidateExcludedMinutesCache();
}
