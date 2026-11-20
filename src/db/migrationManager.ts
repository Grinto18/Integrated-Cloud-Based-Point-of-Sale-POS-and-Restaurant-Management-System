import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import {
  CONFIRMED_DB_PATH_ENV,
  DEV_DB_FILENAME,
  PRODUCTION_DB_FILENAME,
  isProductionDatabaseMode,
} from './sqlitePath.ts';

export const LATEST_SCHEMA_VERSION = 4;

const POS_SIGNATURE_TABLES = [
  'users',
  'orders',
  'products',
  'categories',
  'payments',
  'cash_shifts',
] as const;

const BUSINESS_DATA_TABLES = [
  'users',
  'categories',
  'products',
  'orders',
  'order_items',
  'payments',
  'cash_shifts',
  'ingredients',
  'customers',
  'expenses',
] as const;

export interface DatabaseCandidateInfo {
  filePath: string;
  filename: string;
  sizeBytes: number;
  modifiedAt: string;
  canOpen: boolean;
  isPosDatabase: boolean;
  integrityCheck: string;
  userVersion: number;
  tableCount: number;
  recordCounts: {
    users: number;
    categories: number;
    products: number;
    orders: number;
    payments: number;
    cashShifts: number;
  };
  hasBusinessData: boolean;
  error?: string;
}

export interface DatabaseIdentificationReport {
  generatedAt: string;
  targetDbPath: string;
  targetDir: string;
  isProductionMode: boolean;
  reasonCode: 'MULTIPLE_POS_DATABASES' | 'HISTORICAL_DB_WOULD_BE_BYPASSED';
  message: string;
  candidates: DatabaseCandidateInfo[];
  ownerActionRequired: string;
  confirmationEnvVar: string;
}

export class DatabaseConflictError extends Error {
  public readonly code = 'DATABASE_CONFLICT_REQUIRES_OWNER_CONFIRMATION';
  public readonly report: DatabaseIdentificationReport;
  public readonly reportPath: string | null;

  constructor(report: DatabaseIdentificationReport, reportPath: string | null) {
    super(report.message);
    this.name = 'DatabaseConflictError';
    this.report = report;
    this.reportPath = reportPath;
  }
}

export class DatabaseMigrationError extends Error {
  public readonly code:
    | 'DATABASE_CORRUPTED'
    | 'PRE_MIGRATION_BACKUP_FAILED'
    | 'MIGRATION_FAILED'
    | 'POST_MIGRATION_INTEGRITY_FAILED'
    | 'ROLLBACK_FAILED';
  public readonly version?: number;
  public readonly migrationName?: string;
  public readonly preMigrationBackupPath?: string | null;
  public readonly rolledBack: boolean;

  constructor(
    message: string,
    options: {
      code:
        | 'DATABASE_CORRUPTED'
        | 'PRE_MIGRATION_BACKUP_FAILED'
        | 'MIGRATION_FAILED'
        | 'POST_MIGRATION_INTEGRITY_FAILED'
        | 'ROLLBACK_FAILED';
      version?: number;
      migrationName?: string;
      preMigrationBackupPath?: string | null;
      rolledBack?: boolean;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'DatabaseMigrationError';
    this.code = options.code;
    this.version = options.version;
    this.migrationName = options.migrationName;
    this.preMigrationBackupPath = options.preMigrationBackupPath ?? null;
    this.rolledBack = Boolean(options.rolledBack);
    if (options.cause !== undefined) {
      (this as any).cause = options.cause;
    }
  }
}

export interface IntegrityCheckResult {
  ok: boolean;
  integrityCheck: string;
  foreignKeyViolations: any[];
}

export interface PreMigrationBackupResult {
  backupPath: string;
  filename: string;
  sizeBytes: number;
  integrityCheck: string;
  foreignKeyViolations: any[];
  createdAt: string;
}

export interface MigrationStepDefinition {
  version: number;
  name: string;
  description: string;
  apply: (db: Database.Database) => void;
}

export interface MigrationRunResult {
  dbPath: string;
  previousVersion: number;
  currentVersion: number;
  appliedVersions: number[];
  interruptedRecoveryTriggered: boolean;
  preMigrationBackup: PreMigrationBackupResult | null;
  integrityCheck: string;
  foreignKeyViolations: any[];
}

function sha256Short(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

function applySafeFileMode(filePath: string, mode = 0o600): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.chmodSync(filePath, mode);
    }
  } catch {
    // Non-POSIX filesystems (Windows NTFS) ignore POSIX chmod
  }
}

function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function isCandidateDbFilename(name: string): boolean {
  const lower = name.toLowerCase();
  if (
    lower.endsWith('-wal') ||
    lower.endsWith('-shm') ||
    lower.endsWith('-journal') ||
    lower.includes('.tmp') ||
    lower.endsWith('.bak') ||
    lower.includes('.rollback') ||
    lower.includes('.corrupt')
  ) {
    return false;
  }
  return lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3');
}

function inspectDatabaseFileReadOnly(filePath: string): DatabaseCandidateInfo {
  const filename = path.basename(filePath);
  const stats = fs.statSync(filePath);
  const emptyCounts = {
    users: 0,
    categories: 0,
    products: 0,
    orders: 0,
    payments: 0,
    cashShifts: 0,
  };

  if (stats.size === 0) {
    return {
      filePath,
      filename,
      sizeBytes: 0,
      modifiedAt: stats.mtime.toISOString(),
      canOpen: false,
      isPosDatabase: false,
      integrityCheck: 'empty_file',
      userVersion: 0,
      tableCount: 0,
      recordCounts: emptyCounts,
      hasBusinessData: false,
    };
  }

  let probe: Database.Database | null = null;
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrityRows = probe.pragma('integrity_check') as { integrity_check: string }[];
    const integrityCheck =
      integrityRows.length === 1 && integrityRows[0]?.integrity_check === 'ok'
        ? 'ok'
        : integrityRows.map((r) => r.integrity_check).join('; ') || 'failed';

    const uvRow = probe.pragma('user_version') as { user_version: number }[];
    const userVersion = Number(uvRow?.[0]?.user_version || 0);

    const tables = (
      probe
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((r) => r.name);

    const tableSet = new Set(tables);
    const matchedPosTables = POS_SIGNATURE_TABLES.filter((t) => tableSet.has(t));
    const isPosDatabase = matchedPosTables.length >= 2;

    const countOf = (tbl: string): number => {
      if (!tableSet.has(tbl)) return 0;
      const row = probe!.prepare(`SELECT COUNT(*) as c FROM "${tbl}"`).get() as { c: number };
      return Number(row?.c || 0);
    };

    const recordCounts = {
      users: countOf('users'),
      categories: countOf('categories'),
      products: countOf('products'),
      orders: countOf('orders'),
      payments: countOf('payments'),
      cashShifts: countOf('cash_shifts'),
    };

    const hasBusinessData =
      recordCounts.users > 0 ||
      recordCounts.categories > 0 ||
      recordCounts.products > 0 ||
      recordCounts.orders > 0 ||
      recordCounts.payments > 0 ||
      recordCounts.cashShifts > 0;

    return {
      filePath,
      filename,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      canOpen: true,
      isPosDatabase,
      integrityCheck,
      userVersion,
      tableCount: tables.length,
      recordCounts,
      hasBusinessData,
    };
  } catch (err: any) {
    return {
      filePath,
      filename,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      canOpen: false,
      isPosDatabase: false,
      integrityCheck: 'unreadable_or_corrupt',
      userVersion: 0,
      tableCount: 0,
      recordCounts: emptyCounts,
      hasBusinessData: false,
      error: err?.message || 'Unable to open SQLite file',
    };
  } finally {
    try {
      probe?.close();
    } catch {
      // ignore close error on read-only probe
    }
  }
}

/**
 * Inspects all SQLite database candidate files inside a directory strictly read-only.
 */
export function detectDatabaseCandidates(targetDir: string): DatabaseCandidateInfo[] {
  if (!fs.existsSync(targetDir)) return [];
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const candidates: DatabaseCandidateInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isCandidateDbFilename(entry.name)) continue;
    const fullPath = path.resolve(targetDir, entry.name);
    candidates.push(inspectDatabaseFileReadOnly(fullPath));
  }

  return candidates.sort((a, b) => a.filename.localeCompare(b.filename));
}

/**
 * Mandatory Multi-Database Conflict Stop Guard:
 * - Never guesses between golden_palace.db and golden_palace_production.db.
 * - Never silently creates a new empty production DB when an existing populated historical POS DB is detected.
 * - Generates a Database Identification Report (zero credentials) and throws DatabaseConflictError
 *   unless the owner explicitly confirmed the exact target path via GOLDEN_PALACE_CONFIRMED_DB_PATH.
 */
export function assertNoDatabaseConflict(
  targetDbPath: string,
  options: {
    isProductionMode?: boolean;
    confirmedDbPath?: string | null;
    writeReportFile?: boolean;
  } = {}
): { ok: true; candidates: DatabaseCandidateInfo[] } {
  const resolvedTarget = path.resolve(targetDbPath);
  const targetDir = path.dirname(resolvedTarget);
  const prodMode = options.isProductionMode ?? isProductionDatabaseMode();
  const confirmedEnv = process.env[CONFIRMED_DB_PATH_ENV]?.trim();
  const confirmedPath =
    options.confirmedDbPath !== undefined
      ? options.confirmedDbPath
        ? path.resolve(options.confirmedDbPath)
        : null
      : confirmedEnv
      ? path.resolve(confirmedEnv)
      : null;

  const candidates = detectDatabaseCandidates(targetDir);
  if (confirmedPath && confirmedPath === resolvedTarget) {
    return { ok: true, candidates };
  }

  const posCandidates = candidates.filter((c) => c.isPosDatabase);
  const targetCandidate = posCandidates.find((c) => path.resolve(c.filePath) === resolvedTarget);
  const otherPosCandidates = posCandidates.filter((c) => path.resolve(c.filePath) !== resolvedTarget);

  let reasonCode: DatabaseIdentificationReport['reasonCode'] | null = null;
  let message = '';

  // Case 1: Multiple POS databases coexist (e.g., golden_palace.db AND golden_palace_production.db)
  if (posCandidates.length >= 2) {
    const names = posCandidates.map((c) => c.filename).join(', ');
    reasonCode = 'MULTIPLE_POS_DATABASES';
    message =
      `DATABASE CONFLICT STOP: Multiple GOLDEN PALACE POS databases detected in ${targetDir} (${names}). ` +
      `Refusing to automatically choose between ${DEV_DB_FILENAME} and ${PRODUCTION_DB_FILENAME}. ` +
      `Review database_identification_report.json and confirm the authoritative database path via ${CONFIRMED_DB_PATH_ENV}.`;
  } else if (
    // Case 2: Production DB is missing/empty, while an existing populated historical POS DB exists
    prodMode &&
    path.basename(resolvedTarget) === PRODUCTION_DB_FILENAME &&
    (!targetCandidate || !targetCandidate.hasBusinessData) &&
    otherPosCandidates.some((c) => c.hasBusinessData)
  ) {
    const historicalNames = otherPosCandidates
      .filter((c) => c.hasBusinessData)
      .map((c) => c.filename)
      .join(', ');
    reasonCode = 'HISTORICAL_DB_WOULD_BE_BYPASSED';
    message =
      `DATABASE PRESERVATION STOP: Existing populated historical POS database (${historicalNames}) detected in ${targetDir} ` +
      `while ${PRODUCTION_DB_FILENAME} is absent or empty. Refusing to create a fresh empty production database automatically. ` +
      `Review database_identification_report.json and obtain owner confirmation before migrating or selecting a database.`;
  }

  if (reasonCode) {
    const report: DatabaseIdentificationReport = {
      generatedAt: new Date().toISOString(),
      targetDbPath: resolvedTarget,
      targetDir,
      isProductionMode: prodMode,
      reasonCode,
      message,
      candidates,
      ownerActionRequired:
        `Inspect the candidate record counts and timestamps, create an offline backup of all candidates, ` +
        `then confirm the single authoritative database path by setting ${CONFIRMED_DB_PATH_ENV} (or completing an approved migration).`,
      confirmationEnvVar: CONFIRMED_DB_PATH_ENV,
    };

    let reportPath: string | null = null;
    if (options.writeReportFile !== false && fs.existsSync(targetDir)) {
      reportPath = path.join(targetDir, 'database_identification_report.json');
      try {
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 });
        applySafeFileMode(reportPath, 0o600);
      } catch {
        reportPath = null;
      }
    }

    throw new DatabaseConflictError(report, reportPath);
  }

  return { ok: true, candidates };
}

export function verifyDatabaseIntegrity(targetDb: Database.Database): IntegrityCheckResult {
  const integrityRows = targetDb.pragma('integrity_check') as { integrity_check: string }[];
  const integrityCheck =
    integrityRows.length === 1 && integrityRows[0]?.integrity_check === 'ok'
      ? 'ok'
      : integrityRows.map((r) => r.integrity_check).join('; ') || 'failed';

  const foreignKeyViolations = targetDb.pragma('foreign_key_check') as any[];
  return {
    ok: integrityCheck === 'ok' && foreignKeyViolations.length === 0,
    integrityCheck,
    foreignKeyViolations,
  };
}

export function isDatabasePopulated(targetDb: Database.Database): boolean {
  const tables = new Set(
    (
      targetDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((r) => r.name)
  );

  for (const tbl of BUSINESS_DATA_TABLES) {
    if (!tables.has(tbl)) continue;
    const row = targetDb.prepare(`SELECT COUNT(*) as c FROM "${tbl}"`).get() as { c: number };
    if (Number(row?.c || 0) > 0) return true;
  }
  return false;
}

export function ensureSchemaMigrationsTable(targetDb: Database.Database): void {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'APPLIED',
      backup_path TEXT,
      applied_at TEXT DEFAULT (datetime('now')),
      duration_ms INTEGER,
      error_message TEXT
    );
  `);
}

export function getSchemaVersion(targetDb: Database.Database): number {
  const uvRow = targetDb.pragma('user_version') as { user_version: number }[];
  return Number(uvRow?.[0]?.user_version || 0);
}

/**
 * Creates a standalone, transactionally consistent, integrity-verified PRE_MIGRATION backup
 * using SQLite WAL checkpoint + VACUUM INTO before any schema mutation occurs.
 */
export function createVerifiedPreMigrationBackup(
  targetDb: Database.Database,
  dbPath: string,
  backupDir: string
): PreMigrationBackupResult {
  const resolvedBackupDir = path.resolve(backupDir);
  if (!fs.existsSync(resolvedBackupDir)) {
    fs.mkdirSync(resolvedBackupDir, { recursive: true, mode: 0o700 });
  }
  applySafeFileMode(resolvedBackupDir, 0o700);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(2).toString('hex');
  const filename = `gp_pos_pre_migration_${timestamp}_${suffix}.db`;
  const finalPath = path.join(resolvedBackupDir, filename);
  const tmpPath = `${finalPath}.tmp`;

  try {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }

    // Flush WAL frames so the source DB and VACUUM INTO snapshot reflect latest committed data
    targetDb.pragma('wal_checkpoint(FULL)');

    // VACUUM INTO creates a self-contained, consistent SQLite snapshot synchronously
    const escapedTmp = escapeSqlStringLiteral(tmpPath);
    targetDb.exec(`VACUUM INTO '${escapedTmp}'`);

    if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
      throw new Error(`Pre-migration backup file was not created or is empty: ${tmpPath}`);
    }

    // Independently verify the backup file in read-only mode
    let verifyDb: Database.Database | null = null;
    let check: IntegrityCheckResult;
    try {
      verifyDb = new Database(tmpPath, { readonly: true, fileMustExist: true });
      check = verifyDatabaseIntegrity(verifyDb);
    } finally {
      verifyDb?.close();
    }

    if (check.integrityCheck !== 'ok') {
      throw new Error(`Pre-migration backup failed PRAGMA integrity_check: ${check.integrityCheck}`);
    }

    applySafeFileMode(tmpPath, 0o600);
    fs.renameSync(tmpPath, finalPath);
    applySafeFileMode(finalPath, 0o600);

    const sizeBytes = fs.statSync(finalPath).size;
    return {
      backupPath: finalPath,
      filename,
      sizeBytes,
      integrityCheck: check.integrityCheck,
      foreignKeyViolations: check.foreignKeyViolations,
      createdAt: new Date().toISOString(),
    };
  } catch (err: any) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup error
    }
    throw new DatabaseMigrationError(
      `Failed to create verified PRE_MIGRATION backup for ${dbPath}: ${err?.message || err}`,
      {
        code: 'PRE_MIGRATION_BACKUP_FAILED',
        cause: err,
      }
    );
  }
}

/**
 * Deterministically restores a database file from a verified PRE_MIGRATION backup
 * if a multi-step migration fails after mutating the database.
 */
export function rollbackDatabaseFromBackup(
  dbPath: string,
  backupPath: string,
  closeActiveHandle?: () => void
): IntegrityCheckResult {
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new DatabaseMigrationError(`Cannot rollback: pre-migration backup missing at ${backupPath}`, {
      code: 'ROLLBACK_FAILED',
      preMigrationBackupPath: backupPath,
    });
  }

  // Verify backup is intact before touching live DB
  let probe: Database.Database | null = null;
  try {
    probe = new Database(backupPath, { readonly: true, fileMustExist: true });
    const preCheck = verifyDatabaseIntegrity(probe);
    if (preCheck.integrityCheck !== 'ok') {
      throw new Error(`Backup failed integrity_check: ${preCheck.integrityCheck}`);
    }
  } finally {
    probe?.close();
  }

  closeActiveHandle?.();

  const tempRestorePath = `${dbPath}.rollback.${Date.now()}.tmp`;
  try {
    fs.copyFileSync(backupPath, tempRestorePath);
    applySafeFileMode(tempRestorePath, 0o600);

    // Clean stale WAL/SHM sidecar files before swapping
    for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
      if (fs.existsSync(sidecar)) {
        fs.unlinkSync(sidecar);
      }
    }

    fs.renameSync(tempRestorePath, dbPath);
    applySafeFileMode(dbPath, 0o600);

    // Verify restored live DB passes integrity check
    let postProbe: Database.Database | null = null;
    try {
      postProbe = new Database(dbPath, { readonly: true, fileMustExist: true });
      const postCheck = verifyDatabaseIntegrity(postProbe);
      if (postCheck.integrityCheck !== 'ok') {
        throw new Error(`Post-rollback DB failed integrity_check: ${postCheck.integrityCheck}`);
      }
      return postCheck;
    } finally {
      postProbe?.close();
    }
  } catch (err: any) {
    try {
      if (fs.existsSync(tempRestorePath)) fs.unlinkSync(tempRestorePath);
    } catch {
      // ignore
    }
    throw new DatabaseMigrationError(`Automatic rollback from ${backupPath} failed: ${err?.message || err}`, {
      code: 'ROLLBACK_FAILED',
      preMigrationBackupPath: backupPath,
      cause: err,
    });
  }
}

export function ensureColumnStrict(
  targetDb: Database.Database,
  tableName: string,
  columnName: string,
  columnDef: string
): boolean {
  const tableInfo = targetDb.pragma(`table_info("${tableName}")`) as { name: string }[];
  if (!tableInfo || tableInfo.length === 0) {
    throw new Error(`Table "${tableName}" does not exist when adding column "${columnName}"`);
  }
  const exists = tableInfo.some((col) => col.name === columnName);
  if (exists) return false;

  targetDb.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnDef};`);
  return true;
}

export function buildStandardMigrations(
  ensureBaseSchemaFn: (db: Database.Database) => void
): MigrationStepDefinition[] {
  return [
    {
      version: 1,
      name: '001_base_pos_schema',
      description: 'Ensure all 29 core GOLDEN PALACE POS tables and base indexes exist non-destructively',
      apply: (targetDb) => {
        ensureBaseSchemaFn(targetDb);
      },
    },
    {
      version: 2,
      name: '002_legacy_phase03_to_09_compatibility',
      description: 'Add backward-compatible Phase 03-09 columns and reconcile legacy camelCase print_jobs columns',
      apply: (targetDb) => {
        ensureColumnStrict(targetDb, 'users', 'phone', 'TEXT');
        ensureColumnStrict(targetDb, 'users', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
        ensureColumnStrict(targetDb, 'suppliers', 'email', 'TEXT');
        ensureColumnStrict(targetDb, 'suppliers', 'notes', 'TEXT');
        ensureColumnStrict(targetDb, 'cash_shifts', 'total_cash_in', 'NUMERIC NOT NULL DEFAULT 0');
        ensureColumnStrict(targetDb, 'cash_shifts', 'total_cash_out', 'NUMERIC NOT NULL DEFAULT 0');
        ensureColumnStrict(targetDb, 'cash_shifts', 'total_baridimob_sales', 'NUMERIC NOT NULL DEFAULT 0');
        ensureColumnStrict(targetDb, 'cash_movements', 'performed_by', 'INTEGER REFERENCES users(id)');
        ensureColumnStrict(targetDb, 'ingredients', 'max_stock', 'NUMERIC');
        ensureColumnStrict(targetDb, 'waste_records', 'product_id', 'INTEGER');
        ensureColumnStrict(targetDb, 'purchases', 'paid_amount', 'NUMERIC NOT NULL DEFAULT 0');
        ensureColumnStrict(targetDb, 'purchases', 'payment_status', "TEXT NOT NULL DEFAULT 'PAID'");
        ensureColumnStrict(targetDb, 'inventory_movements', 'cost', 'NUMERIC');
        ensureColumnStrict(targetDb, 'deliveries', 'customer_id', 'INTEGER');
        ensureColumnStrict(targetDb, 'deliveries', 'delivery_address', 'TEXT');
        ensureColumnStrict(targetDb, 'deliveries', 'notes', 'TEXT');
        ensureColumnStrict(targetDb, 'expenses', 'date', 'TEXT');
        ensureColumnStrict(targetDb, 'expenses', 'user_id', 'INTEGER');
        ensureColumnStrict(targetDb, 'audit_logs', 'entity_type', 'TEXT');
        ensureColumnStrict(targetDb, 'orders', 'idempotency_key', 'TEXT');
        ensureColumnStrict(targetDb, 'orders', 'offline_id', 'TEXT');
        ensureColumnStrict(targetDb, 'orders', 'shift_id', 'INTEGER');
        ensureColumnStrict(targetDb, 'orders', 'tax_rate', 'NUMERIC NOT NULL DEFAULT 0');
        ensureColumnStrict(targetDb, 'orders', 'tax_amount', 'NUMERIC NOT NULL DEFAULT 0');
        ensureColumnStrict(targetDb, 'payments', 'shift_id', 'INTEGER');
        ensureColumnStrict(targetDb, 'payments', 'idempotency_key', 'TEXT');
        ensureColumnStrict(targetDb, 'cash_movements', 'idempotency_key', 'TEXT');

        // Reconcile print_jobs legacy camelCase columns to schema.ts snake_case columns safely
        ensureColumnStrict(targetDb, 'print_jobs', 'order_number', "TEXT NOT NULL DEFAULT ''");
        ensureColumnStrict(targetDb, 'print_jobs', 'job_type', "TEXT NOT NULL DEFAULT 'RECEIPT'");
        ensureColumnStrict(targetDb, 'print_jobs', 'printer_name', "TEXT NOT NULL DEFAULT 'CAFETERIA'");
        ensureColumnStrict(targetDb, 'print_jobs', 'connection_type', "TEXT NOT NULL DEFAULT 'WINDOWS_SPOOLER'");
        ensureColumnStrict(targetDb, 'print_jobs', 'target_ip', 'TEXT');
        ensureColumnStrict(targetDb, 'print_jobs', 'target_port', 'INTEGER DEFAULT 9100');
        ensureColumnStrict(targetDb, 'print_jobs', 'paper_width', "TEXT NOT NULL DEFAULT '80mm'");
        ensureColumnStrict(targetDb, 'print_jobs', 'error_message', 'TEXT');
        ensureColumnStrict(targetDb, 'print_jobs', 'is_reprint', 'INTEGER NOT NULL DEFAULT 0');
        ensureColumnStrict(targetDb, 'print_jobs', 'job_key', 'TEXT');
        ensureColumnStrict(targetDb, 'print_jobs', 'attempts', 'INTEGER NOT NULL DEFAULT 1');
        ensureColumnStrict(targetDb, 'print_jobs', 'requested_by', 'INTEGER');
        ensureColumnStrict(targetDb, 'print_jobs', 'spooler_accepted', 'INTEGER NOT NULL DEFAULT 0');
        ensureColumnStrict(targetDb, 'print_jobs', 'confirmed_at', 'TEXT');
        ensureColumnStrict(targetDb, 'print_jobs', 'updated_at', 'TEXT');
        ensureColumnStrict(targetDb, 'print_jobs', 'payload_preview', 'TEXT');
        ensureColumnStrict(targetDb, 'print_jobs', 'created_at', 'TEXT');

        const pjCols = new Set(
          (targetDb.pragma('table_info("print_jobs")') as { name: string }[]).map((c) => c.name)
        );
        if (pjCols.has('orderNumber')) {
          const orderNumExpr = pjCols.has('orderNumber') ? 'orderNumber' : "''";
          const jobTypeExpr = pjCols.has('jobType') ? 'jobType' : "'RECEIPT'";
          const printerNameExpr = pjCols.has('printerName') ? 'printerName' : "'CAFETERIA'";
          const paperWidthExpr = pjCols.has('paperWidth') ? 'paperWidth' : "'80mm'";
          const errMsgExpr = pjCols.has('errorMessage') ? 'errorMessage' : 'NULL';
          const isReprintExpr = pjCols.has('isReprint') ? 'isReprint' : '0';
          const createdAtExpr = pjCols.has('createdAt') ? 'createdAt' : "datetime('now')";

          targetDb.exec(`
            UPDATE print_jobs
            SET
              order_number = CASE WHEN COALESCE(order_number, '') = '' THEN COALESCE(${orderNumExpr}, '') ELSE order_number END,
              job_type = CASE WHEN COALESCE(job_type, '') = '' OR job_type = 'RECEIPT' THEN COALESCE(${jobTypeExpr}, 'RECEIPT') ELSE job_type END,
              printer_name = CASE WHEN COALESCE(printer_name, '') = '' OR printer_name = 'CAFETERIA' THEN COALESCE(${printerNameExpr}, 'CAFETERIA') ELSE printer_name END,
              paper_width = CASE WHEN COALESCE(paper_width, '') = '' OR paper_width = '80mm' THEN COALESCE(${paperWidthExpr}, '80mm') ELSE paper_width END,
              error_message = COALESCE(error_message, ${errMsgExpr}),
              is_reprint = COALESCE(NULLIF(is_reprint, 0), ${isReprintExpr}, 0),
              created_at = COALESCE(created_at, ${createdAtExpr}, datetime('now'))
            WHERE order_number = '' OR created_at IS NULL OR (printer_name = 'CAFETERIA' AND COALESCE(${printerNameExpr}, 'CAFETERIA') != 'CAFETERIA');
          `);
        }
      },
    },
    {
      version: 3,
      name: '003_official_menu_variants_addons_discounts',
      description: 'Add Official Menu Integration, pizza variant prices, add-on flags, discount audit fields, and audit before/after columns',
      apply: (targetDb) => {
        ensureColumnStrict(targetDb, 'products', 'sku', 'TEXT');
        ensureColumnStrict(targetDb, 'products', 'subcategory_ar', 'TEXT');
        ensureColumnStrict(targetDb, 'products', 'subcategory_fr', 'TEXT');
        ensureColumnStrict(targetDb, 'products', 'is_active', 'INTEGER NOT NULL DEFAULT 1');

        ensureColumnStrict(targetDb, 'product_variants', 'price', 'INTEGER');
        ensureColumnStrict(targetDb, 'product_variants', 'sku', 'TEXT');
        ensureColumnStrict(targetDb, 'product_variants', 'is_active', 'INTEGER NOT NULL DEFAULT 1');

        ensureColumnStrict(targetDb, 'product_addons', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
        ensureColumnStrict(targetDb, 'product_addons', 'created_at', 'TEXT');

        ensureColumnStrict(targetDb, 'orders', 'discount_type', 'TEXT');
        ensureColumnStrict(targetDb, 'orders', 'discount_value', 'NUMERIC DEFAULT 0');
        ensureColumnStrict(targetDb, 'orders', 'discount_reason', 'TEXT');
        ensureColumnStrict(targetDb, 'orders', 'discount_authorized_by', 'INTEGER REFERENCES users(id)');
        ensureColumnStrict(targetDb, 'orders', 'discount_authorized_at', 'TEXT');

        ensureColumnStrict(targetDb, 'audit_logs', 'previous_value', 'TEXT');
        ensureColumnStrict(targetDb, 'audit_logs', 'new_value', 'TEXT');
      },
    },
    {
      version: 4,
      name: '004_integrity_and_performance_indexes',
      description: 'Enforce unique idempotency/offline indexes and catalog lookup indexes without silent failure swallowing',
      apply: (targetDb) => {
        targetDb.exec(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_offline_id_unique ON orders(offline_id) WHERE offline_id IS NOT NULL;'
        );
        targetDb.exec(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_idempotency_unique ON cash_movements(idempotency_key) WHERE idempotency_key IS NOT NULL;'
        );
        targetDb.exec(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_orig_key_unique ON print_jobs(job_key) WHERE job_key IS NOT NULL AND is_reprint = 0;'
        );
        targetDb.exec(
          'CREATE INDEX IF NOT EXISTS idx_products_category_name ON products(category_id, name_ar);'
        );
        targetDb.exec(
          'CREATE INDEX IF NOT EXISTS idx_products_subcategory ON products(category_id, subcategory_ar);'
        );
        targetDb.exec(
          'CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);'
        );
        targetDb.exec(
          'CREATE INDEX IF NOT EXISTS idx_product_addons_product ON product_addons(product_id);'
        );
        targetDb.exec(
          'CREATE INDEX IF NOT EXISTS idx_categories_sort_active ON categories(sort_order, is_active);'
        );
      },
    },
  ];
}

/**
 * Executes explicit, versioned, atomic SQLite migrations with:
 * 1. Pre-migration PRAGMA integrity_check (aborts immediately on corrupted DB).
 * 2. Schema version & interrupted-migration detection (PRAGMA user_version + schema_migrations ledger).
 * 3. Mandatory verified PRE_MIGRATION backup for populated databases before any schema mutation.
 * 4. Atomic per-step transactions with ZERO silent error handling.
 * 5. Automatic verified rollback from PRE_MIGRATION backup if any step or post-check fails.
 * 6. Post-migration PRAGMA integrity_check and PRAGMA foreign_key_check verification.
 */
export function runVersionedMigrations(
  targetDb: Database.Database,
  options: {
    dbPath?: string;
    backupDir?: string;
    ensureBaseSchema: (db: Database.Database) => void;
    migrations?: MigrationStepDefinition[];
    closeHandleOnRollback?: () => void;
  }
): MigrationRunResult {
  const dbPath = options.dbPath || targetDb.name || ':memory:';
  const migrations = options.migrations || buildStandardMigrations(options.ensureBaseSchema);

  // 1. Pre-migration integrity verification — never mutate a corrupted database
  let preCheck: IntegrityCheckResult;
  try {
    preCheck = verifyDatabaseIntegrity(targetDb);
  } catch (err: any) {
    throw new DatabaseMigrationError(
      `Database integrity pre-check failed on ${dbPath}: ${err?.message || err}`,
      { code: 'DATABASE_CORRUPTED', cause: err }
    );
  }

  if (preCheck.integrityCheck !== 'ok') {
    throw new DatabaseMigrationError(
      `Refusing to migrate corrupted SQLite database at ${dbPath}: PRAGMA integrity_check returned "${preCheck.integrityCheck}"`,
      { code: 'DATABASE_CORRUPTED' }
    );
  }

  const previousVersion = getSchemaVersion(targetDb);
  const populated = isDatabasePopulated(targetDb);

  // Inspect existing schema_migrations ledger (if present) without mutating yet
  const hasLedgerTable = Boolean(
    targetDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get()
  );

  let appliedVersionSet = new Set<number>();
  let interruptedRecoveryTriggered = false;

  if (hasLedgerTable) {
    const ledgerRows = targetDb
      .prepare('SELECT version, status FROM schema_migrations ORDER BY version ASC')
      .all() as { version: number; status: string }[];

    for (const row of ledgerRows) {
      if (row.status === 'APPLIED') {
        appliedVersionSet.add(Number(row.version));
      } else {
        interruptedRecoveryTriggered = true;
      }
    }

    const maxLedgerApplied = appliedVersionSet.size > 0 ? Math.max(...appliedVersionSet) : 0;
    if (previousVersion !== maxLedgerApplied) {
      interruptedRecoveryTriggered = true;
    }
  } else if (populated && previousVersion === 0) {
    // Legacy or partially migrated database predating schema_migrations ledger
    interruptedRecoveryTriggered = false;
  }

  const pendingMigrations = migrations.filter(
    (m) => m.version > previousVersion || !appliedVersionSet.has(m.version)
  );

  if (pendingMigrations.length === 0 && !interruptedRecoveryTriggered) {
    if (preCheck.foreignKeyViolations.length > 0) {
      throw new DatabaseMigrationError(
        `Foreign key integrity check failed on ${dbPath} (${preCheck.foreignKeyViolations.length} violation(s))`,
        { code: 'POST_MIGRATION_INTEGRITY_FAILED' }
      );
    }
    return {
      dbPath,
      previousVersion,
      currentVersion: previousVersion,
      appliedVersions: [],
      interruptedRecoveryTriggered: false,
      preMigrationBackup: null,
      integrityCheck: preCheck.integrityCheck,
      foreignKeyViolations: preCheck.foreignKeyViolations,
    };
  }

  // 2. Mandatory automatic verified PRE_MIGRATION backup for populated on-disk databases
  let preMigrationBackup: PreMigrationBackupResult | null = null;
  const isOnDisk = dbPath !== ':memory:' && dbPath !== '' && fs.existsSync(dbPath);
  if (populated && isOnDisk) {
    const resolvedBackupDir =
      options.backupDir ||
      path.join(
        path.dirname(dbPath),
        path.basename(dbPath) === PRODUCTION_DB_FILENAME ? 'backups_production' : 'backups'
      );
    preMigrationBackup = createVerifiedPreMigrationBackup(targetDb, dbPath, resolvedBackupDir);
  }

  const appliedVersions: number[] = [];
  let databaseMutated = false;

  const attemptRollback = () => {
    if (!preMigrationBackup || !isOnDisk || !databaseMutated) return false;
    rollbackDatabaseFromBackup(
      dbPath,
      preMigrationBackup.backupPath,
      options.closeHandleOnRollback || (() => {
        try {
          if (targetDb.open) targetDb.close();
        } catch {
          // ignore
        }
      })
    );
    return true;
  };

  try {
    // 3. Ensure ledger table exists before applying pending steps
    ensureSchemaMigrationsTable(targetDb);
    databaseMutated = true;

    const upsertLedger = targetDb.prepare(`
      INSERT INTO schema_migrations (version, name, checksum, status, backup_path, applied_at, duration_ms, error_message)
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?)
      ON CONFLICT(version) DO UPDATE SET
        name = excluded.name,
        checksum = excluded.checksum,
        status = excluded.status,
        backup_path = COALESCE(excluded.backup_path, schema_migrations.backup_path),
        applied_at = datetime('now'),
        duration_ms = excluded.duration_ms,
        error_message = excluded.error_message
    `);

    for (const step of pendingMigrations) {
      const startedAt = Date.now();
      const checksum = sha256Short(`${step.version}:${step.name}:${step.description}`);

      // Mark IN_PROGRESS before atomic step transaction
      upsertLedger.run(
        step.version,
        step.name,
        checksum,
        'IN_PROGRESS',
        preMigrationBackup?.backupPath || null,
        null,
        null
      );

      const runStepTx = targetDb.transaction(() => {
        step.apply(targetDb);
        const durationMs = Date.now() - startedAt;
        upsertLedger.run(
          step.version,
          step.name,
          checksum,
          'APPLIED',
          preMigrationBackup?.backupPath || null,
          durationMs,
          null
        );
        targetDb.pragma(`user_version = ${step.version}`);
      });

      try {
        runStepTx();
        appliedVersions.push(step.version);
      } catch (stepErr: any) {
        console.error(
          `❌ [DB MIGRATION FAILED] v${step.version} (${step.name}) on ${dbPath}: ${stepErr?.message || stepErr}`
        );
        try {
          upsertLedger.run(
            step.version,
            step.name,
            checksum,
            'FAILED',
            preMigrationBackup?.backupPath || null,
            Date.now() - startedAt,
            String(stepErr?.message || stepErr)
          );
        } catch {
          // DB handle may be rolled back next
        }

        const rolledBack = attemptRollback();
        throw new DatabaseMigrationError(
          `Migration v${step.version} (${step.name}) failed: ${stepErr?.message || stepErr}` +
            (rolledBack ? ` [Automatically rolled back to ${preMigrationBackup?.filename}]` : ''),
          {
            code: 'MIGRATION_FAILED',
            version: step.version,
            migrationName: step.name,
            preMigrationBackupPath: preMigrationBackup?.backupPath || null,
            rolledBack,
            cause: stepErr,
          }
        );
      }
    }

    // 4. Post-migration integrity & foreign key verification
    const postCheck = verifyDatabaseIntegrity(targetDb);
    if (!postCheck.ok) {
      const details =
        postCheck.integrityCheck !== 'ok'
          ? `integrity_check="${postCheck.integrityCheck}"`
          : `foreign_key_check violations=${postCheck.foreignKeyViolations.length}`;
      const rolledBack = attemptRollback();
      throw new DatabaseMigrationError(
        `Post-migration integrity verification failed (${details})` +
          (rolledBack ? ` [Automatically rolled back to ${preMigrationBackup?.filename}]` : ''),
        {
          code: 'POST_MIGRATION_INTEGRITY_FAILED',
          preMigrationBackupPath: preMigrationBackup?.backupPath || null,
          rolledBack,
        }
      );
    }

    const finalVersion = getSchemaVersion(targetDb);
    return {
      dbPath,
      previousVersion,
      currentVersion: finalVersion,
      appliedVersions,
      interruptedRecoveryTriggered,
      preMigrationBackup,
      integrityCheck: postCheck.integrityCheck,
      foreignKeyViolations: postCheck.foreignKeyViolations,
    };
  } catch (err) {
    if (err instanceof DatabaseMigrationError) {
      throw err;
    }
    const rolledBack = attemptRollback();
    throw new DatabaseMigrationError(
      `Unexpected database migration error on ${dbPath}: ${(err as any)?.message || err}`,
      {
        code: 'MIGRATION_FAILED',
        preMigrationBackupPath: preMigrationBackup?.backupPath || null,
        rolledBack,
        cause: err,
      }
    );
  }
}
