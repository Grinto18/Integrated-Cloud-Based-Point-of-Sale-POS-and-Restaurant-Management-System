# PHASE 12-D.0 — Electron Security Hardening Pre-Implementation Audit
**Project:** GOLDEN PALACE POS (`v1.0.0`)  
**Mode:** STRICT AUDIT ONLY — ZERO CODE CHANGES  
**Scope:** Electron 22 Desktop Wrapper (`electron/main.cjs`, `electron/preload.cjs`), Local Express Backend (`server.ts`, `src/server/api.ts`), Renderer & Printing Pipeline (`index.html`, `dist/index.html`, `src/main.tsx`, `src/App.tsx`, `src/services/printerService.ts`, `src/services/printQueueService.ts`, `src/components/*`), Packaging & Test Baseline  

---

## Executive Summary

GOLDEN PALACE POS currently enforces several foundational Electron isolation controls: `contextIsolation: true`, `nodeIntegration: false`, a minimal `contextBridge` API (`window.goldenPalaceDesktop` in `electron/preload.cjs`), single-instance locking, loopback-only Express binding (`HOST='127.0.0.1'`), and persistent `0o600` local `.jwt_secret` generation.

Direct inspection of the repository reveals **seven security hardening gaps** that should be remediated before Windows x64 distribution:
1. **Chromium OS sandbox disabled:** `sandbox: false` is explicitly configured in `electron/main.cjs:243`, even though `electron/preload.cjs` imports zero Node.js built-ins and is 100% compatible with `sandbox: true`.
2. **Missing navigation & popup handlers:** `setWindowOpenHandler`, `will-navigate`, and `will-redirect` handlers are absent in `electron/main.cjs:229-252`.
3. **Missing Electron session permission handlers:** Neither `setPermissionRequestHandler` nor `setPermissionCheckHandler` is configured in `electron/main.cjs`.
4. **Missing IPC sender verification & bounded input validation:** `desktop:get-printers`, `desktop:print-silent`, and `desktop:get-info` (`electron/main.cjs:186-227`) do not check `event.sender` / `event.senderFrame` origin, and `desktop:print-silent` lacks integer bounds (`1..5`) on `copies` and sanitization on `deviceName`.
5. **Permissive wildcard CORS:** `server.ts:75` mounts `app.use(cors());` (emitting `Access-Control-Allow-Origin: *`), allowing untrusted local browser tabs to target `http://127.0.0.1:<port>/api/*`.
6. **Missing Content Security Policy (CSP):** No `Content-Security-Policy` header or `<meta>` tag is configured in `index.html`, `dist/index.html`, `server.ts`, or `electron/main.cjs`.
7. **DevTools & Chromium menu bar exposed in packaged builds:** `devTools` defaults to `true` and `Menu.setApplicationMenu(null)` / `mainWindow.removeMenu()` is not set (`electron/main.cjs:238-244`), leaving `Ctrl+Shift+I` / Alt-menu accessible in production (`F12` is overridden cleanly by React POS shortcuts in `src/App.tsx:111-113`).

All seven items can be remediated cleanly across **6 incremental stages (D1–D6)** without altering SQLite databases, migrations, authentication logic, Arabic RTL / French LTR rendering, `F1`–`F12` hotkeys, or thermal receipt printing.

**Final Decision:** **A. READY FOR USER APPROVAL**

---

## 1. Verified Baseline Architecture

Measured directly from source files, build artifacts, and local runtime (`node -v`, `node_modules/*/package.json`):

| Component | Verified Value / Behavior | Exact Evidence |
|---|---|---|
| **Electron Version** | `22.3.27` (`package.json`: `^22.3.27`) | `package.json:56`; `node_modules/electron/package.json` |
| **Node.js Version** | Workspace runtime `v22.23.2` (packaged desktop forks `server.cjs` under `ELECTRON_RUN_AS_NODE=1` using Electron 22's embedded Node) | `node -v`; `electron/main.cjs:118-122` |
| **Electron Builder Version** | `23.6.0` (`package.json`: `^23.6.0`) | `package.json:57`; `node_modules/electron-builder/package.json` |
| **Native SQLite Module** | `better-sqlite3` `11.10.0` (ASAR-unpacked, rebuilt via `@electron/rebuild` `^4.2.1` for Electron `22.3.27`) | `package.json:13,29,46`; `electron-builder.yml:12-17` |
| **Main Process Entry Point** | `electron/main.cjs` (`296` lines) | `package.json:6`; `electron/main.cjs:1-296` |
| **Preload Entry Point** | `electron/preload.cjs` (`9` lines; `contextBridge` + `ipcRenderer` only) | `electron/main.cjs:240`; `electron/preload.cjs:1-9` |
| **Renderer Entry Point** | `index.html` (`dist/index.html` in prod) -> `src/main.tsx` -> `src/App.tsx` + `/sw.js` (`public/sw.js`) | `index.html:29-30`; `dist/index.html:20-28`; `src/main.tsx:1-15`; `src/App.tsx:1-485` |
| **BrowserWindow Creation** | `width: 1400`, `height: 900`, `minWidth: 1180`, `minHeight: 740`, `title: 'GOLDEN PALACE POS — القصر الذهبي'`, `backgroundColor: '#171717'`, `autoHideMenuBar: true`, loads `http://127.0.0.1:${serverPort}` | `electron/main.cjs:229-252` |
| **Existing `webPreferences`** | `preload: path.join(__dirname, 'preload.cjs')`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (`webSecurity`, `allowRunningInsecureContent`, `webviewTag`, `devTools` use defaults) | `electron/main.cjs:239-244` |
| **Existing IPC Handlers & API** | Main handles `desktop:get-printers`, `desktop:print-silent`, `desktop:get-info`; Preload exposes `window.goldenPalaceDesktop.{isDesktop, getPrinters, printSilent, getDesktopInfo}` | `electron/main.cjs:186-227`; `electron/preload.cjs:3-8` |
| **Local Server Startup & Shutdown Lifecycle** | `findAvailablePort(3456)` on `127.0.0.1` (ephemeral fallback on `0`), `fork(dist-electron/server.cjs)` with `ELECTRON_RUN_AS_NODE='1'`, `NODE_ENV='production'`, `GOLDEN_PALACE_DESKTOP='1'`, `HOST='127.0.0.1'`, `PORT=String(serverPort)`, `.jwt_secret` (`0o600`), health poll `/api/health`, graceful shutdown on `before-quit` (`IPC { type: 'shutdown' }` -> `SIGTERM` -> `SIGKILL` after `8500ms`) | `electron/main.cjs:16-184,265-294`; `server.ts:69-73,97-135,208-213` |
| **Existing CSP & CORS Configuration** | `server.ts:75` uses `app.use(cors());` (wildcard `*`); zero CSP HTTP headers and zero `<meta http-equiv="Content-Security-Policy">` in `index.html` / `dist/index.html` | `server.ts:75`; `index.html:1-34`; `dist/index.html:1-32` |
| **Printer Integration & Workflow** | `SettingsModal.tsx:207-235` merges `/api/printer/status` + `goldenPalaceDesktop.getPrinters()`; `ReceiptPrint.tsx:48,115-223,305-313` + `printerService.ts:190-212,542-774` dispatch via `BROWSER` (`printSilent` / `window.print`), `USB` (`navigator.serial`), or `WINDOWS_SPOOLER`/`NETWORK_IP` (`POST /api/printer/spool` -> `src/server/api.ts:5529-5651` -> `src/services/printQueueService.ts:39-100+`) | `src/components/SettingsModal.tsx:210`; `src/components/ReceiptPrint.tsx:48,115-237,305-313`; `src/services/printerService.ts:19-26,190-212,555-774`; `src/server/api.ts:5529-5651` |
| **Existing Automated Tests** | 21 Vitest suites in `src/__tests__/`: notably `phase10.qa.final.test.ts:372-392` (Electron/preload/builder security checks), `phase12.release.acceptance.test.ts:56-109,280-299` (packaging, ABI, preload/bundle isolation), `phase9.printing.desktop.test.ts`, `phase9.printing.frontend.test.tsx`, `auth.hardening.frontend.test.tsx:288` | `src/__tests__/` (`npm run test` -> Vitest) |

---

## 2. Electron Security Audit (15 Controls)

| # | Control | Classification | Severity | Evidence (`file:line`) & Technical Analysis |
|---|---|---|---|---|
| 1 | `nodeIntegration` | **Existing protection** | INFO | `electron/main.cjs:242` explicitly sets `nodeIntegration: false`. Node.js globals (`require`, `process`, `Buffer`) are blocked in renderer. |
| 2 | `contextIsolation` | **Existing protection** | INFO | `electron/main.cjs:241` explicitly sets `contextIsolation: true`. Preload script runs in an isolated V8 context; verified by `phase10.qa.final.test.ts:379` and `phase12.release.acceptance.test.ts:283`. |
| 3 | `sandbox` | **Verified vulnerability** | **HIGH** | `electron/main.cjs:243` explicitly sets `sandbox: false`, disabling Chromium's OS-level renderer/preload sandbox unnecessarily (`electron/preload.cjs` uses zero Node APIs). |
| 4 | `webSecurity` | **Existing protection** *(implicit)* | LOW | Omitted in `electron/main.cjs:239-244`; defaults to `true` in Electron 22. Should be set explicitly (`webSecurity: true`) for defense-in-depth and static testability. |
| 5 | `allowRunningInsecureContent` | **Existing protection** *(implicit)* | LOW | Omitted in `electron/main.cjs:239-244`; defaults to `false` in Electron 22. Should be set explicitly (`allowRunningInsecureContent: false`). |
| 6 | `webviewTag` | **Existing protection** *(implicit)* | LOW | Omitted in `electron/main.cjs:239-244`; defaults to `false` in Electron 22. Should be set explicitly (`webviewTag: false`). |
| 7 | `preload` | **Existing protection** *(minor input-filtering gap)* | INFO | `electron/main.cjs:240` sets `preload: path.join(__dirname, 'preload.cjs')`. `electron/preload.cjs:1-9` exposes only 3 `ipcRenderer.invoke` wrappers plus `isDesktop: true`, with no raw `ipcRenderer` or arbitrary channel access. Minor improvement: whitelist `{ deviceName, copies }` in `printSilent` (`preload.cjs:6`) before IPC send. |
| 8 | `setWindowOpenHandler` | **Verified vulnerability** | **HIGH** | Absent in `electron/main.cjs:229-252`. Default Electron behavior allows `window.open()` or `target="_blank"` links to spawn new `BrowserWindow` instances. Must return `{ action: 'deny' }`. |
| 9 | `will-navigate` (and `will-redirect`) | **Verified vulnerability** | **HIGH** | Absent in `electron/main.cjs:229-252`. Any injected link or script navigation to `https://...`, `file://...`, or `javascript:` is unblocked on the privileged POS `BrowserWindow`. |
| 10 | Permission requests & permission checks | **Verified vulnerability** *(with Compatibility Concern)* | **MEDIUM** | Neither `session.defaultSession.setPermissionRequestHandler` nor `setPermissionCheckHandler` is set in `electron/main.cjs`. Chromium permissions (notifications, geolocation, media, microphone, camera, serial, etc.) lack an explicit deny-by-default policy. **Compatibility concern:** `ReceiptPrint.tsx:305-313` and `printerService.ts:624-676,761-774` offer optional `USB` Web Serial printing (`navigator.serial.requestPort()`), which requires explicit `serial` policy decision (allow only on loopback origin vs deny in favor of `WINDOWS_SPOOLER`). |
| 11 | IPC sender validation | **Verified vulnerability** | **MEDIUM** | `ipcMain.handle` handlers (`electron/main.cjs:187,199,218`) do not check `event.sender === mainWindow.webContents` or `event.senderFrame.url` origin (`http://127.0.0.1:${serverPort}`). |
| 12 | IPC input validation | **Verified vulnerability** | **MEDIUM** | `desktop:print-silent` (`electron/main.cjs:199-216`) accepts unvalidated `options`: `copies` checks only `Number(options.copies) > 0` (no integer or upper bound like `1..5` enforced in `printerService.ts:542`), and `deviceName` has no type/length/control-character validation. `desktop:get-info` (`lines 218-226`) also returns local `userDataDir`, `dbPath`, `backupDir` even though zero UI components invoke `getDesktopInfo()`. |
| 13 | External URL handling | **Existing protection** *(no `openExternal`, missing explicit block)* | LOW | Source grep across `src/`, `electron/`, `index.html`, and `public/` shows zero `shell.openExternal`, zero `window.open`, zero `target="_blank"`, and zero external `<a>` anchors. Still relies on adding `setWindowOpenHandler` + `will-navigate` to enforce denial at the Electron process boundary. |
| 14 | DevTools exposure in production | **Verified vulnerability** | **MEDIUM** | `electron/main.cjs:238` sets `autoHideMenuBar: true` only; `devTools` defaults to `true` and `Menu.setApplicationMenu(null)` / `mainWindow.removeMenu()` is not called, leaving Chromium DevTools accessible in packaged builds. **Compatibility note:** `src/App.tsx:95-126` maps `F1`, `F2`, `F3`, `F5`, `F10`, `F12` (`e.preventDefault()`); disabling `devTools: !app.isPackaged` preserves `F12` Cash Register toggle without Chrome DevTools conflict. |
| 15 | Navigation to remote websites | **Verified vulnerability** *(plus Compatibility Concern)* | **HIGH** | No `will-navigate` / `will-redirect` restriction blocks remote HTTP/HTTPS navigation. Additionally, `server.ts:75` allows `*` CORS from remote web origins, and `index.html:16-18` requests remote Google Fonts (`https://fonts.googleapis.com` / `https://fonts.gstatic.com`) when online (`src/lib/firebase.ts` is bundled for optional Web mode, unused in offline POS login). |

*(**Unverified assumption** note: Live Windows x64 runtime behavior under Chromium 108 / Electron `22.3.27` — specifically `webContents.print({ silent: true })` under `sandbox: true` and hardware printer spooler timing — cannot be executed in this Linux container and must be smoke-tested on Windows x64 in Stage D6.)*

---

## 3. Preload & IPC Compatibility Analysis

Inspecting `electron/preload.cjs` (lines 1–9):
- **Node.js modules used by preload:** **None** (`require('electron')` only, destructuring `{ contextBridge, ipcRenderer }`).
- **Unsupported APIs/globals under `sandbox: true`:** **None** (zero uses of `fs`, `path`, `os`, `child_process`, `crypto`, `process`, `Buffer`, `__dirname`, or `@electron/remote`).
- **Exposed IPC methods:** `window.goldenPalaceDesktop` exposes:
  - `isDesktop: true`
  - `getPrinters: () => ipcRenderer.invoke('desktop:get-printers')`
  - `printSilent: (options) => ipcRenderer.invoke('desktop:print-silent', options || {})`
  - `getDesktopInfo: () => ipcRenderer.invoke('desktop:get-info')`
- **Direct access to Electron/Node APIs & arbitrary channels:** **None.** Neither `ipcRenderer` nor a generic `invoke(channel, ...)` wrapper is exposed.
- **Sender identity validation:** **Currently missing** in `electron/main.cjs:186-227`.
- **Smallest safe changes required (no preload rewrite):**
  1. Keep `electron/preload.cjs` API structure identical (preserving `phase10.qa.final.test.ts:384-389`, `LoginModal.tsx:26`, `SettingsModal.tsx:210`, `printerService.ts:559`), adding only field filtering on `printSilent` (`{ deviceName: options?.deviceName, copies: options?.copies }`).
  2. Switch `sandbox: false` -> `sandbox: true` in `electron/main.cjs:243`.
  3. Add `isTrustedIpcSender(event)` and `sanitizePrintOptions(options)` in `electron/main.cjs` (or a small shared CJS helper `electron/security.cjs` loaded by `main.cjs` and directly unit-tested by Vitest).

---

## 4. Local Server & Navigation Analysis

- **Local Server Address & Port Handling (`electron/main.cjs:44-60,111,126-127`):**
  - `findAvailablePort(3456)` attempts `127.0.0.1:3456` first; if busy, opens `net.createServer().listen(0, '127.0.0.1')` to acquire an OS-assigned ephemeral loopback port (falling back to `3499` if address lookup fails).
  - Port is **dynamic with `3456` preferred**, strictly bound to **`127.0.0.1`** (never `0.0.0.0` in desktop mode).
- **How Renderer Determines Server URL:**
  - Main process calls `mainWindow.loadURL('http://127.0.0.1:' + serverPort)` (`electron/main.cjs:247`).
  - Frontend `src/services/api.ts:159` calls `fetch('/api' + endpoint)` using a **relative path**, automatically targeting `http://127.0.0.1:${serverPort}`.
  - `src/main.tsx:8` registers `/sw.js` via relative path on the same origin.
- **Exact Navigation Allowlist:**
  - Allow top-level navigations **only** when `parsedUrl.origin === 'http://127.0.0.1:' + serverPort` (exact protocol `http:`, hostname `127.0.0.1`, port `String(serverPort)`).
  - Reject all other origins/schemes (`https://`, `http://localhost:...`, other loopback ports, `file://`, `data:`, `javascript:`) in both `will-navigate` and `will-redirect`.
- **External Links & Popup Blocking Impact:**
  - Zero external links or popups are required by POS workflows (grep confirmed zero `window.open`, zero `shell.openExternal`, zero `target="_blank"` across `src/` and `index.html`).
  - Blocking popups via `setWindowOpenHandler(() => ({ action: 'deny' }))` will **not** affect receipt previews (`ReceiptPrint` modal), printer settings (`SettingsModal`), silent printing (`webContents.print`), or `window.print()`.

---

## 5. CSP & CORS Analysis

### 5.1 Current CORS (`server.ts:75`)
- `app.use(cors());` currently permits `Access-Control-Allow-Origin: *` for any website open in a browser on the same machine to send requests to `http://127.0.0.1:<port>/api/*`.
- **Hardening plan:** Replace `app.use(cors());` with an origin validator:
  - Allow requests with no `Origin` header (same-origin browser fetches, Electron health check, Supertest).
  - In **Desktop (`GOLDEN_PALACE_DESKTOP === '1'`)**: allow ONLY `http://127.0.0.1:${PORT}` (exact runtime port).
  - In **Web Production (`NODE_ENV === 'production' && GOLDEN_PALACE_DESKTOP !== '1'`)**: allow configured `CORS_ALLOWED_ORIGINS` (comma-separated) or exact same-host origin (`req.headers.host` / `x-forwarded-host`), rejecting third-party origins without `*`.
  - In **Development (`!isProduction`)**: allow loopback dev origins (`http://127.0.0.1:<port>`, `http://localhost:<port>`).

### 5.2 Current CSP & Asset Analysis (`index.html`, `dist/index.html`, `src/`)
- **Current CSP:** None in `index.html`, `dist/index.html`, `server.ts`, or `electron/main.cjs`.
- **Inline scripts:** **Zero** in production `dist/index.html` (Vite bundles external `/assets/*.js` chunks; zero `eval()`/`new Function()` in `src/`). *Dev-only requirement:* Vite middleware (`server.ts:193-203` when `NODE_ENV !== 'production'`) injects inline React Fast Refresh preamble `<script type="module">`, so strict `script-src 'self'` must apply only in **production**.
- **Inline styles:**
  - Static `<style>` FOUC dark-theme block at `index.html:19-26` (`dist/index.html:19`).
  - Dynamic `<style id="thermal-page-style">` updated at runtime in `src/services/printerService.ts:200-211` for `@page { size: ${profile.printableWidth}mm auto !important; margin: 0mm !important; }`.
  - React JSX `style={{...}}` attributes in components.
- **External stylesheet/font references:** `index.html:16-18` loads `https://fonts.googleapis.com` and `https://fonts.gstatic.com` (`Cairo`/`Tajawal`, non-blocking fallback offline).
- **Printer/local origins:** All API/spool requests use `'self'` (`http://127.0.0.1:${serverPort}`). `printerService.ts:50` defines `bridgeUrl: 'ws://localhost:8182'` (`LOCAL_BRIDGE` option), which is never connected via WebSocket in `printerService.ts`.

### 5.3 Proposed Restrictive Production Desktop CSP (Zero Wildcards)
Applied in `electron/main.cjs` via `session.defaultSession.webRequest.onHeadersReceived` for `http://127.0.0.1:${serverPort}/*` responses (and mirrored on production HTML responses in `server.ts` when `GOLDEN_PALACE_DESKTOP === '1'`):
```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data: blob:;
connect-src 'self' http://127.0.0.1:<serverPort>;
worker-src 'self';
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-src 'none';
frame-ancestors 'none';
```
*(Optional Stage D5 hardening: if the user prefers zero external domains even for fonts, remove `index.html:16-18` or bundle WOFF2 locally and drop `https://fonts.googleapis.com` / `https://fonts.gstatic.com` from CSP.)*

---

## 6. Printing Compatibility Analysis

### 6.1 Complete Printing Flow Trace
1. **Printer Discovery (`SettingsModal.tsx:207-235`):** Queries `GET /api/printer/status` (`src/server/api.ts:5529` -> `printQueueService.enumerateSystemPrinters` via `powershell.exe Get-Printer` on Windows) and `window.goldenPalaceDesktop.getPrinters()` (`electron/preload.cjs:5` -> `main.cjs:187` -> `mainWindow.webContents.getPrintersAsync()`).
2. **Page Styling (`ReceiptPrint.tsx:48`, `printerService.ts:190-212,477`):** Calls `applyPrintStyles(profile)`, setting CSS variables (`--receipt-printable-width`, `--receipt-margins`) and updating `<style id="thermal-page-style">` (`@page` thermal width).
3. **Dispatch (`printerService.sendDirectPrintJob`, `lines 555-738`):**
   - **Route A (`BROWSER` / Silent Electron Print, `lines 555-621`):** Calls `window.goldenPalaceDesktop.printSilent({ deviceName: profile.printerName, copies: numCopies })` -> IPC `desktop:print-silent` (`main.cjs:199-216`) -> `mainWindow.webContents.print({ silent: true, printBackground: true, deviceName, copies })` (or `window.print()` in browser). Then logs job via `POST /api/printer/spool`.
   - **Route B (`USB` Web Serial, `lines 624-676,761-774` & `ReceiptPrint.tsx:305-313`):** Invokes `navigator.serial.requestPort()`, opens baud `9600`, writes raw ESC/POS bytes, logs job via `POST /api/printer/spool`.
   - **Route C (`WINDOWS_SPOOLER` / `NETWORK_IP`, `lines 679-738`):** Encodes ESC/POS bytes as `rawBase64` and dispatches via `POST /api/printer/spool` (`src/server/api.ts:5548-5651` -> `src/services/printQueueService.ts` in Node.js child process).

### 6.2 Compatibility Verdict
- **Routes A & C:** **100% compatible** with `sandbox: true`, `setWindowOpenHandler` deny, `will-navigate` allowlist, IPC sender validation, `copies` (`1..5`) / `deviceName` (`<=256` non-control chars) validation, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, and restricted loopback CORS.
- **Route B (`USB` Web Serial):** Would be blocked if `setPermissionRequestHandler` / `setDevicePermissionHandler` denies `serial` unconditionally. Stage D1/D5 will follow user policy (either allow `serial` permission check strictly for `http://127.0.0.1:${serverPort}` + `select-serial-port`, or explicitly deny `serial` in desktop if `WINDOWS_SPOOLER` is the sole supported desktop USB driver route).

---

## 7. Test Plan & Coverage Gaps (13 Required Scenarios)

| # | Test Area | Existing Coverage | Coverage Gap / Proposed Verification (Stage D6) |
|---|---|---|---|
| 1 | **Application startup** | Partial (`phase12.release.acceptance.test.ts:104-109` static checks) | Add automated startup/security config tests (`electron/security.cjs` + `electron/main.cjs` assertions for `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false`, `devTools: !app.isPackaged`, `removeMenu`). |
| 2 | **Login and authentication** | Covered (`auth.backend.test.ts`, `auth.hardening.backend.test.ts`, `auth.hardening.frontend.test.tsx`, `phase12.release.acceptance.test.ts:118-127,194-198`) | Re-run full auth suite after CORS/CSP changes; verify login token flow under strict `127.0.0.1` CORS & CSP. |
| 3 | **Main window navigation** | **GAP** | Unit-test `isAllowedAppOrigin(url, serverPort)` allowing exact `http://127.0.0.1:${serverPort}/*` and blocking `localhost`, wrong ports, `file://`, `https://`, `javascript:`, `data:`; verify `will-navigate` & `will-redirect` handlers exist in `electron/main.cjs`. |
| 4 | **IPC permissions** | **GAP** | Verify `setPermissionRequestHandler` & `setPermissionCheckHandler` in `electron/main.cjs` and unit-test permission evaluator denying `camera`, `microphone`, `geolocation`, `notifications`, `openExternal` (and configured `serial` rule). |
| 5 | **Rejection of unauthorized IPC channels / senders / inputs** | Partial (`phase10.qa.final.test.ts:384-389` checks allowed channel names only) | Add unit tests for `isTrustedIpcSender()` (rejecting wrong origin, missing `senderFrame`, wrong `webContents`), `sanitizePrintOptions()` (rejecting invalid `copies`/`deviceName`), and verify `preload.cjs` does not expose `ipcRenderer` or generic channel invocation. |
| 6 | **External URL handling** | **GAP** | Verify zero `shell.openExternal` / `target="_blank"` usage + verify `will-navigate` & `setWindowOpenHandler` reject `https://example.com` and `mailto:` / custom schemes. |
| 7 | **Popup rejection** | **GAP** | Assert `setWindowOpenHandler` returns `{ action: 'deny' }` for all URLs and verify no POS component calls `window.open`. |
| 8 | **Local API communication** | Covered (`phase11b`, `phase12`, `pos.phase3.backend.test.ts`) + **CORS GAP** | Add Supertest CORS tests proving requests from `Origin: http://127.0.0.1:<port>` and same-origin calls succeed while `Origin: https://evil.example` does not receive `Access-Control-Allow-Origin`. |
| 9 | **Local server shutdown** | Partial (`phase10.qa.final.test.ts:382`, `phase12.release.acceptance.test.ts:178-185`) | Retain shutdown backup & SQLite WAL close verification; verify `before-quit` -> `stopLocalPosServer` path remains intact in `electron/main.cjs`. |
| 10 | **Thermal receipt printing workflow (safe test/mock)** | Covered (`phase9.printing.desktop.test.ts`, `phase9.printing.frontend.test.tsx`) | Extend with safe Electron IPC mock test for `desktop:get-printers` and `desktop:print-silent` (`copies: 1..5`, valid `deviceName`, rejection of invalid inputs) + re-run Phase 9 printing tests. |
| 11 | **Application restart** | Covered (`phase12.release.acceptance.test.ts:184-198` DB & `.jwt_secret` persistence) | Re-run Phase 12 acceptance test verifying JWT & DB survive simulated restart without regression. |
| 12 | **Production build** | Partial (`phase12.release.acceptance.test.ts:288-298` checks `dist/assets`) | Add CSP/inline-script verification on built `dist/index.html` (confirming zero inline `<script>`) and run `npm run lint` + `npm run build:desktop`. |
| 13 | **Regression tests** | Covered (`21` test files / `126` tests) + Windows manual check | Re-run entire Vitest suite + document Windows x64 manual verification checklist (DevTools blocked, `F12` opens Cash Register, thermal receipt prints cleanly). |

---

## 8. Staged Implementation Plan (D1–D6)

### Stage D1: BrowserWindow Security Configuration
- **Files Affected:** `electron/main.cjs`
- **Exact Proposed Changes:**
  - In `createMainWindow` (`electron/main.cjs:230-245`), configure `webPreferences`:
    - `sandbox: true`
    - `webSecurity: true`
    - `allowRunningInsecureContent: false`
    - `webviewTag: false`
    - `devTools: !app.isPackaged`
  - Call `Menu.setApplicationMenu(null)` and `mainWindow.removeMenu()` so Chrome menu accelerators cannot open DevTools in production while `src/App.tsx:95-126` `keydown` shortcuts (`F1`–`F12`, `Escape`) remain functional.
  - Register `session.defaultSession.setPermissionRequestHandler` and `setPermissionCheckHandler` denying sensitive Web API permissions by default.
- **Risks:** Blocking DevTools in packaged builds disables UI inspection on customer machines (dev `electron .` retains DevTools because `!app.isPackaged` is true); blocking `serial` unconditionally affects optional `USB` Web Serial button unless scoped per user preference.
- **Dependencies:** None (verified `electron/preload.cjs` is already `sandbox: true` compatible).
- **Rollback Procedure:** Restore `electron/main.cjs` `createMainWindow` and session defaults from pre-D1 backup.
- **Required Tests:** D6 tests #1, #4, #12, #13.
- **Acceptance Criteria:** `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false`, `devTools: !app.isPackaged`, and permission handlers active without breaking startup or `F12`.

### Stage D2: Preload and IPC Hardening
- **Files Affected:** `electron/main.cjs`, `electron/preload.cjs`, new pure helper `electron/security.cjs` (packaged automatically via `electron-builder.yml:10` `electron/**/*`)
- **Exact Proposed Changes:**
  - Create `electron/security.cjs` exporting pure, testable helpers: `isTrustedIpcSender(event, mainWindow, serverPort)`, `sanitizePrintOptions(options)`, `isAllowedAppOrigin(url, serverPort)`, `buildDesktopCsp(serverPort)`.
  - Update `electron/preload.cjs:6` to forward only `{ deviceName: options?.deviceName, copies: options?.copies }`.
  - Update `electron/main.cjs:186-227`: enforce `isTrustedIpcSender` on `desktop:get-printers`, `desktop:print-silent`, and `desktop:get-info`; enforce `sanitizePrintOptions` (`copies` integer `1..5`; `deviceName` trimmed string `<= 256` chars without control chars); minimize `desktop:get-info` to `{ appName, appVersion, platform, serverUrl }` (preserving IPC channel contract for `phase10.qa.final.test.ts:389`).
- **Risks:** Overly strict `deviceName` character regex could reject valid localized/spaced Windows printer names (e.g. `Microsoft Print to PDF`, `POS-80 (Copy 1)`); mitigation: block only ASCII control characters `[\x00-\x1f\x7f]` and enforce max length `256`.
- **Dependencies:** Stage D1 (`serverPort` lifecycle & `mainWindow` tracking).
- **Rollback Procedure:** Restore `electron/main.cjs` and `electron/preload.cjs` from pre-D2 backup; remove `electron/security.cjs`.
- **Required Tests:** D6 tests #5, #10 + `phase10.qa.final.test.ts` + `phase12.release.acceptance.test.ts`.
- **Acceptance Criteria:** Untrusted IPC senders/frames and malformed print options rejected; valid printer discovery & silent print options pass cleanly.

### Stage D3: Navigation and Popup Restrictions
- **Files Affected:** `electron/main.cjs` (using `isAllowedAppOrigin` from `electron/security.cjs`)
- **Exact Proposed Changes:**
  - In `createMainWindow` (`electron/main.cjs:229-252`):
    - Add `mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))`.
    - Add `mainWindow.webContents.on('will-navigate', ...)` and `mainWindow.webContents.on('will-redirect', ...)` calling `event.preventDefault()` whenever `!isAllowedAppOrigin(navigationUrl, serverPort)`.
  - Attach `app.on('web-contents-created', (_event, contents) => { ... })` as process-wide defense-in-depth denying unexpected `setWindowOpenHandler` / off-origin `will-navigate`.
- **Risks:** None for current POS UI (zero popups or external links exist).
- **Dependencies:** Stage D2 (`isAllowedAppOrigin` helper).
- **Rollback Procedure:** Restore `electron/main.cjs` from pre-D3 backup.
- **Required Tests:** D6 tests #3, #6, #7.
- **Acceptance Criteria:** Any `window.open`, external URL, `file://`, `javascript:`, or foreign-port navigation is blocked while same-origin POS routes work normally.

### Stage D4: CSP and CORS Hardening
- **Files Affected:** `server.ts`, `electron/main.cjs`, `electron/security.cjs`
- **Exact Proposed Changes:**
  - In `server.ts:75`, replace `app.use(cors());` with an environment-aware origin validator (Desktop: only `http://127.0.0.1:${PORT}`; Web Prod: `CORS_ALLOWED_ORIGINS` or same-host origin; Dev: local loopback; no-Origin requests permitted for same-origin/health/tests).
  - In `electron/main.cjs`, attach `session.defaultSession.webRequest.onHeadersReceived` scoped to `http://127.0.0.1:${serverPort}/*` adding the production `Content-Security-Policy` header (`buildDesktopCsp(serverPort)` with `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `connect-src 'self' http://127.0.0.1:${serverPort}`, `worker-src 'self'`, `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, `font-src 'self' https://fonts.gstatic.com data:`).
- **Risks:** Blocking Vite dev inline preamble if strict CSP were applied in `!isProduction` (mitigated by scoping `onHeadersReceived` CSP to Electron desktop / production mode only).
- **Dependencies:** Stages D1–D3 (`electron/security.cjs` and `serverPort`).
- **Rollback Procedure:** Restore `server.ts:75` (`app.use(cors());`) and remove `onHeadersReceived` CSP injection from `electron/main.cjs`.
- **Required Tests:** D6 tests #2, #8, #12, #13.
- **Acceptance Criteria:** Cross-origin API calls from untrusted origins receive no `Access-Control-Allow-Origin`; CSP header present with zero console violations in Electron production build.

### Stage D5: Printing and Local Server Compatibility
- **Files Affected:** `electron/main.cjs`, `src/services/printerService.ts` (optional small check on `elecRes.failureReason` mapping at line 565 if helpful), optionally `index.html` (only if user selects zero-external-domain offline fonts)
- **Exact Proposed Changes:**
  - Verify `style-src` permits `@page` dynamic `<style id="thermal-page-style">` (`printerService.ts:200-211`) and `connect-src` permits `POST /api/printer/spool` on `http://127.0.0.1:${serverPort}`.
  - Apply chosen Web Serial (`USB`) permission handling in `electron/main.cjs` (`setPermissionCheckHandler` / `select-serial-port` if allowed for `127.0.0.1:${serverPort}`, or explicit deny).
  - Ensure `waitForServerHealth` (`electron/main.cjs:70`) and `stopLocalPosServer` (`lines 147-184`) are unaffected by D3/D4 CORS and CSP changes.
  - Ensure `printerService.ts:565` surfaces `elecRes.failureReason` cleanly alongside `elecRes.error` if silent print returns an IPC validation failure.
- **Risks:** Minimal; all backend `WINDOWS_SPOOLER` and `NETWORK_IP` flows execute in Node child process (`server.cjs`), completely outside Chromium renderer CSP/sandbox.
- **Dependencies:** Stages D1–D4.
- **Rollback Procedure:** Restore touched lines in `electron/main.cjs` / `src/services/printerService.ts`.
- **Required Tests:** D6 tests #8, #9, #10, #11.
- **Acceptance Criteria:** All Phase 9 printing tests pass; printer discovery, `@page` receipt preview, silent print IPC, and spooler API behave identically to baseline.

### Stage D6: Regression and Security Verification
- **Files Affected:** New `src/__tests__/phase12d.electron.security.test.ts` (test code only; existing tests untouched)
- **Exact Proposed Changes:**
  - Write `src/__tests__/phase12d.electron.security.test.ts` covering all missing automated checks from Section 7 (navigation allowlist, popup/external URL denial, permission denial, IPC sender & `printSilent` validation, CORS rejection, CSP policy validation, `dist/index.html` inline-script absence).
  - Execute `npm run lint` (`tsc --noEmit`), `npm run build:desktop` (`vite build` + `esbuild server.ts`), and `npm run test` (full Vitest suite).
  - Provide a Windows x64 runtime smoke-test checklist (`F12` Cash Register hotkey, DevTools blocked in packaged `.exe`, thermal printing).
- **Risks:** Importing CJS helpers from Vitest ESM environment requires importing from `electron/security.cjs` cleanly without triggering Electron main `app` side effects.
- **Dependencies:** Stages D1–D5.
- **Rollback Procedure:** Remove `src/__tests__/phase12d.electron.security.test.ts` if reverting Phase 12-D.
- **Required Tests:** Full Vitest suite (`22` files), `npm run lint`, `npm run build:desktop`.
- **Acceptance Criteria:** 100% passing tests, zero TypeScript errors, clean desktop bundle ready for Windows CI packaging.

---

## 9. Rollback Strategy & Remaining Blockers

- **Rollback Strategy:** All Phase 12-D changes touch only the desktop wrapper/HTTP security boundary (`electron/main.cjs`, `electron/preload.cjs`, `electron/security.cjs`, `server.ts:75`, and a new test file). Database schema, migrations, SQLite WAL lifecycle, `.jwt_secret` handling, authentication, and POS business logic remain untouched. Timestamped file backups before each stage (`D1`–`D6`) allow immediate single-stage rollback.
- **Remaining Technical Blockers:** **None.**
- **Two Minor Policy Confirmations Requested Before Starting Stage D1 (Safe Defaults Ready):**
  1. **Web Serial (`USB` button in `ReceiptPrint.tsx:305`):** Default recommendation is to deny `serial` permission in Electron desktop (since Windows thermal printers use `WINDOWS_SPOOLER` / `BROWSER` / `NETWORK_IP`), unless you explicitly rely on Chrome Web Serial on Windows POS terminals (in which case `serial` can be scoped strictly to `http://127.0.0.1:${serverPort}`).
  2. **Google Fonts (`index.html:16-18`):** Default recommendation is to keep `https://fonts.googleapis.com` and `https://fonts.gstatic.com` allowlisted in CSP (with graceful offline fallback), or optionally drop them in D5 for a zero-external-origin CSP.

---

**Final Decision:** **A. READY FOR USER APPROVAL**  
*Strict Audit Only: No application code modified. Stopped and awaiting explicit user approval before Stage D1.*
