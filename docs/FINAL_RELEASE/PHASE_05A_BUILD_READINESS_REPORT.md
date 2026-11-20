# GOLDEN PALACE POS — PHASE 5A BUILD READINESS REPORT
## Workstream 5A: Windows x64 Build Environment, Packaging & Native Module Audit

- **Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)
- **Workstream:** Phase 5A (Authorized under Phase 5 Official Owner Authorization)
- **Status:** **CODE & PACKAGING CONFIG READY; NATIVE WINDOWS x64 HOST REQUIRED FOR WORKSTREAM 5B BINARY COMPILATION**
- **Schema / Migration Impact:** **ZERO** (`LATEST_SCHEMA_VERSION = 4` unchanged)
- **Electron Version Policy:** **PRESERVED** (`electron@22.3.27` pinned; zero major upgrades; Windows 7 SP1 x64 compatibility preserved)

---

## 1. Audited Runtime & Native Module Version Inventory

| Component / Package | Installed Version | Target Runtime / ABI Notes |
|---|---|---|
| Application Version | `1.0.0` | `package.json` (`main: electron/main.cjs`) |
| Electron | `22.3.27` | Last major branch supporting **Windows 7 SP1 x64**; embeds Chromium 108 & Node.js `16.17.1` (**Native Module ABI `110`**) |
| `electron-builder` | `23.6.0` | NSIS x64 Windows installer generator |
| `@electron/rebuild` | `4.2.1` | Compiles `better-sqlite3` against Electron `22.3.27` (ABI `110`) |
| `better-sqlite3` | `11.10.0` | Native C++20 SQLite addon (`binding.gyp` uses `/std:c++20` on MSVC; supports `NODE_MODULE_VERSION >= 93`, fully compatible with ABI `110`) |
| `bcryptjs` | `3.0.3` | Pure JS (`engines: any`) |
| `express` | `4.22.3` | Node `>= 0.10.0` |
| `drizzle-orm` | `0.45.3` | Pure JS/TS (`engines: any`) |
| `exceljs` | `4.4.0` | Node `>= 8.3.0` |
| `jsonwebtoken` | `9.0.3` | Node `>= 12` |
| `dotenv` | `17.4.2` | Node `>= 12` |
| `cors` | `2.8.6` | Node `>= 0.10` |
| `firebase-admin` | `14.5.0` | Declares `engines: { node: '>=22' }` — **remediated in 5A via lazy loading & desktop offline short-circuit** (never loaded in Electron 22 offline desktop mode) |
| Current Workspace Host | `Linux 4.19.0-gvisor x86_64` | Node `v22.23.2` (ABI `127`), npm `10.9.8`; **no Windows OS, no MSVC Build Tools, no Wine, no `makensis`** |

---

## 2. Critical Blockers Found During Audit & Resolved in Workstream 5A

Before starting packaging, the audit uncovered **4 critical runtime/packaging blockers** in repository code/config and **1 host-environment constraint**:

### Resolved Repository Blockers (Fixed & Verified in 5A)

1. **BLOCKER 5A-1 (FATAL STARTUP CRASH): `firebase-admin@14.5.0` (`node >= 22`) eagerly imported on Electron `22.3.27` (`Node 16.17.1`)**
   - **Root Cause:** `src/lib/firebase-admin.ts` executed top-level imports of `firebase-admin/app` and `firebase-admin/auth`, which require Node >= 22 and were not unpacked from `app.asar`.
   - **Fix:** Refactored `src/lib/firebase-admin.ts` to lazy-load `firebase-admin` strictly inside `verifyIdToken()` and immediately reject with `auth/desktop-offline-mode` when `GOLDEN_PALACE_DESKTOP=1`. Offline desktop POS startup never touches `firebase-admin`.

2. **BLOCKER 5A-2 (FATAL PACKAGED LAUNCH FAILURE): `ELECTRON_RUN_AS_NODE=1` cannot execute `server.cjs` or serve `dist/` inside `app.asar`**
   - **Root Cause:** `electron/main.cjs` spawns the backend via `fork(serverEntry, [], { env: { ELECTRON_RUN_AS_NODE: '1' } })`, where Electron's ASAR virtual filesystem is disabled. Previously `dist/**/*`, `dist-electron/**/*`, `build/icon.*`, and `node_modules/iconv-lite/**/*` were packed inside `app.asar` instead of `app.asar.unpacked`.
   - **Fix:**
     - Updated `electron-builder.yml` to include `build/icon.ico` & `build/icon.png` in `files` and unpack `dist/**/*`, `dist-electron/**/*`, `build/icon.ico`, `build/icon.png`, `node_modules/better-sqlite3/**/*`, `node_modules/bindings/**/*`, `node_modules/file-uri-to-path/**/*`, `node_modules/bcryptjs/**/*`, and `node_modules/iconv-lite/**/*` via `asarUnpack`.
     - Updated `resolveBundledPaths()` in `electron/main.cjs` to resolve `dist`, `dist-electron/server.cjs`, and `build/icon.ico` from `app.asar.unpacked` first.

3. **BLOCKER 5A-3 (NODE 16 SYNTAX SAFETY): `build:server` esbuild target omitted `--target=node16`**
   - **Fix:** Added `--target=node16` to `package.json` `build:server` script so `dist-electron/server.cjs` emits syntax strictly compatible with Electron `22.3.27`'s embedded Node `16.17.1`.

4. **BLOCKER 5A-4 (ARTIFACT NAME MISMATCH): Installer filename did not match Phase 5 specification**
   - **Fix:** Updated `electron-builder.yml` `artifactName` to `GoldenPalacePOS-Setup-${arch}.${ext}` (resolving to **`GoldenPalacePOS-Setup-x64.exe`**), synchronized `.github/workflows/build-windows.yml`, and updated `src/__tests__/phase12.release.acceptance.test.ts`.

---

## 3. Audit Checklist Results

| Audit Area | Verification Result | Details |
|---|---|---|
| `electron-builder.yml` & NSIS config | **PASS** | `appId: com.goldenpalace.pos`, `productName: GOLDEN PALACE POS`, `target: nsis`, `arch: x64`, `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`, `createDesktopShortcut: true`, `createStartMenuShortcut: true`, `deleteAppDataOnUninstall: false`, `installerIcon` & `uninstallerIcon` set to `build/icon.ico` |
| Official Icons (`build/icon.ico` & `build/icon.png`) | **PASS** | Verified `512×512` RGBA PNG (`42,778 B`) and 6-frame Windows ICO (`256/64/48/32/24/16`, `74,203 B`), included in runtime files & `asarUnpack` |
| Production Asset Inclusion | **PASS** | `dist/` (`1.6M`) excludes `public/assets/aistudio/` completely; `electron-builder.yml` `files` never includes `public/` |
| Application Data Directory Separation | **PASS** | `electron/main.cjs` & `src/db/sqlitePath.ts` isolate persistent user data in `%APPDATA%\Golden Palace POS\` (`golden_palace_production.db`, `backups_production\`, `.jwt_secret`, `print_spool_payloads\`), fully independent of the installation directory |
| Uninstaller & Upgrade Data Safety | **PASS** | `deleteAppDataOnUninstall: false` preserves `%APPDATA%\Golden Palace POS\` across uninstall and in-place upgrades; `prepareSafeApplicationUpdate()` blocks upgrades while cash shifts/payments are pending |
| Native SQLite (`better-sqlite3@11.10.0`) ABI Compatibility | **SOURCE-COMPATIBLE / HOST-BLOCKED ON LINUX** | `better-sqlite3@11.10.0` C++ source supports `NODE_MODULE_VERSION >= 93` (Electron 22 = `110`). However, GitHub Releases returns **HTTP `404`** for `better-sqlite3-v11.10.0-electron-v110-win32-x64.tar.gz`, and the current workspace contains an **ELF 64-bit GNU/Linux** `better_sqlite3.node` (ABI `127`). Compiling a genuine Windows PE32+ x64 (`0x8664`) Electron ABI `110` binary **strictly requires a Windows x64 build host with MSVC C++20 Build Tools** (`windows-latest` GitHub Actions runner or physical Windows build machine). |

---

## 4. Documented Security Limitations of Legacy Electron 22.3.27 Runtime

Because **Windows 7 SP1 x64** compatibility is a mandatory owner requirement, Electron MUST remain pinned at **`22.3.27`** (Chromium `108` / Node `16.17.1`, EOL October 2023). Known limitations and compensating controls:

1. **End-of-Life Chromium 108 / V8 / Node 16.17.1:** No upstream Electron security patches are published for the 22.x line.
2. **Compensating Controls Enforced (Phases 1–4):**
   - Strictly offline local loopback architecture (`http://127.0.0.1:<port>` only); no external web browsing, remote content loading, or arbitrary URLs permitted.
   - `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, `webviewTag: false`, `allowRunningInsecureContent: false`.
   - Deny-by-default Electron permission handlers, `setWindowOpenHandler` popup denial, `will-navigate` / `will-redirect` loopback-only locking, strict IPC sender & input validation, production DevTools/menu lockdown, and strict CSP (`frame-ancestors 'none'`).
   - Operational recommendation for Windows 7 deployments: isolate the POS workstation from untrusted public internet browsing and restrict network traffic to local LAN thermal printers and approved backup transfers.

---

## 5. Verification Executed (Workstream 5A)

```bash
npm run build:desktop
npx vitest run src/__tests__/auth.backend.test.ts src/__tests__/phase3.electron.desktop.security.test.ts src/__tests__/phase12d2.ipc.security.test.ts src/__tests__/phase12.release.acceptance.test.ts src/__tests__/phase4.packaging.printing.backup.test.ts --no-color
```

- **Result:** **PASS (exit 0)** — `dist/` built in `961ms`, `dist-electron/server.cjs` (`4.8 MB`, `--target=node16`) built in `524ms`, `5/5` test files, `35/35` tests passed (`11.73s`).
