# PHASE 5 — G1 WINDOWS CI ROLLDOWN BINDING: INSTALLATION FALLBACK & HARD GATE REPORT

**Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)  
**Gate:** G1 — Genuine Windows x64 Desktop Build & Installer Validation  
**Target Runner:** GitHub Actions `windows-latest` (`x64`, Node `22.23.5`, npm `10.9.9`)  
**Pinned Toolchain:** Electron `22.3.27` (ABI `110`), `better-sqlite3@11.10.0`, Vite `8.3.1`, Rolldown `1.2.11`, SQLite Schema Version `4`  
**Current G1 Classification:** **`PARTIALLY VERIFIED` / `BLOCKED` (Pending Live Execution on `windows-latest` — NOT `PASS`)**  
**Stop Gate Policy:** Stops after Windows `npm run build:desktop`, `npm run lint`, and `npm test` (before NSIS packaging) pending owner review (`stop_before_packaging: true` default on `workflow_dispatch`).

---

## 1. Workflow Revision & Repository Audit

### 1.1 Environment & Commit Visibility
This engineering workspace runs inside an isolated Linux container (`4.19.0-gvisor x86_64`, Node `v22.23.2`, npm `10.9.8`) with:
- **No `.git` directory** (`NO_GIT_REPO_IN_CONTAINER`) and **no GitHub API credentials or remote push access**.
- **No Windows runner** inside the sandbox.

Consequently, the exact GitHub commit SHA executed by the owner's failed Windows run cannot be queried directly from this container. To eliminate any future ambiguity between local workspace revisions and pushed GitHub commits, the workflow now records all revision metadata in both `release/ci-logs/00-environment.log` and `release/ci-logs/00c-rolldown-diagnostics.log`:
- `GITHUB_SHA`, `GITHUB_REF`, `GITHUB_WORKFLOW_REF`
- `Working Directory` (`(Get-Location).Path`)
- `Pre-CI node_modules` (`Test-Path "node_modules"` — must be `False`, confirming a clean checkout with no cached `node_modules`)
- Exact SHA-256 digests of `package.json` and `package-lock.json`
- `package.json` root `optionalDependencies`, `package-lock.json` root `optionalDependencies`, and the lockfile entry for `node_modules/@rolldown/binding-win32-x64-msvc`

### 1.2 Baseline Manifest Preservation (Zero Modifications This Turn)
Per mandate, **neither `package.json` nor `package-lock.json` was modified** in this workstream. Only `.github/workflows/build-windows.yml` was hardened.

| File | Modified This Turn? | Exact SHA-256 Digest (Verify Parity in GitHub Commit) |
|---|---|---|
| `package.json` | **No (unchanged)** | `67cfbac9669af1a3b6132aaf8abc558df1fa1d5c422741e63620a1f5cf38918a` |
| `package-lock.json` | **No (unchanged)** | `6896cad13feec5564ccb9f12b90b53f26de0a7255d1c6f4cb4cecde4ad258c69` |
| `.github/workflows/build-windows.yml` | **Yes (hardened)** | `cd30976d87bf864d02d96172f7dd9e33b18bf613cb0021559cc764d88c0f25a5` |

### 1.3 Why `npm run build:desktop` Was Previously Allowed to Run (Root Cause Analysis)
In the previous workspace revision of `.github/workflows/build-windows.yml`, the post-`npm ci` diagnostic step contained an explicit `throw` whenever `@rolldown/binding-win32-x64-msvc` was missing or failed Node resolution. In PowerShell 7 (`pwsh`), `throw` is a **terminating error** regardless of `$ErrorActionPreference = 'Continue'`.

Therefore, if the latest Windows CI run still reached `npm run build:desktop` and failed inside Vite with:
- `Cannot find module '@rolldown/binding-win32-x64-msvc'`
- `Cannot find module '@rolldown/binding-wasm32-wasi'`

there are only two possible explanations:
1. **Stale / Unpushed Workflow Revision (Primary):** The workflow file executed on GitHub did not yet contain the updated diagnostic gate (or `workflow_dispatch` targeted a branch/commit that had not yet received the exported workspace changes for `.github/workflows/build-windows.yml`, `package.json`, and `package-lock.json`).
2. **Silent `npm ci` Optional Dependency Omission on npm 10.9.9 (If Commit Was Synced):** Under npm `10.9.9` with `--legacy-peer-deps`, Arborist can silently skip an optional native package during `reify` without returning a non-zero exit code from `npm ci`. Without a post-`npm ci` fallback and hard gate actually executing on the dispatched commit, the job falls straight into `npm run build:desktop` and fails with the missing binding (and Rolldown's secondary WASI fallback message).

The hardened workflow eliminates **both** failure modes simultaneously:
- It audits and prints `GITHUB_SHA`, `package.json` SHA-256, `package-lock.json` SHA-256, and `Pre-CI node_modules` immediately after checkout.
- It inspects `@rolldown/binding-win32-x64-msvc` immediately after `npm ci`, heals an absent binding on Windows via the controlled fallback, and enforces a strict 5-condition hard gate that **blocks `npm run build:desktop` unconditionally** if any condition fails.

---

## 2. Mandatory Post-`npm ci` Package Diagnostics

Step `[5]` (`Mandatory Rolldown Diagnostics, Controlled Windows-Only Fallback & 5-Condition Hard Gate`) runs immediately after `npm ci --include=optional --legacy-peer-deps --no-audit --no-fund` and writes complete, secret-free diagnostic output to `release/ci-logs/00c-rolldown-diagnostics.log`:

1. Records `GITHUB_SHA`, `GITHUB_REF`, `GITHUB_WORKFLOW_REF`, working directory, Node/npm versions, `package.json` / `package-lock.json` SHA-256 digests, `npm config get omit|include|os|cpu`, and parsed `optionalDependencies` metadata from both `package.json` and `package-lock.json`.
2. Checks `node_modules\@rolldown\binding-win32-x64-msvc` directory existence, `package.json` existence, exact version (`1.2.11`), `main`, `os`, `cpu`, and lists all files with sizes and SHA-256 digests.
3. Checks `rolldown-binding.win32-x64-msvc.node` existence and verifies its Windows PE32+ x64 header (`MZ` signature + Machine `0x8664`).
4. Runs `npm ls @rolldown/binding-win32-x64-msvc --all` and logs output + exit code.
5. Runs an embedded Node.js verification probe (`node --check` validated) that records `require.resolve('@rolldown/binding-win32-x64-msvc')`, direct `require('@rolldown/binding-win32-x64-msvc')` export key count, and ESM `await import('rolldown')` version.
6. If any initial (`POST-NPM-CI`) check fails, filters `release/ci-logs/00b-npm-ci.log` and the latest `%LOCALAPPDATA%\npm-cache\_logs\*.log` for `rolldown|optional|EBADPLATFORM|EINTEGRITY|failed optional|ERR!|warn` without exposing credentials.

---

## 3. Controlled Windows-Only Installation Fallback

### 3.1 Critical Empirical Finding: Why `--prefix` Isolation Is Required
During verification of the fallback command inside the workspace, we tested running the raw command in the project root (`--dry-run` with zero workspace mutation):

1. **Without `--legacy-peer-deps` in project root:**
   ```
   npm install --no-save --package-lock=false --ignore-scripts --include=optional --dry-run @rolldown/binding-linux-x64-gnu@1.2.11
   ```
   **Result:** **FAILED (`EXIT=1`, `ERESOLVE`)** — because `--package-lock=false` instructs npm to ignore `package-lock.json` and re-evaluate root `package.json` semver ranges (`vite@"^8.3.0"` -> `vite@8.3.8`), triggering an upstream peerOptional conflict with pinned `esbuild@0.25.12`.
2. **With `--legacy-peer-deps` in project root:**
   **Result:** **UNSAFE MUTATION** — npm proposed `added 196 packages, removed 141 packages, and changed 317 packages`, which would silently upgrade `vite@8.3.1` and `rolldown@1.2.11` inside `node_modules` and violate our strict version pins.
3. **With `--prefix "$tmpFallbackDir"` isolation (Verified):**
   ```
   npm install --prefix "$TMP_FB" --no-save --package-lock=false --ignore-scripts --include=optional @rolldown/binding-linux-x64-gnu@1.2.11
   ```
   **Result:** **PASS (`EXIT=0`, `added 1 package in 1s`)** — downloads and extracts **exclusively** the single requested binding package (`1.2.11`) from the official npm registry with **0 peer conflicts**, **0 mutations to `package.json` or `package-lock.json`**, and **0 changes to the 831 pinned packages in `node_modules`**.

### 3.2 Implemented Fallback Safeguards in `.github/workflows/build-windows.yml`
- **Trigger Condition (Strict):** Runs **IF AND ONLY IF** `$env:RUNNER_OS -eq 'Windows'` **AND** the binding directory, `package.json`, or `.node` binary is absent after `npm ci`.
- **Command Executed:**
  ```powershell
  npm install --prefix "$tmpFallbackDir" --no-save --package-lock=false --ignore-scripts --include=optional @rolldown/binding-win32-x64-msvc@1.2.11
  ```
- **Placement & Cleanup:** Copies only `$tmpFallbackDir\node_modules\@rolldown\binding-win32-x64-msvc` into `node_modules\@rolldown\binding-win32-x64-msvc`, then deletes `$tmpFallbackDir`.
- **Immutability Enforcement:** Re-hashes `package.json` and `package-lock.json` immediately after fallback; throws a terminating `SAFETY VIOLATION` error if either SHA-256 changed.
- **No Error Hiding:** Logs full stdout/stderr and exit code; stops immediately before Vite build if exit code is non-zero.
- **No WASI / No Version Drift:** Never installs `@rolldown/binding-wasm32-wasi`; never modifies Vite (`8.3.1`), Rolldown (`1.2.11`), Electron (`22.3.27`), or `better-sqlite3` (`11.10.0`).
- **Full Re-Verification:** Runs the complete `Invoke-RolldownBindingCheck -Phase "POST-FALLBACK"` probe suite after installation.

---

## 4. Strict 5-Condition Hard Gate & Post-Gate Execution Order

Before `npm run build:desktop` is permitted to run, Step `[5]` enforces `$ErrorActionPreference = 'Stop'` and verifies **all 5 mandatory conditions**:

| Gate # | Condition | Verification Mechanism |
|---|---|---|
| **1** | Binding package exists | `Test-Path node_modules\@rolldown\binding-win32-x64-msvc` AND `package.json` exists |
| **2** | Installed version equals `1.2.11` | Exact string equality on parsed `package.json.version` |
| **3** | Native `.node` binary exists (PE32+ x64) | `rolldown-binding.win32-x64-msvc.node` exists, `MZ` header valid, PE Machine == `0x8664` |
| **4** | Node can resolve the package | `require.resolve('@rolldown/binding-win32-x64-msvc')` succeeds |
| **5** | Node can load the native binding | `require('@rolldown/binding-win32-x64-msvc')` AND `await import('rolldown')` succeed |

Additional pinned version & Windows binding checks immediately following the 5-condition gate enforce exact versions for `electron@22.3.27`, `better-sqlite3@11.10.0`, `vite@8.3.1`, `rolldown@1.2.11`, `@tailwindcss/oxide-win32-x64-msvc@4.3.3`, `lightningcss-win32-x64-msvc@1.33.0` (root) / `1.32.0` (tailwind), `@esbuild/win32-x64@0.25.12`, and `@typescript/typescript-win32-x64@7.0.2`.

### Post-Gate Execution Order & Stop Gate Before Installer Packaging
1. **Step `[6]`:** `npm run build:desktop` (`01-build-desktop.log`) + check that `dist\assets\aistudio` is absent.
2. **Step `[7]`:** `npm run lint` (`tsc --noEmit`, `02-typescript-validation.log`).
3. **Step `[8]`:** `npm test -- --no-color` (`03-test-suite.log`).
4. **Steps `[9]`–`[10]` (Default `workflow_dispatch` Stop Gate — `stop_before_packaging: true`):** Uploads `GoldenPalacePOS-DesktopBuild-Logs-run-<num>-<id>` (`release/ci-logs/*.log`, including `00c-rolldown-diagnostics.log`) and records the owner review stop-gate summary.
5. **Steps `[11]`–`[15]` (Skipped when `stop_before_packaging == true`; enabled on `v*` tag or `stop_before_packaging == false`):** `electron-rebuild` (ABI 110 MSVC C++20), PE32+ verification, NSIS packaging (`electron-builder --win --x64 --publish never -c.npmRebuild=false`), installer verification, and artifact upload.
6. **Steps `[16]`–`[17]` (`if: failure()`):** Always archives `release/ci-logs/*` (including `00c-rolldown-diagnostics.log`) and recent `%LOCALAPPDATA%\npm-cache\_logs\*.log` as `GoldenPalacePOS-Windows-Failure-Logs-run-<num>-<id>`.

---

## 5. Local Verification Results (Linux Compatibility & Static Checks)

| Check | Environment | Result | Evidence |
|---|---|---|---|
| `.github/workflows/build-windows.yml` YAML parse | Linux x64 (`js-yaml`) | **PASS** | Valid YAML, `17` steps, `workflow_dispatch.inputs.stop_before_packaging` default `true`, all 5 packaging steps guarded |
| PowerShell here-strings & embedded JS probe syntax | Linux x64 (`node --check`) | **PASS** | Closing `'@` at column 0 verified; embedded JS probe passed `node --check` |
| Isolated `--prefix` fallback dry test | Linux x64 (`npm 10.9.8`) | **PASS** | `added 1 package in 1s`, `EXIT=0`, `0` mutations to workspace `package.json`, `package-lock.json`, or `node_modules` |
| Isolated Linux `npm ci --include=optional --legacy-peer-deps --no-audit --no-fund --dry-run` | Linux x64 (`/tmp` copy) | **PASS** | `added 831 packages in 1s`, `0` errors; Windows fallback never runs on Linux (`$env:RUNNER_OS -eq 'Windows'`) |
| Linux `npm run build:desktop` | Linux x64 (`Vite 8.3.1`, `Rolldown 1.2.11`) | **PASS** | Vite built `1693` modules in `1.05s`; esbuild built `dist-electron/server.cjs` (`4.8mb`) in `575ms`; `dist/assets/aistudio` absent |
| Linux `npm test -- --no-color` | Linux x64 (`Vitest 5.1.0`) | **173 / 175 PASS** | 26/28 test files passed. The 2 failures (`phase12.release.acceptance.test.ts` & `phase4.packaging.printing.backup.test.ts`) are solely due to `build/icon.png` & `build/icon.ico` not being persisted in this container's workspace snapshot (see Section 6 Blocker #2). |
| Genuine `windows-latest` x64 execution | GitHub Actions `windows-latest` | **`PENDING` / `BLOCKED`** | Cannot be executed from this Linux sandbox (no `.git`, no GitHub push/dispatch credentials, no Windows runner). |

---

## 6. Remaining Blockers & Owner Action Checklist

### Remaining Blockers (Honest Gate Status)
1. **Live GitHub Actions `windows-latest` Execution Required:** This container cannot push commits to GitHub or trigger GitHub Actions. **G1 MUST remain `PARTIALLY VERIFIED` / `BLOCKED` until a real `windows-latest` run passes.**
2. **Verify `build/icon.png` and `build/icon.ico` Presence in GitHub Repo:** In this container snapshot, `build/` is absent (causing 2 icon-existence assertions in `npm test` to fail locally). Before running Windows CI, confirm that `build/icon.png` (`42,778 B`, SHA-256 `0863771c2aa05c9488b66d40a1c3b02488cf54d7cd5601d63a8b33c746aa90b8`) and `build/icon.ico` (`74,203 B`, SHA-256 `eca98c284154be449a4086c2ce8dbdc1f0bc4017a19f1b685ec5221db106d28e`) from Phase 4A are present in the target Git branch.

### Owner Execution Steps to Complete G1 Desktop Build Verification (Stop Gate)
1. Sync the updated `.github/workflows/build-windows.yml` into your Git repository and confirm all three file hashes match Section 1.2:
   - `package.json`: `67cfbac9669af1a3b6132aaf8abc558df1fa1d5c422741e63620a1f5cf38918a`
   - `package-lock.json`: `6896cad13feec5564ccb9f12b90b53f26de0a7255d1c6f4cb4cecde4ad258c69`
   - `.github/workflows/build-windows.yml`: `cd30976d87bf864d02d96172f7dd9e33b18bf613cb0021559cc764d88c0f25a5`
2. Commit and push to your validation branch, then trigger **`Build Windows x64 Desktop Installer`** via **`workflow_dispatch`** leaving **`stop_before_packaging: true`** (default).
3. Inspect the uploaded artifact **`GoldenPalacePOS-DesktopBuild-Logs-run-<num>-<id>`** (specifically `00-environment.log`, `00c-rolldown-diagnostics.log`, `01-build-desktop.log`, `02-typescript-validation.log`, and `03-test-suite.log`):
   - Confirm `GITHUB_SHA` and SHA-256 digests match your pushed commit.
   - Confirm whether `npm ci` installed `@rolldown/binding-win32-x64-msvc@1.2.11` directly or whether the controlled Windows-only fallback healed it (`fallbackAttempted=True/False`).
   - Confirm all 5 hard-gate conditions, `npm run build:desktop`, `npm run lint`, and `npm test` all report **PASS**.
4. **Stop Gate:** Only after reviewing and approving these Windows desktop build logs should you authorize the next dispatch with `stop_before_packaging: false` to build and verify `GoldenPalacePOS-Setup-x64.exe`.
