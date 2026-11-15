// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import express from 'express';
import request from 'supertest';

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase9_desktop_'));
const TEST_DB_PATH = path.join(TEST_ROOT, 'phase9_isolated.db');
const TEST_BACKUP_DIR = path.join(TEST_ROOT, 'backups');
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.GOLDEN_PALACE_BACKUP_DIR = TEST_BACKUP_DIR;
process.env.JWT_SECRET = 'phase9_test_jwt_secret_minimum_32_characters_long';

let app: express.Express;
let sqlite: any;
let db: any;
let signUserToken: any;
let clearRateLimitsForTest: any;
let reopenDatabase: any;
let adminToken: string;
let cashierToken: string;
let kitchenToken: string;

async function bootstrap() {
  const dbMod = await import('../db/index.ts');
  sqlite = dbMod.sqlite;
  db = dbMod.db;
  reopenDatabase = dbMod.reopenDatabase;

  const { seedDatabase } = await import('../db/seed.ts');
  await seedDatabase();

  const authMod = await import('../middleware/auth.ts');
  signUserToken = authMod.signUserToken;

  const rateMod = await import('../middleware/rateLimit.ts');
  clearRateLimitsForTest = rateMod.clearRateLimitsForTest;

  const { apiRouter } = await import('../server/api.ts');
  const nextApp = express();
  nextApp.use(express.json());
  nextApp.use('/api', apiRouter);
  app = nextApp;

  const makeToken = (row: any) =>
    signUserToken({
      id: row.id,
      uid: row.uid,
      username: row.username,
      email: row.email,
      role: row.role,
      fullName: row.full_name,
    });

  const adminRow = sqlite.prepare("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1").get();
  const cashierRow = sqlite.prepare("SELECT * FROM users WHERE role = 'CASHIER' LIMIT 1").get();
  const kitchenRow = sqlite.prepare("SELECT * FROM users WHERE role = 'KITCHEN' LIMIT 1").get();

  adminToken = makeToken(adminRow);
  cashierToken = cashierRow ? makeToken(cashierRow) : adminToken;
  kitchenToken = kitchenRow ? makeToken(kitchenRow) : adminToken;
}

describe('Golden Palace POS — Phase 09 Printing & Windows Desktop Architecture', () => {
  beforeAll(async () => {
    await bootstrap();
    expect(sqlite.name).toBe(TEST_DB_PATH);
    expect(sqlite.name).not.toContain('golden_palace.db');
  });

  beforeEach(async () => {
    clearRateLimitsForTest?.();
    const { setPrintTransportForTest } = await import('../services/printQueueService.ts');
    setPrintTransportForTest(null);
  });

  afterAll(async () => {
    const { setPrintTransportForTest } = await import('../services/printQueueService.ts');
    setPrintTransportForTest(null);
    try {
      const dbMod = await import('../db/index.ts');
      dbMod.closeDatabase();
    } catch {
      // Ignore
    }
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('1. Arabic ESC/POS contextual shaping, BiDi reordering, CP864/1256/UTF8 & 58mm/80mm column widths', async () => {
    const {
      shapeArabicForThermal,
      encodeEscPosLine,
      formatTwoColLine,
      getColumnsForPaper,
      buildArabicTestEscPos,
      buildFeedAndCutTestEscPos,
    } = await import('../utils/escposArabic.ts');

    const shaped = shapeArabicForThermal('القصر الذهبي لا');
    expect(shaped.length).toBeGreaterThan(0);
    // Presentation form characters / Lam-Alef ligature should replace plain isolated characters
    expect(shaped).not.toBe('القصر الذهبي لا');

    expect(getColumnsForPaper('58mm')).toBe(32);
    expect(getColumnsForPaper('80mm')).toBe(48);

    const line58 = formatTwoColLine('Tacos Poulet', '400 DA', 32);
    const line80 = formatTwoColLine('Tacos Poulet', '400 DA', 48);
    expect(line58.length).toBe(32);
    expect(line80.length).toBe(48);

    const cp864Bytes = encodeEscPosLine('طاجين', 'CP864');
    const win1256Bytes = encodeEscPosLine('طاجين', 'WINDOWS_1256');
    const utf8Bytes = encodeEscPosLine('طاجين', 'UTF8');
    expect(cp864Bytes[cp864Bytes.length - 1]).toBe(0x0a);
    expect(win1256Bytes[win1256Bytes.length - 1]).toBe(0x0a);
    expect(utf8Bytes.length).toBeGreaterThan(cp864Bytes.length);

    const testArabic = buildArabicTestEscPos({ paperType: '58mm', arabicEncoding: 'CP864' });
    expect(testArabic[0]).toBe(0x1b); // ESC
    expect(testArabic[1]).toBe(0x40); // @ init

    const feedCut = buildFeedAndCutTestEscPos(4, true);
    expect(Array.from(feedCut)).toContain(0x1d); // GS V cut
  });

  it('2. print_jobs SQLite queue lifecycle, strict original job_key deduplication, honest failure & retry', async () => {
    const { setPrintTransportForTest } = await import('../services/printQueueService.ts');
    const dbMod = await import('../db/index.ts');

    // Mock transport to succeed once
    setPrintTransportForTest(async () => ({
      success: true,
      mode: 'mock_spooler',
      spoolerAccepted: true,
      hardwareConfirmed: true,
      message: 'Accepted by mock thermal spooler',
    }));

    const origKey = 'orig_BON-P9-001_receipt';
    const res1 = await request(app)
      .post('/api/printer/spool')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderNumber: 'BON-P9-001',
        jobType: 'RECEIPT',
        printerName: 'CAFETERIA',
        connectionType: 'WINDOWS_SPOOLER',
        paperWidth: '80mm',
        printJobId: origKey,
        rawBase64: Buffer.from('TEST RECEIPT BYTES').toString('base64'),
        payloadPreview: 'BON-P9-001 TOTAL 1000 DA',
      });

    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(res1.body.status).toBe('PRINTED');
    const firstJobId = res1.body.jobId;

    // Duplicate automatic print with same jobKey must deduplicate instead of creating another receipt
    const resDup = await request(app)
      .post('/api/printer/spool')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderNumber: 'BON-P9-001',
        jobType: 'RECEIPT',
        printerName: 'CAFETERIA',
        connectionType: 'WINDOWS_SPOOLER',
        paperWidth: '80mm',
        printJobId: origKey,
        rawBase64: Buffer.from('TEST RECEIPT BYTES').toString('base64'),
      });

    expect(resDup.status).toBe(200);
    expect(resDup.body.mode).toBe('deduplicated');
    expect(resDup.body.jobId).toBe(firstJobId);

    // Confirm real failure on closed TCP 9100 returns 502 and records FAILED job cleanly
    setPrintTransportForTest(null);
    const closedServer = net.createServer();
    await new Promise<void>((resolve) => closedServer.listen(0, '127.0.0.1', () => resolve()));
    const deadPort = (closedServer.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => closedServer.close(() => resolve()));

    const failRes = await request(app)
      .post('/api/printer/spool')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderNumber: 'BON-P9-FAIL',
        jobType: 'RECEIPT',
        printerName: 'LAN-80',
        connectionType: 'NETWORK_IP',
        targetIp: '127.0.0.1',
        targetPort: deadPort,
        paperWidth: '80mm',
        printJobId: 'orig_BON-P9-FAIL_receipt',
        rawBase64: Buffer.from('FAIL RECEIPT').toString('base64'),
      });

    expect(failRes.status).toBe(502);
    expect(failRes.body.success).toBe(false);
    expect(failRes.body.status).toBe('FAILED');
    const failedJobId = failRes.body.jobId;

    const failedRow = dbMod.sqlite.prepare('SELECT * FROM print_jobs WHERE id = ?').get(failedJobId) as any;
    expect(failedRow.status).toBe('FAILED');
    expect(failedRow.error_message).toBeTruthy();

    // Reconnect (mock working LAN/spooler) & retry failed job -> transitions to PRINTED and increments attempts
    setPrintTransportForTest(async () => ({
      success: true,
      mode: 'mock_spooler',
      spoolerAccepted: true,
      hardwareConfirmed: true,
      message: 'Delivered after reconnect',
    }));

    const retryRes = await request(app)
      .post(`/api/printer/jobs/${failedJobId}/retry`)
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.success).toBe(true);
    expect(retryRes.body.status).toBe('PRINTED');

    const retriedRow = dbMod.sqlite.prepare('SELECT * FROM print_jobs WHERE id = ?').get(failedJobId) as any;
    expect(retriedRow.status).toBe('PRINTED');
    expect(retriedRow.attempts).toBeGreaterThanOrEqual(2);

    // Physical confirmation endpoint persists confirmed_at
    const confirmRes = await request(app)
      .post(`/api/printer/jobs/${failedJobId}/confirm`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(confirmRes.status).toBe(200);
    const confirmedRow = dbMod.sqlite.prepare('SELECT * FROM print_jobs WHERE id = ?').get(failedJobId) as any;
    expect(confirmedRow.confirmed_at).toBeTruthy();
  });

  it('3. RBAC enforcement for manual REPRINT (DUPLICATA): Cashier/Admin allowed, Kitchen denied (403)', async () => {
    const { setPrintTransportForTest } = await import('../services/printQueueService.ts');
    setPrintTransportForTest(async () => ({
      success: true,
      mode: 'mock_spooler',
      spoolerAccepted: true,
      hardwareConfirmed: true,
      message: 'Reprint delivered',
    }));

    const deniedRes = await request(app)
      .post('/api/printer/spool')
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({
        orderNumber: 'BON-P9-001',
        jobType: 'RECEIPT',
        printerName: 'CAFETERIA',
        connectionType: 'WINDOWS_SPOOLER',
        isReprint: true,
        rawBase64: Buffer.from('REPRINT').toString('base64'),
      });
    expect(deniedRes.status).toBe(403);

    const allowedRes = await request(app)
      .post('/api/printer/spool')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderNumber: 'BON-P9-001',
        jobType: 'RECEIPT',
        printerName: 'CAFETERIA',
        connectionType: 'WINDOWS_SPOOLER',
        isReprint: true,
        rawBase64: Buffer.from('REPRINT').toString('base64'),
      });
    expect(allowedRes.status).toBe(200);
    expect(allowedRes.body.isReprint).toBe(true);

    // Live Arabic / Feed-Cut printer test endpoint
    const arabicTestRes = await request(app)
      .post('/api/printer/test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        testType: 'ARABIC',
        printerName: 'CAFETERIA',
        connectionType: 'WINDOWS_SPOOLER',
        paperType: '58mm',
        arabicEncoding: 'CP864',
      });
    expect(arabicTestRes.status).toBe(200);
    expect(arabicTestRes.body.testType).toBe('ARABIC');
    expect(arabicTestRes.body.paperType).toBe('58mm');
  });

  it('4. Printer settings persist cleanly across SQLite restaurant_settings', async () => {
    const saveRes = await request(app)
      .post('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        printer_name: 'EPSON-TM-T20-80',
        printer_connection_type: 'NETWORK_IP',
        printer_network_ip: '192.168.1.210',
        printer_network_port: '9100',
        paper_type: '58mm',
        printable_width: '48',
        printer_arabic_encoding: 'WINDOWS_1256',
      });
    expect(saveRes.status).toBe(200);

    const getRes = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.printer_name).toBe('EPSON-TM-T20-80');
    expect(getRes.body.printer_connection_type).toBe('NETWORK_IP');
    expect(getRes.body.printer_network_ip).toBe('192.168.1.210');
    expect(getRes.body.paper_type).toBe('58mm');
    expect(getRes.body.printer_arabic_encoding).toBe('WINDOWS_1256');
  });

  it('5. Desktop %APPDATA% path resolution & Safe Update Gate (blocks on open shift, succeeds with verified backup when clean)', async () => {
    const { getDesktopStoragePaths } = await import('../db/sqlitePath.ts');
    const paths = getDesktopStoragePaths();
    expect(paths.dbPath).toBe(TEST_DB_PATH);
    expect(paths.backupDir).toBe(TEST_BACKUP_DIR);
    // Backup directory must never live inside the app installation directory unless overridden
    expect(paths.backupDir).not.toBe(process.cwd());

    // Open a shift -> pre-update check MUST block (409)
    const openShift = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingCash: 10000, notes: 'Shift open during update test' });
    expect(openShift.status).toBe(201);
    const shiftId = openShift.body.id;

    const blockedUpdate = await request(app)
      .post('/api/system/pre-update-check')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currentVersion: '1.0.0', targetVersion: '1.1.0' });
    expect(blockedUpdate.status).toBe(409);
    expect(blockedUpdate.body.allowed).toBe(false);
    expect(blockedUpdate.body.blockingReasons.length).toBeGreaterThan(0);

    // Close the shift -> pre-update check MUST create verified SQLite backup + recovery manifest
    const closeShift = await request(app)
      .post('/api/cash-register/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shiftId, actualCash: 10000, notes: 'Shift closed for update' });
    expect(closeShift.status).toBe(200);

    const allowedUpdate = await request(app)
      .post('/api/system/pre-update-check')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currentVersion: '1.0.0', targetVersion: '1.1.0' });
    expect(allowedUpdate.status).toBe(200);
    expect(allowedUpdate.body.allowed).toBe(true);
    expect(allowedUpdate.body.preUpdateBackup?.integrityCheck).toBe('ok');
    expect(fs.existsSync(allowedUpdate.body.rollbackManifestPath)).toBe(true);
  });

  it('6. Fresh desktop DB first-run admin onboarding rejects weak PINs, creates admin safely, & preserves existing DB data on upgrade', async () => {
    const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_fresh_desktop_'));
    const freshDbPath = path.join(freshRoot, 'golden_palace_fresh.db');

    try {
      // Reopen onto empty fresh desktop database
      const freshSqlite = reopenDatabase(freshDbPath);
      const { runFirstRunDatabaseAudit } = await import('../services/desktopLifecycle.ts');
      const { seedCatalogAndTablesOnly } = await import('../db/seed.ts');

      const auditBefore = runFirstRunDatabaseAudit(freshSqlite);
      await seedCatalogAndTablesOnly();

      expect(auditBefore.needsInitialAdminSetup).toBe(true);
      expect(auditBefore.usersCount).toBe(0);
      expect(auditBefore.integrityCheck).toBe('ok');

      // Check API /api/system/first-run-status reports needsInitialAdminSetup = true
      const statusRes = await request(app).get('/api/system/first-run-status');
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.needsInitialAdminSetup).toBe(true);

      // Weak PIN '1234' MUST be rejected
      const weakRes = await request(app).post('/api/system/setup-admin').send({
        fullName: 'مالك المطعم',
        username: 'owner',
        password: 'StrongPassword99!',
        pin: '1234',
      });
      expect(weakRes.status).toBe(400);

      // Strong PIN + credentials succeed
      const strongRes = await request(app).post('/api/system/setup-admin').send({
        fullName: 'مالك المطعم',
        username: 'owner',
        password: 'StrongPassword99!',
        pin: '8492',
      });
      expect(strongRes.status).toBe(201);
      expect(strongRes.body.token).toBeTruthy();
      expect(strongRes.body.user.role).toBe('ADMIN');

      // Second call to setup-admin MUST be blocked (409)
      const secondCall = await request(app).post('/api/system/setup-admin').send({
        fullName: 'Hacker',
        username: 'hacker',
        password: 'StrongPassword99!',
        pin: '5913',
      });
      expect(secondCall.status).toBe(409);

      // Simulate app version upgrade re-opening the same DB -> preserves owner & zero weak PIN injection
      const upgradedSqlite = reopenDatabase(freshDbPath);
      const auditAfter = runFirstRunDatabaseAudit(upgradedSqlite);
      expect(auditAfter.usersCount).toBe(1);
      expect(auditAfter.needsInitialAdminSetup).toBe(false);
      expect(auditAfter.integrityCheck).toBe('ok');
    } finally {
      // Restore main Phase 09 test DB handle
      reopenDatabase(TEST_DB_PATH);
      fs.rmSync(freshRoot, { recursive: true, force: true });
    }
  });
});
