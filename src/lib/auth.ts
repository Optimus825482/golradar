// ── Admin Auth Library ─────────────────────────────────────────────
// Username/password auth with PBKDF2 hashing and session tokens.
// Replaces the old ADMIN_API_TOKEN env-var-based auth.

import { db } from "./db";
import crypto from "crypto";

const ITERATIONS = 100_000;
const KEY_LEN = 64;
const DIGEST = "sha256";
const SESSION_BYTES = 64;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Password Hashing ──────────────────────────────────────────────

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(32).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST)
    .toString("hex");
  return { hash, salt };
}

export function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): boolean {
  const computed = crypto
    .pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST)
    .toString("hex");
  // Constant-time compare
  if (computed.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}

// ── Session Management ────────────────────────────────────────────

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(SESSION_BYTES).toString("hex");
  await db.user.update({
    where: { id: userId },
    data: {
      sessionToken: token,
      sessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export async function validateSession(
  token: string,
): Promise<{
  ok: boolean;
  userId?: string;
  mustChange?: boolean;
  reason?: string;
}> {
  const user = await db.user.findUnique({ where: { sessionToken: token } });
  if (!user) return { ok: false, reason: "invalid token" };
  if (user.sessionExpiresAt && new Date() > user.sessionExpiresAt) {
    // Expired — clear it
    await db.user.update({
      where: { id: user.id },
      data: { sessionToken: null, sessionExpiresAt: null },
    });
    return { ok: false, reason: "session expired" };
  }
  return { ok: true, userId: user.id, mustChange: user.mustChangePassword };
}

export async function destroySession(token: string): Promise<void> {
  const user = await db.user.findUnique({ where: { sessionToken: token } });
  if (user) {
    await db.user.update({
      where: { id: user.id },
      data: { sessionToken: null, sessionExpiresAt: null },
    });
  }
}

// ── Seed Default Admin ────────────────────────────────────────────

export async function seedDefaultAdmin(): Promise<void> {
  const existing = await db.user.findUnique({ where: { username: "admin" } });
  if (existing) return;

  const { hash, salt } = hashPassword("admin123");
  await db.user.create({
    data: {
      username: "admin",
      passwordHash: hash,
      passwordSalt: salt,
      mustChangePassword: true,
    },
  });
  console.log("[AUTH] Default admin user created (admin / admin123)");
}
