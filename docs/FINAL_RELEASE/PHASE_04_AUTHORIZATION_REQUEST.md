# PHASE 4 — OWNER AUTHORIZATION REQUEST
## GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)

**Request Date (UTC):** 2026-11-20  
**Current State:** Phase 3 COMPLETE & VERIFIED; Phase 4 Discovery & Planning COMPLETE (ZERO code modified)  
**Supporting Documents:**
- `docs/FINAL_RELEASE/PHASE_04_DISCOVERY_REPORT.md`
- `docs/FINAL_RELEASE/PHASE_04_EXECUTION_PLAN.md`

---

## 1. Proposed Phase 4 Title & Objective

**PHASE 4 — Desktop Packaging Readiness, Official Build Icons, Print Queue Honesty & Backup Verification Hardening**

Objective: Close the remaining software-side release blockers so the automated test suite achieves **100% PASS (0 failures)**, production bundles are clean and free of dev artifacts, thermal print queue delivery semantics and Windows spooler execution are hardened, and SQLite backup verification enforces SHA-256 tamper detection and Windows NTFS-safe restore swapping — **without** touching database migrations, **without** upgrading Electron, and **without** modifying any production database.

---

## 2. Exact Scope Requested for Authorization

1. **Official Build Icons (`build/icon.png` & `build/icon.ico`):**
   - Generate new official `512×512` PNG and 6-frame Windows ICO (`256/64/48/32/24/16`) from unchanged `public/icons/icon-512.svg` using pre-installed `ffmpeg` and ImageMagick `convert` (zero new packages).
   - Resolves the sole failing test in the repository (`src/__tests__/phase12.release.acceptance.test.ts:82`) and unblocks Windows NSIS packaging (`electron-builder.yml`).
2. **Production Bundle Hygiene (`public/assets/aistudio/`):**
   - Exclude or remove the stray `26 KB` AI Studio paste file (`public/assets/aistudio/Paste_November_20__2026_-_12_42PM_0ce16838`) so it is never copied into production `dist/`.
3. **Print Queue Honesty & Safer Windows Spooler Dispatch (`src/services/printQueueService.ts`):**
   - Ensure raw TCP 9100 and Windows Spooler delivery never falsely claim `hardwareConfirmed: true` prior to physical confirmation while preserving backward-compatible API contracts.
   - Replace `exec()` shell string interpolation in `sendToWindowsSpooler` with strict argument-array execution (`execFile`) and preserve retry integrity without schema changes.
4. **Backup Verification & Windows Restore Resilience (`src/services/backupService.ts`):**
   - Record and validate SHA-256 checksums in `backup_manifest.json` to block tampered/bit-rotted backups before restore.
   - Add `PRAGMA foreign_key_check` reporting to `verifyBackupFile()`.
   - Add bounded retry handling (`EPERM`/`EBUSY`) for Windows NTFS file swap during restore without altering automatic rollback guarantees.
5. **Automated Phase 4 Verification & Phase 5 Hardware Runbook:**
   - Add `src/__tests__/phase4.packaging.printing.backup.test.ts`.
   - Run full regression suite (`npm test`), `tsc --noEmit`, `npm run build`, and `npm run build:server`.
   - Create `docs/FINAL_RELEASE/PHASE_04_COMPLETION_REPORT.md` and `docs/FINAL_RELEASE/PHASE_05_WINDOWS_HARDWARE_RUNBOOK.md`.

---

## 3. Explicit Non-Scope & Safety Guarantees

- **Zero production database access or modification** (all tests use isolated `os.tmpdir()` SQLite databases).
- **Zero database schema or migration changes** (Phase 1 `LATEST_SCHEMA_VERSION = 4` and all safeguards remain untouched).
- **Zero Electron major upgrade** (`electron@22.3.27` stays pinned pending your OS confirmation below).
- **Zero POS UI redesign** and **zero weakening** of Phase 1, Phase 2, or Phase 3 protections.
- **Zero deployment or installation** on the restaurant computer.
- **Automatic STOP** after Phase 4 completion to await authorization before Phase 5 (Windows `.exe` Installer Build & Physical Hardware Validation).

---

## 4. Owner Decisions Requested Before Phase 4 Execution

Please reply with your approval and confirm the two operational options below:

1. **Phase 4 Execution Authorization:**
   - [ ] **APPROVE PHASE 4** as defined in `PHASE_04_EXECUTION_PLAN.md` (Workstreams 4A–4D).
   - [ ] **APPROVE WITH MODIFICATIONS** *(specify any workstream to adjust or defer)*.
   - [ ] **HOLD / DO NOT PROCEED**.

2. **Stray Dev File Handling (`public/assets/aistudio/Paste_November_20__2026_-_12_42PM_0ce16838`):**
   - [ ] **Option A (Recommended):** Delete the stray paste file from `public/assets/aistudio/` so `dist/` stays clean.
   - [ ] **Option B:** Keep the file on disk and exclude `assets/aistudio/` from production packaging only.

3. **Informational Gate for Future Phase 5/6 Planning (Does NOT Block Phase 4):**
   - Does the restaurant cashier computer currently run **Windows 10/11 64-bit** or **Windows 7 SP1 64-bit**? *(Required later to decide whether to schedule a dedicated Electron LTS `35.x`/`36.x` upgrade or remain on hardened Electron `22.3.27`.)*

---

**EXECUTION STATUS: PAUSED — AWAITING EXPLICIT OWNER AUTHORIZATION.**
