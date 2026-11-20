# GOLDEN PALACE POS — PHASE 5 HARDWARE GATE CLOSURE PLAN
## Controlled External Validation Plan (Windows CI, Windows 7/10/11 Hosts & Physical Thermal Printers)

- **Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)
- **Authorization Scope:** External Validation Preparation Only (Phase 5 Hardware Gate Closure)
- **Current Software Baseline:** `PARTIALLY VERIFIED` (`28/28` test files, `175/175` tests PASS, `tsc --noEmit` `0` errors)
- **Pinned Runtime Policy:** Electron `22.3.27` (Chromium `108` / Node `16.17.1` / ABI `110`), `better-sqlite3@11.10.0`, SQLite Schema Version `4` (`LATEST_SCHEMA_VERSION = 4`)

---

## 1. Gate Closure Sequence & Ownership

| Gate | Objective | Required Execution Environment | Owner / Operator | Blocking Dependency |
|---|---|---|---|---|
| **Gate G1 — Windows x64 CI Build** | Build genuine `GoldenPalacePOS-Setup-x64.exe` with native Windows MSVC C++20 `better-sqlite3` (ABI `110`), verify PE32+ (`0x8664`) headers, verify `app.asar.unpacked`, record installer & native SHA-256 | GitHub Actions `windows-latest` runner OR physical Windows x64 build workstation with Node 22 LTS + VS 2022 C++ Build Tools | Release Engineer / CI Runner | Must push repo to GitHub remote with Actions enabled or execute `scripts\build-windows-installer.ps1` locally on Windows x64 |
| **Gate G2 — Windows OS Compatibility** | Execute repeatable 11-step install/startup/DB/cashier/backup/restore/upgrade/uninstall/offline validation separately on **Windows 7 SP1 x64**, **Windows 10 x64**, and **Windows 11 x64** | 3 isolated Windows x64 hosts or clearly labeled clean-room Windows VMs (never production restaurant PC) | QA / Field Technician | Requires verified `GoldenPalacePOS-Setup-x64.exe` + `.sha256` from Gate G1 |
| **Gate G3 — Physical Thermal Printing** | Execute real paper receipt verification on actual **80mm USB**, **58mm USB**, **Windows Spooler**, and **LAN TCP 9100** (if supported) thermal printers, per model | Physical Windows host(s) attached to real 80mm & 58mm thermal printers | QA / Restaurant Owner | Requires verified Windows installation from Gate G2 and actual physical printers |
| **Gate G4 — Final Owner Release Sign-Off** | Consolidate CI checksums, signed Windows OS evidence, and photographed/inspected physical receipt proof into final release sign-off | Owner review | Restaurant Owner | Requires **PASS** on Gates G1, G2, and G3 |

---

## 2. Non-Negotiable Safeguards Preserved Throughout Gate Closure

1. **No Electron Major Upgrade:** Electron remains pinned at `22.3.27` to preserve Windows 7 SP1 x64 compatibility.
2. **No Database Schema Changes:** `LATEST_SCHEMA_VERSION = 4` (`src/db/migrationManager.ts`) and all Phase 1 conflict-detection, pre-migration backup, and rollback guards remain untouched.
3. **No Production Database Access:** All CI and hardware validation tests run exclusively on fresh clean-room profiles (`%APPDATA%\Golden Palace POS\` on isolated test machines) or `os.tmpdir()` databases — NEVER against the restaurant's live database.
4. **Backup & Print Integrity Preserved:** Streaming SHA-256 manifest enforcement (`sha256_mismatch`), `PRAGMA foreign_key_check`, bounded NTFS lock retry (`EPERM`/`EBUSY`/`EACCES`), honest `hardwareConfirmed: false` (`SPOOLED`) transport reporting, and lossless binary spool retention (`print_spool_payloads/job_<id>.bin` + HTTP `422` missing-payload protection) remain strictly enforced.
5. **Rollback Artifact Preservation:**
   - GitHub Actions uploads each build under a unique run-scoped artifact name (`GoldenPalacePOS-Setup-x64-run-<run_number>`, `retention-days: 90`) alongside `.sha256` and `.build-manifest.json`, preserving prior artifacts.
   - Local Windows builds via `scripts/build-windows-installer.ps1` automatically archive any previous `GoldenPalacePOS-Setup-x64.exe` into `release\rollback_<UTC_TIMESTAMP>\` with SHA-256 verification before overwriting.

---

## 3. Unsupported Environments & Legacy Runtime Security Limitations

### Explicitly Unsupported Environments
- **32-bit Windows (`x86` / `ia32`):** Unsupported (`electron-builder.yml` targets Windows `x64` PE32+ only).
- **Windows XP / Windows Vista / Windows 7 RTM (without SP1):** Unsupported.
- **Windows 7 SP1 x64 without prerequisites:** Requires `KB2999226` (Universal C Runtime), `KB4474419` (SHA-2), and Visual C++ 2015–2022 Redistributable (x64) to load native `better_sqlite3.node`.
- **Windows ARM64 native:** Not validated (x64 emulation only; unsupported unless explicitly tested).
- **Linux/macOS host fabrication of Windows `.exe`:** Prohibited (native `better-sqlite3@11.10.0` Electron ABI `110` Windows PE32+ binary must be compiled on Windows MSVC C++20).

### Legacy Electron `22.3.27` Security Limitations & Compensating Controls
- Electron `22.3.27` embeds end-of-life Chromium `108` and Node.js `16.17.1` (no upstream security patches).
- **Compensating Controls Active:** Strictly offline loopback-only operation (`127.0.0.1`), `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, `webviewTag: false`, deny-by-default permissions, `setWindowOpenHandler` popup blocking, `will-navigate`/`will-redirect` loopback locking, strict IPC sender/input validation, production DevTools/menu removal, and strict CSP (`frame-ancestors 'none'`).
- **Operational Requirement:** Dedicated offline POS workstation only — do not browse untrusted websites or open untrusted external files on Windows 7 POS terminals.

---

## 4. Gate Stop Conditions

Stop immediately and record **`FAIL`** if any of the following occur during external validation:
- `electron-rebuild` fails to produce a PE32+ `0x8664` `better_sqlite3.node` or SHA-256 differs between rebuilt and `app.asar.unpacked` copies.
- Packaged app fails to boot `dist-electron/server.cjs` under `ELECTRON_RUN_AS_NODE=1` on Windows 7 SP1, 10, or 11.
- Uninstaller deletes or modifies `%APPDATA%\Golden Palace POS\`.
- Any printer reports `hardwareConfirmed: true` without explicit physical confirmation, retries using truncated `payloadPreview`, clips 58mm text, or duplicates/loses a cashier order on print failure.
