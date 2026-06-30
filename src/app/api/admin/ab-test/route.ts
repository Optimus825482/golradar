// ── A/B Test API — Feature Flag Konfigurasyon Karsilastirmasi ──
// Iki farkli feature flag konfigurasyonunu gecmis sinyaller uzerinde
// karsilastirir.
//
// GET /api/admin/ab-test
//   ?days=30
//   &baselineThreshold=60
//   &testThreshold=65
//   &baselineFlags=PI_RATING=true,GLICKO2=true  (opsiyonel)
//   &testFlags=PI_RATING=false,GLICKO2=false     (opsiyonel)
//
// BASELINE: referans konfigurasyon (genelde threshold-only)
// TEST: karsilastirilacak konfigurasyon (secili flag'ler ile)
//
// Her iki sistem ayni sinyal verisi uzerinde calisir, farkli filtreleme
// ve agirliklandirma uygular. Sonuc yanyana karsilastirilir.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logError } from '@/lib/devLog';
import { adminRoute } from '@/lib/adminRoute';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface SystemResult {
  label: string;
  totalSignals: number;
  correctSignals: number;
  incorrectSignals: number;
  falsePositives: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1Score: number;
  avgMinutesToGoal: number;
  signalsByTier: Record<string, number>;
  config: { threshold: number; flags: Record<string, string> };
}

export const GET = adminRoute(async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') ?? '30') || 30));
    const baselineThreshold = parseInt(url.searchParams.get('baselineThreshold') ?? '60');
    const testThreshold = parseInt(url.searchParams.get('testThreshold') ?? '65');

    // Parse flag configs: "PI_RATING=true,GLICKO2=false" → {PI_RATING: "true", GLICKO2: "false"}
    const parseFlags = (raw: string | null): Record<string, string> => {
      if (!raw) return {};
      const flags: Record<string, string> = {};
      for (const pair of raw.split(',')) {
        const [k, v] = pair.split('=');
        if (k && v) flags[k.trim()] = v.trim();
      }
      return flags;
    };
    const baselineFlags = parseFlags(url.searchParams.get('baselineFlags'));
    const testFlags = parseFlags(url.searchParams.get('testFlags'));

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const dbSignals = await db.signal.findMany({
      where: { signalTimestamp: { gte: cutoff } },
      orderBy: { matchCode: 'asc' },
    });

    if (dbSignals.length === 0) {
      return NextResponse.json({ ok: false, error: 'Bu periyotta sinyal bulunamadi' });
    }

    // Bir sinyalin bir konfigurasyonda "ateslenip ateslenmeyecegini" belirle
    const shouldFire = (s: typeof dbSignals[0], threshold: number, flags: Record<string, string>): boolean => {
      // 1. Threshold kontrolu
      if ((s.signalScore ?? 0) < threshold) return false;

      // 2. Side kontrolu (none/both gecersiz)
      const side = s.signalSide as string | null;
      if (!side || side === 'none' || side === 'both') return false;

      // 3. Feature flag etkileri
      // PI_RATING=false → sinyal skoruna ceza uygula (simulasyon)
      if (flags['PI_RATING'] === 'false') {
        // Pi-Rating kapaliysa elo tabanli skor kullan → daha dusuk guven
        if ((s.signalScore ?? 0) < threshold + 5) return false;
      }
      // GLICKO2=false → RD belirsizligi yok → sinyali daha az secici yap
      // (simulasyon: threshold'u 3 puan artir)
      if (flags['GLICKO2'] === 'false') {
        if ((s.signalScore ?? 0) < threshold + 3) return false;
      }
      // ZISM_CORRECTOR=false → BTTS/O2.5 duzeltmesi yok → sinyal kalitesi simulasyonu
      // (simulasyon: sinyal level dusukse filtrele)
      if (flags['ZISM_CORRECTOR'] === 'false') {
        if (s.signalLevel === 'low') return false;
      }
      // GAP_RATING=false → GAP state katkisi yok → simulasyon
      // (simulasyon: calibrasyon guveni dusuk sinyalleri filtrele)
      if (flags['GAP_RATING'] === 'false') {
        if ((s.calibratedP ?? 0) < 0.3) return false;
      }

      return true;
    };

    const analyze = (label: string, threshold: number, flags: Record<string, string>): SystemResult => {
      let totalSignals = 0, correctSignals = 0, incorrectSignals = 0;
      let falsePositives = 0, truePositives = 0;
      let totalMinutes = 0, goalCount = 0;
      const signalsByTier: Record<string, number> = {};

      for (const s of dbSignals) {
        if (!shouldFire(s, threshold, flags)) continue;

        totalSignals++;
        const level = s.signalLevel ?? 'medium';
        signalsByTier[level] = (signalsByTier[level] ?? 0) + 1;

        if (s.goalHappened === true) {
          correctSignals++;
          truePositives++;
          totalMinutes += s.minutesAfterSignal ?? 999;
        } else if (s.goalHappened === false) {
          incorrectSignals++;
          falsePositives++;
        }
        // null = pending, skip for resolved metrics
      }

      // Goal count from unique matches
      const uniqueMatches = new Set(dbSignals.filter(s => s.finalHomeScore != null).map(s => s.matchCode));
      for (const code of uniqueMatches) {
        const matchSignals = dbSignals.filter(s => s.matchCode === code);
        if (matchSignals.some(s => s.goalHappened === true)) goalCount++;
      }

      const precision = (truePositives + falsePositives) > 0 ? truePositives / (truePositives + falsePositives) : 0;
      const recall = goalCount > 0 ? truePositives / goalCount : 0;

      return {
        label,
        totalSignals,
        correctSignals,
        incorrectSignals,
        falsePositives,
        truePositives,
        precision,
        recall,
        f1Score: (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0,
        avgMinutesToGoal: correctSignals > 0 ? totalMinutes / correctSignals : 0,
        signalsByTier,
        config: { threshold, flags },
      };
    };

    const baseline = analyze('Baseline (Threshold Only)', baselineThreshold, baselineFlags);
    const test = analyze(`Test (Threshold=${testThreshold})`, testThreshold, testFlags);

    const improvement = {
      precisionDelta: (test.precision - baseline.precision) * 100,
      recallDelta: (test.recall - baseline.recall) * 100,
      f1Delta: (test.f1Score - baseline.f1Score) * 100,
      falsePositiveDelta: test.falsePositives - baseline.falsePositives,
      signalCountDelta: test.totalSignals - baseline.totalSignals,
    };

    return NextResponse.json({
      ok: true,
      days,
      totalMatches: dbSignals.length,
      baseline,
      test,
      improvement,
    });
  } catch (err) {
    logError('ab-test', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
