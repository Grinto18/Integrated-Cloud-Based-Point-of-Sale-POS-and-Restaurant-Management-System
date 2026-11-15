import path from 'path';
import fs from 'fs';

export const DEV_DB_FILENAME = 'golden_palace.db';
export const PRODUCTION_DB_FILENAME = 'golden_palace_production.db';

export function isProductionDatabaseMode(): boolean {
  return (
    process.env.GOLDEN_PALACE_DB_MODE === 'production' ||
    process.env.GOLDEN_PALACE_DESKTOP === '1' ||
    process.env.NODE_ENV === 'production'
  );
}

/**
 * Resolves the persistent local SQLite database path.
 * On Windows 7 / 10 / 11: %APPDATA%\Golden Palace POS\<dbFilename>
 * On Linux / Docker container: ~/.local/share/Golden Palace POS/<dbFilename>
 * On macOS: ~/Library/Application Support/Golden Palace POS/<dbFilename>
 *
 * Production / Desktop mode strictly uses `golden_palace_production.db` with
 * zero fallback to the development seeded database (`golden_palace.db`).
 */
export function getLocalDatabasePath(): string {
  if (process.env.SQLITE_DB_PATH) {
    const customDir = path.dirname(process.env.SQLITE_DB_PATH);
    if (!fs.existsSync(customDir)) {
      fs.mkdirSync(customDir, { recursive: true, mode: 0o700 });
    }
    return process.env.SQLITE_DB_PATH;
  }

  let baseDir: string;
  if (process.platform === 'win32') {
    baseDir = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\', 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    baseDir = path.join(process.env.HOME || '/tmp', 'Library', 'Application Support');
  } else {
    baseDir = process.env.XDG_DATA_HOME || path.join(process.env.HOME || '/tmp', '.local', 'share');
  }

  const appDataDir = path.join(baseDir, 'Golden Palace POS');
  if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(appDataDir, 0o700);
  } catch {
    // Non-POSIX filesystems (e.g. Windows) may ignore chmod
  }

  const dbFilename = isProductionDatabaseMode() ? PRODUCTION_DB_FILENAME : DEV_DB_FILENAME;
  return path.join(appDataDir, dbFilename);
}

export function getAppDataDirectory(): string {
  return path.dirname(getLocalDatabasePath());
}

/**
 * Resolves the backup directory (independent from the active DB file).
 * Supports GOLDEN_PALACE_BACKUP_DIR env override.
 * Production DB defaults to <dbDir>/backups_production so dev backups are never mixed in.
 * Enforces owner-only (0700) POSIX permissions on the backup directory.
 */
export function getBackupDirectory(): string {
  const customBackupDir = process.env.GOLDEN_PALACE_BACKUP_DIR?.trim();
  const dbPath = getLocalDatabasePath();
  const defaultFolderName =
    path.basename(dbPath) === PRODUCTION_DB_FILENAME ? 'backups_production' : 'backups';
  const backupDir = customBackupDir
    ? path.resolve(customBackupDir)
    : path.join(path.dirname(dbPath), defaultFolderName);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(backupDir, 0o700);
  } catch {
    // Non-POSIX filesystems (e.g. Windows) may ignore chmod
  }
  return backupDir;
}

export function getDesktopStoragePaths(): {
  platform: string;
  appDataDir: string;
  dbPath: string;
  backupDir: string;
} {
  const dbPath = getLocalDatabasePath();
  return {
    platform: process.platform,
    appDataDir: path.dirname(dbPath),
    dbPath,
    backupDir: getBackupDirectory(),
  };
}
