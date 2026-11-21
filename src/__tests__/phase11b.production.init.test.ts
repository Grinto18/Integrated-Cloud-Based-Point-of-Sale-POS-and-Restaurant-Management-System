// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { removeIsolatedTestDir } from './testCleanup.ts';

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase11b_prod_'));
const PROD_DB_PATH = path.join(TEST_ROOT, 'golden_palace_production.db');
const PROD_BACKUP_DIR = path.join(TEST_ROOT, 'backups_production');
const DEV_DB_PATH = path.join(TEST_ROOT, 'golden_palace.db');

process.env.SQLITE_DB_PATH = PROD_DB_PATH;
process.env.GOLDEN_PALACE_BACKUP_DIR = PROD_BACKUP_DIR;
process.env.GOLDEN_PALACE_DB_MODE = 'production';
process.env.JWT_SECRET = 'phase11b_production_secret_key_at_least_32_chars_long';

describe('Golden Palace POS — Phase 11-B Fresh Production Database Initialization', () => {
  beforeAll(() => {
    // Create a canary pre-existing dev DB in the same root to prove production init never touches/overwrites it
    const canary = new Database(DEV_DB_PATH);
    canary.exec('CREATE TABLE IF NOT EXISTS canary (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO canary (label) VALUES (\'dev-untouched\');');
    canary.close();
  });

  afterAll(async () => {
    const dbMod = await import('../db/index.ts');
    dbMod.closeDatabase();
    removeIsolatedTestDir(TEST_ROOT);
  });

  beforeEach(async () => {
    const rateMod = await import('../middleware/rateLimit.ts');
    rateMod.clearRateLimitsForTest?.();
  });

  it('1. Path separation: production & Electron enforce golden_palace_production.db and never fall back to golden_palace.db', async () => {
    const {
      DEV_DB_FILENAME,
      PRODUCTION_DB_FILENAME,
      getLocalDatabasePath,
      getBackupDirectory,
    } = await import('../db/sqlitePath.ts');

    expect(DEV_DB_FILENAME).toBe('golden_palace.db');
    expect(PRODUCTION_DB_FILENAME).toBe('golden_palace_production.db');

    const prevSqlPath = process.env.SQLITE_DB_PATH;
    const prevBackupDir = process.env.GOLDEN_PALACE_BACKUP_DIR;
    const prevMode = process.env.GOLDEN_PALACE_DB_MODE;
    const prevXdg = process.env.XDG_DATA_HOME;

    try {
      delete process.env.SQLITE_DB_PATH;
      delete process.env.GOLDEN_PALACE_BACKUP_DIR;
      process.env.XDG_DATA_HOME = TEST_ROOT;

      process.env.GOLDEN_PALACE_DB_MODE = 'production';
      const resolvedProd = getLocalDatabasePath();
      const resolvedProdBackup = getBackupDirectory();
      expect(path.basename(resolvedProd)).toBe('golden_palace_production.db');
      expect(path.basename(resolvedProdBackup)).toBe('backups_production');
      expect(resolvedProd).not.toContain(process.cwd());

      delete process.env.GOLDEN_PALACE_DB_MODE;
      const savedNodeEnv = process.env.NODE_ENV;
      const savedDesktop = process.env.GOLDEN_PALACE_DESKTOP;
      process.env.NODE_ENV = 'development';
      delete process.env.GOLDEN_PALACE_DESKTOP;
      const resolvedDev = getLocalDatabasePath();
      const resolvedDevBackup = getBackupDirectory();
      expect(path.basename(resolvedDev)).toBe('golden_palace.db');
      expect(path.basename(resolvedDevBackup)).toBe('backups');

      if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
      if (savedDesktop !== undefined) process.env.GOLDEN_PALACE_DESKTOP = savedDesktop;
    } finally {
      if (prevSqlPath !== undefined) process.env.SQLITE_DB_PATH = prevSqlPath;
      if (prevBackupDir !== undefined) process.env.GOLDEN_PALACE_BACKUP_DIR = prevBackupDir;
      if (prevMode !== undefined) process.env.GOLDEN_PALACE_DB_MODE = prevMode;
      if (prevXdg !== undefined) process.env.XDG_DATA_HOME = prevXdg;
      else delete process.env.XDG_DATA_HOME;
    }

    const electronMain = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
    expect(electronMain).toContain('golden_palace_production.db');
    expect(electronMain).toContain('backups_production');
    expect(electronMain).toContain("GOLDEN_PALACE_DB_MODE: 'production'");
  });

  it('2. Initializes clean golden_palace_production.db with full schema, WAL, FK checks, integrity_check=ok, 0600 perms, and zero demo rows', async () => {
    const {
      initializeFreshProductionDatabase,
      EXPECTED_PRODUCTION_TABLES,
      ZERO_COUNT_REQUIRED_TABLES,
    } = await import('../db/initProductionDb.ts');

    const isolatedProdPath = path.join(TEST_ROOT, 'fresh_only', 'golden_palace_production.db');
    const report = await initializeFreshProductionDatabase(isolatedProdPath);

    expect(report.integrityCheck).toBe('ok');
    expect(report.journalMode).toBe('wal');
    expect(report.foreignKeysEnabled).toBe(true);
    expect(report.foreignKeyViolations).toEqual([]);
    expect(report.missingTables).toEqual([]);
    expect(report.tables.length).toBeGreaterThanOrEqual(EXPECTED_PRODUCTION_TABLES.length);
    expect(report.allInitialCountsZero).toBe(true);
    for (const tbl of ZERO_COUNT_REQUIRED_TABLES) {
      expect(report.counts[tbl]).toBe(0);
    }
    if (process.platform !== 'win32') {
      expect(report.fileModeOctal).toBe('0600');
    }

    // Verify canary dev database was completely untouched
    const canaryCheck = new Database(DEV_DB_PATH, { readonly: true });
    const row = canaryCheck.prepare('SELECT label FROM canary WHERE id = 1').get() as { label: string };
    expect(row.label).toBe('dev-untouched');
    canaryCheck.close();
  });

  it('3. First-run admin setup creates owner securely, logs INITIAL_ADMIN_SETUP, seeds zero demo catalog/tables, and locks setup', async () => {
    const dbMod = await import('../db/index.ts');
    const sqlite = dbMod.reopenDatabase(PROD_DB_PATH);
    const { runFirstRunDatabaseAudit } = await import('../services/desktopLifecycle.ts');
    const auditInit = runFirstRunDatabaseAudit(sqlite);

    expect(auditInit.integrityCheck).toBe('ok');
    expect(auditInit.usersCount).toBe(0);
    expect(auditInit.needsInitialAdminSetup).toBe(true);

    const { apiRouter } = await import('../server/api.ts');
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    const statusBefore = await request(app).get('/api/system/first-run-status');
    expect(statusBefore.status).toBe(200);
    expect(statusBefore.body.needsInitialAdminSetup).toBe(true);
    expect(statusBefore.body.usersCount).toBe(0);

    // Reject weak PIN and short password
    const badSetup = await request(app).post('/api/system/setup-admin').send({
      fullName: 'Owner Test',
      username: 'owner_prod',
      password: '123',
      pin: '1234',
    });
    expect(badSetup.status).toBe(400);

    // Valid first-run setup
    const okSetup = await request(app).post('/api/system/setup-admin').send({
      fullName: 'مالك القصر الذهبي',
      username: 'owner_prod',
      email: 'owner@goldenpalace.dz',
      password: 'VeryStrongProdPassword!2026',
      pin: '7391',
    });
    expect(okSetup.status).toBe(201);
    expect(okSetup.body.token).toBeTruthy();
    expect(okSetup.body.user.role).toBe('ADMIN');
    expect(okSetup.body.user.passwordHash).toBeUndefined();

    // Verify hashes stored (no plaintext) & ZERO demo categories/products/tables injected
    const dbUser = sqlite.prepare('SELECT password_hash, pin FROM users WHERE username = ?').get('owner_prod') as any;
    expect(dbUser.password_hash).toMatch(/^\$2[aby]\$/);
    expect(dbUser.pin).toMatch(/^\$2[aby]\$/);
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM categories').get() as any).c).toBe(0);
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM products').get() as any).c).toBe(0);
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM restaurant_tables').get() as any).c).toBe(0);
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c).toBe(0);

    const auditRow = sqlite.prepare("SELECT action, entity_type FROM audit_logs WHERE action = 'INITIAL_ADMIN_SETUP'").get() as any;
    expect(auditRow).toBeTruthy();
    expect(auditRow.entity_type).toBe('USER');

    // Second setup-admin MUST return 409 Conflict
    const secondAttempt = await request(app).post('/api/system/setup-admin').send({
      fullName: 'Intruder',
      username: 'intruder',
      password: 'VeryStrongProdPassword!2026',
      pin: '8426',
    });
    expect(secondAttempt.status).toBe(409);

    // Refuses overwrite if initializeFreshProductionDatabase is invoked on already-initialized DB
    const { initializeFreshProductionDatabase } = await import('../db/initProductionDb.ts');
    await expect(initializeFreshProductionDatabase(PROD_DB_PATH)).rejects.toThrow(/Refusing to overwrite/);
  });

  it('4. Backup and restore work reliably against the fresh production database', async () => {
    const { backupManager } = await import('../services/backupService.ts');
    const created = await backupManager.createBackup('MANUAL', { skipRetention: true });
    expect(created.status).toBe('VERIFIED');
    expect(created.integrityCheck).toBe('ok');
    expect(created.recordCounts?.users).toBe(1);
    expect(created.recordCounts?.orders).toBe(0);

    const verified = backupManager.verifyExistingBackup(created.filename);
    expect(verified.valid).toBe(true);
    expect(verified.integrityCheck).toBe('ok');

    const restored = await backupManager.restoreBackup(created.filename);
    expect(restored.success).toBe(true);
    expect(restored.postRestoreVerification.valid).toBe(true);
    expect(restored.postRestoreVerification.integrityCheck).toBe('ok');
  });
});
