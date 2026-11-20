# GOLDEN PALACE POS — Official Menu Integration Security Review Report

## 1. Access Control (RBAC)
- **Menu Import (`POST /api/menu/import/preview`, `POST /api/menu/import/commit`):** Strictly restricted via `requireAuth` + `requireRole(['ADMIN', 'OWNER'])`. Cashiers, Waiters, Kitchen, and Inventory users receive HTTP `403 Forbidden`.
- **Menu Import History (`GET /api/menu/import/history`):** Restricted to `ADMIN`, `OWNER`, and `MANAGER`.
- **Add-ons Management (`POST/PUT/DELETE /api/addons`):** Restricted to `ADMIN`, `OWNER`, and `MANAGER`.
- **Discounts (`POST /api/orders`):**
  - `WAITER`, `KITCHEN`, and `INVENTORY` roles are strictly rejected with HTTP `403 Forbidden`.
  - `OWNER`, `ADMIN`, and `MANAGER` are authorized to apply fixed or percentage discounts.
  - `CASHIER` discount privilege can be disabled cleanly via `restaurant_settings` (`restrict_cashier_discount = 'true'`), enforced server-side.
  - Every discount records `discount_type`, `discount_value`, `discount_reason`, `discount_authorized_by`, `discount_authorized_at`, and writes an `APPLY_DISCOUNT` audit record with `previous_value` (subtotal) and `new_value` (final total).

## 2. Input Validation & Financial Integrity
- **Monetary Precision:** All imported product and variant prices are validated via strict integer regex (`/^\d+$/`) in Algerian Dinars (DA), rejecting negative values, decimals/floats, NaN, and non-numeric strings.
- **No Client-Trusted Pricing:** `validateAndPriceOrderItemsInTx` always recalculates product, variant (`L`/`XL`), and add-on totals directly from SQLite. Non-admin/non-manager price override attempts are rejected with HTTP `403`.
- **Order Snapshot Immutability:** Historical `order_items` store `name_ar`, `name_fr`, `unit_price`, `quantity`, `total`, `variants_json`, and `addons_json` at creation time. Later catalog price updates never mutate past invoices.
- **Zero Hardcoded Menu Items or Credentials:** Official menu items live exclusively in external import datasets (`data/official-menu/`). Product add-ons start empty by default. No credentials, API keys, or default PIN hints were added.

## 3. Parser & Dependency Security
- **Excel Parser (`exceljs`):** Selected over legacy `xlsx` (0.18.5) to avoid unpatched prototype-pollution and ReDoS vulnerabilities.
- **Malformed File Handling:** Invalid JSON, malformed CSV (unclosed quotes, missing required headers), corrupt XLSX archives, empty files, and unsupported extensions are rejected cleanly with HTTP `400` before touching SQLite.
- **SQL Injection Prevention:** All SQLite statements in `src/services/menuImportService.ts` and `src/server/api.ts` use parameterized prepared statements or Drizzle ORM bound parameters.

## 4. Electron Security Baseline Preserved
- Phase 12-C authentication remediation, Phase 12-D.1 hardened `BrowserWindow` settings (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false`), and Phase 12-D.2 IPC sender/input validation remain completely intact and unmodified.
- **Note on Remaining Electron Hardening Stages:** Electron Stages D3–D6 (navigation/popup restrictions, CSP/CORS, printing/server hardening) remain scheduled separately per repository governance.
