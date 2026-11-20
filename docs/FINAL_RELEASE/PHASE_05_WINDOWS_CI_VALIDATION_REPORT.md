# GOLDEN PALACE POS — PHASE 5 WINDOWS CI VALIDATION REPORT
## Scope 1 Audit & Validation Status (`.github/workflows/build-windows.yml` & `scripts/build-windows-installer.ps1`)

- **Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)
- **Audit Scope:** GitHub Actions `windows-latest` Workflow, Native `better-sqlite3` ABI `110` Rebuild, PE32+ Verification, `app.asar.unpacked` Audit & Artifact Rollback Preservation
- **Workflow Configuration & Static Audit Status:** **`PASS`**
- **Live Remote GitHub Actions Execution Status:** **`BLOCKED`** (No `.git` repository, no GitHub remote, no `gh` CLI / credentials, and no Windows runner inside this Linux workspace)

---

## 1. Scope 1 Item-by-Item Classification

| # | Scope 1 Requirement | Status | Concrete Evidence / Finding |
|---|---|---|---|
| 1 | Audit existing GitHub Actions Windows workflow (`.github/workflows/build-windows.yml`) | **PASS** | Audited & hardened YAML syntax (valid YAML verified). Fixed 3 latent Windows CI risks discovered during audit (details in Section 2). |
| 2 | Verify `windows-latest` runner configuration | **PASS** | Configured `runs-on: windows-latest`, `actions/checkout@v4`, `actions/setup-node@v4` (`node-version: '22'`, `architecture: 'x64'`), PowerShell (`pwsh`) verification steps, and failure log artifact collection. Verified local `node-gyp@12.4.0` supports Python 3.12+ on `windows-latest`. |
| 3 | Verify native `better-sqlite3` Electron ABI `110` rebuild config (Windows MSVC C++20) | **PASS (Config) / BLOCKED (Live Run)** | Hardened command to `npx electron-rebuild -f -w better-sqlite3 -v 22.3.27 --arch x64 --build-from-source` (verified CLI flag against `@electron/rebuild@4.2.1`). `better-sqlite3@11.10.0` `binding.gyp` sets MSVC `/std:c++20` and supports `NODE_MODULE_VERSION >= 93` (Electron 22 = `110`). Live compilation requires Windows x64 runner (`BLOCKED` in Linux container). |
| 4 | Generate genuine Windows x64 NSIS installer (`GoldenPalacePOS-Setup-x64.exe`) | **BLOCKED (Host)** | Linux `4.19.0-gvisor` workspace lacks Windows OS, MSVC, Wine, and `.git`/GitHub CI access. Zero Windows binaries fabricated on Linux. |
| 5 | Verify PE32+ (`0x8664`) architecture of app executable & native SQLite binary | **PASS (Verification Gate Coded) / PENDING (Execution)** | Both `.github/workflows/build-windows.yml` and `scripts/build-windows-installer.ps1` now verify MZ header + PE32+ `0x8664` on: (a) rebuilt `node_modules\better-sqlite3\build\Release\better_sqlite3.node`, (b) `release\win-unpacked\GOLDEN PALACE POS.exe`, (c) unpacked `app.asar.unpacked\...\better_sqlite3.node` **with exact SHA-256 equality check**, and (d) NSIS installer MZ header & minimum 10 MB size. |
| 6 | Verify `app.asar.unpacked` resources | **PASS (Verification Gate Coded) / PENDING (Execution)** | Both CI workflow and local PowerShell script assert presence of `app.asar` plus all 9 critical unpacked assets (`dist-electron\server.cjs`, `dist\index.html`, `build\icon.ico`, `build\icon.png`, `better_sqlite3.node`, `bindings`, `file-uri-to-path`, `bcryptjs`, `iconv-lite`) and explicitly fail if `dist\assets\aistudio` leaks into the bundle. |
| 7 | Calculate and record installer SHA-256 | **PENDING (Execution)** | CI writes `GoldenPalacePOS-Setup-x64.exe.sha256` and `GoldenPalacePOS-Setup-x64.build-manifest.json` (including installer SHA-256, native SQLite SHA-256, runner arch, Electron `22.3.27`, ABI `110`, UTC timestamp) and prints them to `GITHUB_STEP_SUMMARY`. Actual digest awaits Windows CI run. |
| 8 | Preserve previous artifacts & rollback capability | **PASS** | GitHub Actions uploads artifacts under run-unique name `GoldenPalacePOS-Setup-x64-run-${{ github.run_number }}` with `retention-days: 90` (never overwriting previous runs). Local `scripts/build-windows-installer.ps1` archives any existing installer into `release\rollback_<timestamp>\` with verified SHA-256 prior to rebuild. |

---

## 2. Latent Windows CI Bugs Caught & Fixed During Scope 1 Audit

1. **Build/Test Ordering & Windows Node 22 `CVE-2024-27980` (`EINVAL`) Fix:**
   - Previously, `build-windows.yml` ran `npm test` BEFORE `npm run build:desktop`, which would trigger `phase5e`'s auto-build fallback calling `execFileSync('npm.cmd', ...)` without `shell: true` (throwing `EINVAL` on Windows Node 22).
   - **Fixed:** Moved `npm run build:desktop` BEFORE `npm test -- --no-color` in both `.github/workflows/build-windows.yml` and `scripts/build-windows-installer.ps1`, AND added `shell: process.platform === 'win32'` to `src/__tests__/phase5e.offline.recovery.validation.test.ts` for standalone Windows safety.
2. **Deterministic Source Compilation (`--build-from-source`):**
   - Because `better-sqlite3@11.10.0` returns HTTP `404` for `electron-v110-win32-x64`, added `--build-from-source` to `electron-rebuild` in both CI and local PowerShell scripts to avoid unnecessary prebuild downloads and force MSVC C++20 compilation.
3. **Unpacked Native Addon Integrity Proof:**
   - Added SHA-256 comparison between freshly rebuilt `node_modules\better-sqlite3\build\Release\better_sqlite3.node` and `release\win-unpacked\resources\app.asar.unpacked\node_modules\better-sqlite3\build\Release\better_sqlite3.node`, guaranteeing `electron-builder` packaged the exact ABI `110` PE32+ binary.
4. **Full `app.asar.unpacked` Verification & Rollback-Safe Artifact Naming:**
   - Expanded CI checks to validate every unpacked runtime module (`bindings`, `file-uri-to-path`, `bcryptjs`, `iconv-lite`, `build\icon.png`, `build\icon.ico`, `app.asar`) and switched artifact upload to unique run-numbered bundles (`GoldenPalacePOS-Setup-x64-run-<N>`, 90-day retention).

---

## 3. Genuine Windows CI Execution Record (To Be Completed Upon First `windows-latest` Run)

| CI Evidence Field | Recorded Value |
|---|---|
| GitHub Actions Run URL / Run Number | `PENDING — Push repository & trigger workflow_dispatch on build-windows.yml` |
| Runner OS & Architecture | `PENDING (Expected: Windows / X64)` |
| `GoldenPalacePOS-Setup-x64.exe` Size (Bytes) | `PENDING` |
| `GoldenPalacePOS-Setup-x64.exe` SHA-256 | `PENDING` |
| Unpacked `better_sqlite3.node` PE32+ `0x8664` SHA-256 | `PENDING` |
| Previous Release Artifact Preserved | `PENDING` |
| CI Final Result | **`BLOCKED (In Linux Container) / PENDING (External GitHub Actions Run)`** |
