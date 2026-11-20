# GOLDEN PALACE POS — Build & Packaging Instructions

## 1. Prerequisites
- **Node.js:** v20.x or v22.x LTS (for development & CI builds)
- **Windows Packaging Host:** Windows 10/11 64-bit (or GitHub Actions `windows-latest` runner) with C++ Build Tools (Visual Studio Build Tools with "Desktop development with C++") for rebuilding `better-sqlite3` against Electron `22.3.27`.

## 2. Install Dependencies
```bash
npm ci
```

## 3. Regenerate Official External Menu Files (Optional)
If `data/official-menu/golden_palace_official_menu.json` is updated, regenerate the matching CSV (UTF-8 BOM) and Excel (`.xlsx`) datasets:
```bash
node scripts/generate-official-menu-files.mjs
```
Outputs:
- `data/official-menu/golden_palace_official_menu.json`
- `data/official-menu/golden_palace_official_menu.csv`
- `data/official-menu/golden_palace_official_menu.xlsx`

## 4. Run Verification & Type Checks
```bash
npm run lint
npm test
```

## 5. Build Web Client & Desktop Server Bundle
```bash
npm run build:desktop
```
This runs:
1. `vite build` → outputs client bundle to `dist/`
2. `esbuild server.ts ...` → outputs standalone CJS backend to `dist-electron/server.cjs`

## 6. Build Windows x64 NSIS Installer (On Windows Only)
Ensure valid build icon assets (`build/icon.png` and `build/icon.ico`) are present, then run:
```bash
npm run rebuild:electron
npm run pack:win
```
Target installer artifact:
`release/GOLDEN-PALACE-POS-Setup-1.0.0-x64.exe`

Alternatively, trigger the automated Windows workflow in GitHub Actions:
`.github/workflows/build-windows.yml`
