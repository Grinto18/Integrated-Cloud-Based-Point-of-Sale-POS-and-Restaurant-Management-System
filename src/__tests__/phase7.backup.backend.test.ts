// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';

const TEST_ROOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase7_backend_'));
const TEST_DB_PATH = path.join(TEST_ROOT_DIR, 'phase7_isolated.db');
const TEST_BACKUP_DIR = path.join(TEST_ROOT_DIR, 'isolated_backups');

process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.GOLDEN_PALACE_BACKUP_DIR = TEST_BACKUP_DIR;

let app: express.Express;
let sqlite: Database.Database;
let dbMod: typeof import('../db/index.ts');
let backupMod: typeof import('../services/backupService.ts');
let backupManager: InstanceType<typeof import('../services/backupService.ts').BackupManager>;
let signUserToken: any;
let clearRateLimitsForTest: any;

let adminToken: string;
let cashierToken: string;

async function bootstrapServer() {
  dbMod = await import('../db/index.ts');
  sqlite = dbMod.sqlite;

  const { seedDatabase } = await import('../db/seed.ts');
  await seedDatabase();

  backupMod = await import('../services/backupService.ts');
  backupManager = backupMod.backupManager;

  const authMod = await import('../middleware/auth.ts');
  signUserToken = authMod.signUserToken;

  const rateMod = await import('../middleware/rateLimit.ts');
  clearRateLimitsForTest = rateMod.clearRateLimitsForTest;

  const { apiRouter } = await import('../server/api.ts');
  const nextApp = express();
  nextApp.use(express.json());
  nextApp.use('/api', apiRouter);
  app = nextApp;

  const makeToken = (u: any) =>
    signUserToken({
      id: u.id,
      uid: u.uid,
      username: u.username,
      email: u.email,
      role: u.role,
      fullName: u.full_name,
    });

  const adminRow = sqlite.prepare("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1").get() as any;
  adminToken = makeToken(adminRow);

  let cashierRow = sqlite.prepare("SELECT * FROM users WHERE role = 'CASHIER' LIMIT 1").get() as any;
  if (!cashierRow) {
    const info = sqlite
      .prepare(
        `INSERT INTO users (uid, username, email, password_hash, role, full_name, is_active)
         VALUES ('uid-cash-p7', 'cashier_p7', 'cashier_p7@test.local', 'hash', 'CASHIER', 'كاشير 7', 1)`
      )
      .run();
    cashierRow = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }
  cashierToken = makeToken(cashierRow);
}

describe('Golden Palace POS — Phase 07 Backup & Disaster Recovery Tests (Backend)', () => {
  beforeAll(async () => {
    await bootstrapServer();
    // Strict safety isolation check: never use production DB path
    expect(dbMod.sqlite.name).toBe(TEST_DB_PATH);
    expect(dbMod.sqlite.name).not.toContain('golden_palace.db');
  });

  beforeEach(() => {
    clearRateLimitsForTest?.();
  });

  afterAll(() => {
    try {
      backupManager?.stopScheduler();
    } catch {
      // ignore
    }
    try {
      dbMod?.closeDatabase();
    } catch {
      // ignore
    }
    fs.rmSync(TEST_ROOT_DIR, { recursive: true, force: true });
  });

  describe('TASK 01 & 02 & 04: Backup Creation, WAL Consistency, Verification & Retention', () => {
    it('Scenario 1 & 6: creates a verified backup via SQLite Backup API including uncommitted WAL transactions and restricts directory/file permissions', async () => {
      // Ensure WAL mode and write uncommitted/un-checkpointed WAL transactions
      expect(String(dbMod.sqlite.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');

      const ingredient = dbMod.sqlite.prepare('SELECT id, current_stock FROM ingredients LIMIT 1').get() as any;
      const product = dbMod.sqlite.prepare('SELECT id, name_ar, price FROM products LIMIT 1').get() as any;
      const adminUser = dbMod.sqlite.prepare("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1").get() as any;
      expect(ingredient).toBeTruthy();
      expect(product).toBeTruthy();

      const uniqueOrderNum = `BON-WAL-${Date.now()}`;
      const orderRes = dbMod.sqlite
        .prepare(
          `INSERT INTO orders (order_number, daily_sequence, type, status, subtotal, total, paid_amount, payment_status, cashier_id)
           VALUES (?, 701, 'TAKEAWAY', 'COMPLETED', 1500, 1500, 1500, 'PAID', ?)`
        )
        .run(uniqueOrderNum, adminUser.id);
      const orderId = Number(orderRes.lastInsertRowid);

      dbMod.sqlite
        .prepare(
          `INSERT INTO order_items (order_id, product_id, name_ar, unit_price, quantity, total, station, status)
           VALUES (?, ?, ?, 1500, 1, 1500, 'MAIN_KITCHEN', 'COMPLETED')`
        )
        .run(orderId, product.id, product.name_ar);

      dbMod.sqlite
        .prepare(
          `INSERT INTO payments (order_id, method, amount, tender_amount, change_amount, cashier_id)
           VALUES (?, 'CASH', 1500, 2000, 500, ?)`
        )
        .run(orderId, adminUser.id);

      const entry = await backupManager.createBackup('MANUAL');
      expect(entry.status).toBe('VERIFIED');
      expect(entry.integrityCheck).toBe('ok');
      expect(entry.sizeBytes).toBeGreaterThan(0);
      expect(entry.recordCounts?.orders).toBeGreaterThanOrEqual(1);
      expect(entry.recordCounts?.payments).toBeGreaterThanOrEqual(1);

      const backupPath = backupManager.resolveSafeBackupPath(entry.filename);
      expect(fs.existsSync(backupPath)).toBe(true);
      expect(path.dirname(backupPath)).toBe(path.resolve(TEST_BACKUP_DIR));

      if (process.platform !== 'win32') {
        const dirMode = fs.statSync(TEST_BACKUP_DIR).mode & 0o777;
        const fileMode = fs.statSync(backupPath).mode & 0o777;
        expect(dirMode).toBe(0o700);
        expect(fileMode).toBe(0o600);
      }

      // Open the standalone backup file read-only (no WAL sidecar) and confirm WAL order is inside
      const checkDb = new Database(backupPath, { readonly: true });
      const backedUpOrder = checkDb
        .prepare('SELECT order_number, total FROM orders WHERE order_number = ?')
        .get(uniqueOrderNum) as any;
      checkDb.close();

      expect(backedUpOrder).toBeTruthy();
      expect(Number(backedUpOrder.total)).toBe(1500);
    });

    it('Scenario 4: cleans up temp artifacts on interrupted backup and never marks a failed backup as VERIFIED', async () => {
      const beforeVerifiedCount = backupManager.listBackups().filter((b) => b.status === 'VERIFIED').length;

      await expect(
        backupManager.createBackup('MANUAL', {
          simulateInterruptionHook: () => {
            throw new Error('SIMULATED_PROCESS_INTERRUPTION');
          },
        })
      ).rejects.toThrow(/SIMULATED_PROCESS_INTERRUPTION/);

      const filesInDir = fs.readdirSync(TEST_BACKUP_DIR);
      expect(filesInDir.some((f) => f.includes('.tmp'))).toBe(false);

      const afterVerifiedCount = backupManager.listBackups().filter((b) => b.status === 'VERIFIED').length;
      expect(afterVerifiedCount).toBe(beforeVerifiedCount);
    });

    it('Scenario 5: detects insufficient disk space before writing and preserves previous healthy backups', async () => {
      const lowSpaceManager = new backupMod.BackupManager({
        getDbPath: () => TEST_DB_PATH,
        getBackupDir: () => TEST_BACKUP_DIR,
        getSqlite: () => dbMod.sqlite,
        closeDb: () => dbMod.closeDatabase(),
        reopenDb: (p) => dbMod.reopenDatabase(p),
        checkFreeBytes: () => 1024, // 1 KB available -> too small
      });

      await expect(lowSpaceManager.createBackup('MANUAL')).rejects.toThrow(/مساحة القرص غير كافية/);
      const healthyBackups = backupManager.listBackups().filter((b) => b.status === 'VERIFIED');
      expect(healthyBackups.length).toBeGreaterThanOrEqual(1);
    });

    it('never deletes the last remaining healthy backup even when retentionCount is minimal (1)', async () => {
      await backupManager.createBackup('DAILY', { skipRetention: true });
      await backupManager.createBackup('WEEKLY', { skipRetention: true });

      const result = backupManager.applyRetentionPolicy(1);
      expect(result.kept.length).toBeGreaterThanOrEqual(1);

      const remainingHealthy = backupManager.listBackups().filter((b) => b.status === 'VERIFIED');
      expect(remainingHealthy.length).toBeGreaterThanOrEqual(1);
    });

    it('creates automatic daily, weekly, and shutdown backups cleanly without duplicating same-day/same-week backups', async () => {
      const sched1 = await backupManager.checkAndRunScheduledBackups({
        autoEnabled: true,
        intervalHours: 1,
        retentionCount: 20,
      });
      // Since a DAILY and WEEKLY backup were created above for today/this week, check zero duplicates created
      expect(sched1.ran.includes('DAILY')).toBe(false);
      expect(sched1.ran.includes('WEEKLY')).toBe(false);

      const shutdownEntry = await backupManager.runShutdownBackup(20);
      expect(shutdownEntry).not.toBeNull();
      expect(shutdownEntry?.type).toBe('SHUTDOWN');
      expect(shutdownEntry?.status).toBe('VERIFIED');
    });
  });

  describe('TASK 03 & 04: Restore Integrity, Corruption Rejection, Point-in-Time & Automatic Rollback', () => {
    it('Scenario 3: rejects corrupted backup files and missing-table SQLite DBs before touching live DB', async () => {
      const corruptFilename = `gp_pos_manual_corrupted_${Date.now()}.db`;
      const corruptPath = path.join(TEST_BACKUP_DIR, corruptFilename);
      fs.writeFileSync(corruptPath, Buffer.from('NOT_A_VALID_SQLITE_HEADER_CORRUPTED_BYTES'), { mode: 0o600 });

      const verifyRes = backupManager.verifyExistingBackup(corruptFilename);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.status).toBe('CORRUPTED');

      const countBefore = (dbMod.sqlite.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c;
      await expect(backupManager.restoreBackup(corruptFilename)).rejects.toThrow();
      const countAfter = (dbMod.sqlite.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c;
      expect(countAfter).toBe(countBefore);

      // Also reject an otherwise valid SQLite DB that is missing required POS tables
      const incompleteFilename = `gp_pos_manual_incomplete_${Date.now()}.db`;
      const incompletePath = path.join(TEST_BACKUP_DIR, incompleteFilename);
      const emptySqlite = new Database(incompletePath);
      emptySqlite.exec('CREATE TABLE dummy (id INTEGER PRIMARY KEY);');
      emptySqlite.close();

      const incompleteVerify = backupManager.verifyExistingBackup(incompleteFilename);
      expect(incompleteVerify.valid).toBe(false);
      expect(incompleteVerify.missingTables.length).toBeGreaterThan(0);

      await expect(backupManager.restoreBackup(incompleteFilename)).rejects.toThrow(/جداول أساسية مفقودة/);

      // Cleanup test corrupted artifacts
      fs.unlinkSync(corruptPath);
      fs.unlinkSync(incompletePath);
    });

    it('Scenario 9: automatically rolls back to PRE_RESTORE snapshot if restore swap fails mid-operation', async () => {
      const safeBackup = await backupManager.createBackup('MANUAL');

      const markerOrderNum = `BON-BEFORE-FAIL-${Date.now()}`;
      const adminRow = dbMod.sqlite.prepare("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1").get() as any;
      dbMod.sqlite
        .prepare(
          `INSERT INTO orders (order_number, daily_sequence, type, status, subtotal, total, paid_amount, payment_status, cashier_id)
           VALUES (?, 901, 'TAKEAWAY', 'NEW', 850, 850, 0, 'UNPAID', ?)`
        )
        .run(markerOrderNum, adminRow.id);

      await expect(
        backupManager.restoreBackup(safeBackup.filename, {
          simulateSwapFailure: () => {
            throw new Error('SIMULATED_DISK_SWAP_FAILURE');
          },
        })
      ).rejects.toThrow(/التراجع تلقائياً/);

      // Live DB must still be open, pass integrity_check, and contain markerOrderNum!
      const integrity = dbMod.sqlite.pragma('integrity_check', { simple: true });
      expect(integrity).toBe('ok');

      const preserved = dbMod.sqlite
        .prepare('SELECT order_number FROM orders WHERE order_number = ?')
        .get(markerOrderNum) as any;
      expect(preserved?.order_number).toBe(markerOrderNum);
    });

    it('Scenario 2, 7 & 8: restores older point-in-time backup accurately preserving orders, payments & inventory counts', async () => {
      const ing = dbMod.sqlite.prepare('SELECT id, current_stock FROM ingredients LIMIT 1').get() as any;
      const adminRow = dbMod.sqlite.prepare("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1").get() as any;
      const product = dbMod.sqlite.prepare('SELECT id, name_ar FROM products LIMIT 1').get() as any;

      const stockAtT1 = Number(ing.current_stock);
      const ordersCountAtT1 = Number((dbMod.sqlite.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c);
      const paymentsCountAtT1 = Number((dbMod.sqlite.prepare('SELECT COUNT(*) as c FROM payments').get() as any).c);

      // Backup T1
      const backupT1 = await backupManager.createBackup('MANUAL');

      // Mutate live DB after T1 (new order, payment, and inventory deduction)
      const postT1OrderNum = `BON-POST-T1-${Date.now()}`;
      const insOrd = dbMod.sqlite
        .prepare(
          `INSERT INTO orders (order_number, daily_sequence, type, status, subtotal, total, paid_amount, payment_status, cashier_id)
           VALUES (?, 902, 'TAKEAWAY', 'COMPLETED', 2200, 2200, 2200, 'PAID', ?)`
        )
        .run(postT1OrderNum, adminRow.id);
      const insOrdId = Number(insOrd.lastInsertRowid);
      dbMod.sqlite
        .prepare(
          `INSERT INTO order_items (order_id, product_id, name_ar, unit_price, quantity, total, station, status)
           VALUES (?, ?, ?, 2200, 1, 2200, 'MAIN_KITCHEN', 'COMPLETED')`
        )
        .run(insOrdId, product.id, product.name_ar);
      dbMod.sqlite
        .prepare(
          `INSERT INTO payments (order_id, method, amount, tender_amount, change_amount, cashier_id)
           VALUES (?, 'CARD', 2200, 2200, 0, ?)`
        )
        .run(insOrdId, adminRow.id);
      dbMod.sqlite.prepare('UPDATE ingredients SET current_stock = ? WHERE id = ?').run(stockAtT1 - 12.5, ing.id);

      // Backup T2
      const backupT2 = await backupManager.createBackup('MANUAL');
      expect(backupT2.recordCounts?.orders).toBe(ordersCountAtT1 + 1);
      expect(backupT2.recordCounts?.payments).toBe(paymentsCountAtT1 + 1);

      // Restore T1
      const restoreRes = await backupManager.restoreBackup(backupT1.filename);
      expect(restoreRes.success).toBe(true);
      expect(restoreRes.restoredFrom).toBe(backupT1.filename);
      expect(restoreRes.preRestoreBackup).toContain('_pre_restore_');
      expect(restoreRes.postRestoreVerification.integrityCheck).toBe('ok');

      // Verify restored DB matches T1 point-in-time state across orders, payments & inventory
      const liveOrdersAfterRestore = Number((dbMod.sqlite.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c);
      const livePaymentsAfterRestore = Number((dbMod.sqlite.prepare('SELECT COUNT(*) as c FROM payments').get() as any).c);
      const liveStockAfterRestore = Number(
        (dbMod.sqlite.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(ing.id) as any).current_stock
      );
      const missingPostT1Order = dbMod.sqlite
        .prepare('SELECT id FROM orders WHERE order_number = ?')
        .get(postT1OrderNum);

      expect(liveOrdersAfterRestore).toBe(ordersCountAtT1);
      expect(livePaymentsAfterRestore).toBe(paymentsCountAtT1);
      expect(liveStockAfterRestore).toBeCloseTo(stockAtT1, 4);
      expect(missingPostT1Order).toBeUndefined();
    });
  });

  describe('TASK 05: Backup API Security, RBAC, Path Traversal Protection & Audit Trail', () => {
    it('enforces ADMIN-only RBAC on all backup, verify, download and restore endpoints', async () => {
      // Unauthenticated -> 401
      const unauthRes = await request(app).get('/api/backups');
      expect(unauthRes.status).toBe(401);

      // CASHIER -> 403
      const cashierList = await request(app).get('/api/backups').set('Authorization', `Bearer ${cashierToken}`);
      expect(cashierList.status).toBe(403);

      const cashierCreate = await request(app)
        .post('/api/backups/create')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({});
      expect(cashierCreate.status).toBe(403);

      const cashierRestore = await request(app)
        .post('/api/backups/restore')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ filename: 'anything.db', confirmRestore: 'CONFIRM_RESTORE' });
      expect(cashierRestore.status).toBe(403);
    });

    it('allows ADMIN to create, list, verify, download, update backup settings, reject path traversal, and log audits without credential leakage', async () => {
      // Update backup settings validation
      const badSettings = await request(app)
        .post('/api/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ backup_retention_count: '0' });
      expect(badSettings.status).toBe(400);

      const okSettings = await request(app)
        .post('/api/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ backup_auto_enabled: 'true', backup_interval_hours: '6', backup_retention_count: '14' });
      expect(okSettings.status).toBe(200);

      // Create backup via API
      const createRes = await request(app)
        .post('/api/backups/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'MANUAL' });
      expect(createRes.status).toBe(201);
      expect(createRes.body.success).toBe(true);
      const createdFilename = createRes.body.backup.filename as string;
      expect(createdFilename).toMatch(/^gp_pos_manual_.*\.db$/);

      // List backups via API
      const listRes = await request(app).get('/api/backups').set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.lastVerifiedBackup).toBeTruthy();
      expect(Array.isArray(listRes.body.backups)).toBe(true);

      // Verify backup via API
      const verifyRes = await request(app)
        .post('/api/backups/verify')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ filename: createdFilename });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.verification.integrityCheck).toBe('ok');

      // Download backup via API
      const downloadRes = await request(app)
        .get(`/api/backups/download/${encodeURIComponent(createdFilename)}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-disposition']).toContain(createdFilename);

      // Reject path traversal attacks
      const traversalDownload = await request(app)
        .get(`/api/backups/download/${encodeURIComponent('../../etc/passwd')}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(traversalDownload.status).toBe(400);

      const traversalVerify = await request(app)
        .post('/api/backups/verify')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ filename: '../phase7_isolated.db' });
      expect(traversalVerify.status).toBe(400);

      // Restore without explicit confirmation must fail 400
      const noConfirmRestore = await request(app)
        .post('/api/backups/restore')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ filename: createdFilename });
      expect(noConfirmRestore.status).toBe(400);

      // Check audit logs recorded prior to point-in-time restore
      const preRestoreAudits = dbMod.sqlite
        .prepare(
          "SELECT action, entity_type, entity_id, details FROM audit_logs WHERE entity_type = 'BACKUP' ORDER BY id DESC"
        )
        .all() as any[];
      const preActions = preRestoreAudits.map((a) => a.action);
      expect(preActions).toContain('CREATE_BACKUP');
      expect(preActions).toContain('VERIFY_BACKUP');
      expect(preActions).toContain('DOWNLOAD_BACKUP');

      // Full ADMIN restore via API
      const restoreApiRes = await request(app)
        .post('/api/backups/restore')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ filename: createdFilename, confirmRestore: 'CONFIRM_RESTORE' });
      expect(restoreApiRes.status).toBe(200);
      expect(restoreApiRes.body.success).toBe(true);
      expect(restoreApiRes.body.postRestoreVerification.integrityCheck).toBe('ok');

      // Verify restored DB records RESTORE_BACKUP in audit_logs without sensitive credentials
      const postRestoreAudits = dbMod.sqlite
        .prepare(
          "SELECT action, entity_type, entity_id, details FROM audit_logs WHERE entity_type = 'BACKUP' ORDER BY id DESC"
        )
        .all() as any[];
      expect(postRestoreAudits.map((a) => a.action)).toContain('RESTORE_BACKUP');

      const joinedDetails = [...preRestoreAudits, ...postRestoreAudits]
        .map((a) => String(a.details || ''))
        .join('\n');
      expect(joinedDetails).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
      expect(joinedDetails).not.toMatch(/\$2[aby]\$/);
    });
  });
});
