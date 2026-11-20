# GOLDEN PALACE POS — PHASE 5D PHYSICAL THERMAL PRINTER VALIDATION REPORT
## Workstream 5D: Real Hardware Thermal Printer Validation (80mm, 58mm, USB, Windows Spooler & LAN TCP 9100)

- **Project:** GOLDEN PALACE POS (`القصر الذهبي — LE PALAIS D’OR`)
- **Workstream:** Phase 5D
- **Overall Status:** **PENDING — ACTUAL PHYSICAL THERMAL PRINTERS REQUIRED**
- **Software / Protocol Readiness (Automated Tests):** **PASS (Verified in Phases 4C & 9; NOT a substitute for physical hardware bench)**

---

## 1. Honesty Declaration & Print Queue Safeguards Verified in Software

No physical 80mm or 58mm thermal receipt printer is attached to this Linux build container. In strict compliance with Phase 5 rules:

- **Zero physical paper printouts are claimed as confirmed.**
- **Hardware Confirmation Honesty (Verified in Code & Tests):**
  - `sendToNetworkPrinter()`, `sendToWindowsSpooler()`, `dispatchPrintTransport()` (`BROWSER` / `USB`), and `printerService.ts` ALL return **`hardwareConfirmed: false`** and **`deliveryState: 'SPOOLED'`** on submission.
  - Physical confirmation (`confirmed_at`) is recorded **ONLY** when explicitly confirmed via `POST /api/printer/jobs/:id/confirm`.
- **Full ESC/POS Payload Preservation (Verified in Code & Tests):**
  - Full raw binary ESC/POS bytes are persisted to `<dbDir>/print_spool_payloads/job_<id>.bin` (`0o600`).
  - Failed job `retry` and manual `reprint` replay exact original binary bytes and explicitly fail with **HTTP `422` (`MISSING_FULL_PRINT_PAYLOAD`)** if absent — **NEVER** retrying from truncated `payloadPreview`.
- **Cashier Transaction Isolation (Verified in Code & Tests):**
  - Order creation and payment settlement commit to SQLite independently before print dispatch; printing failure returns HTTP `502` / `FAILED` in `print_jobs` without losing or duplicating orders or payments.
  - Persisted `print_jobs` rows and `job_<id>.bin` files survive full application restart for post-restart retry recovery (further verified in Workstream 5E).

---

## 2. Physical Bench Matrix A — 80mm Thermal Receipt Printer (48 Columns)

> *Test each actual 80mm physical printer model on a separate copy of this table.*

- **Printer Brand / Model:** `PENDING (e.g., Xprinter XP-N160II / Epson TM-T20III / 80Normal)`
- **Driver / Firmware / Codepage:** `PENDING (CP864 / Windows-1256 / UTF-8)`
- **Host OS:** `PENDING (Win 7 SP1 / Win 10 / Win 11 x64)`

| # | Test Case | Pass Criteria | Status | Physical Evidence / Photo Ref |
|---|---|---|---|---|
| 1 | USB Printing | Receipt prints cleanly via USB connection; job transitions to `SPOOLED` then `CONFIRMED` only after paper exits | **PENDING** | — |
| 2 | Windows Spooler Printing | Shared Windows printer (`\\localhost\<Printer>`) accepts raw ESC/POS via `execFile` without flashing console window | **PENDING** | — |
| 3 | Arabic & French Text | Connected Arabic letters (CP864 / Windows-1256) and French accents (`É`, `À`, `Ç`, `’`) print legibly with correct RTL/LTR direction | **PENDING** | — |
| 4 | Receipt Alignment & 80mm Width | 48-column item/price alignment (`DA`) fits 80mm roll cleanly with zero wrap glitches | **PENDING** | — |
| 5 | Logo / Header Rendering | `القصر الذهبي — LE PALAIS D’OR` header/logo renders sharply without distortion | **PENDING** | — |
| 6 | Auto-Cutter Mechanism | `GS V` partial/full cut triggers cleanly after bottom feed (if supported by model) | **PENDING** | — |
| 7 | Offline Printer Failure -> Retry | Disconnect printer -> cashier transaction saved once -> job marked `FAILED` -> reconnect -> retry prints exact full ESC/POS receipt (not preview) | **PENDING** | — |
| 8 | Manual Reprint (`DUPLICATA`) | Cashier/Admin manual reprint prints `DUPLICATA` header & logs `REPRINT_RECEIPT`; Kitchen role denied (`403`) | **PENDING** | — |
| 9 | Queue Recovery After App Restart | Failed print job remains retryable with full binary payload after quitting and relaunching POS | **PENDING** | — |

---

## 3. Physical Bench Matrix B — 58mm Thermal Receipt Printer (32 Columns)

> *Test each actual 58mm physical printer model on a separate copy of this table.*

- **Printer Brand / Model:** `PENDING (e.g., Xprinter XP-58IIH / POS-5890K)`
- **Driver / Firmware / Codepage:** `PENDING (CP864 / Windows-1256 / UTF-8)`
- **Host OS:** `PENDING (Win 7 SP1 / Win 10 / Win 11 x64)`

| # | Test Case | Pass Criteria | Status | Physical Evidence / Photo Ref |
|---|---|---|---|---|
| 1 | USB Printing | Receipt prints cleanly via USB; honest `SPOOLED` status before physical confirmation | **PENDING** | — |
| 2 | Windows Spooler Printing | Raw ESC/POS prints cleanly via Windows Spooler | **PENDING** | — |
| 3 | Arabic & French Text | Bilingual Arabic/French line items legible with correct shaping | **PENDING** | — |
| 4 | Receipt Alignment & Zero Clipping | 32-column layout fits 58mm paper width with **zero horizontal text clipping** on long item names or DZD totals | **PENDING** | — |
| 5 | Correct Paper Width Setting | Switching `80mm` <-> `58mm` persists in profile and updates line column width immediately | **PENDING** | — |
| 6 | Offline Failure -> Full-Payload Retry | Disconnected 58mm printer logs `FAILED` without duplicating order; reconnect retry outputs full receipt | **PENDING** | — |
| 7 | Manual Reprint (`DUPLICATA`) | Authorized reprint succeeds and clearly marks duplicate copy | **PENDING** | — |
| 8 | Queue Recovery After App Restart | Failed job and full binary payload recover cleanly after POS restart | **PENDING** | — |

---

## 4. Physical Bench Matrix C — LAN Thermal Printer (TCP Port 9100 — If Supported)

- **Printer Brand / Model & Static LAN IP:** `PENDING (Only if physical printer supports Ethernet/TCP 9100)`

| # | Test Case | Pass Criteria | Status | Physical Evidence |
|---|---|---|---|---|
| 1 | Raw TCP 9100 Delivery | Prints directly to `<IP>:9100`; app reports `hardwareConfirmed: false` (`SPOOLED`) until confirmed | **PENDING** | — |
| 2 | Unreachable IP Timeout & Retry | Unplugged LAN cable fails cleanly (`502` / `FAILED`) without hanging cashier UI; reconnect retry prints full binary receipt | **PENDING** | — |
