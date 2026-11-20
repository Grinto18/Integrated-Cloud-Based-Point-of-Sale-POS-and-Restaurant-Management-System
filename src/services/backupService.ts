import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { getBackupDirectory, getLocalDatabasePath } from '../db/sqlitePath.ts';
import { closeDatabase, reopenDatabase, sqlite as liveSqlite } from '../db/index.ts';
import { sanitizeErrorMessage } from '../utils/redact.ts';

export type BackupKind =
  | 'MANUAL'
  | 'DAILY'
  | 'WEEKLY'
  | 'SHUTDOWN'
  | 'PRE_RESTORE'
  | 'PRE_IMPORT'
  | 'PRE_MIGRATION'
  | 'SCHEDULED';
export type BackupHealthStatus = 'VERIFIED' | 'FAILED' | 'CORRUPTED' | 'UNVERIFIED';

export interface BackupRecordCounts {
  orders: number;
  order_items: number;
  payments: number;
  ingredients: number;
  users: number;
  products: number;
  cash_shifts: number;
}

export interface BackupVerificationResult {
  filename: string;
  filePath: string;
  valid: boolean;
  status: BackupHealthStatus;
  sizeBytes: number;
  integrityCheck: string;
  canOpen: boolean;
  missingTables: string[];
  recordCounts: BackupRecordCounts;
  verifiedAt: string;
  sha256?: string;
  foreignKeyViolationsCount?: number;
  error?: string;
}

export interface BackupManifestEntry {
  filename: string;
  type: BackupKind;
  createdAt: string;
  sizeBytes: number;
  status: BackupHealthStatus;
  integrityCheck: string;
  recordCounts?: BackupRecordCounts;
  verifiedAt?: string;
  durationMs?: number;
  sha256?: string;
  foreignKeyViolationsCount?: number;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  restoredFrom: string;
  preRestoreBackup: string;
  postRestoreVerification: BackupVerificationResult;
  restoredAt: string;
  lockRetryAttempts?: number;
}

export interface BackupManagerOptions {
  getDbPath: () => string;
  getBackupDir: () => string;
  getSqlite: () => Database.Database;
  closeDb: () => void;
  reopenDb: (targetPath?: string) => Database.Database;
  checkFreeBytes?: (dirPath: string) => number | null;
}

export const REQUIRED_BACKUP_TABLES = [
  'users',
  'categories',
  'products',
  'orders',
  'order_items',
  'payments',
  'ingredients',
  'cash_shifts',
  'restaurant_settings',
  'audit_logs',
] as const;

const SAFE_BACKUP_FILENAME_REGEX = /^[A-Za-z0-9_.-]+\.db$/;

export function formatBackupTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function getIsoWeekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function inferBackupTypeFromFilename(filename: string): BackupKind {
  const lower = filename.toLowerCase();
  if (lower.includes('_daily_')) return 'DAILY';
  if (lower.includes('_weekly_')) return 'WEEKLY';
  if (lower.includes('_shutdown_')) return 'SHUTDOWN';
  if (lower.includes('_pre_restore_')) return 'PRE_RESTORE';
  if (lower.includes('_pre_import_')) return 'PRE_IMPORT';
  if (lower.includes('_pre_migration_')) return 'PRE_MIGRATION';
  if (lower.includes('_scheduled_')) return 'SCHEDULED';
  return 'MANUAL';
}

export function getAvailableDiskBytes(dirPath: string): number | null {
  try {
    if (typeof (fs as any).statfsSync === 'function') {
      const stats = (fs as any).statfsSync(dirPath);
      if (stats && typeof stats.bavail === 'number' && typeof stats.bsize === 'number') {
        return stats.bavail * stats.bsize;
      }
      if (stats && typeof stats.bavail === 'bigint' && typeof stats.bsize === 'bigint') {
        return Number(stats.bavail * stats.bsize);
      }
    }
  } catch {
    // Ignore unsupported platform statfs errors
  }
  return null;
}

export function computeFileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

export const TRANSIENT_LOCK_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

export function isTransientLockError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === 'string' && TRANSIENT_LOCK_ERROR_CODES.has(code);
}

export async function runWithTransientLockRetry<T>(
  operation: () => T,
  options?: { maxAttempts?: number; baseDelayMs?: number }
): Promise<{ result: T; attempts: number }> {
  const maxAttempts = Math.max(1, Math.min(10, Number(options?.maxAttempts ?? 5)));
  const baseDelayMs = Math.max(0, Math.min(1000, Number(options?.baseDelayMs ?? 100)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = operation();
      return { result, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (!isTransientLockError(err) || attempt >= maxAttempts) {
        throw err;
      }
      const delayMs = Math.min(500, baseDelayMs * attempt);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

export class BackupManager {
  private readonly opts: BackupManagerOptions;
  private isBusy = false;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private shutdownCompleted = false;

  constructor(options: BackupManagerOptions) {
    this.opts = options;
  }

  private ensureBackupDir(): string {
    const backupDir = path.resolve(this.opts.getBackupDir());
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    }
    try {
      fs.chmodSync(backupDir, 0o700);
    } catch {
      // Ignore on non-POSIX filesystems
    }
    return backupDir;
  }

  public resolveSafeBackupPath(filename: string): string {
    const trimmed = String(filename || '').trim();
    if (
      !trimmed ||
      trimmed !== path.basename(trimmed) ||
      trimmed.includes('..') ||
      trimmed.includes('/') ||
      trimmed.includes('\\') ||
      !SAFE_BACKUP_FILENAME_REGEX.test(trimmed)
    ) {
      throw new Error('اسم ملف النسخة الاحتياطية غير صالح أو غير مصرح به');
    }
    const backupDir = this.ensureBackupDir();
    const resolved = path.resolve(backupDir, trimmed);
    if (!resolved.startsWith(backupDir + path.sep)) {
      throw new Error('مسار النسخة الاحتياطية خارج المجلد الآمن');
    }
    return resolved;
  }

  private getManifestPath(): string {
    return path.join(this.ensureBackupDir(), 'backup_manifest.json');
  }

  private readManifest(): BackupManifestEntry[] {
    const manifestPath = this.getManifestPath();
    if (!fs.existsSync(manifestPath)) return [];
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeManifest(entries: BackupManifestEntry[]): void {
    const manifestPath = this.getManifestPath();
    const tmpManifest = `${manifestPath}.tmp`;
    fs.writeFileSync(tmpManifest, JSON.stringify(entries, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpManifest, manifestPath);
  }

  private upsertManifestEntry(entry: BackupManifestEntry): void {
    const entries = this.readManifest().filter((e) => e.filename !== entry.filename);
    entries.unshift(entry);
    // Keep manifest concise (up to last 100 entries including failures)
    this.writeManifest(entries.slice(0, 100));
  }

  public cleanupOrphanTempFiles(): number {
    const backupDir = this.ensureBackupDir();
    let removed = 0;
    for (const file of fs.readdirSync(backupDir)) {
      if (file.includes('.tmp')) {
        try {
          fs.unlinkSync(path.join(backupDir, file));
          removed++;
        } catch {
          // ignore
        }
      }
    }
    return removed;
  }

  public verifyBackupFile(filePath: string, displayFilename?: string): BackupVerificationResult {
    const filename = displayFilename || path.basename(filePath);
    const verifiedAt = new Date().toISOString();
    const emptyCounts: BackupRecordCounts = {
      orders: 0,
      order_items: 0,
      payments: 0,
      ingredients: 0,
      users: 0,
      products: 0,
      cash_shifts: 0,
    };

    if (!fs.existsSync(filePath)) {
      return {
        filename,
        filePath,
        valid: false,
        status: 'CORRUPTED',
        sizeBytes: 0,
        integrityCheck: 'missing_file',
        canOpen: false,
        missingTables: [...REQUIRED_BACKUP_TABLES],
        recordCounts: emptyCounts,
        verifiedAt,
        error: 'ملف النسخة الاحتياطية غير موجود',
      };
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size === 0) {
      return {
        filename,
        filePath,
        valid: false,
        status: 'CORRUPTED',
        sizeBytes: stats.size || 0,
        integrityCheck: 'empty_file',
        canOpen: false,
        missingTables: [...REQUIRED_BACKUP_TABLES],
        recordCounts: emptyCounts,
        verifiedAt,
        error: 'ملف النسخة الاحتياطية فارغ أو غير صالح',
      };
    }

    let fileSha256: string | undefined;
    try {
      fileSha256 = computeFileSha256(filePath);
    } catch {
      fileSha256 = undefined;
    }

    let testDb: Database.Database | null = null;
    try {
      testDb = new Database(filePath, { readonly: true, fileMustExist: true });

      // Ensure SQLite header & schema are readable
      const tableRows = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      const presentTables = new Set(tableRows.map((t) => t.name));

      const missingTables = REQUIRED_BACKUP_TABLES.filter((tbl) => !presentTables.has(tbl));

      const integrityRows = testDb.pragma('integrity_check') as { integrity_check: string }[];
      const integrityVal =
        integrityRows.length === 1 && integrityRows[0]?.integrity_check === 'ok'
          ? 'ok'
          : integrityRows.map((r) => r.integrity_check).join('; ') || 'failed';

      const fkViolations = testDb.pragma('foreign_key_check') as unknown[];
      const foreignKeyViolationsCount = Array.isArray(fkViolations) ? fkViolations.length : 0;

      const countTable = (tbl: keyof BackupRecordCounts): number => {
        if (!presentTables.has(tbl)) return 0;
        const row = testDb!.prepare(`SELECT COUNT(*) as c FROM ${tbl}`).get() as { c: number };
        return Number(row?.c || 0);
      };

      const recordCounts: BackupRecordCounts = {
        orders: countTable('orders'),
        order_items: countTable('order_items'),
        payments: countTable('payments'),
        ingredients: countTable('ingredients'),
        users: countTable('users'),
        products: countTable('products'),
        cash_shifts: countTable('cash_shifts'),
      };

      const isValid = integrityVal === 'ok' && missingTables.length === 0 && foreignKeyViolationsCount === 0;
      const errDetail =
        integrityVal !== 'ok'
          ? `فشل فحص سلامة SQLite: ${integrityVal}`
          : missingTables.length > 0
            ? `جداول أساسية مفقودة: ${missingTables.join(', ')}`
            : foreignKeyViolationsCount > 0
              ? `فشل فحص سلامة العلاقات (Foreign Keys): تم اكتشاف ${foreignKeyViolationsCount} مخالفة مرجعية`
              : undefined;

      return {
        filename,
        filePath,
        valid: isValid,
        status: isValid ? 'VERIFIED' : 'CORRUPTED',
        sizeBytes: stats.size,
        integrityCheck: foreignKeyViolationsCount > 0 && integrityVal === 'ok' ? 'foreign_key_failed' : integrityVal,
        canOpen: true,
        missingTables,
        recordCounts,
        verifiedAt,
        sha256: fileSha256,
        foreignKeyViolationsCount,
        error: errDetail,
      };
    } catch (err: any) {
      return {
        filename,
        filePath,
        valid: false,
        status: 'CORRUPTED',
        sizeBytes: stats.size,
        integrityCheck: 'open_failed',
        canOpen: false,
        missingTables: [...REQUIRED_BACKUP_TABLES],
        recordCounts: emptyCounts,
        verifiedAt,
        sha256: fileSha256,
        error: sanitizeErrorMessage(err) || 'تعذر فتح قاعدة النسخة الاحتياطية (تالف)',
      };
    } finally {
      try {
        testDb?.close();
      } catch {
        // ignore
      }
    }
  }

  public verifyExistingBackup(filename: string): BackupVerificationResult {
    const safePath = this.resolveSafeBackupPath(filename);
    let result = this.verifyBackupFile(safePath, filename);
    const existingEntry = this.readManifest().find((m) => m.filename === filename);
    const stats = fs.existsSync(safePath) ? fs.statSync(safePath) : null;

    // Enforce SHA-256 tamper detection against recorded manifest digest (if present)
    const sha256Mismatch = Boolean(
      existingEntry?.sha256 && result.sha256 && existingEntry.sha256 !== result.sha256
    );
    if (sha256Mismatch) {
      result = {
        ...result,
        valid: false,
        status: 'CORRUPTED',
        integrityCheck: 'sha256_mismatch',
        error: 'فشل التحقق من بصمة SHA-256: ملف النسخة الاحتياطية تعرّض للتعديل أو التلف مقارنة بالسجل الأصلي',
      };
    }

    this.upsertManifestEntry({
      filename,
      type: existingEntry?.type || inferBackupTypeFromFilename(filename),
      createdAt: existingEntry?.createdAt || stats?.mtime.toISOString() || new Date().toISOString(),
      sizeBytes: result.sizeBytes,
      status: result.valid ? 'VERIFIED' : 'CORRUPTED',
      integrityCheck: result.integrityCheck,
      recordCounts: result.recordCounts,
      verifiedAt: result.verifiedAt,
      durationMs: existingEntry?.durationMs,
      // Preserve trusted original digest if tampered so subsequent checks keep flagging mismatch
      sha256: existingEntry?.sha256 || (result.valid ? result.sha256 : undefined),
      foreignKeyViolationsCount: result.foreignKeyViolationsCount,
      error: result.error,
    });

    return result;
  }

  public async createBackup(
    type: BackupKind = 'MANUAL',
    options?: {
      retentionCount?: number;
      skipRetention?: boolean;
      simulateInterruptionHook?: (tmpPath: string) => void;
    }
  ): Promise<BackupManifestEntry> {
    if (this.isBusy && type !== 'PRE_RESTORE') {
      throw new Error('عملية نسخ احتياطي أو استعادة قيد التنفيذ حالياً');
    }

    const acquireLock = !this.isBusy;
    if (acquireLock) this.isBusy = true;

    const startedAt = Date.now();
    const backupDir = this.ensureBackupDir();
    this.cleanupOrphanTempFiles();

    const stamp = formatBackupTimestamp(new Date());
    const uniqueSuffix = Math.random().toString(36).slice(2, 6);
    const filename = `gp_pos_${type.toLowerCase()}_${stamp}_${uniqueSuffix}.db`;
    const finalPath = this.resolveSafeBackupPath(filename);
    const tmpPath = `${finalPath}.tmp`;

    try {
      const dbPath = this.opts.getDbPath();
      const sourceDb = this.opts.getSqlite();
      if (!sourceDb || !sourceDb.open) {
        throw new Error('قاعدة البيانات غير متصلة حالياً');
      }

      // Check disk space before starting SQLite Backup API
      const dbStats = fs.existsSync(dbPath) ? fs.statSync(dbPath) : { size: 0 };
      const walPath = `${dbPath}-wal`;
      const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
      const estimatedRequiredBytes = Math.max(512 * 1024, Math.ceil((dbStats.size + walSize) * 1.1));
      const freeBytes = this.opts.checkFreeBytes
        ? this.opts.checkFreeBytes(backupDir)
        : getAvailableDiskBytes(backupDir);

      if (freeBytes !== null && freeBytes < estimatedRequiredBytes) {
        throw new Error(
          `مساحة القرص غير كافية لإنشاء النسخة الاحتياطية (المطلوب: ${Math.ceil(estimatedRequiredBytes / 1024)} KB، المتاح: ${Math.floor(freeBytes / 1024)} KB)`
        );
      }

      // Execute SQLite Online Backup API (WAL-safe atomic snapshot)
      await sourceDb.backup(tmpPath);

      if (options?.simulateInterruptionHook) {
        options.simulateInterruptionHook(tmpPath);
      }

      // Mandatory TASK 02 Verification BEFORE finalizing backup
      const verification = this.verifyBackupFile(tmpPath, filename);
      if (!verification.valid) {
        throw new Error(verification.error || 'فشل التحقق من سلامة النسخة الاحتياطية الجديدة');
      }

      // Atomic promotion after verification succeeds
      fs.renameSync(tmpPath, finalPath);
      try {
        fs.chmodSync(finalPath, 0o600);
      } catch {
        // Ignore on Windows
      }

      const entry: BackupManifestEntry = {
        filename,
        type,
        createdAt: new Date().toISOString(),
        sizeBytes: verification.sizeBytes,
        status: 'VERIFIED',
        integrityCheck: verification.integrityCheck,
        recordCounts: verification.recordCounts,
        verifiedAt: verification.verifiedAt,
        durationMs: Date.now() - startedAt,
        sha256: verification.sha256,
        foreignKeyViolationsCount: verification.foreignKeyViolationsCount ?? 0,
      };
      this.upsertManifestEntry(entry);

      if (!options?.skipRetention) {
        const retentionCount = Math.max(1, Number(options?.retentionCount || 14));
        this.applyRetentionPolicy(retentionCount);
      }

      return entry;
    } catch (err: any) {
      // Remove incomplete temp file immediately so no corrupt artifact poses as a valid backup
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }
      }
      const errMsg = sanitizeErrorMessage(err) || 'فشل إنشاء النسخة الاحتياطية';
      const failedEntry: BackupManifestEntry = {
        filename,
        type,
        createdAt: new Date().toISOString(),
        sizeBytes: 0,
        status: 'FAILED',
        integrityCheck: 'failed',
        durationMs: Date.now() - startedAt,
        error: errMsg,
      };
      this.upsertManifestEntry(failedEntry);
      throw new Error(errMsg);
    } finally {
      if (acquireLock) this.isBusy = false;
    }
  }

  public applyRetentionPolicy(retentionCount = 14): { deleted: string[]; kept: string[] } {
    const keepLimit = Math.max(1, Math.floor(retentionCount));
    const backups = this.listBackups().filter((b) => fs.existsSync(path.join(this.ensureBackupDir(), b.filename)));

    const verifiedOnly = backups
      .filter((b) => b.status === 'VERIFIED' || b.status === 'UNVERIFIED')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Strict protection: NEVER delete if <= 1 healthy backup exists
    if (verifiedOnly.length <= keepLimit || verifiedOnly.length <= 1) {
      return { deleted: [], kept: verifiedOnly.map((b) => b.filename) };
    }

    // Always pin the newest verified backup overall + latest DAILY + latest WEEKLY
    const pinned = new Set<string>();
    if (verifiedOnly[0]) pinned.add(verifiedOnly[0].filename);
    const latestDaily = verifiedOnly.find((b) => b.type === 'DAILY');
    if (latestDaily) pinned.add(latestDaily.filename);
    const latestWeekly = verifiedOnly.find((b) => b.type === 'WEEKLY');
    if (latestWeekly) pinned.add(latestWeekly.filename);

    const kept: string[] = [];
    const deleted: string[] = [];

    for (const item of verifiedOnly) {
      if (kept.length < keepLimit || pinned.has(item.filename)) {
        kept.push(item.filename);
      } else {
        // Double check we never leave 0 verified backups on disk
        if (kept.length === 0) {
          kept.push(item.filename);
          continue;
        }
        try {
          const targetPath = this.resolveSafeBackupPath(item.filename);
          fs.unlinkSync(targetPath);
          deleted.push(item.filename);
        } catch {
          kept.push(item.filename);
        }
      }
    }

    if (deleted.length > 0) {
      const deletedSet = new Set(deleted);
      const nextManifest = this.readManifest().filter((m) => !deletedSet.has(m.filename));
      this.writeManifest(nextManifest);
    }

    return { deleted, kept };
  }

  public listBackups(): BackupManifestEntry[] {
    const backupDir = this.ensureBackupDir();
    this.cleanupOrphanTempFiles();

    const filesOnDisk = fs
      .readdirSync(backupDir)
      .filter((f) => SAFE_BACKUP_FILENAME_REGEX.test(f));

    const manifest = this.readManifest();
    const manifestMap = new Map(manifest.map((m) => [m.filename, m]));

    const combined: BackupManifestEntry[] = filesOnDisk.map((filename) => {
      const filePath = path.join(backupDir, filename);
      const stats = fs.statSync(filePath);
      const existing = manifestMap.get(filename);
      if (existing) {
        return {
          ...existing,
          sizeBytes: stats.size,
        };
      }
      return {
        filename,
        type: inferBackupTypeFromFilename(filename),
        createdAt: stats.mtime.toISOString(),
        sizeBytes: stats.size,
        status: 'UNVERIFIED',
        integrityCheck: 'pending',
      };
    });

    // Include recent FAILED entries (without file on disk) at bottom/in log visibility so UI sees failure state if last backup failed
    const failedEntries = manifest.filter((m) => m.status === 'FAILED' && !filesOnDisk.includes(m.filename));
    return [...combined, ...failedEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async restoreBackup(
    filename: string,
    options?: {
      simulateSwapFailure?: () => void;
      renameSync?: (oldPath: string, newPath: string) => void;
      unlinkSync?: (targetPath: string) => void;
      maxLockRetries?: number;
      retryDelayMs?: number;
    }
  ): Promise<RestoreResult> {
    if (this.isBusy) {
      throw new Error('عملية صيانة أخرى قيد التنفيذ حالياً');
    }
    this.isBusy = true;

    const candidatePath = this.resolveSafeBackupPath(filename);
    const dbPath = path.resolve(this.opts.getDbPath());
    const stagingPath = `${dbPath}.restore-staging-${Date.now()}`;
    const performRename = options?.renameSync || ((src: string, dest: string) => fs.renameSync(src, dest));
    const performUnlink = options?.unlinkSync || ((target: string) => fs.unlinkSync(target));
    const lockRetryOpts = {
      maxAttempts: options?.maxLockRetries ?? 5,
      baseDelayMs: options?.retryDelayMs ?? 100,
    };
    let preRestoreEntry: BackupManifestEntry | null = null;
    let preRestorePath: string | null = null;

    try {
      // Step 1: Strictly verify candidate backup (including SHA-256 + integrity_check + FK check)
      // BEFORE touching or overwriting live DB
      const preCheck = this.verifyExistingBackup(filename);
      if (!preCheck.valid) {
        throw new Error(preCheck.error || 'النسخة الاحتياطية المختارة تالفة أو غير مكتملة وتم منع الاستعادة');
      }

      // Step 2: Create verified safety backup of current live DB before restore
      preRestoreEntry = await this.createBackup('PRE_RESTORE', { skipRetention: true });
      preRestorePath = this.resolveSafeBackupPath(preRestoreEntry.filename);

      // Step 3: Copy candidate to isolated staging path in DB directory and verify staging file
      fs.copyFileSync(candidatePath, stagingPath);
      const stagingCheck = this.verifyBackupFile(stagingPath, path.basename(stagingPath));
      if (!stagingCheck.valid) {
        throw new Error(stagingCheck.error || 'فشل التحقق من ملف التجهيز المؤقت للاستعادة');
      }

      // Step 4: Atomic close -> WAL cleanup -> rename (with bounded Windows NTFS lock retry) -> reopen -> post-restore verify
      try {
        this.opts.closeDb();

        if (options?.simulateSwapFailure) {
          options.simulateSwapFailure();
        }

        for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
          if (fs.existsSync(sidecar)) {
            await runWithTransientLockRetry(() => performUnlink(sidecar), lockRetryOpts);
          }
        }

        const swapOutcome = await runWithTransientLockRetry(
          () => performRename(stagingPath, dbPath),
          lockRetryOpts
        );

        const reopened = this.opts.reopenDb(dbPath);
        const postRows = reopened.pragma('integrity_check') as { integrity_check: string }[];
        if (!(postRows.length === 1 && postRows[0]?.integrity_check === 'ok')) {
          throw new Error('فشل فحص السلامة بعد الاستعادة');
        }

        const postVerification = this.verifyBackupFile(dbPath, path.basename(dbPath));
        if (!postVerification.valid) {
          throw new Error(postVerification.error || 'قاعدة البيانات المستعادة غير مكتملة الجداول');
        }

        return {
          success: true,
          restoredFrom: filename,
          preRestoreBackup: preRestoreEntry.filename,
          postRestoreVerification: postVerification,
          restoredAt: new Date().toISOString(),
          lockRetryAttempts: swapOutcome.attempts,
        };
      } catch (swapErr: any) {
        // Automatic Disaster Rollback to Pre-Restore Safety Backup
        try {
          this.opts.closeDb();
          for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
            if (fs.existsSync(sidecar)) {
              await runWithTransientLockRetry(() => fs.unlinkSync(sidecar), lockRetryOpts);
            }
          }
          if (preRestorePath && fs.existsSync(preRestorePath)) {
            await runWithTransientLockRetry(() => fs.copyFileSync(preRestorePath!, dbPath), lockRetryOpts);
          }
          this.opts.reopenDb(dbPath);
        } catch (rollbackErr: any) {
          throw new Error(
            `فشلت الاستعادة وتعذر التراجع الكامل: ${sanitizeErrorMessage(rollbackErr)} (الأصل: ${sanitizeErrorMessage(swapErr)})`
          );
        }
        throw new Error(
          `فشلت عملية الاستعادة وتم التراجع تلقائياً إلى قاعدة البيانات السابقة بأمان: ${sanitizeErrorMessage(swapErr)}`
        );
      }
    } finally {
      if (fs.existsSync(stagingPath)) {
        try {
          fs.unlinkSync(stagingPath);
        } catch {
          // ignore
        }
      }
      this.isBusy = false;
    }
  }

  public async checkAndRunScheduledBackups(config?: {
    autoEnabled?: boolean;
    intervalHours?: number;
    retentionCount?: number;
  }): Promise<{ ran: BackupKind[]; errors: string[] }> {
    const autoEnabled = config?.autoEnabled !== false;
    if (!autoEnabled || this.isBusy) return { ran: [], errors: [] };

    const intervalHours = Math.max(1, Number(config?.intervalHours || 6));
    const retentionCount = Math.max(1, Number(config?.retentionCount || 14));
    const now = new Date();
    const todayPrefix = now.toISOString().slice(0, 10);
    const currentWeek = getIsoWeekKey(now);

    const existing = this.listBackups().filter((b) => b.status === 'VERIFIED');
    const ran: BackupKind[] = [];
    const errors: string[] = [];

    const hasDailyToday = existing.some((b) => b.type === 'DAILY' && b.createdAt.startsWith(todayPrefix));
    const hasWeeklyNow = existing.some((b) => b.type === 'WEEKLY' && getIsoWeekKey(new Date(b.createdAt)) === currentWeek);
    const latestPeriodic = existing.find((b) => b.type !== 'PRE_RESTORE');
    const hoursSinceLast = latestPeriodic
      ? (now.getTime() - new Date(latestPeriodic.createdAt).getTime()) / (1000 * 60 * 60)
      : Infinity;

    if (!hasDailyToday) {
      try {
        await this.createBackup('DAILY', { retentionCount });
        ran.push('DAILY');
      } catch (err: any) {
        errors.push(sanitizeErrorMessage(err));
      }
    }

    if (!hasWeeklyNow) {
      try {
        await this.createBackup('WEEKLY', { retentionCount });
        ran.push('WEEKLY');
      } catch (err: any) {
        errors.push(sanitizeErrorMessage(err));
      }
    }

    if (ran.length === 0 && hoursSinceLast >= intervalHours) {
      try {
        await this.createBackup('SCHEDULED', { retentionCount });
        ran.push('SCHEDULED');
      } catch (err: any) {
        errors.push(sanitizeErrorMessage(err));
      }
    }

    return { ran, errors };
  }

  public startScheduler(getConfig: () => { autoEnabled: boolean; intervalHours: number; retentionCount: number }): void {
    this.stopScheduler();
    // Periodic check every 30 minutes (does not prevent Node exit due to unref())
    this.schedulerTimer = setInterval(() => {
      const cfg = getConfig();
      this.checkAndRunScheduledBackups(cfg).catch((err) => {
        console.error('Scheduled backup note:', sanitizeErrorMessage(err));
      });
    }, 30 * 60 * 1000);

    if (typeof (this.schedulerTimer as any).unref === 'function') {
      (this.schedulerTimer as any).unref();
    }
  }

  public stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  public async runShutdownBackup(retentionCount = 14): Promise<BackupManifestEntry | null> {
    if (this.shutdownCompleted) return null;
    this.shutdownCompleted = true;
    this.stopScheduler();
    try {
      const sourceDb = this.opts.getSqlite();
      if (!sourceDb || !sourceDb.open) return null;
      return await this.createBackup('SHUTDOWN', { retentionCount });
    } catch (err: any) {
      console.error('Shutdown backup note:', sanitizeErrorMessage(err));
      return null;
    }
  }
}

export const backupManager = new BackupManager({
  getDbPath: () => getLocalDatabasePath(),
  getBackupDir: () => getBackupDirectory(),
  getSqlite: () => liveSqlite,
  closeDb: () => closeDatabase(),
  reopenDb: (targetPath) => reopenDatabase(targetPath),
});
