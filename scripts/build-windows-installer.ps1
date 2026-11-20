# GOLDEN PALACE POS — Reproducible Windows x64 Installer Build Script
# Target: GoldenPalacePOS-Setup-x64.exe (Electron 22.3.27 / ABI 110 / Windows 7 SP1, 10, 11 x64)
# Usage (PowerShell on Windows x64 with Node.js 22 LTS & VS 2022 C++ Build Tools):
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host '=== GOLDEN PALACE POS — Windows x64 Release Build (Electron 22.3.27) ===' -ForegroundColor Cyan

# 1. Verify Windows x64 host
if ($env:OS -ne 'Windows_NT') {
    throw 'This installer script must be executed on a Windows x64 host (MSVC C++20 required for better-sqlite3 ABI 110).'
}

# 2. Preserve rollback copy of any existing installer (Phase 5 Data Safety Rule #6)
$installerPath = 'release\GoldenPalacePOS-Setup-x64.exe'
$checksumPath = 'release\GoldenPalacePOS-Setup-x64.exe.sha256'
if (Test-Path $installerPath) {
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $rollbackDir = "release\rollback_$stamp"
    New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
    Copy-Item $installerPath "$rollbackDir\GoldenPalacePOS-Setup-x64.exe" -Force
    if (Test-Path $checksumPath) {
        Copy-Item $checksumPath "$rollbackDir\GoldenPalacePOS-Setup-x64.exe.sha256" -Force
    }
    $prevHash = (Get-FileHash "$rollbackDir\GoldenPalacePOS-Setup-x64.exe" -Algorithm SHA256).Hash.ToLower()
    Write-Host "Preserved previous installer rollback copy at $rollbackDir (SHA-256: $prevHash)" -ForegroundColor Yellow
}

# 3. Build Vite frontend & Node 16-targeted desktop server bundle FIRST (required by Phase 5E tests)
Write-Host '[1/5] Building frontend (dist/) and desktop server bundle (dist-electron/server.cjs)...' -ForegroundColor Cyan
npm run build:desktop
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }

if (Test-Path 'dist\assets\aistudio') {
    throw 'Development-only dist\assets\aistudio found in production bundle!'
}

# 4. Verify automated tests & TypeScript typecheck
Write-Host '[2/5] Running automated regression suite...' -ForegroundColor Cyan
npm test -- --no-color
if ($LASTEXITCODE -ne 0) { throw 'Automated test suite failed.' }

Write-Host '[3/5] Running TypeScript lint...' -ForegroundColor Cyan
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'TypeScript lint failed.' }

# 5. Rebuild native better-sqlite3 from source for Electron 22.3.27 (x64 ABI 110, MSVC C++20)
Write-Host '[4/5] Rebuilding better-sqlite3 native addon from source for Electron 22.3.27 (x64 ABI 110)...' -ForegroundColor Cyan
npx electron-rebuild -f -w better-sqlite3 -v 22.3.27 --arch x64 --build-from-source
if ($LASTEXITCODE -ne 0) { throw 'electron-rebuild failed for better-sqlite3.' }

$nativeAddon = 'node_modules\better-sqlite3\build\Release\better_sqlite3.node'
if (-not (Test-Path $nativeAddon)) {
    throw "Native addon missing after rebuild: $nativeAddon"
}
$nativeBytes = [System.IO.File]::ReadAllBytes($nativeAddon)
if ($nativeBytes.Length -lt 64 -or $nativeBytes[0] -ne 0x4D -or $nativeBytes[1] -ne 0x5A) {
    throw 'better_sqlite3.node is not a valid Windows PE binary (missing MZ header).'
}
$peOffset = [System.BitConverter]::ToInt32($nativeBytes, 0x3C)
$machine = [System.BitConverter]::ToUInt16($nativeBytes, $peOffset + 4)
if ($machine -ne 0x8664) {
    throw ("Expected PE32+ x64 (0x8664) better_sqlite3.node, got 0x{0:X4}" -f $machine)
}
$rebuiltNativeHash = (Get-FileHash $nativeAddon -Algorithm SHA256).Hash.ToLower()
Write-Host ("Verified PE32+ x64 better_sqlite3.node ({0} bytes) SHA-256={1}" -f $nativeBytes.Length, $rebuiltNativeHash) -ForegroundColor Green

# 6. Package Windows x64 NSIS Installer
Write-Host '[5/5] Packaging GoldenPalacePOS-Setup-x64.exe via electron-builder...' -ForegroundColor Cyan
npx electron-builder --win --x64 --publish never -c.npmRebuild=false
if ($LASTEXITCODE -ne 0) { throw 'electron-builder packaging failed.' }

# 7. Verify packaged runtime layout, PE32+ headers, native SHA-256 match & installer SHA-256
$unpackedExe = 'release\win-unpacked\GOLDEN PALACE POS.exe'
$appAsar = 'release\win-unpacked\resources\app.asar'
$unpackedRoot = 'release\win-unpacked\resources\app.asar.unpacked'
$unpackedNative = "$unpackedRoot\node_modules\better-sqlite3\build\Release\better_sqlite3.node"
$requiredPaths = @(
    $installerPath,
    $unpackedExe,
    $appAsar,
    $unpackedNative,
    "$unpackedRoot\dist-electron\server.cjs",
    "$unpackedRoot\dist\index.html",
    "$unpackedRoot\build\icon.ico",
    "$unpackedRoot\build\icon.png",
    "$unpackedRoot\node_modules\bindings\package.json",
    "$unpackedRoot\node_modules\file-uri-to-path\package.json",
    "$unpackedRoot\node_modules\bcryptjs\package.json",
    "$unpackedRoot\node_modules\iconv-lite\package.json"
)
foreach ($p in $requiredPaths) {
    if (-not (Test-Path $p)) {
        throw "Required packaged file missing: $p"
    }
}
if (Test-Path "$unpackedRoot\dist\assets\aistudio") {
    throw 'Development-only aistudio assets leaked into unpacked dist!'
}

$exeBytes = [System.IO.File]::ReadAllBytes($unpackedExe)
$exePeOffset = [System.BitConverter]::ToInt32($exeBytes, 0x3C)
$exeMachine = [System.BitConverter]::ToUInt16($exeBytes, $exePeOffset + 4)
if ($exeMachine -ne 0x8664) {
    throw ("Expected PE32+ x64 (0x8664) GOLDEN PALACE POS.exe, got 0x{0:X4}" -f $exeMachine)
}

$unpackedNativeHash = (Get-FileHash $unpackedNative -Algorithm SHA256).Hash.ToLower()
if ($unpackedNativeHash -ne $rebuiltNativeHash) {
    throw "Unpacked better_sqlite3.node SHA-256 mismatch! Expected $rebuiltNativeHash, got $unpackedNativeHash"
}

$installerFile = Get-Item $installerPath
$sha256 = (Get-FileHash $installerPath -Algorithm SHA256).Hash.ToLower()
"$sha256  GoldenPalacePOS-Setup-x64.exe" | Out-File -Encoding ascii $checksumPath

Write-Host ''
Write-Host '=== BUILD SUCCEEDED ===' -ForegroundColor Green
Write-Host "Installer   : $installerPath"
Write-Host "Size        : $($installerFile.Length) bytes"
Write-Host "SHA-256     : $sha256"
Write-Host "SQLite Node : $unpackedNativeHash (PE32+ x64 ABI 110)"
Write-Host "Checksum    : $checksumPath"
