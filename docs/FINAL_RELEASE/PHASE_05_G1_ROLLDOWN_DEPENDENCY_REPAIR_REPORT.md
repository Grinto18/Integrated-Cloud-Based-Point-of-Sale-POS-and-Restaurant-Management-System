# GOLDEN PALACE POS — PHASE 5 G1 ROLLDOWN DEPENDENCY REPAIR REPORT

**Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)  
**Target Commit Under Repair:** `a71e8ea9d2001e6b4df378b2eddcf50edc29788b`  
**Reported Failure Stage:** `npm run build:desktop` (Vite compilation after `npm ci`)  
**Reported Runner:** GitHub Actions `windows-latest` (Windows x64 / Node.js `22.23.5`)  
**Report Timestamp (UTC):** `2026-11-21T16:31:18Z`

---

## FINAL CLASSIFICATION: **`PARTIALLY VERIFIED`**

> **Classification:** **`PARTIALLY VERIFIED`** — Root cause proven with concrete forensic evidence, `package-lock.json` surgically reconciled without unrelated upgrades (`+7` exact Windows x64 optional native bindings, `0` removals, `0` version drifts), Windows CI workflow updated to `npm ci --include=optional --legacy-peer-deps --no-audit --no-fund` with fail-fast Windows binding verification, and local Linux validation (`npm ci --dry-run`, `npm run build:desktop`, `tsc --noEmit`) passed cleanly.  
> **Why Not `PASS` Yet:** This workspace container runs Linux (`4.19.0-gvisor x86_64`) with no `.git` remote, GitHub credentials, or genuine Windows x64 execution host. Per Section 4 & Section 5, a Linux-side check is **not** treated as proof of genuine Windows x64 build execution. Full **`PASS`** requires executing the repaired lockfile and workflow on a genuine Windows x64 runner (`windows-latest`).

---

## 1. Root Cause Analysis (With Concrete Forensic Evidence)

### 1.1 Exact Versions Identified
| Component | Pinned Version (`package-lock.json`) | Declared Range (`package.json` / Parent) |
|---|---|---|
| **Vite** | `8.3.1` | `^8.3.0` |
| **Rolldown** | `1.2.11` | `~1.2.9` (via `vite@8.3.1`) |
| **Electron** | `22.3.27` (ABI `110`) | `^22.3.27` (**Strictly Preserved**) |
| **better-sqlite3** | `11.10.0` | `11.10.0` (**Strictly Preserved**) |
| **Tailwind CSS Oxide** | `4.3.3` | via `@tailwindcss/vite@4.3.3` |
| **LightningCSS (root / tailwind)** | `1.33.0` / `1.32.0` | via `vite` / `@tailwindcss/node` |
| **esbuild (root / tsx)** | `0.25.12` / `0.28.2` | `^0.25.0` / via `tsx@4.23.15` |
| **TypeScript** | `7.0.2` | `^7.0.2` |
| **Local Workspace Runtime** | Node `v22.23.2` / npm `10.9.8` | Linux `4.19.0-gvisor x86_64` |
| **GitHub Actions Runner** | Node `v22.23.5` (per G1 failure report; npm `10.9.x` bundled with Node 22) | `windows-latest` (`x64`) |

### 1.2 Why `@rolldown/binding-win32-x64-msvc` and `@rolldown/binding-wasm32-wasi` Failed on Windows
1. **Verified `rolldown@1.2.11` Declared `optionalDependencies`:**
   - `node_modules/rolldown/package.json` explicitly declares `"@rolldown/binding-win32-x64-msvc": "1.2.11"` (alongside 14 other OS/CPU targets).
   - `rolldown@1.2.11` does **NOT** declare `@rolldown/binding-wasm32-wasi` in `optionalDependencies`.
   - Inspecting `node_modules/rolldown/dist/shared/binding-BY0qR5iS.mjs` (lines 153 and 567–574) proves that on `win32`/`x64`, Rolldown attempts `__require("@rolldown/binding-win32-x64-msvc")` first and, when that module is absent, falls back at runtime to `__require("@rolldown/binding-wasm32-wasi")`, causing the error message to cite both packages.
2. **Why `package-lock.json` Omitted the Windows x64 Binding (`npm/cli#4828` + Linux Pre-Hydration):**
   - Inspecting the baseline `package-lock.json` (`825` entries, SHA-256 `da2cb4680719a63da44badfa258f2440a456b062b21a3ae2de42c9417579d0fb`) revealed:
     - `node_modules/rolldown@1.2.11` listed `"@rolldown/binding-win32-x64-msvc": "1.2.11"` inside its `optionalDependencies` map, **but** `lock.packages` contained ONLY Linux x64 bindings (`node_modules/@rolldown/binding-linux-x64-gnu` and `node_modules/@rolldown/binding-linux-x64-musl`).
     - In fact, **112 non-Linux-x64 `optionalDependencies` entries** across **9 parent packages** had been pruned when `package-lock.json` was generated/updated on the Linux x64 container (`482/824` entries had `resolved`/`integrity`; Linux-prehydrated packages lacked non-Linux platform siblings).
     - On `windows-latest`, `npm ci` strictly installs ONLY entries explicitly present in `package-lock.json`'s `packages` map and does not query the registry for pruned optional bindings — guaranteeing `@rolldown/binding-win32-x64-msvc` was never installed.
3. **Prevented 4 Subsequent Windows CI Crashes Discovered During Audit:**
   - The exact same Linux lockfile pruning had also omitted the Windows x64 native bindings for:
     - `@tailwindcss/oxide@4.3.3` → missing `@tailwindcss/oxide-win32-x64-msvc@4.3.3` (would crash `vite build` immediately after Rolldown)
     - `lightningcss@1.33.0` & `@tailwindcss/node/node_modules/lightningcss@1.32.0` → missing `lightningcss-win32-x64-msvc@1.33.0` & `1.32.0` (would crash CSS bundling)
     - `esbuild@0.25.12` & `tsx/node_modules/esbuild@0.28.2` → missing `@esbuild/win32-x64@0.25.12` & `0.28.2` (would crash `npm run build:server`)
     - `typescript@7.0.2` → missing `@typescript/typescript-win32-x64@7.0.2` (would crash `npm run lint` / `tsc --noEmit`)
4. **`.npmrc` & `npm config` Inspection:**
   - Verified no `.npmrc`, `~/.npmrc`, or `/etc/npmrc` exists.
   - `npm config ls -l` confirmed `omit = []`, `include = []`, `os = null`, `cpu = null`, `legacy-peer-deps = false`. Optional dependencies were **not** omitted by npm configuration.
5. **`--legacy-peer-deps` Investigation (Proven by Isolated `/tmp` Test):**
   - Running `npm install --package-lock-only --include=optional` **without** `--legacy-peer-deps` failed with `ERESOLVE`: `vite@8.3.1` declares `peerOptional esbuild@"^0.27.0 || ^0.28.0"` while root `package.json` pins `esbuild@"^0.25.0"` (`0.25.12`).
   - Therefore `--legacy-peer-deps` is strictly required to preserve the pinned `esbuild@0.25.12` / `vite@8.3.1` pairing, and it did **not** cause the missing optional native bindings.

---

## 2. Surgical Lockfile Repair & Exact Dependency Diff

### 2.1 Why Full Lockfile Regeneration Was Rejected
Testing a fresh `npm install --package-lock-only --legacy-peer-deps` in isolated `/tmp/lock_test_fresh` mutated **83 unrelated packages** (`vite 8.3.1 -> 8.3.8`, `rolldown 1.2.11 -> 1.2.19`, `tailwindcss 4.3.3 -> 4.3.5`, `drizzle-orm 0.45.3 -> 0.45.4`, `react 19.3.0 -> 19.3.1`, `vitest 5.1.0 -> 5.1.1`, etc.). Per Section 3 ("Do NOT delete the lockfile. Do NOT regenerate the entire dependency tree unnecessarily. Avoid unrelated dependency upgrades"), full regeneration was rejected.

### 2.2 Surgical Reconciliation Applied to `package-lock.json`
- **Baseline `package-lock.json` SHA-256:** `da2cb4680719a63da44badfa258f2440a456b062b21a3ae2de42c9417579d0fb` (`825` package keys)
- **Repaired `package-lock.json` SHA-256:** `1feb292e40a5c49b143ae4787bb039af6ecf624349064c470bbbd0dac5e37f44` (`832` package keys)
- **`package.json` Changes:** **NONE** (`package.json` SHA-256 unchanged: `d589b7a7506fa4b7e1dc990a4c2ddf2138407a26753e925b3f417c17eb38d280`)
- **Removed Packages:** `0`
- **Version-Changed Packages:** `0`
- **Added Packages:** Exactly **7** official Windows x64 `optionalDependencies` fetched directly from the npm registry via `npm view <pkg>@<exact-pinned-version> --json`:

| # | Lockfile Path (`packages` key) | Exact Version | Declaring Parent | Official npm Registry Integrity (`sha512`) |
|---|---|---|---|---|
| 1 | `node_modules/@rolldown/binding-win32-x64-msvc` | `1.2.11` | `rolldown@1.2.11` | `sha512-/PzKqzAJ03i19oy2ItPvyvaVjOjBCNnfaJs8yvUdGBKmiESgnrJSQ2awd81QzFbbnAmu7YO9ZnJrDCb9VSJPRA==` |
| 2 | `node_modules/@tailwindcss/oxide-win32-x64-msvc` | `4.3.3` | `@tailwindcss/oxide@4.3.3` | `sha512-yJ0pwIVc/nYeGoV02WtsN8KYyLQv7kyI2wDnkezyJlGGjkd4QLwDGAwl47YpPJeuI0M0ObaXGSPjvWDPeTPggw==` |
| 3 | `node_modules/lightningcss-win32-x64-msvc` | `1.33.0` | `lightningcss@1.33.0` | `sha512-OlEICDx/Xl0FqSp4bry8zFnCvGpig3Gl4gCquvYwHuqJKEC1+n9NgDniFvqHGmMv1ZkqDJrDqKKSykTDX+ehuA==` |
| 4 | `node_modules/@tailwindcss/node/node_modules/lightningcss/node_modules/lightningcss-win32-x64-msvc` | `1.32.0` | `@tailwindcss/node/node_modules/lightningcss@1.32.0` | `sha512-Amq9B/SoZYdDi1kFrojnoqPLxYhQ4Wo5XiL8EVJrVsB8ARoC1PWW6VGtT0WKCemjy8aC+louJnjS7U18x3b06Q==` |
| 5 | `node_modules/@esbuild/win32-x64` | `0.25.12` | `esbuild@0.25.12` | `sha512-alJC0uCZpTFrSL0CCDjcgleBXPnCrEAhTBILpeAp7M/OFgoqtAetfBzX0xM00MUsVVPpVjlPuMbREqnZCXaTnA==` |
| 6 | `node_modules/tsx/node_modules/esbuild/node_modules/@esbuild/win32-x64` | `0.28.2` | `tsx/node_modules/esbuild@0.28.2` | `sha512-5ebpxr3nWMzrL/rnUI755Jkuee0bHL/Gq0WTF9lvcpv73wAp5eu8MfBUgWK9bhWvZjj7yX8etf/8tI8Ney695g==` |
| 7 | `node_modules/@typescript/typescript-win32-x64` | `7.0.2` | `typescript@7.0.2` | `sha512-0BQ3HkAHHlKLSp1qRvf3SUhGpGsDuhB/jgFw75guyqbxJqEaS0Cw/VFO8i2nHglJUzQCRtMMR/IBAKE3ETMC4g==` |

- **WASI Fallback Check (`@rolldown/binding-wasm32-wasi`):** Confirmed **NOT declared** by `rolldown@1.2.11` and therefore **NOT added** (matching Section 3 strictly).

---

## 3. Windows CI Workflow & Script Hardening

### 3.1 `.github/workflows/build-windows.yml` (SHA-256: `56ff616a3461f8b7f976a404a657a600befaa30169080713f8ab2725fba92f68`, Valid YAML)
- Updated installation command to:
  `npm ci --include=optional --legacy-peer-deps --no-audit --no-fund`
- Logs exact `Node`, `npm`, `Electron` (`22.3.27`), `better-sqlite3` (`11.10.0`), `Vite` (`8.3.1`), and `Rolldown` (`1.2.11`) versions to `release\ci-logs\00-environment.log`.
- Immediately verifies presence and exact pinned version of all Windows x64 native bindings after `npm ci`:
  - `@rolldown/binding-win32-x64-msvc@1.2.11`
  - `@tailwindcss/oxide-win32-x64-msvc@4.3.3`
  - `lightningcss-win32-x64-msvc@1.33.0` (root) and `1.32.0` (`@tailwindcss/node`)
  - `@esbuild/win32-x64@0.25.12`
  - `@typescript/typescript-win32-x64@7.0.2`
- Fails immediately with an explicit diagnostic if any binding is missing or version-mismatched (never silently skipped).

### 3.2 `scripts/build-windows-installer.ps1` (SHA-256: `8f7bd953cd03b8774d7d48457ca0223dcd8f6e42221912b0a4f7c274e8ac26ac`)
- Added matching pre-flight check verifying the Windows x64 optional native bindings before running `npm run build:desktop`.

---

## 4. Validation Results (Local Workspace vs. Genuine Windows x64 Runner)

| Validation Check | Local Linux Container (`Node v22.23.2` / `npm 10.9.8`) | Genuine Windows x64 Runner (`windows-latest`) |
|---|---|---|
| **`npm ci --include=optional --legacy-peer-deps --no-audit --no-fund --dry-run` (reconciled lockfile)** | **`PASS`** (`added 831 packages in 1s`; explicitly resolved all 7 `win32-x64` bindings including `@rolldown/binding-win32-x64-msvc@1.2.11`) | **`PENDING`** (must execute on `windows-latest`) |
| **Windows Optional Native Binding Presence After Real `npm ci`** | Not claimed (Linux host cannot prove Windows runtime loading) | **`PENDING`** (CI asserts presence & exact versions immediately post-install) |
| **`npm run build:desktop` (`vite@8.3.1` + `esbuild@0.25.12`)** | **`PASS`** (`vite v8.3.1` built 1693 modules in `999ms`; `dist-electron/server.cjs` `4.8mb` in `581ms`; `dist/assets/aistudio` excluded) | **`PENDING`** |
| **TypeScript Validation (`tsc --noEmit`)** | **`PASS`** (`0` errors) | **`PENDING`** |
| **Automated Test Suite (`npm test`)** | **`PASS`** (`28/28` test files, `175/175` tests passed; zero application/schema files touched since full run) | **`PENDING`** |
| **Pinned Safety Checks (`Electron 22.3.27`, `better-sqlite3 11.10.0`, Schema v4)** | **`PASS`** (zero upgrades, zero schema migrations, zero production DB access) | **`PENDING`** |

---

## 5. Remaining Blockers & Next Step for Owner

1. **Remaining Blocker:** Genuine Windows x64 execution cannot run inside this Linux container (no `.git` remote, no GitHub credentials, no Windows x64 host).
2. **Exact Owner Verification Action:**
   - Commit and push the repaired `package-lock.json`, `.github/workflows/build-windows.yml`, and `scripts/build-windows-installer.ps1` to your GitHub repository.
   - Re-run **`Build Windows x64 Desktop Installer`** (`.github/workflows/build-windows.yml`) on `windows-latest` via **Actions → Run workflow**.
   - Verify `00-environment.log` confirms all 6 checked Windows x64 native bindings (starting with `@rolldown/binding-win32-x64-msvc@1.2.11`) and confirm `01-build-desktop.log`, `02-test-suite.log`, and `03-typescript-validation.log` succeed cleanly.

---

**STOP GATE ENFORCED:** Lockfile repair, Windows CI workflow hardening, and local verification are complete. Final classification is **`PARTIALLY VERIFIED`** pending genuine Windows x64 execution on `windows-latest`. Awaiting owner review and live Windows CI confirmation before proceeding further.
