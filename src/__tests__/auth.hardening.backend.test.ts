// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_auth_hardening_'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'hardening_isolated.db');
process.env.SQLITE_DB_PATH = TEST_DB_PATH;

let app: express.Express;
let sqlite: any;
let db: any;
let isBcryptHash: (v: string | null | undefined) => boolean;
let migratePlaintextPins: () => number;
let usersTable: any;
let auditLogsTable: any;
let eqFn: any;
let signUserToken: any;
let getJwtSecret: () => string;
let clearRevokedTokensForTest: () => void;
let clearRateLimitsForTest: () => void;

describe('Golden Palace POS — Auth Hardening Backend Security Tests', () => {
  beforeAll(async () => {
    const dbMod = await import('../db/index.ts');
    sqlite = dbMod.sqlite;
    db = dbMod.db;
    isBcryptHash = dbMod.isBcryptHash;
    migratePlaintextPins = dbMod.migratePlaintextPins;

    // Never touch production DB
    expect(sqlite.name).toBe(TEST_DB_PATH);
    expect(sqlite.name).not.toContain('Golden Palace POS');
    expect(sqlite.name).not.toContain('golden_palace.db');

    const schemaMod = await import('../db/schema.ts');
    usersTable = schemaMod.users;
    auditLogsTable = schemaMod.auditLogs;

    const ormMod = await import('drizzle-orm');
    eqFn = ormMod.eq;

    const { seedDatabase } = await import('../db/seed.ts');
    await seedDatabase();

    const authMod = await import('../middleware/auth.ts');
    signUserToken = authMod.signUserToken;
    getJwtSecret = authMod.getJwtSecret;
    clearRevokedTokensForTest = authMod.clearRevokedTokensForTest;

    const rateMod = await import('../middleware/rateLimit.ts');
    clearRateLimitsForTest = rateMod.clearRateLimitsForTest;

    const { apiRouter } = await import('../server/api.ts');
    app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
  });

  beforeEach(() => {
    clearRevokedTokensForTest();
    clearRateLimitsForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    try {
      sqlite?.close();
    } catch {
      // ignore
    }
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  describe('1. Bcrypt PIN Hashing & Safe Migration', () => {
    it('stores bcrypt hashes (never plaintext PINs) in seeded DB, /api/users, and /api/backups/export', async () => {
      const dbUsers = await db.select().from(usersTable);
      expect(dbUsers.length).toBeGreaterThanOrEqual(6);
      for (const u of dbUsers) {
        if (u.pin) {
          expect(isBcryptHash(u.pin)).toBe(true);
          expect(u.pin).not.toBe('1234');
          expect(u.pin).not.toBe('1111');
          expect(u.pin).not.toBe('4444');
        }
      }

      const adminLogin = await request(app).post('/api/auth/pin-login').send({ pin: '1234' });
      expect(adminLogin.status).toBe(200);
      const adminToken = adminLogin.body.token;

      const usersRes = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(usersRes.status).toBe(200);
      for (const u of usersRes.body) {
        expect(u.pin).toBeUndefined();
        expect(u.passwordHash).toBeUndefined();
        expect(typeof u.hasPin).toBe('boolean');
      }

      const backupRes = await request(app)
        .get('/api/backups/export')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(backupRes.status).toBe(200);
      for (const u of backupRes.body.users) {
        expect(u.pin).toBeUndefined();
        expect(u.passwordHash).toBeUndefined();
        expect(typeof u.hasPin).toBe('boolean');
      }
    });

    it('hashes PINs on user creation/update and prevents duplicate PIN collisions', async () => {
      const adminLogin = await request(app).post('/api/auth/pin-login').send({ pin: '1234' });
      const adminToken = adminLogin.body.token;

      // Duplicate PIN with existing Admin ('1234') must be rejected
      const dupRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'dup_pin_user',
          email: 'dup@goldenpalace.dz',
          password: 'Password123!',
          pin: '1234',
          fullName: 'Duplicate Pin',
          role: 'CASHIER',
        });
      expect(dupRes.status).toBe(409);

      // Unique PIN succeeds, is hashed in DB, omitted from response, and works for PIN login
      const createRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'hashed_pin_staff',
          email: 'hashed@goldenpalace.dz',
          password: 'Password123!',
          pin: '8520',
          fullName: 'موظف برمز مشفر',
          role: 'CASHIER',
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.pin).toBeUndefined();
      expect(createRes.body.passwordHash).toBeUndefined();
      expect(createRes.body.hasPin).toBe(true);

      const createdDb = await db.select().from(usersTable).where(eqFn(usersTable.username, 'hashed_pin_staff'));
      expect(isBcryptHash(createdDb[0].pin)).toBe(true);
      expect(createdDb[0].pin).not.toBe('8520');

      const pinLoginRes = await request(app).post('/api/auth/pin-login').send({ pin: '8520' });
      expect(pinLoginRes.status).toBe(200);
      expect(pinLoginRes.body.user.username).toBe('hashed_pin_staff');
    });

    it('migrates legacy plaintext PINs via migratePlaintextPins() and lazily on verification without locking out users', async () => {
      // Simulate legacy plaintext rows in DB
      await db.insert(usersTable).values({
        uid: 'legacy-plain-1',
        username: 'legacy_staff_1',
        email: 'legacy1@goldenpalace.dz',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
        pin: '5678',
        fullName: 'Legacy User 1',
        role: 'WAITER',
        isActive: true,
      });

      const migratedCount = migratePlaintextPins();
      expect(migratedCount).toBe(1);

      const afterMigration = await db
        .select()
        .from(usersTable)
        .where(eqFn(usersTable.username, 'legacy_staff_1'));
      expect(isBcryptHash(afterMigration[0].pin)).toBe(true);

      // Existing user can still log in with original PIN '5678' after migration
      const loginAfterMig = await request(app).post('/api/auth/pin-login').send({ pin: '5678' });
      expect(loginAfterMig.status).toBe(200);
      expect(loginAfterMig.body.user.username).toBe('legacy_staff_1');

      // Also verify lazy migration fallback if a plaintext row was inserted after startup
      await db.insert(usersTable).values({
        uid: 'legacy-plain-2',
        username: 'legacy_staff_2',
        email: 'legacy2@goldenpalace.dz',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
        pin: '6789',
        fullName: 'Legacy User 2',
        role: 'CASHIER',
        isActive: true,
      });

      const lazyLogin = await request(app).post('/api/auth/pin-login').send({ pin: '6789' });
      expect(lazyLogin.status).toBe(200);
      expect(lazyLogin.body.user.username).toBe('legacy_staff_2');

      const upgradedRow = await db
        .select()
        .from(usersTable)
        .where(eqFn(usersTable.username, 'legacy_staff_2'));
      expect(isBcryptHash(upgradedRow[0].pin)).toBe(true);
    });
  });

  describe('2. Production JWT Secret Enforcement', () => {
    it('throws in production when JWT_SECRET is missing, short, or a known insecure default, and accepts strong secrets', () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.JWT_SECRET;

      try {
        process.env.NODE_ENV = 'production';

        delete process.env.JWT_SECRET;
        expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);

        process.env.JWT_SECRET = 'too-short-secret';
        expect(() => getJwtSecret()).toThrow(/at least 32/);

        process.env.JWT_SECRET = 'golden-palace-pos-super-secure-key-2026';
        expect(() => getJwtSecret()).toThrow(/insecure default/);

        process.env.JWT_SECRET = 'a9f8d7c6b5e4a39281706f5e4d3c2b1a0987654321fedcba';
        expect(getJwtSecret()).toBe('a9f8d7c6b5e4a39281706f5e4d3c2b1a0987654321fedcba');
      } finally {
        if (origNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = origNodeEnv;
        if (origSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = origSecret;
      }
    });

    it('uses a random non-hardcoded secret in non-production when JWT_SECRET is unset', () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.JWT_SECRET;
      try {
        process.env.NODE_ENV = 'test';
        delete process.env.JWT_SECRET;
        const devSecret = getJwtSecret();
        expect(devSecret.length).toBeGreaterThanOrEqual(32);
        expect(devSecret).not.toBe('golden-palace-pos-super-secure-key-2026');
      } finally {
        if (origNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = origNodeEnv;
        if (origSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = origSecret;
      }
    });

    it('Cloud Run production fails fast on missing, short, low-entropy, or insecure JWT_SECRET and NEVER generates per-container secrets', async () => {
      const { ensureServerRuntimeJwtSecret } = await import('../middleware/auth.ts');
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.JWT_SECRET;
      const origSecretFile = process.env.JWT_SECRET_FILE;
      const origDesktop = process.env.GOLDEN_PALACE_DESKTOP;
      const origDbPath = process.env.SQLITE_DB_PATH;
      const tempCloudRunDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_cloudrun_jwt_'));

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.GOLDEN_PALACE_DESKTOP;
        delete process.env.JWT_SECRET_FILE;
        process.env.SQLITE_DB_PATH = path.join(tempCloudRunDir, 'golden_palace_production.db');

        // 1. Missing JWT_SECRET in Cloud Run production -> throws & does NOT write .jwt_secret
        delete process.env.JWT_SECRET;
        expect(() => ensureServerRuntimeJwtSecret()).toThrow(/JWT_SECRET/);
        expect(fs.existsSync(path.join(tempCloudRunDir, '.jwt_secret'))).toBe(false);

        // 2. Short JWT_SECRET -> throws & does NOT write .jwt_secret
        process.env.JWT_SECRET = 'short-secret';
        expect(() => ensureServerRuntimeJwtSecret()).toThrow(/at least 32/);
        expect(fs.existsSync(path.join(tempCloudRunDir, '.jwt_secret'))).toBe(false);

        // 3. Low-entropy repeated char secret -> throws & does NOT write .jwt_secret
        process.env.JWT_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        expect(() => ensureServerRuntimeJwtSecret()).toThrow(/insufficient entropy/);
        expect(fs.existsSync(path.join(tempCloudRunDir, '.jwt_secret'))).toBe(false);

        // 4. Known insecure secret -> throws
        process.env.JWT_SECRET = 'grine-restaurant-pos-super-secure-key';
        expect(() => ensureServerRuntimeJwtSecret()).toThrow(/insecure default/);

        // 5. Independent Container Instances A and B both fail instead of silently generating incompatible secrets
        for (const instanceId of ['container-a', 'container-b']) {
          const instanceDir = path.join(tempCloudRunDir, instanceId);
          fs.mkdirSync(instanceDir, { recursive: true });
          process.env.SQLITE_DB_PATH = path.join(instanceDir, 'golden_palace_production.db');
          delete process.env.JWT_SECRET;
          expect(() => ensureServerRuntimeJwtSecret()).toThrow(/JWT_SECRET/);
          expect(fs.existsSync(path.join(instanceDir, '.jwt_secret'))).toBe(false);
        }

        // 6. Real server.ts subprocess fails fast (exit code !== 0) when Cloud Run JWT_SECRET is missing or short
        const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx');
        const serverProcMissing = spawnSync(tsxBin, ['server.ts'], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_ENV: 'production',
            SQLITE_DB_PATH: path.join(tempCloudRunDir, 'sub_missing.db'),
            JWT_SECRET: '',
          },
          encoding: 'utf8',
          timeout: 15000,
        });
        expect(serverProcMissing.status).toBe(1);
        expect(serverProcMissing.stderr).toContain('CRITICAL SECURITY ERROR');

        const serverProcShort = spawnSync(tsxBin, ['server.ts'], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_ENV: 'production',
            SQLITE_DB_PATH: path.join(tempCloudRunDir, 'sub_short.db'),
            JWT_SECRET: 'too_short_cloud_run_secret',
          },
          encoding: 'utf8',
          timeout: 15000,
        });
        expect(serverProcShort.status).toBe(1);
        expect(serverProcShort.stderr).toContain('at least 32');

        // 7. Stable valid JWT_SECRET via env & Google Secret Manager file (JWT_SECRET_FILE)
        const stableCloudRunSecret = 'cloud_run_stable_secret_manager_key_48_bytes_991122334455';
        process.env.JWT_SECRET = stableCloudRunSecret;
        expect(ensureServerRuntimeJwtSecret()).toBe(stableCloudRunSecret);
        expect(getJwtSecret()).toBe(stableCloudRunSecret);

        delete process.env.JWT_SECRET;
        const secretMountPath = path.join(tempCloudRunDir, 'gsm_jwt_secret');
        fs.writeFileSync(secretMountPath, `${stableCloudRunSecret}\n`, { mode: 0o600 });
        process.env.JWT_SECRET_FILE = secretMountPath;
        expect(ensureServerRuntimeJwtSecret()).toBe(stableCloudRunSecret);
        expect(getJwtSecret()).toBe(stableCloudRunSecret);
      } finally {
        fs.rmSync(tempCloudRunDir, { recursive: true, force: true });
        if (origNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = origNodeEnv;
        if (origSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = origSecret;
        if (origSecretFile === undefined) delete process.env.JWT_SECRET_FILE;
        else process.env.JWT_SECRET_FILE = origSecretFile;
        if (origDesktop === undefined) delete process.env.GOLDEN_PALACE_DESKTOP;
        else process.env.GOLDEN_PALACE_DESKTOP = origDesktop;
        if (origDbPath === undefined) delete process.env.SQLITE_DB_PATH;
        else process.env.SQLITE_DB_PATH = origDbPath;
      }
    });

    it('Electron desktop preserves CSPRNG .jwt_secret with 0600 permissions, persists across restarts, and never exposes secret to renderer', async () => {
      const { ensureServerRuntimeJwtSecret } = await import('../middleware/auth.ts');
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.JWT_SECRET;
      const origDesktop = process.env.GOLDEN_PALACE_DESKTOP;
      const origDbPath = process.env.SQLITE_DB_PATH;
      const tempElectronUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_electron_jwt_'));

      try {
        process.env.NODE_ENV = 'production';
        process.env.GOLDEN_PALACE_DESKTOP = '1';
        process.env.SQLITE_DB_PATH = path.join(tempElectronUserData, 'golden_palace_production.db');
        delete process.env.JWT_SECRET;

        // 1. First desktop launch creates persistent CSPRNG .jwt_secret with 0600 mode
        const firstLaunchSecret = ensureServerRuntimeJwtSecret();
        expect(firstLaunchSecret.length).toBeGreaterThanOrEqual(96);
        expect(new Set(firstLaunchSecret).size).toBeGreaterThanOrEqual(12);
        const secretPath = path.join(tempElectronUserData, '.jwt_secret');
        expect(fs.existsSync(secretPath)).toBe(true);
        if (process.platform !== 'win32') {
          const modeOctal = '0' + (fs.statSync(secretPath).mode & 0o777).toString(8);
          expect(modeOctal).toBe('0600');
        }

        const preRestartToken = jwt.sign({ id: 1, role: 'ADMIN' }, firstLaunchSecret, { expiresIn: '1h' });

        // 2. Second Electron launch / restart loads identical secret and verifies pre-restart JWTs
        delete process.env.JWT_SECRET;
        const secondLaunchSecret = ensureServerRuntimeJwtSecret();
        expect(secondLaunchSecret).toBe(firstLaunchSecret);
        const decoded = jwt.verify(preRestartToken, getJwtSecret()) as { id: number; role: string };
        expect(decoded.id).toBe(1);

        // 3. Static inspection: electron/main.cjs and electron/preload.cjs do not leak jwtSecret via IPC
        const mainCjs = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
        const preloadCjs = fs.readFileSync(path.resolve(process.cwd(), 'electron/preload.cjs'), 'utf8');
        expect(mainCjs).toContain('0o600');
        expect(preloadCjs).not.toContain('jwtSecret');
        expect(preloadCjs).not.toContain('JWT_SECRET');
        const infoHandlerMatch = mainCjs.match(/ipcMain\.handle\('desktop:get-info'[\s\S]*?\}\)\);/);
        expect(infoHandlerMatch).toBeTruthy();
        expect(infoHandlerMatch![0]).not.toContain('jwtSecret');
        expect(infoHandlerMatch![0]).not.toContain('JWT_SECRET');
      } finally {
        fs.rmSync(tempElectronUserData, { recursive: true, force: true });
        if (origNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = origNodeEnv;
        if (origSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = origSecret;
        if (origDesktop === undefined) delete process.env.GOLDEN_PALACE_DESKTOP;
        else process.env.GOLDEN_PALACE_DESKTOP = origDesktop;
        if (origDbPath === undefined) delete process.env.SQLITE_DB_PATH;
        else process.env.SQLITE_DB_PATH = origDbPath;
      }
    });
  });

  describe('3. Persistent SQLite Token Revocation Across Restart', () => {
    it('persists revoked tokens in SQLite revoked_tokens table and keeps rejecting old token after module reload', async () => {
      const loginRes = await request(app).post('/api/auth/pin-login').send({ pin: '1234' });
      expect(loginRes.status).toBe(200);
      const oldToken = loginRes.body.token;

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${oldToken}`);
      expect(logoutRes.status).toBe(200);

      const revokedRows = sqlite.prepare('SELECT count(*) as c FROM revoked_tokens').get() as { c: number };
      expect(revokedRows.c).toBeGreaterThanOrEqual(1);

      // Simulate process restart by resetting Vite/Vitest module registry while keeping the same SQLite DB file
      vi.resetModules();
      process.env.SQLITE_DB_PATH = TEST_DB_PATH;
      const restartedApiMod = await import('../server/api.ts');
      const restartedApp = express();
      restartedApp.use(express.json());
      restartedApp.use('/api', restartedApiMod.apiRouter);

      const reuseAfterRestart = await request(restartedApp)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${oldToken}`);
      expect(reuseAfterRestart.status).toBe(401);

      // Fresh login after restart issues a valid new token
      const freshLogin = await request(restartedApp).post('/api/auth/pin-login').send({ pin: '1234' });
      expect(freshLogin.status).toBe(200);
      const meAfterRestart = await request(restartedApp)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${freshLogin.body.token}`);
      expect(meAfterRestart.status).toBe(200);

      // Keep outer handles synced to live DB after resetModules
      const freshDbMod = await import('../db/index.ts');
      sqlite = freshDbMod.sqlite;
      db = freshDbMod.db;
      const freshAuthMod = await import('../middleware/auth.ts');
      signUserToken = freshAuthMod.signUserToken;
      getJwtSecret = freshAuthMod.getJwtSecret;
      clearRevokedTokensForTest = freshAuthMod.clearRevokedTokensForTest;
      const freshRateMod = await import('../middleware/rateLimit.ts');
      clearRateLimitsForTest = freshRateMod.clearRateLimitsForTest;
      app = restartedApp;
    });
  });

  describe('4. Login & PIN Rate Limiting', () => {
    it('blocks repeated failed PIN attempts with 429 + Retry-After and resets counter on valid PIN', async () => {
      // 4 failures then 1 success should reset counter
      for (let i = 0; i < 4; i++) {
        const failRes = await request(app).post('/api/auth/pin-login').send({ pin: '0000' });
        expect(failRes.status).toBe(401);
      }
      const okRes = await request(app).post('/api/auth/pin-login').send({ pin: '1234' });
      expect(okRes.status).toBe(200);

      // Now 5 consecutive failures trigger rate limit on the 6th request
      for (let i = 0; i < 5; i++) {
        const failRes = await request(app).post('/api/auth/pin-login').send({ pin: '0000' });
        expect(failRes.status).toBe(401);
      }

      const blockedRes = await request(app).post('/api/auth/pin-login').send({ pin: '1234' });
      expect(blockedRes.status).toBe(429);
      expect(Number(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('blocks repeated failed password login attempts with 429 + Retry-After', async () => {
      for (let i = 0; i < 5; i++) {
        const failRes = await request(app)
          .post('/api/auth/login')
          .send({ identifier: 'admin', password: `WrongPass${i}` });
        expect(failRes.status).toBe(401);
      }

      const blockedRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'admin', password: 'admin123' });
      expect(blockedRes.status).toBe(429);
      expect(Number(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('5. Server-Side RBAC & Secret Log Redaction', () => {
    it('enforces authentication and strict server-side role permissions across all hardened endpoints', async () => {
      // Unauthenticated requests must be rejected with 401
      const unauthEndpoints = [
        { method: 'get', path: '/api/categories' },
        { method: 'get', path: '/api/products' },
        { method: 'get', path: '/api/tables' },
        { method: 'get', path: '/api/settings' },
        { method: 'get', path: '/api/printer/status' },
        { method: 'post', path: '/api/printer/spool' },
        { method: 'post', path: '/api/menu/reset-grine' },
      ];
      for (const ep of unauthEndpoints) {
        const res = await (request(app) as any)[ep.method](ep.path);
        expect(res.status).toBe(401);
      }

      const allUsers = await db.select().from(usersTable);
      const getTokenFor = (role: string) => {
        const u = allUsers.find((row: any) => row.role === role);
        return signUserToken(u);
      };

      const cashierToken = getTokenFor('CASHIER');
      const kitchenToken = getTokenFor('KITCHEN');
      const inventoryToken = getTokenFor('INVENTORY');
      const managerToken = getTokenFor('MANAGER');

      // CASHIER cannot view financial reports, record expenses, reset menu, export backups, or edit settings
      expect((await request(app).get('/api/reports/dashboard').set('Authorization', `Bearer ${cashierToken}`)).status).toBe(403);
      expect((await request(app).get('/api/reports/sales').set('Authorization', `Bearer ${cashierToken}`)).status).toBe(403);
      expect((await request(app).get('/api/expenses').set('Authorization', `Bearer ${cashierToken}`)).status).toBe(403);
      expect((await request(app).post('/api/menu/reset-grine').set('Authorization', `Bearer ${cashierToken}`)).status).toBe(403);
      expect((await request(app).get('/api/backups/export').set('Authorization', `Bearer ${cashierToken}`)).status).toBe(403);
      expect((await request(app).get('/api/cashier/dashboard').set('Authorization', `Bearer ${cashierToken}`)).status).toBe(200);

      // KITCHEN cannot create orders or take payments, but can read KDS tickets and waste
      expect((await request(app).post('/api/orders').set('Authorization', `Bearer ${kitchenToken}`).send({})).status).toBe(403);
      expect((await request(app).post('/api/payments').set('Authorization', `Bearer ${kitchenToken}`).send({})).status).toBe(403);
      expect((await request(app).get('/api/cash-register/current').set('Authorization', `Bearer ${kitchenToken}`)).status).toBe(403);
      expect((await request(app).get('/api/kitchen/tickets').set('Authorization', `Bearer ${kitchenToken}`)).status).toBe(200);
      expect((await request(app).get('/api/waste').set('Authorization', `Bearer ${kitchenToken}`)).status).toBe(200);

      // INVENTORY cannot read orders or record payments, but can read inventory and suppliers
      expect((await request(app).get('/api/orders').set('Authorization', `Bearer ${inventoryToken}`)).status).toBe(403);
      expect((await request(app).post('/api/payments').set('Authorization', `Bearer ${inventoryToken}`).send({})).status).toBe(403);
      expect((await request(app).get('/api/inventory').set('Authorization', `Bearer ${inventoryToken}`)).status).toBe(200);
      expect((await request(app).get('/api/suppliers').set('Authorization', `Bearer ${inventoryToken}`)).status).toBe(200);

      // MANAGER can access reports & expenses, but NOT ADMIN-only backup/menu-reset
      expect((await request(app).get('/api/reports/sales').set('Authorization', `Bearer ${managerToken}`)).status).toBe(200);
      expect((await request(app).get('/api/expenses').set('Authorization', `Bearer ${managerToken}`)).status).toBe(200);
      expect((await request(app).post('/api/menu/reset-grine').set('Authorization', `Bearer ${managerToken}`)).status).toBe(403);
      expect((await request(app).get('/api/backups/export').set('Authorization', `Bearer ${managerToken}`)).status).toBe(403);
    });

    it('never leaks passwords, PINs, or JWTs into console logs or audit_logs', async () => {
      const capturedLogs: string[] = [];
      const capture = (...args: any[]) => {
        capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      };
      vi.spyOn(console, 'log').mockImplementation(capture);
      vi.spyOn(console, 'warn').mockImplementation(capture);
      vi.spyOn(console, 'error').mockImplementation(capture);

      const secretPin = '1234';
      const secretPass = 'admin123';
      const pinRes = await request(app).post('/api/auth/pin-login').send({ pin: secretPin });
      const passRes = await request(app).post('/api/auth/login').send({ identifier: 'admin', password: secretPass });
      const issuedTokens = [pinRes.body.token, passRes.body.token];

      // Trigger failure & rate-limit & audit log redaction
      for (let i = 0; i < 6; i++) {
        await request(app).post('/api/auth/pin-login').send({ pin: '4321' });
      }
      await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${issuedTokens[0]}`);

      const combinedLogs = capturedLogs.join('\n');
      expect(combinedLogs).not.toContain(secretPin);
      expect(combinedLogs).not.toContain(secretPass);
      expect(combinedLogs).not.toContain('4321');
      for (const tok of issuedTokens) {
        expect(combinedLogs).not.toContain(tok);
      }

      const auditRows = await db.select().from(auditLogsTable);
      const auditText = auditRows.map((r: any) => r.details || '').join('\n');
      expect(auditText).not.toContain(secretPin);
      expect(auditText).not.toContain(secretPass);
      for (const tok of issuedTokens) {
        expect(auditText).not.toContain(tok);
      }
    });
  });

  describe('6. Phase 12-C — Staff Password Policy & Demo Seeding Guards', () => {
    it('rejects short and weak passwords on POST /api/users and PUT /api/users/:id while preserving existing passwords and RBAC', async () => {
      const adminRow = (await db.select().from(usersTable).where(eqFn(usersTable.username, 'admin')))[0];
      const cashierRow = (await db.select().from(usersTable).where(eqFn(usersTable.username, 'caissier1')))[0];
      const adminToken = signUserToken(adminRow);
      const cashierToken = signUserToken(cashierRow);

      // RBAC check: CASHIER still receives 403 on POST/PUT /api/users
      const cashierAttempt = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          username: 'unauth_staff',
          email: 'unauth@goldenpalace.dz',
          fullName: 'Unauth Staff',
          password: 'StrongPassword!99',
          role: 'WAITER',
        });
      expect(cashierAttempt.status).toBe(403);

      // Reject weak / short passwords on creation
      const badPasswords = ['123', '1234567', '        ', '12345678', 'admin123', 'password', 'aaaaaaaa', 'new_staff_1'];
      for (const badPw of badPasswords) {
        const res = await request(app)
          .post('/api/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username: 'new_staff_1',
            email: 'newstaff1@goldenpalace.dz',
            fullName: 'موظف جديد',
            password: badPw,
            role: 'CASHIER',
          });
        expect(res.status).toBe(400);
      }

      // Accept valid strong password on creation and allow login
      const strongInitialPass = 'GoldenStaff#2026';
      const createOk = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'policy_staff_ok',
          email: 'policystaff@goldenpalace.dz',
          fullName: 'موظف سياسة المرور',
          password: strongInitialPass,
          pin: '7349',
          role: 'CASHIER',
        });
      expect(createOk.status).toBe(201);
      expect(createOk.body.passwordHash).toBeUndefined();
      const createdId = createOk.body.id;

      const initialLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'policy_staff_ok', password: strongInitialPass });
      expect(initialLogin.status).toBe(200);

      // Reject weak / short password on PUT /api/users/:id and verify old password remains valid
      for (const weakUpdate of ['short', '   ', '12345678', 'admin123', 'policy_staff_ok']) {
        const putFail = await request(app)
          .put(`/api/users/${createdId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ password: weakUpdate });
        expect(putFail.status).toBe(400);
      }

      const oldPassStillWorks = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'policy_staff_ok', password: strongInitialPass });
      expect(oldPassStillWorks.status).toBe(200);

      // Updating profile with empty password string preserves existing password
      const profileOnlyUpdate = await request(app)
        .put(`/api/users/${createdId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: 'موظف محدث', password: '' });
      expect(profileOnlyUpdate.status).toBe(200);

      const passStillIntact = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'policy_staff_ok', password: strongInitialPass });
      expect(passStillIntact.status).toBe(200);

      // Valid strong password update succeeds and replaces password
      const updatedStrongPass = 'RotatedStaff#2026';
      const putOk = await request(app)
        .put(`/api/users/${createdId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ password: updatedStrongPass });
      expect(putOk.status).toBe(200);

      const oldPassAfterRotate = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'policy_staff_ok', password: strongInitialPass });
      expect(oldPassAfterRotate.status).toBe(401);

      const newPassLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'policy_staff_ok', password: updatedStrongPass });
      expect(newPassLogin.status).toBe(200);
    });

    it('blocks demo user seeding in production/desktop environments and requires explicit dev configuration', async () => {
      const {
        isProductionOrDesktopSeedBlocked,
        isDemoUserSeedingAllowed,
        seedDatabase,
      } = await import('../db/seed.ts');

      // Pure dev runtime requires explicit GOLDEN_PALACE_ALLOW_DEMO_SEED=1 (or allowDemoUsers option)
      expect(isDemoUserSeedingAllowed({}, { NODE_ENV: 'development' })).toBe(false);
      expect(
        isDemoUserSeedingAllowed({}, { NODE_ENV: 'development', GOLDEN_PALACE_ALLOW_DEMO_SEED: '1' })
      ).toBe(true);

      // Production & desktop flags strictly forbid demo seeding even when allowDemoUsers/ALLOW_DEMO_SEED/VITEST are set
      expect(
        isProductionOrDesktopSeedBlocked({ NODE_ENV: 'production' })
      ).toBe(true);
      expect(
        isDemoUserSeedingAllowed(
          { allowDemoUsers: true },
          { NODE_ENV: 'production', GOLDEN_PALACE_ALLOW_DEMO_SEED: '1', VITEST: 'true' }
        )
      ).toBe(false);
      expect(
        isDemoUserSeedingAllowed(
          { allowDemoUsers: true },
          { NODE_ENV: 'development', GOLDEN_PALACE_DESKTOP: '1', VITEST: 'true' }
        )
      ).toBe(false);
      expect(
        isDemoUserSeedingAllowed(
          { allowDemoUsers: true },
          { NODE_ENV: 'development', GOLDEN_PALACE_DB_MODE: 'production', VITEST: 'true' }
        )
      ).toBe(false);

      // Runtime call to seedDatabase() under production/desktop env vars rejects without inserting any users
      const origNodeEnv = process.env.NODE_ENV;
      const origDesktop = process.env.GOLDEN_PALACE_DESKTOP;
      const origDbMode = process.env.GOLDEN_PALACE_DB_MODE;
      const beforeUsersCount = (sqlite.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;

      try {
        process.env.NODE_ENV = 'production';
        await expect(seedDatabase({ allowDemoUsers: true })).rejects.toThrow(/SECURITY_BLOCK/);

        process.env.NODE_ENV = 'test';
        process.env.GOLDEN_PALACE_DESKTOP = '1';
        await expect(seedDatabase({ allowDemoUsers: true })).rejects.toThrow(/SECURITY_BLOCK/);

        delete process.env.GOLDEN_PALACE_DESKTOP;
        process.env.GOLDEN_PALACE_DB_MODE = 'production';
        await expect(seedDatabase({ allowDemoUsers: true })).rejects.toThrow(/SECURITY_BLOCK/);
      } finally {
        if (origNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = origNodeEnv;
        if (origDesktop === undefined) delete process.env.GOLDEN_PALACE_DESKTOP;
        else process.env.GOLDEN_PALACE_DESKTOP = origDesktop;
        if (origDbMode === undefined) delete process.env.GOLDEN_PALACE_DB_MODE;
        else process.env.GOLDEN_PALACE_DB_MODE = origDbMode;
      }

      const afterUsersCount = (sqlite.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
      expect(afterUsersCount).toBe(beforeUsersCount);
    });
  });
});

