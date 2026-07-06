// ── Admin Auth Library ─────────────────────────────────────────────
// Username/password auth with PBKDF2 hashing and session tokens.
// Uses Session table for token storage (SHA-256 hashed tokens).
// Backward-compat: legacy User.sessionToken still supported.
//
// Session model: id, userId, tokenHash (SHA-256), expiresAt, lastUsedAt, createdAt
// Individual session revocation: DELETE FROM Session WHERE id = ?

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

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

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
  const tokenHash = hashToken(token);
  // Write to Session table (new path)
  await db.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  // Backward-compat: also write to User.sessionToken
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
  if (!token) return { ok: false, reason: "no token" };

  // Primary path: look up in Session table by tokenHash
  const tokenHash = hashToken(token);
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (session) {
    if (new Date() > session.expiresAt) {
      // Expired — clean up
      await db.session.delete({ where: { id: session.id } }).catch(() => {});
      return { ok: false, reason: "session expired" };
    }
    // Auto-refresh if > SESSION_REFRESH_MS since lastUsedAt
    const needsRefresh = (Date.now() - session.lastUsedAt.getTime()) > SESSION_REFRESH_MS;
    if (needsRefresh) {
      await db.session.update({
        where: { id: session.id },
        data: {
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          lastUsedAt: new Date(),
        },
      });
    }
    return { ok: true, userId: session.userId, mustChange: session.user.mustChangePassword };
  }

  // Fallback: legacy User.sessionToken path (backward compat)
  const user = await db.user.findUnique({ where: { sessionToken: token } });
  if (!user) return { ok: false, reason: "invalid token" };
  if (user.sessionExpiresAt && new Date() > user.sessionExpiresAt) {
    await db.user.update({
      where: { id: user.id },
      data: { sessionToken: null, sessionExpiresAt: null },
    });
    return { ok: false, reason: "session expired" };
  }
  const lastRefresh = user.sessionExpiresAt
    ? user.sessionExpiresAt.getTime() - SESSION_TTL_MS
    : 0;
  const needsRefresh = user.sessionExpiresAt && (Date.now() - lastRefresh) > SESSION_REFRESH_MS;
  if (needsRefresh) {
    await db.user.update({
      where: { id: user.id },
      data: { sessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  return { ok: true, userId: user.id, mustChange: user.mustChangePassword };
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  // Primary: delete from Session table by tokenHash
  const tokenHash = hashToken(token);
  await db.session.deleteMany({ where: { tokenHash } }).catch(() => {});
  // Fallback: clear legacy User.sessionToken
  const user = await db.user.findUnique({ where: { sessionToken: token } }).catch(() => null);
  if (user) {
    await db.user.update({
      where: { id: user.id },
      data: { sessionToken: null, sessionExpiresAt: null },
    });
  }
}

// ── Revoke individual session by ID ───────────────────────────────
export async function revokeSession(sessionId: string): Promise<void> {
  await db.session.delete({ where: { id: sessionId } }).catch(() => {});
}

// ── List all active sessions for a user ───────────────────────────
export async function listSessions(userId: string) {
  return db.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, createdAt: true, lastUsedAt: true, expiresAt: true },
  });
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
