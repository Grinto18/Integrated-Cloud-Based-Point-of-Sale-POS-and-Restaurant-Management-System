# PHASE 0 — REPOSITORY BASELINE AND INVENTORY
## GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)

**Audit Date (UTC):** 2026-11-20  
**Execution Mode:** Read-Only Repository Baseline & Inventory (Zero application source files modified)  
**Host Environment:** Linux container (`Linux 4.19.0-gvisor x86_64`), non-Git working directory (`.git` absent)  
**Project Root:** `/app/applet` (workspace root `/`)  
**Application Version (`package.json`):** `1.0.0` (package name: `react-example`)

---

## 1. Repository Structure

| Path | Role / Contents | Observed Footprint |
|---|---|---|
| `server.ts` | Express + SQLite backend entry point (`dev`: Vite middleware, `prod`: static `dist/`, graceful shutdown backup) | 8.0 KB |
| `src/` | Full-stack TypeScript source (`components/` [23], `context/` [3], `db/` [6 + 1 migration], `lib/` [1], `middleware/` [2], `server/` [1], `services/` [7], `utils/` [3], `__tests__/` [23]) | 1.7 MB |
| `electron/` | Desktop shell (`main.cjs`, `preload.cjs`, `ipcSecurity.cjs`) | 19 KB |
| `public/` | Static PWA/web assets (`icons/icon-512.svg`, `icons/icon-192.svg`, `favicon.ico`, `manifest.webmanifest`, `sw.js`) + unexpected AI Studio paste file (`public/assets/aistudio/Paste_November_20__2026_-_12_42PM_0ce16838`, 26 KB) | 36 KB |
| `data/official-menu/` | External official restaurant menu datasets (`golden_palace_official_menu.{json,csv,xlsx}` — 12 categories, 105 products, 20 pizza variants) | 53 KB |
| `scripts/` | Official menu generator (`generate-official-menu-files.mjs`) | 3.5 KB |
| `docs/` | 25 historical phase, security, QA, installation, backup, and menu-import reports | 187 KB |
| `backups/` | Two pre-edit Phase 12-D source snapshots (`phase12d1_*`, `phase12d2_*`) | 18 KB |
| `.github/workflows/` | Windows x64 Electron installer CI workflow (`build-windows.yml`) | 5.5 KB |
| `electron-builder.yml` | Electron Builder NSIS x64 packaging configuration | 876 B |
| `run_pos_windows7.bat` | Obsolete legacy Windows 7 batch launcher referencing `GRINE RESTAURANT POS` & PostgreSQL | 2.2 KB |
| `package.json`, `package-lock.json`, `bun.lock` | Manifest and dual lockfiles (npm + bun) | 538 KB |
| `node_modules/` | Installed packages (production subset `--omit=dev`: ~139.5 MB; full tree incl. Electron dev tools: ~734 MB) | 734 MB |
| `build/` | **MISSING** (`build/icon.png` and `build/icon.ico` absent on disk) | Absent |
| `dist/`, `dist-electron/`, `release/` | Not present on disk at audit start (regenerated on demand by build scripts) | Absent |

---

## 2. Architecture Diagram

```text
+-----------------------------------------------------------------------------------+
|                      WINDOWS DESKTOP SHELL (Electron 22.3.27)                     |
|  electron/main.cjs (Single-instance lock, BrowserWindow sandbox:true, IPC host)   |
|  electron/preload.cjs (contextBridge -> window.goldenPalaceDesktop)               |
|  electron/ipcSecurity.cjs (Origin/frame sender verification + arg sanitization)   |
+-----------------------------------------+-----------------------------------------+
                                          |
       BrowserWindow loads                | child_process.fork(ELECTRON_RUN_AS_NODE=1)
       http://127.0.0.1:<port>            | IPC { type: 'shutdown' } / SIGTERM
                                          v
+-----------------------------------------+-----------------------------------------+
|                  FRONTEND SPA (React 19 + TypeScript + Vite 8)                    |
|  src/App.tsx, PosContext, AuthContext, LanguageContext (Arabic RTL / French LTR)  |
|  Offline Queue: IndexedDB + localStorage fallback (src/services/offlineStorage)   |
|  Service Worker: public/sw.js | Print Client: src/services/printerService.ts      |
+-----------------------------------------+-----------------------------------------+
                                          | HTTP REST (/api/*) + Bearer JWT
                                          v
+-----------------------------------------+-----------------------------------------+
|                 LOCAL BACKEND SERVER (Express 4 + Drizzle ORM)                    |
|  server.ts -> src/server/api.ts (6,368 lines)                                     |
|  Auth: src/middleware/auth.ts (Local HS256 JWT + Firebase Admin RS256 optional)   |
|  Rate Limit: src/middleware/rateLimit.ts                                          |
|  Services: backupService, menuImportService, printQueueService, desktopLifecycle  |
+-----------------------------------------+-----------------------------------------+
                                          | better-sqlite3 (WAL, FK=ON, busy_timeout=5s)
                                          v
+-----------------------------------------+-----------------------------------------+
|                    LOCAL PERSISTENT STORAGE (%APPDATA% / XDG)                     |
|  Prod/Desktop DB:  %APPDATA%\Golden Palace POS\golden_palace_production.db        |
|  Prod Backups:     %APPDATA%\Golden Palace POS\backups_production\                |
|  Desktop Secret:   %APPDATA%\Golden Palace POS\.jwt_secret (0600 on POSIX)        |
|  Dev DB (non-prod): ~/.local/share/Golden Palace POS/golden_palace.db             |
+-----------------------------------------------------------------------------------+
```

---

## 3. Runtime Versions

| Component | Measured / Declared Version | Verification Evidence |
|---|---|---|
| Host OS | `Linux 4.19.0-gvisor x86_64` | `uname -a` |
| Node.js | `v22.23.2` | `node -v` |
| npm | `10.9.8` | `npm -v` |
| TypeScript | `7.0.2` (`^7.0.2`) | `node_modules/typescript/package.json` |
| Vite | `8.3.1` (`^8.3.0`) | `node_modules/vite/package.json` |
| React / ReactDOM | `19.3.0` (`^19.0.1`) | `node_modules/react/package.json` |
| Electron | `22.3.27` (`^22.3.27`) — **EOL upstream** | `node_modules/electron/package.json` |
| Electron Builder | `23.6.0` (`^23.6.0`) | `node_modules/electron-builder/package.json` |
| `@electron/rebuild` | `4.2.1` (`^4.2.1`) | `node_modules/@electron/rebuild/package.json` |
| `better-sqlite3` | `11.10.0` (exact pin) | `node_modules/better-sqlite3/package.json` |
| Vitest | `5.1.0` (`^5.1.0`) | `node_modules/vitest/package.json` |

---

## 4. Dependency Inventory

### 4.1 Production Runtime Dependencies (`dependencies` — 9 packages, ~139.5 MB with transitives)

| Package | Declared | Installed | Usage Status | Notes |
|---|---|---|---|---|
| `bcryptjs` | `^3.0.3` | `3.0.3` | Active (Auth password/PIN hashing) | Unpacked from ASAR in `electron-builder.yml` |
| `better-sqlite3` | `11.10.0` | `11.10.0` | Active (Core local SQLite driver) | Native C++ addon (`binding.gyp`), ABI-sensitive |
| `cors` | `^2.8.6` | `2.8.6` | Active (`server.ts:75`) | Currently permissive `cors()` wildcard (`*`) |
| `dotenv` | `^17.2.3` | `17.4.2` | Active (`server.ts:1`, `src/db/index.ts:1`) | Loads `.env` if present |
| `drizzle-orm` | `^0.45.3` | `0.45.3` | Active (SQLite ORM queries) | Used across `src/db/`, `src/server/api.ts`, services |
| `exceljs` | `^4.4.0` | `4.4.0` | Active (`src/services/menuImportService.ts`) | `.xlsx` menu parsing & official menu generation (~21 MB) |
| `express` | `^4.21.2` | `4.22.3` | Active (`server.ts`, `src/server/api.ts`) | Local HTTP API server |
| `firebase-admin` | `^14.5.0` | `14.5.0` | Active (`src/lib/firebase-admin.ts` -> `src/middleware/auth.ts`) | Optional RS256 Firebase token verification (~45 MB transitives); offline desktop POS uses local HS256 JWT |
| `jsonwebtoken` | `^9.0.3` | `9.0.3` | Active (`src/middleware/auth.ts`) | Local HS256 JWT signing & verification |

### 4.2 Development & Build Dependencies (`devDependencies` — 27 packages)

- **Frontend / Build Tools (bundled into `dist/` by Vite):** `react@19.3.0`, `react-dom@19.3.0`, `lucide-react@0.546.0`, `vite@8.3.1`, `@vitejs/plugin-react@6.1.1`, `@tailwindcss/vite@4.3.3`, `tailwindcss@4.3.3`, `esbuild@0.25.12`, `typescript@7.0.2`, `tsx@4.23.15`
- **Desktop Packaging (Windows Electron):** `electron@22.3.27`, `electron-builder@23.6.0`, `@electron/rebuild@4.2.1`
- **Testing:** `vitest@5.1.0`, `jsdom@31.0.1`, `supertest@7.3.2`, `@testing-library/react@16.3.3`, `@testing-library/jest-dom@7.0.1`
- **Type Definitions:** `@types/{bcryptjs,better-sqlite3,cors,express,jsonwebtoken,node,react,react-dom,supertest}`

### 4.3 Unused Dependencies & Lockfile Hygiene Findings
- **Zero unused runtime `dependencies`** remain after prior build-size cleanup (`@google/genai`, `firebase`, `motion`, `pg`, `drizzle-kit`, `autoprefixer` were already removed).
- **Dual lockfiles present:** Both `package-lock.json` (`323 KB`) and `bun.lock` (`212 KB`) exist in the repository root; CI uses `npm` (`package-lock.json`), while the workspace tool runner uses `bun` (`bun.lock`). They must stay synchronized or `bun.lock` must be documented as workspace-only.
- **Electron EOL risk:** `electron@22.3.27` is end-of-life upstream (Chromium 108 / Node 16 ABI 110). It was originally chosen for legacy Windows 7 SP1 compatibility, whereas the Master Execution Prompt targets **Windows 10/11 x64** and requires evaluating a currently supported stable Electron release in Phase 3 / Phase 11 (requiring explicit owner approval before upgrading dependencies with native ABI/compatibility risk).

---

## 5. Database Inventory

### 5.1 Schema Inventory (`src/db/schema.ts` & `src/db/index.ts`)
Total tables defined and verified across `schema.ts`, `ensureBaseSchema()`, and `initProductionDb.ts`: **29 tables**:
1. `users`
2. `categories`
3. `products`
4. `product_variants`
5. `product_addons`
6. `price_history`
7. `restaurant_tables`
8. `customers`
9. `orders`
10. `order_items`
11. `payments`
12. `cash_shifts`
13. `cash_movements`
14. `suppliers`
15. `ingredients`
16. `product_recipes`
17. `inventory_movements`
18. `waste_records`
19. `purchases`
20. `purchase_items`
21. `deliveries`
22. `expenses`
23. `audit_logs`
24. `restaurant_settings`
25. `print_jobs`
26. `revoked_tokens`
27. `sync_operations`
28. `sync_conflicts`
29. `menu_import_history`

### 5.2 Database Path & Initialization Paths
- **Path resolver (`src/db/sqlitePath.ts`):**
  - `SQLITE_DB_PATH` overrides all defaults.
  - Otherwise resolves platform app data dir (`%APPDATA%\Golden Palace POS` on Windows, `~/.local/share/Golden Palace POS` on Linux, `~/Library/Application Support/Golden Palace POS` on macOS).
  - Selects `golden_palace_production.db` when `GOLDEN_PALACE_DB_MODE === 'production'` OR `GOLDEN_PALACE_DESKTOP === '1'` OR `NODE_ENV === 'production'`; selects `golden_palace.db` otherwise.
  - Backup directory resolves to `<dbDir>/backups_production` when DB filename is `golden_palace_production.db`, else `<dbDir>/backups` (or `GOLDEN_PALACE_BACKUP_DIR`).
- **Electron desktop override (`electron/main.cjs:110-138`):**
  - Explicitly passes `SQLITE_DB_PATH = path.join(userDataDir, 'golden_palace_production.db')` and `GOLDEN_PALACE_BACKUP_DIR = path.join(userDataDir, 'backups_production')` where `app.setName('Golden Palace POS')` -> `%APPDATA%\Golden Palace POS\` on Windows.
- **SQLite PRAGMAs (`src/db/index.ts:25-30`):** `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`.
- **Database files observed on this container (read-only check):**
  - Zero `.db` / `.sqlite` files inside `/app/applet`.
  - One active development database at `/root/.local/share/Golden Palace POS/golden_palace.db` (`4,096 B` + `1.36 MB` WAL + `32 KB` SHM) created by the container dev server; **not touched**.
  - **No original production restaurant database exists in this container** (consistent with `docs/PHASE11A_ORIGINAL_DATABASE_RECOVERY_AUDIT.md`).

### 5.3 Database Safety Gaps Identified for Phase 1
1. **No explicit `schema_migrations` / `PRAGMA user_version` version tracking table:** `runSafeMigrations()` runs ad-hoc `ensureColumnExistsOn()` calls directly on module import (`src/db/index.ts:599`) with silent `catch {}` blocks (`lines 472-474, 542-544, 594-596`), masking migration errors instead of surfacing or rolling back cleanly.
2. **No automatic pre-migration backup before applying schema changes** to an existing populated database on startup.
3. **No multi-database detection / conflict stop guard:** If a restaurant PC contains both a historical `golden_palace.db` and `golden_palace_production.db` (or another `.db` candidate in `%APPDATA%\Golden Palace POS\`), startup silently opens `golden_palace_production.db` without warning or halting to ask the owner which file holds real restaurant data.
4. **No explicit startup `PRAGMA integrity_check` / `PRAGMA foreign_key_check` gate** in `src/db/index.ts` before serving requests (currently only audited asynchronously in `server.ts` after module-load migrations already ran).
5. **Legacy / duplicate seeders:** Both `src/db/seed.ts` (dev Golden Palace seeder) and `src/db/seedGrine.ts` (obsolete `GRINE RESTAURANT` menu resetter, still wired to an admin reset route in `src/server/api.ts`) remain in `src/db/`.

---

## 6. Existing Test Inventory & Live Baseline Execution

### 6.1 Commands Executed (2026-11-20)
1. `npm run lint` (`tsc --noEmit`) -> **PASS (exit 0, 0 errors)**
2. `npm test -- --no-color --reporter=verbose` -> **FAIL (exit 1): 22/23 test files passed, 142/143 tests passed, 1 test failed (`79.43s`)**

### 6.2 Complete Test Suite Inventory (23 Files, 143 Tests)

| # | Test File | Scope | Baseline Result |
|---|---|---|---|
| 1 | `src/__tests__/auth.backend.test.ts` | Backend auth, Firebase Admin RS256, PIN login, logout revocation, RBAC | PASS (15/15) |
| 2 | `src/__tests__/auth.frontend.test.tsx` | Frontend session restore, offline cache, 401 logout, PIN unlock | PASS (5/5) |
| 3 | `src/__tests__/auth.hardening.backend.test.ts` | Bcrypt PIN migration, JWT secret enforcement, rate limiting, Phase 12-C policy | PASS (14/14) |
| 4 | `src/__tests__/auth.hardening.frontend.test.tsx` | Pending-auth guard, KITCHEN RBAC, 429 UI, masked PINs, Phase 12-C empty login | PASS (5/5) |
| 5 | `src/__tests__/official.menu.import.test.ts` | Official CSV/XLSX/JSON menu import, rollback, add-ons, discounts, RBAC | PASS (14/14) |
| 6 | `src/__tests__/offline.sync.backend.test.ts` | Offline sync idempotency, crash recovery | PASS (5/5) |
| 7 | `src/__tests__/offline.sync.frontend.test.tsx` | Offline queue persistence, backoff, partial failure, split payment queue | PASS |
| 8 | `src/__tests__/phase5.critical.backend.test.ts` | Critical POS fixes, held orders, tax, non-destructive menu reset | PASS (9/9) |
| 9 | `src/__tests__/phase5.critical.frontend.test.tsx` | Held order resume, Quick Customer, price override RBAC, receipt TVA | PASS (3/3) |
| 10 | `src/__tests__/phase6.backoffice.backend.test.ts` | Legacy schema compat, Menu/Inventory CRUD, sole-admin guard, audit immutability | PASS (5/5) |
| 11 | `src/__tests__/phase6.backoffice.frontend.test.tsx` | Backoffice UI unification | PASS (6/6) |
| 12 | `src/__tests__/phase7.backup.backend.test.ts` | Online WAL backup, integrity verify, disk-space check, restore rollback, RBAC | PASS (10/10) |
| 13 | `src/__tests__/phase7.backup.frontend.test.tsx` | Backup UI, two-step restore modal, French LTR, RBAC | PASS (3/3) |
| 14 | `src/__tests__/phase8.sync.backend.test.ts` | Offline sync conflict detection & resolution | PASS (5/5) |
| 15 | `src/__tests__/phase8.sync.frontend.test.tsx` | Offline sync UI & idempotency key reuse | PASS (5/5) |
| 16 | `src/__tests__/phase9.printing.desktop.test.ts` | Print queue, ESC/POS, retry, Windows/network transport tests | PASS (6/6) |
| 17 | `src/__tests__/phase9.printing.frontend.test.tsx` | ReceiptPrint bilingual rendering, honest failure reporting, Settings printer tab | PASS (3/3) |
| 18 | `src/__tests__/phase10.qa.final.test.ts` | Financial integrity, security audit, Electron/preload isolation | PASS (5/5) |
| 19 | `src/__tests__/phase11b.production.init.test.ts` | Fresh production DB path separation, zero demo rows, first-admin setup | PASS (4/4) |
| 20 | `src/__tests__/phase12d2.ipc.security.test.ts` | Stage D2 IPC sender validation, printSilent sanitization, sandboxed preload | PASS |
| 21 | `src/__tests__/pos.phase3.backend.test.ts` | Tables, orders, shifts, payments, kitchen READY sync | PASS (4/4) |
| 22 | `src/__tests__/pos.phase3.frontend.test.tsx` | RTL/LTR toggle, cashier cart, PaymentModal, offline queuing | PASS (5/5) |
| 23 | `src/__tests__/phase12.release.acceptance.test.ts` | Packaging, Electron config, icons, fresh install lifecycle, ESC/POS | **FAIL (2/3 passed; Test 1 FAILED at line 82: `build/icon.png` missing)** |

---

## 7. Existing Build Scripts (`package.json`)

| Script | Command | Purpose |
|---|---|---|
| `dev` | `tsx server.ts` | Development server with Vite middleware |
| `start` | `node server.ts` | Production Node 22 native TS server (serves built `dist/`) |
| `build` | `vite build` | Production frontend SPA bundle (`dist/`, `sourcemap: false`) |
| `build:server` | `esbuild server.ts --bundle --platform=node --format=cjs --outfile=dist-electron/server.cjs --external:better-sqlite3 --external:electron --external:bcryptjs --external:firebase-admin --external:vite` | Bundled CJS backend for Electron packaging |
| `build:desktop` | `npm run build && npm run build:server` | Builds both frontend and desktop server bundle |
| `rebuild:electron` | `electron-rebuild -f -w better-sqlite3 -v 22.3.27` | Rebuilds `better-sqlite3` against Electron 22.3.27 ABI 110 |
| `pack:win` | `npm run build:desktop && electron-builder --win --x64 --publish never` | Generates Windows x64 NSIS installer |
| `clean` | `rm -rf dist dist-electron release server.js` | Cleans build artifacts |
| `lint` | `tsc --noEmit` | TypeScript strict type checking |
| `test` | `vitest run` | Runs all 23 Vitest test suites |

---

## 8. Existing Windows Packaging & Electron Lifecycle Configuration

- **`electron-builder.yml`:**
  - `appId: com.goldenpalace.pos`, `productName: GOLDEN PALACE POS`
  - `directories`: `output: release`, `buildResources: build`
  - `files`: `dist/**/*`, `dist-electron/**/*`, `electron/**/*`, `package.json`
  - `asarUnpack`: `better-sqlite3`, `bindings`, `file-uri-to-path`, `bcryptjs`
  - `win`: `nsis` (`x64`), `icon: build/icon.ico`, `artifactName: GOLDEN-PALACE-POS-Setup-${version}-${arch}.${ext}`
  - `nsis`: `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`, `deleteAppDataOnUninstall: false`, desktop & start menu shortcuts enabled, `installerIcon`/`uninstallerIcon: build/icon.ico`.
- **`.github/workflows/build-windows.yml`:**
  - Runs on `windows-latest` with Node 22 x64, runs `npm install --legacy-peer-deps`, `npm test`, `npm run lint`, `npm run build:desktop`, `electron-rebuild -f -w better-sqlite3 -v 22.3.27 --arch x64`, PE32+ (`0x8664`) binary verification, `electron-builder --win --x64 --publish never -c.npmRebuild=false`, installer & unpacked native addon verification, SHA-256 generation, and artifact upload.
- **Electron Lifecycle (`electron/main.cjs`):**
  - Enforces single-instance lock (`app.requestSingleInstanceLock()`).
  - Generates/reuses persistent `0o600` `.jwt_secret` in `userData`.
  - Picks `127.0.0.1:3456` (or ephemeral loopback port), forks `dist-electron/server.cjs` with `ELECTRON_RUN_AS_NODE=1`, polls `/api/health` (20s timeout).
  - Creates `BrowserWindow` with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false` (Phase 12-D.1).
  - Enforces IPC sender/origin validation & strict input sanitization across all 3 channels (`desktop:get-printers`, `desktop:print-silent`, `desktop:get-info`) via `electron/ipcSecurity.cjs` (Phase 12-D.2).
  - Graceful shutdown (`before-quit`) sends IPC `{ type: 'shutdown' }` (triggering SQLite shutdown backup + WAL checkpoint + close in `server.ts`), with `8500ms` SIGKILL fallback.

---

## 9. Known Defects & Unfinished Hardening Items (Verified from Live Code)

| ID | Severity | Area | Evidence (`file:line`) | Impact |
|---|---|---|---|---|
| **DEF-01** | **P0 (Blocker)** | Packaging Assets | `build/` directory missing; `phase12.release.acceptance.test.ts:80-87` fails | `electron-builder` cannot package NSIS installer (`build/icon.ico` missing) and acceptance test fails. |
| **DEF-02** | **P0 (Security)** | Electron Navigation & Popups | `electron/main.cjs:283-309` | Missing `setWindowOpenHandler`, `will-navigate`, `will-redirect`, `setPermissionRequestHandler`, `setPermissionCheckHandler`, and packaged `devTools: false` / `Menu.setApplicationMenu(null)` (Stages D3–D4 of Phase 12-D not yet implemented). |
| **DEF-03** | **P0 (Security)** | HTTP Security (CORS & CSP) | `server.ts:75`, `index.html:1-34` | `app.use(cors())` allows wildcard `*` cross-origin access to local POS API; no `Content-Security-Policy` or security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) are set. |
| **DEF-04** | **P0 (DB Safety)** | Database Migrations & Multi-DB Guard | `src/db/index.ts:459-603` | No schema version ledger (`schema_migrations` / `PRAGMA user_version`), silent `catch {}` in `ensureColumnExistsOn`, no pre-migration backup on existing populated DB, and no multi-DB candidate conflict detection (`golden_palace.db` vs `golden_palace_production.db`). |
| **DEF-05** | **P1 (Printing Honesty)** | Print Job Status Model | `src/services/printQueueService.ts:170-176, 451-460` | TCP write sets `hardwareConfirmed: true`, and `createAndProcessPrintJob` marks status `'PRINTED'` even for Windows Spooler acceptance (`hardwareConfirmed: false`). Does not distinguish `QUEUED` / `SUBMITTED` / `PRINTED` / `FAILED` / `RETRYING` as required in Phase 9. |
| **DEF-06** | **P1 (Packaging Hygiene)** | Dev/Prompt Asset in `public/` | `public/assets/aistudio/Paste_November_20__2026_-_12_42PM_0ce16838` (26 KB) | Vite copies everything in `public/` directly into production `dist/`. Must be excluded or removed before release packaging. |
| **DEF-07** | **P1 (Runtime EOL)** | Electron Version | `package.json`: `electron@^22.3.27` | Electron 22 is EOL upstream. Target is Windows 10/11 x64; must evaluate supported Electron LTS upgrade path (requires owner approval due to native ABI & dependency risk). |
| **DEF-08** | **P2 (Legacy Code)** | Obsolete Artifacts & Naming | `run_pos_windows7.bat`, `src/db/seedGrine.ts`, `package.json` `name: "react-example"`, `backups/phase12d*` | Legacy `GRINE RESTAURANT` launcher referencing PostgreSQL, legacy Grine seeder, generic npm package name, and historical edit backups in root `backups/`. |
| **DEF-09** | **P2 (Desktop Offline)** | External Fonts in `index.html` | `index.html:16-18` | References `https://fonts.googleapis.com` / `fonts.gstatic.com`; degrades gracefully offline, but must be accounted for cleanly in CSP / offline behavior. |
| **DEF-10** | **P2 (Desktop Runtime)** | `electron-builder` Runtime Deps Check | `package.json`, `electron/main.cjs` | `build:server` marks `better-sqlite3`, `bcryptjs`, `firebase-admin`, `electron`, `vite` external; `electron-builder` must include `dependencies` cleanly and `server.cjs` must never require `vite` when `NODE_ENV=production`. |

*(Code grep for `TODO|FIXME|HACK|XXX|PLACEHOLDER|MOCK|STUB` across `src/` [excluding `__tests__`], `electron/`, `server.ts`, and `scripts/` returned **0 matches**.)*

---

## 10. Historical Report Discrepancies

| Historical Report | Historical Claim | Actual Live Repository State (2026-11-20) |
|---|---|---|
| `docs/PHASE12C2_OFFICIAL_ICONS_GENERATION_VERIFICATION_REPORT.md` | Claims `build/icon.png` (42,778 B) & `build/icon.ico` (74,203 B) exist and `phase12.release.acceptance.test.ts` passes (126/126). | **Discrepancy:** `build/` directory is absent in the current workspace; `phase12.release.acceptance.test.ts:82` **FAILS** (`142/143` passed). |
| `docs/PHASE12D0_ELECTRON_SECURITY_PREIMPLEMENTATION_AUDIT.md` | Lists 7 security gaps across 6 stages (D1–D6); notes `sandbox: false` at D0. | **Partially superseded:** Stage D1 (`sandbox: true`, explicit `webPreferences`) and Stage D2 (`ipcSecurity.cjs`, preload validation) **are** implemented. Stages **D3–D6** (navigation/popup/permission blocks, CSP, CORS allowlist, packaged DevTools lock, Windows runtime verification) remain **unimplemented**. |
| `docs/PHASE12A_WINDOWS_BUILD_EXECUTION_REPORT.md` | Reports `GOLDEN-PALACE-POS-Setup-1.0.0-x64.exe` workflow ready; requires manual GitHub Actions execution. | **Still unexecuted:** No `.exe` installer artifact exists in this Linux container; no `.git` remote or `gh` CLI available here. |
| `docs/WINDOWS_COMPATIBILITY_REPORT.md` / `run_pos_windows7.bat` | References Electron 22 for Windows 7 SP1 & legacy Grine PostgreSQL batch script. | **Scope updated:** Master Execution Prompt establishes **Windows 10/11 x64** as the main target and explicitly forbids claiming Windows 7 support unless separately tested and justified. |
| `docs/OFFICIAL_MENU_BACKUP_REPORT.md` | Notes `GOLDEN_PALACE_POS_DATABASE_README.md` absent. | **Confirmed:** File does not exist in workspace. |

---

## 11. Release Blockers Summary

### Hard Release Blockers (Must Close Before Release Candidate)
1. **Missing official build icons (`build/icon.png`, `build/icon.ico`)** — blocks `phase12.release.acceptance.test.ts` and Windows NSIS packaging.
2. **Database safety hardening (Phase 1)** — schema versioning, pre-migration backup, explicit integrity/FK startup checks, multi-DB conflict detection & stop guard, and migration testing across legacy/corrupted/partially-migrated DB fixtures.
3. **Unfinished Electron & HTTP security hardening (Phase 3 / Stages D3–D4)** — `setWindowOpenHandler`, `will-navigate`/`will-redirect`, permission handlers, packaged DevTools/menu lockdown, strict CORS allowlist, and CSP/security headers.
4. **Honest print job status lifecycle (Phase 9)** — separate `QUEUED`/`SUBMITTED`/`PRINTED`/`FAILED`/`RETRYING` so Windows Spooler or raw TCP acceptance is never falsely reported as confirmed physical paper output.
5. **Windows x64 installer generation & real Windows 10/11 verification (Phase 11 / 14)** — cannot be natively compiled or interactively installed inside this Linux container; requires a Windows x64 runner/host (or GitHub Actions `windows-latest`) plus owner verification on target hardware.
6. **Electron 22 EOL evaluation (Phase 3 / 11)** — requires documented compatibility evaluation and explicit owner approval before any Electron / native module upgrade.
7. **Physical thermal printer verification (Phase 9 / 14)** — explicitly deferred until restaurant printer hardware is reconnected (must remain marked PENDING, never faked).

---

## 12. Phase 0 Gate Decision

- **Application source files modified in Phase 0:** `0` (strictly read-only audit).
- **Artifact created:** `docs/FINAL_RELEASE/PHASE_00_REPOSITORY_BASELINE.md`.
- **Safe to begin Phase 1 (Database Safety and Migration):** **YES** — baseline is fully documented, no production database exists in this container, and all Phase 1 work will run exclusively against isolated temporary SQLite databases.
