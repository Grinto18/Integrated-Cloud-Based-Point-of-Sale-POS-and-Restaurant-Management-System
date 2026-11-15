# GOLDEN PALACE POS — Release & Field Deployment Checklist

## Automated Software Gate (Must All Be PASS Before Windows Build)
- [ ] `npm test` — All backend & frontend Vitest suites pass on isolated SQLite DBs (`exit code 0`).
- [ ] `npm run lint` (`tsc --noEmit`) — Zero TypeScript errors (`exit code 0`).
- [ ] `npm run build` & `npm run build:server` — Vite frontend (`dist/`) and CJS desktop server (`dist-electron/server.cjs`) compile cleanly (`exit code 0`).
- [ ] Production DB preservation check — Read-only `PRAGMA integrity_check = ok`, no production `.db` modified during QA.

## Windows Build Gate (Executed on Windows 10/11 x64 Build Host or GitHub Actions `windows-latest`)
- [ ] Run `npm run rebuild:electron && npm run pack:win` on Windows x64 with C++ Build Tools (compiles `better-sqlite3@11.10.0` for Electron 22.3.27 Node ABI 110).
- [ ] Verify `release/GOLDEN-PALACE-POS-Setup-1.0.0-x64.exe` exists, is non-zero size, and record SHA-256 checksum.
- [ ] Install on clean Windows 10/11 machine; verify `%APPDATA%\Golden Palace POS\golden_palace_production.db`, `backups_production\`, and `.jwt_secret` paths.
- [ ] Verify First-Run Admin setup (no `1234` default PIN) on fresh install AND data preservation when upgrading with an existing production DB.
- [ ] Verify graceful shutdown (`Alt+F4` / window close) creates a verified shutdown backup and cleanly checkpoints WAL.
- [ ] Verify uninstall/upgrade retains `%APPDATA%\Golden Palace POS` intact (`deleteAppDataOnUninstall: false`).

## Physical Hardware Gate (`docs/HARDWARE_TEST_PLAN.md`)
- [ ] 80mm physical thermal print (Arabic connected letters RTL + French LTR + TVA + discount + split payment + cut + drawer kick).
- [ ] 58mm physical thermal print (48mm printable width, no truncation).
- [ ] Long 30+ item receipt physical print (no page clipping).
- [ ] Authorized `REPRINT / DUPLICATA` vs unauthorized `403` role block.
- [ ] Physical printer power-off / cable disconnect → `FAILED` status persisted → reconnect → Retry prints successfully.
