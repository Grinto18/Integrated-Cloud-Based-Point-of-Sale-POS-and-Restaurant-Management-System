# GOLDEN PALACE POS — PHASE 5 G1 INSTALLER PACKAGING AUTHORIZATION REQUEST

**Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)  
**Request Type:** Formal Owner Authorization to Execute Windows x64 NSIS Installer Packaging (`Gate G1-B`)  
**Target Commit SHA:** `f186eefbf5c4ea13354be54383cf9d215ee01bb6`  
**Prerequisite Windows CI Run:** GitHub Actions Run ID `44939198323` (Run `#4`, `windows-latest` x64) — **`PASS`**  
**Target Artifact:** `GoldenPalacePOS-Setup-x64.exe` (Unsigned Test/Validation Candidate — No Auto-Publish)  
**Pinned Runtime:** Electron `22.3.27` (ABI `110`), `better-sqlite3@11.10.0`, SQLite Schema Version `4`

---

## 1. Prerequisite Evidence Summary (`Gate G1-A: PASS`)

All pre-packaging Windows CI build, static analysis, binding, and automated test gates passed on actual `windows-latest` x64 hardware for commit `f186eefbf5c4ea13354be54383cf9d215ee01bb6`:

| Verification Gate | Run `#4` (`44939198323`) Result | Reference |
|---|---|---|
| Commit SHA & Workflow Parity | `f186eefbf5c4ea13354be54383cf9d215ee01bb6` | `.github/workflows/build-windows.yml` SHA-256 `89c8a327a2a9ca9b7589fac9b1ddd3f5bfce647db62084fd536c7cfa2b131cb1` |
| Rolldown Windows Binding Hard Gate | **`PASS` (5/5 conditions)** | `00c-rolldown-diagnostics.log` |
| Desktop Production Build (`npm run build:desktop`) | **`PASS`** | `01-build-desktop.log` |
| TypeScript Validation (`tsc --noEmit`) | **`PASS`** | `02-typescript-validation.log` |
| Testing Deps & Official Desktop Icons (`ensure:icons`) | **`PASS`** | `02b-test-prereqs.log` |
| Full Automated Vitest Suite (`--maxWorkers=2`, `isolate: true`) | **`PASS` (28/28 files, 175/175 tests)** | `03-test-suite.log` |
| Stop Gate Enforcement (`stop_before_packaging=true`) | **`PASS` (Stopped before packaging)** | Artifact `GoldenPalacePOS-DesktopBuild-Logs-run-4-44939198323` |

*(Transparency Note: Raw GitHub Actions log files were verified by the owner in GitHub Actions Run `#4` / `44939198323`; this isolated Linux workspace has no GitHub API credentials to fetch raw logs directly.)*

### Exact Input Configuration Digests (Frozen for Packaging Run)
- `package.json`: `bf584b54f15500cc9fea77f976e3e24b283a5dd50436f56a64e334cf6c024d29`
- `package-lock.json`: `fb5d2e796587aee150f2026e80d6bdb87df2ec05335b9cb6f39eba538257c3da`
- `.github/workflows/build-windows.yml`: `89c8a327a2a9ca9b7589fac9b1ddd3f5bfce647db62084fd536c7cfa2b131cb1`
- `vitest.config.ts`: `4fd62f9ae933cda47567c1161b37a96f20cc029509154c0095c29380ef467341`
- `build/icon.png`: `0863771c2aa05c9488b66d40a1c3b02488cf54d7cd5601d63a8b33c746aa90b8`
- `build/icon.ico`: `eca98c284154be449a4086c2ce8dbdc1f0bc4017a19f1b685ec5221db106d28e`

---

## 2. Requested Authorized Scope (`Gate G1-B` Packaging Only)

Upon owner approval, the owner will trigger **one** manual `workflow_dispatch` execution of `.github/workflows/build-windows.yml` on the exact verified commit `f186eefbf5c4ea13354be54383cf9d215ee01bb6` with **`stop_before_packaging: false`**, performing:

1. Full re-verification of Steps `[1]`–`[9]` (`npm ci`, 5/5 Rolldown Hard Gate, `build:desktop`, `tsc --noEmit`, `ensure:icons`, and `28/28` Vitest suite).
2. Native Windows MSVC C++20 rebuild of `better-sqlite3@11.10.0` from source for Electron `22.3.27` x64 ABI `110` (`npx electron-rebuild -f -w better-sqlite3 -v 22.3.27 --arch x64 --build-from-source`).
3. PE32+ x64 (`0x8664`) header and SHA-256 verification of the rebuilt `better_sqlite3.node`.
4. NSIS x64 installer packaging via `npx electron-builder --win --x64 --publish never -c.npmRebuild=false` producing `release/GoldenPalacePOS-Setup-x64.exe`.
5. Post-packaging verification of:
   - `GOLDEN PALACE POS.exe` PE32+ (`0x8664`) header.
   - `app.asar` and all `app.asar.unpacked` assets (`server.cjs`, `dist/index.html`, `build/icon.ico`, `build/icon.png`, `better_sqlite3.node`, `bindings`, `file-uri-to-path`, `bcryptjs`, `iconv-lite`).
   - Exact SHA-256 equality between rebuilt `better_sqlite3.node` and unpacked `app.asar.unpacked\...\better_sqlite3.node`.
   - Zero `dist/assets/aistudio` leakage into `dist/` or `app.asar.unpacked/`.
   - Installer MZ/PE verification, SHA-256 checksum file (`GoldenPalacePOS-Setup-x64.exe.sha256`), and JSON build manifest (`GoldenPalacePOS-Setup-x64.build-manifest.json`).
6. Unique run-scoped 90-day artifact upload (`GoldenPalacePOS-Setup-x64-run-<run_number>-<run_id>`), preserving all prior artifacts without overwriting.

---

## 3. Strict Exclusions & Safeguards

This authorization request **explicitly excludes**:
- **NO** GitHub Release publication (`--publish never` enforced).
- **NO** production restaurant deployment or rollout.
- **NO** Electron upgrade (strictly pinned `22.3.27` for Windows 7 SP1 x64 compatibility).
- **NO** SQLite schema changes or migrations (`LATEST_SCHEMA_VERSION = 4` unchanged).
- **NO** access to or modification of any real restaurant database.
- **NO** premature closure of **Gate G2 (Windows 7 SP1 / 10 / 11 OS compatibility)** or **Gate G3 (Physical 80mm / 58mm thermal printer validation)** — both remain strictly **`PENDING`** until the packaged installer is tested on real Windows targets and physical thermal printers.

### Non-Blocking Maintenance Advisory
- GitHub Actions currently logs a **Node.js 20 deprecation warning** for `actions/checkout@v4`, `actions/setup-node@v4`, and `actions/upload-artifact@v4`. This affects only GitHub's CI action wrapper runtime (not the app's Node 22 build or Electron 22.3.27 runtime), is **non-blocking** for packaging, and should be addressed in a separate maintenance commit after Phase 5 gate closure.

---

## 4. Owner Authorization Decision

- [ ] **APPROVED:** Authorize `workflow_dispatch` on `.github/workflows/build-windows.yml` at commit `f186eefbf5c4ea13354be54383cf9d215ee01bb6` with `stop_before_packaging: false` to generate and verify `GoldenPalacePOS-Setup-x64.exe` (validation candidate only; no release publish).
- [ ] **HOLD:** Defer installer packaging pending additional review or artifact archival.

**Exact Authorized Dispatch Command (Only After Approval):**
```bash
gh workflow run build-windows.yml --ref <branch-at-f186eefbf5c4ea13354be54383cf9d215ee01bb6> -f stop_before_packaging=false
```
*(Or via GitHub Actions UI → `Build Windows x64 Desktop Installer` → `Run workflow` → uncheck `stop_before_packaging`.)*
