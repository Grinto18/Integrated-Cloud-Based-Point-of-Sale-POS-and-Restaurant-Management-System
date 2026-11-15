# PHASE 11-C — CLOUD RUN SECURITY & DATABASE PERSISTENCE AUDIT

**Audit Timestamp:** `2026-11-15T12:30:40Z` (`2026-11-15 04:30:40 PST`)  
**Scope:** JWT Secret Management, Cloud Run SQLite Persistence & Concurrency, Electron Desktop Compatibility, and Database Protection Audit  
**Deployment / Release Action:** None (Audit & security hardening only — no production release packaged or deployed)

---

## FINAL DECISION

**`B. JWT fixed, but SQLite persistence remains a blocker.`**

> **Cloud Run Deployment Classification:** **NOT READY for real restaurant transactions.**  
> Cloud Run JWT secret enforcement is now strictly fail-fast and compatible with Google Secret Manager, and Electron Desktop local `.jwt_secret` + local SQLite persistence remains fully intact. However, Cloud Run still writes `golden_palace_production.db` to ephemeral container-local overlay storage (`overlay` on `/`), which does **not** survive instance replacement, redeployment, or multi-instance scaling and cannot safely coordinate WAL/SHM across Cloud Run instances.

---

## 1. JWT Implementation Findings

### Previous Vulnerability Identified & Remediated
- Previously (`server.ts` + `src/middleware/auth.ts`), calling `ensureServerRuntimeJwtSecret()` on server boot in `NODE_ENV=production` silently generated a per-container `.jwt_secret` inside the container filesystem whenever `JWT_SECRET` was unset, short, or known-insecure.
- In Cloud Run, silent per-container secret generation causes independent container instances or restarted revisions to mint incompatible JWT signing keys, silently invalidating active cashier/admin sessions and masking misconfigured deployments.

### Current Hardened Behavior (`src/middleware/auth.ts`, `server.ts`, `electron/main.cjs`, `.env.example`)
1. **Cloud Run / Web Production (`NODE_ENV=production` without `GOLDEN_PALACE_DESKTOP=1`):**
   - `ensureServerRuntimeJwtSecret()` delegates directly to strict `getJwtSecret()` validation and **never** generates or persists a per-container `.jwt_secret`.
   - `server.ts` exits fail-fast with exit code `1` and an explicit non-secret diagnostic (`CRITICAL SECURITY ERROR: JWT_SECRET ...`) if the configured secret is missing, `< 32` characters/bytes, has insufficient character diversity (`new Set(secret).size < 8`), or matches `KNOWN_INSECURE_SECRETS`.
   - Supports Google Secret Manager both via `process.env.JWT_SECRET` (Cloud Run secret environment injection) and `process.env.JWT_SECRET_FILE` (Cloud Run Secret Manager volume mount path).
   - Secret values are never logged (`redact.ts` + non-secret error text only).
   - `.env.example` placeholder replaced (`REPLACE_WITH_MIN_32_BYTE_CSPRNG_SECRET`) so no known-insecure sample secret is suggested.
2. **Electron Desktop (`GOLDEN_PALACE_DESKTOP=1`):**
   - `electron/main.cjs` (`getOrCreateDesktopJwtSecret(userDataDir)`) generates `crypto.randomBytes(48).toString('hex')` (96 hex chars / 48 cryptographically random bytes) on first run, stores it in `path.join(userDataDir, '.jwt_secret')` with `0o700` parent directory and `0o600` file permissions, and reuses the exact same file across restarts.
   - `ensureServerRuntimeJwtSecret()` preserves the same `appDataDir/.jwt_secret` behavior when `GOLDEN_PALACE_DESKTOP === '1'` without breaking Electron restarts.
   - Confirmed `electron/preload.cjs` and `desktop:get-info` IPC handler do **not** expose `jwtSecret` or `JWT_SECRET` to the renderer process (`contextIsolation: true`, `nodeIntegration: false`).

---

## 2. Cloud Run Secret Configuration Requirements

Before any non-desktop Cloud Run container can boot (`npm run start` / `tsx server.ts` with `NODE_ENV=production`):
1. Provision a cryptographically random secret (`>= 32` bytes, recommended `openssl rand -hex 48`) in **Google Secret Manager**.
2. Expose that secret to the Cloud Run service via either:
   - **Environment Variable:** `JWT_SECRET` bound to the Google Secret Manager secret version (`latest` or pinned version), **or**
   - **Mounted Secret Volume:** Mount the Secret Manager secret into the container and set `JWT_SECRET_FILE=/path/to/mounted/secret`.
3. Never use any value from `KNOWN_INSECURE_SECRETS` (e.g., `grine-restaurant-pos-super-secure-key`, `golden-palace-pos-super-secure-key-2026`, `changeme`, `secret`) or repeated low-entropy strings.
4. Keep the same Secret Manager secret consistent across all Cloud Run revisions and scaled instances so JWTs remain valid across instances.

---

## 3. SQLite Persistence & Concurrency Findings on Cloud Run

Verified storage topology on container (`df -Th /app/applet /root /root/.local /root/.local/share`) and `src/db/sqlitePath.ts` + `src/db/index.ts`:

| Audit Question | Finding | Risk Level |
|---|---|---|
| **Is `golden_palace_production.db` stored on ephemeral container storage?** | **Yes.** `getLocalDatabasePath()` resolves to `$HOME/.local/share/Golden Palace POS/golden_palace_production.db` (`/root/.local/share/...`), which sits on container-local `overlay` filesystem (`none overlay /`). | **CRITICAL BLOCKER** |
| **Does it survive instance replacement and redeployment?** | **No.** Confirmed empirically during this audit: the `golden_palace_production.db` created in `/root/.local/share/Golden Palace POS/` during the earlier container session was completely wiped upon container reset (`12:27 UTC`), leaving only `/app/applet` workspace files intact. Any orders, payments, shifts, inventory movements, or admin accounts written in Cloud Run will be permanently lost on container scale-to-zero, crash, or redeployment. | **CRITICAL BLOCKER** |
| **Can multiple Cloud Run instances access independent database copies?** | **Yes (Split-Brain Risk).** Scaling Cloud Run to `>= 2` instances creates completely isolated container-local `.db` files per instance. Writes on Instance A are invisible to Instance B (`orders`, `cash_shifts`, `payments`, `revoked_tokens`). | **CRITICAL BLOCKER** |
| **Are concurrent SQLite writes safe under Cloud Run topology?** | **Unsafe across instances; constrained to single instance.** Even if `max-instances=1` is forced, Cloud Run zero-downtime revision rollouts overlap old and new containers briefly, splitting writes during rollout. Furthermore, network mounts (Cloud Storage FUSE / NFS) are unsafe for SQLite WAL locking. | **HIGH BLOCKER** |
| **Do WAL and SHM files remain accessible to the same database instance?** | Only inside the lifetime of a **single local OS process/container** (`-wal` and `-shm` require local POSIX shared-memory `mmap` coherence). Across Cloud Run container replacements or horizontal instances, WAL/SHM state is lost or cannot be shared safely. | **CRITICAL BLOCKER** |

**Architectural Conclusion (No Schema/DB Changes Performed):**  
Cloud Run + container-local SQLite is strictly suitable only for ephemeral stateless testing/previews and is **NOT READY for real restaurant financial transactions**. Real restaurant production must either:
- Run on the **Electron Windows Desktop** target (single local workstation + persistent `%APPDATA%\Golden Palace POS\golden_palace_production.db` + `backups_production/`), **or**
- Receive explicit approval in a future phase to migrate Cloud Run server persistence to a managed transactional RDBMS (e.g., Cloud SQL PostgreSQL) while keeping Electron offline-first SQLite intact.

---

## 4. Electron Compatibility Verification

- **Offline-First SQLite (`golden_palace_production.db`):** Preserved untouched in `%APPDATA%\Golden Palace POS\` (`app.getPath('userData')`), with `backups_production/` isolated from development `golden_palace.db` (`electron/main.cjs`, `src/db/sqlitePath.ts`).
- **WAL / SHM Safety on Desktop:** Safe on single-host local NTFS/POSIX storage with `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`, and `wal_checkpoint(TRUNCATE)` shutdown backup on exit (`server.ts`, `src/services/backupService.ts`).
- **Local JWT Secret Persistence:** Verified `getOrCreateDesktopJwtSecret(userDataDir)` generates a 48-byte CSPRNG secret (`96` hex chars), enforces `0o700` dir and `0o600` file permissions on creation and reuse, persists across Electron restarts, and passes `JWT_SECRET` exclusively to the local forked Node backend over process `env` (zero renderer exposure).

---

## 5. Database Protection & Test Results

### Database Protection (Task 4 — Strictly Read-Only Audit)
- Zero migrations, seeds, resets, or write operations were executed against any non-temp database during Phase 11-C.
- **Container Filesystem Read-Only Check (`/root/.local/share/Golden Palace POS/`):**
  - Active dev DB present from container boot (`12:27:36Z`): `golden_palace.db` (`4,096` bytes + `2,068,272` WAL + `32,768` SHM, permissions `0600`, `PRAGMA integrity_check = ok`, `28` tables, `6` users, `0` orders).
  - Automatic dev `backups/` verified: `gp_pos_daily_...db` and `gp_pos_weekly_...db` (`221,184` bytes each, `0600`, `status: VERIFIED`, `integrityCheck: ok`).
  - As documented in Section 3, Phase 11-B's `golden_palace_production.db` in `/root/.local/share/Golden Palace POS/` was wiped by the `12:27 UTC` container reset — proving Cloud Run container disk ephemerality firsthand without touching or re-creating it.
- **Backup & Restore Functional Verification:** Executed cleanly inside isolated `os.tmpdir()` test suites (`phase11b.production.init.test.ts`, `phase10.qa.final.test.ts`, `phase7` suites).

### Verification Commands & Outcomes

| Check | Outcome | Exact Output / Details |
|---|---|---|
| `npx vitest run src/__tests__/auth.hardening.backend.test.ts --no-color` | **PASS (`exit 0`)** | **1/1 file, 12/12 tests passed** (`17.96s`) — verified Cloud Run fail-fast (`missing`, `short`, `low-entropy`, `insecure`, subprocess `exitCode=1`, independent container non-generation, `JWT_SECRET` + `JWT_SECRET_FILE`), Electron `.jwt_secret` `0600` restart persistence, and non-exposure in preload/IPC |
| `npm test -- --no-color` | **PASS (`exit 0`)** | **20/20 test files passed, 120/120 tests passed** (`63.81s`) across isolated temp databases |
| Live Cloud Run Startup Test (missing `JWT_SECRET`, isolated `/tmp` DB) | **FAIL-FAST PASS (`exit 1`)** | Exited `1` cleanly before listening with `CRITICAL SECURITY ERROR` and Cloud Run / Secret Manager guidance; wrote zero `.jwt_secret` files |
| Live Cloud Run Startup Test (valid 59-char `JWT_SECRET`, isolated `/tmp` DB) | **PASS (`200 OK`)** | `GET /api/health` returned `{"status":"ok",...,"desktopMode":false}` cleanly |
| `npm run build:desktop` (`vite build` + `esbuild`) | **PASS (`exit 0`)** | `dist/` (`1,692` modules) and `dist-electron/server.cjs` (`2.4mb`) built cleanly |
| `compile_applet` & `lint_applet` (`tsc --noEmit`) | **PASS (`exit 0`)** | Build succeeded and zero TypeScript errors |

---

## 6. Remaining Deployment Blockers

1. **Cloud Run Ephemeral SQLite Storage (Architectural Blocker):** Cloud Run currently stores `golden_palace_production.db` on non-persistent container `overlay` storage, risking total data loss on container replacement, crash, or scale-to-zero and split-brain divergence across instances. Do **not** direct live restaurant financial traffic to Cloud Run under container-local SQLite.
2. **Cloud Run Multi-Instance SQLite Locking Incompatibility:** SQLite WAL/SHM cannot lock safely across multiple Cloud Run container instances.
3. **Production Secret Provisioning Prerequisite:** Any Cloud Run environment must explicitly configure `JWT_SECRET` or `JWT_SECRET_FILE` via Google Secret Manager before deployment, or startup will intentionally abort with exit code `1`.
4. **Windows Target Hardware & Packaging Checks (`NOT TESTED` in Linux container):** Final Windows x64 NSIS `.exe` packaging (`npm run pack:win`) and physical 58mm/80mm ESC/POS thermal printer verification still require execution on a Windows host prior to physical restaurant workstation rollout.
