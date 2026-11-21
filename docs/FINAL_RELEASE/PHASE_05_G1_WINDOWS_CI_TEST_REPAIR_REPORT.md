# PHASE 5 — G1 WINDOWS CI TEST FAILURE INVESTIGATION & REPAIR REPORT

**Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)  
**Scope:** Windows GitHub Actions `vitest run` Test Failure Investigation, Surgical Repair & Live Windows CI Verification  
**Verified Commit SHA:** `f186eefbf5c4ea13354be54383cf9d215ee01bb6`  
**Verified GitHub Actions Run:** Run ID `44939198323` (Run `#4`, `windows-latest` x64, `stop_before_packaging=true`)  
**Pinned Toolchain Preserved:** Electron `22.3.27` (ABI `110`), `better-sqlite3@11.10.0`, Vite `8.3.1`, Rolldown `1.2.11`, Vitest `5.1.0`, SQLite Schema Version `4`  
**G1 Windows CI Build & Test Gate Status:** **`PASS` (for commit `f186eefbf5c4ea13354be54383cf9d215ee01bb6`, Run `#4` / `44939198323` — Stopped Before Installer Packaging)**  
**G1 Installer Packaging Status:** **`PENDING OWNER AUTHORIZATION`** *(G2 OS Compatibility & G3 Physical Printer Validation remain **`PENDING`**)*

> **Log Access Transparency Note:** This documentation workspace runs in an isolated Linux container without GitHub API credentials or `gh` CLI, so raw GitHub Actions runner logs could not be pulled directly over the API from this sandbox. All Windows CI results below are recorded strictly from the owner-verified Run `#4` (`44939198323`) on commit `f186eefbf5c4ea13354be54383cf9d215ee01bb6` and reference its uploaded artifact `GoldenPalacePOS-DesktopBuild-Logs-run-4-44939198323`.

---

## 1. Root Cause Analysis (All 5 Failure Categories + Reporting Hotfix)

### Task 1 — Missing Testing Dependency (`Cannot find module '@testing-library/dom'`)
- **Root Cause:** `@testing-library/react@16.3.3` declares `@testing-library/dom: "^10.0.0"` and `@testing-library/jest-dom@7.0.1` declares `@testing-library/dom: ">=10 <11"` strictly as **`peerDependencies`** (not direct `dependencies`). `package.json` never declared `@testing-library/dom`, and `package-lock.json` contained **zero** entries for `@testing-library/dom`. Under clean Windows CI `npm ci --include=optional --legacy-peer-deps`, peer dependencies are not auto-installed, causing all frontend `.test.tsx` suites to crash on import.
- **Surgical Repair:**
  - Added `"@testing-library/dom": "^10.4.2"` to `devDependencies` in `package.json`.
  - Preserved backup at `docs/FINAL_RELEASE/backups/package-lock.json.pre-tld.bak`.
  - Surgically added **only** the 12 missing/nested dev-only lockfile entries required by `@testing-library/dom@10.4.2` (`@testing-library/dom@10.4.2`, nested `aria-query@5.3.0`, nested `dom-accessibility-api@0.5.16`, `@babel/code-frame@7.29.7`, `@babel/helper-validator-identifier@7.29.7`, `@types/aria-query@5.0.4`, `dequal@2.0.3`, `js-tokens@4.0.0`, `lz-string@1.5.0`, `pretty-format@27.5.1`, nested `ansi-styles@5.2.0`, `react-is@17.0.2`).
  - **Zero** pre-existing packages modified, upgraded, or removed (`+12 added, 0 modified, 0 removed`).

### Task 2 — Windows SQLite `EBUSY: resource busy or locked` Cleanup Failures
- **Root Cause 2A (`phase10.qa.final.test.ts:102` & `phase11b.production.init.test.ts:35`):** Both `afterAll` hooks invoked CommonJS `require('../db/index.ts')` inside an ESM (`"type": "module"`) Vitest suite inside a `try { ... } catch {}` block. `require(...)` threw and was silently swallowed, so `closeDatabase()` **never executed**. On Windows NTFS, `fs.rmSync` on a directory containing an open `better-sqlite3` DB + `-wal`/`-shm` file throws `EBUSY`.
- **Root Cause 2B (`auth.hardening.backend.test.ts:80` & `:434`):** In the token-revocation restart test, `vi.resetModules()` was called **without closing the first `sqlite` handle**. Re-importing `../db/index.ts` opened a second `better-sqlite3` handle to the same file and overwrote the `sqlite` reference, leaving the first handle leaked open until process exit so `afterAll` hit `EBUSY` on `TEST_DB_DIR`.
- **Root Cause 2C (Child Process & Silent Cleanup Hygiene):** `phase5e.offline.recovery.validation.test.ts` killed spawned child processes without awaiting their `'exit'` event; `phase4.packaging.printing.backup.test.ts` and `official.menu.import.test.ts` had silent `catch {}` blocks around `fs.rmSync`; `server.ts` exited on `JWT_SECRET` fail-fast without calling `closeDatabase()`.
- **Surgical Repair:**
  - Created `src/__tests__/testCleanup.ts` providing `closeSqliteHandle` (WAL `TRUNCATE` checkpoint + `.close()`), `terminateAndAwaitChild` (deterministic kill + `'exit'`/`'close'` await), and `removeIsolatedTestDir` (strict `os.tmpdir()` containment guard + bounded retry on transient Windows `EBUSY`/`EPERM`/`ENOTEMPTY`/`EMFILE`/`EACCES` locks + explicit final error — **never** silently swallows cleanup failure).
  - Fixed `auth.hardening.backend.test.ts` (closes SQLite before `vi.resetModules()` + deterministic `afterAll`/`finally` cleanup), `phase10.qa.final.test.ts` (async ESM `closeDatabase()`), `phase11b.production.init.test.ts` (async ESM `closeDatabase()`), `phase5e.offline.recovery.validation.test.ts`, `phase4.packaging.printing.backup.test.ts`, `phase12.release.acceptance.test.ts`, `offline.sync.backend.test.ts`, `official.menu.import.test.ts`, and `server.ts` (calls `closeDatabase()` before `process.exit(1)`).

### Task 3 — JWT Production Subprocess Test (`expected null to be 1` at `auth.hardening.backend.test.ts:317`)
- **Root Cause:** The test invoked `spawnSync(path.resolve(process.cwd(), 'node_modules/.bin/tsx'), ['server.ts'], ...)`. On Windows, `node_modules/.bin/tsx` is a POSIX sh script (not executable on Win32, where `.cmd` is used and direct `.cmd` spawning without `shell: true` also fails with `EINVAL` on Node 22). `spawnSync` failed to launch the binary, leaving `status === null` and `error` set.
- **Surgical Repair:**
  - Invoke `process.execPath` directly with `path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')` and `'server.ts'` — 100% cross-platform on Windows & POSIX without `cmd.exe` or `shell: true`.
  - Explicitly sanitize child `env` (`NODE_ENV='production'`, isolated `SQLITE_DB_PATH`, `delete GOLDEN_PALACE_DESKTOP`, `delete JWT_SECRET_FILE`), increase timeout to `20000ms`, and assert `error === undefined`, `signal === null`, `status === 1`, and strict `stderr` error messages (`CRITICAL SECURITY ERROR` / `at least 32`). Security requirements remain 100% intact.

### Task 4 — Missing Desktop Icons (`build/icon.png` & `build/icon.ico`)
- **Root Cause:** `build/icon.png` and `build/icon.ico` were absent from the CI repository checkout (neither committed nor regenerated prior to `vitest run`). `.gitignore` does not ignore `build/`.
- **Surgical Repair:**
  - Generated genuine official `build/icon.png` (`42,778 B`, `512×512` RGBA PNG, SHA-256 `0863771c2aa05c9488b66d40a1c3b02488cf54d7cd5601d63a8b33c746aa90b8`) and `build/icon.ico` (`74,203 B`, 6-frame Windows ICO `[16, 24, 32, 48, 64, 256]`, SHA-256 `eca98c284154be449a4086c2ce8dbdc1f0bc4017a19f1b685ec5221db106d28e`) from untouched `public/icons/icon-512.svg` (`1,579 B`, SHA-256 `bed1fcc9ad9471a2e2d74ae646802aa997b302b83d1d2635a5846c9cae56dcb7`) — bit-for-bit identical to Phase 4A.
  - Added zero-dependency deterministic prerequisite script `scripts/ensure-desktop-icons.mjs` (`npm run ensure:icons`) that validates PNG/ICO binary headers and regenerates them via existing host tooling (`magick` on `windows-latest` or `ffmpeg`+`convert` on Linux) if missing.
  - Wired `npm run ensure:icons` into `.github/workflows/build-windows.yml` right before `vitest run`.

### Task 5 — Vitest Execution & Concurrency (`28 workers spawned`)
- **Root Cause:** Unbounded parallel worker spawning on Windows CI (4 vCPU + NTFS + Defender AV scanning) created heavy SQLite/WAL I/O contention, and the 15s default timeout was right on the boundary for bcrypt cost-10 rate-limit suites under shared CI CPU load.
- **Surgical Repair:**
  - Kept full test isolation (`isolate: true` — never disabled).
  - Configured `vitest.config.ts` with `testTimeout: 30000` and Windows-scoped `maxWorkers: 2` (`process.platform === 'win32' ? { maxWorkers: 2 } : {}`).
  - Updated `.github/workflows/build-windows.yml` to verify `npm ls @testing-library/react @testing-library/dom`, run `npm run ensure:icons`, and execute `npm test -- --no-color --maxWorkers=2`.

### Hotfix — PowerShell `ParserError` in GitHub Actions Reporting Blocks
- **Root Cause:** Unescaped Markdown backticks inside PowerShell double-quoted strings (`"- Commit SHA: `$($env:GITHUB_SHA)`"`) escaped the closing `"` and broke parsing of the next line (`You must provide a value expression following the '-' operator.`).
- **Surgical Repair:** Replaced double-quoted summary lines in both `Record Stop Gate Before Installer Packaging` and `Verify installer PE header...` with single-quoted `-f` format expressions (`('- Commit SHA: `{0}`' -f $env:GITHUB_SHA)`). Verified in `.github/workflows/build-windows.yml` (SHA-256 `89c8a327a2a9ca9b7589fac9b1ddd3f5bfce647db62084fd536c7cfa2b131cb1`) and confirmed passing on Windows Run `#4` (`44939198323`).

---

## 2. Exact Files Changed & Verified SHA-256 Digests

| File | Action | SHA-256 |
|---|---|---|
| `package.json` | Modified (`+@testing-library/dom@^10.4.2`, `+ensure:icons` script) | `bf584b54f15500cc9fea77f976e3e24b283a5dd50436f56a64e334cf6c024d29` |
| `package-lock.json` | Surgically patched (`+12` dev entries, `0` modified/upgraded) | `fb5d2e796587aee150f2026e80d6bdb87df2ec05335b9cb6f39eba538257c3da` |
| `docs/FINAL_RELEASE/backups/package-lock.json.pre-tld.bak` | Created (pre-patch backup) | `6896cad13feec5564ccb9f12b90b53f26de0a7255d1c6f4cb4cecde4ad258c69` |
| `vitest.config.ts` | Modified (`isolate: true`, `testTimeout: 30000`, Win32 `maxWorkers: 2`) | `4fd62f9ae933cda47567c1161b37a96f20cc029509154c0095c29380ef467341` |
| `.github/workflows/build-windows.yml` | Modified (testing dep check, `ensure:icons`, `--maxWorkers=2`, PowerShell `-f` hotfix) | `89c8a327a2a9ca9b7589fac9b1ddd3f5bfce647db62084fd536c7cfa2b131cb1` |
| `scripts/ensure-desktop-icons.mjs` | Created (deterministic icon validator/generator) | `8dfa2bae6051d159ccf40c1804bc7392358ca7c518ab4a0458c4862af3c19bbb` |
| `build/icon.png` | Generated (`512×512` PNG) | `0863771c2aa05c9488b66d40a1c3b02488cf54d7cd5601d63a8b33c746aa90b8` |
| `build/icon.ico` | Generated (6-frame Windows ICO) | `eca98c284154be449a4086c2ce8dbdc1f0bc4017a19f1b685ec5221db106d28e` |
| `server.ts` | Modified (`closeDatabase()` before `process.exit(1)`) | — |
| `src/__tests__/testCleanup.ts` | Created (SQLite/child/temp-dir deterministic cleanup helper) | — |
| `src/__tests__/auth.hardening.backend.test.ts` | Modified (cross-platform `process.execPath` + `tsx` CLI, pre-`resetModules` SQLite close, deterministic cleanup) | — |
| `src/__tests__/phase10.qa.final.test.ts` | Modified (replaced broken `require()` with ESM `closeDatabase()` + deterministic cleanup) | — |
| `src/__tests__/phase11b.production.init.test.ts` | Modified (replaced broken `require()` with ESM `closeDatabase()` + deterministic cleanup) | — |
| `src/__tests__/phase5e.offline.recovery.validation.test.ts` | Modified (awaited child termination + deterministic cleanup) | — |
| `src/__tests__/phase4.packaging.printing.backup.test.ts` | Modified (removed silent catch + deterministic cleanup) | — |
| `src/__tests__/phase12.release.acceptance.test.ts` | Modified (deterministic cleanup) | — |
| `src/__tests__/offline.sync.backend.test.ts` | Modified (WAL checkpoint close before `resetModules` + deterministic cleanup) | — |
| `src/__tests__/official.menu.import.test.ts` | Modified (removed silent catch + deterministic cleanup) | — |

---

## 3. Verification Results (Linux Local vs. Verified Live Windows CI Run `#4`)

| Check | Linux x64 Container Result | Live Windows x64 (`windows-latest`, Run `#4` / `44939198323`, Commit `f186eefbf5c4ea13354be54383cf9d215ee01bb6`) |
|---|---|---|
| 1. `npm ci --include=optional --legacy-peer-deps` & Rolldown Hard Gate | **PASS** (isolated `--dry-run`: `843` packages) | **PASS** (Rolldown Hard Gate **5/5 passed**) |
| 2. `npm ls @testing-library/react @testing-library/dom` & `ensure:icons` | **PASS** (`@testing-library/dom@10.4.2` deduped; PNG/ICO headers verified) | **PASS** (verified in `GoldenPalacePOS-DesktopBuild-Logs-run-4-44939198323` / `02b-test-prereqs.log`) |
| 3. Full Vitest suite (`npm test -- --no-color --maxWorkers=2`) | **PASS** (**28 / 28 test files, 175 / 175 tests passed**, `79.21s`) | **PASS** (**28 / 28 test files, 175 / 175 tests passed**) |
| 4. TypeScript check (`npm run lint` / `tsc --noEmit`) | **PASS** (`0` errors) | **PASS** |
| 5. Production frontend build (`npm run build`) | **PASS** (`1693` modules, `937ms`, Vite `8.3.1`) | **PASS** (via `npm run build:desktop`) |
| 6. Desktop server build (`npm run build:server`) | **PASS** (`dist-electron/server.cjs`, `4.8mb`, `586ms`) | **PASS** (via `npm run build:desktop`) |
| 7. Stop Gate reporting block (`Record Stop Gate Before Installer Packaging`) | Static quote/YAML audit **PASS** | **PASS** (parsed & executed cleanly; workflow stopped before installer packaging as configured) |
| 8. NSIS Installer packaging (`GoldenPalacePOS-Setup-x64.exe`) | Not executed on Linux (policy) | **INTENTIONALLY SKIPPED** (`stop_before_packaging=true`; pending owner authorization) |

---

## 4. Per-Task Status & Non-Blocking Maintenance Item

| Task | Local Linux Verification | Live Windows CI Run `#4` (`44939198323`) | Overall Status |
|---|---|---|---|
| **Task 1 — `@testing-library/dom`** | PASS | PASS | **PASS** |
| **Task 2 — Windows SQLite EBUSY Cleanup** | PASS | PASS | **PASS** |
| **Task 3 — JWT Subprocess Test** | PASS | PASS | **PASS** |
| **Task 4 — Official Desktop Icons** | PASS | PASS | **PASS** |
| **Task 5 — Vitest Concurrency (`--maxWorkers=2`)** | PASS | PASS | **PASS** |
| **Hotfix — PowerShell `ParserError` Reporting** | Static PASS | PASS | **PASS** |
| **Task 6 — G1 Windows CI Build & Test Gate** | PASS | PASS (`28/28` files, `175/175` tests) | **PASS (Commit `f186eefbf5c4ea13354be54383cf9d215ee01bb6`)** |

### Non-Blocking Maintenance Item — GitHub Actions Node.js 20 Deprecation Warning
- `.github/workflows/build-windows.yml` currently references `actions/checkout@v4` (line 25), `actions/setup-node@v4` (line 28), and `actions/upload-artifact@v4` (lines 412, 587, 625), which execute on GitHub Actions' Node.js 20 runner runtime (separate from the application's `Node 22` build toolchain and pinned `Electron 22.3.27` runtime).
- GitHub Actions emits a Node.js 20 deprecation warning for `@v4` actions. This warning is **non-blocking** and does not affect build outputs, native ABI `110` compilation, or test validity; upgrading those workflow action tags to Node 24-compatible major versions is tracked as a post-gate CI maintenance item.

### Next Authorized Step
- Review and sign off on `docs/FINAL_RELEASE/PHASE_05_G1_PACKAGING_AUTHORIZATION_REQUEST.md` before authorizing a `workflow_dispatch` run with `stop_before_packaging: false` on commit `f186eefbf5c4ea13354be54383cf9d215ee01bb6`.

