# PHASE 11-A — ORIGINAL DATABASE RECOVERY AUDIT

**Audit Timestamp:** `2026-11-14T17:17:59Z` (`2026-11-14 09:17:59 PST`)  
**Mode:** Strictly Read-Only Investigation (Zero databases created, modified, migrated, seeded, or restored)

> **ORIGINAL PRODUCTION DATABASE NOT FOUND IN CURRENTLY ACCESSIBLE PROJECT FILES.**

---

## FINAL RECOVERY DECISION

**`C. No original database or valid backup found`**

*(All three SQLite `.db` files accessible on the container were created **after** the `2026-11-14 15:49 UTC` container reset by the dev server startup at `15:56 UTC` and contain only seeded demo records with zero historical orders, payments, cash shifts, or expenses.)*

---

## 1. Search Locations Inspected (Task 1)

A recursive read-only filesystem audit was performed across all accessible container paths (excluding `/proc`, `/sys`, `/dev`, OS binaries/libraries, and `/app/applet/node_modules`) searching for `golden_palace.db*`, `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite`, `*.sqlite3`, `*.zip`, `*.tar*`, `*.gz`, `*.bak`, `*.sql`, and directories named `backups`, `backup`, `database`, `data`, `recovery`, `.git`, or `.aistudio`:

| Location | Result |
|---|---|
| `/app/applet` (project root, `src/`, `docs/`, `release/`, `electron/`, `public/`, `dist/`, `dist-electron/`) | No `.db`, `.sqlite`, `.sqlite3`, `.zip`, `.bak`, `.sql`, `backups/`, `database/`, `data/`, or `recovery/` folders found. |
| `/app/applet/.git` & `/.aistudio` | Not present (`No such file or directory`); no local Git history or AI Studio snapshot directory exposed inside the container. |
| `/root/.local/share/Golden Palace POS/` & `backups/` | Found 1 active WAL database (`golden_palace.db`, `-wal`, `-shm`) and 2 scheduled backup `.db` files + `backup_manifest.json` — all created at `2026-11-14 15:56 UTC` (post-reset). |
| `/root/.bun`, `/root/.npm`, `/root/.cache` | Package caches only (no POS SQLite databases or archives). |
| `/home/appuser`, `/workspace`, `/www-data-home`, `/var/backups`, `/opt`, `/srv`, `/mnt`, `/media` | Empty or OS defaults (`yarn`); zero POS database files or archives. |
| `/tmp` | Transient dev/runtime temp sockets & compilation caches only (`tsx-0`, `node-compile-cache`, `electron-download-*`); zero `.db` or `.sqlite*` files. |
| `/var/cache/dictionaries-common/*.db` | OS spellchecker dictionaries (`aspell.db`, `hunspell.db`, `ispell.db`, `wordlist.db`) — excluded (non-POS OS files). |

---

## 2. Candidate Files Found (Task 2)

| # | Exact File Path | Size (Bytes) | Last Modified (UTC) | Role | Associated WAL / SHM | Predates Container Reset (`15:49 UTC`)? | Origin Verifiable? |
|---|---|---|---|---|---|---|---|
| 1 | `/root/.local/share/Golden Palace POS/golden_palace.db` | `4,096` (+ `2,801,632` WAL, `32,768` SHM) | `2026-11-14 15:56:03` (WAL updated `17:17:38`) | Active dev SQLite DB | Yes (`-wal` & `-shm` present) | **No** (created 7 min after reset) | Yes — auto-created & seeded by `server.ts` on dev boot |
| 2 | `/root/.local/share/Golden Palace POS/backups/gp_pos_daily_2026-11-14T15-56-10-737Z_lh55.db` | `221,184` | `2026-11-14 15:56:10` | Scheduled `DAILY` backup | No | **No** (created 7 min after reset) | Yes — auto-created by `backupManager` from Candidate 1 |
| 3 | `/root/.local/share/Golden Palace POS/backups/gp_pos_weekly_2026-11-14T15-56-10-757Z_ptt1.db` | `221,184` | `2026-11-14 15:56:10` | Scheduled `WEEKLY` backup | No | **No** (created 7 min after reset) | Yes — auto-created by `backupManager` from Candidate 1 |

---

## 3. Read-Only Database Validation Results (Task 3)

All three candidates were opened via `better-sqlite3` with `{ readonly: true, fileMustExist: true }`.

- **`PRAGMA integrity_check`:** `[{"integrity_check":"ok"}]` across all 3 files.
- **Schema Present (28 tables across all 3 files):** `audit_logs`, `cash_movements`, `cash_shifts`, `categories`, `customers`, `deliveries`, `expenses`, `ingredients`, `inventory_movements`, `order_items`, `orders`, `payments`, `price_history`, `print_jobs`, `product_addons`, `product_recipes`, `product_variants`, `products`, `purchase_items`, `purchases`, `restaurant_settings`, `restaurant_tables`, `revoked_tokens`, `suppliers`, `sync_conflicts`, `sync_operations`, `users`, `waste_records`.
- **Key Column Checks:** `orders` includes `tax_rate`, `tax_amount`, `idempotency_key`, `offline_id`, `shift_id`; `payments` includes `shift_id`, `idempotency_key`; `print_jobs` includes full Phase 09 queue columns; `expenses` includes `shift_id`, `date`, `user_id`, `recorded_by`.

### Record Counts & Timestamps Across All 3 Candidates

| Table | Candidate 1 (`golden_palace.db`) | Candidate 2 (`gp_pos_daily...db`) | Candidate 3 (`gp_pos_weekly...db`) |
|---|---|---|---|
| `users` | `6` (`admin`, `manager`, `caissier1`, `serveur1`, `cuisine`, `stock`) | `6` | `6` |
| `categories` | `8` | `8` | `8` |
| `products` | `25` | `25` | `25` |
| `restaurant_tables` | `30` | `30` | `30` |
| `customers` | `3` | `3` | `3` |
| `ingredients` | `11` | `11` | `11` |
| `orders` | `0` | `0` | `0` |
| `order_items` | `0` | `0` | `0` |
| `payments` | `0` | `0` | `0` |
| `cash_shifts` | `0` | `0` | `0` |
| `expenses` | `0` | `0` | `0` |
| `inventory_movements` | `0` | `0` | `0` |
| `print_jobs` | `0` | `0` | `0` |
| `audit_logs` | `0` | `0` | `0` |
| `sync_operations` | `0` | `0` | `0` |
| **Earliest / Latest `orders.created_at`** | `null` / `null` | `null` / `null` | `null` / `null` |
| **User `created_at` Timestamps** | `2026-11-14 15:56:05` | `2026-11-14 15:56:05` | `2026-11-14 15:56:05` |

---

## 4. Comparison & Classification Results (Tasks 4 & 5)

All three discovered SQLite files are identical seeded instances generated during the `2026-11-14 15:56 UTC` post-reset startup of `server.ts` (`seedDatabase()`). None contain historical orders, customer transactions, shifts, expenses, inventory movements, or print jobs.

| Candidate | Classification | Reason |
|---|---|---|
| `/root/.local/share/Golden Palace POS/golden_palace.db` | **SEEDED / DEMO DATABASE** | Created post-reset (`15:56:03 UTC`), default 6 seeded accounts created at `15:56:05 UTC`, `0` financial/operational records. |
| `/root/.local/share/Golden Palace POS/backups/gp_pos_daily_2026-11-14T15-56-10-737Z_lh55.db` | **SEEDED / DEMO DATABASE** | Exact backup snapshot of the freshly seeded post-reset database (`0` orders/payments/shifts). |
| `/root/.local/share/Golden Palace POS/backups/gp_pos_weekly_2026-11-14T15-56-10-757Z_ptt1.db` | **SEEDED / DEMO DATABASE** | Exact backup snapshot of the freshly seeded post-reset database (`0` orders/payments/shifts). |

---

## 5. Safest Recommended Recovery Candidate

- **None available inside the container.** None of the three files contain original restaurant production data, so restoring Candidates 2 or 3 would only restore the exact same empty seeded database already running in Candidate 1.
- **External User Action Required:** If an external backup exists outside this container (e.g., an exported `.db` downloaded earlier via **Settings → Backups → Download**, or a Windows `%APPDATA%\Golden Palace POS\` copy on the restaurant PC), retrieve that external `.db` file and inspect it with read-only validation before performing any Phase 11-B restore.

---

## 6. Missing Evidence & Limitations

1. **Container Reset Ephemerality:** At `2026-11-14 15:49 UTC`, the previous sandbox container instance restarted (`PID 1` started at `15:49`), resetting root-level OS paths outside `/app/applet` (including the previous `/root/.local/share/Golden Palace POS/` directory).
2. **No Platform Snapshot / Volume History Inside Container:** Neither `.git` history nor `/.aistudio` container snapshots are mounted inside this runtime environment, preventing inspection of pre-reset container layers from inside the shell.
3. **Host/Client Backups Not Accessible:** Any backups previously downloaded by the operator to a local PC or external USB drive are outside container visibility.
