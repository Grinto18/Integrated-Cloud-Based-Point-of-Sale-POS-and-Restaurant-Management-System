// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase6_backend_'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'phase6_isolated.db');
process.env.SQLITE_DB_PATH = TEST_DB_PATH;

let app: express.Express;
let sqlite: any;
let runSafeMigrations: any;
let isBcryptHash: any;
let signUserToken: any;
let clearRateLimitsForTest: any;

let adminToken: string;
let cashierToken: string;
let adminUserRow: any;

async function bootstrapServer() {
  const dbMod = await import('../db/index.ts');
  sqlite = dbMod.sqlite;
  runSafeMigrations = dbMod.runSafeMigrations;
  isBcryptHash = dbMod.isBcryptHash;

  const { seedDatabase } = await import('../db/seed.ts');
  await seedDatabase();

  const authMod = await import('../middleware/auth.ts');
  signUserToken = authMod.signUserToken;

  const rateMod = await import('../middleware/rateLimit.ts');
  clearRateLimitsForTest = rateMod.clearRateLimitsForTest;

  const { apiRouter } = await import('../server/api.ts');
  const nextApp = express();
  nextApp.use(express.json());
  nextApp.use('/api', apiRouter);
  app = nextApp;

  const makeToken = (u: any) =>
    signUserToken({
      id: u.id,
      uid: u.uid,
      username: u.username,
      email: u.email,
      role: u.role,
      fullName: u.full_name,
    });

  adminUserRow = sqlite.prepare("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1").get();
  adminToken = makeToken(adminUserRow);

  let cashierRow = sqlite.prepare("SELECT * FROM users WHERE role = 'CASHIER' LIMIT 1").get();
  if (!cashierRow) {
    const info = sqlite
      .prepare(
        `INSERT INTO users (uid, username, email, password_hash, role, full_name, is_active)
         VALUES ('uid-cash-p6', 'cashier_p6', 'cashier_p6@test.local', 'hash', 'CASHIER', 'كاشير 6', 1)`
      )
      .run();
    cashierRow = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }
  cashierToken = makeToken(cashierRow);
}

describe('Golden Palace POS — Phase 06 Backoffice & Compatibility Tests (Backend)', () => {
  beforeAll(async () => {
    await bootstrapServer();
    expect(sqlite.name).toBe(TEST_DB_PATH);
    expect(sqlite.name).not.toContain('golden_palace.db');
  });

  beforeEach(() => {
    clearRateLimitsForTest?.();
  });

  afterAll(() => {
    try {
      sqlite?.close();
    } catch {
      // ignore
    }
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  describe('Legacy Schema Compatibility & Safe Migration', () => {
    it('safely upgrades a legacy database in tmpdir without data loss and passes PRAGMA integrity_check', () => {
      const legacyPath = path.join(TEST_DB_DIR, 'legacy_v1_clone.db');
      const legacyDb = new Database(legacyPath);

      legacyDb.exec(`
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_number TEXT NOT NULL UNIQUE,
          total NUMERIC NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE ingredients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name_ar TEXT NOT NULL,
          current_stock NUMERIC NOT NULL DEFAULT 0,
          min_stock NUMERIC NOT NULL DEFAULT 5
        );
        CREATE TABLE audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          details TEXT
        );
        CREATE TABLE print_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER,
          orderNumber TEXT NOT NULL,
          jobType TEXT NOT NULL DEFAULT 'RECEIPT',
          printerName TEXT NOT NULL DEFAULT 'CAFETERIA',
          copies INTEGER NOT NULL DEFAULT 1,
          paperWidth TEXT NOT NULL DEFAULT '80mm',
          status TEXT NOT NULL DEFAULT 'COMPLETED',
          errorMessage TEXT,
          isReprint INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT DEFAULT (datetime('now'))
        );
      `);

      legacyDb.prepare("INSERT INTO orders (order_number, total) VALUES ('ORD-LEGACY-01', 2500)").run();
      legacyDb
        .prepare("INSERT INTO print_jobs (order_id, orderNumber, jobType, printerName, paperWidth, status) VALUES (1, 'ORD-LEGACY-01', 'RECEIPT', 'EPSON-TM', '80mm', 'COMPLETED')")
        .run();

      runSafeMigrations(legacyDb);

      const integrity = legacyDb.pragma('integrity_check') as { integrity_check: string }[];
      expect(integrity[0].integrity_check).toBe('ok');

      const orderCols = (legacyDb.pragma('table_info(orders)') as any[]).map((c) => c.name);
      expect(orderCols).toContain('tax_rate');
      expect(orderCols).toContain('tax_amount');
      expect(orderCols).toContain('shift_id');

      const ingCols = (legacyDb.pragma('table_info(ingredients)') as any[]).map((c) => c.name);
      expect(ingCols).toContain('max_stock');

      const auditCols = (legacyDb.pragma('table_info(audit_logs)') as any[]).map((c) => c.name);
      expect(auditCols).toContain('entity_type');

      const pjCols = (legacyDb.pragma('table_info(print_jobs)') as any[]).map((c) => c.name);
      expect(pjCols).toContain('order_number');
      expect(pjCols).toContain('job_type');
      expect(pjCols).toContain('printer_name');

      const legacyOrder = legacyDb.prepare("SELECT * FROM orders WHERE order_number = 'ORD-LEGACY-01'").get() as any;
      expect(legacyOrder).toBeTruthy();
      expect(Number(legacyOrder.total)).toBe(2500);
      expect(Number(legacyOrder.tax_rate)).toBe(0);

      const migratedJob = legacyDb.prepare('SELECT * FROM print_jobs WHERE id = 1').get() as any;
      expect(migratedJob.order_number).toBe('ORD-LEGACY-01');
      expect(migratedJob.printer_name).toBe('EPSON-TM');

      legacyDb.close();
    });
  });

  describe('Menu & Categories CRUD + Enriched Recipes + Soft Delete', () => {
    it('supports updating & soft-disabling categories, returning enriched recipe ingredients, logging price history, and soft-deleting products without breaking order_items', async () => {
      // 1. Create and edit category
      const catCreate = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nameAr: 'أطباق موسمية', nameFr: 'Plats saisonniers', station: 'MAIN_KITCHEN' });
      expect(catCreate.status).toBe(201);
      const catId = catCreate.body.id;

      const catUpdate = await request(app)
        .put(`/api/categories/${catId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nameAr: 'أطباق رئيسية فاخرة', nameFr: 'Plats Prestige', station: 'GRILL', isActive: true });
      expect(catUpdate.status).toBe(200);
      expect(catUpdate.body.nameFr).toBe('Plats Prestige');
      expect(catUpdate.body.station).toBe('GRILL');

      // 2. Create ingredient & product with recipe
      const ingRes = await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nameAr: 'لحم خروف طازج',
          nameFr: 'Agneau frais',
          unit: 'KG',
          openingStock: 12,
          minStock: 2,
          maxStock: 40,
          costPerUnit: 2200,
        });
      expect(ingRes.status).toBe(201);
      const ingId = ingRes.body.id;

      const prodRes = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId: catId,
          nameAr: 'مشوي ملكي',
          nameFr: 'Méchoui Royal',
          price: 2500,
          costPrice: 1100,
          station: 'GRILL',
          recipes: [{ ingredientId: ingId, quantity: 0.5 }],
        });
      expect(prodRes.status).toBe(201);
      const prodId = prodRes.body.id;

      // 3. GET /products includes enriched recipe ingredient metadata
      const listRes = await request(app)
        .get('/api/products')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      const foundProd = listRes.body.find((p: any) => p.id === prodId);
      expect(foundProd).toBeTruthy();
      expect(foundProd.recipes.length).toBe(1);
      expect(foundProd.recipes[0].ingredientName).toBe('لحم خروف طازج');
      expect(Number(foundProd.recipes[0].ingredientCostPerUnit)).toBe(2200);

      // 4. Price update writes price_history
      const updProd = await request(app)
        .put(`/api/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 2800, reasonForPriceChange: 'Season tariff' });
      expect(updProd.status).toBe(200);

      const histRes = await request(app)
        .get(`/api/products/${prodId}/price-history`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(histRes.status).toBe(200);
      expect(histRes.body.length).toBeGreaterThanOrEqual(1);
      expect(Number(histRes.body[0].newPrice)).toBe(2800);

      // 5. Place order with prodId, then soft-delete product -> order_items preserved & product unavailable
      await request(app)
        .post('/api/cash-register/open')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ openingCash: 5000 });

      const ordRes = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          type: 'TAKEAWAY',
          items: [{ productId: prodId, quantity: 1 }],
          idempotencyKey: 'p6-menu-soft-del-ord',
        });
      expect(ordRes.status).toBe(201);

      const delProd = await request(app)
        .delete(`/api/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(delProd.status).toBe(200);
      expect(delProd.body.softDeleted).toBe(true);
      const dbProdAfterDel = sqlite.prepare('SELECT is_available FROM products WHERE id = ?').get(prodId);
      expect(dbProdAfterDel.is_available).toBe(0);

      const orderItemRow = sqlite.prepare('SELECT * FROM order_items WHERE product_id = ?').get(prodId);
      expect(orderItemRow).toBeTruthy();

      // 6. Soft-disable category
      const delCat = await request(app)
        .delete(`/api/categories/${catId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(delCat.status).toBe(200);
      expect(delCat.body.success).toBe(true);
      const dbCatAfterDel = sqlite.prepare('SELECT is_active FROM categories WHERE id = ?').get(catId);
      expect(dbCatAfterDel.is_active).toBe(0);
    });
  });

  describe('Inventory Opening Stock, Edit & Movements Ledger', () => {
    it('creates OPENING_STOCK movement on POST /inventory, updates thresholds on PUT, filters /inventory/movements, and enforces RBAC', async () => {
      // Cashier blocked 403
      const forbid = await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ nameAr: 'غير مسموح', openingStock: 5 });
      expect(forbid.status).toBe(403);

      const created = await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nameAr: 'دقيق ممتاز',
          nameFr: 'Farine T45',
          unit: 'KG',
          openingStock: 25,
          minStock: 5,
          maxStock: 50,
          costPerUnit: 120,
        });
      expect(created.status).toBe(201);
      expect(Number(created.body.currentStock)).toBe(25);
      expect(Number(created.body.maxStock)).toBe(50);

      const ingId = created.body.id;

      // PUT validation: maxStock < minStock -> 400
      const badUpd = await request(app)
        .put(`/api/inventory/${ingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ minStock: 30, maxStock: 10 });
      expect(badUpd.status).toBe(400);

      // Valid PUT update
      const okUpd = await request(app)
        .put(`/api/inventory/${ingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nameFr: 'Farine Fine', minStock: 8, maxStock: 80, costPerUnit: 135 });
      expect(okUpd.status).toBe(200);
      expect(okUpd.body.nameFr).toBe('Farine Fine');
      expect(Number(okUpd.body.minStock)).toBe(8);

      // Movements filter by ingredientId & OPENING_STOCK
      const movRes = await request(app)
        .get(`/api/inventory/movements?ingredientId=${ingId}&type=OPENING_STOCK`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(movRes.status).toBe(200);
      expect(movRes.body.length).toBe(1);
      expect(movRes.body[0].type).toBe('OPENING_STOCK');
      expect(Number(movRes.body[0].quantity)).toBe(25);
    });
  });

  describe('Staff RBAC Management, PIN Reset & Sole Admin Safeguard', () => {
    it('prevents disabling sole active ADMIN, resets PIN securely with bcrypt, detects collisions, blocks inactive user logins, and leaves no plaintext PINs in responses or audit logs', async () => {
      // Attempt disabling sole active ADMIN -> 400
      const disableSoleAdmin = await request(app)
        .put(`/api/users/${adminUserRow.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });
      expect(disableSoleAdmin.status).toBe(400);

      // Create new staff member
      const createStaff = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'staff_phase6',
          email: 'staff6@goldenpalace.dz',
          fullName: 'موظف اختبار 6',
          password: 'Password123!',
          pin: '7788',
          role: 'CASHIER',
        });
      expect(createStaff.status).toBe(201);
      const staffId = createStaff.body.id;
      expect(createStaff.body.pin).toBeUndefined();
      expect(createStaff.body.passwordHash).toBeUndefined();

      // Update role & email
      const updStaff = await request(app)
        .put(`/api/users/${staffId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'staff6.updated@goldenpalace.dz', role: 'MANAGER' });
      expect(updStaff.status).toBe(200);
      expect(updStaff.body.email).toBe('staff6.updated@goldenpalace.dz');
      expect(updStaff.body.role).toBe('MANAGER');

      // Reset PIN to 8899 -> stored bcrypt & never leaked
      const secretPin = '8899';
      const resetPinRes = await request(app)
        .put(`/api/users/${staffId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pin: secretPin });
      expect(resetPinRes.status).toBe(200);
      expect(resetPinRes.body.hasPin).toBe(true);
      expect(JSON.stringify(resetPinRes.body)).not.toContain(secretPin);

      const dbUser = sqlite.prepare('SELECT pin FROM users WHERE id = ?').get(staffId);
      expect(isBcryptHash(dbUser.pin)).toBe(true);

      const pinAudit = sqlite
        .prepare("SELECT * FROM audit_logs WHERE action = 'RESET_STAFF_PIN' AND entity_id = ? ORDER BY id DESC LIMIT 1")
        .get(String(staffId));
      expect(pinAudit).toBeTruthy();
      expect(pinAudit.details).not.toContain(secretPin);

      // PIN collision on another user -> 409
      const collisionRes = await request(app)
        .put(`/api/users/${adminUserRow.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pin: secretPin });
      expect(collisionRes.status).toBe(409);

      // Disable staff user -> login must fail
      const toggleOff = await request(app)
        .put(`/api/users/${staffId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });
      expect(toggleOff.status).toBe(200);
      expect(toggleOff.body.isActive).toBe(false);

      const pinLoginDisabled = await request(app)
        .post('/api/auth/pin-login')
        .send({ pin: secretPin });
      expect(pinLoginDisabled.status).toBe(403);
    });
  });

  describe('Settings Persistence & Strict Audit Log Immutability + Pagination', () => {
    it('validates & saves settings, filters & paginates audit logs, and blocks audit log mutation/deletion', async () => {
      // Invalid tax_rate & invalid default_language -> 400
      const badTax = await request(app)
        .post('/api/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tax_rate: '150' });
      expect(badTax.status).toBe(400);

      const badLang = await request(app)
        .post('/api/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ default_language: 'es' });
      expect(badLang.status).toBe(400);

      // Valid settings update
      const okSet = await request(app)
        .post('/api/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tax_rate: '19',
          default_language: 'fr',
          low_stock_alert_threshold: '10',
          receipt_footer: 'Golden Palace • Merci',
        });
      expect(okSet.status).toBe(200);

      const fetched = await request(app)
        .get('/api/settings')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body.tax_rate).toBe('19');
      expect(fetched.body.default_language).toBe('fr');
      expect(fetched.body.receipt_footer).toBe('Golden Palace • Merci');

      // Paginated audit logs + search/action filters
      const auditPage = await request(app)
        .get('/api/audit-logs?paginated=true&page=1&limit=3&action=UPDATE_SETTINGS')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(auditPage.status).toBe(200);
      expect(Array.isArray(auditPage.body.items)).toBe(true);
      expect(auditPage.body.items.length).toBeGreaterThanOrEqual(1);
      expect(auditPage.body.items.every((r: any) => r.action === 'UPDATE_SETTINGS')).toBe(true);
      expect(auditPage.body.page).toBe(1);
      expect(auditPage.body.limit).toBe(3);

      // Strict immutability: no PUT, PATCH, DELETE allowed on audit-logs
      const putRes = await request(app)
        .put('/api/audit-logs/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ details: 'tamper' });
      expect(putRes.status).toBe(404);

      const patchRes = await request(app)
        .patch('/api/audit-logs/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ details: 'tamper' });
      expect(patchRes.status).toBe(404);

      const delRes = await request(app)
        .delete('/api/audit-logs/1')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(delRes.status).toBe(404);
    });
  });
});
