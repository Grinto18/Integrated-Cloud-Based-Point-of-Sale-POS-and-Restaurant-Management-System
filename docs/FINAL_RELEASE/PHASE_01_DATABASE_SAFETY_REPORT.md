# PHASE 1 — DATABASE SAFETY AND MIGRATION REPORT
## GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)

**Report Date (UTC):** 2026-11-20  
**Execution Scope:** Development workspace and isolated temporary SQLite databases (`os.tmpdir()`) ONLY — zero real restaurant databases accessed, modified, or touched.  
**Host Verification Environment:** Linux x86_64 (`4.19.0-gvisor`), Node.js `v22.23.2`, `better-sqlite3@11.10.0`, Vitest `v5.1.0`  
**Phase Status:** **COMPLETE — PASS (150/151 tests passing; 8/8 new Phase 1 safety tests passing; 1 pre-existing unrelated icon failure preserved unmodified)**

---

## 1. Executive Summary

Phase 1 eliminates silent database migration failures, ambiguous database file resolution, and unprotected schema mutations in GOLDEN PALACE POS. Every database open path now enforces:

1. **One canonical database path policy** separating desktop/server production (`golden_palace_production.db` + `backups_production/`) from development (`golden_palace.db` + `backups/`).
2. **A mandatory multi-database conflict stop guard** that halts startup before `new Database()` whenever two POS SQLite databases coexist or a populated historical POS database would be bypassed by a fresh empty `golden_palace_production.db`.
3. **Deterministic schema version tracking** combining SQLite `PRAGMA user_version` (`LATEST_SCHEMA_VERSION = 4`) with a persistent `schema_migrations` ledger table recording version, name, SHA-256 checksum, status (`IN_PROGRESS`, `APPLIED`, `FAILED`), pre-migration backup path, duration, and error message.
4. **Automatic integrity-verified `PRE_MIGRATION` backups** created via `PRAGMA wal_checkpoint(FULL)` + `VACUUM INTO` + read-only `PRAGMA integrity_check` / `foreign_key_check` + atomic rename (`0600` permissions on POSIX) prior to mutating any populated on-disk database.
5. **Explicit migration failure handling and automatic deterministic rollback** with zero silent `catch {}` blocks on schema DDL, index creation, or PIN migration.

---

## 2. Canonical Database Path Policy

Implemented in `src/db/sqlitePath.ts` (`resolveCanonicalDatabasePolicy()`, `getLocalDatabasePath()`, `getBackupDirectory()`, `CONFIRMED_DB_PATH_ENV`):

| Runtime Environment | Trigger Condition | Canonical Database File | Canonical Backup Directory | Fallback Allowed? |
|---|---|---|---|---|
| **Windows Desktop Production** | `GOLDEN_PALACE_DESKTOP=1` (Electron `main.cjs` sets `GOLDEN_PALACE_DB_MODE=production` & `NODE_ENV=production`) | `%APPDATA%\Golden Palace POS\golden_palace_production.db` | `%APPDATA%\Golden Palace POS\backups_production\` | **NEVER** (refuses fallback to `golden_palace.db`) |
| **Server Production** | `GOLDEN_PALACE_DB_MODE=production` or `NODE_ENV=production` | `<AppData>/Golden Palace POS/golden_palace_production.db` | `<AppData>/Golden Palace POS/backups_production/` | **NEVER** |
| **Development / Local Dev** | Neither production nor desktop mode | `<AppData>/Golden Palace POS/golden_palace.db` | `<AppData>/Golden Palace POS/backups/` | Isolated from production |
| **Isolated Test / Explicit Override** | `SQLITE_DB_PATH` (+ optional `GOLDEN_PALACE_BACKUP_DIR`) | Exact resolved `SQLITE_DB_PATH` | `GOLDEN_PALACE_BACKUP_DIR` or sibling `backups[_production]` | Strictly isolated |
| **Owner Conflict Confirmation** | `GOLDEN_PALACE_CONFIRMED_DB_PATH` matches `path.resolve(targetDbPath)` | Owner-confirmed authoritative file | Matching environment backup directory | Explicit owner action only |

- **Storage permissions:** App data directory and backup directory enforce `0700` on POSIX; database and backup files enforce `0600` on POSIX (Windows NTFS ACLs govern Windows installations).
- **SQLite reliability pragmas enforced on every connection (`configureSqlitePragmas`):**
  - `PRAGMA journal_mode = WAL`
  - `PRAGMA synchronous = NORMAL`
  - `PRAGMA foreign_keys = ON`
  - `PRAGMA busy_timeout = 5000`

---

## 3. Multi-Database Conflict Detection & Mandatory Stop Guard

Implemented in `src/db/migrationManager.ts` (`detectDatabaseCandidates()`, `assertNoDatabaseConflict()`, `DatabaseConflictError`) and wired BEFORE opening or creating any SQLite file in:
- `src/db/index.ts` (startup load & `reopenDatabase()`)
- `src/db/initProductionDb.ts` (`initializeFreshProductionDatabase()`)

### Conflict Rules
1. **`MULTIPLE_POS_DATABASES`:** Two or more SQLite files in the target directory contain at least 2 GOLDEN PALACE POS signature tables (`users`, `orders`, `products`, `categories`, `payments`, `cash_shifts`) — for example, both `golden_palace.db` and `golden_palace_production.db`. The application refuses to guess and immediately aborts startup.
2. **`HISTORICAL_DB_WOULD_BE_BYPASSED`:** Production mode targets `golden_palace_production.db` (which is absent or empty) while another populated historical POS database (e.g., `golden_palace.db`) exists in the same directory. The application refuses to create a fresh empty production database and aborts startup.
3. **Non-POS canary safety:** Non-POS helper files (such as a dummy canary file containing zero POS tables) are inspected read-only and do not cause false positives.
4. **Database Identification Report (`database_identification_report.json`):**
   - Written in the target directory with `0600` permissions whenever a conflict triggers.
   - Records `generatedAt`, `targetDbPath`, `reasonCode`, `ownerActionRequired`, `confirmationEnvVar`, and read-only per-candidate metadata (`filename`, `sizeBytes`, `modifiedAt`, `integrityCheck`, `userVersion`, `tableCount`, and counts of `users`, `categories`, `products`, `orders`, `payments`, `cashShifts`).
   - **Zero credentials exposed:** Never reads or logs password hashes, PINs, or JWT secrets.
5. **Owner Resolution:** Startup proceeds only after the owner reviews the report, backs up all candidates, and explicitly confirms the single authoritative file via `GOLDEN_PALACE_CONFIRMED_DB_PATH` (or consolidates to one authoritative database file).

---

## 4. Schema Version Tracking & Migration Architecture

Implemented in `src/db/migrationManager.ts` (`runVersionedMigrations()`, `buildStandardMigrations()`, `ensureColumnStrict()`, `LATEST_SCHEMA_VERSION = 4`):

### 4.1 Dual Tracking (`PRAGMA user_version` + `schema_migrations` Ledger)
- `PRAGMA user_version` is updated atomically inside each migration step's SQLite transaction.
- `schema_migrations` ledger schema:
  - `version INTEGER PRIMARY KEY`
  - `name TEXT NOT NULL`
  - `checksum TEXT NOT NULL` (SHA-256 prefix of step metadata)
  - `status TEXT NOT NULL` (`'IN_PROGRESS'` -> `'APPLIED'` or `'FAILED'`)
  - `backup_path TEXT` (path to the verified `PRE_MIGRATION` backup)
  - `applied_at TEXT`, `duration_ms INTEGER`, `error_message TEXT`

### 4.2 Standard Versioned Migrations (`v1` -> `v4`)
| Version | Migration Name | Purpose |
|---|---|---|
| `1` | `001_base_pos_schema` | Non-destructively ensures all 29 core GOLDEN PALACE POS tables and base indexes exist (`CREATE TABLE IF NOT EXISTS`). |
| `2` | `002_legacy_phase03_to_09_compatibility` | Strictly adds backward-compatible Phase 03–09 columns via `ensureColumnStrict()` and safely reconciles legacy camelCase `print_jobs` rows into snake_case columns without data loss. |
| `3` | `003_official_menu_variants_addons_discounts` | Strictly adds Official Menu Integration (`products.sku`, `subcategory_ar/fr`, `is_active`), pizza variant prices (`product_variants.price/sku/is_active`), add-on flags, order discount audit fields, and `audit_logs.previous_value/new_value`. |
| `4` | `004_integrity_and_performance_indexes` | Strictly creates unique idempotency/offline indexes (`orders.offline_id`, `cash_movements.idempotency_key`, `print_jobs.job_key`) and catalog lookup indexes. |

### 4.3 Removal of Silent Migration Error Handling
- Removed the previous `ensureColumnExistsOn()` silent `catch {}` wrapper and removed silent `catch {}` blocks around `CREATE UNIQUE INDEX`, `print_jobs` reconciliation, and `migratePlaintextPins()` in `src/db/index.ts`.
- Any schema, DDL, index, integrity, or foreign-key error logs an explicit `❌ [DB MIGRATION FAILED]` diagnostic, marks the ledger step `FAILED` (prior to rollback), triggers deterministic rollback when a `PRE_MIGRATION` backup exists, and throws a typed `DatabaseMigrationError` that aborts startup cleanly.

---

## 5. Automatic Pre-Migration Backup & Deterministic Rollback

### 5.1 Pre-Migration Backup Flow (`createVerifiedPreMigrationBackup`)
1. Triggered automatically whenever `isDatabasePopulated(targetDb)` is true on an on-disk database and pending migrations (or interrupted recovery) will mutate the database.
2. Runs `PRAGMA wal_checkpoint(FULL)` to flush all committed WAL frames so active shift/order/payment writes are captured.
3. Executes `VACUUM INTO '<backupPath>.tmp'` to produce a standalone, transactionally consistent SQLite snapshot.
4. Opens the `.tmp` snapshot **read-only** and runs `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.
5. Applies `0600` permissions and atomically renames to `gp_pos_pre_migration_<timestamp>_<hex>.db` inside `backups_production/` (or `backups/` in dev).
6. Registered `'PRE_MIGRATION'` in `src/services/backupService.ts` (`BackupKind` + `inferBackupTypeFromFilename()`) so Backup Manager surfaces and classifies pre-migration backups accurately.

### 5.2 Deterministic Rollback Flow (`rollbackDatabaseFromBackup`)
1. Verifies the `PRE_MIGRATION` backup file exists, is non-empty, and passes read-only `PRAGMA integrity_check = ok`.
2. Closes the active SQLite connection handle.
3. Copies the verified backup to `<dbPath>.rollback.<ts>.tmp` (`0600` permissions).
4. Removes stale `-wal` and `-shm` sidecar files so corrupted or half-migrated WAL frames cannot replay.
5. Atomically renames `.tmp` over `<dbPath>` and verifies the restored live database passes read-only `PRAGMA integrity_check = ok` and `foreign_key_check = []`.

---

## 6. Verification Evidence — All 7 Database Scenarios & Regression Suite

All tests ran exclusively against isolated temporary SQLite databases under `/tmp/gp_pos_phase1_*` (zero real restaurant data touched).

### 6.1 Phase 1 Dedicated Safety Test Matrix (`src/__tests__/phase1.database.safety.test.ts`)

| # | Scenario / Guard Tested | Measured Result | Key Assertions Verified |
|---|---|---|---|
| G1 | **Canonical Path Policy** | **PASS** | Desktop prod -> `golden_palace_production.db` + `backups_production`; Dev -> `golden_palace.db` + `backups`; zero mixing |
| G2 | **Multi-DB Conflict Stop Guard** | **PASS** | Stops with `MULTIPLE_POS_DATABASES` when both DBs exist; stops with `HISTORICAL_DB_WOULD_BE_BYPASSED` without creating empty prod DB; writes credential-free `database_identification_report.json`; unlocks only with explicit owner `confirmedDbPath` |
| S1 | **Scenario 1: Fresh Installation** | **PASS** | Applies v1–v4, `PRAGMA user_version = 4`, `schema_migrations` ledger 4/4 `APPLIED`, WAL + FK=ON, `integrity_check = ok`, zero demo rows |
| S2 & S3 | **Scenario 2 & 3: Previous Schema Version + Rich Restaurant DB** | **PASS** | Upgrades legacy pre-Phase-09 schema (`user_version = 0`, camelCase `print_jobs`, plaintext PINs) with verified `PRE_MIGRATION` backup; preserves all 10 business entity groups (`users`, `orders`, `order_items` historical price `450` vs catalog `500`, `payments`, `cash_shifts`, `products`, `categories`, `ingredients`, `inventory_movements`, `price_history`, reconciled `print_jobs`, `audit_logs`); hashes legacy PINs to bcrypt; second run is clean no-op |
| S4 | **Scenario 4: Partially Migrated / Interrupted Migration** | **PASS** | Detects `v2 IN_PROGRESS` + half-applied columns + `user_version = 1`; creates verified `PRE_MIGRATION` backup; sets `interruptedRecoveryTriggered = true`; completes v2, v3, v4 cleanly with zero data loss |
| S5 | **Scenario 5: Corrupted Database** | **PASS** | Refuses both non-SQLite garbage header and corrupted internal page (`DatabaseMigrationError` / `DATABASE_CORRUPTED`); leaves corrupted file bytes 100% untouched for forensic recovery |
| S6 | **Scenario 6: Active WAL Financial Records** | **PASS** | With `wal_autocheckpoint = 0` and new `BON-WAL-002` order/payment sitting in `-wal`, `PRE_MIGRATION` backup checkpoints WAL and captures all 2 orders + 2 payments + shift cleanly |
| S7 | **Scenario 7: Explicit Migration Failure & Automatic Rollback** | **PASS** | Injected fatal DDL failure at v5 logs `❌ [DB MIGRATION FAILED]`, throws `DatabaseMigrationError` (`MIGRATION_FAILED`, `rolledBack = true`), and deterministically restores exact pre-migration state (`user_version = 0`, `schema_migrations` absent, `integrity_check = ok`, all original rows preserved) |

### 6.2 End-to-End Node.js 22 Native Startup Verification
1. **Clean isolated boot (`node server.ts` on port `3099`, fresh `/tmp` prod DB):**
   - Result: **PASS** — HTTP `200` on `GET /api/health`, `PRAGMA user_version = 4`, `integrity_check = ok`, `fkViolations = 0`, `schema_migrations` ledger `[1, 2, 3, 4]` all `APPLIED`.
2. **Conflict stop guard on boot (`node server.ts` on port `3098`, populated historical `golden_palace.db` present, `golden_palace_production.db` absent):**
   - Result: **PASS** — Process exited immediately with exit code `1`, `golden_palace_production.db` was **NOT** created (`prodCreated: false`), and `database_identification_report.json` was generated with `reasonCode: "HISTORICAL_DB_WOULD_BE_BYPASSED"`.

### 6.3 Exact Commands Executed & Measured Results

| Command | Result | Summary |
|---|---|---|
| `npx vitest run src/__tests__/phase1.database.safety.test.ts --no-color` | **PASS (exit 0)** | 1/1 test file passed, **8/8 tests passed** (`1.21s`) |
| `npm test -- --no-color` | **23/24 files PASS** | **150/151 tests passed** (`79.59s`); only failure is pre-existing Phase 0 baseline missing `build/icon.png` & `build/icon.ico` in `src/__tests__/phase12.release.acceptance.test.ts:82` |
| Isolated `node server.ts` clean boot verification | **PASS (exit 0)** | HTTP 200 `/api/health`, `user_version=4`, `integrity_check=ok`, `fkViolations=0` |
| Isolated `node server.ts` conflict stop guard verification | **PASS (exit 0)** | Server exited with code `1`, `prodCreated=false`, `database_identification_report.json` created |
| `compile_applet` (`npm run build`) + `lint_applet` (`tsc --noEmit`) | **PASS (exit 0)** | Production build succeeded cleanly; `tsc --noEmit` completed with 0 TypeScript errors |

---

## 7. Files Created & Modified in Phase 1

### Created
- `src/db/migrationManager.ts` — Multi-DB conflict stop guard, `DatabaseIdentificationReport`, integrity checks, `PRE_MIGRATION` backup (`VACUUM INTO`), deterministic rollback, and versioned migration runner (`v1`–`v4`).
- `src/__tests__/phase1.database.safety.test.ts` — Automated regression suite covering canonical path policy, conflict stop guard, and all 7 isolated database scenarios.
- `docs/FINAL_RELEASE/PHASE_01_DATABASE_SAFETY_REPORT.md` — This Phase 1 evidence report.

### Modified
- `src/db/sqlitePath.ts` — Added `CONFIRMED_DB_PATH_ENV`, `CanonicalDatabasePolicy`, and `resolveCanonicalDatabasePolicy()`.
- `src/db/index.ts` — Enforced `assertNoDatabaseConflict()` before opening SQLite; replaced silent column/index catches with `runVersionedMigrations()`; parameterized `migratePlaintextPins(targetDb)` without silent swallowing; re-exported migration & integrity APIs.
- `src/db/initProductionDb.ts` — Enforced `assertNoDatabaseConflict()` before fresh production DB initialization; added `schemaVersion` to `ProductionDbInitVerification`.
- `src/services/backupService.ts` — Added `'PRE_MIGRATION'` to `BackupKind` and `_pre_migration_` filename recognition.
- `src/services/desktopLifecycle.ts` — Passed `targetDb` explicitly into `migratePlaintextPins(targetDb)` inside `runFirstRunDatabaseAudit()`.

---

## 8. Unresolved Risks & Explicit Limitations

1. **Linux Container Verification Only (Not Physical Windows 10/11 Hardware):** All Phase 1 tests executed on Linux x86_64 (`4.19.0-gvisor`). Windows-specific file locking semantics (antivirus scanners or Explorer holding a handle during atomic `fs.renameSync` rollback on NTFS) require validation during the Windows Packaging & Real-Hardware Smoke Test phase (Phase 11/12).
2. **Existing Restaurant Machine Database Inspection Not Performed Here:** Per strict safety rules, no real restaurant machine database was inspected in this phase. On any existing deployment with a legacy `golden_palace.db`, the new stop guard will intentionally halt startup and emit `database_identification_report.json` until the owner confirms the authoritative file and executes an offline-backed-up cutover.
3. **Electron Main Process Error Dialog Presentation:** When `server.ts` exits with `DatabaseConflictError` or `DatabaseMigrationError` inside Electron, `electron/main.cjs` currently surfaces a generic backend startup error dialog; dedicated localized Arabic/French recovery messaging for DB conflict / corruption errors can be refined in Phase 3 (Desktop Hardening).
4. **Pre-existing Baseline Failure Preserved:** `src/__tests__/phase12.release.acceptance.test.ts:82` still fails because `build/icon.png` and `build/icon.ico` are absent in this workspace snapshot (intentionally untouched in Phase 1; scheduled for desktop packaging phase).

---

## 9. Readiness Decision for Phase 2

**DECISION: READY FOR PHASE 2 (CORE POS, BILLING, SHIFTS, AND FINANCIAL INTEGRITY)** — pending explicit user authorization.

- All 10 mandatory Phase 1 requirements are implemented, verified with automated tests across all 7 isolated database scenarios, and regression-checked with zero regressions introduced across all 23 passing suites.
- Execution is **PAUSED** here per master phase-gating discipline; Phase 2 will NOT begin until explicitly authorized by the user.
