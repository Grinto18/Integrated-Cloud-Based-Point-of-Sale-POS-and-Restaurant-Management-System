# GOLDEN PALACE POS — PHASE 5C WINDOWS COMPATIBILITY REPORT
## Workstream 5C: Windows 7 SP1 x64, Windows 10 x64 & Windows 11 x64 Host Verification

- **Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)
- **Workstream:** Phase 5C
- **Overall Status:** **PENDING — ACTUAL PHYSICAL WINDOWS HOSTS OR VIRTUAL MACHINES REQUIRED**
- **Target Runtime:** Electron `22.3.27` (Chromium `108` / Node `16.17.1` / ABI `110`) + `better-sqlite3@11.10.0` (Windows PE32+ x64)

---

## 1. Honesty Declaration

This workspace operates in an isolated **Linux x86_64 (`4.19.0-gvisor`)** environment. No physical **Windows 7 SP1 x64**, **Windows 10 x64**, or **Windows 11 x64** host or virtual machine is accessible here. In strict compliance with Phase 5 rules:

- **Zero Windows OS host tests are claimed as passed.**
- All three operating system matrices below are marked **`PENDING`** until executed on clearly identified physical Windows hosts or Windows VMs using the compiled `GoldenPalacePOS-Setup-x64.exe` installer from Workstream 5B.

---

## 2. Host Verification Matrix — Windows 7 SP1 x64

- **Host Type:** `[ ] Physical PC   [ ] Virtual Machine`
- **Host / VM Identifier & Build:** `PENDING (Windows 7 SP1 x64 + KB4474419 / SHA-2 + VC++ 2015–2022 Redistributable x64)`
- **Installer SHA-256 Tested:** `PENDING`

| # | Test Area | Verification Criteria | Status | Observed Evidence |
|---|---|---|---|---|
| 1 | Installation & Shortcuts | `GoldenPalacePOS-Setup-x64.exe` installs cleanly, creates Desktop & Start Menu shortcuts with Gold/Charcoal icon | **PENDING** | — |
| 2 | Application Startup | Launches without DLL/ABI errors; single-instance lock works; DevTools/menu locked in packaged mode | **PENDING** | — |
| 3 | Database Initialization | Creates `%APPDATA%\Golden Palace POS\golden_palace_production.db` with zero demo data, WAL enabled, `user_version = 4` | **PENDING** | — |
| 4 | Login & Authentication | First-run Admin setup succeeds; username/password & PIN login work; `.jwt_secret` persists across restart | **PENDING** | — |
| 5 | Menu Loading | Official menu import & categories/products render properly in Arabic RTL & French LTR | **PENDING** | — |
| 6 | Cashier Operations | Shift open, order creation, discount/delivery/split payment, receipt generation, shift close | **PENDING** | — |
| 7 | Order Persistence | Orders, payments, and shift totals remain intact after full app quit & relaunch | **PENDING** | — |
| 8 | Application Restart & Upgrade | Re-running installer upgrades binaries without touching `%APPDATA%\Golden Palace POS\`; uninstall preserves user data | **PENDING** | — |
| 9 | Backup & Restore | Manual + Shutdown backup created in `backups_production\`, verified with SHA-256 & FK check, restored cleanly with NTFS lock retry | **PENDING** | — |
| 10 | Printer Discovery | Settings -> Printer lists actual installed Windows printers via Electron `getPrintersAsync()` & PowerShell/Spooler | **PENDING** | — |
| 11 | Offline Operation | Full cashier workflow executes with Ethernet/Wi-Fi physically disconnected | **PENDING** | — |

---

## 3. Host Verification Matrix — Windows 10 x64

- **Host Type:** `[ ] Physical PC   [ ] Virtual Machine`
- **Host / VM Identifier & Build:** `PENDING (Windows 10 x64 — 22H2 or LTSC)`
- **Installer SHA-256 Tested:** `PENDING`

| # | Test Area | Verification Criteria | Status | Observed Evidence |
|---|---|---|---|---|
| 1 | Installation & Shortcuts | Clean install + Desktop/Start Menu shortcuts + official icon | **PENDING** | — |
| 2 | Application Startup | Clean launch, loopback `127.0.0.1` server health `200`, zero console flash | **PENDING** | — |
| 3 | Database Initialization | `%APPDATA%\Golden Palace POS\golden_palace_production.db` isolated from install dir | **PENDING** | — |
| 4 | Login & Authentication | First-run admin setup, RBAC enforcement, PIN unlock | **PENDING** | — |
| 5 | Menu Loading | Arabic RTL & French LTR menu display and official import | **PENDING** | — |
| 6 | Cashier Operations | Complete order-to-payment-to-shift-close flow | **PENDING** | — |
| 7 | Order Persistence | Verified across app restart and Windows reboot | **PENDING** | — |
| 8 | Upgrade & Uninstall Safety | In-place upgrade + uninstall leaves `%APPDATA%\Golden Palace POS\` intact | **PENDING** | — |
| 9 | Backup & Restore | SHA-256 + FK verification, tamper rejection, safe restore & rollback | **PENDING** | — |
| 10 | Printer Discovery | Real Windows 10 printers detected accurately | **PENDING** | — |
| 11 | Offline Operation | 100% functional with network adapter disabled | **PENDING** | — |

---

## 4. Host Verification Matrix — Windows 11 x64

- **Host Type:** `[ ] Physical PC   [ ] Virtual Machine`
- **Host / VM Identifier & Build:** `PENDING (Windows 11 x64 — 23H2/24H2)`
- **Installer SHA-256 Tested:** `PENDING`

| # | Test Area | Verification Criteria | Status | Observed Evidence |
|---|---|---|---|---|
| 1 | Installation & Shortcuts | Clean install + SmartScreen note documented + Desktop/Start Menu shortcuts + icon | **PENDING** | — |
| 2 | Application Startup | Clean launch, loopback server healthy, DevTools disabled | **PENDING** | — |
| 3 | Database Initialization | `%APPDATA%\Golden Palace POS\golden_palace_production.db` created cleanly | **PENDING** | — |
| 4 | Login & Authentication | Admin setup, password & PIN login, session persistence | **PENDING** | — |
| 5 | Menu Loading | Arabic RTL & French LTR rendering and menu import | **PENDING** | — |
| 6 | Cashier Operations | Full cashier workflow with zero UI clipping at `1366×768` & `1920×1080` | **PENDING** | — |
| 7 | Order Persistence | Verified across app quit/restart and OS reboot | **PENDING** | — |
| 8 | Upgrade & Uninstall Safety | Upgrade preserves DB; uninstall preserves `%APPDATA%\Golden Palace POS\` | **PENDING** | — |
| 9 | Backup & Restore | Manual/shutdown backup, SHA-256 + FK validation, Windows Defender lock-retry restore | **PENDING** | — |
| 10 | Printer Discovery | Real Windows 11 printers detected accurately | **PENDING** | — |
| 11 | Offline Operation | 100% functional with network adapter disabled | **PENDING** | — |

---

## 5. Windows 7 SP1 x64 Pre-Flight Notes (Verified in Code)

- Electron pinned strictly to `22.3.27` (last branch supporting Windows 7 SP1 x64).
- `dist-electron/server.cjs` compiled with `--target=node16` and lazy `firebase-admin` short-circuit for offline desktop mode.
- Windows Spooler uses `execFile('cmd.exe', ['/d', '/c', 'copy', '/b', ...], { windowsHide: true })` (compatible with Windows 7/10/11).
- Restore file swap retries transient NTFS locks (`EPERM`/`EBUSY`/`EACCES`) up to 5 attempts before deterministic rollback.
- **Note for Windows 7 SP1 hosts:** Ensure Windows 7 SP1 has Microsoft Universal C Runtime (`KB2999226`), SHA-2 code-signing support (`KB4474419`), and Visual C++ 2015–2022 Redistributable (x64) installed prior to launching native `better_sqlite3.node`.
