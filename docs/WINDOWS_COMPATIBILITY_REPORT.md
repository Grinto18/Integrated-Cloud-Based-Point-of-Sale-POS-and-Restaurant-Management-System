# GOLDEN PALACE POS — Windows 11 & Windows 7 SP1 Compatibility Report

## 1. Runtime & Toolchain Baseline
- **Electron Version:** `22.3.27` (Chromium 108 / Node.js 16.x embedded runtime)
- **Packaging Tool:** `electron-builder` `23.6.0` targeting Windows `x64` (`NSIS` installer)
- **Native Database Module:** `better-sqlite3` `11.10.0` (rebuilt for Electron `22.3.27` x64 via `@electron/rebuild` on Windows runner)
- **Target Installer Artifact:** `release/GOLDEN-PALACE-POS-Setup-1.0.0-x64.exe`

## 2. Windows 11 (64-bit) Compatibility
- **Status:** Supported target platform (native `x64` NSIS installer).
- **Offline Operation:** Express backend (`dist-electron/server.cjs`) runs locally on `127.0.0.1` via Electron `ELECTRON_RUN_AS_NODE=1` with zero external internet requirement.
- **UTF-8 Arabic & Thermal Printing:** Web renderer displays Cairo/Tajawal/Segoe UI Arabic RTL and French LTR cleanly; ESC/POS thermal printing supports 80mm/58mm Windows Spooler (`CAFETERIA`), USB, and Network IP printers.
- **Data Storage:** SQLite database (`golden_palace_pos_production.db`) and backups reside in `%APPDATA%\GOLDEN PALACE POS\`, preserved across upgrades (`deleteAppDataOnUninstall: false`).

## 3. Windows 7 SP1 (64-bit) Compatibility & Honest Security Caveats
- **Why Electron 22.3.27 Is Retained:** Electron `22.3.x` is the **final Electron major branch** with native support for Windows 7 SP1 64-bit. Upgrading to Electron 23+ drops Windows 7 support completely.
- **Prerequisites on Windows 7 SP1 x64:**
  1. Windows 7 Service Pack 1 (64-bit) with Platform Update (`KB2670838`) and Universal C Runtime (`KB2999226`).
  2. Visual C++ Redistributable 2015–2022 (`x64`) for `better-sqlite3.node`.
  3. Recommended minimum 4 GB RAM and 500 MB free disk space.
- **Honest Security & Maintenance Warning:**
  - Both **Windows 7 SP1** (Microsoft EOL: January 2020) and **Electron 22.3.27** (EOL: October 2023) no longer receive upstream OS or Chromium security patches.
  - Because GOLDEN PALACE POS operates **strictly offline on local loopback (`127.0.0.1`)** without browsing untrusted web content, operational exposure is minimized — **however**, Windows 7 POS terminals MUST remain isolated on a trusted local LAN without general web browsing, and upgrading hardware to Windows 10/11 64-bit is strongly recommended for long-term security.

## 4. Verification Scope Statement (Linux Environment Honesty)
- All TypeScript compilation, Vite client build, `dist-electron/server.cjs` bundling, and automated Vitest tests were executed and verified in this Linux environment.
- Native Windows `.exe` NSIS packaging, Windows 7 SP1 runtime startup, Windows 11 runtime startup, and physical thermal printer tests were **not** executed on Windows hardware in this Linux container and must be executed on Windows (or via `.github/workflows/build-windows.yml` on `windows-latest`) before final field deployment.
