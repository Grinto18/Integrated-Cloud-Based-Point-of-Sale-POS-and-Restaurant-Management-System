import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { getDesktopStoragePaths } from '../db/sqlitePath.ts';
import { runSafeMigrations, migratePlaintextPins } from '../db/index.ts';
import { REQUIRED_BACKUP_TABLES, BackupManager } from './backupService.ts';
import type { DesktopRuntimeStatus } from '../types.ts';

function checkDirectoryWritable(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const probeFile = path.join(dirPath, `.write_probe_${process.pid}_${Date.now()}.tmp`);
    fs.writeFileSync(probeFile, 'ok', 'utf8');
    fs.unlinkSync(probeFile);
    return true;
  } catch {
    return false;
  }
}

export function checkPendingFinancialOperations(targetDb: Database.Database): {
  openShiftsCount: number;
  unpaidActiveOrdersCount: number;
  openSyncConflictsCount: number;
  pendingPrintJobsCount: number;
  canUpdateSafely: boolean;
  blockingReasons: string[];
} {
  let openShiftsCount = 0;
  let unpaidActiveOrdersCount = 0;
  let openSyncConflictsCount = 0;
  let pendingPrintJobsCount = 0;

  const safeCount = (sqlStr: string): number => {
    try {
      const row = targetDb.prepare(sqlStr).get() as { c: number } | undefined;
      return Number(row?.c || 0);
    } catch {
      return 0;
    }
  };

  openShiftsCount = safeCount("SELECT COUNT(*) as c FROM cash_shifts WHERE status = 'OPEN'");
  unpaidActiveOrdersCount = safeCount(
    "SELECT COUNT(*) as c FROM orders WHERE payment_status IN ('UNPAID', 'PARTIALLY_PAID') AND status NOT IN ('CANCELLED', 'REFUNDED')"
  );
  openSyncConflictsCount = safeCount("SELECT COUNT(*) as c FROM sync_conflicts WHERE status = 'OPEN'");
  pendingPrintJobsCount = safeCount("SELECT COUNT(*) as c FROM print_jobs WHERE status IN ('PENDING', 'PROCESSING')");

  const blockingReasons: string[] = [];
  if (openShiftsCount > 0) {
    blockingReasons.push(`توجد ${openShiftsCount} وردية صندوق مفتوحة لم تُغلق بعد`);
  }
  if (unpaidActiveOrdersCount > 0) {
    blockingReasons.push(`توجد ${unpaidActiveOrdersCount} طلبات نشطة غير مدفوعة بالكامل`);
  }
  if (openSyncConflictsCount > 0) {
    blockingReasons.push(`توجد ${openSyncConflictsCount} تعارضات مزامنة مفتوحة لم تُحل`);
  }

  return {
    openShiftsCount,
    unpaidActiveOrdersCount,
    openSyncConflictsCount,
    pendingPrintJobsCount,
    canUpdateSafely: blockingReasons.length === 0,
    blockingReasons,
  };
}

export function getDesktopRuntimeStatus(
  targetDb: Database.Database,
  options: { appVersion?: string; isDesktop?: boolean } = {}
): DesktopRuntimeStatus {
  const paths = getDesktopStoragePaths();
  const dbExists = fs.existsSync(paths.dbPath);
  const dbSizeBytes = dbExists ? fs.statSync(paths.dbPath).size : 0;
  const dbWritable = checkDirectoryWritable(paths.appDataDir);
  const backupDirExists = fs.existsSync(paths.backupDir);
  const backupDirWritable = checkDirectoryWritable(paths.backupDir);

  let integrityCheck = 'unknown';
  let presentTables: string[] = [];
  let usersCount = 0;

  try {
    const integrityRows = targetDb.pragma('integrity_check') as { integrity_check: string }[];
    integrityCheck =
      integrityRows.length === 1 && integrityRows[0]?.integrity_check === 'ok'
        ? 'ok'
        : integrityRows.map((r) => r.integrity_check).join('; ') || 'failed';

    const tbls = targetDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    presentTables = tbls.map((t) => t.name);

    if (presentTables.includes('users')) {
      const uRow = targetDb.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
      usersCount = Number(uRow?.c || 0);
    }
  } catch (err: any) {
    integrityCheck = err?.message || 'error';
  }

  const presentSet = new Set(presentTables);
  const missingTables = REQUIRED_BACKUP_TABLES.filter((tbl) => !presentSet.has(tbl));

  return {
    appName: 'GOLDEN PALACE POS',
    appVersion: options.appVersion || process.env.npm_package_version || '1.0.0',
    platform: paths.platform,
    isDesktop: Boolean(options.isDesktop ?? process.env.GOLDEN_PALACE_DESKTOP === '1'),
    appDataDir: paths.appDataDir,
    dbPath: paths.dbPath,
    dbExists,
    dbSizeBytes,
    dbWritable,
    backupDir: paths.backupDir,
    backupDirExists,
    backupDirWritable,
    integrityCheck,
    tablesCount: presentTables.length,
    missingTables: [...missingTables],
    usersCount,
    needsInitialAdminSetup: usersCount === 0,
    pendingFinancialOps: checkPendingFinancialOperations(targetDb),
  };
}

/**
 * Safely initializes or upgrades an existing user database on first launch / update:
 * - Never recreates or overwrites an existing database
 * - Runs non-destructive safe schema migrations only
 * - Never injects default users or default PINs
 */
export function runFirstRunDatabaseAudit(targetDb: Database.Database): DesktopRuntimeStatus {
  runSafeMigrations(targetDb);
  migratePlaintextPins(targetDb);
  return getDesktopRuntimeStatus(targetDb);
}

/**
 * Safe Update Gate & Pre-Update Backup Manifest:
 * - Blocks update if incomplete financial operations (open shifts / unpaid orders / open conflicts) exist
 * - Creates and verifies a SQLite Online Backup before allowing upgrade
 * - Records rollback metadata pointing to previous version + verified backup file
 */
export async function prepareSafeApplicationUpdate(
  targetDb: Database.Database,
  backupMgr: BackupManager,
  options: { currentVersion: string; targetVersion: string; forceIgnoreOpenOps?: boolean }
): Promise<{
  allowed: boolean;
  blockingReasons: string[];
  preUpdateBackup?: any;
  schemaStatus: {
    integrityCheck: string;
    missingTables: string[];
  };
  rollbackManifestPath?: string;
}> {
  const status = getDesktopRuntimeStatus(targetDb, { appVersion: options.currentVersion });
  if (!status.dbWritable || !status.backupDirWritable) {
    return {
      allowed: false,
      blockingReasons: ['مجلد قاعدة البيانات أو النسخ الاحتياطي غير قابل للكتابة'],
      schemaStatus: {
        integrityCheck: status.integrityCheck,
        missingTables: status.missingTables,
      },
    };
  }

  if (!options.forceIgnoreOpenOps && !status.pendingFinancialOps.canUpdateSafely) {
    return {
      allowed: false,
      blockingReasons: status.pendingFinancialOps.blockingReasons,
      schemaStatus: {
        integrityCheck: status.integrityCheck,
        missingTables: status.missingTables,
      },
    };
  }

  const backupEntry = await backupMgr.createBackup('PRE_RESTORE', status.pendingFinancialOps.pendingPrintJobsCount >= 0 ? undefined : undefined);
  if (backupEntry.status !== 'VERIFIED' || backupEntry.integrityCheck !== 'ok') {
    return {
      allowed: false,
      blockingReasons: ['فشل إنشاء أو التحقق من النسخة الاحتياطية قبل التحديث'],
      schemaStatus: {
        integrityCheck: status.integrityCheck,
        missingTables: status.missingTables,
      },
    };
  }

  const manifestPath = path.join(status.backupDir, 'update_recovery_manifest.json');
  const manifestData = {
    previousVersion: options.currentVersion,
    targetVersion: options.targetVersion,
    preUpdateBackupFilename: backupEntry.filename,
    integrityCheck: backupEntry.integrityCheck,
    dbPath: status.dbPath,
    preparedAt: new Date().toISOString(),
    rollbackCommand: 'RESTORE_PRE_UPDATE_BACKUP',
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf8');

  return {
    allowed: true,
    blockingReasons: [],
    preUpdateBackup: backupEntry,
    schemaStatus: {
      integrityCheck: status.integrityCheck,
      missingTables: status.missingTables,
    },
    rollbackManifestPath: manifestPath,
  };
}
