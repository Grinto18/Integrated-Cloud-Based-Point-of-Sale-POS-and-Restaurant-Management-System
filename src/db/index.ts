import 'dotenv/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';
import { getLocalDatabasePath } from './sqlitePath.ts';
import fs from 'fs';
import path from 'path';

const dbPath = getLocalDatabasePath();
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function applyDatabaseFilePermissions(targetPath: string): void {
  try {
    if (fs.existsSync(targetPath)) {
      fs.chmodSync(targetPath, 0o600);
    }
  } catch {
    // Windows / non-POSIX filesystems ignore chmod
  }
}

export function configureSqlitePragmas(targetDb: Database.Database): void {
  targetDb.pragma('journal_mode = WAL');
  targetDb.pragma('synchronous = NORMAL');
  targetDb.pragma('foreign_keys = ON');
  targetDb.pragma('busy_timeout = 5000');
}

export let sqlite: Database.Database = new Database(dbPath);
applyDatabaseFilePermissions(dbPath);

// Performance & Reliability pragmas for Windows & Linux
configureSqlitePragmas(sqlite);

export function ensureBaseSchema(targetDb: Database.Database = sqlite): void {
  targetDb.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  pin TEXT,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CASHIER',
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT NOT NULL,
  name_fr TEXT,
  name_en TEXT,
  icon TEXT,
  color TEXT DEFAULT 'blue',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  station TEXT NOT NULL DEFAULT 'MAIN_KITCHEN'
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name_ar TEXT NOT NULL,
  name_fr TEXT,
  name_en TEXT,
  description TEXT,
  price NUMERIC NOT NULL,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  image TEXT,
  barcode TEXT,
  is_available INTEGER NOT NULL DEFAULT 1,
  station TEXT NOT NULL DEFAULT 'MAIN_KITCHEN',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name_ar TEXT NOT NULL,
  name_fr TEXT,
  price_adjustment NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id),
  name_ar TEXT NOT NULL,
  name_fr TEXT,
  price NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  old_price NUMERIC NOT NULL,
  new_price NUMERIC NOT NULL,
  changed_by_user_id INTEGER REFERENCES users(id),
  reason TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_number TEXT NOT NULL UNIQUE,
  zone TEXT NOT NULL DEFAULT 'الصالة الرئيسية',
  capacity INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  current_order_id INTEGER,
  pos_x INTEGER DEFAULT 0,
  pos_y INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  address TEXT,
  notes TEXT,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  daily_sequence INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL DEFAULT 'DINE_IN',
  table_id INTEGER REFERENCES restaurant_tables(id),
  customer_id INTEGER REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'NEW',
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  delivery_fee NUMERIC NOT NULL DEFAULT 0,
  tax_rate NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  change_amount NUMERIC NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  cashier_id INTEGER REFERENCES users(id),
  waiter_id INTEGER REFERENCES users(id),
  notes TEXT,
  is_held INTEGER NOT NULL DEFAULT 0,
  held_at TEXT,
  idempotency_key TEXT UNIQUE,
  offline_id TEXT,
  shift_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  name_ar TEXT NOT NULL,
  name_fr TEXT,
  unit_price NUMERIC NOT NULL,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  total NUMERIC NOT NULL,
  notes TEXT,
  station TEXT NOT NULL DEFAULT 'MAIN_KITCHEN',
  status TEXT NOT NULL DEFAULT 'NEW',
  variants_json TEXT,
  addons_json TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL DEFAULT 'CASH',
  amount NUMERIC NOT NULL,
  tender_amount NUMERIC NOT NULL,
  change_amount NUMERIC NOT NULL DEFAULT 0,
  transaction_ref TEXT,
  cashier_id INTEGER REFERENCES users(id),
  shift_id INTEGER,
  idempotency_key TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_number TEXT NOT NULL,
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  opening_cash NUMERIC NOT NULL,
  closing_cash NUMERIC,
  expected_cash NUMERIC,
  actual_cash NUMERIC,
  difference NUMERIC,
  total_cash_sales NUMERIC NOT NULL DEFAULT 0,
  total_card_sales NUMERIC NOT NULL DEFAULT 0,
  total_ccp_sales NUMERIC NOT NULL DEFAULT 0,
  total_expenses NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN',
  opened_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES cash_shifts(id),
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  address TEXT,
  balance NUMERIC NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT NOT NULL,
  name_fr TEXT,
  unit TEXT NOT NULL DEFAULT 'KG',
  current_stock NUMERIC NOT NULL DEFAULT 0,
  min_stock NUMERIC NOT NULL DEFAULT 5,
  cost_per_unit NUMERIC NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  type TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  performed_by INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS waste_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER REFERENCES ingredients(id),
  name TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL DEFAULT 'KG',
  cost NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'EXPIRED',
  notes TEXT,
  employee_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  invoice_date TEXT NOT NULL,
  received_by INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC NOT NULL,
  total_cost NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  driver_name TEXT,
  driver_phone TEXT,
  customer_address TEXT,
  delivery_fee NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  assigned_at TEXT,
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER REFERENCES cash_shifts(id),
  category TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  description TEXT NOT NULL,
  recorded_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  user_name TEXT,
  action TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS restaurant_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id),
  order_number TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'RECEIPT',
  printer_name TEXT NOT NULL DEFAULT 'CAFETERIA',
  connection_type TEXT NOT NULL DEFAULT 'WINDOWS_SPOOLER',
  target_ip TEXT,
  target_port INTEGER DEFAULT 9100,
  copies INTEGER NOT NULL DEFAULT 1,
  paper_width TEXT NOT NULL DEFAULT '80mm',
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  is_reprint INTEGER NOT NULL DEFAULT 0,
  job_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  requested_by INTEGER REFERENCES users(id),
  spooler_accepted INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  updated_at TEXT,
  payload_preview TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash TEXT PRIMARY KEY,
  jti TEXT,
  user_id INTEGER REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  revoked_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens(expires_at);

CREATE TABLE IF NOT EXISTS sync_operations (
  operation_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  idempotency_key TEXT,
  device_id TEXT,
  sequence_order INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'SYNCED',
  server_entity_id INTEGER,
  order_number TEXT,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sync_operations_idempotency ON sync_operations(idempotency_key);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'WARNING',
  payload_json TEXT NOT NULL,
  server_snapshot_json TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  resolution_action TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(status);
`);
}

ensureBaseSchema(sqlite);

import bcrypt from 'bcryptjs';

const BCRYPT_HASH_REGEX = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(value: string | null | undefined): boolean {
  return typeof value === 'string' && BCRYPT_HASH_REGEX.test(value);
}

export function migratePlaintextPins(): number {
  let migratedCount = 0;
  try {
    const rows = sqlite
      .prepare('SELECT id, pin FROM users WHERE pin IS NOT NULL')
      .all() as { id: number; pin: string }[];

    const toMigrate = rows.filter((r) => {
      const trimmed = typeof r.pin === 'string' ? r.pin.trim() : '';
      return trimmed.length > 0 && !isBcryptHash(trimmed);
    });

    if (toMigrate.length === 0) return 0;

    const updateStmt = sqlite.prepare('UPDATE users SET pin = ? WHERE id = ?');
    const runTx = sqlite.transaction((entries: { id: number; pin: string }[]) => {
      for (const entry of entries) {
        const hashedPin = bcrypt.hashSync(entry.pin.trim(), 10);
        updateStmt.run(hashedPin, entry.id);
        migratedCount++;
      }
    });
    runTx(toMigrate);
  } catch (err: any) {
    console.error('PIN migration note:', err?.message || 'failed');
  }
  return migratedCount;
}

function ensureColumnExistsOn(
  targetDb: Database.Database,
  tableName: string,
  columnName: string,
  columnDef: string
) {
  try {
    const tableInfo = targetDb.pragma(`table_info(${tableName})`) as any[];
    if (!tableInfo || tableInfo.length === 0) return;
    const exists = tableInfo.some((col: any) => col.name === columnName);
    if (!exists) {
      targetDb.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef};`);
    }
  } catch {
    // Ignore non-fatal legacy column check errors
  }
}

export function runSafeMigrations(targetDb: Database.Database = sqlite): void {
  // Core Phase 03-06 backward-compatible column additions
  ensureColumnExistsOn(targetDb, 'users', 'phone', 'TEXT');
  ensureColumnExistsOn(targetDb, 'users', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumnExistsOn(targetDb, 'suppliers', 'email', 'TEXT');
  ensureColumnExistsOn(targetDb, 'suppliers', 'notes', 'TEXT');
  ensureColumnExistsOn(targetDb, 'cash_shifts', 'total_cash_in', 'NUMERIC NOT NULL DEFAULT 0');
  ensureColumnExistsOn(targetDb, 'cash_shifts', 'total_cash_out', 'NUMERIC NOT NULL DEFAULT 0');
  ensureColumnExistsOn(targetDb, 'cash_shifts', 'total_baridimob_sales', 'NUMERIC NOT NULL DEFAULT 0');
  ensureColumnExistsOn(targetDb, 'cash_movements', 'performed_by', 'INTEGER REFERENCES users(id)');
  ensureColumnExistsOn(targetDb, 'ingredients', 'max_stock', 'NUMERIC');
  ensureColumnExistsOn(targetDb, 'waste_records', 'product_id', 'INTEGER');
  ensureColumnExistsOn(targetDb, 'purchases', 'paid_amount', 'NUMERIC NOT NULL DEFAULT 0');
  ensureColumnExistsOn(targetDb, 'purchases', 'payment_status', "TEXT NOT NULL DEFAULT 'PAID'");
  ensureColumnExistsOn(targetDb, 'inventory_movements', 'cost', 'NUMERIC');
  ensureColumnExistsOn(targetDb, 'deliveries', 'customer_id', 'INTEGER');
  ensureColumnExistsOn(targetDb, 'deliveries', 'delivery_address', 'TEXT');
  ensureColumnExistsOn(targetDb, 'deliveries', 'notes', 'TEXT');
  ensureColumnExistsOn(targetDb, 'expenses', 'date', 'TEXT');
  ensureColumnExistsOn(targetDb, 'expenses', 'user_id', 'INTEGER');
  ensureColumnExistsOn(targetDb, 'audit_logs', 'entity_type', 'TEXT');
  ensureColumnExistsOn(targetDb, 'orders', 'idempotency_key', 'TEXT');
  ensureColumnExistsOn(targetDb, 'orders', 'offline_id', 'TEXT');
  ensureColumnExistsOn(targetDb, 'orders', 'shift_id', 'INTEGER');
  ensureColumnExistsOn(targetDb, 'orders', 'tax_rate', 'NUMERIC NOT NULL DEFAULT 0');
  ensureColumnExistsOn(targetDb, 'orders', 'tax_amount', 'NUMERIC NOT NULL DEFAULT 0');
  ensureColumnExistsOn(targetDb, 'payments', 'shift_id', 'INTEGER');
  ensureColumnExistsOn(targetDb, 'payments', 'idempotency_key', 'TEXT');
  ensureColumnExistsOn(targetDb, 'cash_movements', 'idempotency_key', 'TEXT');

  // Reconcile print_jobs legacy camelCase columns to schema.ts snake_case columns safely (non-destructive)
  ensureColumnExistsOn(targetDb, 'print_jobs', 'order_number', "TEXT NOT NULL DEFAULT ''");
  ensureColumnExistsOn(targetDb, 'print_jobs', 'job_type', "TEXT NOT NULL DEFAULT 'RECEIPT'");
  ensureColumnExistsOn(targetDb, 'print_jobs', 'printer_name', "TEXT NOT NULL DEFAULT 'CAFETERIA'");
  ensureColumnExistsOn(targetDb, 'print_jobs', 'connection_type', "TEXT NOT NULL DEFAULT 'WINDOWS_SPOOLER'");
  ensureColumnExistsOn(targetDb, 'print_jobs', 'target_ip', 'TEXT');
  ensureColumnExistsOn(targetDb, 'print_jobs', 'target_port', 'INTEGER DEFAULT 9100');
  ensureColumnExistsOn(targetDb, 'print_jobs', 'paper_width', "TEXT NOT NULL DEFAULT '80mm'");
  ensureColumnExistsOn(targetDb, 'print_jobs', 'error_message', 'TEXT');
  ensureColumnExistsOn(targetDb, 'print_jobs', 'is_reprint', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumnExistsOn(targetDb, 'print_jobs', 'job_key', 'TEXT');
  ensureColumnExistsOn(targetDb, 'print_jobs', 'attempts', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumnExistsOn(targetDb, 'print_jobs', 'requested_by', 'INTEGER');
  ensureColumnExistsOn(targetDb, 'print_jobs', 'spooler_accepted', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumnExistsOn(targetDb, 'print_jobs', 'confirmed_at', 'TEXT');
  ensureColumnExistsOn(targetDb, 'print_jobs', 'updated_at', 'TEXT');
  ensureColumnExistsOn(targetDb, 'print_jobs', 'payload_preview', 'TEXT');
  ensureColumnExistsOn(targetDb, 'print_jobs', 'created_at', 'TEXT');

  try {
    const pjCols = (targetDb.pragma('table_info(print_jobs)') as any[]).map((c) => c.name);
    if (pjCols.includes('orderNumber')) {
      targetDb.exec(`
        UPDATE print_jobs
        SET
          order_number = CASE WHEN COALESCE(order_number, '') = '' THEN COALESCE(orderNumber, '') ELSE order_number END,
          job_type = CASE WHEN COALESCE(job_type, '') = '' OR job_type = 'RECEIPT' THEN COALESCE(jobType, 'RECEIPT') ELSE job_type END,
          printer_name = CASE WHEN COALESCE(printer_name, '') = '' OR printer_name = 'CAFETERIA' THEN COALESCE(printerName, 'CAFETERIA') ELSE printer_name END,
          paper_width = CASE WHEN COALESCE(paper_width, '') = '' OR paper_width = '80mm' THEN COALESCE(paperWidth, '80mm') ELSE paper_width END,
          error_message = COALESCE(error_message, errorMessage),
          is_reprint = COALESCE(NULLIF(is_reprint, 0), isReprint, 0),
          created_at = COALESCE(created_at, createdAt, datetime('now'))
        WHERE order_number = '' OR created_at IS NULL OR (printer_name = 'CAFETERIA' AND COALESCE(printerName, 'CAFETERIA') != 'CAFETERIA');
      `);
    }
  } catch {
    // Ignore if print_jobs has no legacy camelCase columns
  }

  // Enforce offline_id, cash_movements idempotency_key, and original print job_key uniqueness
  try {
    targetDb.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_offline_id_unique ON orders(offline_id) WHERE offline_id IS NOT NULL;'
    );
    targetDb.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_idempotency_unique ON cash_movements(idempotency_key) WHERE idempotency_key IS NOT NULL;'
    );
    targetDb.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_orig_key_unique ON print_jobs(job_key) WHERE job_key IS NOT NULL AND is_reprint = 0;'
    );
  } catch {
    // Ignore if legacy duplicate rows exist
  }
}

runSafeMigrations(sqlite);

// Safely migrate any legacy plaintext PINs to bcrypt hashes at startup without locking out users
migratePlaintextPins();

export let db = drizzle(sqlite, { schema });

export function closeDatabase(): void {
  try {
    if (sqlite && sqlite.open) {
      try {
        sqlite.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // Ignore checkpoint failures when DB is already closing or read-only
      }
      sqlite.close();
    }
  } catch {
    // Ignore close errors
  }
}

export function reopenDatabase(customPath?: string): Database.Database {
  closeDatabase();
  const targetPath = customPath || getLocalDatabasePath();
  const dirPath = path.dirname(targetPath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
  sqlite = new Database(targetPath);
  applyDatabaseFilePermissions(targetPath);
  configureSqlitePragmas(sqlite);
  ensureBaseSchema(sqlite);
  runSafeMigrations(sqlite);
  migratePlaintextPins();
  db = drizzle(sqlite, { schema });
  return sqlite;
}
