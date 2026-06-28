// ── Admin Auth Library ─────────────────────────────────────────────
// Username/password auth with PBKDF2 hashing and session tokens.
// Replaces the old ADMIN_API_TOKEN env-var-based auth.

import { db } from "./db";
import crypto from "crypto";
import { promisify } from "util";
import { logInfo } from "./devLog";

const pbkdf2 = promisify(crypto.pbkdf2);

const ITERATIONS = 100_000;
const KEY_LEN = 64;
const DIGEST = "sha256";
const SESSION_BYTES = 64;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_REFRESH_MS = 1 * 60 * 60 * 1000; // refresh after 1 hour

// ── Password Hashing ──────────────────────────────────────────────

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(32).toString("hex");
  const buf = await pbkdf2(password, salt, ITERATIONS, KEY_LEN, DIGEST);
  const hash = buf.toString("hex");
  return { hash, salt };
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  const buf = await pbkdf2(password, salt, ITERATIONS, KEY_LEN, DIGEST);
  const computed = buf.toString("hex");
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
    await db.user.update({
      where: { id: user.id },
      data: { sessionToken: null, sessionExpiresAt: null },
    });
    return { ok: false, reason: "session expired" };
  }
  // FIX: Auto-refresh — session 1 saatten eskiyse token yenile
  const sessionAge = user.sessionExpiresAt
    ? user.sessionExpiresAt.getTime() - SESSION_TTL_MS
    : 0;
  const needsRefresh = user.sessionExpiresAt && (Date.now() - sessionAge) > SESSION_REFRESH_MS;
  if (needsRefresh) {
    const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
    await db.user.update({
      where: { id: user.id },
      data: { sessionExpiresAt: newExpiry },
    });
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

  // No fallback. A known-weak default password in production is a
  // critical security hole — fail loudly so the orchestrator surfaces
  // the misconfiguration instead of silently booting with no admin.
  const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD;
  const isProd = process.env.NODE_ENV === "production";

  if (!defaultPassword) {
    if (isProd) {
      throw new Error(
        "ADMIN_DEFAULT_PASSWORD is required in production. " +
          "Set it in the container environment before starting.",
      );
    }
    logInfo(
      "AUTH",
      "No admin user exists and ADMIN_DEFAULT_PASSWORD not set (dev mode). Skipping seed.",
    );
    return;
  }

  if (defaultPassword.length < 12) {
    throw new Error(
      "ADMIN_DEFAULT_PASSWORD must be at least 12 characters. " +
        "Generate one with: openssl rand -base64 24",
    );
  }

  const { hash, salt } = await hashPassword(defaultPassword);
  await db.user.create({
    data: {
      username: "admin",
      passwordHash: hash,
      passwordSalt: salt,
      mustChangePassword: true,
    },
  });
  logInfo("AUTH", "Default admin user created — must change password on first login");
}
