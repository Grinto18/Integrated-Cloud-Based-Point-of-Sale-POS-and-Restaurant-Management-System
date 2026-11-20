// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const PHASE1_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase1_db_safety_'));
const BOOTSTRAP_DB = path.join(PHASE1_ROOT, 'bootstrap', 'isolated_bootstrap.db');
const BOOTSTRAP_BACKUPS = path.join(PHASE1_ROOT, 'bootstrap', 'backups');

// Isolate module-level DB initialization strictly inside os.tmpdir()
process.env.SQLITE_DB_PATH = BOOTSTRAP_DB;
process.env.GOLDEN_PALACE_BACKUP_DIR = BOOTSTRAP_BACKUPS;
process.env.GOLDEN_PALACE_DB_MODE = 'production';
process.env.JWT_SECRET = 'phase1_database_safety_test_secret_32_bytes_min';

function createLegacyPrePhase09Schema(db: Database.Database): void {
  // Minimal legacy schema predating Phase 05-09 & Official Menu columns,
  // with legacy camelCase print_jobs columns and zero schema_migrations / user_version=0.
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      pin TEXT,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'CASHIER',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE categories (
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
    CREATE TABLE products (
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
    CREATE TABLE product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      name_ar TEXT NOT NULL,
      name_fr TEXT,
      price_adjustment NUMERIC NOT NULL DEFAULT 0
    );
    CREATE TABLE product_addons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      name_ar TEXT NOT NULL,
      name_fr TEXT,
      price NUMERIC NOT NULL DEFAULT 0
    );
    CREATE TABLE price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      old_price NUMERIC NOT NULL,
      new_price NUMERIC NOT NULL,
      changed_by_user_id INTEGER REFERENCES users(id),
      reason TEXT,
      changed_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE restaurant_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_number TEXT NOT NULL UNIQUE,
      zone TEXT NOT NULL DEFAULT 'الصالة الرئيسية',
      capacity INTEGER NOT NULL DEFAULT 4,
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      current_order_id INTEGER,
      pos_x INTEGER DEFAULT 0,
      pos_y INTEGER DEFAULT 0
    );
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      address TEXT,
      notes TEXT,
      total_orders INTEGER NOT NULL DEFAULT 0,
      total_spent NUMERIC NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      daily_sequence INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL DEFAULT 'DINE_IN',
      table_id INTEGER REFERENCES restaurant_tables(id),
      customer_id INTEGER REFERENCES customers(id),
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      subtotal NUMERIC NOT NULL DEFAULT 0,
      discount NUMERIC NOT NULL DEFAULT 0,
      delivery_fee NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC NOT NULL DEFAULT 0,
      paid_amount NUMERIC NOT NULL DEFAULT 0,
      change_amount NUMERIC NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'PAID',
      cashier_id INTEGER REFERENCES users(id),
      waiter_id INTEGER REFERENCES users(id),
      notes TEXT,
      is_held INTEGER NOT NULL DEFAULT 0,
      held_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE order_items (
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
      status TEXT NOT NULL DEFAULT 'SERVED',
      variants_json TEXT,
      addons_json TEXT
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      method TEXT NOT NULL DEFAULT 'CASH',
      amount NUMERIC NOT NULL,
      tender_amount NUMERIC NOT NULL,
      change_amount NUMERIC NOT NULL DEFAULT 0,
      transaction_ref TEXT,
      cashier_id INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE cash_shifts (
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
      status TEXT NOT NULL DEFAULT 'CLOSED',
      opened_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      notes TEXT
    );
    CREATE TABLE cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL REFERENCES cash_shifts(id),
      cashier_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      address TEXT,
      balance NUMERIC NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ingredients (
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
    CREATE TABLE product_recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      quantity NUMERIC NOT NULL
    );
    CREATE TABLE inventory_movements (
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
    CREATE TABLE waste_records (
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
    CREATE TABLE purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      total_amount NUMERIC NOT NULL DEFAULT 0,
      invoice_date TEXT NOT NULL,
      received_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id),
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      quantity NUMERIC NOT NULL,
      unit_cost NUMERIC NOT NULL,
      total_cost NUMERIC NOT NULL
    );
    CREATE TABLE deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      driver_name TEXT,
      driver_phone TEXT,
      customer_address TEXT,
      delivery_fee NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'DELIVERED',
      assigned_at TEXT,
      delivered_at TEXT
    );
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER REFERENCES cash_shifts(id),
      category TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      description TEXT NOT NULL,
      recorded_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      user_name TEXT,
      action TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE restaurant_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE print_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER REFERENCES orders(id),
      orderNumber TEXT,
      jobType TEXT,
      printerName TEXT,
      copies INTEGER NOT NULL DEFAULT 1,
      paperWidth TEXT,
      status TEXT NOT NULL DEFAULT 'PRINTED',
      errorMessage TEXT,
      isReprint INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT
    );
  `);
}

function seedRichRestaurantRecords(db: Database.Database): void {
  db.exec(`
    INSERT INTO users (uid, username, email, password_hash, pin, full_name, role)
    VALUES
      ('uid-owner-1', 'owner_palace', 'owner@palaisdor.dz', '$2b$10$abcdefghijklmnopqrstuv123456789012345678901234567890123', '7391', 'مالك القصر الذهبي', 'ADMIN'),
      ('uid-cashier-1', 'cashier_dz', 'cashier@palaisdor.dz', '$2b$10$abcdefghijklmnopqrstuv123456789012345678901234567890123', '5824', 'أمين الصندوق', 'CASHIER');

    INSERT INTO categories (name_ar, name_fr, sort_order, station)
    VALUES
      ('البيتزا', 'Pizzas', 1, 'MAIN_KITCHEN'),
      ('المشاوي واللحوم', 'Grillades', 2, 'GRILL');

    INSERT INTO products (category_id, name_ar, name_fr, price, cost_price, station)
    VALUES
      (1, 'بيتزا مارغريتا', 'Pizza Margherita', 500, 180, 'MAIN_KITCHEN'),
      (2, 'إسكالوب ماريني', 'Escalope Marinée', 400, 210, 'GRILL');

    INSERT INTO product_variants (product_id, name_ar, name_fr, price_adjustment)
    VALUES (1, 'XL', 'XL', 400);

    INSERT INTO price_history (product_id, old_price, new_price, changed_by_user_id, reason)
    VALUES (1, 450, 500, 1, 'تحديث التسعيرة التاريخية');

    INSERT INTO restaurant_tables (table_number, zone, capacity, status)
    VALUES ('1', 'الصالة الرئيسية', 4, 'AVAILABLE');

    INSERT INTO customers (name, phone, address, total_orders, total_spent)
    VALUES ('كريم بن علي', '0551234567', 'حسين داي، الجزائر', 1, 900);

    INSERT INTO suppliers (name, phone) VALUES ('مورد اللحوم الطازجة', '0770001122');

    INSERT INTO ingredients (name_ar, name_fr, unit, current_stock, min_stock, cost_per_unit, supplier_id)
    VALUES ('دقيق فاخر', 'Farine', 'KG', 42.5, 10, 85, 1);

    INSERT INTO product_recipes (product_id, ingredient_id, quantity)
    VALUES (1, 1, 0.25);

    INSERT INTO cash_shifts (shift_number, cashier_id, opening_cash, closing_cash, expected_cash, actual_cash, difference, total_cash_sales, status)
    VALUES ('SH-2026-001', 2, 10000, 10900, 10900, 10900, 0, 900, 'CLOSED');

    INSERT INTO cash_movements (shift_id, cashier_id, type, amount, reason)
    VALUES (1, 2, 'CASH_IN', 500, 'صرف فكة');

    INSERT INTO orders (order_number, daily_sequence, type, table_id, customer_id, status, subtotal, discount, delivery_fee, total, paid_amount, change_amount, payment_status, cashier_id)
    VALUES ('BON-0001', 1, 'DINE_IN', 1, 1, 'COMPLETED', 900, 0, 0, 900, 1000, 100, 'PAID', 2);

    INSERT INTO order_items (order_id, product_id, name_ar, name_fr, unit_price, cost_price, quantity, total, station, status)
    VALUES
      (1, 1, 'بيتزا مارغريتا', 'Pizza Margherita', 450, 180, 1, 450, 'MAIN_KITCHEN', 'SERVED'),
      (1, 2, 'إسكالوب ماريني', 'Escalope Marinée', 450, 210, 1, 450, 'GRILL', 'SERVED');

    INSERT INTO payments (order_id, method, amount, tender_amount, change_amount, cashier_id)
    VALUES (1, 'CASH', 900, 1000, 100, 2);

    INSERT INTO inventory_movements (ingredient_id, type, quantity, reference_type, reference_id, performed_by, notes)
    VALUES (1, 'SALE_DEDUCTION', -0.25, 'ORDER', 1, 2, 'خصم مبيعات BON-0001');

    INSERT INTO print_jobs (order_id, orderNumber, jobType, printerName, copies, paperWidth, status, isReprint, createdAt)
    VALUES (1, 'BON-0001', 'RECEIPT', 'XP-80C-CAISSE', 1, '80mm', 'PRINTED', 0, '2026-10-15 14:22:00');

    INSERT INTO audit_logs (user_id, user_name, action, entity_id, details)
    VALUES (1, 'مالك القصر الذهبي', 'HISTORICAL_CLOSING', 'SH-2026-001', 'سجل تدقيق تاريخي أصلي');
  `);
}

describe('Golden Palace POS — Phase 1 Database Safety, Canonical Path Policy & Migration Verification', () => {
  afterAll(async () => {
    try {
      const dbMod = await import('../db/index.ts');
      dbMod.closeDatabase();
    } catch {
      // ignore
    }
    fs.rmSync(PHASE1_ROOT, { recursive: true, force: true });
  });

  it('Canonical Path Policy: resolves single authoritative path per environment and never mixes dev & prod', async () => {
    const {
      resolveCanonicalDatabasePolicy,
      DEV_DB_FILENAME,
      PRODUCTION_DB_FILENAME,
    } = await import('../db/sqlitePath.ts');

    const prevSql = process.env.SQLITE_DB_PATH;
    const prevBackup = process.env.GOLDEN_PALACE_BACKUP_DIR;
    const prevMode = process.env.GOLDEN_PALACE_DB_MODE;
    const prevDesktop = process.env.GOLDEN_PALACE_DESKTOP;
    const prevNodeEnv = process.env.NODE_ENV;
    const prevXdg = process.env.XDG_DATA_HOME;

    try {
      delete process.env.SQLITE_DB_PATH;
      delete process.env.GOLDEN_PALACE_BACKUP_DIR;
      process.env.XDG_DATA_HOME = path.join(PHASE1_ROOT, 'xdg_policy_check');

      process.env.GOLDEN_PALACE_DESKTOP = '1';
      process.env.GOLDEN_PALACE_DB_MODE = 'production';
      const desktopPolicy = resolveCanonicalDatabasePolicy();
      expect(desktopPolicy.environment).toBe('desktop_production');
      expect(desktopPolicy.authoritativeDbFilename).toBe(PRODUCTION_DB_FILENAME);
      expect(path.basename(desktopPolicy.backupDir)).toBe('backups_production');
      expect(desktopPolicy.appDataDir).toContain('Golden Palace POS');

      delete process.env.GOLDEN_PALACE_DESKTOP;
      delete process.env.GOLDEN_PALACE_DB_MODE;
      process.env.NODE_ENV = 'development';
      const devPolicy = resolveCanonicalDatabasePolicy();
      expect(devPolicy.environment).toBe('development');
      expect(devPolicy.authoritativeDbFilename).toBe(DEV_DB_FILENAME);
      expect(path.basename(devPolicy.backupDir)).toBe('backups');
    } finally {
      if (prevSql !== undefined) process.env.SQLITE_DB_PATH = prevSql;
      if (prevBackup !== undefined) process.env.GOLDEN_PALACE_BACKUP_DIR = prevBackup;
      if (prevMode !== undefined) process.env.GOLDEN_PALACE_DB_MODE = prevMode;
      else delete process.env.GOLDEN_PALACE_DB_MODE;
      if (prevDesktop !== undefined) process.env.GOLDEN_PALACE_DESKTOP = prevDesktop;
      else delete process.env.GOLDEN_PALACE_DESKTOP;
      if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
      else delete process.env.NODE_ENV;
      if (prevXdg !== undefined) process.env.XDG_DATA_HOME = prevXdg;
      else delete process.env.XDG_DATA_HOME;
    }
  });

  it('Multi-DB Conflict Stop Guard: STOPS when both golden_palace.db and golden_palace_production.db exist, and STOPS when historical DB would be bypassed', async () => {
    const {
      assertNoDatabaseConflict,
      DatabaseConflictError,
    } = await import('../db/migrationManager.ts');

    // Case A: Both golden_palace.db and golden_palace_production.db exist with POS tables
    const conflictDirA = path.join(PHASE1_ROOT, 'conflict_both_exist');
    fs.mkdirSync(conflictDirA, { recursive: true });
    const devFileA = path.join(conflictDirA, 'golden_palace.db');
    const prodFileA = path.join(conflictDirA, 'golden_palace_production.db');

    const dbA1 = new Database(devFileA);
    createLegacyPrePhase09Schema(dbA1);
    seedRichRestaurantRecords(dbA1);
    dbA1.close();

    const dbA2 = new Database(prodFileA);
    createLegacyPrePhase09Schema(dbA2);
    dbA2.close();

    let caughtA: unknown = null;
    try {
      assertNoDatabaseConflict(prodFileA, { isProductionMode: true });
    } catch (err) {
      caughtA = err;
    }
    expect(caughtA).toBeInstanceOf(DatabaseConflictError);
    const conflictErrA = caughtA as InstanceType<typeof DatabaseConflictError>;
    expect(conflictErrA.code).toBe('DATABASE_CONFLICT_REQUIRES_OWNER_CONFIRMATION');
    expect(conflictErrA.report.reasonCode).toBe('MULTIPLE_POS_DATABASES');
    expect(conflictErrA.report.candidates.length).toBe(2);
    expect(conflictErrA.reportPath).toBeTruthy();
    expect(fs.existsSync(conflictErrA.reportPath!)).toBe(true);

    // Report must never expose passwords or PINs
    const reportJsonA = fs.readFileSync(conflictErrA.reportPath!, 'utf8');
    expect(reportJsonA).not.toContain('7391');
    expect(reportJsonA).not.toContain('password_hash');

    // Case B: Production DB does NOT exist, while populated historical golden_palace.db exists
    const conflictDirB = path.join(PHASE1_ROOT, 'conflict_historical_only');
    fs.mkdirSync(conflictDirB, { recursive: true });
    const devFileB = path.join(conflictDirB, 'golden_palace.db');
    const prodFileB = path.join(conflictDirB, 'golden_palace_production.db');

    const dbB = new Database(devFileB);
    createLegacyPrePhase09Schema(dbB);
    seedRichRestaurantRecords(dbB);
    dbB.close();

    let caughtB: unknown = null;
    try {
      assertNoDatabaseConflict(prodFileB, { isProductionMode: true });
    } catch (err) {
      caughtB = err;
    }
    expect(caughtB).toBeInstanceOf(DatabaseConflictError);
    const conflictErrB = caughtB as InstanceType<typeof DatabaseConflictError>;
    expect(conflictErrB.report.reasonCode).toBe('HISTORICAL_DB_WOULD_BE_BYPASSED');
    // Must NEVER have created an empty golden_palace_production.db
    expect(fs.existsSync(prodFileB)).toBe(false);

    // Case C: Explicit owner confirmation unlocks the chosen authoritative file safely
    const confirmed = assertNoDatabaseConflict(prodFileA, {
      isProductionMode: true,
      confirmedDbPath: prodFileA,
    });
    expect(confirmed.ok).toBe(true);
  });

  it('Scenario 1 (Fresh Installation): creates full schema, PRAGMA user_version=LATEST, schema_migrations ledger, WAL, FK=ON, integrity_check=ok, zero demo data', async () => {
    const {
      configureSqlitePragmas,
      ensureBaseSchema,
      LATEST_SCHEMA_VERSION,
      getSchemaVersion,
      verifyDatabaseIntegrity,
    } = await import('../db/index.ts');
    const { runVersionedMigrations } = await import('../db/migrationManager.ts');

    const freshDir = path.join(PHASE1_ROOT, 'scenario1_fresh');
    fs.mkdirSync(freshDir, { recursive: true });
    const freshPath = path.join(freshDir, 'golden_palace_production.db');
    const freshBackupDir = path.join(freshDir, 'backups_production');

    const db = new Database(freshPath);
    try {
      configureSqlitePragmas(db);
      const res = runVersionedMigrations(db, {
        dbPath: freshPath,
        backupDir: freshBackupDir,
        ensureBaseSchema,
      });

      expect(res.previousVersion).toBe(0);
      expect(res.currentVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(res.appliedVersions).toEqual([1, 2, 3, 4]);
      expect(res.preMigrationBackup).toBeNull(); // Empty fresh DB does not need pre-migration backup
      expect(res.integrityCheck).toBe('ok');
      expect(res.foreignKeyViolations).toEqual([]);
      expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);

      const ledger = db.prepare('SELECT version, status FROM schema_migrations ORDER BY version').all() as any[];
      expect(ledger.map((r) => [r.version, r.status])).toEqual([
        [1, 'APPLIED'],
        [2, 'APPLIED'],
        [3, 'APPLIED'],
        [4, 'APPLIED'],
      ]);

      const check = verifyDatabaseIntegrity(db);
      expect(check.ok).toBe(true);
      expect((db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c).toBe(0);
      expect((db.prepare('SELECT COUNT(*) as c FROM products').get() as any).c).toBe(0);
    } finally {
      db.close();
    }
  });

  it('Scenario 2 & 3 (Previous Schema Version + Existing Rich Restaurant Database): creates verified PRE_MIGRATION backup and preserves all 10 business entity groups intact', async () => {
    const {
      configureSqlitePragmas,
      ensureBaseSchema,
      migratePlaintextPins,
      isBcryptHash,
      LATEST_SCHEMA_VERSION,
      getSchemaVersion,
    } = await import('../db/index.ts');
    const { runVersionedMigrations, verifyDatabaseIntegrity } = await import('../db/migrationManager.ts');

    const dir = path.join(PHASE1_ROOT, 'scenario2_3_legacy_restaurant');
    fs.mkdirSync(dir, { recursive: true });
    const legacyPath = path.join(dir, 'golden_palace_production.db');
    const backupDir = path.join(dir, 'backups_production');

    const db = new Database(legacyPath);
    try {
      configureSqlitePragmas(db);
      createLegacyPrePhase09Schema(db);
      seedRichRestaurantRecords(db);
      expect(getSchemaVersion(db)).toBe(0);

      const result = runVersionedMigrations(db, {
        dbPath: legacyPath,
        backupDir,
        ensureBaseSchema,
      });

      // Automatic verified PRE_MIGRATION backup MUST have been created
      expect(result.preMigrationBackup).toBeTruthy();
      expect(fs.existsSync(result.preMigrationBackup!.backupPath)).toBe(true);
      expect(result.preMigrationBackup!.filename).toContain('_pre_migration_');
      expect(result.preMigrationBackup!.integrityCheck).toBe('ok');
      expect(result.preMigrationBackup!.foreignKeyViolations).toEqual([]);
      expect(result.currentVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(result.integrityCheck).toBe('ok');
      expect(result.foreignKeyViolations).toEqual([]);

      // Migrate legacy plaintext PINs safely
      const migratedPins = migratePlaintextPins(db);
      expect(migratedPins).toBe(2);

      // Verify ALL 10 historical entity groups remain 100% intact
      const users = db.prepare('SELECT username, pin, role, is_active FROM users ORDER BY id').all() as any[];
      expect(users.length).toBe(2);
      expect(users[0].username).toBe('owner_palace');
      expect(isBcryptHash(users[0].pin)).toBe(true);
      expect(users[0].is_active).toBe(1);

      const orders = db.prepare('SELECT order_number, total, paid_amount, discount_type FROM orders').all() as any[];
      expect(orders.length).toBe(1);
      expect(orders[0].order_number).toBe('BON-0001');
      expect(Number(orders[0].total)).toBe(900);

      const orderItems = db.prepare('SELECT name_ar, unit_price, quantity, total FROM order_items ORDER BY id').all() as any[];
      expect(orderItems.length).toBe(2);
      expect(Number(orderItems[0].unit_price)).toBe(450); // Historical sale price preserved despite catalog price=500

      const payments = db.prepare('SELECT method, amount, tender_amount, change_amount FROM payments').all() as any[];
      expect(payments.length).toBe(1);
      expect(Number(payments[0].amount)).toBe(900);

      const shifts = db.prepare('SELECT shift_number, opening_cash, closing_cash, total_cash_sales FROM cash_shifts').all() as any[];
      expect(shifts.length).toBe(1);
      expect(shifts[0].shift_number).toBe('SH-2026-001');

      const products = db.prepare('SELECT name_ar, price, is_active FROM products ORDER BY id').all() as any[];
      expect(products.length).toBe(2);
      expect(products[0].is_active).toBe(1);

      const categories = db.prepare('SELECT name_ar FROM categories ORDER BY id').all() as any[];
      expect(categories.length).toBe(2);

      const ingredients = db.prepare('SELECT name_ar, current_stock FROM ingredients').all() as any[];
      expect(ingredients.length).toBe(1);
      expect(Number(ingredients[0].current_stock)).toBe(42.5);

      const invMovements = db.prepare('SELECT type, quantity FROM inventory_movements').all() as any[];
      expect(invMovements.length).toBe(1);
      expect(Number(invMovements[0].quantity)).toBe(-0.25);

      const priceHist = db.prepare('SELECT old_price, new_price, reason FROM price_history').all() as any[];
      expect(priceHist.length).toBe(1);
      expect(Number(priceHist[0].old_price)).toBe(450);

      // Legacy camelCase print_jobs row reconciled cleanly into snake_case columns
      const printJobs = db.prepare('SELECT order_number, job_type, printer_name, paper_width, created_at FROM print_jobs').all() as any[];
      expect(printJobs.length).toBe(1);
      expect(printJobs[0].order_number).toBe('BON-0001');
      expect(printJobs[0].printer_name).toBe('XP-80C-CAISSE');
      expect(printJobs[0].paper_width).toBe('80mm');

      const audits = db.prepare('SELECT action, details FROM audit_logs').all() as any[];
      expect(audits.length).toBe(1);
      expect(audits[0].action).toBe('HISTORICAL_CLOSING');

      const postCheck = verifyDatabaseIntegrity(db);
      expect(postCheck.ok).toBe(true);
      expect(postCheck.integrityCheck).toBe('ok');
      expect(postCheck.foreignKeyViolations).toEqual([]);

      // Re-running migrations is a clean no-op with zero extra backups
      const secondRun = runVersionedMigrations(db, {
        dbPath: legacyPath,
        backupDir,
        ensureBaseSchema,
      });
      expect(secondRun.appliedVersions).toEqual([]);
      expect(secondRun.preMigrationBackup).toBeNull();
    } finally {
      db.close();
    }
  });

  it('Scenario 4 (Partially Migrated / Interrupted Migration Recovery): detects IN_PROGRESS ledger & half-applied schema, backs up, and completes cleanly', async () => {
    const {
      configureSqlitePragmas,
      ensureBaseSchema,
      LATEST_SCHEMA_VERSION,
    } = await import('../db/index.ts');
    const {
      runVersionedMigrations,
      ensureSchemaMigrationsTable,
      verifyDatabaseIntegrity,
    } = await import('../db/migrationManager.ts');

    const dir = path.join(PHASE1_ROOT, 'scenario4_partial_interrupted');
    fs.mkdirSync(dir, { recursive: true });
    const partialPath = path.join(dir, 'golden_palace_production.db');
    const backupDir = path.join(dir, 'backups_production');

    const db = new Database(partialPath);
    try {
      configureSqlitePragmas(db);
      createLegacyPrePhase09Schema(db);
      seedRichRestaurantRecords(db);

      // Simulate an interrupted migration halfway through v2:
      // - schema_migrations has v1 APPLIED and v2 IN_PROGRESS
      // - Only 2 of v2's columns were added before crash, PRAGMA user_version stuck at 1
      ensureSchemaMigrationsTable(db);
      db.exec(`ALTER TABLE users ADD COLUMN phone TEXT;`);
      db.exec(`ALTER TABLE orders ADD COLUMN tax_rate NUMERIC NOT NULL DEFAULT 0;`);
      db.prepare(`INSERT INTO schema_migrations (version, name, checksum, status) VALUES (1, '001_base_pos_schema', 'abc', 'APPLIED')`).run();
      db.prepare(`INSERT INTO schema_migrations (version, name, checksum, status) VALUES (2, '002_legacy_phase03_to_09_compatibility', 'def', 'IN_PROGRESS')`).run();
      db.pragma('user_version = 1');

      const res = runVersionedMigrations(db, {
        dbPath: partialPath,
        backupDir,
        ensureBaseSchema,
      });

      expect(res.interruptedRecoveryTriggered).toBe(true);
      expect(res.preMigrationBackup).toBeTruthy();
      expect(res.preMigrationBackup!.integrityCheck).toBe('ok');
      expect(res.currentVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(res.appliedVersions).toEqual([2, 3, 4]);

      const nonApplied = db.prepare("SELECT * FROM schema_migrations WHERE status != 'APPLIED'").all();
      expect(nonApplied).toEqual([]);
      expect((db.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c).toBe(1);
      expect(verifyDatabaseIntegrity(db).ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it('Scenario 5 (Corrupted Database): refuses migration explicitly, aborts without silent catch, and leaves corrupted file untouched for forensics', async () => {
    const { ensureBaseSchema } = await import('../db/index.ts');
    const { runVersionedMigrations, DatabaseMigrationError } = await import('../db/migrationManager.ts');

    const dir = path.join(PHASE1_ROOT, 'scenario5_corrupted');
    fs.mkdirSync(dir, { recursive: true });

    // 5A: Invalid non-SQLite bytes
    const garbagePath = path.join(dir, 'corrupted_header.db');
    const originalGarbage = Buffer.from('NOT_A_VALID_SQLITE_HEADER_CORRUPT_DATA_0000111122223333');
    fs.writeFileSync(garbagePath, originalGarbage);

    const garbageDb = new Database(garbagePath);
    try {
      expect(() =>
        runVersionedMigrations(garbageDb, {
          dbPath: garbagePath,
          backupDir: path.join(dir, 'backups'),
          ensureBaseSchema,
        })
      ).toThrow(DatabaseMigrationError);
    } finally {
      garbageDb.close();
    }
    // Original file bytes preserved untouched
    expect(fs.readFileSync(garbagePath).equals(originalGarbage)).toBe(true);

    // 5B: Valid SQLite header with corrupted internal data page
    const badPagePath = path.join(dir, 'corrupted_page.db');
    const validSeed = new Database(badPagePath);
    createLegacyPrePhase09Schema(validSeed);
    seedRichRestaurantRecords(validSeed);
    validSeed.close();

    const buf = fs.readFileSync(badPagePath);
    // Corrupt page 2 (offset 4096..4600) while keeping 100-byte SQLite header valid
    for (let i = 4096; i < Math.min(buf.length, 4600); i++) {
      buf[i] = 0xff;
    }
    fs.writeFileSync(badPagePath, buf);
    const snapshotBefore = fs.readFileSync(badPagePath);

    const corruptDb = new Database(badPagePath);
    let caughtErr: unknown = null;
    try {
      runVersionedMigrations(corruptDb, {
        dbPath: badPagePath,
        backupDir: path.join(dir, 'backups'),
        ensureBaseSchema,
      });
    } catch (err) {
      caughtErr = err;
    } finally {
      corruptDb.close();
    }

    expect(caughtErr).toBeInstanceOf(DatabaseMigrationError);
    expect((caughtErr as InstanceType<typeof DatabaseMigrationError>).code).toBe('DATABASE_CORRUPTED');
    expect(fs.readFileSync(badPagePath).equals(snapshotBefore)).toBe(true);
  });

  it('Scenario 6 (Existing Users, Orders, Cash Shifts & Payments with Active WAL): checkpoints WAL cleanly into PRE_MIGRATION backup and preserves every record', async () => {
    const {
      configureSqlitePragmas,
      ensureBaseSchema,
      LATEST_SCHEMA_VERSION,
    } = await import('../db/index.ts');
    const { runVersionedMigrations } = await import('../db/migrationManager.ts');

    const dir = path.join(PHASE1_ROOT, 'scenario6_wal_active');
    fs.mkdirSync(dir, { recursive: true });
    const walDbPath = path.join(dir, 'golden_palace_production.db');
    const backupDir = path.join(dir, 'backups_production');

    const db = new Database(walDbPath);
    try {
      configureSqlitePragmas(db);
      // Disable autocheckpoint so newly inserted financial records sit in -wal
      db.pragma('wal_autocheckpoint = 0');
      createLegacyPrePhase09Schema(db);
      seedRichRestaurantRecords(db);
      // Add an extra order & payment in WAL right before migration
      db.exec(`
        INSERT INTO orders (order_number, daily_sequence, type, status, subtotal, total, paid_amount, payment_status, cashier_id)
        VALUES ('BON-WAL-002', 2, 'TAKEAWAY', 'COMPLETED', 1200, 1200, 1200, 'PAID', 2);
        INSERT INTO payments (order_id, method, amount, tender_amount, change_amount, cashier_id)
        VALUES (2, 'CARD', 1200, 1200, 0, 2);
      `);
      expect(fs.existsSync(`${walDbPath}-wal`)).toBe(true);

      const res = runVersionedMigrations(db, {
        dbPath: walDbPath,
        backupDir,
        ensureBaseSchema,
      });

      expect(res.currentVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(res.preMigrationBackup).toBeTruthy();

      // Verify the PRE_MIGRATION backup captured the WAL-only BON-WAL-002 order & payment!
      const bakDb = new Database(res.preMigrationBackup!.backupPath, { readonly: true });
      try {
        expect((bakDb.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c).toBe(2);
        expect((bakDb.prepare("SELECT COUNT(*) as c FROM orders WHERE order_number = 'BON-WAL-002'").get() as any).c).toBe(1);
        expect((bakDb.prepare('SELECT COUNT(*) as c FROM payments').get() as any).c).toBe(2);
        expect((bakDb.prepare('SELECT COUNT(*) as c FROM cash_shifts').get() as any).c).toBe(1);
      } finally {
        bakDb.close();
      }

      // Live DB also has all records intact
      expect((db.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c).toBe(2);
      expect((db.prepare('SELECT COUNT(*) as c FROM payments').get() as any).c).toBe(2);
    } finally {
      db.close();
    }
  });

  it('Scenario 7 (Migration Failure & Automatic Rollback): aborts explicitly with zero silent swallowing and restores exact pre-migration state from verified backup', async () => {
    const {
      configureSqlitePragmas,
      ensureBaseSchema,
      getSchemaVersion,
    } = await import('../db/index.ts');
    const {
      runVersionedMigrations,
      buildStandardMigrations,
      verifyDatabaseIntegrity,
      DatabaseMigrationError,
    } = await import('../db/migrationManager.ts');

    const dir = path.join(PHASE1_ROOT, 'scenario7_failure_rollback');
    fs.mkdirSync(dir, { recursive: true });
    const rollbackPath = path.join(dir, 'golden_palace_production.db');
    const backupDir = path.join(dir, 'backups_production');

    const db = new Database(rollbackPath);
    configureSqlitePragmas(db);
    createLegacyPrePhase09Schema(db);
    seedRichRestaurantRecords(db);

    const standardSteps = buildStandardMigrations(ensureBaseSchema);
    // Inject a failing v5 step AFTER v1-v4 already mutated the database
    const stepsWithFailure = [
      ...standardSteps,
      {
        version: 5,
        name: '005_simulated_fatal_ddl_error',
        description: 'Simulates an unexpected DDL failure mid-upgrade to verify explicit abort & automatic rollback',
        apply: (target: Database.Database) => {
          target.exec('ALTER TABLE non_existent_table_boom ADD COLUMN broken TEXT;');
        },
      },
    ];

    let caught: unknown = null;
    try {
      runVersionedMigrations(db, {
        dbPath: rollbackPath,
        backupDir,
        ensureBaseSchema,
        migrations: stepsWithFailure,
        closeHandleOnRollback: () => {
          if (db.open) db.close();
        },
      });
    } catch (err) {
      caught = err;
    } finally {
      if (db.open) db.close();
    }

    expect(caught).toBeInstanceOf(DatabaseMigrationError);
    const migErr = caught as InstanceType<typeof DatabaseMigrationError>;
    expect(migErr.code).toBe('MIGRATION_FAILED');
    expect(migErr.version).toBe(5);
    expect(migErr.rolledBack).toBe(true);
    expect(migErr.preMigrationBackupPath).toBeTruthy();
    expect(fs.existsSync(migErr.preMigrationBackupPath!)).toBe(true);

    // Reopen rolled-back DB and verify it is 100% restored to exact pre-migration state (user_version=0, zero v2/v3 mutations, all original rows intact)
    const verifiedAfterRollback = new Database(rollbackPath, { readonly: true });
    try {
      const integrity = verifyDatabaseIntegrity(verifiedAfterRollback);
      expect(integrity.ok).toBe(true);
      expect(integrity.integrityCheck).toBe('ok');
      expect(integrity.foreignKeyViolations).toEqual([]);
      expect(getSchemaVersion(verifiedAfterRollback)).toBe(0);

      // Verify schema_migrations table was rolled back away and all original data is preserved
      const hasLedger = verifiedAfterRollback
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
        .get();
      expect(hasLedger).toBeUndefined();
      expect((verifiedAfterRollback.prepare('SELECT COUNT(*) as c FROM users').get() as any).c).toBe(2);
      expect((verifiedAfterRollback.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c).toBe(1);
      expect((verifiedAfterRollback.prepare('SELECT COUNT(*) as c FROM payments').get() as any).c).toBe(1);
      expect((verifiedAfterRollback.prepare('SELECT COUNT(*) as c FROM cash_shifts').get() as any).c).toBe(1);
    } finally {
      verifiedAfterRollback.close();
    }
  });
});
