#!/usr/bin/env bun
// ── Admin Password Reset Script ──────────────────────────────────
// Kullanım:
//   bun run scripts/reset-admin-password.ts <yeni-sifre>
//
// Veya interactive:
//   bun run scripts/reset-admin-password.ts
//
// Örnek:
//   bun run scripts/reset-admin-password.ts "BenimYeniSifrem123!"
//
// Not: Bun .env dosyasını otomatik yükler.

import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';

async function main() {
  const args = process.argv.slice(2);
  let password = args[0];

  if (!password) {
    // Interactive mode: read from stdin
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    password = await new Promise<string>((resolve) => {
      readline.question('Yeni admin şifresi: ', (answer: string) => {
        readline.close();
        resolve(answer.trim());
      });
    });
  }

  if (!password || password.length < 6) {
    console.error('HATA: Şifre en az 6 karakter olmalı');
    process.exit(1);
  }

  console.log(`[RESET] Admin şifresi sıfırlanıyor...`);

  // Find admin user
  const user = await db.user.findUnique({ where: { username: 'admin' } });
  if (!user) {
    console.error('HATA: admin kullanıcısı bulunamadı');
    console.error('Önce ADMIN_DEFAULT_PASSWORD env ile bir admin oluşturmanız gerek.');
    process.exit(1);
  }

  // Hash new password
  const { hash, salt } = await hashPassword(password);

  // Update user
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hash,
      passwordSalt: salt,
      mustChangePassword: false, // Direkt kullanıma hazır, change-password ekranı atlanır
    },
  });

  // Destroy all existing sessions (force re-login)
  await db.session.deleteMany({ where: { userId: user.id } });

  console.log(`[RESET] ✅ Admin şifresi başarıyla sıfırlandı`);
  console.log(`       Kullanıcı: admin`);
  console.log(`       Yeni şifre: ${password}`);
  console.log(`       Mevcut session'lar temizlendi (yeniden giriş gerekli)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('HATA:', err.message);
  process.exit(1);
});
