// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';

const ACCEPTANCE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase12_accept_'));
const ACCEPTANCE_DB = path.join(ACCEPTANCE_ROOT, 'golden_palace_production.db');
const ACCEPTANCE_BACKUP_DIR = path.join(ACCEPTANCE_ROOT, 'backups_production');
const DISPOSABLE_RESTORE_ROOT = path.join(ACCEPTANCE_ROOT, 'disposable_restore');
const DISPOSABLE_RESTORE_DB = path.join(DISPOSABLE_RESTORE_ROOT, 'disposable_target.db');

process.env.SQLITE_DB_PATH = ACCEPTANCE_DB;
process.env.GOLDEN_PALACE_BACKUP_DIR = ACCEPTANCE_BACKUP_DIR;
process.env.GOLDEN_PALACE_DB_MODE = 'production';
process.env.GOLDEN_PALACE_DESKTOP = '1';
process.env.NODE_ENV = 'production';
delete process.env.JWT_SECRET;

describe('Golden Palace POS — Phase 12 Windows Desktop Release & Acceptance Tests', () => {
  let sqlite: Database.Database;
  let closeDatabase: () => void;
  let reopenDatabase: (p?: string) => Database.Database;
  let app: express.Express;

  beforeAll(async () => {
    const authMod = await import('../middleware/auth.ts');
    authMod.ensureServerRuntimeJwtSecret();

    const dbMod = await import('../db/index.ts');
    sqlite = dbMod.sqlite;
    closeDatabase = dbMod.closeDatabase;
    reopenDatabase = dbMod.reopenDatabase;

    expect(sqlite.name).toBe(ACCEPTANCE_DB);
    expect(sqlite.name).not.toContain('golden_palace.db');

    const { apiRouter } = await import('../server/api.ts');
    app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
  });

  afterAll(() => {
    try {
      closeDatabase?.();
    } catch {
      // ignore
    }
    fs.rmSync(ACCEPTANCE_ROOT, { recursive: true, force: true });
  });

  it('1. Packaging & Native Electron 22 Configuration: installer metadata, icons, workflow & better-sqlite3 ABI compatibility', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    const yml = fs.readFileSync(path.resolve(process.cwd(), 'electron-builder.yml'), 'utf8');
    const workflow = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/build-windows.yml'), 'utf8');
    const mainCjs = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');

    // Electron 22 + NSIS artifact naming & appData preservation
    expect(pkg.version).toBe('1.0.0');
    expect(pkg.main).toBe('electron/main.cjs');
    expect(pkg.devDependencies.electron).toMatch(/^\^?22\./);
    expect(pkg.devDependencies['@electron/rebuild']).toBeTruthy();
    expect(pkg.scripts['rebuild:electron']).toContain('22.3.27');
    expect(pkg.scripts['pack:win']).toContain('electron-builder --win --x64 --publish never');

    expect(yml).toContain('target: nsis');
    expect(yml).toContain('- x64');
    expect(yml).toContain('artifactName: GOLDEN-PALACE-POS-Setup-${version}-${arch}.${ext}');
    expect(yml).toContain('deleteAppDataOnUninstall: false');
    expect(yml).toContain('npmRebuild: true');
    expect(yml).toContain('node_modules/better-sqlite3/**/*');
    expect(yml).toContain('node_modules/bindings/**/*');
    expect(yml).toContain('icon: build/icon.ico');

    // Check binary icons exist with valid PNG & ICO signatures
    const pngPath = path.resolve(process.cwd(), 'build/icon.png');
    const icoPath = path.resolve(process.cwd(), 'build/icon.ico');
    expect(fs.existsSync(pngPath)).toBe(true);
    expect(fs.existsSync(icoPath)).toBe(true);
    const pngHeader = fs.readFileSync(pngPath).subarray(0, 4);
    const icoHeader = fs.readFileSync(icoPath).subarray(0, 4);
    expect(Array.from(pngHeader)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(Array.from(icoHeader)).toEqual([0x00, 0x00, 0x01, 0x00]);

    // better-sqlite3 < 13 ensures Electron 22 Node 16 / ABI 110 compatibility (no NAPI_VERSION=10 / node>=22 lock)
    const sqlitePkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'node_modules/better-sqlite3/package.json'), 'utf8')
    );
    const major = Number(String(sqlitePkg.version).split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(9);
    expect(major).toBeLessThan(13);
    expect(sqlitePkg.gypfile).not.toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), 'node_modules/better-sqlite3/binding.gyp'))).toBe(true);

    // GitHub Actions Windows runner workflow validation
    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('electron-rebuild -f -w better-sqlite3 -v 22.3.27');
    expect(workflow).toContain('GOLDEN-PALACE-POS-Setup-1.0.0-x64.exe');

    // Electron userData path & production DB separation
    expect(mainCjs).toContain("app.setName('Golden Palace POS')");
    expect(mainCjs).toContain("app.getPath('userData')");
    expect(mainCjs).toContain('golden_palace_production.db');
    expect(mainCjs).toContain('backups_production');
  });

  it('2. Fresh Install -> First Admin -> Offline Order -> Shutdown Backup -> App Restart & Upgrade Persistence -> Disposable Restore', async () => {
    // 2a. Verify zero demo data on fresh launch
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM users').get() as any).c).toBe(0);
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM products').get() as any).c).toBe(0);
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c).toBe(0);

    // 2b. First Administrator creation
    const adminSetup = await request(app).post('/api/system/setup-admin').send({
      fullName: 'مالك المطعم',
      username: 'owner_dz',
      email: 'owner@goldenpalace.dz',
      password: 'StrongDesktopPassword!2026',
      pin: '7391',
    });
    expect(adminSetup.status).toBe(201);
    const adminToken = adminSetup.body.token as string;
    expect(adminToken).toBeTruthy();

    // 2c. Add real menu category, product, open shift, and sync an offline order
    const catRes = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nameAr: 'مشويات', nameFr: 'Grillades', station: 'GRILL' });
    expect(catRes.status).toBe(201);

    const prodRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        categoryId: catRes.body.id,
        nameAr: 'طاكوس دجاج',
        nameFr: 'Tacos Poulet',
        price: 750,
        station: 'GRILL',
      });
    expect(prodRes.status).toBe(201);

    const shiftRes = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingCash: 5000 });
    expect(shiftRes.status).toBe(201);

    const offlineUuid = '12345678-1234-4123-8123-123456789012';
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        offlineId: offlineUuid,
        idempotencyKey: offlineUuid,
        items: [{ productId: prodRes.body.id, quantity: 2 }],
      });
    expect(orderRes.status).toBe(201);

    const payRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        orderId: orderRes.body.id,
        payments: [{ method: 'CASH', amount: Number(orderRes.body.total) }],
        idempotencyKey: 'p12-pay-1',
      });
    expect(payRes.status).toBe(200);
    expect(payRes.body.paymentStatus).toBe('PAID');

    // 2d. Simulate safe app shutdown + Windows reboot + restart
    const { backupManager } = await import('../services/backupService.ts');
    const shutdownEntry = await backupManager.runShutdownBackup(14);
    expect(shutdownEntry).toBeTruthy();
    expect(shutdownEntry!.status).toBe('VERIFIED');
    expect(shutdownEntry!.integrityCheck).toBe('ok');

    closeDatabase();
    sqlite = reopenDatabase(ACCEPTANCE_DB);

    const { runFirstRunDatabaseAudit, prepareSafeApplicationUpdate } = await import('../services/desktopLifecycle.ts');
    const postRebootAudit = runFirstRunDatabaseAudit(sqlite);
    expect(postRebootAudit.integrityCheck).toBe('ok');
    expect(postRebootAudit.usersCount).toBe(1);
    expect(postRebootAudit.pendingFinancialOps.openShiftsCount).toBe(1);

    // Pre-restart JWT stays valid because .jwt_secret persisted in desktop userData dir
    const meAfterReboot = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(meAfterReboot.status).toBe(200);
    expect(meAfterReboot.body.user.username).toBe('owner_dz');

    // 2e. Upgrade gate blocks while shift open, then succeeds once shift closed without data loss
    const blockedUpgrade = await prepareSafeApplicationUpdate(sqlite, backupManager, {
      currentVersion: '1.0.0',
      targetVersion: '1.1.0',
    });
    expect(blockedUpgrade.allowed).toBe(false);

    const closeShiftRes = await request(app)
      .post('/api/cash-register/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shiftId: shiftRes.body.id, closingCash: 6500 });
    expect(closeShiftRes.status).toBe(200);

    const safeUpgrade = await prepareSafeApplicationUpdate(sqlite, backupManager, {
      currentVersion: '1.0.0',
      targetVersion: '1.1.0',
    });
    expect(safeUpgrade.allowed).toBe(true);
    expect(safeUpgrade.schemaStatus.integrityCheck).toBe('ok');

    // Verify order & financial data intact across restart + upgrade
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c).toBe(1);
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM payments').get() as any).c).toBe(1);

    // 2f. Backup restoration verification on a strictly disposable test DB (never modifying prod data)
    fs.mkdirSync(DISPOSABLE_RESTORE_ROOT, { recursive: true });
    let disposableDb = new Database(DISPOSABLE_RESTORE_DB);
    const { BackupManager } = await import('../services/backupService.ts');
    const disposableMgr = new BackupManager({
      getDbPath: () => DISPOSABLE_RESTORE_DB,
      getBackupDir: () => ACCEPTANCE_BACKUP_DIR,
      getSqlite: () => disposableDb,
      closeDb: () => {
        try {
          disposableDb.close();
        } catch {
          // ignore
        }
      },
      reopenDb: (targetPath?: string) => {
        disposableDb = new Database(targetPath || DISPOSABLE_RESTORE_DB);
        return disposableDb;
      },
    });
    // Ensure disposable DB has minimal tables before PRE_RESTORE snapshot step
    const { ensureBaseSchema, runSafeMigrations } = await import('../db/index.ts');
    ensureBaseSchema(disposableDb);
    runSafeMigrations(disposableDb);

    const restoreResult = await disposableMgr.restoreBackup(shutdownEntry!.filename);
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.postRestoreVerification.integrityCheck).toBe('ok');
    expect((disposableDb.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c).toBe(1);
    expect((disposableDb.prepare('SELECT COUNT(*) as c FROM users').get() as any).c).toBe(1);
    disposableDb.close();
  });

  it('3. Bilingual Arabic RTL / French LTR ESC/POS & Security Isolation Audit', async () => {
    // Verify Arabic connected-letter shaping + French bilingual formatting (58mm & 80mm)
    const {
      buildArabicTestEscPos,
      encodeEscPosLine,
      formatTwoColLine,
      getColumnsForPaper,
    } = await import('../utils/escposArabic.ts');

    expect(getColumnsForPaper('80mm')).toBe(48);
    expect(getColumnsForPaper('58mm')).toBe(32);

    const line80 = formatTwoColLine('Tacos Poulet / طاكوس دجاج', '1,500 DA', 48);
    const line58 = formatTwoColLine('Tacos Poulet', '1,500 DA', 32);
    expect(line80.length).toBeLessThanOrEqual(48);
    expect(line58.length).toBeLessThanOrEqual(32);

    const bytes80 = buildArabicTestEscPos({ paperType: '80mm', arabicEncoding: 'CP864', printerName: 'CAFETERIA' });
    const bytes58 = buildArabicTestEscPos({ paperType: '58mm', arabicEncoding: 'UTF8', printerName: 'XP-58' });
    expect(bytes80.length).toBeGreaterThan(100);
    expect(bytes58.length).toBeGreaterThan(100);
    expect(encodeEscPosLine('*** REPRINT / DUPLICATA ***', 'UTF8').length).toBeGreaterThan(10);

    // Electron renderer isolation + zero secrets in preload or built frontend bundle
    const mainCjs = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
    const preloadCjs = fs.readFileSync(path.resolve(process.cwd(), 'electron/preload.cjs'), 'utf8');
    expect(mainCjs).toContain('contextIsolation: true');
    expect(mainCjs).toContain('nodeIntegration: false');
    expect(preloadCjs).not.toContain('jwtSecret');
    expect(preloadCjs).not.toContain('JWT_SECRET');

    const distAssetsDir = path.resolve(process.cwd(), 'dist/assets');
    if (fs.existsSync(distAssetsDir)) {
      const secretContent = fs.readFileSync(path.join(ACCEPTANCE_ROOT, '.jwt_secret'), 'utf8').trim();
      for (const file of fs.readdirSync(distAssetsDir)) {
        if (!file.endsWith('.js')) continue;
        const js = fs.readFileSync(path.join(distAssetsDir, file), 'utf8');
        expect(js).not.toContain('golden-palace-pos-super-secure-key-2026');
        expect(js).not.toContain('grine-restaurant-pos-super-secure-key');
        expect(js).not.toContain(secretContent);
      }
    }
  });
});
