# GOLDEN PALACE POS — First Run & Upgrading Existing Database Guide

## Scenario A: Fresh Restaurant Terminal (Empty `%APPDATA%\Golden Palace POS`)
1. On initial desktop startup (`GOLDEN_PALACE_DESKTOP=1`), the local server initializes the SQLite schema, configures WAL reliability pragmas, creates the 30 restaurant tables and base menu categories, and **creates zero default user accounts**.
2. The login window automatically opens **تهيئة أول مدير للنظام (Initial Admin Setup)**.
3. Enter:
   - Full Name (e.g., Restaurant Owner)
   - Username (e.g., `owner`)
   - Password (`>= 8` characters)
   - Personal PIN (`4–12` digits; repeated digits and `1234` are rejected)
4. Once submitted (`POST /api/system/setup-admin`), this endpoint locks permanently (`409 Conflict` if called again).
5. Create operational accounts (`CASHIER`, `WAITER`, `KITCHEN`, `MANAGER`, `INVENTORY`) from **Settings → الموظفين والأدوار (Staff & RBAC)**.

## Scenario B: Existing Restaurant Database Migration / Upgrade
1. If `%APPDATA%\Golden Palace POS\golden_palace.db` already exists (from an earlier phase or manual backup copy):
   - Launch does **not** overwrite or reset the database.
   - `runFirstRunDatabaseAudit()` runs idempotent, non-destructive column/index checks (`runSafeMigrations`) and migrates any legacy plaintext PINs safely to `bcrypt` hashes (`migratePlaintextPins`) without locking out existing staff.
2. All existing `users`, `orders`, `order_items`, `payments`, `cash_shifts`, `ingredients`, and `print_jobs` are preserved intact.
3. Verify immediately after launch:
   - Sign in with an existing Admin account.
   - Check **Settings → Backups** to confirm `integrity_check = ok` and non-zero historical record counts.
