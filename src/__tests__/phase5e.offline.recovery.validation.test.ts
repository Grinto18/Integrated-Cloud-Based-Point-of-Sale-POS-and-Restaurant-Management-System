// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import http from 'http';
import crypto from 'crypto';
import { execFileSync, fork, type ChildProcess } from 'child_process';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const ROOT_DIR = process.cwd();
const SERVER_BUNDLE = path.join(ROOT_DIR, 'dist-electron', 'server.cjs');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const ISOLATED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase5e_recovery_'));
const ISOLATED_DB = path.join(ISOLATED_ROOT, 'golden_palace_production.db');
const ISOLATED_BACKUP_DIR = path.join(ISOLATED_ROOT, 'backups_production');
const ISOLATED_JWT_SECRET = crypto.randomBytes(48).toString('hex');

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

function httpJson(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string | number> = {
      Accept: 'application/json',
    };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: any = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // keep raw text (e.g. HTML)
          }
          resolve({ status: res.statusCode || 0, body: parsed, raw });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function waitForHealth(port: number, child: ChildProcess, timeoutMs = 15000): Promise<void> {
  const started = Date.now();
  let exitedInfo: string | null = null;
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exitedInfo = `code=${code}, signal=${signal}`;
  };
  child.once('exit', onExit);
  try {
    while (Date.now() - started < timeoutMs) {
      if (exitedInfo) {
        throw new Error(`Bundled server exited early (${exitedInfo})`);
      }
      try {
        const res = await httpJson(port, 'GET', '/api/health');
        if (res.status === 200) return;
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timed out waiting for bundled server on port ${port}`);
  } finally {
    child.removeListener('exit', onExit);
  }
}

async function spawnDesktopServer(port: number): Promise<{ child: ChildProcess; stderr: () => string }> {
  let errBuf = '';
  const child = fork(SERVER_BUNDLE, [], {
    cwd: ISOLATED_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      GOLDEN_PALACE_DESKTOP: '1',
      GOLDEN_PALACE_DB_MODE: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      SQLITE_DB_PATH: ISOLATED_DB,
      GOLDEN_PALACE_BACKUP_DIR: ISOLATED_BACKUP_DIR,
      GOLDEN_PALACE_DIST_DIR: DIST_DIR,
      JWT_SECRET: ISOLATED_JWT_SECRET,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stderr?.on('data', (d) => {
    errBuf += String(d);
  });
  await waitForHealth(port, child);
  return { child, stderr: () => errBuf };
}

function waitForExit(child: ChildProcess, timeoutMs = 10000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return resolve({ code: child.exitCode, signal: child.signalCode });
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error('Timed out waiting for server exit'));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe('Golden Palace POS — Phase 5E Offline Workflow, Crash Recovery & Backup/Restore Validation', () => {
  const spawnedChildren: ChildProcess[] = [];

  beforeAll(() => {
    if (!fs.existsSync(SERVER_BUNDLE)) {
      execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:server'], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        shell: process.platform === 'win32',
      });
    }
    if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        shell: process.platform === 'win32',
      });
    }
    expect(fs.existsSync(SERVER_BUNDLE)).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'index.html'))).toBe(true);
  }, 60000);

  afterAll(async () => {
    for (const c of spawnedChildren) {
      if (c.exitCode === null && c.signalCode === null) {
        try {
          c.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }
    await new Promise((r) => setTimeout(r, 150));
    fs.rmSync(ISOLATED_ROOT, { recursive: true, force: true });
  });

  it('1. Full offline cashier workflow on compiled desktop server.cjs, receipt/invoice consistency, shutdown backup, & restart persistence + print queue recovery', async () => {
    const port1 = await getFreePort();
    const srv1 = await spawnDesktopServer(port1);
    spawnedChildren.push(srv1.child);

    // Confirm production frontend HTML is served cleanly offline
    const htmlRes = await httpJson(port1, 'GET', '/');
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.raw).toContain('<!doctype html>');

    // First-run owner admin setup (empty production DB)
    const setupRes = await httpJson(port1, 'POST', '/api/system/setup-admin', {
      fullName: 'مالك القصر الذهبي',
      username: 'owner_p5e',
      email: 'owner@goldenpalace.dz',
      password: 'StrongPhase5Password!2026',
      pin: '8426',
    });
    expect(setupRes.status).toBe(201);
    const token = setupRes.body.token as string;
    expect(token).toBeTruthy();

    // Create category + product + open shift
    const catRes = await httpJson(
      port1,
      'POST',
      '/api/categories',
      { nameAr: 'أطباق رئيسية', nameFr: 'Plats Principaux', station: 'MAIN_KITCHEN' },
      token
    );
    expect(catRes.status).toBe(201);

    const prodRes = await httpJson(
      port1,
      'POST',
      '/api/products',
      {
        categoryId: catRes.body.id,
        nameAr: 'طاجين زيتون',
        nameFr: 'Tajine Zitoune',
        price: 850,
        station: 'MAIN_KITCHEN',
      },
      token
    );
    expect(prodRes.status).toBe(201);

    const shiftRes = await httpJson(port1, 'POST', '/api/cash-register/open', { openingCash: 5000 }, token);
    expect(shiftRes.status).toBe(201);

    // Offline order creation with UUID idempotency + duplicate protection
    const idempKey = crypto.randomUUID();
    const orderRes1 = await httpJson(
      port1,
      'POST',
      '/api/orders',
      {
        type: 'TAKEAWAY',
        offlineId: idempKey,
        idempotencyKey: idempKey,
        items: [{ productId: prodRes.body.id, quantity: 2 }],
      },
      token
    );
    expect(orderRes1.status).toBe(201);
    expect(Number(orderRes1.body.total)).toBe(1700);

    // Retry exact same idempotencyKey -> MUST NOT create duplicate order
    const orderResDup = await httpJson(
      port1,
      'POST',
      '/api/orders',
      {
        type: 'TAKEAWAY',
        offlineId: idempKey,
        idempotencyKey: idempKey,
        items: [{ productId: prodRes.body.id, quantity: 2 }],
      },
      token
    );
    expect([200, 201]).toContain(orderResDup.status);
    expect(orderResDup.body.id).toBe(orderRes1.body.id);

    // Settle payment
    const payRes = await httpJson(
      port1,
      'POST',
      '/api/payments',
      {
        orderId: orderRes1.body.id,
        payments: [{ method: 'CASH', amount: 1700 }],
        idempotencyKey: `pay-${idempKey}`,
      },
      token
    );
    expect(payRes.status).toBe(200);
    expect(payRes.body.paymentStatus).toBe('PAID');

    // Simulate failed thermal print on a closed TCP port with a >650-byte binary ESC/POS payload
    const deadPort = await getFreePort();
    const fullEscPos = Buffer.concat([
      Buffer.from([0x1b, 0x40, 0x1b, 0x74, 0x16]),
      Buffer.from(`ORDER:${orderRes1.body.orderNumber}:` + 'X'.repeat(620) + ':END_MARKER'),
      Buffer.from([0x1d, 0x56, 0x41, 0x03]),
    ]);
    const spoolFailRes = await httpJson(
      port1,
      'POST',
      '/api/printer/spool',
      {
        orderId: orderRes1.body.id,
        orderNumber: orderRes1.body.orderNumber,
        jobType: 'RECEIPT',
        printerName: 'LAN-80',
        connectionType: 'NETWORK_IP',
        targetIp: '127.0.0.1',
        targetPort: deadPort,
        rawBase64: fullEscPos.toString('base64'),
        payloadPreview: 'SHORT PREVIEW',
      },
      token
    );
    expect(spoolFailRes.status).toBe(502);
    expect(spoolFailRes.body.status).toBe('FAILED');
    const failedJobId = spoolFailRes.body.jobId as number;

    // Graceful IPC shutdown -> triggers automatic verified SHUTDOWN backup
    srv1.child.send({ type: 'shutdown' });
    const exit1 = await waitForExit(srv1.child);
    expect(exit1.code).toBe(0);

    // Verify SHUTDOWN backup exists with valid SHA-256 in manifest
    const manifestPath = path.join(ISOLATED_BACKUP_DIR, 'backup_manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const shutdownBackup = manifest.find((m: any) => m.type === 'SHUTDOWN' && m.status === 'VERIFIED');
    expect(shutdownBackup).toBeTruthy();
    expect(shutdownBackup.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(shutdownBackup.foreignKeyViolationsCount).toBe(0);

    // Restart fresh server process -> verify full order, invoice, session & print queue recovery
    const port2 = await getFreePort();
    const srv2 = await spawnDesktopServer(port2);
    spawnedChildren.push(srv2.child);

    const meRes = await httpJson(port2, 'GET', '/api/auth/me', undefined, token);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.username).toBe('owner_p5e');

    const ordersAfterRestart = await httpJson(port2, 'GET', '/api/orders', undefined, token);
    expect(ordersAfterRestart.status).toBe(200);
    expect(ordersAfterRestart.body.length).toBe(1);
    expect(Number(ordersAfterRestart.body[0].total)).toBe(1700);
    expect(ordersAfterRestart.body[0].paymentStatus).toBe('PAID');

    // Verify failed print job + full binary spool payload survived restart intact
    const jobsRes = await httpJson(port2, 'GET', '/api/printer/jobs', undefined, token);
    expect(jobsRes.status).toBe(200);
    const recoveredJob = jobsRes.body.find((j: any) => j.id === failedJobId);
    expect(recoveredJob).toBeTruthy();
    expect(recoveredJob.status).toBe('FAILED');

    const persistedSpoolFile = path.join(ISOLATED_ROOT, 'print_spool_payloads', `job_${failedJobId}.bin`);
    expect(fs.existsSync(persistedSpoolFile)).toBe(true);
    expect(fs.readFileSync(persistedSpoolFile).equals(fullEscPos)).toBe(true);

    // Cleanly stop server 2
    srv2.child.send({ type: 'shutdown' });
    const exit2 = await waitForExit(srv2.child);
    expect(exit2.code).toBe(0);
  }, 30000);

  it('2. Simulated unexpected power-loss / SIGKILL crash recovery preserves committed orders and SQLite WAL integrity', async () => {
    const port3 = await getFreePort();
    const srv3 = await spawnDesktopServer(port3);
    spawnedChildren.push(srv3.child);

    const loginRes = await httpJson(port3, 'POST', '/api/auth/login', {
      identifier: 'owner_p5e',
      password: 'StrongPhase5Password!2026',
    });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.token as string;

    const prodsRes = await httpJson(port3, 'GET', '/api/products', undefined, token);
    expect(prodsRes.status).toBe(200);
    const prodId = prodsRes.body[0].id;

    // Commit a new paid order right before hard crash
    const crashOrderKey = crypto.randomUUID();
    const crashOrder = await httpJson(
      port3,
      'POST',
      '/api/orders',
      {
        type: 'TAKEAWAY',
        offlineId: crashOrderKey,
        idempotencyKey: crashOrderKey,
        items: [{ productId: prodId, quantity: 1 }],
      },
      token
    );
    expect(crashOrder.status).toBe(201);

    const crashPay = await httpJson(
      port3,
      'POST',
      '/api/payments',
      {
        orderId: crashOrder.body.id,
        payments: [{ method: 'CASH', amount: 850 }],
        idempotencyKey: `pay-${crashOrderKey}`,
      },
      token
    );
    expect(crashPay.status).toBe(200);

    // Simulate sudden power failure: SIGKILL without graceful shutdown!
    srv3.child.kill('SIGKILL');
    const killExit = await waitForExit(srv3.child);
    expect(killExit.signal).toBe('SIGKILL');

    // Reboot fresh server process -> SQLite WAL must recover cleanly with zero corruption & zero lost orders
    const port4 = await getFreePort();
    const srv4 = await spawnDesktopServer(port4);
    spawnedChildren.push(srv4.child);

    const ordersAfterCrash = await httpJson(port4, 'GET', '/api/orders', undefined, token);
    expect(ordersAfterCrash.status).toBe(200);
    expect(ordersAfterCrash.body.length).toBe(2);
    const recoveredCrashOrder = ordersAfterCrash.body.find((o: any) => o.id === crashOrder.body.id);
    expect(recoveredCrashOrder).toBeTruthy();
    expect(recoveredCrashOrder.paymentStatus).toBe('PAID');

    srv4.child.send({ type: 'shutdown' });
    await waitForExit(srv4.child);

    // Direct SQLite verification: integrity_check === 'ok' and foreign_key_check === []
    const checkDb = new Database(ISOLATED_DB, { readonly: true });
    try {
      const integrity = checkDb.pragma('integrity_check') as { integrity_check: string }[];
      const fk = checkDb.pragma('foreign_key_check') as unknown[];
      expect(integrity).toEqual([{ integrity_check: 'ok' }]);
      expect(fk).toEqual([]);
      expect((checkDb.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c).toBe(2);
      expect((checkDb.prepare('SELECT COUNT(*) as c FROM payments').get() as any).c).toBe(2);
    } finally {
      checkDb.close();
    }
  }, 30000);

  it('3. Backup creation, SHA-256 validation, FK verification, corrupted/tampered rejection & zero-data-loss restore rollback', async () => {
    const { BackupManager, computeFileSha256 } = await import('../services/backupService.ts');

    let localDb = new Database(ISOLATED_DB);
    localDb.pragma('journal_mode = WAL');
    localDb.pragma('foreign_keys = ON');

    const mgr = new BackupManager({
      getDbPath: () => ISOLATED_DB,
      getBackupDir: () => ISOLATED_BACKUP_DIR,
      getSqlite: () => localDb,
      closeDb: () => {
        if (localDb && localDb.open) localDb.close();
      },
      reopenDb: (target) => {
        localDb = new Database(target || ISOLATED_DB);
        localDb.pragma('journal_mode = WAL');
        localDb.pragma('foreign_keys = ON');
        return localDb;
      },
    });

    try {
      // 3a. Create verified backup with SHA-256 + FK check
      const manualBackup = await mgr.createBackup('MANUAL', { skipRetention: true });
      expect(manualBackup.status).toBe('VERIFIED');
      expect(manualBackup.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manualBackup.foreignKeyViolationsCount).toBe(0);
      const manualPath = mgr.resolveSafeBackupPath(manualBackup.filename);
      expect(computeFileSha256(manualPath)).toBe(manualBackup.sha256);

      // 3b. Corrupted (non-SQLite garbage) backup rejected before touching live DB
      const corruptName = 'gp_pos_manual_corrupt_5e.db';
      fs.writeFileSync(path.join(ISOLATED_BACKUP_DIR, corruptName), Buffer.from('CORRUPTED_GARBAGE_BYTES'));
      const corruptCheck = mgr.verifyExistingBackup(corruptName);
      expect(corruptCheck.valid).toBe(false);
      expect(corruptCheck.status).toBe('CORRUPTED');
      await expect(mgr.restoreBackup(corruptName)).rejects.toThrow();

      // 3c. Silently tampered backup rejected by SHA-256 mismatch
      const tamperTarget = await mgr.createBackup('MANUAL', { skipRetention: true });
      const tamperPath = mgr.resolveSafeBackupPath(tamperTarget.filename);
      const tDb = new Database(tamperPath);
      tDb.prepare("INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES ('tampered', '1')").run();
      tDb.close();
      const tamperVerify = mgr.verifyExistingBackup(tamperTarget.filename);
      expect(tamperVerify.valid).toBe(false);
      expect(tamperVerify.integrityCheck).toBe('sha256_mismatch');
      await expect(mgr.restoreBackup(tamperTarget.filename)).rejects.toThrow(/SHA-256/);

      // 3d. Simulated restore failure (exhausted NTFS EBUSY lock) rolls back with ZERO data loss
      localDb
        .prepare("INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES ('phase5e_live_state', 'KEEP_ME_SAFE')")
        .run();
      await expect(
        mgr.restoreBackup(manualBackup.filename, {
          maxLockRetries: 3,
          retryDelayMs: 5,
          renameSync: () => {
            const err: NodeJS.ErrnoException = new Error('Simulated Windows file lock');
            err.code = 'EBUSY';
            throw err;
          },
        })
      ).rejects.toThrow(/التراجع تلقائياً/);

      const afterFailedRestore = localDb
        .prepare("SELECT value FROM restaurant_settings WHERE key = 'phase5e_live_state'")
        .get() as { value: string };
      expect(afterFailedRestore.value).toBe('KEEP_ME_SAFE');
      expect((localDb.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c).toBe(2);

      // 3e. Valid restore succeeds cleanly with post-restore integrity & FK checks
      const restored = await mgr.restoreBackup(manualBackup.filename, {
        maxLockRetries: 3,
        retryDelayMs: 5,
      });
      expect(restored.success).toBe(true);
      expect(restored.postRestoreVerification.valid).toBe(true);
      expect(restored.postRestoreVerification.integrityCheck).toBe('ok');
      expect(restored.postRestoreVerification.foreignKeyViolationsCount).toBe(0);
      expect((localDb.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c).toBe(2);
      expect((localDb.prepare('SELECT COUNT(*) as c FROM payments').get() as any).c).toBe(2);
    } finally {
      if (localDb && localDb.open) localDb.close();
    }
  });
});
