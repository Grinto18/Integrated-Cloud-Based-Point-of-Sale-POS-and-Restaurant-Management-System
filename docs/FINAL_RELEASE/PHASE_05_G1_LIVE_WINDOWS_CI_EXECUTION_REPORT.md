# GOLDEN PALACE POS — PHASE 5 G1 LIVE WINDOWS CI EXECUTION REPORT

**Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)  
**Gate:** Phase 5 — Gate G1 (Live Windows CI Execution on `windows-latest`)  
**Target Installer:** `GoldenPalacePOS-Setup-x64.exe`  
**Electron Version:** `22.3.27` (Strictly Pinned, ABI `110`)  
**Native SQLite Module:** `better-sqlite3@11.10.0` (Windows MSVC C++20, ABI `110`, x64)  
**SQLite Schema Version:** `4` (`LATEST_SCHEMA_VERSION = 4` — Unmodified)  
**Report Timestamp (UTC):** `2026-11-20T14:41:20Z`

---

## CURRENT G1 STATUS: **G1-A Build & Test Gate `PASS` | G1-B NSIS Installer Packaging `PENDING OWNER AUTHORIZATION`**

> **Verified Live Windows CI Run (`G1-A`):** GitHub Actions Run ID `44939198323` (Run `#4`, `windows-latest` x64) on Commit `f186eefbf5c4ea13354be54383cf9d215ee01bb6` passed `5/5` Rolldown Hard Gate, `npm run build:desktop`, `tsc --noEmit`, `28/28` Vitest files (`175/175` tests), and Stop Gate reporting before installer packaging (`stop_before_packaging=true`, artifact `GoldenPalacePOS-DesktopBuild-Logs-run-4-44939198323`).  
> **Honesty & Compliance Guarantee:** Direct GitHub API log retrieval is unavailable from this isolated Linux container (no `gh` CLI / token); evidence is recorded strictly from the owner-verified Run `#4` (`44939198323`). No Windows `.exe` binary was fabricated on Linux, Electron `22.3.27` was not upgraded, SQLite schema version `4` was not altered, and no production database was accessed. Installer packaging (`G1-B`), Windows OS compatibility (`G2`), and physical thermal printer validation (`G3`) remain **`PENDING`**.

---

## 1. Repository, Commit & Workspace Identification

| Inspection Field | Observed Result | Status |
|---|---|---|
| **Local Workspace Host** | `Linux localhost 4.19.0-gvisor x86_64` (`Node v22.23.2`, `npm 10.9.8`) | Verified |
| **Git Binary (`/usr/bin/git`)** | Installed | Verified |
| **GitHub CLI (`gh`)** | Not installed | Unavailable |
| **`.git` Directory / Work Tree** | **Absent** (`fatal: not a git repository`) | **`BLOCKED`** |
| **Git Remote URL (`origin`)** | **Unavailable** (no `.git/config`, no `github.com/<owner>/<repo>` URL found in repository files) | **`BLOCKED`** |
| **Branch & Commit SHA** | **Unavailable in container** (must be identified from the owner's pushed GitHub commit/branch prior to dispatch) | **`BLOCKED`** |
| **GitHub Auth Env Vars (`GH_*` / `GITHUB_*`)** | None present (verified names only; zero credentials printed or exposed) | **`BLOCKED`** |
| **Lockfile Consistency (`package.json` vs `package-lock.json`)** | `lockfileVersion: 3`, `0` dependency diffs, `0` devDependency diffs | **`PASS`** |
| **SQLite Schema Guard (`src/db/migrationManager.ts`)** | `export const LATEST_SCHEMA_VERSION = 4;` (line 12, untouched) | **`PASS`** |

### Verified Workspace Configuration Baseline Digests (SHA-256)

Because this container has no Git commit hash, the exact SHA-256 digests of the release build configuration files audited and verified in this workspace are recorded below so the owner can verify exact parity after pushing to GitHub:

| File | SHA-256 |
|---|---|
| `.github/workflows/build-windows.yml` | `0fac150151eb764e9fffc4418ddd30b6ff7d3edcc08b844138f97488f8fd52d8` |
| `electron-builder.yml` | `0b7d5091e451a4936cf8af94ddf0c299157299e4f1cac1e30a3a24794683eb42` |
| `scripts/build-windows-installer.ps1` | `f3bc9ac9d73757bed8cc5853d6ead9bad571f816c25548e085d9b9e2a9891ff1` |
| `package.json` | `d589b7a7506fa4b7e1dc990a4c2ddf2138407a26753e925b3f417c17eb38d280` |
| `package-lock.json` | `da2cb4680719a63da44badfa258f2440a456b062b21a3ae2de42c9417579d0fb` |
| `build/icon.ico` | `eca98c284154be449a4086c2ce8dbdc1f0bc4017a19f1b685ec5221db106d28e` |
| `build/icon.png` | `0863771c2aa05c9488b66d40a1c3b02488cf54d7cd5601d63a8b33c746aa90b8` |

---

## 2. Workflow Audit & Hardening Applied Before G1 Dispatch

Auditing `.github/workflows/build-windows.yml` against all 12 G1 Strict Build Requirements and Section 4 Artifact Requirements identified and resolved **4 critical pre-flight improvements** (YAML syntax re-validated cleanly via `js-yaml`):

1. **Strict Pinned Dependency Enforcement (`npm ci` + Version Lock Assertion):**
   - Replaced `npm install --legacy-peer-deps` with `npm ci --legacy-peer-deps --no-audit --no-fund` so `windows-latest` installs exact versions locked in `package-lock.json` (`electron@22.3.27`, `better-sqlite3@11.10.0`, `@electron/rebuild@4.2.1`, `electron-builder@23.6.0`, `typescript@7.0.2`, `vitest@5.1.0`).
   - Added a hard post-install check failing the job if installed `electron` differs from `22.3.27` or `better-sqlite3` differs from `11.10.0`.
2. **Explicit Windows MSVC C++20 Toolchain Pre-Flight Check & Least-Privilege Permissions:**
   - Added `permissions: contents: read` at the workflow root.
   - Added a `vswhere.exe` pre-flight check confirming `Microsoft.VisualStudio.Component.VC.Tools.x86.x64` is present on `windows-latest` and recording tool versions (without exposing secrets or env vars) into `release\ci-logs\00-environment.log`.
3. **Complete Build & Validation Log Capture + PowerShell 7 `stderr` Safety Fix:**
   - Added clean UTF-8 log capture (`release\ci-logs\00-environment.log` through `06-validation-report.log`) for dependency install, `build:desktop`, full test suite, TypeScript validation, native `electron-rebuild`, `electron-builder`, and PE32+/`app.asar.unpacked`/SHA-256 verification.
   - Prevented PowerShell 7's GitHub Actions default `$ErrorActionPreference = 'Stop'` from aborting on benign native `stderr` output (e.g., `node-gyp`, `npm`, and intentional Phase 1 migration-rollback error-logging tests in Vitest) by converting redirected stream lines safely while still throwing immediately whenever `$LASTEXITCODE -ne 0`.
4. **Unique Run-Scoped 90-Day Artifacts (Including Logs) & Zero Overwrite Guarantee:**
   - Updated success artifact upload to `GoldenPalacePOS-Setup-x64-run-${{ github.run_number }}-${{ github.run_id }}` (`retention-days: 90`), uploading:
     - `release/GoldenPalacePOS-Setup-x64.exe`
     - `release/GoldenPalacePOS-Setup-x64.exe.sha256`
     - `release/GoldenPalacePOS-Setup-x64.build-manifest.json`
     - `release/ci-logs/*.log`
   - Updated failure diagnostic upload to unique name `GoldenPalacePOS-Windows-Failure-Logs-run-${{ github.run_number }}-${{ github.run_id }}` (`retention-days: 90`) capturing `release/ci-logs/**/*` and `release/failure-logs/**/*`.

---

## 3. G1 Verification Matrix (Preparation vs. Live Windows CI Execution)

| Requirement | Configured & Verified in Workflow/Local Baseline | Live `windows-latest` CI Execution | Notes |
|---|---|---|---|
| **Workflow Run ID & URL** | Workflow file valid (`.github/workflows/build-windows.yml`) | **`BLOCKED`** | No GitHub remote/credentials in container |
| **Runner OS & Architecture** | `runs-on: windows-latest`, Node `22` `x64` | **`PENDING`** | Expected `Windows` / `X64` |
| **Electron & ABI Pinning** | `electron@22.3.27` (ABI `110`) locked in `package-lock.json` & CI assert | **`PENDING`** | Strictly preserved (no upgrade) |
| **Windows MSVC C++20 Toolchain** | `vswhere.exe` check for `VC.Tools.x86.x64` coded in CI | **`PENDING`** | Runs on `windows-latest` |
| **Desktop Build Before Tests** | **`PASS`** locally (`npm run build:desktop` succeeded; `dist/assets/aistudio` absent) | **`PENDING`** | Ordered before `npm test` in CI |
| **Complete Automated Test Suite** | **`PASS`** locally (`28/28` test files, `175/175` tests passed in `91.27s`, `0` failures) | **`PENDING`** | Isolated `os.tmpdir()` SQLite DBs only |
| **TypeScript Validation (`tsc --noEmit`)** | **`PASS`** locally (`0` errors) | **`PENDING`** | Executed via `npm run lint` in CI |
| **Native `better-sqlite3` Rebuild (ABI 110)** | `npx electron-rebuild -f -w better-sqlite3 -v 22.3.27 --arch x64 --build-from-source` configured | **`BLOCKED`** (Linux host) | Requires Windows MSVC C++20 runner |
| **Installer Generation (`GoldenPalacePOS-Setup-x64.exe`)** | `npx electron-builder --win --x64 --publish never -c.npmRebuild=false` configured | **`BLOCKED`** (Linux host) | Zero Windows `.exe` fabricated on Linux |
| **PE32+ (`0x8664`) Architecture Validation** | Coded for rebuilt `better_sqlite3.node`, `GOLDEN PALACE POS.exe`, and unpacked `better_sqlite3.node` (+ MZ/size check on NSIS `.exe`) | **`PENDING`** | Awaits live CI run |
| **`app.asar.unpacked` Runtime Assets & Hygiene** | Coded for `app.asar` + all 9 unpacked assets + rejection of `dist\assets\aistudio` | **`PENDING`** | Awaits live CI run |
| **Native Addon SHA-256 Parity Check** | Coded (`$unpackedNativeHash -eq $env:NATIVE_SQLITE_SHA256`) | **`PENDING`** | Awaits live CI run |
| **Build Manifest, Checksum & Log Artifacts** | Coded (`GoldenPalacePOS-Setup-x64-run-<N>-<ID>`, 90-day retention) | **`PENDING`** | Awaits live CI run |

---

## 4. Exact GitHub Actions UI Steps for Owner to Launch Live G1 Run

Because no repository remote URL exists inside this workspace, the exact workflow URL could not be resolved automatically. Once pushed to GitHub, the workflow URL format is:

`https://github.com/<OWNER>/<REPO>/actions/workflows/build-windows.yml`

### Step-by-Step Owner Execution Procedure

1. **Push This Exact Workspace Snapshot to GitHub:**
   - Ensure `.github/workflows/build-windows.yml`, `electron-builder.yml`, `package.json`, `package-lock.json`, `build/icon.ico`, `build/icon.png`, and all source/test files are committed on your target validation branch (e.g., `main` or `release/v1.0.0-phase5-g1`).
   - Record the exact pushed commit SHA (`git rev-parse HEAD`).
2. **Open GitHub Actions UI:**
   - Navigate to your repository on GitHub → click the **Actions** tab.
   - In the left sidebar under **All workflows**, select **`Build Windows x64 Desktop Installer`** (`.github/workflows/build-windows.yml`).
3. **Dispatch the Workflow Manually (`workflow_dispatch`):**
   - Click the **`Run workflow`** dropdown button on the right.
   - Select your exact validation branch in **Use workflow from**.
   - Click the green **`Run workflow`** button.
4. **Monitor the `Windows x64 Electron 22 Release Build` Job on `windows-latest`:**
   - Wait for all steps to complete cleanly (green checkmark), paying special attention to:
     - `Install pinned dependencies from package-lock.json`
     - `Build Vite frontend and Node 16 Electron CJS server (before tests)`
     - `Run complete automated QA & acceptance test suite`
     - `Run TypeScript validation (tsc --noEmit)`
     - `Rebuild native better-sqlite3 from source for Electron 22.3.27 (x64 ABI 110, MSVC C++20)`
     - `Verify installer PE header, app.asar.unpacked resources, native ABI 110 match & SHA-256 checksum`
5. **Download & Record Artifacts:**
   - Open the completed workflow run summary page and record:
     - **Workflow Run ID** and **Run URL**
     - **Commit SHA**
     - **Artifact Name:** `GoldenPalacePOS-Setup-x64-run-<run_number>-<run_id>`
   - Download the artifact ZIP and verify it contains:
     - `GoldenPalacePOS-Setup-x64.exe`
     - `GoldenPalacePOS-Setup-x64.exe.sha256`
     - `GoldenPalacePOS-Setup-x64.build-manifest.json`
     - `00-environment.log` through `06-validation-report.log`
   - Verify the downloaded `.exe` SHA-256 matches `GoldenPalacePOS-Setup-x64.exe.sha256` and `GoldenPalacePOS-Setup-x64.build-manifest.json` before moving to Gate G2 authorization.

---

## 5. Live CI Evidence Recording Table (Updated From Verified Run `#4` / `44939198323`)

| G1 Evidence Field | Recorded Value |
|---|---|
| Commit SHA (`G1-A` Verified) | `f186eefbf5c4ea13354be54383cf9d215ee01bb6` |
| Workflow Run ID & Run Number (`G1-A`) | Run ID `44939198323` / Run `#4` |
| Runner OS & Architecture | `windows-latest` / `x64` |
| Electron Version & ABI | `22.3.27` / `ABI 110` (Strictly Pinned) |
| Rolldown Windows Hard Gate | **`PASS` (5/5 conditions)** |
| Desktop Build (`npm run build:desktop`) | **`PASS`** |
| TypeScript Validation (`tsc --noEmit`) | **`PASS`** |
| Windows CI Automated Tests (`vitest run`) | **`PASS` (`28/28` test files, `175/175` tests passed)** |
| Stop Gate Artifact (`G1-A`) | `GoldenPalacePOS-DesktopBuild-Logs-run-4-44939198323` (Stopped before installer packaging as configured) |
| Native `better-sqlite3` Rebuild Result (`G1-B`) | `PENDING OWNER AUTHORIZATION` (`stop_before_packaging=false` not yet authorized) |
| `GOLDEN PALACE POS.exe` PE Machine (`G1-B`) | `PENDING` (Expected `0x8664`) |
| Unpacked `better_sqlite3.node` PE Machine & SHA-256 (`G1-B`) | `PENDING` (Expected `0x8664` + exact match) |
| `GoldenPalacePOS-Setup-x64.exe` Size & SHA-256 (`G1-B`) | `PENDING OWNER AUTHORIZATION` |
| Non-Blocking CI Maintenance Warning | GitHub Actions Node.js 20 runtime deprecation warning on `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4` (non-blocking; tracked separately) |

---

## 6. Explicit Scope Boundaries & Stop Condition

- **Not Claimed:** This report does **not** claim NSIS installer packaging completion (`G1-B`), does **not** claim Windows 7 SP1 / 10 / 11 runtime compatibility (`G2`), and does **not** claim physical 80mm / 58mm / LAN thermal printer validation (`G3`).
- **Overall Project Status:** Remains **`PARTIALLY VERIFIED`**.
- **G1 Status:** **`G1-A` Build & Test Gate = `PASS`** (Commit `f186eefbf5c4ea13354be54383cf9d215ee01bb6`, Run `#4` / `44939198323`); **`G1-B` Installer Packaging = `PENDING OWNER AUTHORIZATION`**.
- **Stop Condition Enforced:** Execution remains paused before installer packaging pending owner sign-off on `PHASE_05_G1_PACKAGING_AUTHORIZATION_REQUEST.md`. Gates G2 and G3 remain **`PENDING`**.
