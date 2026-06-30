// ── Feature Flag Runtime Override Utility ────────────────────────
// Öncelik sırası: runtime cache → DB (FeatureFlag) → process.env → kod default
// setFlag() DB'ye yazar + process.env[key] set eder + runtime cache günceller.
// Mevcut kod (process.env okuyan) değişiklik olmadan çalışmaya devam eder.

import { db } from './db';

// Runtime cache: flag key → override value (undefined = no override)
const overrideCache = new Map<string, string | undefined>();

let loaded = false;

// Tüm DB override'larını process.env + cache'e yükle
export async function loadFlags(): Promise<void> {
  if (loaded) return;
  try {
    const rows = await db.featureFlag.findMany();
    for (const row of rows) {
      process.env[row.key] = row.value;
      overrideCache.set(row.key, row.value);
    }
    loaded = true;
  } catch (e) {
    // DB henüz hazır değilse sessizce geç
    loaded = true;
  }
}

// Flag değerini oku: cache → process.env
export function getFlag(key: string): string | undefined {
  return overrideCache.get(key) ?? process.env[key];
}

// Flag override'ı yaz: DB + process.env + cache
export async function setFlag(
  key: string,
  value: string | null,
  updatedBy?: string,
): Promise<void> {
  if (value === null) {
    // Override'ı kaldır
    await db.featureFlag.delete({ where: { key } }).catch(() => {});
    overrideCache.delete(key);
    // process.env'den silme (tekrar env default'a düşer)
  } else {
    await db.featureFlag.upsert({
      where: { key },
      create: { key, value, updatedBy: updatedBy ?? 'admin' },
      update: { value, updatedBy: updatedBy ?? 'admin' },
    });
    process.env[key] = value;
    overrideCache.set(key, value);
  }
}

// Tüm override'ları getir
export async function getAllOverrides(): Promise<Record<string, string>> {
  await loadFlags();
  const rows = await db.featureFlag.findMany();
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}
