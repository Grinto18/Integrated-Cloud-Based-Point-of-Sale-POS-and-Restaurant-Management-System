import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db, sqlite, isBcryptHash } from '../db/index.ts';
import { getLocalDatabasePath } from '../db/sqlitePath.ts';
import { users } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import { sanitizeErrorMessage } from '../utils/redact.ts';

const KNOWN_INSECURE_SECRETS = new Set([
  'golden-palace-pos-super-secure-key-2026',
  'grine-restaurant-pos-super-secure-key',
  'secret',
  'changeme',
  'default-secret',
  'dev-secret',
]);

let cachedNonProdSecret: string | null = null;

export function isDesktopRuntime(): boolean {
  return process.env.GOLDEN_PALACE_DESKTOP === '1';
}

function resolveConfiguredJwtSecret(): { source: 'env' | 'file' | 'none'; value?: string; error?: string } {
  const envSecret = process.env.JWT_SECRET?.trim();
  if (envSecret && envSecret.length > 0) {
    return { source: 'env', value: envSecret };
  }

  const secretFile = process.env.JWT_SECRET_FILE?.trim();
  if (secretFile) {
    try {
      if (!fs.existsSync(secretFile)) {
        return {
          source: 'file',
          error: `CRITICAL SECURITY ERROR: JWT_SECRET_FILE (${secretFile}) does not exist.`,
        };
      }
      const fileContent = fs.readFileSync(secretFile, 'utf8').trim();
      if (!fileContent) {
        return {
          source: 'file',
          error: `CRITICAL SECURITY ERROR: JWT_SECRET_FILE (${secretFile}) is empty.`,
        };
      }
      return { source: 'file', value: fileContent };
    } catch (err: any) {
      return {
        source: 'file',
        error: `CRITICAL SECURITY ERROR: Unable to read JWT_SECRET_FILE (${secretFile}): ${err?.message || 'read error'}`,
      };
    }
  }

  return { source: 'none' };
}

function validateProductionJwtSecret(secret: string): string {
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'CRITICAL SECURITY ERROR: JWT_SECRET environment variable (or Google Secret Manager JWT_SECRET_FILE) must be set in production.'
    );
  }
  const normalized = secret.trim();
  if (normalized.length < 32 || Buffer.byteLength(normalized, 'utf8') < 32) {
    throw new Error('CRITICAL SECURITY ERROR: JWT_SECRET in production must be at least 32 characters long.');
  }
  if (KNOWN_INSECURE_SECRETS.has(normalized)) {
    throw new Error('CRITICAL SECURITY ERROR: JWT_SECRET cannot be a known insecure default value in production.');
  }
  if (new Set(normalized).size < 8) {
    throw new Error(
      'CRITICAL SECURITY ERROR: JWT_SECRET in production has insufficient entropy; use at least 32 cryptographically random bytes.'
    );
  }
  return normalized;
}

export function getJwtSecret(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const configured = resolveConfiguredJwtSecret();

  if (configured.error) {
    if (isProd) {
      throw new Error(configured.error);
    }
  }

  if (isProd) {
    if (!configured.value) {
      throw new Error(
        'CRITICAL SECURITY ERROR: JWT_SECRET environment variable (or Google Secret Manager JWT_SECRET_FILE) must be set in production.'
      );
    }
    return validateProductionJwtSecret(configured.value);
  }

  if (
    configured.value &&
    configured.value.length > 0 &&
    !KNOWN_INSECURE_SECRETS.has(configured.value)
  ) {
    return configured.value;
  }

  if (cachedNonProdSecret) {
    return cachedNonProdSecret;
  }

  // Non-production ephemeral/local CSPRNG secret persisted next to the SQLite DB (0o600)
  const secretFilePath = path.join(path.dirname(getLocalDatabasePath()), '.dev_jwt_secret');
  try {
    if (fs.existsSync(secretFilePath)) {
      const existing = fs.readFileSync(secretFilePath, 'utf8').trim();
      if (existing.length >= 32) {
        cachedNonProdSecret = existing;
        return cachedNonProdSecret;
      }
    }
    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFilePath, generated, { mode: 0o600 });
    try {
      fs.chmodSync(secretFilePath, 0o600);
    } catch {
      // Non-POSIX filesystems ignore chmod
    }
    cachedNonProdSecret = generated;
    return cachedNonProdSecret;
  } catch {
    cachedNonProdSecret = crypto.randomBytes(48).toString('hex');
    return cachedNonProdSecret;
  }
}

/**
 * Validates and initializes the JWT secret at HTTP server startup:
 * - Cloud Run / Web Production (NODE_ENV=production without GOLDEN_PALACE_DESKTOP=1):
 *   NEVER silently generates or replaces a missing/invalid secret per container.
 *   Requires a stable >=32-byte secret from JWT_SECRET or Google Secret Manager JWT_SECRET_FILE.
 * - Electron Desktop (GOLDEN_PALACE_DESKTOP=1) & Non-Production:
 *   Reads or creates a persistent 48-byte CSPRNG secret in appDataDir (.jwt_secret / .dev_jwt_secret) with 0o600 perms.
 */
export function ensureServerRuntimeJwtSecret(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const isDesktop = isDesktopRuntime();

  // Cloud Run / Web Production MUST fail fast if no valid secret is externally provisioned
  if (isProd && !isDesktop) {
    return getJwtSecret();
  }

  const configured = resolveConfiguredJwtSecret();
  if (
    configured.value &&
    configured.value.length >= 32 &&
    !KNOWN_INSECURE_SECRETS.has(configured.value) &&
    new Set(configured.value).size >= 8
  ) {
    return configured.value;
  }

  const secretFilename = isDesktop ? '.jwt_secret' : '.dev_jwt_secret';
  const secretFilePath = path.join(path.dirname(getLocalDatabasePath()), secretFilename);

  try {
    if (fs.existsSync(secretFilePath)) {
      const stored = fs.readFileSync(secretFilePath, 'utf8').trim();
      if (stored.length >= 32 && !KNOWN_INSECURE_SECRETS.has(stored) && new Set(stored).size >= 8) {
        try {
          fs.chmodSync(secretFilePath, 0o600);
        } catch {
          // Non-POSIX filesystems may ignore chmod
        }
        process.env.JWT_SECRET = stored;
        return stored;
      }
    }
  } catch {
    // Fall through to generate a new CSPRNG secret for local desktop/dev use
  }

  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretFilePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(secretFilePath, generated, { mode: 0o600, encoding: 'utf8' });
    try {
      fs.chmodSync(secretFilePath, 0o600);
    } catch {
      // Non-POSIX filesystems may ignore chmod
    }
  } catch {
    // Ephemeral CSPRNG fallback only if local directory is read-only
  }

  process.env.JWT_SECRET = generated;
  return generated;
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin.trim(), 10);
}

export async function verifyPin(plainPin: string, storedPin: string | null | undefined): Promise<boolean> {
  if (!plainPin || !storedPin) return false;
  const normalizedInput = plainPin.trim();
  const normalizedStored = storedPin.trim();
  if (!normalizedInput || !normalizedStored) return false;

  if (isBcryptHash(normalizedStored)) {
    return bcrypt.compare(normalizedInput, normalizedStored);
  }

  // Timing-safe legacy plaintext fallback (for rows inserted directly before migration runs)
  const inputDigest = crypto.createHash('sha256').update(normalizedInput).digest();
  const storedDigest = crypto.createHash('sha256').update(normalizedStored).digest();
  return crypto.timingSafeEqual(inputDigest, storedDigest);
}

const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const pruneExpiredRevokedTokens = (now: number) => {
  try {
    sqlite.prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?').run(now);
  } catch {
    // Ignore cleanup errors
  }
};

export const revokeToken = (token: string, userId?: number): void => {
  if (!token) return;
  const now = Date.now();
  pruneExpiredRevokedTokens(now);

  const decoded = jwt.decode(token) as { exp?: number; jti?: string } | null;
  const expiresAtMs =
    decoded?.exp && typeof decoded.exp === 'number'
      ? decoded.exp * 1000
      : now + 7 * 24 * 60 * 60 * 1000;

  sqlite
    .prepare(
      'INSERT OR REPLACE INTO revoked_tokens (token_hash, jti, user_id, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      hashToken(token),
      decoded?.jti || null,
      userId ?? null,
      expiresAtMs,
      new Date().toISOString()
    );
};

export const isTokenRevoked = (token: string): boolean => {
  if (!token) return true;
  const key = hashToken(token);
  const row = sqlite
    .prepare('SELECT expires_at FROM revoked_tokens WHERE token_hash = ?')
    .get(key) as { expires_at: number } | undefined;

  if (!row) return false;
  if (row.expires_at <= Date.now()) {
    sqlite.prepare('DELETE FROM revoked_tokens WHERE token_hash = ?').run(key);
    return false;
  }
  return true;
};

export const clearRevokedTokensForTest = (): void => {
  sqlite.prepare('DELETE FROM revoked_tokens').run();
};

export interface PosUser {
  id: number;
  uid: string;
  username: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN' | 'INVENTORY';
  phone?: string | null;
}

export interface AuthRequest extends Request {
  user?: PosUser;
}

export const signUserToken = (user: PosUser): string => {
  const secret = getJwtSecret();
  return jwt.sign(
    {
      jti: crypto.randomUUID(),
      id: user.id,
      uid: user.uid,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    },
    secret,
    { expiresIn: '7d' }
  );
};

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح: يرجى تسجيل الدخول أولاً' });
  }

  const token = authHeader.slice(7).trim();
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'غير مصرح: يرجى تسجيل الدخول أولاً' });
  }

  if (isTokenRevoked(token)) {
    return res.status(401).json({ error: 'تم تسجيل الخروج من هذه الجلسة، يرجى إعادة الدخول' });
  }

  // 1. Try POS JWT token
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as PosUser;
    if (decoded && decoded.id) {
      const dbUsers = await db.select().from(users).where(eq(users.id, decoded.id));
      if (dbUsers.length === 0) {
        return res.status(401).json({ error: 'جلسة تسجيل الدخول غير صالحة أو منتهية' });
      }
      const dbUser = dbUsers[0];
      if (!dbUser.isActive) {
        return res.status(403).json({ error: 'تم تعطيل هذا الحساب، يرجى مراجعة الإدارة' });
      }
      req.user = {
        id: dbUser.id,
        uid: dbUser.uid,
        username: dbUser.username,
        email: dbUser.email,
        fullName: dbUser.fullName,
        role: dbUser.role as PosUser['role'],
        phone: dbUser.phone,
      };
      return next();
    }
  } catch {
    // Not a valid local POS JWT; check if it could be a Firebase ID Token below
  }

  // 2. Try Firebase ID Token (must be an RS256 JWT with a non-empty `kid` header claim)
  const decodedComplete = jwt.decode(token, { complete: true }) as {
    header?: { alg?: string; kid?: string };
  } | null;

  if (
    !decodedComplete?.header?.kid ||
    typeof decodedComplete.header.kid !== 'string' ||
    decodedComplete.header.kid.trim().length === 0 ||
    decodedComplete.header.alg !== 'RS256'
  ) {
    return res.status(401).json({ error: 'جلسة تسجيل الدخول غير صالحة أو منتهية' });
  }

  try {
    const firebaseDecoded = await adminAuth.verifyIdToken(token);
    // Find or create user in DB
    const existing = await db.select().from(users).where(eq(users.uid, firebaseDecoded.uid));
    if (existing.length > 0) {
      if (!existing[0].isActive) {
        return res.status(403).json({ error: 'تم تعطيل هذا الحساب، يرجى مراجعة الإدارة' });
      }
      req.user = {
        id: existing[0].id,
        uid: existing[0].uid,
        username: existing[0].username,
        email: existing[0].email,
        fullName: existing[0].fullName,
        role: existing[0].role as PosUser['role'],
        phone: existing[0].phone,
      };
      return next();
    } else {
      // Auto-provision strictly with lowest safe default role ('CASHIER') and no default PIN
      const email = firebaseDecoded.email || `${firebaseDecoded.uid}@firebase.local`;
      const baseName = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9._-]/g, '') || 'user';
      const uniqueUsername = `${baseName}_${firebaseDecoded.uid.slice(0, 6)}`;
      const inserted = await db.insert(users).values({
        uid: firebaseDecoded.uid,
        username: uniqueUsername,
        email,
        passwordHash: 'FIREBASE_AUTH',
        fullName: firebaseDecoded.name || 'مستخدم مسجل',
        role: 'CASHIER',
        pin: null,
        isActive: true,
      }).returning();

      req.user = {
        id: inserted[0].id,
        uid: inserted[0].uid,
        username: inserted[0].username,
        email: inserted[0].email,
        fullName: inserted[0].fullName,
        role: inserted[0].role as PosUser['role'],
        phone: inserted[0].phone,
      };
      return next();
    }
  } catch (error: any) {
    console.warn('Firebase token rejected:', sanitizeErrorMessage(error?.code || 'invalid token'));
    return res.status(401).json({ error: 'جلسة تسجيل الدخول غير صالحة أو منتهية' });
  }
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً' });
    }
    if (req.user.role === 'ADMIN' || allowedRoles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ error: 'عذراً، ليس لديك صلاحية للقيام بهذه العملية' });
  };
};

