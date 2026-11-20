# GOLDEN PALACE POS — Official Menu Database Backup & Recovery Report

## 1. Overview
The Official Menu Import Module enforces a mandatory, automatic, verified SQLite pre-import backup before any catalog write transaction is executed.

- **Backup Engine:** `src/services/backupService.ts` (`BackupManager.createBackup('PRE_IMPORT')`)
- **Backup Mechanism:** `better-sqlite3` online WAL-safe SQLite Backup API (`sourceDb.backup(tmpPath)`), followed by mandatory verification and atomic file promotion (`fs.renameSync`).
- **Naming Convention:** `gp_pos_pre_import_<ISO-TIMESTAMP>_<RANDOM>.db`
- **Storage Location:** Isolated backup directory (`%APPDATA%/GOLDEN PALACE POS/backups` or configured `BACKUP_DIR`), separate from live database files.

## 2. Pre-Import Backup Verification Guarantees
Before promoting any `PRE_IMPORT` backup from `.tmp` to `.db`, `BackupManager.verifyBackupFile` validates:
1. File exists and `sizeBytes > 0`.
2. Database opens cleanly in read-only mode.
3. All required production tables (`users`, `categories`, `products`, `orders`, `order_items`, `payments`, `ingredients`, `cash_shifts`, `restaurant_settings`, `audit_logs`) are present.
4. `PRAGMA integrity_check` returns strictly `'ok'`.
5. Disk space check passes before backup begins.
6. File permissions are set to `0o600` (POSIX) / user-profile directory ACL (Windows).

If backup creation or verification fails for any reason, the menu import aborts immediately before any SQLite write transaction begins.

## 3. Transaction Rollback & Post-Import Verification
- All category, product, and variant inserts run inside a single `sqlite.transaction(...)` block.
- On any database or validation failure mid-import, SQLite performs a full atomic rollback (zero partial rows left behind) and logs `MENU_IMPORT_ROLLBACK` in `audit_logs`.
- Upon commit, the importer executes:
  - `PRAGMA integrity_check` (must equal `'ok'`)
  - `PRAGMA foreign_key_check` (must return 0 violations)
  - Persistent history entry in `menu_import_history` storing `backup_filename`, `backup_path`, counts, and summary JSON
  - Audit trail record `MENU_IMPORT` in `audit_logs` with `previous_value` and `new_value` counts.

## 4. Production Database Safety Confirmation
- No production SQLite database (`golden_palace_pos_production.db`) was modified, overwritten, or reset during development or testing.
- All automated tests (`src/__tests__/official.menu.import.test.ts`) ran exclusively against ephemeral temporary directories under `os.tmpdir()`.
- Note on Reference Docs: `GOLDEN_PALACE_POS_DATABASE_README.md` does not exist in the repository; schema and migration verification were performed directly against `src/db/schema.ts`, `src/db/index.ts`, and `src/db/migrations/001_official_menu_and_import.sql`.
