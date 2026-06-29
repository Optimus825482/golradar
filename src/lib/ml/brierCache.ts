// ── Measured Model Brier Cache ───────────────────────────────────
// Faz 1 (A1) — Rule-Based / Poisson / Elo bireysel Brier'ları
// `scripts/measure-model-briers.ts` tarafından dev-set üzerinde ölçülür
// ve SystemConfig altına yazılır. Bu dosya 60s TTL cache ile okur; çağıran
// taraf (ensemble.ts) null aldığında UNRANKED_WEIGHT (0.20) fallback'i
// uygulayarak TIER_CAPS rotasyonuna katılır.
//
// Şu an per-model isimler: 'rule', 'poisson', 'elo'.
// 'ml', 'inplay', 'team-strength' zaten modelRouter.getChampionBrier
// üzerinden okunuyor; oraya dokunmuyoruz.

import { db } from '@/lib/db';
import { logError } from '@/lib/devLog';

export type MeasuredModelName = 'rule' | 'poisson' | 'elo';

interface BrierSlot {
  value: number | null;
  ts: number;
}

const CACHE_TTL_MS = 60_000;
const cache: Map<MeasuredModelName, BrierSlot> = new Map();

const keyOf = (name: MeasuredModelName) => `measured.brier.${name}`;

/**
 * DB'den 60s TTL cache üzerinden ölçülmüş Brier'ı getir.
 * null dönerse ensemble null → UNRANKED_WEIGHT (0.20) yoluna gider.
 */
export async function getMeasuredBrier(
  name: MeasuredModelName,
): Promise<number | null> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    const row = await db.systemConfig.findUnique({
      where: { key: keyOf(name) },
      select: { value: true },
    });
    if (!row) {
      cache.set(name, { value: null, ts: Date.now() });
      return null;
    }
    const v = (row.value as { brier?: number } | null)?.brier ?? null;
    cache.set(name, { value: v, ts: Date.now() });
    return v;
  } catch (e) {
    logError('measuredBrier', e);
    return null;
  }
}

/**
 * measure-model-briers.ts tarafından çağrılır; tüm 3 modelin brier'ını
 * tek bir transaction yerine basit upsert ile yazar. updatedBy=auto-measure.
 */
export async function setMeasuredBrier(
  name: MeasuredModelName,
  brier: number,
  devN: number,
): Promise<void> {
  try {
    await db.systemConfig.upsert({
      where: { key: keyOf(name) },
      create: {
        key: keyOf(name),
        value: { brier, devN, updatedAt: new Date().toISOString() },
        updatedBy: 'auto-measure',
      },
      update: {
        value: { brier, devN, updatedAt: new Date().toISOString() },
        updatedBy: 'auto-measure',
      },
    });
    cache.set(name, { value: brier, ts: Date.now() });
  } catch (e) {
    logError('measuredBrier.write', e);
  }
}

/** Test/script integration helper: tek seferde DB'den taze oku (cache bypass). */
export async function readAllMeasuredBriers(): Promise<Record<MeasuredModelName, number | null>> {
  const [rule, poisson, elo] = await Promise.all([
    getMeasuredBrier('rule'),
    getMeasuredBrier('poisson'),
    getMeasuredBrier('elo'),
  ]);
  return { rule, poisson, elo };
}
