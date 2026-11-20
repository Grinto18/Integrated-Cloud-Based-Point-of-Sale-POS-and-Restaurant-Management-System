import express from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { eq, desc, asc, and, sql, inArray, isNotNull } from 'drizzle-orm';
import { db, sqlite, isBcryptHash, getSchemaVersion } from '../db/index.ts';
import {
  users,
  categories,
  products,
  productVariants,
  productAddons,
  priceHistory,
  restaurantTables,
  orders,
  orderItems,
  payments,
  cashShifts,
  cashMovements,
  suppliers,
  ingredients,
  productRecipes,
  inventoryMovements,
  wasteRecords,
  purchases,
  purchaseItems,
  customers,
  deliveries,
  expenses,
  auditLogs,
  restaurantSettings,
  printJobs,
  syncOperations,
  syncConflicts,
} from '../db/schema.ts';
import {
  requireAuth,
  requireRole,
  signUserToken,
  revokeToken,
  hashPin,
  verifyPin,
  type AuthRequest,
} from '../middleware/auth.ts';
import {
  LOGIN_RATE_LIMIT,
  PIN_RATE_LIMIT,
  buildRateLimitKeys,
  checkRateLimit,
  recordRateLimitFailure,
  resetRateLimitFailures,
} from '../middleware/rateLimit.ts';
import { logAudit } from '../utils/audit.ts';
import { sanitizeErrorMessage } from '../utils/redact.ts';
import {
  parsePositiveInt,
  parseFiniteNonNegative,
  parseFinitePositive,
  logStructuredError,
  apiNotFoundHandler,
  apiErrorHandler,
} from '../middleware/errorHandler.ts';
import { backupManager, type BackupKind } from '../services/backupService.ts';
import { getBackupDirectory } from '../db/sqlitePath.ts';
import {
  enumerateSystemPrinters,
  createAndProcessPrintJob,
  retryExistingPrintJob,
  runLivePrinterTest,
  readFullPrintPayload,
  resolveDeliveryState,
} from '../services/printQueueService.ts';
import {
  getDesktopRuntimeStatus,
  prepareSafeApplicationUpdate,
  runFirstRunDatabaseAudit,
} from '../services/desktopLifecycle.ts';
import {
  previewMenuImport,
  commitMenuImport,
  listMenuImportHistory,
} from '../services/menuImportService.ts';
import type { PrinterConnectionType, ArabicEscPosEncoding } from '../types.ts';

const ALLOWED_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'INVENTORY']);

const WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  'admin123',
  'admin1234',
  'administrator',
  'manager123',
  'cashier123',
  'waiter123',
  'kitchen123',
  'inventory123',
  'qwerty123',
  'qwertyui',
  'azerty123',
  'goldenpalace',
  'letmein1',
  'welcome1',
]);

export function validatePasswordStrength(
  rawPassword: unknown,
  username?: string
): { valid: true } | { valid: false; error: string } {
  if (typeof rawPassword !== 'string') {
    return {
      valid: false,
      error: 'كلمة المرور يجب أن تتكون من 8 أحرف على الأقل',
    };
  }
  const trimmed = rawPassword.trim();
  if (rawPassword.length < 8 || trimmed.length < 8) {
    return {
      valid: false,
      error: 'كلمة المرور يجب أن تتكون من 8 أحرف فعلية على الأقل',
    };
  }
  const normalized = trimmed.toLowerCase();
  if (WEAK_PASSWORDS.has(normalized) || /^(.)\1+$/.test(trimmed)) {
    return {
      valid: false,
      error: 'كلمة المرور ضعيفة جداً أو شائعة. يرجى اختيار كلمة مرور أقوى.',
    };
  }
  if (username && normalized === username.trim().toLowerCase()) {
    return {
      valid: false,
      error: 'لا يمكن أن تكون كلمة المرور مطابقة لاسم المستخدم',
    };
  }
  return { valid: true };
}

export const apiRouter = express.Router();

apiRouter.get('/health', (_req, res) => {
  const nowIso = new Date().toISOString();
  try {
    sqlite.prepare('SELECT 1 as ok').get();
    const schemaVersion = getSchemaVersion(sqlite);
    res.json({
      status: 'ok',
      db: 'connected',
      schemaVersion,
      restaurant: 'GOLDEN PALACE POS - القصر الذهبي',
      branch: 'عند الجيجلي • حسين داي',
      phone: '0791755614',
      desktopMode: process.env.GOLDEN_PALACE_DESKTOP === '1',
      time: nowIso,
      timestamp: nowIso,
    });
  } catch (err: any) {
    logStructuredError('HEALTH_CHECK_FAILED', err);
    res.status(503).json({
      status: 'degraded',
      db: 'unavailable',
      error: sanitizeErrorMessage(err),
      time: nowIso,
      timestamp: nowIso,
    });
  }
});

// ==========================================
// 1. AUTHENTICATION & STAFF
// ==========================================

// Standard Login (Username / Email + Password)
apiRouter.post('/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const rateKeys = buildRateLimitKeys(
      'LOGIN',
      req,
      typeof identifier === 'string' ? identifier : undefined
    );
    const rate = checkRateLimit(rateKeys, LOGIN_RATE_LIMIT);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({
        error: `تم تجاوز الحد المسموح لمحاولات تسجيل الدخول. يرجى المحاولة بعد ${rate.retryAfterSeconds} ثانية.`,
      });
    }

    if (!identifier || !password) {
      return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
    }

    const found = await db
      .select()
      .from(users)
      .where(
        sql`${users.username} = ${String(identifier).trim()} OR ${users.email} = ${String(identifier).trim()}`
      );

    if (found.length === 0) {
      recordRateLimitFailure(rateKeys, LOGIN_RATE_LIMIT);
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const user = found[0];
    if (!user.isActive) {
      recordRateLimitFailure(rateKeys, LOGIN_RATE_LIMIT);
      return res.status(403).json({ error: 'تم تعطيل هذا الحساب، يرجى مراجعة الإدارة' });
    }

    const matches = await bcrypt.compare(String(password), user.passwordHash);
    if (!matches) {
      recordRateLimitFailure(rateKeys, LOGIN_RATE_LIMIT);
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    resetRateLimitFailures(rateKeys);

    const token = signUserToken({
      id: user.id,
      uid: user.uid,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role as any,
      phone: user.phone,
    });

    await logAudit({
      userId: user.id,
      userName: user.fullName,
      action: 'LOGIN',
      details: 'تسجيل دخول ناجح باسم المستخدم',
      ipAddress: req.ip,
    });

    res.json({
      token,
      user: {
        id: user.id,
        uid: user.uid,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        phone: user.phone,
      },
    });
  } catch (error: any) {
    console.error('Login error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل تسجيل الدخول. حاول مرة أخرى.' });
  }
});

// Quick PIN Login for Cashier / Waiter / Touchscreen
apiRouter.post('/auth/pin-login', async (req, res) => {
  try {
    const { pin } = req.body;
    const rateKeys = buildRateLimitKeys('PIN_LOGIN', req);
    const rate = checkRateLimit(rateKeys, PIN_RATE_LIMIT);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({
        error: `تم تجاوز عدد محاولات رمز PIN المسموحة. يرجى الانتظار ${rate.retryAfterSeconds} ثانية.`,
      });
    }

    if (typeof pin !== 'string' || !pin.trim()) {
      return res.status(400).json({ error: 'يرجى إدخال رمز PIN' });
    }

    const trimmedPin = pin.trim();
    const candidates = await db.select().from(users).where(isNotNull(users.pin));

    let matchedUser: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (await verifyPin(trimmedPin, candidate.pin)) {
        matchedUser = candidate;
        break;
      }
    }

    if (!matchedUser) {
      recordRateLimitFailure(rateKeys, PIN_RATE_LIMIT);
      return res.status(401).json({ error: 'رمز PIN غير صحيح' });
    }

    // Upgrade any legacy plaintext PIN lazily on verification
    if (matchedUser.pin && !isBcryptHash(matchedUser.pin)) {
      const upgradedHash = await hashPin(trimmedPin);
      await db.update(users).set({ pin: upgradedHash }).where(eq(users.id, matchedUser.id));
    }

    if (!matchedUser.isActive) {
      recordRateLimitFailure(rateKeys, PIN_RATE_LIMIT);
      return res.status(403).json({ error: 'تم تعطيل هذا الحساب' });
    }

    resetRateLimitFailures(rateKeys);

    const token = signUserToken({
      id: matchedUser.id,
      uid: matchedUser.uid,
      username: matchedUser.username,
      email: matchedUser.email,
      fullName: matchedUser.fullName,
      role: matchedUser.role as any,
      phone: matchedUser.phone,
    });

    await logAudit({
      userId: matchedUser.id,
      userName: matchedUser.fullName,
      action: 'PIN_LOGIN',
      details: `تسجيل دخول سريع برمز PIN للمستخدم ${matchedUser.fullName}`,
      ipAddress: req.ip,
    });

    res.json({
      token,
      user: {
        id: matchedUser.id,
        uid: matchedUser.uid,
        username: matchedUser.username,
        email: matchedUser.email,
        fullName: matchedUser.fullName,
        role: matchedUser.role,
        phone: matchedUser.phone,
      },
    });
  } catch (error: any) {
    console.error('PIN Login error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'حدث خطأ أثناء التحقق من PIN' });
  }
});

// Get Current User Profile & Permissions
apiRouter.get('/auth/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const found = await db.select().from(users).where(eq(users.id, req.user!.id));
    if (found.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    const u = found[0];
    res.json({
      user: {
        id: u.id,
        uid: u.uid,
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        phone: u.phone,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'فشل استرجاع بيانات المستخدم' });
  }
});

// Logout & Revoke Current Token
apiRouter.post('/auth/logout', requireAuth, async (req: AuthRequest, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (token) {
      revokeToken(token, req.user!.id);
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'LOGOUT',
      details: 'تسجيل خروج وإلغاء صلاحية رمز الجلسة',
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تسجيل الخروج' });
  }
});

// ==========================================
// 2. USERS MANAGEMENT (Admin Only)
// ==========================================
apiRouter.get('/users', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (_req, res) => {
  try {
    const allUsers = await db
      .select({
        id: users.id,
        uid: users.uid,
        username: users.username,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        phone: users.phone,
        pin: users.pin,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.id));

    res.json(
      allUsers.map(({ pin, ...safeUser }) => ({
        ...safeUser,
        hasPin: Boolean(pin && String(pin).trim().length > 0),
      }))
    );
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل قائمة المستخدمين' });
  }
});

apiRouter.post('/users', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const { username, email, password, pin, fullName, role, phone } = req.body;
    if (!username || !email || !password || !fullName || !role) {
      return res.status(400).json({ error: 'جميع الحقول الأساسية مطلوبة' });
    }

    const normalizedRole = String(role).trim();
    if (!ALLOWED_ROLES.has(normalizedRole)) {
      return res.status(400).json({ error: 'الدور الوظيفي المحدد غير صالح' });
    }

    const passwordCheck = validatePasswordStrength(password, String(username).trim());
    if (!passwordCheck.valid) {
      return res.status(400).json({ error: passwordCheck.error });
    }

    let hashedPin: string | null = null;
    if (typeof pin === 'string' && pin.trim().length > 0) {
      const trimmedPin = pin.trim();
      if (trimmedPin.length < 4 || trimmedPin.length > 12) {
        return res.status(400).json({ error: 'رمز PIN يجب أن يتكون من 4 إلى 12 خانة' });
      }
      const existingWithPins = await db.select({ id: users.id, pin: users.pin }).from(users).where(isNotNull(users.pin));
      for (const existingUser of existingWithPins) {
        if (await verifyPin(trimmedPin, existingUser.pin)) {
          return res.status(409).json({ error: 'رمز PIN مستخدم بالفعل من طرف موظف آخر' });
        }
      }
      const WEAK_PINS = new Set(['1234', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999']);
      if (WEAK_PINS.has(trimmedPin)) {
        return res.status(400).json({ error: 'يرجى اختيار رمز PIN غير متكرر وأقوى من الرموز الافتراضية' });
      }
      hashedPin = await hashPin(trimmedPin);
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(String(password), salt);
    const userUid = `user-${Date.now()}`;

    const inserted = await db
      .insert(users)
      .values({
        uid: userUid,
        username: String(username).trim(),
        email: String(email).trim(),
        passwordHash,
        pin: hashedPin,
        fullName: String(fullName).trim(),
        role: normalizedRole,
        phone: phone || null,
        isActive: true,
      })
      .returning();

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'CREATE_USER',
      entityType: 'USER',
      entityId: String(inserted[0].id),
      details: `إنشاء موظف جديد: ${fullName} (${normalizedRole})`,
    });

    const { passwordHash: _ph, pin: _pin, ...safeUser } = inserted[0];
    res.status(201).json({ ...safeUser, hasPin: Boolean(_pin) });
  } catch (error: any) {
    console.error('Create user error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل إنشاء المستخدم. تأكد من عدم تكرار اسم المستخدم أو البريد.' });
  }
});

apiRouter.put('/users/:id', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'معرف المستخدم غير صالح' });
    }

    const existingRows = await db.select().from(users).where(eq(users.id, userId));
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    const existingUser = existingRows[0];

    const { fullName, email, role, phone, pin, isActive, password } = req.body;

    const updateData: Record<string, any> = {};
    if (fullName !== undefined) {
      const trimmedName = String(fullName).trim();
      if (!trimmedName) return res.status(400).json({ error: 'الاسم الكامل مطلوب' });
      updateData.fullName = trimmedName;
    }
    if (email !== undefined) {
      const trimmedEmail = String(email).trim();
      if (!trimmedEmail) return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
      updateData.email = trimmedEmail;
    }

    let nextRole = existingUser.role;
    if (role !== undefined) {
      const normalizedRole = String(role).trim();
      if (!ALLOWED_ROLES.has(normalizedRole)) {
        return res.status(400).json({ error: 'الدور الوظيفي المحدد غير صالح' });
      }
      nextRole = normalizedRole;
      updateData.role = normalizedRole;
    }

    if (phone !== undefined) updateData.phone = phone ? String(phone).trim() : null;

    let nextActive = Boolean(existingUser.isActive);
    if (isActive !== undefined) {
      nextActive = Boolean(isActive);
      updateData.isActive = nextActive;
    }

    // Protect last active ADMIN from deactivation or demotion
    if (existingUser.role === 'ADMIN' && existingUser.isActive && (!nextActive || nextRole !== 'ADMIN')) {
      const activeAdmins = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true)));
      if (activeAdmins.length <= 1) {
        return res.status(400).json({
          error: 'لا يمكن تعطيل أو تغيير صلاحية آخر مدير عام نشط في النظام',
        });
      }
    }

    let pinChanged = false;
    if (pin !== undefined) {
      if (pin === null || String(pin).trim().length === 0) {
        updateData.pin = null;
        pinChanged = true;
      } else {
        const trimmedPin = String(pin).trim();
        if (trimmedPin.length < 4 || trimmedPin.length > 12) {
          return res.status(400).json({ error: 'رمز PIN يجب أن يتكون من 4 إلى 12 خانة' });
        }
        const existingWithPins = await db
          .select({ id: users.id, pin: users.pin })
          .from(users)
          .where(isNotNull(users.pin));
        for (const otherUser of existingWithPins) {
          if (otherUser.id !== userId && (await verifyPin(trimmedPin, otherUser.pin))) {
            return res.status(409).json({ error: 'رمز PIN مستخدم بالفعل من طرف موظف آخر' });
          }
        }
        const WEAK_PINS = new Set(['1234', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999']);
        if (WEAK_PINS.has(trimmedPin)) {
          return res.status(400).json({ error: 'يرجى اختيار رمز PIN غير متكرر وأقوى من الرموز الافتراضية' });
        }
        updateData.pin = await hashPin(trimmedPin);
        pinChanged = true;
      }
    }

    if (password !== undefined && password !== null && String(password) !== '') {
      const passwordCheck = validatePasswordStrength(password, existingUser.username);
      if (!passwordCheck.valid) {
        return res.status(400).json({ error: passwordCheck.error });
      }
      const salt = bcrypt.genSaltSync(10);
      updateData.passwordHash = bcrypt.hashSync(password, salt);
    }

    const updated = await db.update(users).set(updateData).where(eq(users.id, userId)).returning();

    if (updated.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const statusToggled = isActive !== undefined && Boolean(existingUser.isActive) !== Boolean(updated[0].isActive);
    const auditAction = pinChanged
      ? 'RESET_STAFF_PIN'
      : statusToggled
      ? 'TOGGLE_STAFF_STATUS'
      : 'UPDATE_USER';
    const auditDetails = pinChanged
      ? `إعادة تعيين رمز PIN للموظف: ${updated[0].fullName} (بشكل مشفر)`
      : statusToggled
      ? `${updated[0].isActive ? 'تفعيل' : 'تعطيل'} حساب الموظف: ${updated[0].fullName}`
      : `تعديل بيانات وصلاحيات الموظف: ${updated[0].fullName} (${updated[0].role})`;

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: auditAction,
      entityType: 'USER',
      entityId: String(userId),
      details: auditDetails,
      ipAddress: req.ip,
    });

    const { passwordHash: _ph, pin: _pin, ...safeUser } = updated[0];
    res.json({ ...safeUser, hasPin: Boolean(_pin) });
  } catch (error: any) {
    console.error('Update user error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل تحديث بيانات المستخدم' });
  }
});

// ==========================================
// 3. CATEGORIES
// ==========================================
apiRouter.get('/categories', requireAuth, async (_req, res) => {
  try {
    const list = await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل الفئات' });
  }
});

apiRouter.post('/categories', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const { nameAr, nameFr, nameEn, icon, color, sortOrder, station } = req.body;
    if (!nameAr) return res.status(400).json({ error: 'اسم الفئة بالعربية مطلوب' });

    const inserted = await db.insert(categories).values({
      nameAr,
      nameFr: nameFr || null,
      nameEn: nameEn || null,
      icon: icon || 'Utensils',
      color: color || 'amber',
      sortOrder: sortOrder || 0,
      station: station || 'MAIN_KITCHEN',
      isActive: true,
    }).returning();

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'CREATE_CATEGORY',
      entityType: 'CATEGORY',
      entityId: String(inserted[0].id),
      details: `إضافة فئة جديدة: ${nameAr}`,
    });

    res.status(201).json(inserted[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل إنشاء الفئة' });
  }
});

apiRouter.put('/categories/:id', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف الفئة غير صالح' });
    }
    const existingRows = await db.select().from(categories).where(eq(categories.id, id));
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'الفئة غير موجودة' });
    }
    const cur = existingRows[0];
    const { nameAr, nameFr, nameEn, icon, color, sortOrder, isActive, station } = req.body;

    if (nameAr !== undefined && !String(nameAr).trim()) {
      return res.status(400).json({ error: 'اسم الفئة بالعربية مطلوب' });
    }

    const updated = await db.update(categories).set({
      nameAr: nameAr !== undefined ? String(nameAr).trim() : cur.nameAr,
      nameFr: nameFr !== undefined ? (nameFr || null) : cur.nameFr,
      nameEn: nameEn !== undefined ? (nameEn || null) : cur.nameEn,
      icon: icon !== undefined ? (icon || cur.icon) : cur.icon,
      color: color !== undefined ? (color || cur.color) : cur.color,
      sortOrder: sortOrder !== undefined ? Number(sortOrder) || 0 : cur.sortOrder,
      isActive: isActive !== undefined ? Boolean(isActive) : cur.isActive,
      station: station !== undefined ? (station || cur.station) : cur.station,
    }).where(eq(categories.id, id)).returning();

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'UPDATE_CATEGORY',
      entityType: 'CATEGORY',
      entityId: String(id),
      details: `تعديل الفئة: ${updated[0].nameAr}`,
      ipAddress: req.ip,
    });

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تعديل الفئة' });
  }
});

apiRouter.delete('/categories/:id', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'معرف الفئة غير صالح' });
    }
    const existing = await db.select().from(categories).where(eq(categories.id, id));
    if (existing.length === 0) {
      return res.status(404).json({ error: 'الفئة غير موجودة' });
    }
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, id));
    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'DISABLE_CATEGORY',
      entityType: 'CATEGORY',
      entityId: String(id),
      details: `تعطيل الفئة بشكل آمن: ${existing[0].nameAr}`,
      ipAddress: req.ip,
    });
    res.json({ success: true, message: 'تم تعطيل الفئة بنجاح' });
  } catch (error: any) {
    res.status(500).json({ error: 'فشل حذف الفئة' });
  }
});

// ==========================================
// 4. PRODUCTS & MENU MANAGEMENT
// ==========================================
apiRouter.get('/products', requireAuth, async (_req, res) => {
  try {
    const prods = await db.select().from(products).orderBy(asc(products.id));
    const variants = await db.select().from(productVariants);
    const addons = await db.select().from(productAddons);
    const recipesWithIngredients = await db
      .select({
        id: productRecipes.id,
        productId: productRecipes.productId,
        ingredientId: productRecipes.ingredientId,
        quantity: productRecipes.quantity,
        ingredientName: ingredients.nameAr,
        ingredientNameFr: ingredients.nameFr,
        ingredientUnit: ingredients.unit,
        ingredientCostPerUnit: ingredients.costPerUnit,
      })
      .from(productRecipes)
      .leftJoin(ingredients, eq(productRecipes.ingredientId, ingredients.id));

    // Group active variants, product+global active addons & enriched recipes by product
    const activeGlobalAddons = addons.filter((a) => a.productId === null && a.isActive !== false);
    const fullProducts = prods.map((p) => ({
      ...p,
      variants: variants
        .filter((v) => v.productId === p.id && v.isActive !== false)
        .map((v) => ({
          ...v,
          price:
            v.price !== null && v.price !== undefined
              ? Number(v.price)
              : Number(p.price) + Number(v.priceAdjustment || 0),
        })),
      addons: [
        ...addons.filter((a) => a.productId === p.id && a.isActive !== false),
        ...activeGlobalAddons,
      ],
      recipes: recipesWithIngredients.filter((r) => r.productId === p.id),
    }));

    res.json(fullProducts);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل قائمة الأطباق' });
  }
});

apiRouter.post('/products', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const {
      categoryId,
      nameAr,
      nameFr,
      nameEn,
      description,
      price,
      costPrice,
      barcode,
      station,
      isAvailable,
      variants,
      addons,
      recipes,
    } = req.body;

    const numPrice = Number(price);
    const numCategoryId = Number(categoryId);
    if (!nameAr || price === undefined || price === null || !Number.isFinite(numPrice) || numPrice < 0 || !Number.isFinite(numCategoryId) || numCategoryId <= 0) {
      return res.status(400).json({ error: 'الاسم والسعر الصحيح (>= 0) والفئة حقول إلزامية' });
    }

    const numCostPrice = costPrice !== undefined && costPrice !== null && costPrice !== '' ? Number(costPrice) : 0;
    if (!Number.isFinite(numCostPrice) || numCostPrice < 0) {
      return res.status(400).json({ error: 'سعر التكلفة غير صالح' });
    }

    if (recipes && Array.isArray(recipes)) {
      for (const r of recipes) {
        if (!Number.isFinite(Number(r.ingredientId)) || Number(r.ingredientId) <= 0 || !Number.isFinite(Number(r.quantity)) || Number(r.quantity) <= 0) {
          return res.status(400).json({ error: 'بيانات مكونات الوصفة غير صالحة' });
        }
      }
    }

    const createdProd = db.transaction((tx) => {
      const inserted = tx.insert(products).values({
        categoryId: numCategoryId,
        nameAr: String(nameAr).trim(),
        nameFr: nameFr || null,
        nameEn: nameEn || null,
        sku: req.body.sku ? String(req.body.sku).trim() : null,
        subcategoryAr: req.body.subcategoryAr ? String(req.body.subcategoryAr).trim() : null,
        subcategoryFr: req.body.subcategoryFr ? String(req.body.subcategoryFr).trim() : null,
        description: description || null,
        price: String(numPrice),
        costPrice: String(numCostPrice),
        barcode: barcode || null,
        station: station || 'MAIN_KITCHEN',
        isAvailable: isAvailable !== undefined ? Boolean(isAvailable) : true,
        isActive: isAvailable !== undefined ? Boolean(isAvailable) : true,
      }).returning().all();

      const prodId = inserted[0].id;

      if (variants && Array.isArray(variants)) {
        for (const v of variants) {
          if (v.nameAr) {
            const explicitPrice =
              v.price !== undefined && v.price !== null && v.price !== '' ? Number(v.price) : null;
            if (explicitPrice !== null && (!Number.isFinite(explicitPrice) || explicitPrice < 0)) {
              throw new Error('سعر الخيار غير صالح');
            }
            const adj =
              explicitPrice !== null ? explicitPrice - numPrice : Number(v.priceAdjustment || 0);
            if (!Number.isFinite(adj)) throw new Error('تعديل سعر الخيار غير صالح');
            tx.insert(productVariants).values({
              productId: prodId,
              nameAr: v.nameAr,
              nameFr: v.nameFr || null,
              price: explicitPrice !== null ? Math.round(explicitPrice) : Math.round(numPrice + adj),
              priceAdjustment: String(adj),
              sku: v.sku ? String(v.sku).trim() : null,
              isActive: true,
            }).run();
          }
        }
      }

      if (addons && Array.isArray(addons)) {
        for (const a of addons) {
          if (a.nameAr) {
            const addonPrice = Number(a.price || 0);
            if (!Number.isFinite(addonPrice) || addonPrice < 0) throw new Error('سعر الإضافة غير صالح');
            tx.insert(productAddons).values({
              productId: prodId,
              nameAr: a.nameAr,
              nameFr: a.nameFr || null,
              price: String(addonPrice),
              isActive: true,
              createdAt: new Date().toISOString(),
            }).run();
          }
        }
      }

      if (recipes && Array.isArray(recipes)) {
        for (const r of recipes) {
          if (r.ingredientId && r.quantity) {
            tx.insert(productRecipes).values({
              productId: prodId,
              ingredientId: Number(r.ingredientId),
              quantity: String(Number(r.quantity)),
            }).run();
          }
        }
      }

      return inserted[0];
    });

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'CREATE_PRODUCT',
      entityType: 'PRODUCT',
      entityId: String(createdProd.id),
      details: `إضافة طبق جديد: ${nameAr} بسعر ${numPrice} DA`,
    });

    res.status(201).json(createdProd);
  } catch (error: any) {
    logStructuredError('CREATE_PRODUCT', error, req);
    res.status(500).json({ error: 'فشل إضافة الطبق' });
  }
});

apiRouter.put('/products/:id', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const prodId = Number(req.params.id);
    if (!Number.isFinite(prodId) || prodId <= 0) {
      return res.status(400).json({ error: 'معرف الطبق غير صالح' });
    }

    const {
      categoryId,
      nameAr,
      nameFr,
      nameEn,
      description,
      price,
      costPrice,
      barcode,
      station,
      isAvailable,
      reasonForPriceChange,
      variants,
      addons,
      recipes,
    } = req.body;

    if (price !== undefined && price !== null && price !== '') {
      const parsedPrice = Number(price);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        return res.status(400).json({ error: 'سعر البيع يجب أن يكون رقماً موجباً صالحاً' });
      }
    }

    if (costPrice !== undefined && costPrice !== null && costPrice !== '') {
      const parsedCost = Number(costPrice);
      if (!Number.isFinite(parsedCost) || parsedCost < 0) {
        return res.status(400).json({ error: 'سعر التكلفة يجب أن يكون رقماً موجباً صالحاً' });
      }
    }

    if (variants && Array.isArray(variants)) {
      for (const v of variants) {
        if (v.priceAdjustment !== undefined && !Number.isFinite(Number(v.priceAdjustment))) {
          return res.status(400).json({ error: 'تعديل سعر الخيار غير صالح' });
        }
      }
    }

    if (addons && Array.isArray(addons)) {
      for (const a of addons) {
        const addonPrice = Number(a.price || 0);
        if (!Number.isFinite(addonPrice) || addonPrice < 0) {
          return res.status(400).json({ error: 'سعر الإضافة غير صالح' });
        }
      }
    }

    if (recipes && Array.isArray(recipes)) {
      for (const r of recipes) {
        if (!Number.isFinite(Number(r.ingredientId)) || Number(r.ingredientId) <= 0 || !Number.isFinite(Number(r.quantity)) || Number(r.quantity) <= 0) {
          return res.status(400).json({ error: 'بيانات مكونات الوصفة غير صالحة' });
        }
      }
    }

    const txResult = db.transaction((tx): { notFound: true } | { notFound: false; product: any; priceChanged: boolean; oldPrice: number; newPrice: number } => {
      const existing = tx.select().from(products).where(eq(products.id, prodId)).all();
      if (existing.length === 0) return { notFound: true };

      const currentProd = existing[0];
      const oldPrice = Number(currentProd.price);
      const newPrice =
        price !== undefined && price !== null && price !== '' ? Number(price) : oldPrice;
      const nextCostPrice =
        costPrice !== undefined && costPrice !== null && costPrice !== ''
          ? String(Number(costPrice))
          : currentProd.costPrice;

      if (newPrice !== oldPrice) {
        tx.insert(priceHistory).values({
          productId: prodId,
          oldPrice: String(oldPrice),
          newPrice: String(newPrice),
          changedByUserId: req.user!.id,
          reason: reasonForPriceChange || 'تعديل السعر من إدارة القائمة',
        }).run();

        tx.insert(auditLogs).values({
          userId: req.user!.id,
          userName: req.user!.fullName,
          action: 'CHANGE_PRICE',
          entityType: 'PRODUCT',
          entityId: String(prodId),
          details: `تغيير سعر ${currentProd.nameAr} من ${oldPrice} DA إلى ${newPrice} DA`,
          previousValue: String(oldPrice),
          newValue: String(newPrice),
        }).run();
      }

      const updated = tx.update(products).set({
        categoryId: categoryId !== undefined ? Number(categoryId) : currentProd.categoryId,
        nameAr: nameAr ?? currentProd.nameAr,
        nameFr: nameFr ?? currentProd.nameFr,
        nameEn: nameEn ?? currentProd.nameEn,
        sku: req.body.sku !== undefined ? (req.body.sku ? String(req.body.sku).trim() : null) : currentProd.sku,
        subcategoryAr:
          req.body.subcategoryAr !== undefined
            ? (req.body.subcategoryAr ? String(req.body.subcategoryAr).trim() : null)
            : currentProd.subcategoryAr,
        subcategoryFr:
          req.body.subcategoryFr !== undefined
            ? (req.body.subcategoryFr ? String(req.body.subcategoryFr).trim() : null)
            : currentProd.subcategoryFr,
        description: description ?? currentProd.description,
        price: String(newPrice),
        costPrice: nextCostPrice,
        barcode: barcode ?? currentProd.barcode,
        station: station ?? currentProd.station,
        isAvailable: isAvailable !== undefined ? Boolean(isAvailable) : currentProd.isAvailable,
        isActive: isAvailable !== undefined ? Boolean(isAvailable) : currentProd.isActive,
        updatedAt: new Date().toISOString(),
      }).where(eq(products.id, prodId)).returning().all();

      if (variants && Array.isArray(variants)) {
        tx.delete(productVariants).where(eq(productVariants.productId, prodId)).run();
        for (const v of variants) {
          if (v.nameAr) {
            const explicitPrice =
              v.price !== undefined && v.price !== null && v.price !== '' ? Number(v.price) : null;
            const adj =
              explicitPrice !== null ? explicitPrice - newPrice : Number(v.priceAdjustment || 0);
            tx.insert(productVariants).values({
              productId: prodId,
              nameAr: v.nameAr,
              nameFr: v.nameFr || null,
              price: explicitPrice !== null ? Math.round(explicitPrice) : Math.round(newPrice + adj),
              priceAdjustment: String(adj),
              sku: v.sku ? String(v.sku).trim() : null,
              isActive: v.isActive !== undefined ? Boolean(v.isActive) : true,
            }).run();
          }
        }
      }

      if (addons && Array.isArray(addons)) {
        tx.delete(productAddons).where(eq(productAddons.productId, prodId)).run();
        for (const a of addons) {
          if (a.nameAr) {
            tx.insert(productAddons).values({
              productId: prodId,
              nameAr: a.nameAr,
              nameFr: a.nameFr || null,
              price: String(Number(a.price || 0)),
              isActive: a.isActive !== undefined ? Boolean(a.isActive) : true,
              createdAt: new Date().toISOString(),
            }).run();
          }
        }
      }

      if (recipes && Array.isArray(recipes)) {
        tx.delete(productRecipes).where(eq(productRecipes.productId, prodId)).run();
        for (const r of recipes) {
          if (r.ingredientId && r.quantity) {
            tx.insert(productRecipes).values({
              productId: prodId,
              ingredientId: Number(r.ingredientId),
              quantity: String(Number(r.quantity)),
            }).run();
          }
        }
      }

      return {
        notFound: false,
        product: updated[0],
        priceChanged: newPrice !== oldPrice,
        oldPrice,
        newPrice,
      };
    });

    if (txResult.notFound) {
      return res.status(404).json({ error: 'الطبق غير موجود' });
    }

    res.json(txResult.product);
  } catch (error: any) {
    console.error('Update product error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل تحديث بيانات الطبق' });
  }
});

// Toggle Product Availability (Fast for Cashier / Kitchen)
apiRouter.patch('/products/:id/toggle-available', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN']), async (req: AuthRequest, res) => {
  try {
    const prodId = parsePositiveInt(req.params.id);
    if (prodId === null) return res.status(400).json({ error: 'معرف الطبق غير صالح' });
    const existing = await db.select().from(products).where(eq(products.id, prodId));
    if (existing.length === 0) return res.status(404).json({ error: 'الطبق غير موجود' });

    const newStatus = !existing[0].isAvailable;
    const updated = await db.update(products).set({ isAvailable: newStatus }).where(eq(products.id, prodId)).returning();

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: newStatus ? 'ENABLE_PRODUCT' : 'DISABLE_PRODUCT',
      entityType: 'PRODUCT',
      entityId: String(prodId),
      details: `${newStatus ? 'تفعيل' : 'تعطيل'} توفر الطبق: ${existing[0].nameAr}`,
    });

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تغيير حالة توفر الطبق' });
  }
});

// ==========================================
// 2B. PRODUCT ADD-ONS (Empty by default; Admin-configured global/product extras)
// ==========================================
apiRouter.get('/addons', requireAuth, async (req: AuthRequest, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const allAddons = await db.select().from(productAddons).orderBy(asc(productAddons.id));
    const result = includeInactive ? allAddons : allAddons.filter((a) => a.isActive !== false);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل قائمة الإضافات' });
  }
});

apiRouter.post('/addons', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const { productId = null, nameAr, nameFr, price = 0, isActive = true } = req.body;
    const cleanNameAr = String(nameAr || '').trim();
    const numPrice = Number(price);
    if (!cleanNameAr || !Number.isFinite(numPrice) || numPrice < 0 || !Number.isInteger(numPrice)) {
      return res.status(400).json({ error: 'اسم الإضافة والسعر الصحيح (عدد صحيح >= 0 بالدينار) مطلوبان' });
    }

    let resolvedProductId: number | null = null;
    if (productId !== null && productId !== undefined && productId !== '') {
      const pid = Number(productId);
      if (!Number.isFinite(pid) || pid <= 0) {
        return res.status(400).json({ error: 'معرف المنتج المرتبط غير صالح' });
      }
      const existingProd = await db.select({ id: products.id }).from(products).where(eq(products.id, pid));
      if (existingProd.length === 0) {
        return res.status(404).json({ error: 'المنتج المرتبط غير موجود' });
      }
      resolvedProductId = pid;
    }

    const inserted = await db
      .insert(productAddons)
      .values({
        productId: resolvedProductId,
        nameAr: cleanNameAr,
        nameFr: nameFr ? String(nameFr).trim() : null,
        price: String(numPrice),
        isActive: Boolean(isActive),
        createdAt: new Date().toISOString(),
      })
      .returning();

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'CREATE_ADDON',
      entityType: 'PRODUCT_ADDON',
      entityId: String(inserted[0].id),
      details: `إنشاء إضافة جديدة: ${cleanNameAr} بسعر ${numPrice} DA`,
      newValue: JSON.stringify(inserted[0]),
      ipAddress: req.ip,
    });

    res.status(201).json(inserted[0]);
  } catch (error: any) {
    console.error('Create addon error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل إنشاء الإضافة' });
  }
});

apiRouter.put('/addons/:id', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const addonId = Number(req.params.id);
    if (!Number.isFinite(addonId) || addonId <= 0) {
      return res.status(400).json({ error: 'معرف الإضافة غير صالح' });
    }
    const existing = await db.select().from(productAddons).where(eq(productAddons.id, addonId));
    if (existing.length === 0) {
      return res.status(404).json({ error: 'الإضافة غير موجودة' });
    }

    const current = existing[0];
    const nextNameAr = req.body.nameAr !== undefined ? String(req.body.nameAr).trim() : current.nameAr;
    const nextPrice = req.body.price !== undefined ? Number(req.body.price) : Number(current.price);
    if (!nextNameAr || !Number.isFinite(nextPrice) || nextPrice < 0 || !Number.isInteger(nextPrice)) {
      return res.status(400).json({ error: 'اسم الإضافة والسعر الصحيح (عدد صحيح >= 0) مطلوبان' });
    }

    const updated = await db
      .update(productAddons)
      .set({
        nameAr: nextNameAr,
        nameFr: req.body.nameFr !== undefined ? (req.body.nameFr ? String(req.body.nameFr).trim() : null) : current.nameFr,
        price: String(nextPrice),
        isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : current.isActive,
      })
      .where(eq(productAddons.id, addonId))
      .returning();

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'UPDATE_ADDON',
      entityType: 'PRODUCT_ADDON',
      entityId: String(addonId),
      details: `تحديث الإضافة: ${nextNameAr} (${nextPrice} DA)`,
      previousValue: JSON.stringify(current),
      newValue: JSON.stringify(updated[0]),
      ipAddress: req.ip,
    });

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحديث الإضافة' });
  }
});

apiRouter.delete('/addons/:id', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const addonId = Number(req.params.id);
    if (!Number.isFinite(addonId) || addonId <= 0) {
      return res.status(400).json({ error: 'معرف الإضافة غير صالح' });
    }
    const existing = await db.select().from(productAddons).where(eq(productAddons.id, addonId));
    if (existing.length === 0) {
      return res.status(404).json({ error: 'الإضافة غير موجودة' });
    }

    await db.delete(productAddons).where(eq(productAddons.id, addonId));
    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'DELETE_ADDON',
      entityType: 'PRODUCT_ADDON',
      entityId: String(addonId),
      details: `حذف الإضافة: ${existing[0].nameAr}`,
      previousValue: JSON.stringify(existing[0]),
      ipAddress: req.ip,
    });

    res.json({ success: true, id: addonId });
  } catch (error: any) {
    res.status(500).json({ error: 'فشل حذف الإضافة' });
  }
});

// ==========================================
// 2C. OFFICIAL MENU IMPORT MODULE (CSV / XLSX / JSON — ADMIN/OWNER ONLY)
// ==========================================
apiRouter.post('/menu/import/preview', requireAuth, requireRole(['ADMIN', 'OWNER']), async (req: AuthRequest, res) => {
  try {
    const { filename, format, content, contentBase64 } = req.body || {};
    if (!filename || (!content && !contentBase64)) {
      return res.status(400).json({ error: 'يرجى تحديد ملف صالح بصيغة CSV أو XLSX أو JSON' });
    }
    const preview = await previewMenuImport({ filename, format, content, contentBase64 });
    res.json(preview);
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'فشل تحليل ملف القائمة' });
  }
});

apiRouter.post('/menu/import/commit', requireAuth, requireRole(['ADMIN', 'OWNER']), async (req: AuthRequest, res) => {
  try {
    const { filename, format, content, contentBase64, confirmed, rejectOnDuplicates } = req.body || {};
    if (confirmed !== true) {
      return res.status(400).json({ error: 'مطلوب تأكيد صريح من المدير قبل تنفيذ استيراد القائمة' });
    }
    if (!filename || (!content && !contentBase64)) {
      return res.status(400).json({ error: 'بيانات ملف القائمة مفقودة' });
    }

    const report = await commitMenuImport(
      {
        filename,
        format,
        content,
        contentBase64,
        confirmed: true,
        rejectOnDuplicates: Boolean(rejectOnDuplicates),
      },
      {
        userId: req.user!.id,
        userName: req.user!.fullName,
        ipAddress: req.ip,
      }
    );

    res.status(201).json(report);
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'فشل تنفيذ استيراد القائمة' });
  }
});

apiRouter.get('/menu/import/history', requireAuth, requireRole(['ADMIN', 'OWNER', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const limit = Number(req.query.limit) || 30;
    const history = await listMenuImportHistory(limit);
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل سجل عمليات استيراد القائمة' });
  }
});

// Safe Delete / Deactivate Product (NEVER physically deletes products so historical orders/invoices stay intact)
apiRouter.delete('/products/:id', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const prodId = parsePositiveInt(req.params.id);
    if (prodId === null) {
      return res.status(400).json({ error: 'معرف الطبق غير صالح' });
    }
    const existing = await db.select().from(products).where(eq(products.id, prodId));
    if (existing.length === 0) {
      return res.status(404).json({ error: 'الطبق غير موجود' });
    }

    const histRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(orderItems)
      .where(eq(orderItems.productId, prodId));
    const hasHistoricalOrders = Number(histRows[0]?.count || 0) > 0;

    await db
      .update(products)
      .set({ isAvailable: false, updatedAt: new Date().toISOString() })
      .where(eq(products.id, prodId));

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'DELETE_PRODUCT',
      entityType: 'PRODUCT',
      entityId: String(prodId),
      details: `تعطيل وحذف آمن للطبق ${existing[0].nameAr} (رقم ${prodId})${hasHistoricalOrders ? ' — مرتبط بفواتير تاريخية' : ''}`,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      softDeleted: true,
      hasHistoricalOrders,
      message: hasHistoricalOrders
        ? 'تم تعطيل الطبق وإخفاؤه من الكاشير دون حذف سجله المرتبط بالفواتير التاريخية'
        : 'تم تعطيل الطبق وإخفاؤه بنجاح دون المساس بالفواتير القديمة',
    });
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تعطيل الطبق' });
  }
});

// Price History Audit for a Product
apiRouter.get('/products/:id/price-history', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const prodId = parsePositiveInt(req.params.id);
    if (prodId === null) {
      return res.status(400).json({ error: 'معرف الطبق غير صالح' });
    }
    const history = await db.select({
      id: priceHistory.id,
      oldPrice: priceHistory.oldPrice,
      newPrice: priceHistory.newPrice,
      reason: priceHistory.reason,
      changedAt: priceHistory.changedAt,
      changedBy: users.fullName,
    })
    .from(priceHistory)
    .leftJoin(users, eq(priceHistory.changedByUserId, users.id))
    .where(eq(priceHistory.productId, prodId))
    .orderBy(desc(priceHistory.changedAt));

    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل استرجاع سجل الأسعار' });
  }
});

// ==========================================
// 5. RESTAURANT TABLES & ZONES
// ==========================================
apiRouter.get('/tables', requireAuth, async (_req, res) => {
  try {
    let tablesList = await db
      .select({
        table: restaurantTables,
        order: orders,
      })
      .from(restaurantTables)
      .leftJoin(orders, eq(restaurantTables.currentOrderId, orders.id));

    // Auto-ensure exactly 30 tables (1 to 30) exist in SQLite
    if (tablesList.length < 30) {
      const existingNums = new Set(tablesList.map((t) => String(t.table.tableNumber).trim()));
      for (let i = 1; i <= 30; i++) {
        const numStr = String(i);
        if (!existingNums.has(numStr)) {
          let zone = 'الصالة الرئيسية';
          let cap = 4;
          if (i >= 17 && i <= 24) {
            zone = 'الشرفة الخارجية';
            cap = 4;
          } else if (i >= 25 && i <= 30) {
            zone = 'صالون VIP والعائلات';
            cap = 8;
          }
          await db.insert(restaurantTables).values({
            tableNumber: numStr,
            zone,
            capacity: cap,
            status: 'AVAILABLE',
          }).onConflictDoNothing();
        }
      }

      // Re-query after auto-seed
      tablesList = await db
        .select({
          table: restaurantTables,
          order: orders,
        })
        .from(restaurantTables)
        .leftJoin(orders, eq(restaurantTables.currentOrderId, orders.id));
    }

    const formatted = tablesList.map(({ table, order }) => {
      let effectiveStatus = table.status;
      if (
        order &&
        order.status === 'READY' &&
        order.paymentStatus !== 'PAID' &&
        table.status !== 'WAITING_PAYMENT' &&
        table.status !== 'INACTIVE'
      ) {
        effectiveStatus = 'READY';
      }

      return {
        ...table,
        status: effectiveStatus,
        activeOrder: order
          ? {
              id: order.id,
              orderNumber: order.orderNumber,
              total: Number(order.total),
              paidAmount: Number(order.paidAmount || 0),
              status: order.status,
              paymentStatus: order.paymentStatus,
              createdAt: order.createdAt,
            }
          : null,
      };
    });

    // Natural numeric sort: 1, 2, 3 ... 30
    formatted.sort((a, b) => {
      const numA = parseInt(a.tableNumber.replace(/\D/g, '') || String(a.id), 10);
      const numB = parseInt(b.tableNumber.replace(/\D/g, '') || String(b.id), 10);
      return numA - numB;
    });

    res.json(formatted);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل الطاولات' });
  }
});

apiRouter.post('/tables', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const { tableNumber, zone, capacity } = req.body;
    if (!tableNumber) return res.status(400).json({ error: 'رقم الطاولة مطلوب' });

    const inserted = await db.insert(restaurantTables).values({
      tableNumber,
      zone: zone || 'MAIN_HALL',
      capacity: capacity ? Number(capacity) : 4,
      status: 'AVAILABLE',
    }).returning();

    res.status(201).json(inserted[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل إنشاء الطاولة (قد يكون الرقم مكرراً)' });
  }
});

// Change Table Status or Free Table
apiRouter.patch('/tables/:id/status', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (req: AuthRequest, res) => {
  try {
    const tableId = parsePositiveInt(req.params.id);
    if (tableId === null) {
      return res.status(400).json({ error: 'معرف الطاولة غير صالح' });
    }
    const { status, currentOrderId } = req.body || {};
    const allowedTableStatuses = new Set([
      'AVAILABLE',
      'OCCUPIED',
      'RESERVED',
      'WAITING_PAYMENT',
      'READY',
      'CLEANING',
      'INACTIVE',
    ]);
    if (!status || !allowedTableStatuses.has(String(status))) {
      return res.status(400).json({ error: 'حالة الطاولة غير صالحة' });
    }

    const updated = await db.update(restaurantTables).set({
      status: String(status),
      currentOrderId: currentOrderId !== undefined ? currentOrderId : null,
    }).where(eq(restaurantTables.id, tableId)).returning();

    if (updated.length === 0) {
      return res.status(404).json({ error: 'الطاولة غير موجودة' });
    }

    res.json(updated[0]);
  } catch (error: any) {
    logStructuredError('UPDATE_TABLE_STATUS', error, req);
    res.status(500).json({ error: 'فشل تحديث حالة الطاولة' });
  }
});

// Transfer Table (Move Order from Table A to Table B atomically inside db.transaction)
apiRouter.post('/tables/transfer', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (req: AuthRequest, res) => {
  try {
    const fromTableId = parsePositiveInt(req.body?.fromTableId);
    const toTableId = parsePositiveInt(req.body?.toTableId);
    if (fromTableId === null || toTableId === null) {
      return res.status(400).json({ error: 'طاولة المصدر والوجهة مطلوبتان' });
    }
    if (fromTableId === toTableId) {
      return res.status(400).json({ error: 'لا يمكن نقل الطاولة إلى نفسها' });
    }

    const txOutcome = db.transaction((tx):
      | { kind: 'error'; status: number; error: string }
      | { kind: 'transferred'; orderId: number; fromNumber: string; toNumber: string } => {
      const fromT = tx.select().from(restaurantTables).where(eq(restaurantTables.id, fromTableId)).all();
      const toT = tx.select().from(restaurantTables).where(eq(restaurantTables.id, toTableId)).all();

      if (fromT.length === 0 || toT.length === 0) {
        return { kind: 'error', status: 404, error: 'إحدى الطاولات غير موجودة' };
      }
      const orderId = fromT[0].currentOrderId;
      if (!orderId) {
        return { kind: 'error', status: 400, error: 'لا يوجد طلب نشط على طاولة المصدر' };
      }
      if (toT[0].status !== 'AVAILABLE' || toT[0].currentOrderId) {
        return { kind: 'error', status: 409, error: 'الطاولة الهدف غير متاحة أو مشغولة بطلب آخر' };
      }

      const targetStatus = fromT[0].status === 'WAITING_PAYMENT' ? 'WAITING_PAYMENT' : 'OCCUPIED';

      tx.update(orders).set({
        tableId: toTableId,
        updatedAt: new Date().toISOString(),
      }).where(eq(orders.id, orderId)).run();

      tx.update(restaurantTables).set({ status: 'AVAILABLE', currentOrderId: null }).where(eq(restaurantTables.id, fromTableId)).run();
      tx.update(restaurantTables).set({ status: targetStatus, currentOrderId: orderId }).where(eq(restaurantTables.id, toTableId)).run();

      return { kind: 'transferred', orderId, fromNumber: fromT[0].tableNumber, toNumber: toT[0].tableNumber };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'TRANSFER_TABLE',
      details: `نقل الطلب رقم ${txOutcome.orderId} من الطاولة ${txOutcome.fromNumber} إلى ${txOutcome.toNumber}`,
    });

    res.json({ success: true, message: `تم نقل الطلب إلى الطاولة ${txOutcome.toNumber} بنجاح` });
  } catch (error: any) {
    logStructuredError('TRANSFER_TABLE', error, req);
    res.status(500).json({ error: 'فشل نقل الطاولة' });
  }
});

// Merge Tables (Combine active orders or attach table A to table B atomically inside db.transaction)
apiRouter.post('/tables/merge', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (req: AuthRequest, res) => {
  try {
    const sourceTableId = Number(req.body?.sourceTableId);
    const targetTableId = Number(req.body?.targetTableId);
    if (!Number.isFinite(sourceTableId) || sourceTableId <= 0 || !Number.isFinite(targetTableId) || targetTableId <= 0) {
      return res.status(400).json({ error: 'طاولة المصدر والوجهة مطلوبتان للدمج' });
    }
    if (sourceTableId === targetTableId) {
      return res.status(400).json({ error: 'لا يمكن دمج الطاولة مع نفسها' });
    }

    const txOutcome = db.transaction((tx):
      | { kind: 'error'; status: number; error: string }
      | { kind: 'ok'; sourceNum: string; targetNum: string; targetOrderId: number | null } => {
      const sourceT = tx.select().from(restaurantTables).where(eq(restaurantTables.id, sourceTableId)).all();
      const targetT = tx.select().from(restaurantTables).where(eq(restaurantTables.id, targetTableId)).all();

      if (sourceT.length === 0 || targetT.length === 0) {
        return { kind: 'error', status: 404, error: 'إحدى الطاولات غير موجودة' };
      }

      const sourceOrderId = sourceT[0].currentOrderId;
      const targetOrderId = targetT[0].currentOrderId;

      if (!sourceOrderId && !targetOrderId) {
        return { kind: 'error', status: 400, error: 'لا يوجد طلب نشط على أي من الطاولتين للدمج' };
      }

      const taxRow = tx.select().from(restaurantSettings).where(eq(restaurantSettings.key, 'tax_rate')).all();
      const currentTaxRate = Math.max(0, Number(taxRow[0]?.value || 0)) || 0;
      const nowIso = new Date().toISOString();

      let finalTargetOrderId = targetOrderId;

      if (sourceOrderId && targetOrderId && sourceOrderId !== targetOrderId) {
        const sourceOrdRows = tx.select().from(orders).where(eq(orders.id, sourceOrderId)).all();
        const targetOrdRows = tx.select().from(orders).where(eq(orders.id, targetOrderId)).all();
        if (sourceOrdRows.length === 0 || targetOrdRows.length === 0) {
          return { kind: 'error', status: 404, error: 'أحد الطلبات النشطة غير موجود' };
        }
        const sourceOrd = sourceOrdRows[0];
        const targetOrd = targetOrdRows[0];

        tx.update(orderItems)
          .set({ orderId: targetOrderId })
          .where(eq(orderItems.orderId, sourceOrderId))
          .run();

        tx.update(payments)
          .set({ orderId: targetOrderId })
          .where(eq(payments.orderId, sourceOrderId))
          .run();

        tx.update(inventoryMovements)
          .set({ referenceId: targetOrderId })
          .where(and(eq(inventoryMovements.referenceType, 'ORDER'), eq(inventoryMovements.referenceId, sourceOrderId)))
          .run();

        const allTargetItems = tx.select().from(orderItems).where(eq(orderItems.orderId, targetOrderId)).all();
        const newSubtotal = allTargetItems.reduce((acc, it) => acc + Number(it.total || 0), 0);
        const combinedDiscount = Number(targetOrd.discount || 0) + Number(sourceOrd.discount || 0);
        const combinedFee = Number(targetOrd.deliveryFee || 0) + Number(sourceOrd.deliveryFee || 0);
        const effectiveTaxRate = Number(targetOrd.taxRate || currentTaxRate) || 0;
        const taxable = Math.max(0, newSubtotal - combinedDiscount);
        const newTaxAmount = Math.round(((taxable * effectiveTaxRate) / 100) * 100) / 100;
        const newTotal = Math.max(0, taxable + newTaxAmount + combinedFee);

        const allTargetPayments = tx.select().from(payments).where(eq(payments.orderId, targetOrderId)).all();
        const newPaid = allTargetPayments
          .filter((p) => p.method !== 'REFUND' && Number(p.amount) > 0)
          .reduce((acc, p) => acc + Number(p.amount), 0);
        const isFull = newPaid >= newTotal - 0.01 && newTotal > 0;
        const nextPaymentStatus = newPaid <= 0 ? 'UNPAID' : isFull ? 'PAID' : 'PARTIALLY_PAID';

        tx.update(orders).set({
          subtotal: String(newSubtotal),
          discount: String(combinedDiscount),
          deliveryFee: String(combinedFee),
          taxRate: String(effectiveTaxRate),
          taxAmount: String(newTaxAmount),
          total: String(newTotal),
          paidAmount: String(newPaid),
          paymentStatus: nextPaymentStatus,
          status: isFull ? 'COMPLETED' : targetOrd.status,
          updatedAt: nowIso,
        }).where(eq(orders.id, targetOrderId)).run();

        tx.update(orders).set({
          status: 'CANCELLED',
          subtotal: '0',
          discount: '0',
          deliveryFee: '0',
          taxRate: '0',
          taxAmount: '0',
          total: '0',
          paidAmount: '0',
          paymentStatus: 'UNPAID',
          notes: `تم الدمج في طلب الطاولة ${targetT[0].tableNumber} (رقم ${targetOrderId})`,
          updatedAt: nowIso,
        }).where(eq(orders.id, sourceOrderId)).run();

        if (isFull) {
          tx.update(restaurantTables).set({
            status: 'AVAILABLE',
            currentOrderId: null,
          }).where(eq(restaurantTables.id, targetTableId)).run();
        } else {
          tx.update(restaurantTables).set({
            status: nextPaymentStatus === 'PARTIALLY_PAID' ? 'WAITING_PAYMENT' : 'OCCUPIED',
            currentOrderId: targetOrderId,
          }).where(eq(restaurantTables.id, targetTableId)).run();
        }
      } else if (sourceOrderId && !targetOrderId) {
        finalTargetOrderId = sourceOrderId;
        tx.update(orders).set({ tableId: targetTableId, updatedAt: nowIso }).where(eq(orders.id, sourceOrderId)).run();
        const nextStatus = sourceT[0].status === 'WAITING_PAYMENT' ? 'WAITING_PAYMENT' : 'OCCUPIED';
        tx.update(restaurantTables).set({ status: nextStatus, currentOrderId: sourceOrderId }).where(eq(restaurantTables.id, targetTableId)).run();
      }

      tx.update(restaurantTables).set({ status: 'AVAILABLE', currentOrderId: null }).where(eq(restaurantTables.id, sourceTableId)).run();

      return {
        kind: 'ok',
        sourceNum: sourceT[0].tableNumber,
        targetNum: targetT[0].tableNumber,
        targetOrderId: finalTargetOrderId,
      };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'MERGE_TABLES',
      details: `دمج الطاولة ${txOutcome.sourceNum} مع الطاولة ${txOutcome.targetNum}`,
    });

    res.json({
      success: true,
      targetOrderId: txOutcome.targetOrderId,
      message: `تم دمج الطاولة ${txOutcome.sourceNum} مع الطاولة ${txOutcome.targetNum} بنجاح`,
    });
  } catch (error: any) {
    console.error('Merge tables error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل دمج الطاولات' });
  }
});

// ==========================================
// 6. ORDERS & KITCHEN SYSTEM
// ==========================================

class OrderInputError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ValidatedOrderItem {
  productId: number;
  nameAr: string;
  nameFr: string | null;
  unitPrice: number;
  catalogUnitPrice: number;
  costPrice: number;
  quantity: number;
  total: number;
  notes: string | null;
  station: string;
  variantsJson: string | null;
  addonsJson: string | null;
  priceOverrideAudit?: {
    productId: number;
    nameAr: string;
    oldPrice: number;
    newPrice: number;
    reason: string | null;
  };
}

function validateAndPriceOrderItemsInTx(
  tx: any,
  rawItems: any[],
  userRole: string
): ValidatedOrderItem[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new OrderInputError(400, 'الطلب يجب أن يحتوي على منتج واحد على الأقل');
  }

  const productIds = Array.from(new Set(rawItems.map((it) => Number(it.productId)).filter((n) => Number.isFinite(n) && n > 0)));
  const dbProducts = productIds.length > 0
    ? tx.select().from(products).where(inArray(products.id, productIds)).all()
    : [];
  const productMap = new Map<number, any>(dbProducts.map((p: any) => [p.id, p]));

  const validated: ValidatedOrderItem[] = [];

  for (const item of rawItems) {
    const prodId = Number(item.productId);
    if (!Number.isFinite(prodId) || prodId <= 0) {
      throw new OrderInputError(400, 'معرف المنتج غير صالح');
    }
    const dbProd = productMap.get(prodId);
    if (!dbProd) {
      throw new OrderInputError(404, `المنتج غير موجود (ID: ${prodId})`);
    }

    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
      throw new OrderInputError(400, 'الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر');
    }

    // Recompute authoritative catalog price using product + verified variant + verified addons
    let baseWithVariant = Number(dbProd.price);
    const rawVariant = item.selectedVariant || (Array.isArray(item.variants) ? item.variants[0] : null);
    let normalizedVariant = rawVariant;
    if (rawVariant && rawVariant.id) {
      const vRows = tx
        .select()
        .from(productVariants)
        .where(and(eq(productVariants.id, Number(rawVariant.id)), eq(productVariants.productId, prodId)))
        .all();
      if (vRows.length === 0) {
        throw new OrderInputError(400, 'الخيار المحدد للمنتج غير صالح');
      }
      baseWithVariant =
        vRows[0].price !== null && vRows[0].price !== undefined
          ? Number(vRows[0].price)
          : Number(dbProd.price) + Number(vRows[0].priceAdjustment || 0);
      normalizedVariant = vRows[0];
    }

    let addonsTotal = 0;
    const rawAddons = Array.isArray(item.selectedAddons)
      ? item.selectedAddons
      : Array.isArray(item.addons)
      ? item.addons
      : [];
    const normalizedAddons: any[] = [];
    for (const a of rawAddons) {
      if (a && a.id) {
        const aRows = tx.select().from(productAddons).where(eq(productAddons.id, Number(a.id))).all();
        if (aRows.length === 0 || (aRows[0].productId !== null && aRows[0].productId !== prodId)) {
          throw new OrderInputError(400, 'الإضافة المحددة للمنتج غير صالحة');
        }
        addonsTotal += Number(aRows[0].price || 0);
        normalizedAddons.push(aRows[0]);
      }
    }

    const catalogUnitPrice = baseWithVariant + addonsTotal;
    let unitPrice = catalogUnitPrice;
    let priceOverrideAudit: ValidatedOrderItem['priceOverrideAudit'];

    if (item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice !== '') {
      const clientUnitPrice = Number(item.unitPrice);
      if (!Number.isFinite(clientUnitPrice) || clientUnitPrice < 0) {
        throw new OrderInputError(400, 'سعر الصنف غير صالح');
      }
      if (Math.abs(clientUnitPrice - catalogUnitPrice) > 0.01) {
        if (!['ADMIN', 'MANAGER'].includes(userRole)) {
          throw new OrderInputError(403, 'لا تملك صلاحية تعديل سعر الصنف');
        }
        unitPrice = clientUnitPrice;
        priceOverrideAudit = {
          productId: prodId,
          nameAr: dbProd.nameAr,
          oldPrice: catalogUnitPrice,
          newPrice: clientUnitPrice,
          reason: item.priceOverrideReason ? String(item.priceOverrideReason) : null,
        };
      }
    }

    validated.push({
      productId: prodId,
      nameAr: dbProd.nameAr || item.nameAr || 'منتج',
      nameFr: dbProd.nameFr ?? item.nameFr ?? null,
      unitPrice,
      catalogUnitPrice,
      costPrice: Number(dbProd.costPrice || 0),
      quantity: qty,
      total: Math.round(unitPrice * qty * 100) / 100,
      notes: item.notes || null,
      station: dbProd.station || item.station || 'MAIN_KITCHEN',
      variantsJson: normalizedVariant ? JSON.stringify(normalizedVariant) : null,
      addonsJson: normalizedAddons.length > 0 ? JSON.stringify(normalizedAddons) : null,
      priceOverrideAudit,
    });
  }

  return validated;
}

function applyOrderInventoryDeltasInTx(
  tx: any,
  params: {
    orderId: number;
    deltasByProductId: Map<number, number>;
    userId: number;
    deductNotePrefix?: string;
    restoreNotePrefix?: string;
    initialDeductionOnly?: boolean;
  }
) {
  const { orderId, deltasByProductId, userId, deductNotePrefix, restoreNotePrefix, initialDeductionOnly } = params;
  const nowIso = new Date().toISOString();

  if (initialDeductionOnly) {
    const existingInitial = tx
      .select({ id: inventoryMovements.id })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.referenceType, 'ORDER'),
          eq(inventoryMovements.referenceId, orderId),
          eq(inventoryMovements.type, 'SALE_DEDUCTION')
        )
      )
      .limit(1)
      .all();
    if (existingInitial.length > 0) {
      return;
    }
  }

  for (const [prodId, qtyDelta] of deltasByProductId.entries()) {
    if (!qtyDelta || Math.abs(qtyDelta) < 0.000001) continue;
    const recipes = tx.select().from(productRecipes).where(eq(productRecipes.productId, prodId)).all();
    for (const r of recipes) {
      const recipeQty = Number(r.quantity || 0);
      if (recipeQty <= 0) continue;
      // Positive qtyDelta -> deduct (-), Negative qtyDelta -> restore (+)
      const stockChange = -recipeQty * qtyDelta;
      tx.update(ingredients)
        .set({
          currentStock: sql`${ingredients.currentStock} + ${stockChange}`,
          updatedAt: nowIso,
        })
        .where(eq(ingredients.id, r.ingredientId))
        .run();

      tx.insert(inventoryMovements).values({
        ingredientId: r.ingredientId,
        type: qtyDelta > 0 ? 'SALE_DEDUCTION' : 'ORDER_ADJUSTMENT_RESTORE',
        quantity: String(stockChange),
        referenceType: 'ORDER',
        referenceId: orderId,
        performedBy: userId,
        notes:
          qtyDelta > 0
            ? `${deductNotePrefix || 'خصم تلقائي للوصفة عند طلب'} (المنتج ${prodId})`
            : `${restoreNotePrefix || 'إعادة مخزون نتيجة تعديل الطلب'} (المنتج ${prodId})`,
      }).run();
    }
  }
}

function restoreRemainingOrderInventoryInTx(
  tx: any,
  params: {
    orderId: number;
    restoreType: 'CANCEL_RESTORE' | 'REFUND_RESTORE';
    userId: number;
    notes: string;
  }
) {
  const { orderId, restoreType, userId, notes } = params;
  const grouped = tx
    .select({
      ingredientId: inventoryMovements.ingredientId,
      netQty: sql<number>`COALESCE(SUM(CAST(${inventoryMovements.quantity} AS REAL)), 0)`,
    })
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.referenceType, 'ORDER'), eq(inventoryMovements.referenceId, orderId)))
    .groupBy(inventoryMovements.ingredientId)
    .all();

  const nowIso = new Date().toISOString();
  for (const row of grouped) {
    const net = Number(row.netQty || 0);
    if (net < -0.00001) {
      const restoreQty = Math.round(-net * 1000000) / 1000000;
      tx.update(ingredients)
        .set({
          currentStock: sql`${ingredients.currentStock} + ${restoreQty}`,
          updatedAt: nowIso,
        })
        .where(eq(ingredients.id, row.ingredientId))
        .run();

      tx.insert(inventoryMovements).values({
        ingredientId: row.ingredientId,
        type: restoreType,
        quantity: String(restoreQty),
        referenceType: 'ORDER',
        referenceId: orderId,
        performedBy: userId,
        notes,
      }).run();
    }
  }
}

// Get Orders with filters
apiRouter.get('/orders', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN']), async (req, res) => {
  try {
    const { status, type, limit, heldOnly } = req.query;

    const whereConditions: any[] = [];
    if (heldOnly === 'true') {
      whereConditions.push(eq(orders.isHeld, true));
    }
    if (status && typeof status === 'string') {
      whereConditions.push(eq(orders.status, status));
    }
    if (type && typeof type === 'string') {
      whereConditions.push(eq(orders.type, type));
    }

    const baseSelect = db
      .select({
        order: orders,
        table: restaurantTables,
        customer: customers,
        cashier: users,
      })
      .from(orders)
      .leftJoin(restaurantTables, eq(orders.tableId, restaurantTables.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(users, eq(orders.cashierId, users.id));

    const filteredQuery = whereConditions.length > 0 ? baseSelect.where(and(...whereConditions)) : baseSelect;
    const orderList = await filteredQuery
      .orderBy(heldOnly === 'true' ? desc(orders.heldAt) : desc(orders.id))
      .limit(Number(limit) || 100);

    const orderIds = orderList.map((o) => o.order.id);
    let allItems: any[] = [];
    let allPayments: any[] = [];
    if (orderIds.length > 0) {
      allItems = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
      allPayments = await db.select().from(payments).where(inArray(payments.orderId, orderIds));
    }

    const results = orderList.map((row) => ({
      ...row.order,
      tableNumber: row.table?.tableNumber ?? null,
      zone: row.table?.zone ?? null,
      customerName: row.customer?.name ?? null,
      customerPhone: row.customer?.phone ?? null,
      cashierName: row.cashier?.fullName ?? null,
      items: allItems.filter((item) => item.orderId === row.order.id),
      payments: allPayments.filter((p) => p.orderId === row.order.id),
    }));

    res.json(results);
  } catch (error: any) {
    console.error('Get orders error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل تحميل الطلبات' });
  }
});

// Get Single Order Details (with joined table, customer, cashier for accurate reprint)
apiRouter.get('/orders/:id', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN']), async (req, res) => {
  try {
    const orderId = parsePositiveInt(req.params.id);
    if (orderId === null) return res.status(400).json({ error: 'معرف الطلب غير صالح' });
    const orderResult = await db
      .select({
        order: orders,
        table: restaurantTables,
        customer: customers,
        cashier: users,
      })
      .from(orders)
      .leftJoin(restaurantTables, eq(orders.tableId, restaurantTables.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(users, eq(orders.cashierId, users.id))
      .where(eq(orders.id, orderId));

    if (orderResult.length === 0) return res.status(404).json({ error: 'الطلب غير موجود' });

    const row = orderResult[0];
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const paymentRecords = await db.select().from(payments).where(eq(payments.orderId, orderId));

    res.json({
      ...row.order,
      tableNumber: row.table?.tableNumber ?? null,
      table: row.table ? { id: row.table.id, tableNumber: row.table.tableNumber, zone: row.table.zone } : null,
      customerName: row.customer?.name ?? null,
      customerPhone: row.customer?.phone ?? null,
      customer: row.customer ? { id: row.customer.id, name: row.customer.name, phone: row.customer.phone } : null,
      cashierName: row.cashier?.fullName ?? null,
      cashier: row.cashier ? { id: row.cashier.id, fullName: row.cashier.fullName } : null,
      items,
      payments: paymentRecords,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل تفاصيل الطلب' });
  }
});

// Create Order (Database Transaction + Server-Side Pricing + Tax Persistence + Recipe Stock Deduction + Delivery)
apiRouter.post('/orders', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (req: AuthRequest, res) => {
  try {
    const {
      type = 'DINE_IN', // DINE_IN, TAKEAWAY, DELIVERY
      tableId,
      customerId,
      items,
      discount = 0,
      discountType,
      discountValue,
      discountReason,
      deliveryFee = 0,
      notes,
      isHeld = false,
      sendToKitchen = false,
      idempotencyKey,
      offlineId,
    } = req.body;

    const allowedOrderTypes = new Set(['DINE_IN', 'TAKEAWAY', 'DELIVERY']);
    if (!allowedOrderTypes.has(String(type))) {
      return res.status(400).json({ error: 'نوع الطلب غير صالح' });
    }
    if (tableId !== undefined && tableId !== null && String(tableId).trim() !== '' && parsePositiveInt(tableId) === null) {
      return res.status(400).json({ error: 'معرف الطاولة غير صالح' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'الطلب يجب أن يحتوي على منتج واحد على الأقل' });
    }

    const rawDiscount = Number(discount);
    const rawDiscountVal =
      discountValue !== undefined && discountValue !== null && discountValue !== ''
        ? Number(discountValue)
        : rawDiscount;
    const normalizedDiscountType =
      discountType === 'PERCENT' || discountType === 'FIXED'
        ? discountType
        : rawDiscount > 0
        ? 'FIXED'
        : null;
    const rawFee = Number(deliveryFee);
    if (
      !Number.isFinite(rawDiscount) ||
      rawDiscount < 0 ||
      !Number.isFinite(rawDiscountVal) ||
      rawDiscountVal < 0 ||
      !Number.isFinite(rawFee) ||
      rawFee < 0
    ) {
      return res.status(400).json({ error: 'قيمة الخصم أو رسوم التوصيل غير صالحة' });
    }
    if (normalizedDiscountType === 'PERCENT' && rawDiscountVal > 100) {
      return res.status(400).json({ error: 'نسبة الخصم يجب أن تكون بين 0% و 100%' });
    }

    const hasRequestedDiscount = rawDiscount > 0 || (normalizedDiscountType === 'PERCENT' && rawDiscountVal > 0);
    if (hasRequestedDiscount) {
      const restrictCashierRow = sqlite
        .prepare("SELECT value FROM restaurant_settings WHERE key = 'restrict_cashier_discount'")
        .get() as { value: string } | undefined;
      const cashierAllowed = restrictCashierRow?.value !== 'true';
      const allowedDiscountRoles = cashierAllowed
        ? ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']
        : ['OWNER', 'ADMIN', 'MANAGER'];
      if (!allowedDiscountRoles.includes(req.user!.role)) {
        return res.status(403).json({ error: 'لا تملك صلاحية تطبيق الخصم على الفاتورة' });
      }
    }
    const feeAmount = rawFee;

    const txOutcome = db.transaction((tx):
      | { kind: 'deduplicated'; order: any }
      | { kind: 'error'; status: number; body: any }
      | { kind: 'created'; order: any; priceOverrides: any[] } => {
      if (offlineId) {
        const existingByOffline = tx.select().from(orders).where(eq(orders.offlineId, offlineId)).all();
        if (existingByOffline.length > 0) {
          const existingItems = tx.select().from(orderItems).where(eq(orderItems.orderId, existingByOffline[0].id)).all();
          return { kind: 'deduplicated', order: { ...existingByOffline[0], items: existingItems } };
        }
      }

      if (idempotencyKey) {
        const existingByKey = tx.select().from(orders).where(eq(orders.idempotencyKey, idempotencyKey)).all();
        if (existingByKey.length > 0) {
          const existingItems = tx.select().from(orderItems).where(eq(orderItems.orderId, existingByKey[0].id)).all();
          return { kind: 'deduplicated', order: { ...existingByKey[0], items: existingItems } };
        }
      }

      const validatedItems = validateAndPriceOrderItemsInTx(tx, items, req.user!.role);

      // Validate customerId if positive
      let validCustomerId: number | null = null;
      let customerRow: any = null;
      if (customerId !== undefined && customerId !== null && Number(customerId) > 0) {
        const custRows = tx.select().from(customers).where(eq(customers.id, Number(customerId))).all();
        if (custRows.length === 0) {
          return { kind: 'error', status: 400, body: { error: 'الزبون المحدد غير موجود' } };
        }
        validCustomerId = custRows[0].id;
        customerRow = custRows[0];
      }

      if (type === 'DINE_IN' && tableId && !isHeld) {
        const tbl = tx.select().from(restaurantTables).where(eq(restaurantTables.id, Number(tableId))).all();
        if (tbl.length === 0) {
          return { kind: 'error', status: 404, body: { error: 'الطاولة المحددة غير موجودة' } };
        }
        if (tbl[0].status === 'INACTIVE') {
          return { kind: 'error', status: 400, body: { error: 'الطاولة غير نشطة حالياً' } };
        }
        if (tbl[0].currentOrderId) {
          const existingOrd = tx.select().from(orders).where(eq(orders.id, tbl[0].currentOrderId)).all();
          if (
            existingOrd.length > 0 &&
            !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(existingOrd[0].status) &&
            existingOrd[0].paymentStatus !== 'PAID'
          ) {
            return {
              kind: 'error',
              status: 409,
              body: {
                error: 'الطاولة مشغولة بطلب نشط بالفعل، يرجى فتح الطلب الحالي أو نقل الطلب أولاً',
                existingOrderId: existingOrd[0].id,
                existingOrderNumber: existingOrd[0].orderNumber,
              },
            };
          }
        }
      }

      const taxSetting = tx.select().from(restaurantSettings).where(eq(restaurantSettings.key, 'tax_rate')).all();
      const taxRate = Math.max(0, Number(taxSetting[0]?.value || 0)) || 0;

      const subtotal = validatedItems.reduce((sum, it) => sum + it.total, 0);
      const computedDiscountAmount =
        normalizedDiscountType === 'PERCENT'
          ? Math.round((subtotal * rawDiscountVal) / 100)
          : rawDiscount;
      if (computedDiscountAmount > subtotal) {
        return {
          kind: 'error',
          status: 400,
          body: { error: 'قيمة الخصم لا يمكن أن تتجاوز المجموع الفرعي للطلب' },
        };
      }
      const discountAmount = Math.max(0, computedDiscountAmount);
      const taxable = Math.max(0, subtotal - discountAmount);
      const taxAmount = Math.round(((taxable * taxRate) / 100) * 100) / 100;
      const total = Math.max(0, taxable + taxAmount + feeAmount);

      const seqRow = tx
        .select({
          maxSeq: sql<number>`COALESCE(MAX(${orders.dailySequence}), 0)`,
          maxId: sql<number>`COALESCE(MAX(${orders.id}), 0)`,
        })
        .from(orders)
        .get();
      let dailySeq = Math.max(Number(seqRow?.maxSeq || 0), Number(seqRow?.maxId || 0)) + 1;
      let orderNumber = `BON-${String(dailySeq).padStart(4, '0')}`;
      while (tx.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, orderNumber)).all().length > 0) {
        dailySeq += 1;
        orderNumber = `BON-${String(dailySeq).padStart(4, '0')}`;
      }

      const currentShift = tx
        .select()
        .from(cashShifts)
        .where(eq(cashShifts.status, 'OPEN'))
        .orderBy(desc(cashShifts.id))
        .limit(1)
        .all();
      const shiftId = currentShift[0]?.id || null;
      const discountAuthTime = discountAmount > 0 ? new Date().toISOString() : null;

      const orderInserts = tx.insert(orders).values({
        orderNumber,
        dailySequence: dailySeq,
        type: type || 'DINE_IN',
        tableId: tableId ? Number(tableId) : null,
        customerId: validCustomerId,
        status: isHeld ? 'NEW' : sendToKitchen ? 'PREPARING' : 'CONFIRMED',
        subtotal: String(subtotal),
        discount: String(discountAmount),
        discountType: discountAmount > 0 ? normalizedDiscountType : null,
        discountValue: discountAmount > 0 ? String(rawDiscountVal) : '0',
        discountReason: discountAmount > 0 && discountReason ? String(discountReason).trim() : null,
        discountAuthorizedBy: discountAmount > 0 ? req.user!.id : null,
        discountAuthorizedAt: discountAuthTime,
        deliveryFee: String(feeAmount),
        taxRate: String(taxRate),
        taxAmount: String(taxAmount),
        total: String(total),
        paidAmount: '0',
        paymentStatus: 'UNPAID',
        cashierId: req.user!.id,
        notes: notes || null,
        isHeld: Boolean(isHeld),
        heldAt: isHeld ? new Date().toISOString() : null,
        idempotencyKey: idempotencyKey || null,
        offlineId: offlineId || null,
        shiftId,
      }).returning().all();

      const newOrder = orderInserts[0];
      const insertedItems: any[] = [];
      const deltasByProductId = new Map<number, number>();
      const priceOverrides: any[] = [];

      for (const item of validatedItems) {
        const itemRow = tx.insert(orderItems).values({
          orderId: newOrder.id,
          productId: item.productId,
          nameAr: item.nameAr,
          nameFr: item.nameFr,
          unitPrice: String(item.unitPrice),
          costPrice: String(item.costPrice),
          quantity: item.quantity,
          total: String(item.total),
          notes: item.notes,
          station: item.station,
          status: sendToKitchen ? 'PREPARING' : 'NEW',
          variantsJson: item.variantsJson,
          addonsJson: item.addonsJson,
        }).returning().all();
        if (itemRow[0]) insertedItems.push(itemRow[0]);

        if (!isHeld) {
          deltasByProductId.set(
            item.productId,
            (deltasByProductId.get(item.productId) || 0) + item.quantity
          );
        }

        if (item.priceOverrideAudit) {
          priceOverrides.push(item.priceOverrideAudit);
          tx.insert(auditLogs).values({
            userId: req.user!.id,
            userName: req.user!.fullName,
            action: 'ORDER_ITEM_PRICE_OVERRIDE',
            entityType: 'ORDER',
            entityId: String(newOrder.id),
            details: `تعديل سعر الصنف ${item.priceOverrideAudit.nameAr} من ${item.priceOverrideAudit.oldPrice} DA إلى ${item.priceOverrideAudit.newPrice} DA${item.priceOverrideAudit.reason ? ` (${item.priceOverrideAudit.reason})` : ''}`,
          }).run();
        }
      }

      if (!isHeld && deltasByProductId.size > 0) {
        applyOrderInventoryDeltasInTx(tx, {
          orderId: newOrder.id,
          deltasByProductId,
          userId: req.user!.id,
          deductNotePrefix: 'خصم تلقائي للوصفة عند إنشاء الطلب',
          initialDeductionOnly: true,
        });
      }

      if (type === 'DINE_IN' && tableId && !isHeld) {
        tx.update(restaurantTables).set({
          status: 'OCCUPIED',
          currentOrderId: newOrder.id,
        }).where(eq(restaurantTables.id, Number(tableId))).run();
      }

      if (type === 'DELIVERY') {
        const resolvedAddress =
          (typeof req.body.deliveryAddress === 'string' && req.body.deliveryAddress.trim()) ||
          customerRow?.address ||
          'توصيل - غير محدد';
        tx.insert(deliveries).values({
          orderId: newOrder.id,
          customerId: validCustomerId,
          driverName: req.body.driverName || null,
          customerAddress: resolvedAddress,
          deliveryAddress: resolvedAddress,
          deliveryFee: String(feeAmount),
          status: 'NEW',
          notes: req.body.deliveryNotes || notes || null,
        }).run();
      }

      return { kind: 'created', order: { ...newOrder, items: insertedItems }, priceOverrides };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json(txOutcome.body);
    }

    if (txOutcome.kind === 'deduplicated') {
      return res.json({ ...txOutcome.order, deduplicated: true });
    }

    const createdOrder = txOutcome.order;

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: isHeld ? 'HOLD_ORDER' : 'CREATE_ORDER',
      entityType: 'ORDER',
      entityId: String(createdOrder.id),
      details: `إنشاء فاتورة جديدة ${createdOrder.orderNumber} بمبلغ ${createdOrder.total} DA (${type})`,
      newValue: JSON.stringify({ orderNumber: createdOrder.orderNumber, subtotal: createdOrder.subtotal, discount: createdOrder.discount, total: createdOrder.total }),
      ipAddress: req.ip,
    });

    if (Number(createdOrder.discount || 0) > 0) {
      await logAudit({
        userId: req.user!.id,
        userName: req.user!.fullName,
        action: 'APPLY_DISCOUNT',
        entityType: 'ORDER',
        entityId: String(createdOrder.id),
        details: `تطبيق خصم بقيمة ${createdOrder.discount} DA (${createdOrder.discountType || 'FIXED'}: ${createdOrder.discountValue || createdOrder.discount}) على الفاتورة ${createdOrder.orderNumber}${createdOrder.discountReason ? ` — السبب: ${createdOrder.discountReason}` : ''}`,
        previousValue: String(createdOrder.subtotal),
        newValue: String(createdOrder.total),
        ipAddress: req.ip,
      });
    }

    res.status(201).json(createdOrder);
  } catch (error: any) {
    if (error instanceof OrderInputError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Create order error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل تسجيل الطلب في قاعدة البيانات' });
  }
});

// Add / Update items on an existing open unpaid order (atomic delta stock adjustments + server-side price validation)
apiRouter.post('/orders/:id/items', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (req: AuthRequest, res) => {
  try {
    const orderId = parsePositiveInt(req.params.id);
    if (orderId === null) {
      return res.status(400).json({ error: 'معرف الطلب غير صالح' });
    }
    const { items, replaceAll = false, discount, deliveryFee, notes, sendToKitchen = false } = req.body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'يجب تحديد صنف واحد على الأقل' });
    }

    if (discount !== undefined && (!Number.isFinite(Number(discount)) || Number(discount) < 0)) {
      return res.status(400).json({ error: 'قيمة الخصم غير صالحة' });
    }
    if (deliveryFee !== undefined && (!Number.isFinite(Number(deliveryFee)) || Number(deliveryFee) < 0)) {
      return res.status(400).json({ error: 'قيمة رسوم التوصيل غير صالحة' });
    }

    const txOutcome = db.transaction((tx):
      | { kind: 'error'; status: number; error: string }
      | { kind: 'updated'; order: any } => {
      const existing = tx.select().from(orders).where(eq(orders.id, orderId)).all();
      if (existing.length === 0) {
        return { kind: 'error', status: 404, error: 'الطلب غير موجود' };
      }

      const ord = existing[0];
      if (
        ord.paymentStatus === 'PAID' ||
        ord.status === 'COMPLETED' ||
        ord.status === 'CANCELLED' ||
        ord.status === 'REFUNDED'
      ) {
        return { kind: 'error', status: 400, error: 'لا يمكن تعديل الفواتير المدفوعة أو المغلقة' };
      }

      const discountAmount = discount !== undefined ? Math.max(0, Number(discount)) : Number(ord.discount || 0);
      if (discount !== undefined && discountAmount !== Number(ord.discount || 0)) {
        const restrictCashierRow = tx
          .select({ value: restaurantSettings.value })
          .from(restaurantSettings)
          .where(eq(restaurantSettings.key, 'restrict_cashier_discount'))
          .all()[0];
        const cashierAllowed = restrictCashierRow?.value !== 'true';
        const allowedDiscountRoles = cashierAllowed
          ? ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']
          : ['OWNER', 'ADMIN', 'MANAGER'];
        if (!allowedDiscountRoles.includes(req.user!.role)) {
          return { kind: 'error', status: 403, error: 'لا تملك صلاحية تعديل الخصم' };
        }
      }

      const validatedItems = validateAndPriceOrderItemsInTx(tx, items, req.user!.role);

      const prevItems = tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();
      const prevMoves = tx
        .select({ id: inventoryMovements.id })
        .from(inventoryMovements)
        .where(and(eq(inventoryMovements.referenceType, 'ORDER'), eq(inventoryMovements.referenceId, orderId)))
        .all();

      // Determine what was previously deducted for this order:
      // If it was held AND has no prior inventory movements, previously deducted = 0.
      const wasHeldWithoutDeduction = Boolean(ord.isHeld) && prevMoves.length === 0;
      const prevDeductedQtyByProduct = new Map<number, number>();
      if (!wasHeldWithoutDeduction) {
        for (const p of prevItems) {
          prevDeductedQtyByProduct.set(
            p.productId,
            (prevDeductedQtyByProduct.get(p.productId) || 0) + Number(p.quantity || 0)
          );
        }
      }

      if (replaceAll) {
        tx.delete(orderItems).where(eq(orderItems.orderId, orderId)).run();
      }

      const addedQtyByProduct = new Map<number, number>();
      for (const item of validatedItems) {
        tx.insert(orderItems).values({
          orderId,
          productId: item.productId,
          nameAr: item.nameAr,
          nameFr: item.nameFr,
          unitPrice: String(item.unitPrice),
          costPrice: String(item.costPrice),
          quantity: item.quantity,
          total: String(item.total),
          notes: item.notes,
          station: item.station,
          status: sendToKitchen ? 'PREPARING' : 'NEW',
          variantsJson: item.variantsJson,
          addonsJson: item.addonsJson,
        }).run();

        addedQtyByProduct.set(
          item.productId,
          (addedQtyByProduct.get(item.productId) || 0) + item.quantity
        );

        if (item.priceOverrideAudit) {
          tx.insert(auditLogs).values({
            userId: req.user!.id,
            userName: req.user!.fullName,
            action: 'ORDER_ITEM_PRICE_OVERRIDE',
            entityType: 'ORDER',
            entityId: String(orderId),
            details: `تعديل سعر الصنف ${item.priceOverrideAudit.nameAr} من ${item.priceOverrideAudit.oldPrice} DA إلى ${item.priceOverrideAudit.newPrice} DA${item.priceOverrideAudit.reason ? ` (${item.priceOverrideAudit.reason})` : ''}`,
          }).run();
        }
      }

      // Compute exact net stock deltas for all affected products
      const deltasByProductId = new Map<number, number>();
      if (replaceAll) {
        const allProductIds = new Set<number>([
          ...prevDeductedQtyByProduct.keys(),
          ...addedQtyByProduct.keys(),
        ]);
        for (const pid of allProductIds) {
          const prevQty = prevDeductedQtyByProduct.get(pid) || 0;
          const nextQty = addedQtyByProduct.get(pid) || 0;
          const delta = nextQty - prevQty;
          if (delta !== 0) {
            deltasByProductId.set(pid, delta);
          }
        }
      } else {
        // Appending new items (plus deducting previously held items if transitioning from held -> active)
        if (wasHeldWithoutDeduction) {
          for (const prevIt of prevItems) {
            deltasByProductId.set(
              prevIt.productId,
              (deltasByProductId.get(prevIt.productId) || 0) + Number(prevIt.quantity || 0)
            );
          }
        }
        for (const [pid, qty] of addedQtyByProduct.entries()) {
          deltasByProductId.set(pid, (deltasByProductId.get(pid) || 0) + qty);
        }
      }

      if (deltasByProductId.size > 0) {
        applyOrderInventoryDeltasInTx(tx, {
          orderId,
          deltasByProductId,
          userId: req.user!.id,
          deductNotePrefix: 'خصم مخزون عند إضافة/تعديل أصناف الطلب',
          restoreNotePrefix: 'إعادة مخزون عند إنقاص/إزالة أصناف الطلب',
        });
      }

      const taxSetting = tx.select().from(restaurantSettings).where(eq(restaurantSettings.key, 'tax_rate')).all();
      const taxRate = Math.max(0, Number(taxSetting[0]?.value || ord.taxRate || 0)) || 0;

      const allItems = tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();
      const newSubtotal = allItems.reduce((sum, it) => sum + Number(it.total), 0);
      if (discountAmount > newSubtotal) {
        throw new OrderInputError(400, 'قيمة الخصم لا يمكن أن تتجاوز المجموع الفرعي للطلب');
      }
      const feeAmount = deliveryFee !== undefined ? Math.max(0, Number(deliveryFee)) : Number(ord.deliveryFee || 0);
      const taxable = Math.max(0, newSubtotal - discountAmount);
      const taxAmount = Math.round(((taxable * taxRate) / 100) * 100) / 100;
      const newTotal = Math.max(0, taxable + taxAmount + feeAmount);

      const existingPaid = Number(ord.paidAmount || 0);
      if (existingPaid > 0 && newTotal < existingPaid - 0.01) {
        throw new OrderInputError(
          400,
          'لا يمكن تخفيض إجمالي الفاتورة لأقل من المبلغ المدفوع مسبقاً؛ يرجى استخدام الاسترداد (Refund)'
        );
      }

      const nextStatus = sendToKitchen ? 'PREPARING' : ord.status === 'READY' || ord.status === 'NEW' ? 'CONFIRMED' : ord.status;

      const updated = tx.update(orders).set({
        subtotal: String(newSubtotal),
        discount: String(discountAmount),
        deliveryFee: String(feeAmount),
        taxRate: String(taxRate),
        taxAmount: String(taxAmount),
        total: String(newTotal),
        notes: notes !== undefined ? notes : ord.notes,
        status: nextStatus,
        isHeld: false,
        heldAt: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(orders.id, orderId)).returning().all();

      if (ord.tableId && ord.paymentStatus === 'UNPAID') {
        tx.update(restaurantTables).set({
          status: 'OCCUPIED',
          currentOrderId: ord.id,
        }).where(eq(restaurantTables.id, ord.tableId)).run();
      }

      return { kind: 'updated', order: { ...updated[0], items: allItems } };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }

    res.json(txOutcome.order);
  } catch (error: any) {
    if (error instanceof OrderInputError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Update order items error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل تحديث أصناف الطلب' });
  }
});

// Resume Held Order (inside db.transaction with recipe stock deduction & full hydrated order return)
apiRouter.post('/orders/:id/resume', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (req: AuthRequest, res) => {
  try {
    const orderId = parsePositiveInt(req.params.id);
    if (orderId === null) {
      return res.status(400).json({ error: 'معرف الطلب غير صالح' });
    }

    const txOutcome = db.transaction((tx):
      | { kind: 'error'; status: number; error: string }
      | { kind: 'resumed'; order: any } => {
      const ordRows = tx.select().from(orders).where(eq(orders.id, orderId)).all();
      if (ordRows.length === 0) {
        return { kind: 'error', status: 404, error: 'الطلب غير موجود' };
      }

      const ord = ordRows[0];
      if (['CANCELLED', 'REFUNDED'].includes(ord.status)) {
        return { kind: 'error', status: 400, error: 'لا يمكن استئناف طلب ملغى أو مسترجع' };
      }

      const items = tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();

      // Deduct recipe stock ONLY if the order was held and has not had inventory deducted yet
      if (ord.isHeld) {
        const existingMoves = tx
          .select({ id: inventoryMovements.id })
          .from(inventoryMovements)
          .where(and(eq(inventoryMovements.referenceType, 'ORDER'), eq(inventoryMovements.referenceId, orderId)))
          .all();

        if (existingMoves.length === 0 && items.length > 0) {
          const deltasByProductId = new Map<number, number>();
          for (const it of items) {
            deltasByProductId.set(
              it.productId,
              (deltasByProductId.get(it.productId) || 0) + Number(it.quantity || 0)
            );
          }
          applyOrderInventoryDeltasInTx(tx, {
            orderId,
            deltasByProductId,
            userId: req.user!.id,
            deductNotePrefix: 'خصم تلقائي عند استئناف طلب معلق',
          });
        }
      }

      const updated = tx.update(orders).set({
        isHeld: false,
        heldAt: null,
        status: ord.status === 'NEW' ? 'CONFIRMED' : ord.status,
        updatedAt: new Date().toISOString(),
      }).where(eq(orders.id, orderId)).returning().all();

      if (ord.type === 'DINE_IN' && ord.tableId) {
        const tbl = tx.select().from(restaurantTables).where(eq(restaurantTables.id, ord.tableId)).all();
        if (tbl.length > 0 && (!tbl[0].currentOrderId || tbl[0].currentOrderId === orderId)) {
          tx.update(restaurantTables).set({
            status: 'OCCUPIED',
            currentOrderId: orderId,
          }).where(eq(restaurantTables.id, ord.tableId)).run();
        }
      }

      const tableRow = ord.tableId
        ? tx.select().from(restaurantTables).where(eq(restaurantTables.id, ord.tableId)).all()[0]
        : null;
      const customerRow = ord.customerId
        ? tx.select().from(customers).where(eq(customers.id, ord.customerId)).all()[0]
        : null;

      return {
        kind: 'resumed',
        order: {
          ...updated[0],
          tableNumber: tableRow?.tableNumber ?? null,
          zone: tableRow?.zone ?? null,
          customerName: customerRow?.name ?? null,
          customerPhone: customerRow?.phone ?? null,
          items,
        },
      };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }

    res.json(txOutcome.order);
  } catch (error: any) {
    console.error('Resume order error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل استئناف الطلب المعلق' });
  }
});

// Cancel Order (atomic inventory restoration, blocks duplicate cancel & paid/refunded orders)
apiRouter.post('/orders/:id/cancel', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER']), async (req: AuthRequest, res) => {
  try {
    const orderId = parsePositiveInt(req.params.id);
    if (orderId === null) {
      return res.status(400).json({ error: 'معرف الطلب غير صالح' });
    }
    const { reason } = req.body || {};

    const txOutcome = db.transaction((tx):
      | { kind: 'error'; status: number; error: string }
      | { kind: 'cancelled'; orderNumber: string } => {
      const ord = tx.select().from(orders).where(eq(orders.id, orderId)).all();
      if (ord.length === 0) {
        return { kind: 'error', status: 404, error: 'الطلب غير موجود' };
      }

      const currentOrder = ord[0];
      if (currentOrder.status === 'CANCELLED') {
        return { kind: 'error', status: 400, error: 'تم إلغاء هذا الطلب مسبقاً' };
      }
      if (
        currentOrder.paymentStatus === 'PAID' ||
        currentOrder.paymentStatus === 'PARTIALLY_PAID' ||
        currentOrder.status === 'REFUNDED'
      ) {
        return {
          kind: 'error',
          status: 400,
          error: 'لا يمكن تعديل أو إلغاء فاتورة مدفوعة، يرجى استخدام نظام الاسترداد (Refund)',
        };
      }

      restoreRemainingOrderInventoryInTx(tx, {
        orderId,
        restoreType: 'CANCEL_RESTORE',
        userId: req.user!.id,
        notes: `إعادة مخزون تلقائية عند إلغاء الطلب ${currentOrder.orderNumber}${reason ? `: ${reason}` : ''}`,
      });

      tx.update(orders).set({
        status: 'CANCELLED',
        isHeld: false,
        notes: reason ? `ملغى: ${reason}` : 'ملغى',
        updatedAt: new Date().toISOString(),
      }).where(eq(orders.id, orderId)).run();

      if (currentOrder.tableId) {
        tx.update(restaurantTables).set({
          status: 'AVAILABLE',
          currentOrderId: null,
        }).where(and(eq(restaurantTables.id, currentOrder.tableId), eq(restaurantTables.currentOrderId, orderId))).run();
      }

      return { kind: 'cancelled', orderNumber: currentOrder.orderNumber };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'CANCEL_ORDER',
      entityType: 'ORDER',
      entityId: String(orderId),
      details: `إلغاء الطلب ${txOutcome.orderNumber}: ${reason || 'بدون سبب'}`,
    });

    res.json({ success: true, message: 'تم إلغاء الطلب وإعادة المخزون بنجاح' });
  } catch (error: any) {
    console.error('Cancel order error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل إلغاء الطلب' });
  }
});

// Refund Paid Order (atomic inventory restoration, preserves historical order_items intact, prevents double refund)
apiRouter.post('/orders/:id/refund', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const orderId = parsePositiveInt(req.params.id);
    if (orderId === null) {
      return res.status(400).json({ error: 'معرف الطلب غير صالح' });
    }
    const { reason } = req.body || {};

    const txOutcome = db.transaction((tx):
      | { kind: 'error'; status: number; error: string }
      | { kind: 'refunded'; order: any; refundAmount: number } => {
      const ord = tx.select().from(orders).where(eq(orders.id, orderId)).all();
      if (ord.length === 0) {
        return { kind: 'error', status: 404, error: 'الطلب غير موجود' };
      }

      const order = ord[0];
      if (order.status === 'REFUNDED' || order.paymentStatus === 'REFUNDED') {
        return { kind: 'error', status: 400, error: 'تم استرداد هذه الفاتورة مسبقاً' };
      }
      if (order.paymentStatus !== 'PAID' && order.paymentStatus !== 'PARTIALLY_PAID') {
        return { kind: 'error', status: 400, error: 'لا يمكن استرداد طلب غير مدفوع' };
      }

      const refundAmount = Number(order.paidAmount) > 0 ? Number(order.paidAmount) : Number(order.total);

      const openShift = tx
        .select()
        .from(cashShifts)
        .where(eq(cashShifts.status, 'OPEN'))
        .orderBy(desc(cashShifts.id))
        .limit(1)
        .all();
      const activeOpenShiftId = openShift[0]?.id || null;
      const shiftId = activeOpenShiftId || order.shiftId || null;

      const orderPayments = tx.select().from(payments).where(eq(payments.orderId, orderId)).all();
      const cashPaidTotal = orderPayments
        .filter((p) => p.method === 'CASH' && Number(p.amount) > 0)
        .reduce((s, p) => s + Number(p.amount), 0);

      restoreRemainingOrderInventoryInTx(tx, {
        orderId: order.id,
        restoreType: 'REFUND_RESTORE',
        userId: req.user!.id,
        notes: `إعادة مخزون تلقائية عند استرداد الفاتورة ${order.orderNumber}${reason ? `: ${reason}` : ''}`,
      });

      tx.insert(payments).values({
        orderId: order.id,
        method: 'REFUND',
        amount: String(-refundAmount),
        tenderAmount: '0',
        changeAmount: '0',
        transactionRef: reason || 'استرداد فاتورة',
        cashierId: req.user!.id,
        shiftId,
        idempotencyKey: `refund-${order.id}`,
      }).run();

      const updated = tx.update(orders).set({
        status: 'REFUNDED',
        paymentStatus: 'REFUNDED',
        notes: reason ? `${order.notes ? order.notes + ' | ' : ''}استرداد: ${reason}` : order.notes,
        updatedAt: new Date().toISOString(),
      }).where(eq(orders.id, orderId)).returning().all();

      // Never mutate a CLOSED shift; only deduct totalCashOut from an actively OPEN shift
      if (activeOpenShiftId && cashPaidTotal > 0) {
        tx.update(cashShifts).set({
          totalCashOut: sql`${cashShifts.totalCashOut} + ${Math.min(refundAmount, cashPaidTotal)}`,
        }).where(eq(cashShifts.id, activeOpenShiftId)).run();
      }

      if (order.tableId) {
        tx.update(restaurantTables).set({
          status: 'AVAILABLE',
          currentOrderId: null,
        }).where(and(eq(restaurantTables.id, order.tableId), eq(restaurantTables.currentOrderId, order.id))).run();
      }

      return { kind: 'refunded', order: updated[0], refundAmount };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'REFUND_ORDER',
      entityType: 'ORDER',
      entityId: String(orderId),
      details: `استرداد الفاتورة ${txOutcome.order.orderNumber} بمبلغ ${txOutcome.refundAmount} DA - السبب: ${reason || 'غير محدد'}`,
    });

    res.json({ success: true, order: txOutcome.order, refundAmount: txOutcome.refundAmount });
  } catch (error: any) {
    console.error('Refund order error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل تنفيذ عملية الاسترداد' });
  }
});

// Update Order Item Status in Kitchen (KDS) + Sync Order & Table Status Atomically
apiRouter.patch('/kitchen/items/:id/status', requireAuth, requireRole(['ADMIN', 'MANAGER', 'KITCHEN', 'CASHIER']), async (req: AuthRequest, res) => {
  try {
    const itemId = parsePositiveInt(req.params.id);
    if (itemId === null) {
      return res.status(400).json({ error: 'معرف الصنف غير صالح' });
    }
    const { status } = req.body || {}; // NEW, PREPARING, READY, SERVED
    const allowedKitchenStatuses = new Set(['NEW', 'PREPARING', 'READY', 'SERVED']);
    if (!status || !allowedKitchenStatuses.has(String(status))) {
      return res.status(400).json({ error: 'حالة التحضير في المطبخ غير صالحة' });
    }

    const txOutcome = db.transaction((tx): { kind: 'not_found' } | { kind: 'updated'; item: any } => {
      const updated = tx.update(orderItems).set({ status: String(status) }).where(eq(orderItems.id, itemId)).returning().all();
      if (updated.length === 0) return { kind: 'not_found' };

      const orderId = updated[0].orderId;
      const allOrderItems = tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();
      const ord = tx.select().from(orders).where(eq(orders.id, orderId)).all();

      if (ord.length > 0 && !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(ord[0].status)) {
        const allReady = allOrderItems.length > 0 && allOrderItems.every((it) => it.status === 'READY' || it.status === 'SERVED');
        const anyPreparing = allOrderItems.some((it) => it.status === 'PREPARING');

        if (allReady) {
          tx.update(orders).set({ status: 'READY', updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId)).run();
          if (ord[0].tableId) {
            tx.update(restaurantTables)
              .set({ status: 'READY' })
              .where(and(eq(restaurantTables.id, ord[0].tableId), eq(restaurantTables.currentOrderId, orderId)))
              .run();
          }
        } else if (anyPreparing && ord[0].status !== 'PREPARING') {
          tx.update(orders).set({ status: 'PREPARING', updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId)).run();
        }
      }

      return { kind: 'updated', item: updated[0] };
    });

    if (txOutcome.kind === 'not_found') {
      return res.status(404).json({ error: 'الصنف غير موجود' });
    }

    res.json(txOutcome.item);
  } catch (error: any) {
    logStructuredError('UPDATE_KITCHEN_ITEM_STATUS', error, req);
    res.status(500).json({ error: 'فشل تحديث حالة الطبق في المطبخ' });
  }
});

// Kitchen Display System (KDS) Stream/Active Tickets
apiRouter.get('/kitchen/tickets', requireAuth, requireRole(['ADMIN', 'MANAGER', 'KITCHEN', 'CASHIER', 'WAITER']), async (req, res) => {
  try {
    const { station } = req.query;

    const activeOrders = await db
      .select({
        order: orders,
        table: restaurantTables,
      })
      .from(orders)
      .leftJoin(restaurantTables, eq(orders.tableId, restaurantTables.id))
      .where(and(eq(orders.isHeld, false), inArray(orders.status, ['NEW', 'CONFIRMED', 'PREPARING', 'READY'])))
      .orderBy(asc(orders.id));

    const orderIds = activeOrders.map((o) => o.order.id);
    let items: any[] = [];
    if (orderIds.length > 0) {
      let itemQuery = db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
      if (station && station !== 'ALL') {
        itemQuery = db.select().from(orderItems).where(and(inArray(orderItems.orderId, orderIds), eq(orderItems.station, String(station))));
      }
      items = await itemQuery;
    }

    const tickets = activeOrders.map((o) => ({
      ...o.order,
      tableNumber: o.table?.tableNumber,
      zone: o.table?.zone,
      items: items.filter((item) => item.orderId === o.order.id),
    })).filter((t) => t.items.length > 0);

    res.json(tickets);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل طلبات المطبخ' });
  }
});

// ==========================================
// 7. PAYMENTS & SPLIT BILL
// ==========================================
apiRouter.post('/payments', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER']), async (req: AuthRequest, res) => {
  try {
    const {
      orderId,
      payments: paymentList, // [{ method, amount, tenderAmount, changeAmount, transactionRef, idempotencyKey }]
      idempotencyKey,
    } = req.body;

    const parsedOrderId = parsePositiveInt(orderId);
    if (parsedOrderId === null || !paymentList || !Array.isArray(paymentList) || paymentList.length === 0) {
      return res.status(400).json({ error: 'بيانات الدفع غير مكتملة' });
    }

    const allowedMethods = new Set(['CASH', 'CARD', 'BANK_TRANSFER', 'CCP', 'BARIDIMOB', 'OTHER']);

    for (const p of paymentList) {
      const amt = parseFinitePositive(p?.amount);
      if (amt === null) {
        return res.status(400).json({ error: 'مبلغ الدفع يجب أن يكون أكبر من صفر' });
      }
      if (!allowedMethods.has(String(p?.method))) {
        return res.status(400).json({ error: `طريقة الدفع غير مدعومة: ${p?.method}` });
      }
      if (p?.tenderAmount !== undefined && parseFiniteNonNegative(p.tenderAmount) === null) {
        return res.status(400).json({ error: 'المبلغ المستلم غير صالح' });
      }
      if (p?.changeAmount !== undefined && parseFiniteNonNegative(p.changeAmount) === null) {
        return res.status(400).json({ error: 'مبلغ الباقي غير صالح' });
      }
    }

    const txOutcome = db.transaction((tx):
      | { kind: 'deduplicated'; orderId: number; paidAmount: number; paymentStatus: string; remainingDue: number }
      | { kind: 'error'; status: number; error: string }
      | {
          kind: 'paid';
          order: any;
          totalPaidInThisTransaction: number;
          newPaidAmount: number;
          newPaymentStatus: string;
          isFull: boolean;
          remainingDue: number;
        } => {
      const ord = tx.select().from(orders).where(eq(orders.id, Number(orderId))).all();
      if (ord.length === 0) {
        return { kind: 'error', status: 404, error: 'الطلب غير موجود' };
      }

      const order = ord[0];
      const totalOrder = Number(order.total);

      // Check idempotency inside transaction before any mutation
      if (idempotencyKey) {
        const existingPay = tx
          .select()
          .from(payments)
          .where(
            sql`${payments.idempotencyKey} = ${idempotencyKey} OR ${payments.idempotencyKey} LIKE ${idempotencyKey + '-%'}`
          )
          .all();
        if (existingPay.length > 0) {
          const paidNow = Number(order.paidAmount || 0);
          return {
            kind: 'deduplicated',
            orderId: order.id,
            paidAmount: paidNow,
            paymentStatus: order.paymentStatus,
            remainingDue: Math.max(0, totalOrder - paidNow),
          };
        }
      }

      if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
        return { kind: 'error', status: 400, error: 'لا يمكن تسجيل دفعة لطلب ملغى أو مسترد' };
      }
      if (order.paymentStatus === 'PAID') {
        return { kind: 'error', status: 400, error: 'هذه الفاتورة مدفوعة بالكامل مسبقاً' };
      }

      // Enforce open shift on register before accepting payment
      const currentShift = tx
        .select()
        .from(cashShifts)
        .where(eq(cashShifts.status, 'OPEN'))
        .orderBy(desc(cashShifts.id))
        .limit(1)
        .all();

      if (currentShift.length === 0) {
        return { kind: 'error', status: 400, error: 'يرجى فتح وردية الصندوق أولاً قبل استقبال المدفوعات' };
      }

      const shiftId = currentShift[0].id;
      const currentPaidBefore = Math.round(Number(order.paidAmount || 0) * 100) / 100;
      const remainingDueBefore = Math.max(0, Math.round((totalOrder - currentPaidBefore) * 100) / 100);
      const requestedTotal = Math.round(paymentList.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0) * 100) / 100;
      if (requestedTotal > remainingDueBefore + 0.01) {
        return {
          kind: 'error',
          status: 400,
          error: `مجموع الدفع (${requestedTotal} DA) يتجاوز المبلغ المتبقي المستحق (${remainingDueBefore} DA)`,
        };
      }

      let totalPaidInThisTransaction = 0;

      paymentList.forEach((p: any, idx: number) => {
        const amount = Math.round(Number(p.amount) * 100) / 100;
        const payKey = p.idempotencyKey
          ? String(p.idempotencyKey)
          : idempotencyKey
          ? paymentList.length === 1 && idx === 0
            ? idempotencyKey
            : `${idempotencyKey}-${idx}-${p.method}`
          : null;

        if (payKey) {
          const dupLeg = tx.select({ id: payments.id }).from(payments).where(eq(payments.idempotencyKey, payKey)).all();
          if (dupLeg.length > 0) {
            return;
          }
        }

        totalPaidInThisTransaction += amount;

        const tenderAmt = p.tenderAmount !== undefined ? Number(p.tenderAmount) : amount;
        const changeAmt = p.changeAmount !== undefined ? Number(p.changeAmount) : Math.max(0, tenderAmt - amount);

        tx.insert(payments).values({
          orderId: order.id,
          method: p.method, // CASH, CARD, BANK_TRANSFER, CCP, BARIDIMOB, OTHER
          amount: String(amount),
          tenderAmount: String(Number.isFinite(tenderAmt) ? tenderAmt : amount),
          changeAmount: String(Number.isFinite(changeAmt) ? changeAmt : 0),
          transactionRef: p.transactionRef || null,
          cashierId: req.user!.id,
          shiftId,
          idempotencyKey: payKey,
        }).run();

        if (p.method === 'CASH') {
          tx.update(cashShifts).set({
            totalCashSales: sql`${cashShifts.totalCashSales} + ${amount}`,
          }).where(eq(cashShifts.id, shiftId)).run();
        } else if (p.method === 'CARD') {
          tx.update(cashShifts).set({
            totalCardSales: sql`${cashShifts.totalCardSales} + ${amount}`,
          }).where(eq(cashShifts.id, shiftId)).run();
        } else if (p.method === 'CCP' || p.method === 'BANK_TRANSFER') {
          tx.update(cashShifts).set({
            totalCcpSales: sql`${cashShifts.totalCcpSales} + ${amount}`,
          }).where(eq(cashShifts.id, shiftId)).run();
        } else if (p.method === 'BARIDIMOB') {
          tx.update(cashShifts).set({
            totalBaridimobSales: sql`${cashShifts.totalBaridimobSales} + ${amount}`,
          }).where(eq(cashShifts.id, shiftId)).run();
        }
      });

      if (totalPaidInThisTransaction === 0 && paymentList.some((p: any) => p.idempotencyKey)) {
        const paidNow = Number(order.paidAmount || 0);
        return {
          kind: 'deduplicated',
          orderId: order.id,
          paidAmount: paidNow,
          paymentStatus: order.paymentStatus,
          remainingDue: Math.max(0, totalOrder - paidNow),
        };
      }

      const newPaidAmount = Math.round((currentPaidBefore + totalPaidInThisTransaction) * 100) / 100;
      const isFull = newPaidAmount >= totalOrder - 0.01;
      const newPaymentStatus = isFull ? 'PAID' : 'PARTIALLY_PAID';
      const totalChange = paymentList.reduce((s: number, p: any) => s + Math.max(0, Number(p.changeAmount || 0)), 0);

      // If paying an order that was still flagged isHeld, activate it and deduct recipe inventory once
      if (order.isHeld) {
        const existingMoves = tx
          .select({ id: inventoryMovements.id })
          .from(inventoryMovements)
          .where(and(eq(inventoryMovements.referenceType, 'ORDER'), eq(inventoryMovements.referenceId, order.id)))
          .all();
        if (existingMoves.length === 0) {
          const itemsForHeld = tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)).all();
          const deltas = new Map<number, number>();
          for (const it of itemsForHeld) {
            deltas.set(it.productId, (deltas.get(it.productId) || 0) + Number(it.quantity || 0));
          }
          if (deltas.size > 0) {
            applyOrderInventoryDeltasInTx(tx, {
              orderId: order.id,
              deltasByProductId: deltas,
              userId: req.user!.id,
              deductNotePrefix: 'خصم مخزون عند تسديد طلب معلق',
            });
          }
        }
      }

      tx.update(orders).set({
        paidAmount: String(newPaidAmount),
        paymentStatus: newPaymentStatus,
        status: isFull ? 'COMPLETED' : order.status === 'NEW' ? 'CONFIRMED' : order.status,
        isHeld: false,
        heldAt: null,
        shiftId: order.shiftId || shiftId,
        changeAmount: String(totalChange),
        updatedAt: new Date().toISOString(),
      }).where(eq(orders.id, order.id)).run();

      // Update table: AVAILABLE if full, WAITING_PAYMENT if partial
      if (order.tableId) {
        if (isFull) {
          tx.update(restaurantTables).set({
            status: 'AVAILABLE',
            currentOrderId: null,
          }).where(eq(restaurantTables.id, order.tableId)).run();
        } else {
          tx.update(restaurantTables).set({
            status: 'WAITING_PAYMENT',
            currentOrderId: order.id,
          }).where(eq(restaurantTables.id, order.tableId)).run();
        }
      }

      return {
        kind: 'paid',
        order,
        totalPaidInThisTransaction,
        newPaidAmount,
        newPaymentStatus,
        isFull,
        remainingDue: Math.max(0, totalOrder - newPaidAmount),
      };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }

    if (txOutcome.kind === 'deduplicated') {
      return res.json({
        success: true,
        deduplicated: true,
        orderId: txOutcome.orderId,
        paidAmount: txOutcome.paidAmount,
        paymentStatus: txOutcome.paymentStatus,
        remainingDue: txOutcome.remainingDue,
        message: 'تم استلام الدفع مسبقاً (معالجة سابقة)',
      });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'PAYMENT',
      entityType: 'ORDER',
      entityId: String(txOutcome.order.id),
      details: `تسديد مبلغ ${txOutcome.totalPaidInThisTransaction} DA للطلب ${txOutcome.order.orderNumber} عبر ${paymentList.map((p: any) => p.method).join(', ')} (${txOutcome.newPaymentStatus})`,
    });

    res.json({
      success: true,
      message: txOutcome.isFull ? 'تم تسديد الفاتورة بالكامل' : 'تم تسجيل دفعة جزئية بنجاح',
      orderId: txOutcome.order.id,
      paidAmount: txOutcome.newPaidAmount,
      paymentStatus: txOutcome.newPaymentStatus,
      remainingDue: txOutcome.remainingDue,
    });
  } catch (error: any) {
    console.error('Payment error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل تسجيل عملية الدفع' });
  }
});

// ==========================================
// 8. CASH REGISTER & SHIFTS (Gestion Caisse)
// ==========================================
apiRouter.get('/cash-register/current', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (req: AuthRequest, res) => {
  try {
    let openShift = await db
      .select({
        shift: cashShifts,
        cashier: users,
      })
      .from(cashShifts)
      .leftJoin(users, eq(cashShifts.cashierId, users.id))
      .where(and(eq(cashShifts.cashierId, req.user!.id), eq(cashShifts.status, 'OPEN')))
      .orderBy(desc(cashShifts.id))
      .limit(1);

    if (openShift.length === 0) {
      openShift = await db
        .select({
          shift: cashShifts,
          cashier: users,
        })
        .from(cashShifts)
        .leftJoin(users, eq(cashShifts.cashierId, users.id))
        .where(eq(cashShifts.status, 'OPEN'))
        .orderBy(desc(cashShifts.id))
        .limit(1);
    }

    if (openShift.length === 0) {
      return res.json({ isOpen: false, shift: null });
    }

    const s = openShift[0].shift;
    const expected = Number(s.openingCash) + Number(s.totalCashSales) + Number(s.totalCashIn) - Number(s.totalCashOut) - Number(s.totalExpenses);

    const movements = await db.select().from(cashMovements).where(eq(cashMovements.shiftId, s.id)).orderBy(desc(cashMovements.id));
    const shiftPayments = await db.select().from(payments).where(eq(payments.shiftId, s.id));

    const methodBreakdown = {
      CASH: 0,
      CARD: 0,
      BANK_TRANSFER: 0,
      CCP: 0,
      BARIDIMOB: 0,
      OTHER: 0,
      REFUND: 0,
    } as Record<string, number>;

    for (const p of shiftPayments) {
      methodBreakdown[p.method] = (methodBreakdown[p.method] || 0) + Number(p.amount);
    }

    const totalShiftSales =
      Math.max(0, methodBreakdown.CASH) +
      Math.max(0, methodBreakdown.CARD) +
      Math.max(0, methodBreakdown.BANK_TRANSFER) +
      Math.max(0, methodBreakdown.CCP) +
      Math.max(0, methodBreakdown.BARIDIMOB) +
      Math.max(0, methodBreakdown.OTHER);

    res.json({
      isOpen: true,
      shift: {
        ...s,
        cashierName: openShift[0].cashier?.fullName,
        expectedCash: expected,
        movements,
        methodBreakdown,
        totalShiftSales,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'فشل استرجاع حالة الصندوق' });
  }
});

// Open Cash Shift (Ouverture de caisse) — atomic transaction prevents two concurrent open shifts
apiRouter.post('/cash-register/open', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER']), async (req: AuthRequest, res) => {
  try {
    const { openingCash, notes } = req.body || {};
    const openAmount =
      openingCash === undefined || openingCash === null || openingCash === ''
        ? 0
        : parseFiniteNonNegative(openingCash);
    if (openAmount === null) {
      return res.status(400).json({ error: 'الرصيد الافتتاحي لا يمكن أن يكون سالباً أو غير صالح' });
    }

    const txOutcome = db.transaction((tx):
      | { kind: 'error'; status: number; error: string }
      | { kind: 'opened'; shift: any; shiftNumber: number } => {
      const existing = tx
        .select()
        .from(cashShifts)
        .where(eq(cashShifts.status, 'OPEN'))
        .all();

      if (existing.length > 0) {
        return { kind: 'error', status: 400, error: 'توجد وردية مفتوحة بالفعل، يرجى إغلاقها قبل فتح وردية جديدة' };
      }

      const maxRow = tx
        .select({
          count: sql<number>`count(*)`,
          maxId: sql<number>`COALESCE(MAX(${cashShifts.id}), 0)`,
        })
        .from(cashShifts)
        .get();
      const shiftNumber = Math.max(Number(maxRow?.count || 0), Number(maxRow?.maxId || 0)) + 1;

      const inserted = tx.insert(cashShifts).values({
        shiftNumber: String(shiftNumber),
        cashierId: req.user!.id,
        openingCash: String(openAmount),
        status: 'OPEN',
        notes: notes || null,
      }).returning().all();

      return { kind: 'opened', shift: inserted[0], shiftNumber };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'OPEN_SHIFT',
      entityType: 'SHIFT',
      entityId: String(txOutcome.shift.id),
      details: `فتح وردية صندوق رقم ${txOutcome.shiftNumber} برصيد افتتاحي ${openAmount} DA`,
    });

    res.status(201).json(txOutcome.shift);
  } catch (error: any) {
    logStructuredError('OPEN_SHIFT', error, req);
    res.status(500).json({ error: 'فشل فتح الوردية' });
  }
});

// Close Cash Shift (Clôture de caisse / Z-Report)
apiRouter.post('/cash-register/close', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER']), async (req: AuthRequest, res) => {
  try {
    const { shiftId, closingCash, notes, pendingOfflineCount } = req.body || {};

    const parsedShiftId = parsePositiveInt(shiftId);
    if (parsedShiftId === null) {
      return res.status(400).json({ error: 'معرف الوردية غير صالح' });
    }

    const actual =
      closingCash === undefined || closingCash === null || closingCash === ''
        ? 0
        : parseFiniteNonNegative(closingCash);
    if (actual === null) {
      return res.status(400).json({ error: 'مبلغ إغلاق الصندوق غير صالح أو سالب' });
    }

    if (Number(pendingOfflineCount || 0) > 0) {
      return res.status(409).json({
        error: 'لا يمكن إغلاق الوردية قبل مزامنة كافة الطلبات والمدفوعات المعلقة',
        code: 'UNSYNCED_OFFLINE_ITEMS',
      });
    }

    const txOutcome = db.transaction((tx):
      | { kind: 'error'; status: number; error: string; code?: string }
      | { kind: 'closed'; shift: any; expected: number; actual: number; diff: number } => {
      const openConflicts = tx
        .select({ count: sql<number>`count(*)` })
        .from(syncConflicts)
        .where(eq(syncConflicts.status, 'OPEN'))
        .all();
      if (Number(openConflicts[0]?.count || 0) > 0) {
        return {
          kind: 'error',
          status: 409,
          error: 'توجد تعارضات مزامنة غير محلولة، يرجى مراجعتها في مركز المزامنة قبل إغلاق الوردية',
          code: 'OPEN_SYNC_CONFLICTS',
        };
      }

      const targetShift = tx.select().from(cashShifts).where(eq(cashShifts.id, parsedShiftId)).all();
      if (targetShift.length === 0) {
        return { kind: 'error', status: 404, error: 'الوردية غير موجودة' };
      }

      const s = targetShift[0];
      if (s.status === 'CLOSED') {
        return { kind: 'error', status: 400, error: 'هذه الوردية مغلقة بالفعل' };
      }

      const expected =
        Math.round(
          (Number(s.openingCash) +
            Number(s.totalCashSales) +
            Number(s.totalCashIn) -
            Number(s.totalCashOut) -
            Number(s.totalExpenses)) *
            100
        ) / 100;
      const diff = Math.round((actual - expected) * 100) / 100;

      const closed = tx.update(cashShifts).set({
        status: 'CLOSED',
        closingCash: String(actual),
        actualCash: String(actual),
        expectedCash: String(expected),
        difference: String(diff),
        closedAt: new Date().toISOString(),
        notes: notes ? `${s.notes ? s.notes + ' | ' : ''}${notes}` : s.notes,
      }).where(eq(cashShifts.id, s.id)).returning().all();

      return { kind: 'closed', shift: closed[0], expected, actual, diff };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json(
        txOutcome.code ? { error: txOutcome.error, code: txOutcome.code } : { error: txOutcome.error }
      );
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'CLOSE_SHIFT',
      entityType: 'SHIFT',
      entityId: String(txOutcome.shift.id),
      details: `إغلاق وردية الصندوق رقم ${txOutcome.shift.shiftNumber}: المتوقع ${txOutcome.expected} DA، الفعلي ${txOutcome.actual} DA، الفارق ${txOutcome.diff} DA`,
    });

    res.json({ ...txOutcome.shift, cashDifference: txOutcome.shift.difference });
  } catch (error: any) {
    logStructuredError('CLOSE_SHIFT', error, req);
    res.status(500).json({ error: 'فشل إغلاق الوردية' });
  }
});

// Cash Movement: In / Out (with transaction & idempotency protection)
apiRouter.post('/cash-register/movement', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER']), async (req: AuthRequest, res) => {
  try {
    const { shiftId, type, amount, reason, idempotencyKey } = req.body; // type: CASH_IN, CASH_OUT
    if (!shiftId || !type || !amount || !reason) {
      return res.status(400).json({ error: 'جميع حقول حركة الصندوق مطلوبة' });
    }
    if (!['CASH_IN', 'CASH_OUT'].includes(String(type))) {
      return res.status(400).json({ error: 'نوع حركة الصندوق غير صالح' });
    }

    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'مبلغ الحركة يجب أن يكون أكبر من صفر' });
    }

    const txOutcome = db.transaction((tx):
      | { kind: 'deduplicated'; movement: any }
      | { kind: 'error'; status: number; error: string }
      | { kind: 'created'; movement: any } => {
      if (idempotencyKey) {
        const existingMov = tx
          .select()
          .from(cashMovements)
          .where(eq(cashMovements.idempotencyKey, String(idempotencyKey)))
          .all();
        if (existingMov.length > 0) {
          return { kind: 'deduplicated', movement: existingMov[0] };
        }
      }

      const shiftRows = tx.select().from(cashShifts).where(eq(cashShifts.id, Number(shiftId))).all();
      if (shiftRows.length === 0 || shiftRows[0].status !== 'OPEN') {
        return { kind: 'error', status: 400, error: 'لا يمكن تسجيل حركة على وردية مغلقة' };
      }

      const inserted = tx.insert(cashMovements).values({
        shiftId: Number(shiftId),
        cashierId: req.user!.id,
        type: String(type),
        amount: String(numAmount),
        reason: String(reason),
        performedBy: req.user!.id,
        idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
      }).returning().all();

      if (type === 'CASH_IN') {
        tx.update(cashShifts).set({
          totalCashIn: sql`${cashShifts.totalCashIn} + ${numAmount}`,
        }).where(eq(cashShifts.id, Number(shiftId))).run();
      } else {
        tx.update(cashShifts).set({
          totalCashOut: sql`${cashShifts.totalCashOut} + ${numAmount}`,
        }).where(eq(cashShifts.id, Number(shiftId))).run();
      }

      return { kind: 'created', movement: inserted[0] };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }
    if (txOutcome.kind === 'deduplicated') {
      return res.json({ ...txOutcome.movement, deduplicated: true });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: type,
      entityType: 'CASH_MOVEMENT',
      entityId: String(txOutcome.movement.id),
      details: `حركة صندوق (${type}): ${numAmount} DA - السبب: ${reason}`,
    });

    res.status(201).json(txOutcome.movement);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تسجيل حركة الصندوق' });
  }
});

// List all Shifts History
apiRouter.get('/cash-register/history', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER']), async (_req, res) => {
  try {
    const history = await db
      .select({
        shift: cashShifts,
        cashier: users,
      })
      .from(cashShifts)
      .leftJoin(users, eq(cashShifts.cashierId, users.id))
      .orderBy(desc(cashShifts.id))
      .limit(50);

    res.json(
      history.map((h) => ({
        ...h.shift,
        cashDifference: h.shift.difference,
        cashierName: h.cashier?.fullName,
      }))
    );
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل سجل الورديات' });
  }
});

// ==========================================
// 9. INVENTORY & RECIPES
// ==========================================
apiRouter.get('/inventory', requireAuth, requireRole(['ADMIN', 'MANAGER', 'INVENTORY', 'KITCHEN']), async (_req, res) => {
  try {
    const list = await db
      .select({
        ingredient: ingredients,
        supplier: suppliers,
      })
      .from(ingredients)
      .leftJoin(suppliers, eq(ingredients.supplierId, suppliers.id))
      .orderBy(asc(ingredients.id));

    res.json(list.map((l) => ({ ...l.ingredient, supplierName: l.supplier?.name })));
  } catch (error: any) {
    res.status(500).json({ error: 'فشل استرجاع عناصر المخزون' });
  }
});

apiRouter.post('/inventory', requireAuth, requireRole(['ADMIN', 'MANAGER', 'INVENTORY']), async (req: AuthRequest, res) => {
  try {
    const {
      nameAr,
      nameFr,
      unit,
      openingStock,
      currentStock,
      minStock,
      maxStock,
      costPerUnit,
      supplierId,
    } = req.body;
    if (!nameAr || !unit) {
      return res.status(400).json({ error: 'اسم المادة والوحدة مطلوبان' });
    }

    const initialStockVal =
      openingStock !== undefined && openingStock !== null && openingStock !== ''
        ? Number(openingStock)
        : currentStock !== undefined && currentStock !== null && currentStock !== ''
        ? Number(currentStock)
        : 0;
    const minStockVal =
      minStock !== undefined && minStock !== null && minStock !== '' ? Number(minStock) : 1;
    const maxStockVal =
      maxStock !== undefined && maxStock !== null && maxStock !== '' ? Number(maxStock) : null;
    const costVal =
      costPerUnit !== undefined && costPerUnit !== null && costPerUnit !== '' ? Number(costPerUnit) : 0;

    if (!Number.isFinite(initialStockVal) || initialStockVal < 0) {
      return res.status(400).json({ error: 'الرصيد الافتتاحي يجب أن يكون رقماً غير سالب' });
    }
    if (!Number.isFinite(minStockVal) || minStockVal < 0) {
      return res.status(400).json({ error: 'الحد الأدنى يجب أن يكون رقماً غير سالب' });
    }
    if (maxStockVal !== null && (!Number.isFinite(maxStockVal) || maxStockVal < minStockVal)) {
      return res.status(400).json({ error: 'الحد الأقصى يجب أن يكون أكبر من أو يساوي الحد الأدنى' });
    }
    if (!Number.isFinite(costVal) || costVal < 0) {
      return res.status(400).json({ error: 'تكلفة الوحدة غير صالحة' });
    }

    const created = db.transaction((tx) => {
      const inserted = tx
        .insert(ingredients)
        .values({
          nameAr: String(nameAr).trim(),
          nameFr: nameFr ? String(nameFr).trim() : null,
          unit: String(unit).trim(),
          currentStock: String(initialStockVal),
          minStock: String(minStockVal),
          maxStock: maxStockVal !== null ? String(maxStockVal) : null,
          costPerUnit: String(costVal),
          supplierId: supplierId ? Number(supplierId) : null,
        })
        .returning()
        .all();

      const ingRow = inserted[0];

      if (initialStockVal > 0) {
        tx.insert(inventoryMovements)
          .values({
            ingredientId: ingRow.id,
            type: 'OPENING_STOCK',
            quantity: String(initialStockVal),
            cost: String(costVal),
            referenceType: 'OPENING_STOCK',
            referenceId: ingRow.id,
            performedBy: req.user!.id,
            notes: `رصيد افتتاحي للمادة ${ingRow.nameAr}: ${initialStockVal} ${ingRow.unit}`,
          })
          .run();
      }

      return ingRow;
    });

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'ADD_INGREDIENT',
      entityType: 'INGREDIENT',
      entityId: String(created.id),
      details: `إضافة مادة للمخزون: ${created.nameAr} (رصيد افتتاحي: ${initialStockVal} ${created.unit})`,
      ipAddress: req.ip,
    });

    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل إضافة المادة إلى المخزون' });
  }
});

apiRouter.put('/inventory/:id', requireAuth, requireRole(['ADMIN', 'MANAGER', 'INVENTORY']), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف المادة غير صالح' });
    }

    const existingRows = await db.select().from(ingredients).where(eq(ingredients.id, id));
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'المادة غير موجودة' });
    }
    const cur = existingRows[0];

    const { nameAr, nameFr, unit, minStock, maxStock, costPerUnit, supplierId } = req.body;
    const nextMin =
      minStock !== undefined && minStock !== null && minStock !== ''
        ? Number(minStock)
        : Number(cur.minStock);
    const nextMax =
      maxStock === undefined
        ? cur.maxStock !== null && cur.maxStock !== undefined
          ? Number(cur.maxStock)
          : null
        : maxStock === null || maxStock === ''
        ? null
        : Number(maxStock);
    const nextCost =
      costPerUnit !== undefined && costPerUnit !== null && costPerUnit !== ''
        ? Number(costPerUnit)
        : Number(cur.costPerUnit);

    if (!Number.isFinite(nextMin) || nextMin < 0) {
      return res.status(400).json({ error: 'الحد الأدنى غير صالح' });
    }
    if (nextMax !== null && (!Number.isFinite(nextMax) || nextMax < nextMin)) {
      return res.status(400).json({ error: 'الحد الأقصى يجب أن يكون أكبر من أو يساوي الحد الأدنى' });
    }
    if (!Number.isFinite(nextCost) || nextCost < 0) {
      return res.status(400).json({ error: 'تكلفة الوحدة غير صالحة' });
    }

    const updated = await db
      .update(ingredients)
      .set({
        nameAr: nameAr !== undefined ? String(nameAr).trim() || cur.nameAr : cur.nameAr,
        nameFr: nameFr !== undefined ? (nameFr ? String(nameFr).trim() : null) : cur.nameFr,
        unit: unit !== undefined ? String(unit).trim() || cur.unit : cur.unit,
        minStock: String(nextMin),
        maxStock: nextMax !== null ? String(nextMax) : null,
        costPerUnit: String(nextCost),
        supplierId:
          supplierId === undefined ? cur.supplierId : supplierId ? Number(supplierId) : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(ingredients.id, id))
      .returning();

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'UPDATE_INGREDIENT',
      entityType: 'INGREDIENT',
      entityId: String(id),
      details: `تحديث بيانات المادة: ${updated[0].nameAr}`,
      ipAddress: req.ip,
    });

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحديث بيانات المادة' });
  }
});

// Inventory Movements Ledger (Historique des mouvements de stock)
apiRouter.get('/inventory/movements', requireAuth, requireRole(['ADMIN', 'MANAGER', 'INVENTORY', 'KITCHEN']), async (req, res) => {
  try {
    const ingredientIdFilter = req.query.ingredientId ? Number(req.query.ingredientId) : null;
    const typeFilter = req.query.type ? String(req.query.type).trim() : null;
    const limitVal = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    const conditions: any[] = [];
    if (ingredientIdFilter && Number.isFinite(ingredientIdFilter)) {
      conditions.push(eq(inventoryMovements.ingredientId, ingredientIdFilter));
    }
    if (typeFilter && typeFilter !== 'ALL') {
      conditions.push(eq(inventoryMovements.type, typeFilter));
    }

    const queryBase = db
      .select({
        id: inventoryMovements.id,
        ingredientId: inventoryMovements.ingredientId,
        ingredientNameAr: ingredients.nameAr,
        ingredientNameFr: ingredients.nameFr,
        unit: ingredients.unit,
        type: inventoryMovements.type,
        quantity: inventoryMovements.quantity,
        cost: inventoryMovements.cost,
        referenceType: inventoryMovements.referenceType,
        referenceId: inventoryMovements.referenceId,
        performedBy: inventoryMovements.performedBy,
        performedByName: users.fullName,
        notes: inventoryMovements.notes,
        createdAt: inventoryMovements.createdAt,
      })
      .from(inventoryMovements)
      .leftJoin(ingredients, eq(inventoryMovements.ingredientId, ingredients.id))
      .leftJoin(users, eq(inventoryMovements.performedBy, users.id));

    const rows =
      conditions.length > 0
        ? await queryBase
            .where(and(...conditions))
            .orderBy(desc(inventoryMovements.id))
            .limit(limitVal)
        : await queryBase.orderBy(desc(inventoryMovements.id)).limit(limitVal);

    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل سجل حركات المخزون' });
  }
});

// Manual Stock Adjustment (Stock Count / Inventaire) — atomic read+delta inside db.transaction
apiRouter.post('/inventory/adjust', requireAuth, requireRole(['ADMIN', 'MANAGER', 'INVENTORY']), async (req: AuthRequest, res) => {
  try {
    const { ingredientId, actualQuantity, reason, notes } = req.body || {};
    const parsedIngredientId = parsePositiveInt(ingredientId);
    if (parsedIngredientId === null || actualQuantity === undefined) {
      return res.status(400).json({ error: 'رقم المادة والكمية الفعلية مطلوبان' });
    }

    const newQty = parseFiniteNonNegative(actualQuantity);
    if (newQty === null) {
      return res.status(400).json({ error: 'الكمية الفعلية يجب أن تكون رقماً غير سالب' });
    }

    const txOutcome = db.transaction((tx):
      | { kind: 'not_found' }
      | { kind: 'adjusted'; nameAr: string; currentQty: number; difference: number } => {
      const ing = tx.select().from(ingredients).where(eq(ingredients.id, parsedIngredientId)).all();
      if (ing.length === 0) return { kind: 'not_found' };

      const currentQty = Number(ing[0].currentStock);
      const difference = Math.round((newQty - currentQty) * 1000) / 1000;

      tx.update(ingredients).set({
        currentStock: String(newQty),
        updatedAt: new Date().toISOString(),
      }).where(eq(ingredients.id, parsedIngredientId)).run();

      tx.insert(inventoryMovements).values({
        ingredientId: parsedIngredientId,
        type: 'ADJUSTMENT',
        quantity: String(difference),
        referenceType: 'STOCK_COUNT',
        performedBy: req.user!.id,
        notes: notes || `جرد مخزون: الفارق ${difference} ${ing[0].unit} - السبب: ${reason || 'تصحيح رصيد'}`,
      }).run();

      return { kind: 'adjusted', nameAr: ing[0].nameAr, currentQty, difference };
    });

    if (txOutcome.kind === 'not_found') {
      return res.status(404).json({ error: 'المادة غير موجودة' });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'STOCK_ADJUSTMENT',
      entityType: 'INGREDIENT',
      entityId: String(parsedIngredientId),
      details: `تسوية جرد للمادة ${txOutcome.nameAr}: الرصيد السابق ${txOutcome.currentQty}، الجديد ${newQty}`,
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'تم تحديث رصيد المخزون بنجاح', difference: txOutcome.difference });
  } catch (error: any) {
    logStructuredError('STOCK_ADJUSTMENT', error, req);
    res.status(500).json({ error: 'فشل تسوية المخزون' });
  }
});

// Waste Records (Pertes)
apiRouter.get('/waste', requireAuth, requireRole(['ADMIN', 'MANAGER', 'INVENTORY', 'KITCHEN']), async (_req, res) => {
  try {
    const list = await db
      .select({
        waste: wasteRecords,
        employee: users,
      })
      .from(wasteRecords)
      .leftJoin(users, eq(wasteRecords.employeeId, users.id))
      .orderBy(desc(wasteRecords.id))
      .limit(100);

    res.json(list.map((l) => ({ ...l.waste, employeeName: l.employee?.fullName })));
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل سجل الهدر' });
  }
});

apiRouter.post('/waste', requireAuth, requireRole(['ADMIN', 'MANAGER', 'INVENTORY', 'KITCHEN']), async (req: AuthRequest, res) => {
  try {
    const { ingredientId, productId, name, quantity, unit, reason, cost, notes } = req.body || {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cleanName || quantity === undefined || quantity === null || !cleanReason) {
      return res.status(400).json({ error: 'اسم المادة والكمية والسبب حقول إلزامية' });
    }

    const numQty = parseFinitePositive(quantity);
    if (numQty === null) {
      return res.status(400).json({ error: 'كمية الهدر يجب أن تكون رقماً موجباً أكبر من صفر' });
    }

    const numCost =
      cost === undefined || cost === null || cost === '' ? 0 : parseFiniteNonNegative(cost);
    if (numCost === null) {
      return res.status(400).json({ error: 'تكلفة الهدر يجب أن تكون رقماً غير سالب' });
    }

    const hasIngredientId = ingredientId !== undefined && ingredientId !== null && String(ingredientId).trim() !== '';
    const parsedIngredientId = hasIngredientId ? parsePositiveInt(ingredientId) : null;
    if (hasIngredientId && parsedIngredientId === null) {
      return res.status(400).json({ error: 'معرف المادة غير صالح' });
    }

    const hasProductId = productId !== undefined && productId !== null && String(productId).trim() !== '';
    const parsedProductId = hasProductId ? parsePositiveInt(productId) : null;
    if (hasProductId && parsedProductId === null) {
      return res.status(400).json({ error: 'معرف الطبق غير صالح' });
    }

    const txOutcome = db.transaction((tx): { kind: 'error'; status: number; error: string } | { kind: 'created'; wasteId: number } => {
      if (parsedIngredientId !== null) {
        const ing = tx.select({ id: ingredients.id }).from(ingredients).where(eq(ingredients.id, parsedIngredientId)).all();
        if (ing.length === 0) {
          return { kind: 'error', status: 404, error: 'المادة المرتبطة بالهدر غير موجودة' };
        }
      }

      const inserted = tx.insert(wasteRecords).values({
        ingredientId: parsedIngredientId,
        productId: parsedProductId,
        name: cleanName,
        quantity: String(numQty),
        unit: unit ? String(unit).trim() : 'KG',
        reason: cleanReason, // EXPIRED, DAMAGED, BURNED, SPILLED, OTHER
        cost: String(Math.round(numCost * 100) / 100),
        employeeId: req.user!.id,
        notes: notes || null,
      }).returning().all();

      // Deduct from inventory if linked to ingredient
      if (parsedIngredientId !== null) {
        tx.update(ingredients).set({
          currentStock: sql`${ingredients.currentStock} - ${numQty}`,
          updatedAt: new Date().toISOString(),
        }).where(eq(ingredients.id, parsedIngredientId)).run();

        tx.insert(inventoryMovements).values({
          ingredientId: parsedIngredientId,
          type: 'WASTE',
          quantity: String(-numQty),
          referenceType: 'WASTE',
          referenceId: inserted[0].id,
          performedBy: req.user!.id,
          notes: `تسجيل هدر: ${cleanReason} - ${notes || ''}`,
        }).run();
      }

      return { kind: 'created', wasteId: inserted[0].id };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'RECORD_WASTE',
      entityType: 'WASTE',
      entityId: String(txOutcome.wasteId),
      details: `تسجيل تالف/هدر: ${cleanName} (${numQty} ${unit || 'KG'}) - السبب: ${cleanReason}`,
    });

    res.status(201).json({ success: true, id: txOutcome.wasteId, message: 'تم تسجيل الهدر وخصمه من المخزون بنجاح' });
  } catch (error: any) {
    logStructuredError('RECORD_WASTE', error, req);
    res.status(500).json({ error: 'فشل تسجيل التالف' });
  }
});

// ==========================================
// 10. PURCHASES & SUPPLIERS (Achats & Fournisseurs)
// ==========================================
apiRouter.get('/suppliers', requireAuth, requireRole(['ADMIN', 'MANAGER', 'INVENTORY']), async (_req, res) => {
  try {
    const list = await db.select().from(suppliers).orderBy(asc(suppliers.name));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل الموردين' });
  }
});

apiRouter.post('/suppliers', requireAuth, requireRole(['ADMIN', 'MANAGER', 'INVENTORY']), async (req: AuthRequest, res) => {
  try {
    const { name, contactPerson, phone, email, address, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'اسم المورد مطلوب' });

    const inserted = await db.insert(suppliers).values({
      name,
      contactPerson: contactPerson || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      notes: notes || null,
    }).returning();

    res.status(201).json(inserted[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل إضافة المورد' });
  }
});

apiRouter.get('/purchases', requireAuth, requireRole(['ADMIN', 'MANAGER', 'INVENTORY']), async (_req, res) => {
  try {
    const list = await db
      .select({
        purchase: purchases,
        supplier: suppliers,
        receiver: users,
      })
      .from(purchases)
      .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
      .leftJoin(users, eq(purchases.receivedBy, users.id))
      .orderBy(desc(purchases.id))
      .limit(100);

    const purchaseIds = list.map((l) => l.purchase.id);
    let allItems: any[] = [];
    if (purchaseIds.length > 0) {
      allItems = await db
        .select({
          item: purchaseItems,
          ingredient: ingredients,
        })
        .from(purchaseItems)
        .leftJoin(ingredients, eq(purchaseItems.ingredientId, ingredients.id))
        .where(inArray(purchaseItems.purchaseId, purchaseIds));
    }

    const result = list.map((l) => ({
      ...l.purchase,
      supplierName: l.supplier?.name,
      receivedByName: l.receiver?.fullName,
      items: allItems
        .filter((it) => it.item.purchaseId === l.purchase.id)
        .map((it) => ({ ...it.item, ingredientName: it.ingredient?.nameAr })),
    }));

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل فواتير الشراء' });
  }
});

// Create Purchase Order (Atomically validates supplier/ingredients, increments stock & logs movements)
apiRouter.post('/purchases', requireAuth, requireRole(['ADMIN', 'MANAGER', 'INVENTORY']), async (req: AuthRequest, res) => {
  try {
    const { supplierId, invoiceDate, items, notes } = req.body || {};
    const parsedSupplierId = parsePositiveInt(supplierId);
    if (parsedSupplierId === null || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'المورد وبنود الشراء مطلوبة' });
    }

    const validatedItems: { ingredientId: number; quantity: number; unitCost: number; itemTotal: number }[] = [];
    let totalAmount = 0;
    for (const it of items) {
      const ingId = parsePositiveInt(it?.ingredientId);
      const qty = parseFinitePositive(it?.quantity);
      const cost = parseFiniteNonNegative(it?.unitCost);
      if (ingId === null || qty === null || cost === null) {
        return res.status(400).json({
          error: 'كل بند شراء يتطلب معرف مادة صالح وكمية موجبة وتكلفة وحدة غير سالبة',
        });
      }
      const itemTotal = Math.round(qty * cost * 100) / 100;
      totalAmount = Math.round((totalAmount + itemTotal) * 100) / 100;
      validatedItems.push({ ingredientId: ingId, quantity: qty, unitCost: cost, itemTotal });
    }

    const txOutcome = db.transaction((tx):
      | { kind: 'error'; status: number; error: string }
      | { kind: 'created'; purchase: any; purchaseNumber: string } => {
      const supRows = tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, parsedSupplierId)).all();
      if (supRows.length === 0) {
        return { kind: 'error', status: 404, error: 'المورد المحدد غير موجود' };
      }

      const uniqueIngIds = [...new Set(validatedItems.map((i) => i.ingredientId))];
      const existingIngs = tx
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(inArray(ingredients.id, uniqueIngIds))
        .all();
      const existingIngSet = new Set(existingIngs.map((r) => r.id));
      const missingIngId = uniqueIngIds.find((id) => !existingIngSet.has(id));
      if (missingIngId !== undefined) {
        return { kind: 'error', status: 404, error: `المادة رقم ${missingIngId} غير موجودة في المخزون` };
      }

      const maxRow = tx
        .select({
          count: sql<number>`count(*)`,
          maxId: sql<number>`COALESCE(MAX(${purchases.id}), 0)`,
        })
        .from(purchases)
        .get();
      let seq = Math.max(Number(maxRow?.count || 0), Number(maxRow?.maxId || 0)) + 1;
      let purchaseNumber = `ACH-${String(seq).padStart(4, '0')}`;
      while (tx.select({ id: purchases.id }).from(purchases).where(eq(purchases.purchaseNumber, purchaseNumber)).all().length > 0) {
        seq += 1;
        purchaseNumber = `ACH-${String(seq).padStart(4, '0')}`;
      }

      const p = tx.insert(purchases).values({
        purchaseNumber,
        supplierId: parsedSupplierId,
        totalAmount: String(totalAmount),
        paidAmount: String(totalAmount),
        paymentStatus: 'PAID',
        invoiceDate: invoiceDate || new Date().toISOString().split('T')[0],
        receivedBy: req.user!.id,
        notes: notes || null,
      }).returning().all();

      const newP = p[0];

      for (const it of validatedItems) {
        tx.insert(purchaseItems).values({
          purchaseId: newP.id,
          ingredientId: it.ingredientId,
          quantity: String(it.quantity),
          unitCost: String(it.unitCost),
          totalCost: String(it.itemTotal),
        }).run();

        // Increment ingredient stock & update latest cost
        tx.update(ingredients).set({
          currentStock: sql`${ingredients.currentStock} + ${it.quantity}`,
          costPerUnit: String(it.unitCost),
          updatedAt: new Date().toISOString(),
        }).where(eq(ingredients.id, it.ingredientId)).run();

        // Record stock in movement
        tx.insert(inventoryMovements).values({
          ingredientId: it.ingredientId,
          type: 'PURCHASE',
          quantity: String(it.quantity),
          cost: String(it.unitCost),
          referenceType: 'PURCHASE',
          referenceId: newP.id,
          performedBy: req.user!.id,
          notes: `شراء بموجب الفاتورة رقم ${purchaseNumber}`,
        }).run();
      }

      return { kind: 'created', purchase: newP, purchaseNumber };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'PURCHASE',
      entityType: 'PURCHASE',
      entityId: String(txOutcome.purchase.id),
      details: `تسجيل فاتورة مشتريات ${txOutcome.purchaseNumber} بمبلغ ${totalAmount} DA`,
    });

    res.status(201).json(txOutcome.purchase);
  } catch (error: any) {
    logStructuredError('CREATE_PURCHASE', error, req);
    res.status(500).json({ error: 'فشل تسجيل فاتورة الشراء' });
  }
});

// ==========================================
// 11. CUSTOMERS & DELIVERY
// ==========================================
apiRouter.get('/customers', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (_req, res) => {
  try {
    const list = await db.select().from(customers).orderBy(asc(customers.name));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل قائمة الزبائن' });
  }
});

apiRouter.post('/customers', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (req: AuthRequest, res) => {
  try {
    const { name, phone, address, notes } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'الاسم ورقم الهاتف مطلوبان' });

    const inserted = await db.insert(customers).values({
      name,
      phone,
      address: address || null,
      notes: notes || null,
    }).onConflictDoUpdate({
      target: customers.phone,
      set: { name, address, notes },
    }).returning();

    res.status(201).json(inserted[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل إضافة الزبون' });
  }
});

apiRouter.get('/deliveries', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER']), async (_req, res) => {
  try {
    const list = await db
      .select({
        delivery: deliveries,
        order: orders,
        customer: customers,
      })
      .from(deliveries)
      .leftJoin(orders, eq(deliveries.orderId, orders.id))
      .leftJoin(customers, eq(deliveries.customerId, customers.id))
      .orderBy(desc(deliveries.id));

    res.json(list.map((l) => ({
      ...l.delivery,
      orderNumber: l.order?.orderNumber,
      orderTotal: l.order?.total,
      customerName: l.customer?.name,
      customerPhone: l.customer?.phone,
    })));
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل طلبات التوصيل' });
  }
});

apiRouter.patch('/deliveries/:id/status', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER']), async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'معرف التوصيل غير صالح' });
    }
    const { status, driverName, driverPhone } = req.body || {};
    const allowedDeliveryStatuses = new Set([
      'NEW',
      'PENDING',
      'PREPARING',
      'ASSIGNED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
    ]);
    if (!status || !allowedDeliveryStatuses.has(String(status))) {
      return res.status(400).json({ error: 'حالة التوصيل غير صالحة' });
    }

    const updated = await db.update(deliveries).set({
      status: String(status),
      driverName: driverName || undefined,
      driverPhone: driverPhone || undefined,
      deliveredAt: status === 'DELIVERED' ? new Date().toISOString() : undefined,
    }).where(eq(deliveries.id, id)).returning();

    if (updated.length === 0) {
      return res.status(404).json({ error: 'طلب التوصيل غير موجود' });
    }

    res.json(updated[0]);
  } catch (error: any) {
    logStructuredError('UPDATE_DELIVERY_STATUS', error, req);
    res.status(500).json({ error: 'فشل تحديث حالة التوصيل' });
  }
});

// ==========================================
// 12. EXPENSES (Charges)
// ==========================================
apiRouter.get('/expenses', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (_req, res) => {
  try {
    const list = await db
      .select({
        expense: expenses,
        user: users,
      })
      .from(expenses)
      .leftJoin(users, eq(expenses.userId, users.id))
      .orderBy(desc(expenses.id))
      .limit(100);

    res.json(list.map((l) => ({ ...l.expense, userName: l.user?.fullName })));
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل المصاريف' });
  }
});

apiRouter.post('/expenses', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
  try {
    const { category, amount, description, date, shiftId } = req.body;
    if (!category || amount === undefined || amount === null || !description) {
      return res.status(400).json({ error: 'الفئة والمبلغ والبيان حقول مطلوبة' });
    }

    const numAmount = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'مبلغ المصروف يجب أن يكون رقماً موجباً أكبر من صفر' });
    }

    const hasShiftId = shiftId !== undefined && shiftId !== null && String(shiftId).trim() !== '';
    const parsedShiftId = hasShiftId ? Number(shiftId) : null;
    if (parsedShiftId !== null && (!Number.isInteger(parsedShiftId) || parsedShiftId <= 0)) {
      return res.status(400).json({ error: 'معرف الوردية غير صالح' });
    }

    const txOutcome = db.transaction((tx): { kind: 'error'; status: number; error: string } | { kind: 'created' } => {
      if (parsedShiftId !== null) {
        const shiftRows = tx.select().from(cashShifts).where(eq(cashShifts.id, parsedShiftId)).all();
        if (shiftRows.length === 0 || shiftRows[0].status !== 'OPEN') {
          return { kind: 'error', status: 400, error: 'لا يمكن ربط مصروف بوردية مغلقة أو غير موجودة' };
        }
      }

      tx.insert(expenses).values({
        category,
        amount: String(numAmount),
        description,
        date: date || new Date().toISOString().split('T')[0],
        userId: req.user!.id,
        shiftId: parsedShiftId,
      }).returning().all();

      // If linked to an open cash shift, record movement and update shift totalExpenses
      if (parsedShiftId !== null) {
        tx.insert(cashMovements).values({
          shiftId: parsedShiftId,
          cashierId: req.user!.id,
          type: 'EXPENSE',
          amount: String(numAmount),
          reason: `مصروف (${category}): ${description}`,
          performedBy: req.user!.id,
        }).run();

        tx.update(cashShifts).set({
          totalExpenses: sql`COALESCE(${cashShifts.totalExpenses}, 0) + ${numAmount}`,
        }).where(eq(cashShifts.id, parsedShiftId)).run();
      }
      return { kind: 'created' };
    });

    if (txOutcome.kind === 'error') {
      return res.status(txOutcome.status).json({ error: txOutcome.error });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'RECORD_EXPENSE',
      details: `تسجيل مصروف (${category}): ${numAmount} DA - ${description}`,
    });

    res.status(201).json({ success: true, message: 'تم تسجيل المصروف بنجاح' });
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تسجيل المصروف' });
  }
});

// ==========================================
// 13. CASHIER LIVE DASHBOARD & REPORTS (SQLite Compatible)
// ==========================================
apiRouter.get('/cashier/dashboard', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (_req, res) => {
  try {
    const activeOrdersRows = await db
      .select()
      .from(orders)
      .where(and(eq(orders.isHeld, false), inArray(orders.status, ['NEW', 'CONFIRMED', 'PREPARING', 'READY'])));

    const heldRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(and(eq(orders.isHeld, true), inArray(orders.status, ['NEW', 'CONFIRMED', 'PREPARING'])));

    const openShiftRows = await db
      .select()
      .from(cashShifts)
      .where(eq(cashShifts.status, 'OPEN'))
      .orderBy(desc(cashShifts.id))
      .limit(1);

    const openShift = openShiftRows[0] || null;

    let shiftTotalSales = 0;
    let expectedCash = 0;
    if (openShift) {
      const shiftPayments = await db.select().from(payments).where(eq(payments.shiftId, openShift.id));
      shiftTotalSales = shiftPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      expectedCash =
        Number(openShift.openingCash) +
        Number(openShift.totalCashSales) +
        Number(openShift.totalCashIn) -
        Number(openShift.totalCashOut) -
        Number(openShift.totalExpenses);
    }

    const preparingCount = activeOrdersRows.filter((o) => o.status === 'CONFIRMED' || o.status === 'PREPARING').length;
    const readyCount = activeOrdersRows.filter((o) => o.status === 'READY').length;

    const allTables = await db.select().from(restaurantTables);

    res.json({
      activeOrdersCount: activeOrdersRows.length,
      preparingOrdersCount: preparingCount,
      readyOrdersCount: readyCount,
      heldOrdersCount: Number(heldRows[0]?.count || 0),
      shiftTotalSales,
      shiftStatus: openShift ? 'OPEN' : 'CLOSED',
      shiftNumber: openShift ? openShift.shiftNumber : null,
      expectedCash,
      tablesSummary: {
        total: allTables.length,
        available: allTables.filter((t) => t.status === 'AVAILABLE').length,
        occupied: allTables.filter((t) => t.status === 'OCCUPIED').length,
        waitingPayment: allTables.filter((t) => t.status === 'WAITING_PAYMENT').length,
      },
    });
  } catch (error: any) {
    console.error('Cashier dashboard error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل تحميل إحصائيات الكاشير' });
  }
});

apiRouter.get('/reports/dashboard', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const todayUtc = new Date().toISOString().slice(0, 10);
    const rawStart = startDate ? String(startDate).trim() : todayUtc;
    const rawEnd = endDate ? String(endDate).trim() : todayUtc;

    const startBoundSql = rawStart.includes('T')
      ? rawStart.slice(0, 19).replace('T', ' ')
      : `${rawStart.slice(0, 10)} 00:00:00`;
    const endBoundSql = rawEnd.includes('T')
      ? rawEnd.slice(0, 19).replace('T', ' ')
      : `${rawEnd.slice(0, 10)} 23:59:59`;
    const expStartStr = rawStart.slice(0, 10);
    const expEndStr = rawEnd.slice(0, 10);

    const salesToday = await db
      .select({
        totalSales: sql<number>`COALESCE(SUM(CAST(${orders.total} AS REAL)), 0)`,
        orderCount: sql<number>`count(*)`,
        paidSales: sql<number>`COALESCE(SUM(CAST(${orders.paidAmount} AS REAL)), 0)`,
      })
      .from(orders)
      .where(
        and(
          sql`datetime(${orders.createdAt}) >= datetime(${startBoundSql})`,
          sql`datetime(${orders.createdAt}) <= datetime(${endBoundSql})`,
          eq(orders.isHeld, false),
          sql`${orders.status} NOT IN ('CANCELLED', 'REFUNDED')`,
          sql`${orders.paymentStatus} != 'REFUNDED'`
        )
      );

    const methodBreakdown = await db
      .select({
        method: payments.method,
        total: sql<number>`COALESCE(SUM(CAST(${payments.amount} AS REAL)), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .where(
        and(
          sql`datetime(${payments.createdAt}) >= datetime(${startBoundSql})`,
          sql`datetime(${payments.createdAt}) <= datetime(${endBoundSql})`,
          eq(orders.isHeld, false),
          sql`${orders.status} NOT IN ('CANCELLED', 'REFUNDED')`,
          sql`${orders.paymentStatus} != 'REFUNDED'`,
          sql`${payments.method} != 'REFUND'`
        )
      )
      .groupBy(payments.method);

    const expToday = await db
      .select({
        totalExpenses: sql<number>`COALESCE(SUM(CAST(${expenses.amount} AS REAL)), 0)`,
      })
      .from(expenses)
      .where(and(sql`${expenses.date} >= ${expStartStr}`, sql`${expenses.date} <= ${expEndStr}`));

    const lowStock = await db
      .select()
      .from(ingredients)
      .where(sql`CAST(current_stock AS REAL) <= CAST(min_stock AS REAL)`);

    const openShifts = await db.select().from(cashShifts).where(eq(cashShifts.status, 'OPEN'));

    const topProducts = await db
      .select({
        nameAr: orderItems.nameAr,
        qty: sql<number>`SUM(${orderItems.quantity})`,
        total: sql<number>`SUM(CAST(${orderItems.total} AS REAL))`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          sql`datetime(${orders.createdAt}) >= datetime(${startBoundSql})`,
          sql`datetime(${orders.createdAt}) <= datetime(${endBoundSql})`,
          eq(orders.isHeld, false),
          sql`${orders.status} NOT IN ('CANCELLED', 'REFUNDED')`,
          sql`${orders.paymentStatus} != 'REFUNDED'`
        )
      )
      .groupBy(orderItems.nameAr)
      .orderBy(desc(sql`SUM(${orderItems.quantity})`))
      .limit(5);

    const kitchenCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(and(eq(orders.isHeld, false), inArray(orders.status, ['CONFIRMED', 'PREPARING'])));

    const totalSalesNum = Number(salesToday[0]?.totalSales || 0);
    const orderCountNum = Number(salesToday[0]?.orderCount || 0);
    const avgOrder = orderCountNum > 0 ? totalSalesNum / orderCountNum : 0;
    const totalExpNum = Number(expToday[0]?.totalExpenses || 0);
    const netSales = totalSalesNum - totalExpNum;

    res.json({
      salesToday: totalSalesNum,
      orderCount: orderCountNum,
      averageOrderValue: Math.round(avgOrder),
      expensesToday: totalExpNum,
      netSales: netSales,
      paymentMethods: methodBreakdown,
      lowStockCount: lowStock.length,
      lowStockItems: lowStock,
      hasOpenShift: openShifts.length > 0,
      openShiftsCount: openShifts.length,
      topProducts,
      kitchenActiveCount: Number(kitchenCount[0]?.count || 0),
    });
  } catch (error: any) {
    console.error('Dashboard reports error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل تحميل بيانات لوحة التحكم' });
  }
});

// Detailed Sales Report (Filter by Date range)
apiRouter.get('/reports/sales', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let condition = sql`1=1`;
    if (startDate) {
      const s = String(startDate).trim();
      const sBound = s.includes('T') ? s.slice(0, 19).replace('T', ' ') : `${s.slice(0, 10)} 00:00:00`;
      condition = sql`${condition} AND datetime(${orders.createdAt}) >= datetime(${sBound})`;
    }
    if (endDate) {
      const e = String(endDate).trim();
      const eBound = e.includes('T') ? e.slice(0, 19).replace('T', ' ') : `${e.slice(0, 10)} 23:59:59`;
      condition = sql`${condition} AND datetime(${orders.createdAt}) <= datetime(${eBound})`;
    }

    const orderRows = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        type: orders.type,
        status: orders.status,
        total: orders.total,
        discount: orders.discount,
        paymentStatus: orders.paymentStatus,
        createdAt: orders.createdAt,
        cashier: users.fullName,
      })
      .from(orders)
      .leftJoin(users, eq(orders.cashierId, users.id))
      .where(and(condition, eq(orders.isHeld, false)))
      .orderBy(desc(orders.id));

    res.json(orderRows);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل استرجاع تقرير المبيعات' });
  }
});

// ==========================================
// 14. RESTAURANT SETTINGS & AUDIT LOGS
// ==========================================
apiRouter.get('/settings', requireAuth, async (_req, res) => {
  try {
    const list = await db.select().from(restaurantSettings);
    const settingsObj: Record<string, string> = {};
    for (const item of list) {
      settingsObj[item.key] = item.value;
    }
    res.json(settingsObj);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل إعدادات المطعم' });
  }
});

apiRouter.post('/settings', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const updates = req.body || {}; // { key: value }
    if (typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'بيانات الإعدادات غير صالحة' });
    }

    if (updates.tax_rate !== undefined) {
      const rate = Number(updates.tax_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return res.status(400).json({ error: 'نسبة الضريبة يجب أن تكون بين 0 و 100' });
      }
    }
    if (updates.default_language !== undefined && !['ar', 'fr'].includes(String(updates.default_language))) {
      return res.status(400).json({ error: 'اللغة الافتراضية يجب أن تكون ar أو fr' });
    }
    if (updates.low_stock_alert_threshold !== undefined) {
      const threshold = Number(updates.low_stock_alert_threshold);
      if (!Number.isFinite(threshold) || threshold < 0) {
        return res.status(400).json({ error: 'عتبة تنبيه المخزون غير صالحة' });
      }
    }
    if (updates.backup_auto_enabled !== undefined && !['true', 'false'].includes(String(updates.backup_auto_enabled))) {
      return res.status(400).json({ error: 'قيمة تفعيل النسخ التلقائي يجب أن تكون true أو false' });
    }
    if (updates.backup_interval_hours !== undefined) {
      const hours = Number(updates.backup_interval_hours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
        return res.status(400).json({ error: 'فترة النسخ الاحتياطي يجب أن تكون بين 1 و 168 ساعة' });
      }
    }
    if (updates.backup_retention_count !== undefined) {
      const retention = Number(updates.backup_retention_count);
      if (!Number.isInteger(retention) || retention < 1 || retention > 365) {
        return res.status(400).json({ error: 'عدد النسخ المحفوظة يجب أن يكون رقماً صحيحاً بين 1 و 365' });
      }
    }

    const nowIso = new Date().toISOString();
    db.transaction((tx) => {
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === null) continue;
        tx.insert(restaurantSettings)
          .values({
            key: String(key),
            value: String(value),
            updatedAt: nowIso,
          })
          .onConflictDoUpdate({
            target: restaurantSettings.key,
            set: { value: String(value), updatedAt: nowIso },
          })
          .run();
      }
    });

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'UPDATE_SETTINGS',
      entityType: 'SETTINGS',
      details: `تحديث إعدادات النظام (${Object.keys(updates).join(', ')})`,
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
  } catch (error: any) {
    res.status(500).json({ error: 'فشل حفظ الإعدادات' });
  }
});

// Immutable Audit Logs (GET only — NO PUT/PATCH/DELETE endpoints)
apiRouter.get('/audit-logs', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const isPaginated = req.query.page !== undefined || req.query.paginated === 'true';
    const userIdFilter = req.query.userId ? Number(req.query.userId) : null;
    const actionFilter = req.query.action ? String(req.query.action).trim() : '';
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : '';
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : '';
    const search = req.query.search ? String(req.query.search).trim() : '';

    const conditions: any[] = [];
    if (userIdFilter && Number.isFinite(userIdFilter)) {
      conditions.push(eq(auditLogs.userId, userIdFilter));
    }
    if (actionFilter && actionFilter !== 'ALL') {
      conditions.push(eq(auditLogs.action, actionFilter));
    }
    if (startDate) {
      const sBound = startDate.includes('T')
        ? startDate.slice(0, 19).replace('T', ' ')
        : `${startDate.slice(0, 10)} 00:00:00`;
      conditions.push(sql`datetime(${auditLogs.createdAt}) >= datetime(${sBound})`);
    }
    if (endDate) {
      const eBound = endDate.includes('T')
        ? endDate.slice(0, 19).replace('T', ' ')
        : `${endDate.slice(0, 10)} 23:59:59`;
      conditions.push(sql`datetime(${auditLogs.createdAt}) <= datetime(${eBound})`);
    }
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        sql`(
          LOWER(COALESCE(${auditLogs.action}, '')) LIKE LOWER(${pattern}) OR
          LOWER(COALESCE(${auditLogs.userName}, '')) LIKE LOWER(${pattern}) OR
          LOWER(COALESCE(${auditLogs.details}, '')) LIKE LOWER(${pattern}) OR
          LOWER(COALESCE(${auditLogs.entityType}, '')) LIKE LOWER(${pattern}) OR
          LOWER(COALESCE(${auditLogs.entityId}, '')) LIKE LOWER(${pattern})
        )`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    if (!isPaginated) {
      const limitVal = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
      const baseQ = db.select().from(auditLogs);
      const logs = whereClause
        ? await baseQ.where(whereClause).orderBy(desc(auditLogs.id)).limit(limitVal)
        : await baseQ.orderBy(desc(auditLogs.id)).limit(limitVal);
      return res.json(logs);
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const countBase = db.select({ count: sql<number>`count(*)` }).from(auditLogs);
    const totalRows = whereClause ? await countBase.where(whereClause) : await countBase;
    const total = Number(totalRows[0]?.count || 0);

    const itemsBase = db.select().from(auditLogs);
    const items = whereClause
      ? await itemsBase.where(whereClause).orderBy(desc(auditLogs.id)).limit(limit).offset(offset)
      : await itemsBase.orderBy(desc(auditLogs.id)).limit(limit).offset(offset);

    const actionsRows = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .groupBy(auditLogs.action)
      .orderBy(asc(auditLogs.action));

    res.json({
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      availableActions: actionsRows.map((a) => a.action),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل سجل العمليات' });
  }
});

// ==========================================
// 15. BACKUPS & DATA EXPORT / RESTORE
// ==========================================
async function readBackupSettingsFromDb() {
  const rows = await db
    .select()
    .from(restaurantSettings)
    .where(
      inArray(restaurantSettings.key, [
        'backup_auto_enabled',
        'backup_interval_hours',
        'backup_retention_count',
      ])
    );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const intervalHours = Number(map.get('backup_interval_hours') || 6);
  const retentionCount = Number(map.get('backup_retention_count') || 14);
  return {
    autoEnabled: map.get('backup_auto_enabled') !== 'false',
    intervalHours: Number.isFinite(intervalHours) && intervalHours >= 1 ? intervalHours : 6,
    retentionCount: Number.isFinite(retentionCount) && retentionCount >= 1 ? Math.floor(retentionCount) : 14,
  };
}

apiRouter.get('/backups', requireAuth, requireRole(['ADMIN']), async (_req: AuthRequest, res) => {
  try {
    const config = await readBackupSettingsFromDb();
    const backups = backupManager.listBackups();
    const lastVerifiedBackup = backups.find((b) => b.status === 'VERIFIED') || null;
    const lastAttempt = backups[0] || null;

    res.json({
      backups,
      lastVerifiedBackup,
      lastAttempt,
      config,
      backupDirectory: getBackupDirectory(),
    });
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل تحميل قائمة النسخ الاحتياطية' });
  }
});

apiRouter.post('/backups/create', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const requestedType = String(req.body?.type || 'MANUAL').toUpperCase();
    const allowedTypes = new Set<BackupKind>(['MANUAL', 'DAILY', 'WEEKLY', 'SCHEDULED']);
    if (!allowedTypes.has(requestedType as BackupKind)) {
      return res.status(400).json({ error: 'نوع النسخة الاحتياطية غير صالح' });
    }

    const config = await readBackupSettingsFromDb();
    const retentionCount = req.body?.retentionCount
      ? Math.max(1, Math.min(365, Math.floor(Number(req.body.retentionCount))))
      : config.retentionCount;

    const backup = await backupManager.createBackup(requestedType as BackupKind, {
      retentionCount,
    });

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'CREATE_BACKUP',
      entityType: 'BACKUP',
      entityId: backup.filename,
      details: `إنشاء نسخة احتياطية SQLite (${backup.type}) بحجم ${backup.sizeBytes} بايت والتحقق من سلامتها (${backup.integrityCheck})`,
      ipAddress: req.ip,
    });

    const backups = backupManager.listBackups();
    res.status(201).json({
      success: true,
      backup,
      backups,
    });
  } catch (error: any) {
    const safeMsg = sanitizeErrorMessage(error) || 'فشل إنشاء النسخة الاحتياطية';
    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'CREATE_BACKUP_FAILED',
      entityType: 'BACKUP',
      details: `فشل إنشاء نسخة احتياطية: ${safeMsg}`,
      ipAddress: req.ip,
    });
    res.status(500).json({ error: safeMsg });
  }
});

apiRouter.post('/backups/verify', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const filename = String(req.body?.filename || '').trim();
    if (!filename) {
      return res.status(400).json({ error: 'اسم ملف النسخة الاحتياطية مطلوب' });
    }

    let safePath: string;
    try {
      safePath = backupManager.resolveSafeBackupPath(filename);
    } catch (pathErr: any) {
      return res.status(400).json({ error: sanitizeErrorMessage(pathErr) || 'اسم ملف غير صالح' });
    }

    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود' });
    }

    const verification = backupManager.verifyExistingBackup(filename);

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'VERIFY_BACKUP',
      entityType: 'BACKUP',
      entityId: filename,
      details: `فحص سلامة النسخة ${filename}: ${verification.status} (${verification.integrityCheck})`,
      ipAddress: req.ip,
    });

    res.json({
      success: verification.valid,
      verification,
    });
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل فحص النسخة الاحتياطية' });
  }
});

apiRouter.post('/backups/restore', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  const filename = String(req.body?.filename || '').trim();
  const confirmRestore = String(req.body?.confirmRestore || '').trim();

  if (!filename) {
    return res.status(400).json({ error: 'اسم ملف النسخة الاحتياطية مطلوب للاستعادة' });
  }
  if (confirmRestore !== 'CONFIRM_RESTORE') {
    return res.status(400).json({ error: 'مطلوب تأكيد صريح لاستعادة قاعدة البيانات (CONFIRM_RESTORE)' });
  }

  let safePath: string;
  try {
    safePath = backupManager.resolveSafeBackupPath(filename);
  } catch (pathErr: any) {
    return res.status(400).json({ error: sanitizeErrorMessage(pathErr) || 'اسم ملف غير صالح' });
  }

  if (!fs.existsSync(safePath)) {
    return res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود' });
  }

  try {
    const result = await backupManager.restoreBackup(filename);

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'RESTORE_BACKUP',
      entityType: 'BACKUP',
      entityId: filename,
      details: `استعادة قاعدة البيانات من ${filename} (نسخة ما قبل الاستعادة: ${result.preRestoreBackup})`,
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (error: any) {
    const safeMsg = sanitizeErrorMessage(error) || 'فشلت عملية استعادة النسخة الاحتياطية';
    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'RESTORE_BACKUP_FAILED',
      entityType: 'BACKUP',
      entityId: filename,
      details: `فشل/رفض استعادة ${filename}: ${safeMsg}`,
      ipAddress: req.ip,
    });
    const statusCode = safeMsg.includes('تالف') || safeMsg.includes('مفقودة') ? 400 : 500;
    res.status(statusCode).json({ error: safeMsg });
  }
});

apiRouter.get('/backups/download/:filename', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const rawFilename = String(req.params.filename || '').trim();
    let safePath: string;
    try {
      safePath = backupManager.resolveSafeBackupPath(rawFilename);
    } catch (pathErr: any) {
      return res.status(400).json({ error: sanitizeErrorMessage(pathErr) || 'اسم ملف غير صالح' });
    }

    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود' });
    }

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'DOWNLOAD_BACKUP',
      entityType: 'BACKUP',
      entityId: rawFilename,
      details: `تحميل ملف النسخة الاحتياطية ${rawFilename}`,
      ipAddress: req.ip,
    });

    res.download(safePath, path.basename(safePath));
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل تحميل ملف النسخة الاحتياطية' });
  }
});

apiRouter.get('/backups/export', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const rawUsers = await db.select().from(users);
    const safeUsers = rawUsers.map(({ passwordHash: _ph, pin, ...safeUser }) => ({
      ...safeUser,
      hasPin: Boolean(pin && String(pin).trim().length > 0),
    }));

    const backupData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      restaurant: 'GOLDEN PALACE POS',
      users: safeUsers,
      categories: await db.select().from(categories),
      products: await db.select().from(products),
      productVariants: await db.select().from(productVariants),
      productAddons: await db.select().from(productAddons),
      restaurantTables: await db.select().from(restaurantTables),
      ingredients: await db.select().from(ingredients),
      productRecipes: await db.select().from(productRecipes),
      suppliers: await db.select().from(suppliers),
      settings: await db.select().from(restaurantSettings),
      orders: await db.select().from(orders).limit(500),
      orderItems: await db.select().from(orderItems).limit(2000),
      payments: await db.select().from(payments).limit(1000),
    };

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'EXPORT_BACKUP',
      details: 'توليد وتصدير نسخة احتياطية كاملة للنظام',
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="golden_palace_backup_${Date.now()}.json"`);
    res.json(backupData);
  } catch (error: any) {
    console.error('Backup error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل إنشاء النسخة الاحتياطية' });
  }
});

// ==========================================
// 16. OFFLINE SYNC (Idempotent FIFO Sync, Multi-Device Deduplication & Conflict Detection)
// ==========================================
apiRouter.post('/sync/batch', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (req: AuthRequest, res) => {
  try {
    const {
      offlineOrders = [],
      offlinePayments = [],
      offlineCashMovements = [],
      deviceId = null,
    } = req.body || {};

    if (
      !Array.isArray(offlineOrders) ||
      !Array.isArray(offlinePayments) ||
      !Array.isArray(offlineCashMovements)
    ) {
      return res.status(400).json({ error: 'بيانات المزامنة غير صالحة' });
    }

    const allowedMethods = new Set(['CASH', 'CARD', 'BANK_TRANSFER', 'CCP', 'BARIDIMOB', 'OTHER']);

    type SyncConflictType =
      | 'PRODUCT_UNAVAILABLE'
      | 'PRICE_CHANGED'
      | 'TABLE_OCCUPIED'
      | 'TAX_RATE_CHANGED'
      | 'STOCK_INSUFFICIENT'
      | 'VALIDATION_ERROR';

    class SyncValidationError extends Error {
      retryable: boolean;
      conflictType?: SyncConflictType;
      serverSnapshot?: any;
      constructor(
        message: string,
        retryable = false,
        conflictType?: SyncConflictType,
        serverSnapshot?: any
      ) {
        super(message);
        this.retryable = retryable;
        this.conflictType = conflictType;
        this.serverSnapshot = serverSnapshot;
      }
    }

    const sortFifo = <T extends { sequenceOrder?: number; createdAt?: string }>(arr: T[]): T[] => {
      return [...arr].sort((a, b) => {
        const seqA = Number.isFinite(Number(a?.sequenceOrder)) ? Number(a.sequenceOrder) : Number.MAX_SAFE_INTEGER;
        const seqB = Number.isFinite(Number(b?.sequenceOrder)) ? Number(b.sequenceOrder) : Number.MAX_SAFE_INTEGER;
        if (seqA !== seqB) return seqA - seqB;
        const tA = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tA - tB;
      });
    };

    const recordPaymentLegsInTx = (
      tx: any,
      params: {
        orderRow: any;
        paymentLegs: any[];
        activeShiftId: number | null;
        cashierId: number;
        keyPrefix: string;
      }
    ) => {
      const { orderRow, paymentLegs, activeShiftId, cashierId, keyPrefix } = params;
      if (!paymentLegs || paymentLegs.length === 0) return;

      for (const leg of paymentLegs) {
        const amt = Number(leg.amount);
        if (!Number.isFinite(amt) || amt <= 0) {
          throw new SyncValidationError('مبلغ الدفع غير صالح في الطلب غير المتصل', false, 'VALIDATION_ERROR');
        }
        if (!allowedMethods.has(String(leg.method))) {
          throw new SyncValidationError(`طريقة الدفع غير مدعومة: ${leg.method}`, false, 'VALIDATION_ERROR');
        }
      }

      let insertedAny = false;
      let totalChangeAdded = 0;

      paymentLegs.forEach((leg: any, idx: number) => {
        const amt = Number(leg.amount);
        const tenderAmt = leg.tenderAmount !== undefined ? Number(leg.tenderAmount) : amt;
        const changeAmt = leg.changeAmount !== undefined ? Number(leg.changeAmount) : Math.max(0, tenderAmt - amt);
        const legKey = leg.idempotencyKey
          ? String(leg.idempotencyKey)
          : paymentLegs.length === 1 && idx === 0
          ? keyPrefix
          : `${keyPrefix}-${idx}-${leg.method}`;

        const existingLeg = tx
          .select({ id: payments.id })
          .from(payments)
          .where(
            idx === 0 && paymentLegs.length === 1
              ? sql`${payments.idempotencyKey} = ${legKey} OR ${payments.idempotencyKey} = ${keyPrefix}`
              : eq(payments.idempotencyKey, legKey)
          )
          .all();

        if (existingLeg.length > 0) {
          return;
        }

        insertedAny = true;
        totalChangeAdded += Math.max(0, changeAmt);

        tx.insert(payments).values({
          orderId: orderRow.id,
          method: String(leg.method),
          amount: String(amt),
          tenderAmount: String(Number.isFinite(tenderAmt) ? tenderAmt : amt),
          changeAmount: String(Number.isFinite(changeAmt) ? changeAmt : 0),
          transactionRef: leg.transactionRef || null,
          cashierId,
          shiftId: activeShiftId,
          idempotencyKey: legKey,
        }).run();

        if (activeShiftId) {
          if (leg.method === 'CASH') {
            tx.update(cashShifts).set({
              totalCashSales: sql`${cashShifts.totalCashSales} + ${amt}`,
            }).where(eq(cashShifts.id, activeShiftId)).run();
          } else if (leg.method === 'CARD') {
            tx.update(cashShifts).set({
              totalCardSales: sql`${cashShifts.totalCardSales} + ${amt}`,
            }).where(eq(cashShifts.id, activeShiftId)).run();
          } else if (leg.method === 'CCP' || leg.method === 'BANK_TRANSFER') {
            tx.update(cashShifts).set({
              totalCcpSales: sql`${cashShifts.totalCcpSales} + ${amt}`,
            }).where(eq(cashShifts.id, activeShiftId)).run();
          } else if (leg.method === 'BARIDIMOB') {
            tx.update(cashShifts).set({
              totalBaridimobSales: sql`${cashShifts.totalBaridimobSales} + ${amt}`,
            }).where(eq(cashShifts.id, activeShiftId)).run();
          }
        }
      });

      if (insertedAny) {
        const allOrderPayments = tx.select().from(payments).where(eq(payments.orderId, orderRow.id)).all();
        const totalPaid = allOrderPayments
          .filter((p: any) => Number(p.amount) > 0)
          .reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        const orderTotal = Number(orderRow.total || 0);
        const isFull = totalPaid >= orderTotal - 0.01;
        const newPaymentStatus = totalPaid <= 0 ? 'UNPAID' : isFull ? 'PAID' : 'PARTIALLY_PAID';

        tx.update(orders).set({
          paidAmount: String(totalPaid),
          paymentStatus: newPaymentStatus,
          status: isFull ? 'COMPLETED' : orderRow.status,
          shiftId: orderRow.shiftId || activeShiftId,
          changeAmount: String(Number(orderRow.changeAmount || 0) + totalChangeAdded),
          updatedAt: new Date().toISOString(),
        }).where(eq(orders.id, orderRow.id)).run();

        if (orderRow.tableId) {
          if (isFull) {
            tx.update(restaurantTables).set({
              status: 'AVAILABLE',
              currentOrderId: null,
            }).where(and(eq(restaurantTables.id, orderRow.tableId), eq(restaurantTables.currentOrderId, orderRow.id))).run();
          } else {
            tx.update(restaurantTables).set({
              status: 'WAITING_PAYMENT',
              currentOrderId: orderRow.id,
            }).where(and(eq(restaurantTables.id, orderRow.tableId), eq(restaurantTables.currentOrderId, orderRow.id))).run();
          }
        }
      }
    };

    const syncedIds: string[] = [];
    const syncedPaymentIds: string[] = [];
    const syncedCashMovementIds: string[] = [];
    const failedOrders: {
      offlineId: string;
      operationId?: string;
      error: string;
      retryable: boolean;
      conflictType?: SyncConflictType;
      serverSnapshot?: any;
    }[] = [];
    const failedPayments: { offlinePaymentId: string; operationId?: string; error: string; retryable: boolean }[] = [];
    const failedCashMovements: { offlineMovementId: string; error: string; retryable: boolean }[] = [];
    const conflicts: any[] = [];
    const results: any[] = [];

    const openShiftRows = await db
      .select()
      .from(cashShifts)
      .where(eq(cashShifts.status, 'OPEN'))
      .orderBy(desc(cashShifts.id))
      .limit(1);
    const activeShiftId = openShiftRows[0]?.id || null;

    const orderedOfflineOrders = sortFifo(offlineOrders);
    const orderedOfflinePayments = sortFifo(offlinePayments);
    const orderedCashMovements = sortFifo(offlineCashMovements);

    for (const offOrder of orderedOfflineOrders) {
      const offKey = offOrder?.offlineId || offOrder?.idempotencyKey || 'unknown';
      const opId = String(offOrder?.operationId || offOrder?.offlineId || offOrder?.idempotencyKey || offKey);
      const idempKey = offOrder?.idempotencyKey || (offOrder?.offlineId ? `offline-${offOrder.offlineId}` : null);
      const resolution = offOrder?.conflictResolution || null;

      try {
        const outcome = db.transaction((tx) => {
          const normalizedLegs =
            Array.isArray(offOrder?.payments) && offOrder.payments.length > 0
              ? offOrder.payments
              : offOrder?.paymentMethod && Number(offOrder.paidAmount || 0) > 0
              ? [
                  {
                    method: offOrder.paymentMethod,
                    amount: Number(offOrder.paidAmount || 0),
                    tenderAmount: Number(offOrder.paidAmount || 0),
                    changeAmount: 0,
                  },
                ]
              : [];

          // 1. Strict deduplication inside transaction (by offlineId, idempotencyKey, or operationId)
          let existingOrder: any = null;
          if (offOrder?.offlineId) {
            const byOffline = tx.select().from(orders).where(eq(orders.offlineId, offOrder.offlineId)).all();
            if (byOffline.length > 0) existingOrder = byOffline[0];
          }
          if (!existingOrder && idempKey) {
            const byKey = tx.select().from(orders).where(eq(orders.idempotencyKey, idempKey)).all();
            if (byKey.length > 0) existingOrder = byKey[0];
          }
          if (!existingOrder && opId) {
            const existingOp = tx
              .select()
              .from(syncOperations)
              .where(and(eq(syncOperations.operationId, opId), eq(syncOperations.status, 'SYNCED')))
              .all();
            if (existingOp.length > 0 && existingOp[0].serverEntityId) {
              const byOpOrd = tx.select().from(orders).where(eq(orders.id, existingOp[0].serverEntityId)).all();
              if (byOpOrd.length > 0) existingOrder = byOpOrd[0];
            }
          }

          if (existingOrder) {
            if (normalizedLegs.length > 0) {
              recordPaymentLegsInTx(tx, {
                orderRow: existingOrder,
                paymentLegs: normalizedLegs,
                activeShiftId,
                cashierId: req.user!.id,
                keyPrefix: `pay-offline-${offOrder.offlineId || idempKey}`,
              });
            }
            return {
              offlineId: offKey,
              operationId: opId,
              orderId: existingOrder.id,
              orderNumber: existingOrder.orderNumber,
              deduplicated: true,
            };
          }

          // 2. Validate basic payload
          if (!offOrder?.items || !Array.isArray(offOrder.items) || offOrder.items.length === 0) {
            throw new SyncValidationError('الطلب يجب أن يحتوي على منتج واحد على الأقل', false, 'VALIDATION_ERROR');
          }

          const offDiscount = Number(offOrder.discount || 0);
          const offFee = Number(offOrder.deliveryFee || 0);
          if (!Number.isFinite(offDiscount) || offDiscount < 0 || !Number.isFinite(offFee) || offFee < 0) {
            throw new SyncValidationError('قيمة الخصم أو رسوم التوصيل غير صالحة', false, 'VALIDATION_ERROR');
          }
          if (offDiscount > 0 && !['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'].includes(req.user!.role)) {
            throw new SyncValidationError('لا تملك صلاحية تطبيق الخصم على الفاتورة', false, 'VALIDATION_ERROR');
          }

          // 3. Conflict Check: Product availability & Price changes
          const strictConflict = Boolean(offOrder.strictConflictCheck);
          const preparedItems = offOrder.items.map((item: any) => ({ ...item }));

          for (let i = 0; i < preparedItems.length; i++) {
            const rawItem = preparedItems[i];
            const prodId = Number(rawItem.productId);
            const dbProdRows = Number.isFinite(prodId) && prodId > 0
              ? tx.select().from(products).where(eq(products.id, prodId)).all()
              : [];

            if (dbProdRows.length === 0 || !dbProdRows[0].isAvailable) {
              const reason = dbProdRows.length === 0
                ? `المنتج غير موجود في قاعدة البيانات (ID: ${prodId})`
                : `المنتج "${dbProdRows[0].nameAr}" أصبح غير متوفر حالياً`;
              throw new SyncValidationError(reason, false, 'PRODUCT_UNAVAILABLE', {
                productId: prodId,
                nameAr: rawItem.nameAr || dbProdRows[0]?.nameAr || '',
                exists: dbProdRows.length > 0,
                isAvailable: Boolean(dbProdRows[0]?.isAvailable),
              });
            }

            const dbProd = dbProdRows[0];
            let variantAdj = 0;
            const rawVariant = rawItem.selectedVariant || (Array.isArray(rawItem.variants) ? rawItem.variants[0] : null);
            if (rawVariant && rawVariant.id) {
              const vRows = tx
                .select()
                .from(productVariants)
                .where(and(eq(productVariants.id, Number(rawVariant.id)), eq(productVariants.productId, prodId)))
                .all();
              if (vRows.length > 0) variantAdj = Number(vRows[0].priceAdjustment || 0);
            }
            let addonsTotal = 0;
            const rawAddons = Array.isArray(rawItem.selectedAddons)
              ? rawItem.selectedAddons
              : Array.isArray(rawItem.addons)
              ? rawItem.addons
              : [];
            for (const a of rawAddons) {
              if (a && a.id) {
                const aRows = tx.select().from(productAddons).where(eq(productAddons.id, Number(a.id))).all();
                if (aRows.length > 0) addonsTotal += Number(aRows[0].price || 0);
              }
            }

            const serverCatalogUnitPrice = Number(dbProd.price) + variantAdj + addonsTotal;
            const clientUnitPrice =
              rawItem.unitPrice !== undefined && rawItem.unitPrice !== null && rawItem.unitPrice !== ''
                ? Number(rawItem.unitPrice)
                : serverCatalogUnitPrice;
            const priceDiffers = Math.abs(clientUnitPrice - serverCatalogUnitPrice) > 0.01;
            const mustCheckPrice =
              strictConflict ||
              rawItem.expectedCatalogPrice !== undefined ||
              !['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.role);

            if (priceDiffers && mustCheckPrice && !rawItem.priceOverrideReason) {
              if (resolution?.action === 'ACCEPT_SERVER_CATALOG') {
                preparedItems[i] = {
                  ...rawItem,
                  unitPrice: serverCatalogUnitPrice,
                  expectedCatalogPrice: serverCatalogUnitPrice,
                };
              } else if (resolution?.action === 'OVERRIDE_PRICE') {
                if (!['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.role)) {
                  throw new SyncValidationError(
                    'لا تملك صلاحية اعتماد السعر اليدوي — يتطلب صلاحية مدير أو مشرف',
                    false,
                    'PRICE_CHANGED',
                    {
                      productId: prodId,
                      nameAr: dbProd.nameAr,
                      clientPrice: clientUnitPrice,
                      serverPrice: serverCatalogUnitPrice,
                      requiresManagerOverride: true,
                    }
                  );
                }
                preparedItems[i] = {
                  ...rawItem,
                  priceOverrideReason: 'SYNC_CONFLICT_OVERRIDE',
                };
              } else {
                throw new SyncValidationError(
                  `تغير سعر الصنف "${dbProd.nameAr}" من ${clientUnitPrice} DA إلى ${serverCatalogUnitPrice} DA أثناء عدم الاتصال`,
                  false,
                  'PRICE_CHANGED',
                  {
                    productId: prodId,
                    nameAr: dbProd.nameAr,
                    clientPrice: clientUnitPrice,
                    serverPrice: serverCatalogUnitPrice,
                  }
                );
              }
            }
          }

          let validatedOffItems: ValidatedOrderItem[];
          try {
            validatedOffItems = validateAndPriceOrderItemsInTx(tx, preparedItems, req.user!.role);
          } catch (valErr: any) {
            throw new SyncValidationError(valErr?.message || 'بيانات الأصناف غير صالحة', false, 'VALIDATION_ERROR');
          }

          // 4. Conflict Check: Tax rate change
          const taxSetting = tx.select().from(restaurantSettings).where(eq(restaurantSettings.key, 'tax_rate')).all();
          const serverTaxRate = Math.max(0, Number(taxSetting[0]?.value || 0)) || 0;
          if (
            strictConflict &&
            offOrder.taxRate !== undefined &&
            offOrder.taxRate !== null &&
            Math.abs(Number(offOrder.taxRate) - serverTaxRate) > 0.01 &&
            resolution?.action !== 'ACCEPT_SERVER_TAX' &&
            resolution?.action !== 'ACCEPT_SERVER_CATALOG'
          ) {
            throw new SyncValidationError(
              `تغيرت نسبة الضريبة من ${Number(offOrder.taxRate)}% إلى ${serverTaxRate}%`,
              false,
              'TAX_RATE_CHANGED',
              {
                clientTaxRate: Number(offOrder.taxRate),
                serverTaxRate,
              }
            );
          }

          // 5. Conflict Check: Stock sufficiency (when enforced by client or inventory policy)
          if (offOrder.enforceStockCheck === true) {
            const neededByIngredient = new Map<number, number>();
            for (const item of validatedOffItems) {
              const recipes = tx.select().from(productRecipes).where(eq(productRecipes.productId, item.productId)).all();
              for (const r of recipes) {
                neededByIngredient.set(
                  r.ingredientId,
                  (neededByIngredient.get(r.ingredientId) || 0) + Number(r.quantity || 0) * item.quantity
                );
              }
            }
            const shortages: any[] = [];
            for (const [ingId, reqQty] of neededByIngredient.entries()) {
              const ingRow = tx.select().from(ingredients).where(eq(ingredients.id, ingId)).all()[0];
              if (ingRow && Number(ingRow.currentStock) - reqQty < -0.00001) {
                shortages.push({
                  ingredientId: ingId,
                  nameAr: ingRow.nameAr,
                  available: Number(ingRow.currentStock),
                  required: reqQty,
                });
              }
            }
            if (shortages.length > 0) {
              if (resolution?.action === 'FORCE_STOCK') {
                if (!['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.role)) {
                  throw new SyncValidationError(
                    'تجاوز عجز المخزون يتطلب صلاحية المدير أو المشرف',
                    false,
                    'STOCK_INSUFFICIENT',
                    { shortages }
                  );
                }
              } else {
                throw new SyncValidationError(
                  `نقص في رصيد المخزون للمكونات (${shortages.map((s) => s.nameAr).join('، ')})`,
                  false,
                  'STOCK_INSUFFICIENT',
                  { shortages }
                );
              }
            }
          }

          let validCustomerId: number | null = null;
          let offCustomerRow: any = null;
          if (offOrder.customerId && Number(offOrder.customerId) > 0) {
            const cRows = tx.select().from(customers).where(eq(customers.id, Number(offOrder.customerId))).all();
            if (cRows.length > 0) {
              validCustomerId = cRows[0].id;
              offCustomerRow = cRows[0];
            }
          }

          // 6. Conflict Check: Table occupied while offline
          let effectiveOrderType = offOrder.type || 'DINE_IN';
          let tableIdNum: number | null = offOrder.tableId ? Number(offOrder.tableId) : null;
          let tableRow: any = null;

          if (effectiveOrderType === 'DINE_IN' && tableIdNum) {
            if (resolution?.action === 'CONVERT_TO_TAKEAWAY') {
              effectiveOrderType = 'TAKEAWAY';
              tableIdNum = null;
            } else {
              const targetTblId =
                resolution?.action === 'REASSIGN_TABLE' && resolution?.newTableId
                  ? Number(resolution.newTableId)
                  : tableIdNum;
              const tbl = tx.select().from(restaurantTables).where(eq(restaurantTables.id, targetTblId)).all();
              if (tbl.length === 0) {
                throw new SyncValidationError('الطاولة المحددة غير موجودة', false, 'TABLE_OCCUPIED');
              }
              if (tbl[0].status === 'INACTIVE') {
                throw new SyncValidationError('الطاولة غير نشطة حالياً', false, 'TABLE_OCCUPIED');
              }

              const isPaidInitiallyCheck = offOrder.paymentStatus === 'PAID';
              const allowForceAttach =
                resolution?.action === 'FORCE_ATTACH_ORDER' && ['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.role);
              if (tbl[0].currentOrderId && !offOrder.isHeld && !isPaidInitiallyCheck && !allowForceAttach) {
                const occOrd = tx.select().from(orders).where(eq(orders.id, tbl[0].currentOrderId)).all()[0];
                if (
                  occOrd &&
                  !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(occOrd.status) &&
                  occOrd.paymentStatus !== 'PAID'
                ) {
                  const freeTables = tx
                    .select({ id: restaurantTables.id, tableNumber: restaurantTables.tableNumber, zone: restaurantTables.zone })
                    .from(restaurantTables)
                    .where(eq(restaurantTables.status, 'AVAILABLE'))
                    .all();
                  throw new SyncValidationError(
                    `الطاولة ${tbl[0].tableNumber} مشغولة حالياً بالطلب ${occOrd.orderNumber}`,
                    false,
                    'TABLE_OCCUPIED',
                    {
                      tableId: tbl[0].id,
                      tableNumber: tbl[0].tableNumber,
                      occupyingOrderId: occOrd.id,
                      occupyingOrderNumber: occOrd.orderNumber,
                      availableTables: freeTables.slice(0, 10),
                    }
                  );
                }
              }
              tableIdNum = targetTblId;
              tableRow = tbl[0];
            }
          }

          const taxRate = serverTaxRate;
          const computedSubtotal = validatedOffItems.reduce((sum, it) => sum + it.total, 0);
          const taxable = Math.max(0, computedSubtotal - offDiscount);
          const taxAmount = Math.round(((taxable * taxRate) / 100) * 100) / 100;
          const computedTotal = Math.max(0, taxable + taxAmount + offFee);

          const seqRow = tx
            .select({
              maxSeq: sql<number>`COALESCE(MAX(${orders.dailySequence}), 0)`,
              maxId: sql<number>`COALESCE(MAX(${orders.id}), 0)`,
            })
            .from(orders)
            .get();
          let dailySeq = Math.max(Number(seqRow?.maxSeq || 0), Number(seqRow?.maxId || 0)) + 1;
          let orderNumber = `BON-${String(dailySeq).padStart(4, '0')}`;
          while (tx.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, orderNumber)).all().length > 0) {
            dailySeq += 1;
            orderNumber = `BON-${String(dailySeq).padStart(4, '0')}`;
          }

          const isPaidInitially = offOrder.paymentStatus === 'PAID';
          const o = tx.insert(orders).values({
            orderNumber,
            dailySequence: dailySeq,
            type: effectiveOrderType,
            tableId: tableIdNum,
            customerId: validCustomerId,
            status: offOrder.isHeld ? 'NEW' : isPaidInitially ? 'COMPLETED' : 'CONFIRMED',
            subtotal: String(computedSubtotal),
            discount: String(offDiscount),
            deliveryFee: String(offFee),
            taxRate: String(taxRate),
            taxAmount: String(taxAmount),
            total: String(computedTotal),
            paidAmount: '0',
            paymentStatus: 'UNPAID',
            cashierId: req.user!.id,
            shiftId: activeShiftId,
            idempotencyKey: idempKey,
            offlineId: offOrder.offlineId || null,
            isHeld: Boolean(offOrder.isHeld),
            heldAt: offOrder.isHeld ? offOrder.createdAt || new Date().toISOString() : null,
            notes: offOrder.notes || 'مزامنة من وضع عدم الاتصال (Offline Queue)',
          }).returning().all();

          const newOrd = o[0];
          const offDeltas = new Map<number, number>();

          for (const item of validatedOffItems) {
            tx.insert(orderItems).values({
              orderId: newOrd.id,
              productId: item.productId,
              nameAr: item.nameAr,
              nameFr: item.nameFr,
              unitPrice: String(item.unitPrice),
              costPrice: String(item.costPrice),
              quantity: item.quantity,
              total: String(item.total),
              notes: item.notes,
              station: item.station,
              status: offOrder.sendToKitchen ? 'PREPARING' : 'NEW',
              variantsJson: item.variantsJson,
              addonsJson: item.addonsJson,
            }).run();

            if (!offOrder.isHeld) {
              offDeltas.set(item.productId, (offDeltas.get(item.productId) || 0) + item.quantity);
            }

            if (item.priceOverrideAudit) {
              tx.insert(auditLogs).values({
                userId: req.user!.id,
                userName: req.user!.fullName,
                action: 'ORDER_ITEM_PRICE_OVERRIDE',
                entityType: 'ORDER',
                entityId: String(newOrd.id),
                details: `تعديل سعر الصنف ${item.priceOverrideAudit.nameAr} (Offline Sync) من ${item.priceOverrideAudit.oldPrice} DA إلى ${item.priceOverrideAudit.newPrice} DA`,
              }).run();
            }
          }

          if (!offOrder.isHeld && offDeltas.size > 0) {
            applyOrderInventoryDeltasInTx(tx, {
              orderId: newOrd.id,
              deltasByProductId: offDeltas,
              userId: req.user!.id,
              deductNotePrefix: 'خصم تلقائي للوصفة (Offline Sync)',
              initialDeductionOnly: true,
            });
          }

          if (
            tableRow &&
            !offOrder.isHeld &&
            normalizedLegs.length === 0 &&
            (!tableRow.currentOrderId || tableRow.status === 'AVAILABLE' || tableRow.status === 'RESERVED')
          ) {
            tx.update(restaurantTables).set({
              status: 'OCCUPIED',
              currentOrderId: newOrd.id,
            }).where(eq(restaurantTables.id, tableRow.id)).run();
          }

          if (effectiveOrderType === 'DELIVERY') {
            const resolvedOffAddr =
              (typeof offOrder.deliveryAddress === 'string' && offOrder.deliveryAddress.trim()) ||
              offCustomerRow?.address ||
              'توصيل - غير محدد';
            tx.insert(deliveries).values({
              orderId: newOrd.id,
              customerId: validCustomerId,
              customerAddress: resolvedOffAddr,
              deliveryAddress: resolvedOffAddr,
              deliveryFee: String(offFee),
              status: 'NEW',
              notes: offOrder.notes || null,
            }).run();
          }

          if (normalizedLegs.length > 0) {
            if (tableRow && !tableRow.currentOrderId) {
              tx.update(restaurantTables).set({ currentOrderId: newOrd.id }).where(eq(restaurantTables.id, tableRow.id)).run();
            }
            recordPaymentLegsInTx(tx, {
              orderRow: newOrd,
              paymentLegs: normalizedLegs,
              activeShiftId,
              cashierId: req.user!.id,
              keyPrefix: `pay-offline-${offOrder.offlineId || idempKey}`,
            });
          }

          // Record idempotency operation ledger entry & close any matching OPEN conflict
          tx.insert(syncOperations)
            .values({
              operationId: opId,
              entityType: 'ORDER',
              idempotencyKey: idempKey,
              deviceId: offOrder.deviceId || deviceId || null,
              sequenceOrder: Number.isFinite(Number(offOrder.sequenceOrder)) ? Number(offOrder.sequenceOrder) : 0,
              status: 'SYNCED',
              serverEntityId: newOrd.id,
              orderNumber: newOrd.orderNumber,
              details: resolution ? `Resolved with ${resolution.action}` : 'Synced',
            })
            .onConflictDoNothing()
            .run();

          tx.update(syncConflicts)
            .set({
              status: 'RESOLVED',
              resolutionAction: resolution?.action || 'AUTO_SYNCED',
              resolvedBy: req.user!.id,
              resolvedAt: new Date().toISOString(),
            })
            .where(and(eq(syncConflicts.operationId, opId), eq(syncConflicts.status, 'OPEN')))
            .run();

          return {
            offlineId: offKey,
            operationId: opId,
            orderId: newOrd.id,
            orderNumber: newOrd.orderNumber,
            deduplicated: false,
          };
        });

        syncedIds.push(offKey);
        results.push(outcome);
      } catch (itemErr: any) {
        const retryable = itemErr instanceof SyncValidationError ? itemErr.retryable : true;
        const conflictType = itemErr instanceof SyncValidationError ? itemErr.conflictType : undefined;
        const serverSnapshot = itemErr instanceof SyncValidationError ? itemErr.serverSnapshot : undefined;
        const errMsg = itemErr?.message || 'فشل مزامنة الطلب';

        failedOrders.push({
          offlineId: offKey,
          operationId: opId,
          error: errMsg,
          retryable,
          ...(conflictType ? { conflictType, serverSnapshot } : {}),
        });

        if (conflictType && ['PRODUCT_UNAVAILABLE', 'PRICE_CHANGED', 'TABLE_OCCUPIED', 'TAX_RATE_CHANGED', 'STOCK_INSUFFICIENT'].includes(conflictType)) {
          try {
            const existingOpen = db
              .select()
              .from(syncConflicts)
              .where(and(eq(syncConflicts.operationId, opId), eq(syncConflicts.status, 'OPEN')))
              .all();

            let conflictRecord: any;
            if (existingOpen.length > 0) {
              const updatedConf = db
                .update(syncConflicts)
                .set({
                  conflictType,
                  message: errMsg,
                  serverSnapshotJson: serverSnapshot ? JSON.stringify(serverSnapshot) : null,
                  payloadJson: JSON.stringify(offOrder),
                })
                .where(eq(syncConflicts.id, existingOpen[0].id))
                .returning()
                .all();
              conflictRecord = updatedConf[0];
            } else {
              const insertedConf = db
                .insert(syncConflicts)
                .values({
                  operationId: opId,
                  entityType: 'ORDER',
                  conflictType,
                  severity: 'BLOCKING',
                  payloadJson: JSON.stringify(offOrder),
                  serverSnapshotJson: serverSnapshot ? JSON.stringify(serverSnapshot) : null,
                  message: errMsg,
                  status: 'OPEN',
                })
                .returning()
                .all();
              conflictRecord = insertedConf[0];
            }

            conflicts.push({
              id: conflictRecord?.id,
              operationId: opId,
              offlineId: offKey,
              entityType: 'ORDER',
              conflictType,
              message: errMsg,
              serverSnapshot,
            });
          } catch {
            // Do not fail batch on conflict audit log persistence
          }
        }
      }
    }

    for (const offPay of orderedOfflinePayments) {
      const offPayId = offPay?.offlinePaymentId || offPay?.idempotencyKey || 'unknown-pay';
      const opId = String(offPay?.operationId || offPayId);
      try {
        db.transaction((tx) => {
          const ordRows = tx.select().from(orders).where(eq(orders.id, Number(offPay.orderId))).all();
          if (ordRows.length === 0) {
            throw new SyncValidationError('الطلب المرتبط بالدفعة غير موجود', false);
          }
          const targetOrd = ordRows[0];
          if (targetOrd.status === 'CANCELLED' || targetOrd.status === 'REFUNDED') {
            throw new SyncValidationError('لا يمكن مزامنة دفعة لطلب ملغى أو مسترد', false);
          }

          recordPaymentLegsInTx(tx, {
            orderRow: targetOrd,
            paymentLegs: Array.isArray(offPay.payments) ? offPay.payments : [],
            activeShiftId,
            cashierId: req.user!.id,
            keyPrefix: offPay.idempotencyKey || `pay-offline-${offPayId}`,
          });

          tx.insert(syncOperations)
            .values({
              operationId: opId,
              entityType: 'PAYMENT',
              idempotencyKey: offPay.idempotencyKey || offPayId,
              deviceId: offPay.deviceId || deviceId || null,
              sequenceOrder: Number.isFinite(Number(offPay.sequenceOrder)) ? Number(offPay.sequenceOrder) : 0,
              status: 'SYNCED',
              serverEntityId: targetOrd.id,
              orderNumber: targetOrd.orderNumber,
              details: 'Synced offline payment',
            })
            .onConflictDoNothing()
            .run();
        });

        syncedPaymentIds.push(offPayId);
      } catch (payErr: any) {
        const retryable = payErr instanceof SyncValidationError ? payErr.retryable : true;
        failedPayments.push({
          offlinePaymentId: offPayId,
          operationId: opId,
          error: payErr?.message || 'فشل مزامنة الدفعة',
          retryable,
        });
      }
    }

    for (const offMov of orderedCashMovements) {
      const offMovId = offMov?.offlineMovementId || offMov?.idempotencyKey || 'unknown-mov';
      const opId = String(offMov?.operationId || offMovId);
      const movKey = String(offMov?.idempotencyKey || offMovId);
      try {
        db.transaction((tx) => {
          const existing = tx
            .select()
            .from(cashMovements)
            .where(eq(cashMovements.idempotencyKey, movKey))
            .all();
          if (existing.length > 0) return;

          const targetShiftId = Number(offMov.shiftId || activeShiftId);
          if (!targetShiftId) {
            throw new SyncValidationError('لا توجد وردية صندوق نشطة لتسجيل حركة النقد', false);
          }
          const shiftRows = tx.select().from(cashShifts).where(eq(cashShifts.id, targetShiftId)).all();
          if (shiftRows.length === 0 || shiftRows[0].status !== 'OPEN') {
            throw new SyncValidationError('الوردية المرتبطة بالحركة مغلقة', false);
          }

          const amt = Number(offMov.amount);
          if (!Number.isFinite(amt) || amt <= 0) {
            throw new SyncValidationError('مبلغ الحركة غير صالح', false);
          }
          if (!['CASH_IN', 'CASH_OUT'].includes(String(offMov.type))) {
            throw new SyncValidationError('نوع الحركة غير صالح', false);
          }

          const inserted = tx
            .insert(cashMovements)
            .values({
              shiftId: targetShiftId,
              cashierId: req.user!.id,
              type: String(offMov.type),
              amount: String(amt),
              reason: String(offMov.reason || 'حركة صندوق أوفلاين'),
              performedBy: req.user!.id,
              idempotencyKey: movKey,
            })
            .returning()
            .all();

          if (offMov.type === 'CASH_IN') {
            tx.update(cashShifts).set({
              totalCashIn: sql`${cashShifts.totalCashIn} + ${amt}`,
            }).where(eq(cashShifts.id, targetShiftId)).run();
          } else {
            tx.update(cashShifts).set({
              totalCashOut: sql`${cashShifts.totalCashOut} + ${amt}`,
            }).where(eq(cashShifts.id, targetShiftId)).run();
          }

          tx.insert(syncOperations)
            .values({
              operationId: opId,
              entityType: 'CASH_MOVEMENT',
              idempotencyKey: movKey,
              deviceId: offMov.deviceId || deviceId || null,
              sequenceOrder: Number.isFinite(Number(offMov.sequenceOrder)) ? Number(offMov.sequenceOrder) : 0,
              status: 'SYNCED',
              serverEntityId: inserted[0]?.id || null,
              details: `${offMov.type}: ${amt}`,
            })
            .onConflictDoNothing()
            .run();
        });

        syncedCashMovementIds.push(offMovId);
      } catch (movErr: any) {
        const retryable = movErr instanceof SyncValidationError ? movErr.retryable : true;
        failedCashMovements.push({
          offlineMovementId: offMovId,
          error: movErr?.message || 'فشل مزامنة حركة الصندوق',
          retryable,
        });
      }
    }

    res.json({
      success:
        failedOrders.length === 0 &&
        failedPayments.length === 0 &&
        failedCashMovements.length === 0,
      message: `تمت مزامنة ${syncedIds.length} طلبات و${syncedPaymentIds.length} دفعات و${syncedCashMovementIds.length} حركات صندوق`,
      syncedIds,
      syncedPaymentIds,
      syncedCashMovementIds,
      failedOrders,
      failedPayments,
      failedCashMovements,
      conflicts,
      results,
    });
  } catch (error: any) {
    console.error('Batch sync error:', sanitizeErrorMessage(error));
    res.status(500).json({ error: 'فشل مزامنة الطلبات غير المتصلة' });
  }
});

// Sync Center Backend Endpoints: Status & Conflict Resolution
apiRouter.get('/sync/status', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (_req, res) => {
  try {
    const recentOps = await db
      .select()
      .from(syncOperations)
      .orderBy(desc(syncOperations.createdAt))
      .limit(50);
    const openConflicts = await db
      .select()
      .from(syncConflicts)
      .where(eq(syncConflicts.status, 'OPEN'))
      .orderBy(desc(syncConflicts.id));

    res.json({
      status: 'ok',
      openConflictsCount: openConflicts.length,
      openConflicts,
      recentOperations: recentOps,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل حالة المزامنة' });
  }
});

apiRouter.get('/sync/conflicts', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']), async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(syncConflicts)
      .orderBy(desc(syncConflicts.id))
      .limit(100);
    res.json(
      rows.map((r) => ({
        ...r,
        payload: (() => {
          try {
            return JSON.parse(r.payloadJson);
          } catch {
            return null;
          }
        })(),
        serverSnapshot: (() => {
          try {
            return r.serverSnapshotJson ? JSON.parse(r.serverSnapshotJson) : null;
          } catch {
            return null;
          }
        })(),
      }))
    );
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحميل سجل تعارضات المزامنة' });
  }
});

apiRouter.post('/sync/conflicts/:id/resolve', requireAuth, requireRole(['ADMIN', 'MANAGER', 'CASHIER']), async (req: AuthRequest, res) => {
  try {
    const conflictId = parsePositiveInt(req.params.id);
    if (conflictId === null) {
      return res.status(400).json({ error: 'معرف التعارض غير صالح' });
    }
    const { action } = req.body || {};
    const allowedActions = new Set([
      'DISCARD',
      'ACCEPT_SERVER_CATALOG',
      'OVERRIDE_PRICE',
      'CONVERT_TO_TAKEAWAY',
      'REASSIGN_TABLE',
      'ACCEPT_SERVER_TAX',
      'FORCE_STOCK',
      'FORCE_ATTACH_ORDER',
      'RESOLVED_ON_CLIENT',
    ]);
    if (!action || !allowedActions.has(String(action))) {
      return res.status(400).json({ error: 'إجراء معالجة التعارض غير صالح' });
    }

    if (
      ['OVERRIDE_PRICE', 'FORCE_STOCK', 'FORCE_ATTACH_ORDER', 'DISCARD'].includes(String(action)) &&
      !['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.role)
    ) {
      return res.status(403).json({
        error: 'هذا الإجراء متاح فقط للمدير أو المشرف العام',
      });
    }

    const existingRows = await db.select().from(syncConflicts).where(eq(syncConflicts.id, conflictId));
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'سجل التعارض غير موجود' });
    }

    const nextStatus = action === 'DISCARD' ? 'DISCARDED' : 'RESOLVED';
    const updated = await db
      .update(syncConflicts)
      .set({
        status: nextStatus,
        resolutionAction: String(action),
        resolvedBy: req.user!.id,
        resolvedAt: new Date().toISOString(),
      })
      .where(eq(syncConflicts.id, conflictId))
      .returning();

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'RESOLVE_SYNC_CONFLICT',
      entityType: 'SYNC_CONFLICT',
      entityId: String(conflictId),
      details: `معالجة تعارض المزامنة (${existingRows[0].conflictType}) للعملية ${existingRows[0].operationId} عبر ${action}`,
      ipAddress: req.ip,
    });

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'فشل تحديث حالة التعارض' });
  }
});

// ==========================================
// 19. WINDOWS THERMAL PRINTER, PRINT QUEUE & DESKTOP LIFECYCLE API
// ==========================================

// Get Printer Environment & Real Detected Windows Printers (no Bluetooth / unverified claims)
apiRouter.get('/printer/status', requireAuth, async (_req, res) => {
  try {
    const info = await enumerateSystemPrinters();
    res.json({
      ...info,
      defaultPrinter: info.printers.find((p) => p.isDefault)?.name || info.printers[0]?.name || 'CAFETERIA',
      defaultDriver: '80Normal',
      supportedPaperSizes: ['80mm', '58mm'],
      supportedEncodings: ['CP864', 'WINDOWS_1256', 'UTF8'],
      spoolCommandExample: `copy /b "ticket.prn" "\\\\localhost\\CAFETERIA"`,
      powerShellCommandExample: `Get-Content -Path ".\\ticket.prn" -Encoding Byte -Raw | Out-Printer -Name "CAFETERIA"`,
    });
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل فحص حالة الطابعات' });
  }
});

// Direct Spool / Dispatch Print Job via Persistent SQLite print_jobs Queue
apiRouter.post(
  '/printer/spool',
  requireAuth,
  requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN']),
  async (req: AuthRequest, res) => {
    try {
      const {
        orderId,
        orderNumber,
        jobType = 'RECEIPT',
        printerName = 'CAFETERIA',
        connectionType = 'WINDOWS_SPOOLER',
        targetIp,
        targetPort,
        copies = 1,
        paperWidth = '80mm',
        rawBase64,
        textContent,
        payloadPreview,
        printJobId,
        isReprint = false,
        clientHandled = false,
        clientError = null,
      } = req.body || {};

      // Enforce RBAC for explicit reprints (Cashier / Manager / Admin only)
      if (isReprint && !['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'].includes(req.user!.role)) {
        return res.status(403).json({ error: 'إعادة طباعة الإيصال متاحة فقط للكاشير أو المدير' });
      }

      const result = await createAndProcessPrintJob({
        orderId: orderId ? Number(orderId) : null,
        orderNumber: String(orderNumber || `ORDER-${Date.now()}`),
        jobType: String(jobType || 'RECEIPT'),
        printerName: String(printerName || 'CAFETERIA'),
        connectionType: connectionType as PrinterConnectionType,
        targetIp: targetIp || null,
        targetPort: targetPort ? Number(targetPort) : 9100,
        copies: Math.max(1, Math.min(5, Number(copies) || 1)),
        paperWidth: paperWidth === '58mm' ? '58mm' : '80mm',
        isReprint: Boolean(isReprint),
        jobKey: printJobId ? String(printJobId) : undefined,
        requestedBy: req.user!.id,
        rawBase64,
        textContent,
        payloadPreview,
        clientHandled: Boolean(clientHandled),
        clientError: clientError || null,
      });

      if (result.deduplicated) {
        return res.json({
          success: true,
          mode: 'deduplicated',
          job: result.job,
          jobId: result.job.id,
          spoolerAccepted: Boolean(result.job.spoolerAccepted),
          hardwareConfirmed: Boolean(result.job.confirmedAt),
          deliveryState: result.job.confirmedAt ? 'CONFIRMED' : 'SPOOLED',
          message: `تم تسجيل/طباعة وصل هذا الطلب (${result.job.orderNumber}) مسبقاً (وصل واحد فقط لكل طلب). استخدم «إعادة طباعة الوصل» عند الحاجة.`,
        });
      }

      const transport = result.transportResult!;
      const deliveryState = resolveDeliveryState(transport);
      if (!transport.success) {
        return res.status(502).json({
          success: false,
          mode: transport.mode,
          status: result.job.status,
          deliveryState: 'FAILED',
          error: transport.message || transport.error || 'فشل إرسال مهمة الطباعة',
          message: transport.message || transport.error || 'فشل إرسال مهمة الطباعة',
          job: result.job,
          jobId: result.job.id,
          spoolerAccepted: false,
          hardwareConfirmed: false,
        });
      }

      await logAudit({
        userId: req.user!.id,
        userName: req.user!.fullName,
        action: isReprint ? 'REPRINT_RECEIPT' : 'PRINT_RECEIPT',
        entityType: 'PRINT_JOB',
        entityId: String(result.job.id),
        details: `${isReprint ? 'إعادة طباعة' : 'طباعة'} ${result.job.orderNumber} عبر ${result.job.connectionType} (${result.job.printerName})`,
        ipAddress: req.ip,
      });

      res.json({
        success: true,
        mode: transport.mode,
        status: result.job.status,
        deliveryState,
        isReprint: Boolean(result.job.isReprint),
        message: transport.message,
        job: result.job,
        jobId: result.job.id,
        spoolerAccepted: transport.spoolerAccepted,
        hardwareConfirmed: transport.hardwareConfirmed,
        copies: result.job.copies,
      });
    } catch (error: any) {
      console.error('Printer spool error:', sanitizeErrorMessage(error));
      res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل إرسال مهمة الطباعة' });
    }
  }
);

// List Persistent Print Jobs History (never deleted)
apiRouter.get('/printer/jobs', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 80));
    const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : null;
    const baseQuery = db.select().from(printJobs);
    const rows =
      statusFilter && ['PENDING', 'PROCESSING', 'PRINTED', 'FAILED'].includes(statusFilter)
        ? await baseQuery.where(eq(printJobs.status, statusFilter)).orderBy(desc(printJobs.id)).limit(limit)
        : await baseQuery.orderBy(desc(printJobs.id)).limit(limit);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل جلب سجل مهام الطباعة' });
  }
});

// Retry a FAILED or PENDING print job manually
apiRouter.post(
  '/printer/jobs/:id/retry',
  requireAuth,
  requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN']),
  async (req: AuthRequest, res) => {
    try {
      const jobId = Number(req.params.id);
      if (!Number.isFinite(jobId) || jobId <= 0) {
        return res.status(400).json({ error: 'معرف مهمة الطباعة غير صالح' });
      }
      const existingRows = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'مهمة الطباعة غير موجودة' });
      }
      if (existingRows[0].isReprint && !['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'].includes(req.user!.role)) {
        return res.status(403).json({ error: 'إعادة طباعة الإيصال متاحة فقط للكاشير أو المدير' });
      }
      const { job, transportResult } = await retryExistingPrintJob(jobId, req.body?.rawBase64);
      await logAudit({
        userId: req.user!.id,
        userName: req.user!.fullName,
        action: 'RETRY_PRINT_JOB',
        entityType: 'PRINT_JOB',
        entityId: String(jobId),
        details: `إعادة محاولة طباعة المهمة #${jobId} (${job.orderNumber}): ${job.status}`,
        ipAddress: req.ip,
      });

      if (!transportResult.success) {
        return res.status(502).json({
          success: false,
          status: job.status,
          deliveryState: 'FAILED',
          spoolerAccepted: false,
          hardwareConfirmed: false,
          error: transportResult.message || 'فشل إعادة محاولة الطباعة',
          job,
          transportResult,
        });
      }
      res.json({
        success: true,
        status: job.status,
        deliveryState: resolveDeliveryState(transportResult),
        spoolerAccepted: transportResult.spoolerAccepted,
        hardwareConfirmed: transportResult.hardwareConfirmed,
        job,
        transportResult,
      });
    } catch (error: any) {
      const msg = error?.message || 'فشل إعادة محاولة الطباعة';
      const code = error?.code;
      const statusCode =
        code === 'MISSING_FULL_PRINT_PAYLOAD'
          ? 422
          : msg.includes('غير موجودة')
          ? 404
          : msg.includes('مطبوعة بالفعل')
          ? 409
          : 500;
      res.status(statusCode).json(code ? { error: msg, code } : { error: msg });
    }
  }
);

// Explicit RBAC-gated Manual Reprint from an existing job record
apiRouter.post(
  '/printer/jobs/:id/reprint',
  requireAuth,
  requireRole(['ADMIN', 'MANAGER', 'CASHIER']),
  async (req: AuthRequest, res) => {
    try {
      const jobId = Number(req.params.id);
      if (!Number.isFinite(jobId) || jobId <= 0) {
        return res.status(400).json({ error: 'معرف مهمة الطباعة غير صالح' });
      }
      const origRows = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
      if (origRows.length === 0) {
        return res.status(404).json({ error: 'مهمة الطباعة الأصلية غير موجودة' });
      }
      const orig = origRows[0];
      let resolvedRawBase64: string | undefined =
        typeof req.body?.rawBase64 === 'string' && req.body.rawBase64.trim().length > 0
          ? req.body.rawBase64.trim()
          : undefined;
      if (!resolvedRawBase64) {
        const storedFullPayload = readFullPrintPayload(orig.id);
        if (storedFullPayload && storedFullPayload.length > 0) {
          resolvedRawBase64 = storedFullPayload.toString('base64');
        }
      }
      if (!resolvedRawBase64) {
        return res.status(422).json({
          error: 'تعذر إعادة الطباعة: بيانات الوصل الأصلية الكاملة غير متوفرة (ممنوع الطباعة من معاينة مختصرة).',
          code: 'MISSING_FULL_PRINT_PAYLOAD',
        });
      }

      const result = await createAndProcessPrintJob({
        orderId: orig.orderId,
        orderNumber: orig.orderNumber,
        jobType: orig.jobType,
        printerName: req.body?.printerName || orig.printerName,
        connectionType: (req.body?.connectionType || orig.connectionType) as PrinterConnectionType,
        targetIp: req.body?.targetIp ?? orig.targetIp,
        targetPort: req.body?.targetPort ?? orig.targetPort,
        copies: 1,
        paperWidth: orig.paperWidth,
        isReprint: true,
        requestedBy: req.user!.id,
        rawBase64: resolvedRawBase64,
        payloadPreview: orig.payloadPreview || undefined,
        clientHandled: Boolean(req.body?.clientHandled),
      });

      await logAudit({
        userId: req.user!.id,
        userName: req.user!.fullName,
        action: 'REPRINT_RECEIPT',
        entityType: 'PRINT_JOB',
        entityId: String(result.job.id),
        details: `إعادة طباعة يدوية للطلب ${orig.orderNumber} (من المهمة #${jobId})`,
        ipAddress: req.ip,
      });

      if (result.transportResult && !result.transportResult.success) {
        return res.status(502).json({
          success: false,
          status: result.job.status,
          deliveryState: 'FAILED',
          error: result.transportResult.message,
          job: result.job,
        });
      }
      res.json({
        success: true,
        status: result.job.status,
        deliveryState: result.transportResult ? resolveDeliveryState(result.transportResult) : 'SPOOLED',
        spoolerAccepted: Boolean(result.transportResult?.spoolerAccepted),
        hardwareConfirmed: Boolean(result.transportResult?.hardwareConfirmed),
        job: result.job,
        transportResult: result.transportResult,
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل إعادة الطباعة' });
    }
  }
);

// Confirm physical paper output (stage 3 confirmation)
apiRouter.post(
  '/printer/jobs/:id/confirm',
  requireAuth,
  requireRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN']),
  async (req: AuthRequest, res) => {
    try {
      const jobId = parsePositiveInt(req.params.id);
      if (jobId === null) {
        return res.status(400).json({ error: 'معرف مهمة الطباعة غير صالح' });
      }
      const updated = await db
        .update(printJobs)
        .set({
          status: 'PRINTED',
          spoolerAccepted: true,
          confirmedAt: new Date().toISOString(),
          errorMessage: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(printJobs.id, jobId))
        .returning();
      if (updated.length === 0) {
        return res.status(404).json({ error: 'مهمة الطباعة غير موجودة' });
      }
      res.json({ success: true, job: updated[0] });
    } catch (error: any) {
      logStructuredError('CONFIRM_PRINT_JOB', error, req);
      res.status(500).json({ error: 'فشل تأكيد الطباعة' });
    }
  }
);

// Live Printer Diagnostics (STANDARD / ARABIC / FEED_CUT)
apiRouter.post(
  '/printer/test',
  requireAuth,
  requireRole(['ADMIN', 'MANAGER', 'CASHIER']),
  async (req: AuthRequest, res) => {
    try {
      const {
        testType = 'STANDARD',
        printerName = 'CAFETERIA',
        connectionType = 'WINDOWS_SPOOLER',
        targetIp,
        targetPort,
        paperWidth,
        paperType,
        arabicEncoding = 'CP864',
      } = req.body || {};

      const safeTestType = ['STANDARD', 'ARABIC', 'FEED_CUT'].includes(String(testType))
        ? (String(testType) as 'STANDARD' | 'ARABIC' | 'FEED_CUT')
        : 'STANDARD';
      const resolvedPaperWidth: '58mm' | '80mm' =
        (paperWidth || paperType) === '58mm' ? '58mm' : '80mm';

      const result = await runLivePrinterTest({
        testType: safeTestType,
        printerName: String(printerName || 'CAFETERIA'),
        connectionType: connectionType as PrinterConnectionType,
        targetIp: targetIp || null,
        targetPort: targetPort ? Number(targetPort) : 9100,
        paperWidth: resolvedPaperWidth,
        arabicEncoding: (arabicEncoding || 'CP864') as ArabicEscPosEncoding,
        requestedBy: req.user!.id,
      });

      if (result.transportResult && !result.transportResult.success) {
        return res.status(502).json({
          success: false,
          testType: safeTestType,
          paperType: resolvedPaperWidth,
          status: result.job.status,
          error: result.transportResult.message,
          job: result.job,
          transportResult: result.transportResult,
        });
      }

      res.json({
        success: true,
        testType: safeTestType,
        paperType: resolvedPaperWidth,
        status: result.job.status,
        job: result.job,
        transportResult: result.transportResult,
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل اختبار الطابعة' });
    }
  }
);

// Desktop & First-Run Lifecycle Endpoints (Task 06, 07, 08)
apiRouter.get('/system/first-run-status', (_req, res) => {
  try {
    const status = getDesktopRuntimeStatus(sqlite);
    res.json({
      needsInitialAdminSetup: status.needsInitialAdminSetup,
      isDesktop: status.isDesktop,
      isProductionMode:
        process.env.GOLDEN_PALACE_DB_MODE === 'production' ||
        process.env.GOLDEN_PALACE_DESKTOP === '1' ||
        process.env.NODE_ENV === 'production',
      platform: status.platform,
      usersCount: status.usersCount,
    });
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل فحص حالة التشغيل الأول' });
  }
});

// One-time Owner/Admin setup ONLY when database has zero users (no hardcoded PIN 1234!)
apiRouter.post('/system/setup-admin', async (req, res) => {
  try {
    const existingCountRow = sqlite.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
    if (Number(existingCountRow?.c || 0) > 0) {
      return res.status(409).json({
        error: 'النظام مهيأ مسبقاً بحسابات مستخدمين. يرجى تسجيل الدخول بالحساب القائم.',
      });
    }

    const { fullName, username, email, password, pin } = req.body || {};
    const cleanFullName = String(fullName || '').trim();
    const cleanUsername = String(username || '').trim();
    const cleanEmail = String(email || `${cleanUsername}@goldenpalace.dz`).trim();
    const cleanPassword = String(password || '');
    const cleanPin = String(pin || '').trim();

    if (!cleanFullName || !cleanUsername) {
      return res.status(400).json({
        error: 'يرجى إدخال الاسم الكامل واسم المستخدم وكلمة مرور لا تقل عن 8 أحرف',
      });
    }

    const setupPasswordCheck = validatePasswordStrength(cleanPassword, cleanUsername);
    if (!setupPasswordCheck.valid) {
      return res.status(400).json({ error: setupPasswordCheck.error });
    }

    const WEAK_PINS = new Set(['1234', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999']);
    if (!/^\d{4,12}$/.test(cleanPin) || WEAK_PINS.has(cleanPin)) {
      return res.status(400).json({
        error: 'يرجى اختيار رمز PIN شخصي قوي (4 إلى 12 رقماً، غير متكرر وليس 1234)',
      });
    }

    runFirstRunDatabaseAudit(sqlite);

    const passwordHash = bcrypt.hashSync(cleanPassword, 10);
    const pinHash = await hashPin(cleanPin);
    const uid = `admin-owner-${Date.now()}`;

    const setupOutcome = db.transaction((tx): { kind: 'already_initialized' } | { kind: 'created'; adminUser: any } => {
      const countInsideTx = tx
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .get();
      if (Number(countInsideTx?.count || 0) > 0) {
        return { kind: 'already_initialized' };
      }

      const inserted = tx
        .insert(users)
        .values({
          uid,
          username: cleanUsername,
          email: cleanEmail,
          passwordHash,
          pin: pinHash,
          fullName: cleanFullName,
          role: 'ADMIN',
          isActive: true,
        })
        .returning()
        .all();

      return { kind: 'created', adminUser: inserted[0] };
    });

    if (setupOutcome.kind === 'already_initialized') {
      return res.status(409).json({
        error: 'النظام مهيأ مسبقاً بحسابات مستخدمين. يرجى تسجيل الدخول بالحساب القائم.',
      });
    }

    const adminUser = setupOutcome.adminUser;
    const token = signUserToken({
      id: adminUser.id,
      uid: adminUser.uid,
      username: adminUser.username,
      email: adminUser.email,
      fullName: adminUser.fullName,
      role: 'ADMIN',
    });

    await logAudit({
      userId: adminUser.id,
      userName: adminUser.fullName,
      action: 'INITIAL_ADMIN_SETUP',
      entityType: 'USER',
      entityId: String(adminUser.id),
      details: `تهيئة أول حساب مدير للنظام (${adminUser.username}) بدون كلمة مرور افتراضية`,
      ipAddress: req.ip,
    });

    res.status(201).json({
      token,
      user: {
        id: adminUser.id,
        uid: adminUser.uid,
        username: adminUser.username,
        email: adminUser.email,
        fullName: adminUser.fullName,
        role: adminUser.role,
        isActive: adminUser.isActive,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل إنشاء حساب المدير الأول' });
  }
});

apiRouter.get(
  '/system/desktop-status',
  requireAuth,
  requireRole(['ADMIN', 'MANAGER']),
  (_req, res) => {
    try {
      res.json(getDesktopRuntimeStatus(sqlite));
    } catch (error: any) {
      res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل فحص بيئة سطح المكتب' });
    }
  }
);

apiRouter.post(
  '/system/pre-update-check',
  requireAuth,
  requireRole(['ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const currentVersion = String(req.body?.currentVersion || process.env.npm_package_version || '1.0.0');
      const targetVersion = String(req.body?.targetVersion || currentVersion);
      const outcome = await prepareSafeApplicationUpdate(sqlite, backupManager, {
        currentVersion,
        targetVersion,
      });

      await logAudit({
        userId: req.user!.id,
        userName: req.user!.fullName,
        action: outcome.allowed ? 'PRE_UPDATE_CHECK_PASSED' : 'PRE_UPDATE_CHECK_BLOCKED',
        entityType: 'SYSTEM',
        details: outcome.allowed
          ? `نجح فحص ما قبل التحديث (${currentVersion} -> ${targetVersion}) مع إنشاء نسخة احتياطية موثقة`
          : `تم منع التحديث بسبب عمليات مالية غير مكتملة: ${outcome.blockingReasons.join(' | ')}`,
        ipAddress: req.ip,
      });

      if (!outcome.allowed) {
        return res.status(409).json(outcome);
      }
      res.json(outcome);
    } catch (error: any) {
      res.status(500).json({ error: sanitizeErrorMessage(error) || 'فشل فحص ما قبل التحديث' });
    }
  }
);

// Seed / Sync Grine Restaurant Menu (ADMIN ONLY + Explicit Confirmation + Non-Destructive)
apiRouter.post('/menu/reset-grine', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const confirmToken = req.body?.confirm;
    if (confirmToken !== 'CONFIRM_MENU_RESET') {
      return res.status(400).json({
        error: 'يرجى تأكيد العملية عبر إرسال رمز التأكيد CONFIRM_MENU_RESET',
      });
    }

    const { seedGrineRestaurantMenu } = await import('../db/seedGrine.ts');
    await seedGrineRestaurantMenu();

    await logAudit({
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: 'RESET_GRINE_MENU',
      entityType: 'MENU',
      details: 'مزامنة وتحديث قائمة Grine Restaurant بشكل آمن دون المساس بسجل الطلبات والمدفوعات',
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'تم تحديث ومزامنة قائمة Grine Restaurant بنجاح دون المساس بسجل الفواتير!' });
  } catch (error: any) {
    logStructuredError('RESET_GRINE_MENU', error, req);
    res.status(500).json({ error: 'فشل إعادة ضبط القائمة' });
  }
});

// Centralized 404 & Error Handlers for /api/* (ensures clean JSON contracts on unmatched routes or malformed requests)
apiRouter.use(apiNotFoundHandler);
apiRouter.use(apiErrorHandler);

