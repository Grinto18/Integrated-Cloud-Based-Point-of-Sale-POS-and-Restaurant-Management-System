# GOLDEN PALACE POS — PHASE 5B WINDOWS INSTALLER REPORT
## Workstream 5B: Windows x64 NSIS Installer (`GoldenPalacePOS-Setup-x64.exe`)

- **Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)
- **Workstream:** Phase 5B
- **Overall Status:** **PENDING — WINDOWS x64 BUILD HOST REQUIRED FOR NATIVE ABI 110 COMPILATION & NSIS PACKAGING**
- **Installer Configuration & Build Automation Status:** **READY & VERIFIED**

---

## 1. Honest Execution Status (Why `.exe` Was Not Fabricated on Linux)

Under Phase 5 Data Safety Rules (#8: *Never fabricate physical Windows or printer test results*) and Workstream 5A audit findings:

1. The current execution container runs **`Linux 4.19.0-gvisor x86_64`** with **no Windows OS, no MSVC C++20 compiler, no Wine, and no `makensis`**.
2. `better-sqlite3@11.10.0` does **not** publish a prebuilt binary for Electron `22.3.27` (`win32-x64` ABI `110`) on GitHub Releases (verified via HEAD request returning **HTTP `404`** for `better-sqlite3-v11.10.0-electron-v110-win32-x64.tar.gz`).
3. The local `node_modules/better-sqlite3/build/Release/better_sqlite3.node` is a **Linux ELF x86-64** binary (Node `22` ABI `127`). Wrapping a Linux ELF binary inside a Windows `.exe` would produce a broken installer that crashes immediately on Windows with `ERR_DLOPEN_FAILED`.
4. Therefore, **no fraudulent or broken `.exe` was generated on Linux**. Generation of `GoldenPalacePOS-Setup-x64.exe` and its SHA-256 checksum remain **`PENDING`** until executed on a Windows x64 host or the repository's GitHub Actions `windows-latest` runner.

---

## 2. Verified Installer Specification (`electron-builder.yml`)

| Requirement | Configured Value | Verification |
|---|---|---|
| Installer filename | `GoldenPalacePOS-Setup-x64.exe` (`artifactName: GoldenPalacePOS-Setup-${arch}.${ext}`) | **VERIFIED** |
| Target architecture | Windows `x64` (`nsis`, Electron `22.3.27` / ABI `110`) | **VERIFIED** |
| Desktop shortcut | `createDesktopShortcut: true` (`shortcutName: GOLDEN PALACE POS`) | **VERIFIED** |
| Start Menu shortcut | `createStartMenuShortcut: true` | **VERIFIED** |
| Official icon | `build/icon.ico` (6 frames: `256/64/48/32/24/16`) set for `win.icon`, `nsis.installerIcon`, `nsis.uninstallerIcon`, and unpacked runtime | **VERIFIED** |
| Interactive directory selection | `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true` | **VERIFIED** |
| Independent persistent database dir | `%APPDATA%\Golden Palace POS\golden_palace_production.db` & `backups_production\` | **VERIFIED** |
| Preserve DB & backups on uninstall/upgrade | `deleteAppDataOnUninstall: false` | **VERIFIED** |
| Unpacked `ELECTRON_RUN_AS_NODE=1` runtime | `dist/**/*`, `dist-electron/**/*`, `build/icon.*`, `better-sqlite3`, `bindings`, `file-uri-to-path`, `bcryptjs`, `iconv-lite` all in `asarUnpack` | **VERIFIED** |
| Rollback-safe installer replacement | Automated in `scripts/build-windows-installer.ps1` (archives prior installer to `release\rollback_<timestamp>\` with SHA-256 before building) | **VERIFIED** |

---

## 3. Reproducible Windows x64 Build Commands

### Option A — Automated CI Build (GitHub Actions `windows-latest`)
Trigger workflow `.github/workflows/build-windows.yml` (`workflow_dispatch` or tag `v*`). Output artifacts uploaded automatically:
- `release/GoldenPalacePOS-Setup-x64.exe`
- `release/GoldenPalacePOS-Setup-x64.exe.sha256`

### Option B — Local Windows x64 Build Machine (Prerequisites: Node.js 22 LTS x64 + Visual Studio 2022 Build Tools with C++ Desktop Workload)
```powershell
npm install --legacy-peer-deps --no-audit --no-fund
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer.ps1
```

---

## 4. Pending Sign-Off Fields (To Be Completed on Windows x64 Build Host)

| Field | Recorded Value |
|---|---|
| Build Host OS & Runner | `PENDING — Windows x64 host required` |
| Generated File | `release\GoldenPalacePOS-Setup-x64.exe` (`PENDING`) |
| Installer Size (Bytes) | `PENDING` |
| Installer SHA-256 | `PENDING` |
| PE32+ `0x8664` `better_sqlite3.node` Verified | `PENDING` |
| Clean Install & In-Place Upgrade Verified | `PENDING` |
| Uninstall Preserves `%APPDATA%\Golden Palace POS\` Verified | `PENDING` |
