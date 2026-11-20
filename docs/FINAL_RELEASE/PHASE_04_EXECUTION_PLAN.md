# PHASE 4 — EXECUTION PLAN
## Desktop Packaging Readiness, Official Build Icons, Print Queue Honesty & Backup Verification Hardening
### GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)

**Plan Date (UTC):** 2026-11-20  
**Status:** DRAFT — AWAITING EXPLICIT OWNER AUTHORIZATION (DO NOT EXECUTE YET)  
**Target Scope:** Development workspace and isolated temporary SQLite databases ONLY  
**Non-Goals (Explicitly Excluded from Phase 4):**
- NO Electron major version upgrade (deferred to a separate OS-confirmed phase after Windows 10/11 confirmation).
- NO database schema changes or new SQLite migrations (Phase 1 `LATEST_SCHEMA_VERSION = 4` remains untouched).
- NO POS UI redesign or visual overhaul.
- NO production database access, modification, deployment, or installation on the restaurant PC.

---

## 1. Exact Phase 4 Scope & Workstreams (4 Bounded Workstreams)

### Workstream 4A — Official Build Icons Generation & Packaging Asset Hygiene
- **Objective:** Unblock `electron-builder` NSIS packaging and restore 100% passing `phase12.release.acceptance.test.ts` while ensuring zero dev/prompt artifacts enter production `dist/`.
- **Exact Actions (Upon Authorization):**
  1. Verify `public/icons/icon-512.svg` checksum (`bed1fcc9ad9471a2e2d74ae646802aa997b302b83d1d2635a5846c9cae56dcb7`) and preserve it byte-for-byte unchanged.
  2. Generate official `build/icon.png` (`512×512` 8-bit sRGB RGBA PNG) from `public/icons/icon-512.svg` using pre-installed `ffmpeg` (`librsvg` + `fontconfig` + `fribidi`).
  3. Generate multi-resolution `build/icon.ico` (`256, 64, 48, 32, 24, 16` px frames) from `build/icon.png` using pre-installed ImageMagick `convert`.
  4. Independently verify binary PNG (`89 50 4E 47`) and ICO (`00 00 01 00`) headers, embedded frame dimensions, and record SHA-256 checksums.
  5. Exclude `public/assets/aistudio/` from production Vite/Electron packaging (either by removing the stray `public/assets/aistudio/Paste_November_20__2026_-_12_42PM_0ce16838` file once explicitly authorized, or via explicit packaging hygiene verification confirming zero `aistudio` paste files exist in `dist/`).
- **Files Created / Touched:**
  - Created: `build/icon.png`, `build/icon.ico`
  - Hygiene cleanup (only if explicitly approved in authorization): remove `public/assets/aistudio/Paste_November_20__2026_-_12_42PM_0ce16838`

### Workstream 4B — Print Queue Honesty, Retry Fidelity & Safer Windows Spooler Dispatch
- **Objective:** Close BLK-05 without breaking any existing Phase 9, Phase 10, or Phase 12 API contracts or database schema.
- **Exact Actions (Upon Authorization):**
  1. **Honest Confirmation Semantics (`src/services/printQueueService.ts`):**
     - Ensure `sendToNetworkPrinter` honestly sets `hardwareConfirmed: false` (TCP socket write confirms network acceptance only, NOT physical paper exit) while preserving `spoolerAccepted: true` and `success: true`, leaving `confirmed_at` populated exclusively when physical receipt confirmation (`POST /api/printer/jobs/:id/confirm`) or explicit hardware confirmation is received.
     - Keep API response fields backward-compatible (`status`, `spoolerAccepted`, `hardwareConfirmed`, `deliveryState`: `'SPOOLED' | 'CONFIRMED' | 'FAILED'`) so existing frontend components and Phase 9 tests continue working while exposing honest delivery distinction (`SPOOLED` vs physically `CONFIRMED`).
  2. **Safer Windows Spooler Command Execution (`src/services/printQueueService.ts`):**
     - Replace raw `exec('copy /b ...')` shell string interpolation with safer `execFile('cmd.exe', ['/d', '/c', 'copy', '/b', tempFilePath, uncTarget], ...)` (or strict argument array without shell metacharacter expansion) with strict printer-name validation and deterministic temp file cleanup.
  3. **Full ESC/POS Payload Preservation for Retry (Schema-Free):**
     - When `rawBase64` is provided on a print job, preserve retry fidelity safely (or validate/document `overrideRawBase64` retry path) without altering the SQLite schema, ensuring failed jobs cannot silently lose formatting on retry.
- **Files Touched:**
  - Modified: `src/services/printQueueService.ts` (and minimal non-breaking status exposure in `src/server/api.ts` if needed)

### Workstream 4C — Backup Integrity Checksums, FK Verification & Windows-Resilient Restore Swap
- **Objective:** Close BLK-07 while maintaining 100% backward compatibility with existing backups and `backup_manifest.json` files.
- **Exact Actions (Upon Authorization):**
  1. **SHA-256 Digest Recording & Verification (`src/services/backupService.ts`):**
     - Compute and store `sha256` on every newly created `VERIFIED` backup entry in `backup_manifest.json`.
     - During `verifyExistingBackup()` and pre-restore validation, if a manifest entry has a stored `sha256`, verify the on-disk file matches the recorded SHA-256 digest and reject tampered/bit-rotted files as `CORRUPTED` before touching the live database.
  2. **Foreign-Key Integrity Check in Backup Verification:**
     - Run `PRAGMA foreign_key_check` during `verifyBackupFile()` and report `foreignKeyViolationsCount` in verification results so foreign-key corruption is surfaced alongside `PRAGMA integrity_check`.
  3. **Windows NTFS Transient-Lock Retry on Restore Swap:**
     - Wrap `fs.renameSync(stagingPath, dbPath)` and `-wal`/`-shm` cleanup in a bounded helper (`retryOnTransientLock`, max 5 attempts, 100–250ms delay on `EPERM`/`EBUSY`/`EACCES`) to protect Windows 10/11 restores against transient antivirus/indexer handle locks without changing rollback guarantees.
- **Files Touched:**
  - Modified: `src/services/backupService.ts`

### Workstream 4D — Automated Phase 4 Regression Tests, Desktop Bundle Verification & Release Readiness Documentation
- **Objective:** Verify all Phase 4 improvements, verify zero regressions across Phases 1–3 and all 26 existing test suites, and prepare the Windows CI + Physical Hardware Execution Runbook for Phase 5.
- **Exact Actions (Upon Authorization):**
  1. Create `src/__tests__/phase4.packaging.printing.backup.test.ts` testing:
     - Official `build/icon.png` & `build/icon.ico` binary signatures, dimensions, and multi-frame ICO integrity.
     - Production `dist/` hygiene (no `aistudio` paste files, no secrets, no inline scripts).
     - Honest print transport `hardwareConfirmed` / `deliveryState` reporting and safer Windows spooler argument handling.
     - Backup SHA-256 tamper detection (mutating 1 byte of a verified backup fails restore cleanly without touching live DB), `foreign_key_check` reporting, and NTFS transient-lock retry during restore swap.
  2. Execute full verification gate:
     - `npm test -- --no-color` (target: **27/27 test files PASS, 100% tests PASS, 0 failures**)
     - `npm run lint` (`tsc --noEmit`, 0 errors)
     - `npm run build` + `npm run build:server` (`dist/` + `dist-electron/server.cjs` clean build)
     - Verify Phase 1 (`8/8`), Phase 2 (`7/7`), Phase 3 (`6/6`), and Phase 12 acceptance (`3/3`) all PASS.
  3. Create `docs/FINAL_RELEASE/PHASE_04_COMPLETION_REPORT.md` and `docs/FINAL_RELEASE/PHASE_05_WINDOWS_HARDWARE_RUNBOOK.md`.

---

## 2. Dependencies & Prerequisites

| Dependency | Status | Notes |
|---|---|---|
| Phase 1 Database Safety (`8/8` tests) | **SATISFIED** | Must remain 100% untouched. |
| Phase 2 Backend Reliability (`7/7` tests) | **SATISFIED** | Must remain 100% untouched. |
| Phase 3 Electron & Desktop Security (`6/6` tests) | **SATISFIED** | Must remain 100% untouched. |
| Source brand SVG (`public/icons/icon-512.svg`) | **SATISFIED** | Verified present (`1,579 B`, intact SHA-256). |
| Pre-installed `ffmpeg`, `convert`, `python3` | **SATISFIED** | Verified installed in container (`/usr/bin/*`); zero new npm dependencies needed. |
| Owner Explicit Authorization for Phase 4 | **PENDING** | Blocking gate before any edit or file creation. |
| Owner Decision on Stray File Removal (`public/assets/aistudio/...`) | **PENDING** | Confirm whether to delete or exclude via Vite config. |
| Owner Confirmation on Target Windows OS (Win 7 vs Win 10/11) | **DEFERRED TO PHASE 5/6** | Not needed for Phase 4; required before any future Electron LTS upgrade. |

---

## 3. Acceptance Criteria (All Must Be Met for Phase 4 PASS)

1. **`build/icon.png`** exists (`512×512` RGBA PNG, valid PNG header) and **`build/icon.ico`** exists (valid Windows ICO header with 6 embedded frames: `256, 64, 48, 32, 24, 16`), with `public/icons/icon-512.svg` byte-for-byte unchanged.
2. **`src/__tests__/phase12.release.acceptance.test.ts`** passes **3/3** (resolving the sole failing test in the workspace).
3. **Production `dist/` bundle** contains zero `aistudio` paste files, zero secrets, and remains compact (< 5 MB `dist/`, < 10 MB `dist-electron/server.cjs`).
4. **Print queue honesty:** TCP 9100 & Windows Spooler dispatch never falsely claim `hardwareConfirmed: true` prior to physical confirmation, `exec()` shell string interpolation is eliminated from `sendToWindowsSpooler`, and all existing Phase 9 printing tests remain 100% passing.
5. **Backup tamper detection & Windows resilience:** Backup manifest records SHA-256 digests, tampered backups are deterministically rejected before restore (zero live DB mutation), `foreign_key_check` is evaluated, and transient-lock restore retries are unit-tested.
6. **Full Verification Gate = 100% GREEN:**
   - `npm test -- --no-color`: **100% PASS (0 failed files, 0 failed tests)**
   - `npm run lint` (`tsc --noEmit`): **0 errors**
   - `npm run build` & `npm run build:server`: **PASS**
   - Zero regressions across Phase 1, Phase 2, and Phase 3 safeguards.
7. **Strict Boundaries Respected:** Zero Electron major upgrade, zero SQLite schema/migration modifications, zero production DB contact, and pause strictly before Phase 5.

---

## 4. Mandatory STOP Conditions

Execution of Phase 4 MUST **STOP IMMEDIATELY** and escalate to the owner if ANY of the following occur:
1. Any Phase 1 (`phase1.database.safety.test.ts`), Phase 2 (`phase2.backend.reliability.test.ts`), or Phase 3 (`phase3.electron.desktop.security.test.ts`) safeguard test fails and cannot be resolved without weakening a protection.
2. Any required change in Workstream 4B or 4C turns out to require a database schema migration (schema changes are strictly out of scope for Phase 4).
3. Icon rasterization from `public/icons/icon-512.svg` produces broken Arabic glyphs, missing alpha transparency, or fails PNG/ICO binary frame validation.
4. Any unexpected production database file is discovered inside the workspace.
5. Any change requires upgrading `electron`, `better-sqlite3`, or `electron-builder` major versions.

---

## 5. Rollback Procedures

Because Phase 4 makes **zero database schema or migration changes** and **zero dependency upgrades**, rollback is clean, localized, and 100% reversible:

1. **Pre-Edit Timestamped Snapshots:** Before modifying `src/services/printQueueService.ts` or `src/services/backupService.ts`, copy exact originals with recorded SHA-256 checksums into a timestamped backup directory under `/tmp/gp_pos_phase4_backup_<UTC>/`.
2. **Workstream 4A Rollback:** Remove generated `build/icon.png` and `build/icon.ico` (and restore `public/assets/aistudio/...` from `/tmp` backup if removed).
3. **Workstream 4B Rollback:** Restore `src/services/printQueueService.ts` (and `src/server/api.ts` if touched) from timestamped `/tmp` snapshot; re-run `npx vitest run src/__tests__/phase9.printing.desktop.test.ts`.
4. **Workstream 4C Rollback:** Restore `src/services/backupService.ts` from timestamped `/tmp` snapshot; existing `backup_manifest.json` files remain 100% compatible because `sha256` and `foreignKeyViolationsCount` are strictly additive optional fields; re-run `npx vitest run src/__tests__/phase7.backup.backend.test.ts`.
5. **Post-Rollback Verification:** Re-run `npm run lint`, `npm run build`, and `npm test` to confirm clean restoration to the verified Phase 3 baseline (`163/164` tests).
