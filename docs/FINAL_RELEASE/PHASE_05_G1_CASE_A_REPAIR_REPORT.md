# GOLDEN PALACE POS — PHASE 5 G1 CASE A REPAIR REPORT
## Root-Level `optionalDependencies` Repair for `@rolldown/binding-win32-x64-msvc@1.2.11`

**Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)  
**Failed GitHub Actions Run:** `44758476675`  
**Target CI Runtime:** `windows-latest` x64 (`Node 22.23.5` / `npm 10.9.9`)  
**Pinned Bundler Stack:** `vite@8.3.1` / `rolldown@1.2.11`  
**Pinned Desktop Stack:** `electron@22.3.27` (ABI `110`) / `better-sqlite3@11.10.0` / SQLite Schema Version `4`  
**Report Timestamp (UTC):** `2026-11-21T17:28:05Z`

---

## FINAL CLASSIFICATION: **`PARTIALLY VERIFIED`**

> **Classification:** **`PARTIALLY VERIFIED`** — Case A root-level `optionalDependencies` repair (`"@rolldown/binding-win32-x64-msvc": "1.2.11"`) has been cleanly applied to `package.json` and surgically reconciled in `package-lock.json` (4-line diff, `0` unrelated changes, rollback backup preserved), cross-platform OS/CPU filtering and Linux x64 desktop builds verified cleanly (`0` `validateLockfile` errors on both `linux-x64` and `win32-x64`).  
> **Why Not `PASS` Yet:** Genuine Windows x64 (`windows-latest`, `Node 22.23.5`, `npm 10.9.9`) execution cannot be performed inside this Linux container (no `.git` remote, no GitHub API credentials, no Windows x64 host). Linux results are **not** claimed as Windows execution proof.

---

## 1. Diagnostic Evidence Inspection

1. **GitHub Actions Artifact (`00c-rolldown-diagnostics.log`):**
   - Checked workspace recursively for `00c-rolldown-diagnostics.log` — not present locally inside this container (container has no `.git` remote or GitHub API access to download Run `44758476675` artifacts directly).
2. **Confirmed Owner Evidence from Run `44758476675` (Case A):**
   - `Cannot find module '@rolldown/binding-win32-x64-msvc'` (primary Windows native package resolution failure after `npm ci`).
   - `Cannot find module '@rolldown/binding-wasm32-wasi'` (runtime fallback lookup triggered only after the native MSVC package fails to resolve; confirmed NOT declared by `rolldown@1.2.11` and therefore NOT added).
   - Upstream `@rolldown/binding-win32-x64-msvc@1.2.11` npm tarball was already conclusively verified uncorrupted in `PHASE_05_G1_ROLLDOWN_WINDOWS_BINDING_DIAGNOSTIC_REPORT.md` (`package.json` `858 B`, `rolldown-binding.win32-x64-msvc.node` `20,808,704 B`, PE32+ `0x8664`, SHA-256 `cc49bb8c6463e2c85ed1287bf949bf6cfd08d6e0b80be53d2a12eb4500c1bf8c`), confirming Case A (package absent / unresolved after `npm ci`) rather than corrupted archive contents.

---

## 2. Root Cause & Rationale for Root-Level `optionalDependencies` Repair

### Why Transitive Resolution Alone Failed Under Case A
- Previously, `@rolldown/binding-win32-x64-msvc@1.2.11` existed only as a **transitive** optional dependency (`root → devDependencies: vite@8.3.1 → dependencies: rolldown@1.2.11 → optionalDependencies: @rolldown/binding-win32-x64-msvc@1.2.11`) where:
  - Root `packages[""]` in `package-lock.json` had **no direct edge** to `@rolldown/binding-win32-x64-msvc`, so `npm ci`'s `validateLockfile` did not enforce root-level manifest sync for the Windows binding.
  - The binding inherited `dev: true` + `optional: true` (`devOptional: true`) through Linux-prehydrated `rolldown@1.2.11`, making it susceptible to cross-platform optional pruning (`npm/cli#4828`) and silent optional skip during `npm ci`.

### Why Promoting `@rolldown/binding-win32-x64-msvc: "1.2.11"` to Root `optionalDependencies` Fixes It Safely
1. **Direct Root-Level Edge:** Creates an explicit `root → optional → node_modules/@rolldown/binding-win32-x64-msvc@1.2.11` edge enforced by `npm ci`'s `validateLockfile()` check and hoisted deterministically at top-level `node_modules/@rolldown/binding-win32-x64-msvc` (exact resolution target of Rolldown's `__require("@rolldown/binding-win32-x64-msvc")`).
2. **Safe Cross-Platform OS/CPU Filtering:** Because the package declares `"os": ["win32"]` and `"cpu": ["x64"]` and is declared under **`optionalDependencies`** (not `dependencies` or `devDependencies`):
   - On **Windows x64**, `npm ci --include=optional` matches `win32`/`x64` and installs the exact `1.2.11` package and its `20,808,704`-byte PE32+ `.node` binary.
   - On **Linux x64**, `npm ci` detects `EBADPLATFORM` (`linux !== win32`) and safely skips `@rolldown/binding-win32-x64-msvc` without error while installing `@rolldown/binding-linux-x64-gnu@1.2.11`.
3. **Zero Unrelated Drift:** Preserves `vite@8.3.1`, `rolldown@1.2.11`, `electron@22.3.27`, `better-sqlite3@11.10.0`, and does **not** add `@rolldown/binding-wasm32-wasi`.

---

## 3. Exact Dependency Changes, Diffs & Rollback Backup

### 3.1 Preserved Lockfile Backup
- **Backup Path:** `docs/FINAL_RELEASE/backups/package-lock.json.pre-case-a.bak`
- **Backup SHA-256:** `1feb292e40a5c49b143ae4787bb039af6ecf624349064c470bbbd0dac5e37f44`
- **New `package.json` SHA-256:** `67cfbac9669af1a3b6132aaf8abc558df1fa1d5c422741e63620a1f5cf38918a` (previous: `d589b7a7506fa4b7e1dc990a4c2ddf2138407a26753e925b3f417c17eb38d280`)
- **New `package-lock.json` SHA-256:** `6896cad13feec5564ccb9f12b90b53f26de0a7255d1c6f4cb4cecde4ad258c69`

### 3.2 Exact `package.json` Diff
```diff
     "firebase-admin": "^14.5.0",
     "jsonwebtoken": "^9.0.3"
   },
+  "optionalDependencies": {
+    "@rolldown/binding-win32-x64-msvc": "1.2.11"
+  },
   "devDependencies": {
```

### 3.3 Exact `package-lock.json` Diff (Surgical — 0 Packages Upgraded or Removed)
```diff
--- docs/FINAL_RELEASE/backups/package-lock.json.pre-case-a.bak
+++ package-lock.json
@@ -18,6 +18,9 @@
         "firebase-admin": "^14.5.0",
         "jsonwebtoken": "^9.0.3"
       },
+      "optionalDependencies": {
+        "@rolldown/binding-win32-x64-msvc": "1.2.11"
+      },
       "devDependencies": {
         "@electron/rebuild": "^4.2.1",
         "@tailwindcss/vite": "^4.3.3",
@@ -1161,7 +1164,6 @@
       "cpu": [
         "x64"
       ],
-      "dev": true,
       "license": "MIT",
       "optional": true,
       "os": [
```

---

## 4. Cross-Platform Validation Results

| Environment / Validation Check | Status | Concrete Evidence |
|---|---|---|
| **Arborist `validateLockfile` (`linux-x64`)** | **`PASS`** | `validateLockfileErrors=0`, `rootEdge={type:'optional', valid:true, to:'node_modules/@rolldown/binding-win32-x64-msvc'}`, `dev:false, optional:true` |
| **Arborist `validateLockfile` (`win32-x64`)** | **`PASS`** | `validateLockfileErrors=0`, `rootEdge={type:'optional', valid:true, to:'node_modules/@rolldown/binding-win32-x64-msvc'}`, `os:['win32'], cpu:['x64']` |
| **Linux x64 — Clean `npm ci` OS/CPU Filtering** | **`PASS`** | Isolated real `npm ci --include=optional --legacy-peer-deps --no-audit --no-fund` exited `0`; installed `binding-linux-x64-gnu` and **safely skipped** `binding-win32-x64-msvc` (absent from `node_modules/@rolldown/`) |
| **Linux x64 — Full Workspace `npm ci --dry-run`** | **`PASS`** | `added 831 packages in 1s`, `0` lockfile sync errors |
| **Linux x64 — `npm run build:desktop`** | **`PASS`** | `vite v8.3.1` built 1693 modules in `923ms`; `esbuild` built `dist-electron/server.cjs` (`4.8mb`) in `560ms`; `dist/assets/aistudio` absent |
| **Linux x64 — TypeScript Validation (`tsc --noEmit`)** | **`PASS`** | `0` errors |
| **Targeted `--os=win32 --cpu=x64` `npm ci --ignore-scripts` (Non-Windows Host Pre-Check Only)** | **`PASS` (Pre-Check Only)** | Exited `0`; extracted `node_modules/@rolldown/binding-win32-x64-msvc/` (`package.json` `858 B`, `rolldown-binding.win32-x64-msvc.node` `20,808,704 B`) and skipped `binding-linux-x64-gnu`. *Not treated as genuine Windows execution proof.* |
| **Genuine Windows x64 (`windows-latest`) — Clean `npm ci`, Package & `.node` Presence, `require.resolve`, Direct Native Load & `npm run build:desktop`** | **`PENDING` (Blocked Inside Linux Container)** | Awaits owner push of repaired `package.json`, `package-lock.json`, and `.github/workflows/build-windows.yml` and execution on `windows-latest` |

---

## 5. Safety Restrictions & Packaging Note

- **Safety Compliance:**
  - Electron `22.3.27` (ABI `110`) and `better-sqlite3@11.10.0` strictly unchanged.
  - `package-lock.json` preserved and backed up (not deleted or regenerated).
  - SQLite schema version `4` untouched; zero migrations, zero production database access, zero production deployment.
- **Note for Subsequent Installer Packaging Review (Do Not Apply Before Desktop Build Passes):**
  - Because `electron-builder` packages root `optionalDependencies` into `app.asar` by default, once the genuine Windows `npm run build:desktop` succeeds and owner authorizes resuming installer packaging, verify whether `!node_modules/@rolldown/**/*` should be added to `electron-builder.yml` `files` so the `20.8 MB` build-time bundler binary does not bloat the production NSIS installer.

---

## 6. Remaining Blockers & Owner Action Required

1. **Remaining Blocker:** Genuine Windows x64 runner (`windows-latest`, `Node 22.23.5`, `npm 10.9.9`) is not accessible from this Linux container.
2. **Exact Owner Next Step:**
   - Commit and push:
     - `package.json` (`67cfbac9669af1a3b6132aaf8abc558df1fa1d5c422741e63620a1f5cf38918a`)
     - `package-lock.json` (`6896cad13feec5564ccb9f12b90b53f26de0a7255d1c6f4cb4cecde4ad258c69`)
     - `.github/workflows/build-windows.yml` (`472c30146b89a139a4003412a7ca215ecf710372b0f94918b6a00de571a2719c`)
   - Trigger **Build Windows x64 Desktop Installer** on `windows-latest`.
   - Confirm `00c-rolldown-diagnostics.log` prints `DIAGNOSTIC CLASSIFICATION: NONE` (`require.resolve`, direct `require('@rolldown/binding-win32-x64-msvc')`, and `import('rolldown')` all `OK`) and `npm run build:desktop` passes on Windows x64.

---

**STOP GATE ENFORCED:** Case A repair experiment is implemented, backed up, and verified on Linux x64. Installer packaging has **not** been started. Stopping here for owner review and genuine Windows CI execution.
