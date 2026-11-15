# GOLDEN PALACE POS — Physical Hardware & Windows Desktop Test Plan (Phase 09)

> **Environment Disclosure**: Automated CI/container verification runs inside Linux headless Node/jsdom without physical 58mm/80mm ESC/POS thermal printers, physical cash drawers, or Windows 10/11 OS hardware. Physical printer output, Windows Spooler drivers (`80Normal`, `XP-80C`, `Xprinter XP-58`), and `.exe` NSIS installation MUST be executed on real target POS hardware following this checklist before restaurant rollout.

---

## 1. Windows Desktop Installer & First Launch Checklist (Windows 10/11 x64)

| # | Test Scenario | Execution Steps | Expected Result | Status on Dev Container |
|---|---|---|---|---|
| 1.1 | Clean Install via NSIS | Run `GOLDEN-PALACE-POS-Setup-1.0.0-x64.exe` as standard Windows user | App installs, creates Desktop & Start Menu shortcuts, launches single instance | Not run (Linux host, no NSIS/Wine) |
| 1.2 | Storage Path Separation | Launch desktop app and open Settings → Backups | SQLite DB lives at `%APPDATA%\Golden Palace POS\golden_palace_production.db`; backups at `%APPDATA%\Golden Palace POS\backups_production`; `.jwt_secret` created in `%APPDATA%\Golden Palace POS` (`0600`) | Path resolution unit-tested; Windows host unverified |
| 1.3 | First Run Fresh Install | Start with empty `%APPDATA%\Golden Palace POS` | No default `1234` PIN user created; Login screen prompts first-run Admin creation (`POST /api/system/setup-admin`) | Tested via automated backend/frontend suite |
| 1.4 | Existing DB Upgrade | Place existing `golden_palace_production.db` into `%APPDATA%\Golden Palace POS`, launch app | Zero data loss across `orders`, `payments`, `users`, `ingredients`; non-destructive migrations run automatically | Tested via isolated DB upgrade simulation |
| 1.5 | Safe Pre-Update Check & Shutdown Backup | Click "فحص ما قبل التحديث" with open shift vs closed shift; close window via `Alt+F4` / X | Update check blocks when shift/order open (`409`); clean close triggers `runShutdownBackup()` before exit | Backend/lifecycle tested; Windows GUI window close unverified |

---

## 2. Physical Thermal Printer Checklist (58mm & 80mm)

### Test Matrix
1. **80mm Thermal Printer** (e.g. Xprinter XP-N160II / Epson TM-T20 / 80Normal driver):
   - **Windows Spooler (`WINDOWS_SPOOLER`)**:
     - [ ] Open Settings → Printer → Click "اكتشاف الطابعات" → Verify printer appears in Windows list.
     - [ ] Select printer, choose `80mm`, printable width `70mm`, encoding `CP864`.
     - [ ] Save to SQLite database → Restart app → Confirm settings persist.
     - [ ] Run **اختبار الطباعة**, **اختبار العربية (AR/FR)**, and **اختبار صفحة فارغة / قطع الورق**.
     - [ ] Verify **Receipt Alignment & Typography**: Arabic connected letters (`مشاوي`, `القصر الذهبي`, `لا لأ لإ لآ`) render RTL without broken/disconnected glyphs; French text (`Tacos Poulet`, `TVA`, `TOTAL`, `DZD`) reads LTR with zero left/right margin clipping.
     - [ ] Verify **Logo Printing**: Brand crest/logo (`GOLDEN PALACE` / header block) prints crisp and centered cleanly at receipt top without horizontal distortion or clipping.
     - [ ] Verify **Order Tickets & Cash Register Receipts**: Print kitchen preparation ticket (`KITCHEN`), full customer order receipt (`CASHIER`), and cash shift closing / cash register receipt (`Z-Report` / cash movement totals).
     - [ ] Verify auto-cut engages cleanly and cash drawer kick (`ESC p`) opens drawer if connected via RJ-11.

2. **58mm Thermal Printer** (e.g. Xprinter XP-58 / Rongta RP58):
   - [ ] Switch Settings → Printer → `58mm` (`48mm` printable width, 32-char line wrap).
   - [ ] Print Standard + Arabic test ticket + real Order Ticket + Cash Register Receipt.
   - [ ] Confirm prices, quantities, and logo header fit inside 48mm printable width without right/left truncation.

3. **Network LAN ESC/POS Printer (`NETWORK_IP`, TCP Port 9100)**:
   - [ ] Configure LAN printer IP (e.g., `192.168.1.200`) and port `9100`.
   - [ ] Print order receipt and cash register receipt; verify raw socket output & `print_jobs` status = `PRINTED`.

> **Simulated vs Physical Separation:** Automated Vitest suites validate ESC/POS byte generation (`buildArabicTestEscPos`, `encodeEscPosLine`, `58mm`/`80mm` column wrapping), print queue persistence, duplicate prevention, RBAC `403` reprint protection, and simulated TCP/spooler `FAILED` states in headless Linux. Physical ink-on-paper alignment, Windows Spooler drivers, and logo bitmap/raster clarity remain **NOT TESTED** until executed on target Windows POS hardware.

---

## 3. Edge Cases, Stress & Recovery Hardware Tests

1. **Long Order Receipt (30+ items + variants + addons + split payments)**:
   - Print via both `WINDOWS_SPOOLER` ESC/POS and `Browser / Electron`.
   - Confirm `@media print` and continuous thermal paper roll do not break mid-line or cut off footer totals.
2. **Duplicate Print Prevention & RBAC Reprint**:
   - Complete an order payment → Auto-print executes **once** (`job_key = orig_<order>_receipt`).
   - Attempt to trigger normal print again → System prevents duplicate original ticket.
   - Authorized Cashier/Admin clicks **"إعادة طباعة الوصل (DUPLICATA)"** → New receipt clearly prints `*** REPRINT / DUPLICATA *** / *** نسخة معاد طباعتها ***`.
   - Verify logged-in `KITCHEN` or `INVENTORY` user gets `403` when attempting cash receipt reprint.
3. **Printer Disconnected / Powered Off**:
   - Power off or unplug USB/LAN printer → Print an order.
   - Confirm UI shows `FAILED` with real error message (NEVER `PRINTED`).
   - Confirm `print_jobs` persists `FAILED` row in SQLite with error details.
   - Reconnect printer power → Open Settings → Printer → Print Queue → Click **"إعادة المحاولة (Retry)"** → Confirm physical receipt prints and job transitions to `PRINTED`.
4. **Sudden Power Loss & Reboot Recovery**:
   - During active shift, cut PC power or kill process (`taskkill /F /IM "GOLDEN PALACE POS.exe"`).
   - Reboot Windows, relaunch app → Verify SQLite WAL recovery preserves all committed orders/payments, `PRAGMA integrity_check = ok`, and pending `FAILED`/`PENDING` print jobs remain visible for manual retry.
