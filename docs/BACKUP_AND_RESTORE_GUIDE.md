# GOLDEN PALACE POS — Backup, Restore & Disaster Recovery Guide

## 1. Where Backups Live
- Active database: `%APPDATA%\Golden Palace POS\golden_palace.db`
- Independent backup folder: `%APPDATA%\Golden Palace POS\backups\`
- Automatic shutdown backup runs cleanly whenever the desktop application exits normally (`before-quit` → `handleGracefulShutdown` → SQLite Online Backup API + `PRAGMA integrity_check`).
- Periodic scheduled backups (Daily, Weekly, and Configurable Interval Hours) run automatically while the terminal is operating.

## 2. Manual Backup & Verification
1. Sign in as **ADMIN** (backup/restore operations are strictly restricted to `ADMIN`).
2. Open **Settings → النسخ الاحتياطي (Backup)**.
3. Click **إنشاء نسخة احتياطية الآن (Manual Backup)**.
4. Click **فحص السلامة (Verify)** on any backup entry to confirm `PRAGMA integrity_check = ok` and inspect exact row counts (`orders`, `payments`, `users`, `ingredients`, `cash_shifts`).
5. Use **تنزيل (Download)** to archive copies onto an external USB drive or secondary storage daily.

## 3. Safe Pre-Update Check
Before upgrading the Windows application:
1. Close any open cash shift and finish pending payments.
2. Sync offline queue and resolve any sync conflicts in **مركز المزامنة (Sync Center)**.
3. Click **فحص ما قبل التحديث (Pre-Update Check)** inside **Settings → Backup**.
4. The system blocks the update (`409`) if open shifts/unpaid orders/conflicts exist, or creates a verified `PRE_RESTORE` backup plus `update_recovery_manifest.json`.

## 4. Restoring from Backup (Two-Step Confirmed Safe Restore)
1. In **Settings → Backup**, locate a **VERIFIED** backup file and click **استعادة (Restore)**.
2. Read the warning summary comparing current counts vs backup counts, then type/confirm the exact backup filename.
3. The server atomically:
   - Creates a `PRE_RESTORE` safety snapshot of the current database first.
   - Verifies the target backup (`PRAGMA integrity_check = ok`, required tables present).
   - Safely closes SQLite handles, replaces the database, reopens WAL connection, and re-runs verification.
   - Automatically rolls back to the `PRE_RESTORE` snapshot if post-restore verification fails.
