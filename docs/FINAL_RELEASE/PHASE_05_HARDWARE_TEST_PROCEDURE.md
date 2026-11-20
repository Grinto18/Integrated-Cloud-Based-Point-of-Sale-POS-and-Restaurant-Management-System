# GOLDEN PALACE POS — PHASE 5 HARDWARE TEST PROCEDURE
## Repeatable Field & Lab Verification Runbook (Windows 7 SP1 / 10 / 11 x64 & Physical 80mm / 58mm / LAN Thermal Printers)

- **Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)
- **Scope:** Scope 2 (Windows Compatibility Preparation) & Scope 3 (Physical Thermal Printer Preparation)
- **Runtime Policy:** Electron `22.3.27` pinned (Windows 7 SP1 x64 compatible), SQLite Schema Version `4` (`LATEST_SCHEMA_VERSION = 4`)
- **Rule of Evidence:** Never record **`PASS`** for any physical OS or printer test until executed on actual hardware and physical receipt output is visually verified.

---

## PART A — Pre-Test Verification (Required Before Every Host/Printer Session)

1. Obtain `GoldenPalacePOS-Setup-x64.exe`, `GoldenPalacePOS-Setup-x64.exe.sha256`, and `GoldenPalacePOS-Setup-x64.build-manifest.json` from the verified Gate G1 Windows CI run.
2. On the test Windows host, verify the installer checksum in PowerShell:
   ```powershell
   Get-FileHash .\GoldenPalacePOS-Setup-x64.exe -Algorithm SHA256
   Get-Content .\GoldenPalacePOS-Setup-x64.exe.sha256
   ```
   - **STOP** immediately if the hashes do not match byte-for-byte.
3. Confirm this machine is an **isolated test PC or VM** and does **NOT** contain the restaurant's live production database.
4. For **Windows 7 SP1 x64** only, verify prerequisites before installation:
   - Service Pack 1 installed (`winver`).
   - `KB2999226` (Universal C Runtime) and `KB4474419` (SHA-2) installed.
   - `Microsoft Visual C++ 2015–2022 Redistributable (x64)` installed.

---

## PART B — Repeatable Windows Compatibility Procedure (Execute Separately on Win 7 SP1 x64, Win 10 x64, Win 11 x64)

Record **OS Build, Host/VM ID, Date, Tester Name, and Installer SHA-256** on each execution sheet.

### Step B1 — Clean Installation & Shortcuts
1. Run `GoldenPalacePOS-Setup-x64.exe`.
2. Choose custom or default install directory; verify Desktop and Start Menu shortcuts are created with the official Gold/Charcoal icon.
3. Verify `%APPDATA%\Golden Palace POS\` does not contain any pre-seeded demo database before launch.

### Step B2 — First Launch, Desktop Security & Database Initialization
1. Launch **GOLDEN PALACE POS** from the Desktop shortcut.
2. Verify application opens cleanly without DLL/ABI errors, console windows, or DevTools (`F12` / `Ctrl+Shift+I` must remain blocked; application menu bar hidden).
3. Verify `%APPDATA%\Golden Palace POS\golden_palace_production.db`, `backups_production\`, and `.jwt_secret` are created automatically.
4. Complete the First-Run Admin Setup (strong password + PIN); verify zero demo products/orders exist.

### Step B3 — Offline Cashier Operations & Persistence Across Restart
1. **Physically disconnect Ethernet and disable Wi-Fi.**
2. Import or create bilingual Arabic/French menu items (including prices in `DZD / DA`).
3. Open a cash shift, create at least 2 orders (including discount/split payment), settle payments, and inspect receipt totals.
4. Close the app cleanly (`Alt+F4` or Window Close); verify a `SHUTDOWN` backup appears in `%APPDATA%\Golden Palace POS\backups_production\` with `status: VERIFIED` and a 64-character `sha256` in `backup_manifest.json`.
5. Relaunch the app (still offline); verify login/session, orders, payments, and shift totals remain 100% intact.

### Step B4 — Backup Integrity, Tamper Rejection & Restore Validation
1. Create a manual backup in **Settings → Backup**; confirm `VERIFIED`.
2. Record a new test order (`POST-BACKUP-ORDER`), then test **Restore** from the verified manual backup; verify app restores cleanly and restarts/reloads with exact snapshot data and a `PRE_RESTORE` safety backup created.
3. Copy a backup file to a temporary test filename in `backups_production\`, alter 1 byte, and attempt verification/restore -> confirm rejection (`CORRUPTED` / `sha256_mismatch`) with zero impact on live DB.

### Step B5 — In-Place Upgrade & Non-Destructive Uninstallation
1. Close any open cash shift and quit the application.
2. Re-run `GoldenPalacePOS-Setup-x64.exe` over the existing installation; relaunch and verify all orders, menu items, users, and backups remain untouched.
3. Run the Windows Uninstaller via Control Panel / Settings → Apps; verify `%APPDATA%\Golden Palace POS\golden_palace_production.db` and `backups_production\` remain **100% intact** (`deleteAppDataOnUninstall: false`).

---

## PART C — Controlled Physical Thermal Printer Test Procedure

> **CRITICAL HONESTY RULE:** Never mark any step **`PASS`** based on UI toast or `SPOOLED` status alone. Physically inspect each printed paper receipt and retain photos/scans with test IDs.

Execute this procedure **separately for each physical printer model** across:
- **Bench P1:** 80mm Thermal Printer via **USB** (`48 columns`)
- **Bench P2:** 80mm Thermal Printer via **Windows Spooler** (shared local printer `\\localhost\<PrinterName>`)
- **Bench P3:** 58mm Thermal Printer via **USB** (`32 columns`)
- **Bench P4:** 58mm Thermal Printer via **Windows Spooler**
- **Bench P5:** Thermal Printer via **LAN TCP 9100** *(only if supported by physical printer hardware)*

### Printer Verification Steps (Repeat per Bench P1–P5)
1. **Discovery & Profile Configuration:**
   - Open **Settings → Printer**; verify the real Windows printer is listed accurately (and no fake Bluetooth mode is shown).
   - Select exact transport (`USB`, `WINDOWS_SPOOLER`, or `NETWORK_IP`), exact paper width (`80mm` or `58mm`), and codepage (`CP864` / `WINDOWS_1256` / `UTF8`).
2. **Diagnostic Arabic/French & Feed-Cut Tests:**
   - Run **Arabic Test** and **Feed & Cut Test**.
   - Visually inspect physical paper:
     - Arabic connected letters (`القصر الذهبي`) legible with correct RTL shaping (no disconnected boxes/mojibake).
     - French text (`LE PALAIS D’OR`, accented characters) sharp and aligned.
     - Logo/header renders properly.
     - **58mm check:** Zero horizontal clipping on long item names or DZD totals.
     - **Auto-cutter check:** Paper cuts cleanly if supported by printer model.
3. **Honest Status Verification (`hardwareConfirmed: false` until confirmed):**
   - Complete a real cashier order and trigger print.
   - Verify job enters `SPOOLED` (`hardwareConfirmed: false`, `confirmed_at = NULL`) until operator explicitly confirms physical paper exit (`/confirm`).
4. **Offline Printer Failure -> Lossless Full-Payload Retry -> Restart Recovery:**
   - Physically unplug USB/LAN cable or power off printer.
   - Complete a paid cashier order and trigger print -> verify:
     - Order & payment remain saved **once** (no loss, no duplicate).
     - Print job records `FAILED` honestly.
     - Full binary payload exists at `%APPDATA%\Golden Palace POS\print_spool_payloads\job_<id>.bin`.
   - **Quit and relaunch the POS application** while printer is still offline -> verify the `FAILED` print job and `job_<id>.bin` survive restart.
   - Reconnect/power on the printer and click **Retry** -> visually inspect physical paper to confirm the **complete original receipt** (all items, totals, header, footer, cut — NOT truncated `payloadPreview`) prints cleanly.
5. **RBAC Manual Reprint (`DUPLICATA`):**
   - Verify Cashier/Admin manual reprint prints clearly labeled `DUPLICATA` copy and writes `REPRINT_RECEIPT` audit log.
   - Verify Kitchen role receives `403` when attempting manual reprint.

---

## PART D — Sign-Off Classification Key

Every line in the executed test sheets must be marked with exactly one status:
- **`PASS`** — Executed on target hardware/OS and physically verified with retained evidence.
- **`FAIL`** — Executed and failed pass criteria (attach error logs/photos and halt release).
- **`BLOCKED`** — Cannot execute due to missing prerequisite/hardware/environment access.
- **`PENDING`** — Scheduled for execution once prerequisite gate completes.
