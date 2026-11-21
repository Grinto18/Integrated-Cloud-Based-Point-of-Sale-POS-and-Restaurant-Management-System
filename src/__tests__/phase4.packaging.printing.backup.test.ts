// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { closeSqliteHandle, removeIsolatedTestDir } from './testCleanup.ts';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase4_test_'));
const testDbPath = path.join(tempDir, 'golden_palace_phase4.db');
const testBackupDir = path.join(tempDir, 'backups');

process.env.SQLITE_DB_PATH = testDbPath;
process.env.GOLDEN_PALACE_BACKUP_DIR = testBackupDir;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'phase4-test-jwt-secret-key-min-32-chars!!';

let app: express.Express;
let cashierToken = '';

describe('Golden Palace POS — Phase 4 Packaging, Asset Hygiene, Printing Honesty & Backup Hardening', () => {
  beforeAll(async () => {
    const dbMod = await import('../db/index.ts');
    expect(dbMod.sqlite.name).toBe(testDbPath);

    const { seedDatabase } = await import('../db/seed.ts');
    await seedDatabase();

    const { signUserToken } = await import('../middleware/auth.ts');
    const { apiRouter } = await import('../server/api.ts');
    const nextApp = express();
    nextApp.use(express.json());
    nextApp.use('/api', apiRouter);
    app = nextApp;

    const cashierRow = dbMod.sqlite
      .prepare("SELECT * FROM users WHERE role = 'CASHIER' OR role = 'ADMIN' LIMIT 1")
      .get() as any;
    cashierToken = signUserToken({
      id: cashierRow.id,
      uid: cashierRow.uid,
      username: cashierRow.username,
      email: cashierRow.email,
      role: cashierRow.role,
      fullName: cashierRow.full_name,
    });
  });

  afterEach(async () => {
    const { setPrintTransportForTest } = await import('../services/printQueueService.ts');
    setPrintTransportForTest(null);
  });

  afterAll(async () => {
    const dbMod = await import('../db/index.ts');
    dbMod.closeDatabase();
    removeIsolatedTestDir(tempDir);
  });

  // =========================================================================
  // WORKSTREAM 4A: Official Desktop Icons & Packaging Readiness
  // =========================================================================
  it('4A. Official desktop icons (build/icon.png & build/icon.ico) exist with valid binary headers and SVG source intact', () => {
    const root = process.cwd();
    const pngPath = path.join(root, 'build', 'icon.png');
    const icoPath = path.join(root, 'build', 'icon.ico');
    const svgPath = path.join(root, 'public', 'icons', 'icon-512.svg');

    expect(fs.existsSync(pngPath)).toBe(true);
    expect(fs.existsSync(icoPath)).toBe(true);
    expect(fs.existsSync(svgPath)).toBe(true);

    // Validate PNG signature + 512x512 IHDR dimensions
    const pngBuf = fs.readFileSync(pngPath);
    expect(pngBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    const pngWidth = pngBuf.readUInt32BE(16);
    const pngHeight = pngBuf.readUInt32BE(20);
    expect(pngWidth).toBe(512);
    expect(pngHeight).toBe(512);

    // Validate Windows ICO header (reserved=0, type=1, count=6 multi-size frames)
    const icoBuf = fs.readFileSync(icoPath);
    expect(icoBuf.readUInt16LE(0)).toBe(0);
    expect(icoBuf.readUInt16LE(2)).toBe(1);
    const frameCount = icoBuf.readUInt16LE(4);
    expect(frameCount).toBe(6);
    const frameSizes: number[] = [];
    for (let i = 0; i < frameCount; i++) {
      const entryOffset = 6 + i * 16;
      const w = icoBuf.readUInt8(entryOffset) || 256;
      const h = icoBuf.readUInt8(entryOffset + 1) || 256;
      expect(w).toBe(h);
      frameSizes.push(w);
    }
    expect(frameSizes.sort((a, b) => a - b)).toEqual([16, 24, 32, 48, 64, 256]);
  });

  // =========================================================================
  // WORKSTREAM 4B: Safe Production Asset Hygiene
  // =========================================================================
  it('4B. Original dev-only asset stays intact in public/ while excluded from production dist/', () => {
    const root = process.cwd();
    const originalDevAsset = path.join(
      root,
      'public',
      'assets',
      'aistudio',
      'Paste_November_20__2026_-_12_42PM_0ce16838'
    );
    expect(fs.existsSync(originalDevAsset)).toBe(true);
    expect(fs.statSync(originalDevAsset).size).toBeGreaterThan(0);

    const distDir = path.join(root, 'dist');
    if (fs.existsSync(distDir)) {
      expect(fs.existsSync(path.join(distDir, 'assets', 'aistudio'))).toBe(false);
      expect(fs.existsSync(path.join(distDir, 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(distDir, 'icons', 'icon-512.svg'))).toBe(true);
    }
  });

  // =========================================================================
  // WORKSTREAM 4C: Print Queue Honesty, Spooler Security & Lossless Retry
  // =========================================================================
  it('4C.1 Real TCP 9100 and Browser/USB transports report hardwareConfirmed=false and deliveryState=SPOOLED honestly', async () => {
    const { sendToNetworkPrinter, dispatchPrintTransport } = await import('../services/printQueueService.ts');

    const receivedChunks: Buffer[] = [];
    const mockPrinterServer = net.createServer((socket) => {
      socket.on('data', (chunk) => receivedChunks.push(chunk));
    });
    await new Promise<void>((resolve) => mockPrinterServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (mockPrinterServer.address() as net.AddressInfo).port;

    try {
      const payload = Buffer.from([0x1b, 0x40, 0x47, 0x50, 0x2d, 0x39, 0x31, 0x30, 0x30, 0x0a]);
      const tcpRes = await sendToNetworkPrinter('127.0.0.1', port, payload, 1);

      expect(tcpRes.success).toBe(true);
      expect(tcpRes.spoolerAccepted).toBe(true);
      expect(tcpRes.hardwareConfirmed).toBe(false);
      expect(tcpRes.deliveryState).toBe('SPOOLED');

      // Ensure raw bytes actually arrived over loopback socket
      await new Promise((r) => setTimeout(r, 30));
      expect(Buffer.concat(receivedChunks).equals(payload)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => mockPrinterServer.close(() => resolve()));
    }

    const browserRes = await dispatchPrintTransport({
      connectionType: 'BROWSER',
      printerName: 'CAFETERIA',
      copies: 1,
      buffer: Buffer.from('BROWSER'),
      orderNumber: 'BON-4C-BR',
      isReprint: false,
      clientHandled: true,
    });
    expect(browserRes.success).toBe(true);
    expect(browserRes.spoolerAccepted).toBe(true);
    expect(browserRes.hardwareConfirmed).toBe(false);
    expect(browserRes.deliveryState).toBe('SPOOLED');

    const usbRes = await dispatchPrintTransport({
      connectionType: 'USB',
      printerName: 'USB-80',
      copies: 1,
      buffer: Buffer.from('USB'),
      orderNumber: 'BON-4C-USB',
      isReprint: false,
      clientHandled: true,
    });
    expect(usbRes.success).toBe(true);
    expect(usbRes.spoolerAccepted).toBe(true);
    expect(usbRes.hardwareConfirmed).toBe(false);
    expect(usbRes.deliveryState).toBe('SPOOLED');
  });

  it('4C.2 Windows spooler command builder uses safe execFile args and rejects all shell injection printer names', async () => {
    const {
      sanitizeWindowsPrinterName,
      buildWindowsSpoolerInvocation,
      sendToWindowsSpooler,
    } = await import('../services/printQueueService.ts');

    expect(sanitizeWindowsPrinterName('CAFETERIA')).toBe('CAFETERIA');
    expect(sanitizeWindowsPrinterName('XPrinter 80mm_USB.1')).toBe('XPrinter 80mm_USB.1');

    const inv = buildWindowsSpoolerInvocation('C:\\Temp\\gp_ticket_1.bin', 'CAFETERIA');
    expect(inv.command).toBe('cmd.exe');
    expect(inv.args).toEqual(['/d', '/c', 'copy', '/b', 'C:\\Temp\\gp_ticket_1.bin', '\\\\localhost\\CAFETERIA']);

    const maliciousNames = [
      'CAFETERIA & calc.exe',
      'CAFETERIA|whoami',
      'CAFETERIA;del *',
      'PRN" > C:\\pwn.txt',
      '../traversal',
      '-leading-flag',
      'PRN\nnewline',
      '',
    ];

    for (const badName of maliciousNames) {
      expect(sanitizeWindowsPrinterName(badName)).toBeNull();
      expect(() => buildWindowsSpoolerInvocation('C:\\Temp\\t.bin', badName)).toThrow();
      const spoolRes = await sendToWindowsSpooler(badName, Buffer.from('test'), 1, 'ORD-BAD');
      expect(spoolRes.success).toBe(false);
      expect(spoolRes.error).toBe('INVALID_PRINTER_NAME');
      expect(spoolRes.deliveryState).toBe('FAILED');
    }
  });

  it('4C.3 Failed print retry replays exact full binary ESC/POS bytes and rejects missing full payload (NEVER prints truncated preview)', async () => {
    const {
      setPrintTransportForTest,
      deleteFullPrintPayload,
      readFullPrintPayload,
    } = await import('../services/printQueueService.ts');
    const dbMod = await import('../db/index.ts');

    // Construct a 720-byte binary ESC/POS receipt (exceeding 500-char preview truncation limit)
    const header = Buffer.from([0x1b, 0x40, 0x1b, 0x74, 0x16]); // ESC @ + ESC t CP864
    const body = Buffer.from('A'.repeat(680) + '::FULL_TAIL_MARKER_720::', 'ascii');
    const cutCmd = Buffer.from([0x1d, 0x56, 0x41, 0x03]); // GS V cut
    const fullBinaryPayload = Buffer.concat([header, body, cutCmd]);

    // Step 1: Fail initial dispatch
    setPrintTransportForTest(async () => ({
      success: false,
      spoolerAccepted: false,
      hardwareConfirmed: false,
      deliveryState: 'FAILED',
      mode: 'mock_offline',
      message: 'Printer temporarily offline',
      error: 'PRINTER_OFFLINE',
    }));

    const failRes = await request(app)
      .post('/api/printer/spool')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderNumber: 'BON-4C-FULL-RETRY',
        jobType: 'RECEIPT',
        printerName: 'CAFETERIA',
        connectionType: 'NETWORK_IP',
        targetIp: '192.168.1.99',
        targetPort: 9100,
        rawBase64: fullBinaryPayload.toString('base64'),
        payloadPreview: 'SHORT PREVIEW ONLY',
      });

    expect(failRes.status).toBe(502);
    expect(failRes.body.deliveryState).toBe('FAILED');
    const jobId = failRes.body.jobId as number;
    expect(readFullPrintPayload(jobId)?.equals(fullBinaryPayload)).toBe(true);

    // Step 2: Retry without providing override rawBase64 -> MUST replay exact 720+ binary bytes
    let capturedRetryBuffer: Buffer | null = null;
    setPrintTransportForTest(async (params) => {
      capturedRetryBuffer = Buffer.from(params.buffer);
      return {
        success: true,
        spoolerAccepted: true,
        hardwareConfirmed: false,
        deliveryState: 'SPOOLED',
        mode: 'network_tcp_9100',
        message: 'Spooled full payload',
      };
    });

    const retryRes = await request(app)
      .post(`/api/printer/jobs/${jobId}/retry`)
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.success).toBe(true);
    expect(retryRes.body.hardwareConfirmed).toBe(false);
    expect(retryRes.body.deliveryState).toBe('SPOOLED');
    expect(capturedRetryBuffer).not.toBeNull();
    expect(capturedRetryBuffer!.equals(fullBinaryPayload)).toBe(true);

    const dbRowAfterSpool = dbMod.sqlite.prepare('SELECT confirmed_at FROM print_jobs WHERE id = ?').get(jobId) as any;
    expect(dbRowAfterSpool.confirmed_at).toBeNull();

    // Step 3: Missing full payload MUST fail with HTTP 422 (NEVER retry using truncated payloadPreview)
    setPrintTransportForTest(async () => ({
      success: false,
      spoolerAccepted: false,
      hardwareConfirmed: false,
      deliveryState: 'FAILED',
      mode: 'mock_offline',
      message: 'Offline',
      error: 'OFFLINE',
    }));

    const failRes2 = await request(app)
      .post('/api/printer/spool')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderNumber: 'BON-4C-NO-PREVIEW-RETRY',
        jobType: 'RECEIPT',
        printerName: 'CAFETERIA',
        connectionType: 'NETWORK_IP',
        targetIp: '192.168.1.99',
        targetPort: 9100,
        rawBase64: fullBinaryPayload.toString('base64'),
        payloadPreview: 'TRUNCATED PREVIEW MUST NEVER PRINT',
      });
    expect(failRes2.status).toBe(502);
    const missingPayloadJobId = failRes2.body.jobId as number;

    // Delete full spool file to simulate missing full payload
    deleteFullPrintPayload(missingPayloadJobId);

    let transportCalledOnMissing = false;
    setPrintTransportForTest(async () => {
      transportCalledOnMissing = true;
      return {
        success: true,
        spoolerAccepted: true,
        hardwareConfirmed: false,
        mode: 'should_not_run',
        message: 'Should not run',
      };
    });

    const rejectedRetryRes = await request(app)
      .post(`/api/printer/jobs/${missingPayloadJobId}/retry`)
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(rejectedRetryRes.status).toBe(422);
    expect(rejectedRetryRes.body.code).toBe('MISSING_FULL_PRINT_PAYLOAD');
    expect(transportCalledOnMissing).toBe(false);

    const rejectedReprintRes = await request(app)
      .post(`/api/printer/jobs/${missingPayloadJobId}/reprint`)
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(rejectedReprintRes.status).toBe(422);
    expect(rejectedReprintRes.body.code).toBe('MISSING_FULL_PRINT_PAYLOAD');
    expect(transportCalledOnMissing).toBe(false);
  });

  // =========================================================================
  // WORKSTREAM 4D: Backup SHA-256, PRAGMA foreign_key_check & Lock Retry
  // =========================================================================
  it('4D.1 Backup records SHA-256 in manifest and blocks restore when backup is silently tampered', async () => {
    const { BackupManager, computeFileSha256 } = await import('../services/backupService.ts');
    const dbMod = await import('../db/index.ts');

    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_4d_sha_'));
    const isolatedDbPath = path.join(isolatedDir, 'live.db');
    const isolatedBackupDir = path.join(isolatedDir, 'backups');

    // Clone current test DB into isolatedDir
    await dbMod.sqlite.backup(isolatedDbPath);
    let localSqlite = new Database(isolatedDbPath);
    localSqlite.pragma('journal_mode = WAL');
    localSqlite.pragma('foreign_keys = ON');

    const mgr = new BackupManager({
      getDbPath: () => isolatedDbPath,
      getBackupDir: () => isolatedBackupDir,
      getSqlite: () => localSqlite,
      closeDb: () => {
        if (localSqlite && localSqlite.open) localSqlite.close();
      },
      reopenDb: (target) => {
        localSqlite = new Database(target || isolatedDbPath);
        localSqlite.pragma('journal_mode = WAL');
        localSqlite.pragma('foreign_keys = ON');
        return localSqlite;
      },
    });

    try {
      const entry = await mgr.createBackup('MANUAL', { skipRetention: true });
      expect(entry.status).toBe('VERIFIED');
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.foreignKeyViolationsCount).toBe(0);

      const backupPath = mgr.resolveSafeBackupPath(entry.filename);
      expect(computeFileSha256(backupPath)).toBe(entry.sha256);

      // Write a sentinel setting in live DB so we can prove restore never overwrote live DB
      localSqlite
        .prepare("INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES ('phase4d_sentinel', 'LIVE_UNTOUCHED')")
        .run();

      // Silently tamper with backup DB using valid SQL (PRAGMA integrity_check remains 'ok', ONLY SHA-256 catches it!)
      const tamperDb = new Database(backupPath);
      tamperDb
        .prepare("INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES ('phase4d_sentinel', 'TAMPERED_BACKUP')")
        .run();
      tamperDb.close();

      const verifyRes = mgr.verifyExistingBackup(entry.filename);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.status).toBe('CORRUPTED');
      expect(verifyRes.integrityCheck).toBe('sha256_mismatch');

      await expect(mgr.restoreBackup(entry.filename)).rejects.toThrow(/SHA-256/);

      // Prove live DB was NEVER modified
      const sentinel = localSqlite
        .prepare("SELECT value FROM restaurant_settings WHERE key = 'phase4d_sentinel'")
        .get() as { value: string };
      expect(sentinel.value).toBe('LIVE_UNTOUCHED');
    } finally {
      closeSqliteHandle(localSqlite);
      removeIsolatedTestDir(isolatedDir);
    }
  });

  it('4D.2 verifyBackupFile rejects backups containing foreign-key referential integrity violations', async () => {
    const { BackupManager } = await import('../services/backupService.ts');
    const dbMod = await import('../db/index.ts');

    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_4d_fk_'));
    const isolatedDbPath = path.join(isolatedDir, 'live.db');
    const isolatedBackupDir = path.join(isolatedDir, 'backups');
    fs.mkdirSync(isolatedBackupDir, { recursive: true });

    await dbMod.sqlite.backup(isolatedDbPath);
    const brokenBackupPath = path.join(isolatedBackupDir, 'gp_pos_manual_fk_broken.db');
    fs.copyFileSync(isolatedDbPath, brokenBackupPath);

    // Inject an orphaned order_items row with FK enforcement disabled
    const brokenDb = new Database(brokenBackupPath);
    brokenDb.pragma('foreign_keys = OFF');
    brokenDb
      .prepare(
        `INSERT INTO order_items (order_id, product_id, name_ar, unit_price, quantity, total)
         VALUES (999999, 999999, 'ORPHAN ITEM', 100, 1, 100)`
      )
      .run();
    brokenDb.close();

    let localSqlite = new Database(isolatedDbPath);
    const mgr = new BackupManager({
      getDbPath: () => isolatedDbPath,
      getBackupDir: () => isolatedBackupDir,
      getSqlite: () => localSqlite,
      closeDb: () => {
        if (localSqlite && localSqlite.open) localSqlite.close();
      },
      reopenDb: (target) => {
        localSqlite = new Database(target || isolatedDbPath);
        return localSqlite;
      },
    });

    try {
      const check = mgr.verifyBackupFile(brokenBackupPath);
      expect(check.valid).toBe(false);
      expect(check.status).toBe('CORRUPTED');
      expect(check.integrityCheck).toBe('foreign_key_failed');
      expect(check.foreignKeyViolationsCount).toBeGreaterThanOrEqual(1);
    } finally {
      closeSqliteHandle(localSqlite);
      removeIsolatedTestDir(isolatedDir);
    }
  });

  it('4D.3 Restore swap retries bounded Windows NTFS transient locks (EBUSY/EPERM) and rolls back cleanly if exhausted', async () => {
    const { BackupManager } = await import('../services/backupService.ts');
    const dbMod = await import('../db/index.ts');

    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_4d_lock_'));
    const isolatedDbPath = path.join(isolatedDir, 'live.db');
    const isolatedBackupDir = path.join(isolatedDir, 'backups');

    await dbMod.sqlite.backup(isolatedDbPath);
    let localSqlite = new Database(isolatedDbPath);
    localSqlite.pragma('journal_mode = WAL');
    localSqlite.pragma('foreign_keys = ON');

    const mgr = new BackupManager({
      getDbPath: () => isolatedDbPath,
      getBackupDir: () => isolatedBackupDir,
      getSqlite: () => localSqlite,
      closeDb: () => {
        if (localSqlite && localSqlite.open) localSqlite.close();
      },
      reopenDb: (target) => {
        localSqlite = new Database(target || isolatedDbPath);
        localSqlite.pragma('journal_mode = WAL');
        localSqlite.pragma('foreign_keys = ON');
        return localSqlite;
      },
    });

    try {
      // Save V1 snapshot
      localSqlite
        .prepare("INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES ('restore_version', 'V1_SNAPSHOT')")
        .run();
      const v1Backup = await mgr.createBackup('MANUAL', { skipRetention: true });

      // Mutate live DB to V2
      localSqlite
        .prepare("INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES ('restore_version', 'V2_LIVE')")
        .run();

      // Case A: Transient EBUSY (attempt 1) + EPERM (attempt 2), succeeds on attempt 3
      let transientAttempts = 0;
      const restoreOk = await mgr.restoreBackup(v1Backup.filename, {
        maxLockRetries: 5,
        retryDelayMs: 5,
        renameSync: (src, dest) => {
          transientAttempts++;
          if (transientAttempts === 1) {
            const e: NodeJS.ErrnoException = new Error('Resource busy');
            e.code = 'EBUSY';
            throw e;
          }
          if (transientAttempts === 2) {
            const e: NodeJS.ErrnoException = new Error('Operation not permitted');
            e.code = 'EPERM';
            throw e;
          }
          fs.renameSync(src, dest);
        },
      });

      expect(restoreOk.success).toBe(true);
      expect(restoreOk.lockRetryAttempts).toBe(3);
      const afterRestore = localSqlite
        .prepare("SELECT value FROM restaurant_settings WHERE key = 'restore_version'")
        .get() as { value: string };
      expect(afterRestore.value).toBe('V1_SNAPSHOT');

      // Case B: Mutate live DB to V3, then exhaust all 4 EBUSY retries -> MUST roll back cleanly to V3
      localSqlite
        .prepare("INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES ('restore_version', 'V3_PROTECTED')")
        .run();

      let exhaustedAttempts = 0;
      await expect(
        mgr.restoreBackup(v1Backup.filename, {
          maxLockRetries: 4,
          retryDelayMs: 5,
          renameSync: () => {
            exhaustedAttempts++;
            const e: NodeJS.ErrnoException = new Error('Locked by antivirus');
            e.code = 'EBUSY';
            throw e;
          },
        })
      ).rejects.toThrow(/التراجع تلقائياً/);

      expect(exhaustedAttempts).toBe(4);
      const afterRollback = localSqlite
        .prepare("SELECT value FROM restaurant_settings WHERE key = 'restore_version'")
        .get() as { value: string };
      expect(afterRollback.value).toBe('V3_PROTECTED');
    } finally {
      closeSqliteHandle(localSqlite);
      removeIsolatedTestDir(isolatedDir);
    }
  });
});
