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

export type MeasuredModelName = 'rule' | 'poisson' | 'elo' | 'gap' | 'pi' | 'glicko2';

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
 *
 * Güvenlik guardrail: rule-based bizim ana sinyal motorumuz. Eğer
 * ölçülmüş brier'ı tier=0 (archived) eşiğine düşerse ensemble onu tamamen
 * devre dışı bırakır ve sinyal sayısı düşer. Bu yüzden 'rule' için
 * brier ≥ RULE_BRIER_FLOOR (0.35) ise null döndürüyoruz — eski 0.20
 * unranked rotasına düşüyor. Poisson ve Elo için böyle bir guardrail yok
 * çünkü onlar ana sinyal değil.
 */
const RULE_BRIER_FLOOR = 0.35; // tier=0 eşiği 0.40 ama prod shadow sonrası
                                // kaldırılacak — A1 phase-1 guardrail.

export async function getMeasuredBrier(
  name: MeasuredModelName,
): Promise<number | null> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    if (name === 'rule' && cached.value !== null && cached.value >= RULE_BRIER_FLOOR) {
      return null;
    }
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
    if (name === 'rule' && v !== null && v >= RULE_BRIER_FLOOR) {
      return null;
    }
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
  const [rule, poisson, elo, gap, pi, glicko2] = await Promise.all([
    getMeasuredBrier('rule'),
    getMeasuredBrier('poisson'),
    getMeasuredBrier('elo'),
    getMeasuredBrier('gap'),
    getMeasuredBrier('pi'),
    getMeasuredBrier('glicko2'),
  ]);
  return { rule, poisson, elo, gap, pi, glicko2 };
}
