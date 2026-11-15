import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import {
  DEV_DB_FILENAME,
  PRODUCTION_DB_FILENAME,
  getLocalDatabasePath,
} from './sqlitePath.ts';

export const EXPECTED_PRODUCTION_TABLES = [
  'audit_logs',
  'cash_movements',
  'cash_shifts',
  'categories',
  'customers',
  'deliveries',
  'expenses',
  'ingredients',
  'inventory_movements',
  'order_items',
  'orders',
  'payments',
  'price_history',
  'print_jobs',
  'product_addons',
  'product_recipes',
  'product_variants',
  'products',
  'purchase_items',
  'purchases',
  'restaurant_settings',
  'restaurant_tables',
  'revoked_tokens',
  'suppliers',
  'sync_conflicts',
  'sync_operations',
  'users',
  'waste_records',
] as const;

export const ZERO_COUNT_REQUIRED_TABLES = [
  'users',
  'customers',
  'products',
  'categories',
  'restaurant_tables',
  'ingredients',
  'orders',
  'order_items',
  'payments',
  'cash_shifts',
  'expenses',
  'inventory_movements',
  'print_jobs',
  'audit_logs',
  'restaurant_settings',
] as const;

export interface ProductionDbInitVerification {
  dbPath: string;
  backupDir: string;
  journalMode: string;
  foreignKeysEnabled: boolean;
  integrityCheck: string;
  foreignKeyViolations: any[];
  tables: string[];
  missingTables: string[];
  counts: Record<string, number>;
  allInitialCountsZero: boolean;
  fileModeOctal: string | null;
}

export function resolveProductionDatabasePath(): string {
  const prevMode = process.env.GOLDEN_PALACE_DB_MODE;
  const prevPath = process.env.SQLITE_DB_PATH;
  try {
    if (prevPath) return prevPath;
    process.env.GOLDEN_PALACE_DB_MODE = 'production';
    const resolved = getLocalDatabasePath();
    if (path.basename(resolved) === DEV_DB_FILENAME) {
      throw new Error('Production path resolution refused fallback to dev database');
    }
    return resolved;
  } finally {
    if (prevMode === undefined) delete process.env.GOLDEN_PALACE_DB_MODE;
    else process.env.GOLDEN_PALACE_DB_MODE = prevMode;
  }
}

export async function initializeFreshProductionDatabase(
  targetPath?: string
): Promise<ProductionDbInitVerification> {
  const resolvedPath = path.resolve(targetPath || resolveProductionDatabasePath());
  if (path.basename(resolvedPath) === DEV_DB_FILENAME && !targetPath) {
    throw new Error(`Refusing to initialize production DB onto dev filename ${DEV_DB_FILENAME}`);
  }

  const dbDir = path.dirname(resolvedPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(dbDir, 0o700);
  } catch {
    // Non-POSIX filesystems ignore chmod
  }

  // Ensure backups_production directory exists separately from dev backups
  const backupDir =
    path.basename(resolvedPath) === PRODUCTION_DB_FILENAME
      ? path.join(dbDir, 'backups_production')
      : path.join(dbDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  }

  // Never overwrite or reset an existing populated database
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).size > 0) {
    const probe = new Database(resolvedPath, { readonly: true, fileMustExist: true });
    try {
      const existingUsers = probe
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        .get();
      if (existingUsers) {
        const uCount = (probe.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
        const oCount = (probe.prepare('SELECT COUNT(*) as c FROM orders').get() as { c: number }).c;
        if (uCount > 0 || oCount > 0) {
          throw new Error(
            `Refusing to overwrite existing populated database at ${resolvedPath} (users=${uCount}, orders=${oCount})`
          );
        }
      }
    } finally {
      probe.close();
    }
  }

  // Temporarily set SQLITE_DB_PATH before lazy-importing index.ts helpers so dev DB is never opened
  const prevSqlPath = process.env.SQLITE_DB_PATH;
  const prevMode = process.env.GOLDEN_PALACE_DB_MODE;
  process.env.SQLITE_DB_PATH = resolvedPath;
  process.env.GOLDEN_PALACE_DB_MODE = 'production';

  let prodDb: Database.Database | null = null;
  try {
    const {
      configureSqlitePragmas,
      ensureBaseSchema,
      runSafeMigrations,
      applyDatabaseFilePermissions,
    } = await import('./index.ts');

    prodDb = new Database(resolvedPath);
    applyDatabaseFilePermissions(resolvedPath);
    configureSqlitePragmas(prodDb);
    ensureBaseSchema(prodDb);
    runSafeMigrations(prodDb);

    const journalRow = prodDb.pragma('journal_mode') as { journal_mode: string }[];
    const journalMode = String(journalRow?.[0]?.journal_mode || '').toLowerCase();
    const fkRow = prodDb.pragma('foreign_keys') as { foreign_keys: number }[];
    const foreignKeysEnabled = Number(fkRow?.[0]?.foreign_keys || 0) === 1;

    const integrityRows = prodDb.pragma('integrity_check') as { integrity_check: string }[];
    const integrityCheck =
      integrityRows.length === 1 && integrityRows[0]?.integrity_check === 'ok'
        ? 'ok'
        : integrityRows.map((r) => r.integrity_check).join('; ');

    const foreignKeyViolations = prodDb.pragma('foreign_key_check') as any[];

    const tables = (
      prodDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);

    const tableSet = new Set(tables);
    const missingTables = EXPECTED_PRODUCTION_TABLES.filter((t) => !tableSet.has(t));

    const counts: Record<string, number> = {};
    for (const tbl of ZERO_COUNT_REQUIRED_TABLES) {
      counts[tbl] = tableSet.has(tbl)
        ? Number((prodDb.prepare(`SELECT COUNT(*) as c FROM "${tbl}"`).get() as { c: number }).c)
        : -1;
    }

    const allInitialCountsZero = ZERO_COUNT_REQUIRED_TABLES.every((t) => counts[t] === 0);

    try {
      prodDb.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // Ignore checkpoint warnings
    }
    prodDb.close();
    prodDb = null;

    applyDatabaseFilePermissions(resolvedPath);

    let fileModeOctal: string | null = null;
    try {
      const mode = fs.statSync(resolvedPath).mode & 0o777;
      fileModeOctal = '0' + mode.toString(8);
    } catch {
      fileModeOctal = null;
    }

    return {
      dbPath: resolvedPath,
      backupDir,
      journalMode,
      foreignKeysEnabled,
      integrityCheck,
      foreignKeyViolations,
      tables,
      missingTables,
      counts,
      allInitialCountsZero,
      fileModeOctal,
    };
  } finally {
    try {
      prodDb?.close();
    } catch {
      // Ignore
    }
    if (prevSqlPath === undefined) delete process.env.SQLITE_DB_PATH;
    else process.env.SQLITE_DB_PATH = prevSqlPath;
    if (prevMode === undefined) delete process.env.GOLDEN_PALACE_DB_MODE;
    else process.env.GOLDEN_PALACE_DB_MODE = prevMode;
  }
}

if (process.argv[1]?.endsWith('initProductionDb.ts')) {
  const customArg = process.argv[2];
  initializeFreshProductionDatabase(customArg)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.integrityCheck !== 'ok' || result.missingTables.length > 0 || !result.allInitialCountsZero) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to initialize production database:', err?.message || err);
      process.exit(1);
    });
}
