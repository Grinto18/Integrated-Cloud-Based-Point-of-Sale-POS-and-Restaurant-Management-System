# GOLDEN PALACE POS — PHASE 5F RELEASE CANDIDATE REPORT
## Workstream 5F: Release Candidate Package, Hardware Matrix, Known Issues & Checksums

- **Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)
- **Release Candidate Version:** `v1.0.0-rc1` (Electron `22.3.27` / Windows x64)
- **Workstream 5F Status:** **PARTIALLY VERIFIED — SOFTWARE, DOCS & AUTOMATION COMPLETE; WINDOWS `.exe` CHECKSUM & PHYSICAL HARDWARE SIGNOFFS PENDING**

---

## 1. Release Candidate Deliverables Inventory

| Deliverable | Path / Artifact | Status |
|---|---|---|
| Windows x64 NSIS Installer | `release/GoldenPalacePOS-Setup-x64.exe` | **PENDING** (Build on Windows x64 via `.github/workflows/build-windows.yml` or `scripts/build-windows-installer.ps1`) |
| Installer SHA-256 Checksum | `release/GoldenPalacePOS-Setup-x64.exe.sha256` | **PENDING** (Generated & verified automatically on Windows x64 build host) |
| Production Frontend Bundle (`dist/`) | `dist/` (`1.6 MB`, zero dev-only `aistudio` assets) | **VERIFIED** |
| Node 16-Targeted Desktop Server Bundle | `dist-electron/server.cjs` (`4.8 MB`, `--target=node16`) | **VERIFIED** |
| Official Desktop Icons | `build/icon.png` (`512×512` RGBA PNG) & `build/icon.ico` (6-frame Windows ICO) | **VERIFIED** |
| Arabic Installation, Upgrade & Uninstallation Guide | `docs/FINAL_RELEASE/ARABIC_INSTALLATION_UPGRADE_GUIDE.md` | **READY** |
| Windows Build Automation & Rollback Script | `.github/workflows/build-windows.yml` & `scripts/build-windows-installer.ps1` | **READY** |
| Automated Regression Suite | `28/28` test files, `175/175` tests passed (`0` failures), `tsc --noEmit` (`0` errors) | **PASS** |

---

## 2. Hardware & OS Compatibility Matrix

| Category | Target | Code / Config Readiness | Physical / Host Execution |
|---|---|---|---|
| Operating System | **Windows 7 SP1 x64** | **READY** (Electron `22.3.27`, `--target=node16`, lazy `firebase-admin`, `cmd.exe /d /c copy /b`, NTFS lock retry) | **PENDING** (Requires Win 7 SP1 x64 host/VM) |
| Operating System | **Windows 10 x64** | **READY** | **PENDING** (Requires Win 10 x64 host/VM) |
| Operating System | **Windows 11 x64** | **READY** | **PENDING** (Requires Win 11 x64 host/VM) |
| Thermal Printer | **80mm (48 columns)** — USB & Windows Spooler | **READY** (ESC/POS CP864/Win-1256/UTF8, honest `SPOOLED` state, lossless binary retry) | **PENDING** (Requires physical 80mm printer) |
| Thermal Printer | **58mm (32 columns)** — USB & Windows Spooler | **READY** (32-col line wrap, honest `SPOOLED` state, lossless binary retry) | **PENDING** (Requires physical 58mm printer) |
| Thermal Printer | **LAN TCP 9100** (when printer supports Ethernet) | **READY** (Loopback TCP 9100 verified in software) | **PENDING** (Requires physical LAN printer) |

---

## 3. Known Issues & Operational Limitations

1. **Legacy Electron `22.3.27` Runtime Security Posture (Intentional Trade-Off for Windows 7 SP1):**
   - Electron `22.3.27` embeds EOL Chromium `108` and Node `16.17.1`. Mitigated via strict offline loopback-only operation (`127.0.0.1`), `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, deny-by-default permissions, popup/navigation locks, and disabled production DevTools. Do not use the POS terminal for general untrusted web browsing.
2. **Unsigned Windows Executable (SmartScreen Warning):**
   - Without an Authenticode EV/OV code-signing certificate, Windows 10/11 SmartScreen may display an "Unknown Publisher" prompt during installation. Operators must verify the `GoldenPalacePOS-Setup-x64.exe.sha256` digest prior to installation (documented in `ARABIC_INSTALLATION_UPGRADE_GUIDE.md`).
3. **Windows 7 SP1 Prerequisites:**
   - Windows 7 SP1 x64 requires `KB2999226` (Universal C Runtime), `KB4474419` (SHA-2), and Visual C++ 2015–2022 Redistributable (x64) installed before running the native `better_sqlite3.node` addon.
4. **Native Windows Build Required for `better-sqlite3@11.10.0` (Electron ABI 110):**
   - `better-sqlite3@11.10.0` has no prebuilt `electron-v110-win32-x64` binary on GitHub Releases (`HTTP 404`); building `GoldenPalacePOS-Setup-x64.exe` requires Windows x64 + MSVC C++20 Build Tools.

---

## 4. Final Automated Regression Results

```bash
npm run build        # PASS — dist/ (1.6 MB), zero aistudio dev assets
npm run build:server # PASS — dist-electron/server.cjs (4.8 MB, --target=node16)
npm run lint         # PASS — tsc --noEmit (0 errors)
npm test -- --no-color
# PASS — Test Files: 28 passed (28) | Tests: 175 passed (175) | Duration: 85.57s
```

---

## 5. Release Candidate Checksum Record

| Artifact | Size (Bytes) | SHA-256 |
|---|---|---|
| `GoldenPalacePOS-Setup-x64.exe` | `PENDING (Windows x64 build host required)` | `PENDING (Windows x64 build host required)` |
| `dist-electron/server.cjs` (Node 16 bundle) | Verified (`4.8 MB`) | Rebuilt deterministically during Windows x64 packaging |
| `build/icon.ico` (6-frame official icon) | `74,203` | `eca98c284154be449a4086c2ce8dbdc1f0bc4017a19f1b685ec5221db106d28e` |
| `build/icon.png` (`512×512` official icon) | `42,778` | `0863771c2aa05c9488b66d40a1c3b02488cf54d7cd5601d63a8b33c746aa90b8` |
