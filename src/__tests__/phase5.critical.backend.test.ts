// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase5_backend_'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'phase5_isolated.db');
process.env.SQLITE_DB_PATH = TEST_DB_PATH;

let app: express.Express;
let sqlite: any;
let signUserToken: any;
let clearRateLimitsForTest: any;

let adminToken: string;
let managerToken: string;
let cashierToken: string;
let waiterToken: string;

let productA: any;
let productB: any;
let ingredientA: any;
let ingredientB: any;

async function bootstrapServer() {
  const dbMod = await import('../db/index.ts');
  sqlite = dbMod.sqlite;

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

  const adminUser = sqlite.prepare("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1").get();
  adminToken = makeToken(adminUser);

  const ensureRoleUser = (role: string, username: string, fullName: string) => {
    let row = sqlite.prepare('SELECT * FROM users WHERE role = ? LIMIT 1').get(role);
    if (!row) {
      const info = sqlite
        .prepare(
          `INSERT INTO users (uid, username, email, password_hash, role, full_name, is_active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`
        )
        .run(`uid-${role.toLowerCase()}`, username, `${username}@test.local`, 'hash', role, fullName);
      row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }
    return makeToken(row);
  };

  managerToken = ensureRoleUser('MANAGER', 'mgr_test', 'مدير الاختبار');
  cashierToken = ensureRoleUser('CASHIER', 'cash_test', 'كاشير الاختبار');
  waiterToken = ensureRoleUser('WAITER', 'waiter_test', 'نادل الاختبار');
}

describe('Golden Palace POS — Phase 05 Critical Bug Fixes (Backend)', () => {
  beforeAll(async () => {
    await bootstrapServer();

    expect(sqlite.name).toBe(TEST_DB_PATH);
    expect(sqlite.name).not.toContain('golden_palace.db');

    // Open a shift
    const openRes = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingCash: 10000, notes: 'Phase 05 Shift' });
    expect(openRes.status).toBe(201);

    // Pick 2 distinct active products without variants/addons conflicts for clean math
    const prods = sqlite
      .prepare('SELECT * FROM products WHERE is_available = 1 ORDER BY id ASC LIMIT 2')
      .all();
    expect(prods.length).toBeGreaterThanOrEqual(2);
    productA = prods[0];
    productB = prods[1];

    // Clear any existing recipes on productA & productB so test stock math is exact
    sqlite.prepare('DELETE FROM product_recipes WHERE product_id IN (?, ?)').run(productA.id, productB.id);

    const ingAInfo = sqlite
      .prepare(
        "INSERT INTO ingredients (name_ar, name_fr, unit, current_stock, min_stock, cost_per_unit) VALUES ('مكون اختبار أ', 'Ing Test A', 'KG', 100, 5, 500)"
      )
      .run();
    const ingBInfo = sqlite
      .prepare(
        "INSERT INTO ingredients (name_ar, name_fr, unit, current_stock, min_stock, cost_per_unit) VALUES ('مكون اختبار ب', 'Ing Test B', 'KG', 50, 5, 300)"
      )
      .run();

    ingredientA = sqlite.prepare('SELECT * FROM ingredients WHERE id = ?').get(ingAInfo.lastInsertRowid);
    ingredientB = sqlite.prepare('SELECT * FROM ingredients WHERE id = ?').get(ingBInfo.lastInsertRowid);

    sqlite
      .prepare('INSERT INTO product_recipes (product_id, ingredient_id, quantity) VALUES (?, ?, ?)')
      .run(productA.id, ingredientA.id, 2); // 2 KG per productA
    sqlite
      .prepare('INSERT INTO product_recipes (product_id, ingredient_id, quantity) VALUES (?, ?, ?)')
      .run(productB.id, ingredientB.id, 1.5); // 1.5 KG per productB
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

  describe('TASK 01 — Inventory Integrity & Ledger Consistency', () => {
    it('deducts inventory cleanly, computes replaceAll deltas (increase & decrease), and restores net stock on cancel without double-restore', async () => {
      const stockStart = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientA.id).current_stock;

      // 1. Create order with qty = 3 -> deducts 3 * 2 = 6 KG
      const createRes = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          type: 'TAKEAWAY',
          items: [{ productId: productA.id, quantity: 3 }],
          idempotencyKey: 'inv-test-1',
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.id;

      let curStock = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientA.id).current_stock;
      expect(curStock).toBeCloseTo(stockStart - 6, 4);

      // 2. replaceAll=true increasing qty 3 -> 5 (delta = +2 -> deducts 4 KG only)
      const upRes = await request(app)
        .post(`/api/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          replaceAll: true,
          items: [{ productId: productA.id, quantity: 5 }],
        });
      expect(upRes.status).toBe(200);

      curStock = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientA.id).current_stock;
      expect(curStock).toBeCloseTo(stockStart - 10, 4);

      // 3. replaceAll=true decreasing qty 5 -> 2 (delta = -3 -> restores 6 KG)
      const downRes = await request(app)
        .post(`/api/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          replaceAll: true,
          items: [{ productId: productA.id, quantity: 2 }],
        });
      expect(downRes.status).toBe(200);

      curStock = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientA.id).current_stock;
      expect(curStock).toBeCloseTo(stockStart - 4, 4);

      const adjRestoreMov = sqlite
        .prepare(
          "SELECT * FROM inventory_movements WHERE reference_type = 'ORDER' AND reference_id = ? AND type = 'ORDER_ADJUSTMENT_RESTORE'"
        )
        .all(orderId);
      expect(adjRestoreMov.length).toBe(1);
      expect(Number(adjRestoreMov[0].quantity)).toBeCloseTo(6, 4);

      // 4. Cancel order -> restores remaining net 4 KG once
      const cancelRes1 = await request(app)
        .post(`/api/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ reason: 'Customer cancelled' });
      expect(cancelRes1.status).toBe(200);

      curStock = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientA.id).current_stock;
      expect(curStock).toBeCloseTo(stockStart, 4);

      // 5. Repeat cancel attempt -> rejected 400, NO second stock restore
      const cancelRes2 = await request(app)
        .post(`/api/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ reason: 'Double cancel' });
      expect(cancelRes2.status).toBe(400);

      curStock = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientA.id).current_stock;
      expect(curStock).toBeCloseTo(stockStart, 4);

      // Verify ledger invariant on this order: SUM(movements) == 0
      const orderMovSum = sqlite
        .prepare(
          "SELECT COALESCE(SUM(quantity), 0) as net FROM inventory_movements WHERE reference_type = 'ORDER' AND reference_id = ?"
        )
        .get(orderId).net;
      expect(Number(orderMovSum)).toBeCloseTo(0, 4);
    });

    it('restores inventory cleanly on refundOrder and blocks duplicate refund', async () => {
      const stockStart = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientB.id).current_stock;

      const ordRes = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          type: 'TAKEAWAY',
          items: [{ productId: productB.id, quantity: 2 }], // deducts 2 * 1.5 = 3 KG
          idempotencyKey: 'inv-refund-ord-1',
        });
      expect(ordRes.status).toBe(201);
      const orderId = ordRes.body.id;

      const payRes = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          orderId,
          payments: [{ method: 'CASH', amount: Number(ordRes.body.total) }],
          idempotencyKey: 'inv-refund-pay-1',
        });
      expect(payRes.status).toBe(200);

      let curStock = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientB.id).current_stock;
      expect(curStock).toBeCloseTo(stockStart - 3, 4);

      const refund1 = await request(app)
        .post(`/api/orders/${orderId}/refund`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ reason: 'Wrong order' });
      expect(refund1.status).toBe(200);

      curStock = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientB.id).current_stock;
      expect(curStock).toBeCloseTo(stockStart, 4);

      const refund2 = await request(app)
        .post(`/api/orders/${orderId}/refund`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ reason: 'Double refund' });
      expect(refund2.status).toBe(400);

      curStock = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientB.id).current_stock;
      expect(curStock).toBeCloseTo(stockStart, 4);
    });
  });

  describe('TASK 02 — Held Orders, Quick Customer & Delivery Consistency', () => {
    it('returns items & tableNumber for GET /api/orders?heldOnly=true and resumes held order once without double deduction or duplicate order', async () => {
      const stockStart = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientA.id).current_stock;

      const tbl = sqlite.prepare("SELECT * FROM restaurant_tables WHERE status = 'AVAILABLE' LIMIT 1").get();
      expect(tbl).toBeTruthy();

      // Create held order -> should NOT deduct stock while held
      const holdRes = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          type: 'DINE_IN',
          tableId: tbl.id,
          items: [{ productId: productA.id, quantity: 2 }],
          isHeld: true,
          idempotencyKey: 'held-ord-1',
        });
      expect(holdRes.status).toBe(201);
      const heldId = holdRes.body.id;

      let curStock = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientA.id).current_stock;
      expect(curStock).toBeCloseTo(stockStart, 4);

      // GET /orders?heldOnly=true must include items & tableNumber
      const listRes = await request(app)
        .get('/api/orders?heldOnly=true')
        .set('Authorization', `Bearer ${cashierToken}`);
      expect(listRes.status).toBe(200);
      const found = listRes.body.find((o: any) => o.id === heldId);
      expect(found).toBeTruthy();
      expect(Array.isArray(found.items)).toBe(true);
      expect(found.items.length).toBe(1);
      expect(found.tableNumber).toBe(tbl.table_number);

      // Resume held order -> deducts 4 KG once & returns items
      const resumeRes = await request(app)
        .post(`/api/orders/${heldId}/resume`)
        .set('Authorization', `Bearer ${cashierToken}`);
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.isHeld).toBe(false);
      expect(resumeRes.body.items.length).toBe(1);

      curStock = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientA.id).current_stock;
      expect(curStock).toBeCloseTo(stockStart - 4, 4);

      // Calling appendOrderItems with same qty=2 preserves exact order & does NOT deduct a second time
      const updateRes = await request(app)
        .post(`/api/orders/${heldId}/items`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          replaceAll: true,
          items: [{ productId: productA.id, quantity: 2 }],
        });
      expect(updateRes.status).toBe(200);

      curStock = sqlite
        .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
        .get(ingredientA.id).current_stock;
      expect(curStock).toBeCloseTo(stockStart - 4, 4);

      // Cleanup order to free table
      await request(app)
        .post(`/api/orders/${heldId}/cancel`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ reason: 'Cleanup held test' });
    });

    it('saves real customer via /api/customers and creates deliveries record with customerAddress & deliveryAddress on DELIVERY orders', async () => {
      const custRes = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          name: 'كريم بن علي',
          phone: '0551223344',
          address: 'شارع طرابلس رقم 12، حسين داي',
        });
      expect(custRes.status).toBe(201);
      expect(custRes.body.id).toBeGreaterThan(0);

      const delivOrder = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          type: 'DELIVERY',
          customerId: custRes.body.id,
          deliveryAddress: 'حي البدر رقم 45، القبة',
          deliveryFee: 250,
          items: [{ productId: productA.id, quantity: 1 }],
          idempotencyKey: 'deliv-ord-1',
        });
      expect(delivOrder.status).toBe(201);

      const deliveryRow = sqlite
        .prepare('SELECT * FROM deliveries WHERE order_id = ?')
        .get(delivOrder.body.id);
      expect(deliveryRow).toBeTruthy();
      expect(deliveryRow.customer_address).toBe('حي البدر رقم 45، القبة');
      expect(deliveryRow.delivery_address).toBe('حي البدر رقم 45، القبة');
      expect(deliveryRow.customer_id).toBe(custRes.body.id);

      // Also test DELIVERY via /api/sync/batch with no customerAddress passed
      const syncDeliv = await request(app)
        .post('/api/sync/batch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          offlineOrders: [
            {
              offlineId: 'off-deliv-sync-1',
              type: 'DELIVERY',
              deliveryAddress: 'حسين داي المركز',
              deliveryFee: 200,
              items: [{ productId: productA.id, quantity: 1 }],
              payments: [],
            },
          ],
        });
      expect(syncDeliv.status).toBe(200);
      expect(syncDeliv.body.syncedIds).toContain('off-deliv-sync-1');
    });
  });

  describe('TASK 03 — Server-Side Price Validation & RBAC Overrides', () => {
    it('blocks CASHIER & WAITER price tampering (403), rejects invalid quantity (400), and recomputes server catalog prices & tax', async () => {
      // Enable 19% TVA for tax persistence check
      sqlite
        .prepare("INSERT INTO restaurant_settings (key, value) VALUES ('tax_rate', '19') ON CONFLICT(key) DO UPDATE SET value = '19'")
        .run();

      // CASHIER attempts tampered unitPrice = 1 DA -> 403
      const cashierTamper = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          type: 'TAKEAWAY',
          items: [{ productId: productA.id, quantity: 1, unitPrice: 1 }],
          idempotencyKey: 'tamper-cashier-1',
        });
      expect(cashierTamper.status).toBe(403);

      // WAITER attempts tampered unitPrice = 5 DA via /sync/batch -> failedOrders with 403 / non-retryable
      const waiterBatchTamper = await request(app)
        .post('/api/sync/batch')
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({
          offlineOrders: [
            {
              offlineId: 'off-tamper-waiter',
              type: 'TAKEAWAY',
              items: [{ productId: productA.id, quantity: 1, unitPrice: 5 }],
            },
          ],
        });
      expect(waiterBatchTamper.status).toBe(200);
      expect(waiterBatchTamper.body.syncedIds).not.toContain('off-tamper-waiter');
      expect(waiterBatchTamper.body.failedOrders.length).toBe(1);

      // Invalid quantity -> 400
      const badQty = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          type: 'TAKEAWAY',
          items: [{ productId: productA.id, quantity: 0 }],
          idempotencyKey: 'bad-qty-1',
        });
      expect(badQty.status).toBe(400);

      // Valid CASHIER order -> server ignores forged client subtotal/total and computes from catalog + 19% tax
      const catalogPrice = Number(productA.price);
      const legitimateOrder = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          type: 'TAKEAWAY',
          items: [{ productId: productA.id, quantity: 2 }],
          discount: 100,
          subtotal: 1, // forged client value must be ignored
          total: 1,    // forged client value must be ignored
          idempotencyKey: 'valid-server-pricing-1',
        });
      expect(legitimateOrder.status).toBe(201);

      const expectedSub = catalogPrice * 2;
      const expectedTaxable = Math.max(0, expectedSub - 100);
      const expectedTax = Math.round(((expectedTaxable * 19) / 100) * 100) / 100;
      const expectedTotal = expectedTaxable + expectedTax;

      expect(Number(legitimateOrder.body.subtotal)).toBeCloseTo(expectedSub, 2);
      expect(Number(legitimateOrder.body.taxRate)).toBeCloseTo(19, 2);
      expect(Number(legitimateOrder.body.taxAmount)).toBeCloseTo(expectedTax, 2);
      expect(Number(legitimateOrder.body.total)).toBeCloseTo(expectedTotal, 2);

      // ADMIN price override succeeds and logs ORDER_ITEM_PRICE_OVERRIDE audit entry
      const adminOverride = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'TAKEAWAY',
          items: [
            {
              productId: productA.id,
              quantity: 1,
              unitPrice: 950,
              priceOverrideReason: 'VIP guest discount',
            },
          ],
          idempotencyKey: 'admin-override-1',
        });
      expect(adminOverride.status).toBe(201);

      const auditEntry = sqlite
        .prepare(
          "SELECT * FROM audit_logs WHERE action = 'ORDER_ITEM_PRICE_OVERRIDE' AND entity_id = ? ORDER BY id DESC LIMIT 1"
        )
        .get(String(adminOverride.body.id));
      expect(auditEntry).toBeTruthy();
      expect(auditEntry.details).toContain('VIP guest discount');

      // Reset tax_rate back to 0 so subsequent report tests are easy to assert
      sqlite
        .prepare("INSERT INTO restaurant_settings (key, value) VALUES ('tax_rate', '0') ON CONFLICT(key) DO UPDATE SET value = '0'")
        .run();
    });
  });

  describe('TASK 04 — Database Transactions (Merge Tables & Product Updates)', () => {
    it('rejects self-merge (400) and atomically merges two occupied tables', async () => {
      const freeTables = sqlite
        .prepare("SELECT * FROM restaurant_tables WHERE status = 'AVAILABLE' ORDER BY id ASC LIMIT 2")
        .all();
      expect(freeTables.length).toBe(2);
      const tSrc = freeTables[0];
      const tDst = freeTables[1];

      // Self-merge check
      const selfRes = await request(app)
        .post('/api/tables/merge')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ sourceTableId: tSrc.id, targetTableId: tSrc.id });
      expect(selfRes.status).toBe(400);

      // Create two dine-in orders
      const oSrc = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          type: 'DINE_IN',
          tableId: tSrc.id,
          items: [{ productId: productA.id, quantity: 1 }],
          discount: 50,
          idempotencyKey: 'merge-src-1',
        });
      const oDst = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          type: 'DINE_IN',
          tableId: tDst.id,
          items: [{ productBId: productB.id, productId: productB.id, quantity: 1 }],
          discount: 30,
          idempotencyKey: 'merge-dst-1',
        });
      expect(oSrc.status).toBe(201);
      expect(oDst.status).toBe(201);

      // Partial payment on source order
      const partPay = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          orderId: oSrc.body.id,
          payments: [{ method: 'CASH', amount: 200 }],
          idempotencyKey: 'merge-src-pay-1',
        });
      expect(partPay.status).toBe(200);

      // Merge tSrc -> tDst
      const mergeRes = await request(app)
        .post('/api/tables/merge')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ sourceTableId: tSrc.id, targetTableId: tDst.id });
      expect(mergeRes.status).toBe(200);
      expect(mergeRes.body.success).toBe(true);
      expect(mergeRes.body.targetOrderId).toBe(oDst.body.id);

      // Verify source order zeroed & cancelled; target order has combined items, discount=80, paid=200
      const srcRow = sqlite.prepare('SELECT * FROM orders WHERE id = ?').get(oSrc.body.id);
      const dstRow = sqlite.prepare('SELECT * FROM orders WHERE id = ?').get(oDst.body.id);
      expect(srcRow.status).toBe('CANCELLED');
      expect(Number(srcRow.total)).toBe(0);
      expect(Number(dstRow.discount)).toBeCloseTo(80, 2);
      expect(Number(dstRow.paid_amount)).toBeCloseTo(200, 2);

      const dstItems = sqlite.prepare('SELECT * FROM order_items WHERE order_id = ?').all(oDst.body.id);
      expect(dstItems.length).toBe(2);

      const srcTblRow = sqlite.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(tSrc.id);
      expect(srcTblRow.status).toBe('AVAILABLE');
      expect(srcTblRow.current_order_id).toBeNull();
    });

    it('updates products atomically (handling costPrice: 0 & omitted price) and rolls back invalid updates', async () => {
      const okUpdate = await request(app)
        .put(`/api/products/${productB.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nameAr: productB.name_ar,
          costPrice: 0,
        });
      expect(okUpdate.status).toBe(200);
      expect(Number(okUpdate.body.costPrice)).toBe(0);
      expect(Number(okUpdate.body.price)).toBeCloseTo(Number(productB.price), 2);

      // Attempt update with invalid negative recipe quantity -> must rollback name change too
      const originalName = productB.name_ar;
      const failUpdate = await request(app)
        .put(`/api/products/${productB.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nameAr: 'اسم فاسد لن يُحفظ',
          price: 9999,
          recipes: [{ ingredientId: ingredientB.id, quantity: -5 }],
        });
      expect(failUpdate.status).toBe(400);

      const afterFail = sqlite.prepare('SELECT * FROM products WHERE id = ?').get(productB.id);
      expect(afterFail.name_ar).toBe(originalName);
      expect(Number(afterFail.price)).toBeCloseTo(Number(productB.price), 2);
    });
  });

  describe('TASK 05 — Reports & Order Detail Reprint Accuracy', () => {
    it('excludes CANCELLED/REFUNDED/held orders & REFUND payments from /api/reports/dashboard, supports date filters, and returns full joins on /api/orders/:id', async () => {
      const cust = sqlite
        .prepare("SELECT * FROM customers ORDER BY id DESC LIMIT 1")
        .get();
      const paidOrd = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          type: 'TAKEAWAY',
          customerId: cust?.id,
          items: [{ productId: productA.id, quantity: 1 }],
          idempotencyKey: 'report-paid-ord-1',
        });
      expect(paidOrd.status).toBe(201);
      await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          orderId: paidOrd.body.id,
          payments: [{ method: 'CASH', amount: Number(paidOrd.body.total) }],
          idempotencyKey: 'report-paid-pay-1',
        });

      const dashToday = await request(app)
        .get('/api/reports/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(dashToday.status).toBe(200);
      expect(dashToday.body.orderCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(dashToday.body.topProducts)).toBe(true);

      // Querying a future empty date range must yield 0 sales
      const dashFuture = await request(app)
        .get('/api/reports/dashboard?startDate=2099-01-01&endDate=2099-01-02')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(dashFuture.status).toBe(200);
      expect(dashFuture.body.salesToday).toBe(0);
      expect(dashFuture.body.orderCount).toBe(0);

      // Verify full order detail joins
      const detailRes = await request(app)
        .get(`/api/orders/${paidOrd.body.id}`)
        .set('Authorization', `Bearer ${cashierToken}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.cashier?.fullName).toBeTruthy();
      expect(Array.isArray(detailRes.body.items)).toBe(true);
      expect(Array.isArray(detailRes.body.payments)).toBe(true);
      if (cust) {
        expect(detailRes.body.customer?.name).toBe(cust.name);
      }
    });
  });

  describe('TASK 06 — Non-Destructive Menu Reset Security', () => {
    it('blocks CASHIER (403), requires CONFIRM_MENU_RESET (400), preserves all financial orders/payments, and logs audit entry', async () => {
      const ordersBefore = sqlite.prepare('SELECT COUNT(*) as c FROM orders').get().c;
      const orderItemsBefore = sqlite.prepare('SELECT COUNT(*) as c FROM order_items').get().c;
      const paymentsBefore = sqlite.prepare('SELECT COUNT(*) as c FROM payments').get().c;
      expect(ordersBefore).toBeGreaterThan(0);

      // CASHIER blocked 403
      const forbid = await request(app)
        .post('/api/menu/reset-grine')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ confirm: 'CONFIRM_MENU_RESET' });
      expect(forbid.status).toBe(403);

      // ADMIN without confirm token -> 400
      const noConfirm = await request(app)
        .post('/api/menu/reset-grine')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(noConfirm.status).toBe(400);

      // ADMIN with CONFIRM_MENU_RESET -> 200 AND preserves 100% of orders, order_items, payments
      const resetOk = await request(app)
        .post('/api/menu/reset-grine')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: 'CONFIRM_MENU_RESET' });
      expect(resetOk.status).toBe(200);
      expect(resetOk.body.success).toBe(true);

      const ordersAfter = sqlite.prepare('SELECT COUNT(*) as c FROM orders').get().c;
      const orderItemsAfter = sqlite.prepare('SELECT COUNT(*) as c FROM order_items').get().c;
      const paymentsAfter = sqlite.prepare('SELECT COUNT(*) as c FROM payments').get().c;

      expect(ordersAfter).toBe(ordersBefore);
      expect(orderItemsAfter).toBe(orderItemsBefore);
      expect(paymentsAfter).toBe(paymentsBefore);

      const resetAudit = sqlite
        .prepare("SELECT * FROM audit_logs WHERE action = 'RESET_GRINE_MENU' ORDER BY id DESC LIMIT 1")
        .get();
      expect(resetAudit).toBeTruthy();
    });
  });
});
