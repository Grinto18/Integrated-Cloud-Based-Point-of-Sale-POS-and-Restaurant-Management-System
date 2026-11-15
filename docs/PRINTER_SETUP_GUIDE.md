# GOLDEN PALACE POS — Thermal Printer Setup & Troubleshooting Guide

## 1. Supported & Verified Connection Modes
1. **Windows Spooler (`WINDOWS_SPOOLER`)** — Recommended for USB thermal printers installed with a Windows driver (`Xprinter`, `Epson TM-T20`, `80Normal`, `XP-58`). Dispatches raw ESC/POS via Windows Spooler (`copy /b`).
2. **Network LAN (`NETWORK_IP`, TCP Port `9100`)** — Direct raw TCP socket delivery to Ethernet/Wi-Fi LAN thermal printers using static IP (e.g., `192.168.1.200:9100`).
3. **USB Direct (`USB` — Web Serial API)** — Direct serial ESC/POS output in Chromium/Electron environments where supported.
4. **Browser / Electron Silent Print (`BROWSER`)** — Prints styled bilingual HTML receipt (`@media print` calibrated to `48mm`/`58mm` or `70mm`/`80mm`) via Electron silent print or system dialog.

> Note: Bluetooth printing is intentionally excluded because it is not reliably provable across standard Windows desktop environments without vendor-specific drivers.

## 2. Paper Width & Arabic Encoding Settings
- **80mm Roll:** Recommended Printable Width = `70mm` (prevents left-side margin clipping on Windows `80Normal` drivers), 48 ESC/POS columns.
- **58mm Roll:** Recommended Printable Width = `48mm`, 32 ESC/POS columns.
- **Arabic Encoding:**
  - `CP864` (IBM Arabic, recommended for most Arabic-flashed Epson/Xprinter thermal units — shapes connected presentation forms & visual BiDi ordering).
  - `Windows-1256` (for ANSI 1256 firmware printers).
  - `UTF-8` (for modern UTF-8 ESC/POS firmware printers).

## 3. Understanding Honest 3-Stage Print Status
Every receipt distinguishes three states clearly in **Receipt Preview** and `print_jobs`:
1. **Saved in Database (`print_jobs`)**: Job queued/persisted in SQLite.
2. **Accepted by OS Spooler / Network Connection (`spooler_accepted`)**: OS spooler or TCP 9100 accepted bytes — **not yet proof that paper exited**. If disconnected or unreachable, job transitions to `FAILED` (`HTTP 502`) with exact error message.
3. **Physical Output Confirmed (`confirmed_at`)**: Confirmed physically printed by hardware/cashier confirmation.

## 4. Duplicate Prevention & Authorized Reprints
- Original order receipts print **once** (`job_key = orig_<order>_receipt`).
- **إعادة طباعة الوصل (Reprint / DUPLICATA)** is restricted to **`ADMIN`**, **`MANAGER`**, and **`CASHIER`** only (`403 Forbidden` for Kitchen/Inventory) and stamps `*** REPRINT / DUPLICATA / نسخة معاد طباعتها ***`.
- Failed jobs remain visible in **Settings → Printer → Print Queue (`print_jobs`)** for manual **Retry** once the printer is reconnected.
