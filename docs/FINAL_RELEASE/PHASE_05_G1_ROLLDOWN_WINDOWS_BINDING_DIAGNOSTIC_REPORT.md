# GOLDEN PALACE POS — PHASE 5 G1 ROLLDOWN WINDOWS NATIVE BINDING DIAGNOSTIC REPORT

**Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)  
**Failed GitHub Actions Run:** `44758476675`  
**Runner:** `windows-latest` x64 (`Node 22.23.5` / `npm 10.9.9`)  
**Pinned Bundler Stack:** `vite@8.3.1` / `rolldown@1.2.11`  
**Pinned Desktop Stack:** `electron@22.3.27` (ABI `110`) / `better-sqlite3@11.10.0` / SQLite Schema Version `4`  
**Report Timestamp (UTC):** `2026-11-21T16:42:25Z`

---

## FINAL CLASSIFICATION: **`BLOCKED`**

> **Why `BLOCKED`:** This workspace container runs Linux (`4.19.0-gvisor x86_64`) with no `.git` repository, no GitHub API access to inspect Run `44758476675` logs, and no genuine Windows x64 runner.  
> **Disciplined Engineering Action Taken (No Blind Repair):** Rather than guessing between Case A, Case B, and Case C or mutating `package.json` without Windows evidence, we performed complete static + registry + Arborist forensics, ruled out upstream npm package corruption, verified `package-lock.json` (`1feb292e40a5c49b143ae4787bb039af6ecf624349064c470bbbd0dac5e37f44`) passes `npm ci`'s exact `validateLockfile` sequence with `0` errors, and instrumented `.github/workflows/build-windows.yml` with the **mandatory 8-point PowerShell diagnostics** (`release\ci-logs\00c-rolldown-diagnostics.log`) immediately after `npm ci`.

---

## 1. Exact Rolldown Loading Sequence Forensics (`binding-BY0qR5iS.mjs`)

Direct inspection of `node_modules/rolldown/dist/shared/binding-BY0qR5iS.mjs` (lines 130–170, 489–500, and 563–608) establishes the **exact** loading sequence on Windows x64 (`process.platform === "win32"`, `process.arch === "x64"`):

1. **GNU vs MSVC Branch Check (line 134):**
   - If `process.config.variables.shlib_suffix === "dll.a"` OR `node_target_type === "shared_library"`, Rolldown attempts `win32-x64-gnu`; otherwise (standard official Windows Node.js `22.23.5`) it enters the **MSVC branch** (lines 146–158).
2. **Lookup #1 — Local Dev Binary Lookup (line 148, ALWAYS fails in published npm installs):**
   - `__require("./rolldown-binding.win32-x64-msvc.node")` relative to `node_modules/rolldown/dist/shared/`.
   - Because npm installs the native binary inside `node_modules/@rolldown/binding-win32-x64-msvc/` (NOT inside `node_modules/rolldown/dist/shared/`), this lookup **always** throws `Cannot find module './rolldown-binding.win32-x64-msvc.node'` and pushes it as `loadErrors[0]`.
3. **Lookup #2 — Published Optional Package Lookup (line 153 — THE REAL LOOKUP):**
   - `__require("@rolldown/binding-win32-x64-msvc")` followed by version check against `@rolldown/binding-win32-x64-msvc/package.json` (`1.2.11`).
   - If this succeeds, Rolldown returns the native binding and discards `loadErrors[0]`.
   - If this throws (package missing, binary missing, or native `ERR_DLOPEN_FAILED`), its error is pushed as `loadErrors[1]`.
4. **Lookup #3 — WASI Fallback Lookups (lines 546 & 567):**
   - Attempts `./rolldown-binding.wasi.cjs` (`loadErrors[2]`) and `@rolldown/binding-wasm32-wasi` (`loadErrors[3]`).
5. **Error Chain Construction (`createLoadErrorChain`, lines 489–500):**
   - Chains `loadErrors` via nested `Error.cause`, so the logged message `Cannot find module './rolldown-binding.win32-x64-msvc.node'` is **only Lookup #1 (`loadErrors[0]`)** — the true root cause on `windows-latest` is inside `loadErrors[1]` (the failure of `require("@rolldown/binding-win32-x64-msvc")`), which standard Vite error output may truncate or obscure without explicit cause-chain traversal.

---

## 2. Authoritative Registry Archive & Lockfile Verification

### 2.1 Upstream Published Package Verification (`@rolldown/binding-win32-x64-msvc@1.2.11`)
Downloaded directly via `npm pack @rolldown/binding-win32-x64-msvc@1.2.11` and inspected:

| Check | Result | Evidence |
|---|---|---|
| **Tarball completeness** | **`PASS`** | Contains `package/package.json` (`858 B`), `package/README.md` (`108 B`), `package/rolldown-binding.win32-x64-msvc.node` (`20,808,704 B`) |
| **`package.json` metadata** | **`PASS`** | `"version": "1.2.11"`, `"main": "rolldown-binding.win32-x64-msvc.node"`, `"os": ["win32"]`, `"cpu": ["x64"]`, `"engines": { "node": "^20.19.0 || >=22.12.0" }` |
| **`package.json` SHA-256** | Recorded | `6c98310bbd4c636e8d3f8fcf18a56e7f9dbf7ce6981bc3292d501adaad631a6e` |
| **Native `.node` PE header** | **`PASS`** | Valid Windows `MZ` header, PE32+ x64 (`Machine: 0x8664`), `20,808,704` bytes |
| **Native `.node` SHA-256** | Recorded | `cc49bb8c6463e2c85ed1287bf949bf6cfd08d6e0b80be53d2a12eb4500c1bf8c` |
| **DLL imports** | **`PASS`** | Standard Windows OS & UCRT DLLs only (`kernel32.dll`, `advapi32.dll`, `bcrypt.dll`, `ntdll.dll`, `api-ms-win-crt-*`) |
| **Case B (Broken npm publication)** | **Ruled Out** | Official registry archive is complete, valid PE32+ x64, and uncorrupted |

### 2.2 Lockfile & npm Arborist `npm ci` Internals Verification
- Inspected npm's `ci.js` and `@npmcli/arborist/lib/arborist/reify.js`:
  - Ran `arb.loadVirtual()` → `arb.buildIdealTree()` → `validateLockfile()` against the workspace `package-lock.json` (`SHA-256: 1feb292e40a5c49b143ae4787bb039af6ecf624349064c470bbbd0dac5e37f44`): **`0` validation errors**.
  - Confirmed `node_modules/@rolldown/binding-win32-x64-msvc` is present in both `virtualTree` and `idealTree` with valid `resolved` URL, valid `sha512` integrity, `os: ["win32"]`, `cpu: ["x64"]`.
  - **Key Arborist Finding (`reify.js` lines 830–836):** For any `optional: true` package, `reify()` wraps extraction in `p.catch(() => log.verbose('reify', 'failed optional dependency', node.path))`, meaning `npm ci` **silently swallows** optional package extraction failures without failing the `npm ci` command itself. This makes post-`npm ci` diagnostic inspection and npm debug log filtering essential.
  - Also note: verify via the new `package-lock SHA256` diagnostic line on `windows-latest` that GitHub Actions actually checked out the repaired lockfile (`1feb292e40a5c49b143ae4787bb039af6ecf624349064c470bbbd0dac5e37f44`) rather than an earlier commit's lockfile (`da2cb4680719a63da44badfa258f2440a456b062b21a3ae2de42c9417579d0fb`).

---

## 3. Mandatory 8-Point Windows Diagnostics Added to `.github/workflows/build-windows.yml`

Updated `.github/workflows/build-windows.yml` (SHA-256: `472c30146b89a139a4003412a7ca215ecf710372b0f94918b6a00de571a2719c`, validated YAML with `15` steps, validated embedded JS syntax via `node --check`) with a dedicated step immediately following `npm ci --include=optional --legacy-peer-deps --no-audit --no-fund`:

**Step:** `Mandatory Windows Rolldown Native Binding Diagnostics & Pinned Version Gate`  
**Log Artifact:** `release\ci-logs\00c-rolldown-diagnostics.log` (uploaded on both success and failure with unique run ID and 90-day retention; zero secrets or tokens printed).

Records and verifies all 8 mandatory diagnostics:
1. Directory existence: `node_modules\@rolldown\binding-win32-x64-msvc`.
2. `package.json` existence inside the binding package.
3. Exact installed version (`1.2.11`) and `main` field (`rolldown-binding.win32-x64-msvc.node`).
4. Native `.node` binary existence, byte size (`20,808,704`), PE32+ `MZ` / `0x8664` machine check, and SHA-256 (comparable against `cc49bb8c6463e2c85ed1287bf949bf6cfd08d6e0b80be53d2a12eb4500c1bf8c`).
5. Node.js resolution (`require.resolve`), direct native load (`require('@rolldown/binding-win32-x64-msvc')`), and ESM `import('rolldown')` with **full recursive `Error.cause` chain traversal** plus runtime `platform`, `arch`, `node`, `abi`, `shlib_suffix`, and `node_target_type`.
6. Package `os` (`win32`) and `cpu` (`x64`) metadata verification.
7. `npm ls @rolldown/binding-win32-x64-msvc --all` output and exit code.
8. Complete file inventory with per-file byte sizes and SHA-256 hashes, `package-lock.json` SHA-256, safe `npm config get` keys (`omit`, `include`, `os`, `cpu`, `legacy-peer-deps`), and filtered npm debug log clues on failure.

Automatically classifies any failure into `CASE_A_PACKAGE_MISSING_AFTER_NPM_CI`, `CASE_B_PACKAGE_EXISTS_BINARY_MISSING_OR_CORRUPT`, `CASE_B_METADATA_OR_VERSION_MISMATCH`, or `CASE_C_BINARY_EXISTS_NATIVE_LOAD_FAILED` and halts before `npm run build:desktop` / installer packaging.

---

## 4. Separate Warning (Unrelated to Rolldown Failure)

- **GitHub Actions Node.js 20 Deprecation Warning:** Actions pinned at `@v4` (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`) emit a platform-level Node.js 20 runner-action deprecation notice on GitHub Actions.
- **Handling:** Recorded separately as a non-blocking GitHub Actions infrastructure notice only. Per Section 5, **Electron `22.3.27` was NOT upgraded** and the project's Node.js runtime configuration was **NOT altered** to address this unrelated warning.

---

## 5. Safety Restrictions & Dependency Diff Summary

| Safety Check | Status | Evidence |
|---|---|---|
| `package.json` unchanged | **`PASS`** | SHA-256 unchanged: `d589b7a7506fa4b7e1dc990a4c2ddf2138407a26753e925b3f417c17eb38d280` |
| `package-lock.json` preserved (not deleted/regenerated) | **`PASS`** | SHA-256 unchanged from surgical repair: `1feb292e40a5c49b143ae4787bb039af6ecf624349064c470bbbd0dac5e37f44` (`+7` exact Win64 optional bindings, `0` upgrades) |
| Electron `22.3.27` & `better-sqlite3@11.10.0` preserved | **`PASS`** | Strictly pinned in `package-lock.json` and asserted in CI |
| SQLite Schema Version `4` preserved | **`PASS`** | Zero schema/migration/DB modifications; zero production DB access |
| Changes made in this turn | Verified | `.github/workflows/build-windows.yml` (8-point Windows Rolldown diagnostics) + this diagnostic report |

---

## 6. Genuine Windows Validation Status & Next Action

| Step on `windows-latest` (Node `22.23.5` / npm `10.9.9`) | Status |
|---|---|
| Clean `npm ci --include=optional --legacy-peer-deps --no-audit --no-fund` | **`BLOCKED` (Awaiting Owner GitHub Actions Run)** |
| 8-Point PowerShell Diagnostics (`00c-rolldown-diagnostics.log`) | **`BLOCKED` (Awaiting Owner GitHub Actions Run)** |
| `npm run build:desktop` on Windows x64 | **`BLOCKED` (Awaiting Owner GitHub Actions Run)** |
| TypeScript validation (`npm run lint`) & Automated Test Suite (`npm test`) on Windows x64 | **`BLOCKED` (Awaiting Owner GitHub Actions Run)** |

### Exact Next Step for Owner
1. Push BOTH the reconciled `package-lock.json` (`1feb292e40a5c49b143ae4787bb039af6ecf624349064c470bbbd0dac5e37f44`) AND the updated `.github/workflows/build-windows.yml` (`472c30146b89a139a4003412a7ca215ecf710372b0f94918b6a00de571a2719c`) to GitHub.
2. Run **Build Windows x64 Desktop Installer** on `windows-latest`.
3. If `npm run build:desktop` now passes cleanly, Gate G1 desktop build is verified. If the diagnostic gate triggers, share `00c-rolldown-diagnostics.log` (specifically `package-lock SHA256`, `DIAGNOSTIC CLASSIFICATION`, and `[5/8]` `cause depth 0..N`) so the exact Case A / Case B / Case C conditional repair can be applied with 100% evidence.

---

**STOP CONDITION REACHED:** Final classification is **`BLOCKED`** pending genuine `windows-latest` execution of the instrumented workflow. Awaiting owner review and Windows diagnostic output.
