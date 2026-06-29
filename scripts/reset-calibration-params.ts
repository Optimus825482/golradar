#!/usr/bin/env bun
/**
 * Kalibrasyon parametrelerini fabrika ayarlarına döndür.
 *
 * Çalıştır:
 *   bun scripts/reset-calibration-params.ts
 *
 * Bu script SystemConfig'teki calibration.params, calibration.isotonic,
 * calibration.beta anahtarlarını siler (resetler). Bir sonraki prediction
 * sırasında `hydrateCalibrationFromDB()` boş döner → sigmoid fabrika
 * ayarları (L=0.90, k=0.05, x0=30, T=0.08) kullanılır.
 */

import { db } from '../src/lib/db';

async function run() {
  console.error('Resetting calibration params to factory defaults...');

  // Delete all calibration SystemConfig entries
  const deleted = await db.systemConfig.deleteMany({
    where: {
      key: { in: ['calibration.params', 'calibration.isotonic', 'calibration.beta'] },
    },
  });

  console.error(
    `Deleted ${deleted.count} SystemConfig entries ` +
    `(params/isotonic/beta). Next prediction will use factory defaults.`,
  );

  const out = {
    ok: true,
    deleted: deleted.count,
    message: 'calibration.params, calibration.isotonic, calibration.beta reset to factory defaults. Next server hydration will use L=0.90, k=0.05, x0=30, T=0.08',
  };

  console.log(JSON.stringify(out));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
