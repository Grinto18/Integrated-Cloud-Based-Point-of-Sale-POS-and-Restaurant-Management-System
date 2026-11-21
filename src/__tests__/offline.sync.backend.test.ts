// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { closeSqliteHandle, removeIsolatedTestDir } from './testCleanup.ts';

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_offline_sync_'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'offline_sync_isolated.db');
process.env.SQLITE_DB_PATH = TEST_DB_PATH;

let app: express.Express;
let sqlite: any;
let db: any;
let signUserToken: any;
let clearRateLimitsForTest: any;
let productA: any;
let ingredientA: any;
let adminToken: string;

async function bootstrapServer() {
  const dbMod = await import('../db/index.ts');
  sqlite = dbMod.sqlite;
  db = dbMod.db;

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

  const adminUser = sqlite.prepare("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1").get();
  adminToken = signUserToken({
    id: adminUser.id,
    uid: adminUser.uid,
    username: adminUser.username,
    email: adminUser.email,
    role: adminUser.role,
    fullName: adminUser.full_name,
  });
}

describe('Golden Palace POS — Offline-First Sync, Idempotency & Transaction Tests (Backend)', () => {
  beforeAll(async () => {
    await bootstrapServer();

    // Ensure non-production DB
    expect(sqlite.name).toBe(TEST_DB_PATH);
    expect(sqlite.name).not.toContain('golden_palace.db');

    // Open a fresh shift for tests
    const openRes = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingCash: 10000, notes: 'Offline QA Shift' });
    expect(openRes.status).toBe(201);

    // Grab a real product & wire an ingredient recipe so we can verify atomic stock deduction
    productA = sqlite.prepare('SELECT * FROM products WHERE is_available = 1 LIMIT 1').get();
    expect(productA).toBeTruthy();

    sqlite
      .prepare(
        "INSERT INTO ingredients (name_ar, name_fr, unit, current_stock, min_stock, cost_per_unit) VALUES ('لحم اختبار', 'Viande Test', 'KG', 100, 5, 1000)"
      )
      .run();
    ingredientA = sqlite.prepare("SELECT * FROM ingredients WHERE name_ar = 'لحم اختبار'").get();
    sqlite
      .prepare('INSERT INTO product_recipes (product_id, ingredient_id, quantity) VALUES (?, ?, ?)')
      .run(productA.id, ingredientA.id, 0.5);
  });

  beforeEach(() => {
    clearRateLimitsForTest?.();
  });

  afterAll(() => {
    closeSqliteHandle(sqlite);
    removeIsolatedTestDir(TEST_DB_DIR);
  });

  it('prevents duplicate orders for sequential and concurrent POST /api/orders retries', async () => {
    const stockBefore = sqlite
      .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
      .get(ingredientA.id).current_stock;

    const payload = {
      type: 'TAKEAWAY',
      items: [
        {
          productId: productA.id,
          nameAr: productA.name_ar,
          unitPrice: 1500,
          quantity: 2,
          station: 'MAIN_KITCHEN',
        },
      ],
      subtotal: 3000,
      total: 3000,
      idempotencyKey: 'idem-order-burst-1',
      offlineId: 'off-burst-1',
    };

    // Concurrent duplicate requests
    const responses = await Promise.all([
      request(app).post('/api/orders').set('Authorization', `Bearer ${adminToken}`).send(payload),
      request(app).post('/api/orders').set('Authorization', `Bearer ${adminToken}`).send(payload),
      request(app).post('/api/orders').set('Authorization', `Bearer ${adminToken}`).send(payload),
    ]);

    const orderIds = new Set(responses.map((r) => r.body.id));
    expect(orderIds.size).toBe(1);
    expect(responses.some((r) => r.status === 201)).toBe(true);

    const dbCount = sqlite
      .prepare("SELECT COUNT(*) as c FROM orders WHERE offline_id = 'off-burst-1'")
      .get().c;
    expect(dbCount).toBe(1);

    const stockAfter = sqlite
      .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
      .get(ingredientA.id).current_stock;
    // Deducted once (2 * 0.5 = 1.0)
    expect(Number(stockAfter)).toBeCloseTo(Number(stockBefore) - 1, 4);
  });

  it('records split payments across multiple methods idempotently on POST /api/payments', async () => {
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: 2000, quantity: 1 }],
        subtotal: 2000,
        total: 2000,
        idempotencyKey: 'idem-split-pay-order',
      });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.id;

    const shiftBefore = sqlite.prepare("SELECT * FROM cash_shifts WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get();

    const payPayload = {
      orderId,
      idempotencyKey: 'idem-split-pay-txn-1',
      payments: [
        { method: 'CASH', amount: 800, tenderAmount: 1000, changeAmount: 200 },
        { method: 'CARD', amount: 700, tenderAmount: 700, changeAmount: 0 },
        { method: 'BARIDIMOB', amount: 500, tenderAmount: 500, changeAmount: 0 },
      ],
    };

    // Concurrent duplicate payment submission
    const [p1, p2] = await Promise.all([
      request(app).post('/api/payments').set('Authorization', `Bearer ${adminToken}`).send(payPayload),
      request(app).post('/api/payments').set('Authorization', `Bearer ${adminToken}`).send(payPayload),
    ]);

    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);

    const recordedLegs = sqlite
      .prepare('SELECT method, amount, tender_amount, change_amount FROM payments WHERE order_id = ?')
      .all(orderId);
    expect(recordedLegs).toHaveLength(3);

    const shiftAfter = sqlite.prepare("SELECT * FROM cash_shifts WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get();
    expect(Number(shiftAfter.total_cash_sales) - Number(shiftBefore.total_cash_sales)).toBe(800);
    expect(Number(shiftAfter.total_card_sales) - Number(shiftBefore.total_card_sales)).toBe(700);
    expect(Number(shiftAfter.total_baridimob_sales) - Number(shiftBefore.total_baridimob_sales)).toBe(500);
  });

  it('syncs offline split-payment orders cleanly, populates tender_amount, logs inventory movements, and deduplicates retries', async () => {
    const stockBefore = sqlite
      .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
      .get(ingredientA.id).current_stock;
    const shiftBefore = sqlite.prepare("SELECT * FROM cash_shifts WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get();

    const offlineOrder = {
      offlineId: 'off-split-101',
      type: 'TAKEAWAY',
      items: [
        {
          productId: productA.id,
          nameAr: productA.name_ar,
          nameFr: productA.name_fr,
          unitPrice: 2500,
          quantity: 1,
          station: 'MAIN_KITCHEN',
        },
      ],
      subtotal: 2500,
      discount: 0,
      deliveryFee: 0,
      total: 2500,
      paidAmount: 2500,
      paymentStatus: 'PAID',
      paymentMethod: 'MIXED',
      payments: [
        { method: 'CASH', amount: 1000, tenderAmount: 2000, changeAmount: 1000 },
        { method: 'CARD', amount: 750, tenderAmount: 750, changeAmount: 0 },
        { method: 'CCP', amount: 500, tenderAmount: 500, changeAmount: 0, transactionRef: 'CCP-99' },
        { method: 'BARIDIMOB', amount: 250, tenderAmount: 250, changeAmount: 0 },
      ],
      idempotencyKey: 'ord-off-split-101',
      createdAt: new Date().toISOString(),
    };

    const syncRes1 = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ offlineOrders: [offlineOrder] });

    expect(syncRes1.status).toBe(200);
    expect(syncRes1.body.syncedIds).toContain('off-split-101');
    expect(syncRes1.body.failedOrders).toHaveLength(0);

    // Retry exact same batch (duplicate request) -> deduplicated cleanly
    const syncRes2 = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ offlineOrders: [offlineOrder] });

    expect(syncRes2.status).toBe(200);
    expect(syncRes2.body.syncedIds).toContain('off-split-101');

    const syncedOrder = sqlite.prepare("SELECT * FROM orders WHERE offline_id = 'off-split-101'").get();
    expect(syncedOrder).toBeTruthy();
    expect(Number(syncedOrder.paid_amount)).toBe(2500);
    expect(syncedOrder.payment_status).toBe('PAID');

    const legs = sqlite.prepare('SELECT * FROM payments WHERE order_id = ?').all(syncedOrder.id);
    expect(legs).toHaveLength(4);
    for (const leg of legs) {
      expect(leg.tender_amount).not.toBeNull();
    }

    const invMoves = sqlite
      .prepare(
        "SELECT * FROM inventory_movements WHERE reference_type = 'ORDER' AND reference_id = ? AND ingredient_id = ?"
      )
      .all(syncedOrder.id, ingredientA.id);
    expect(invMoves).toHaveLength(1);
    expect(Number(invMoves[0].quantity)).toBeCloseTo(-0.5, 4);

    const stockAfter = sqlite
      .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
      .get(ingredientA.id).current_stock;
    expect(Number(stockAfter)).toBeCloseTo(Number(stockBefore) - 0.5, 4);

    const shiftAfter = sqlite.prepare("SELECT * FROM cash_shifts WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get();
    expect(Number(shiftAfter.total_cash_sales) - Number(shiftBefore.total_cash_sales)).toBe(1000);
    expect(Number(shiftAfter.total_card_sales) - Number(shiftBefore.total_card_sales)).toBe(750);
    expect(Number(shiftAfter.total_ccp_sales) - Number(shiftBefore.total_ccp_sales)).toBe(500);
    expect(Number(shiftAfter.total_baridimob_sales) - Number(shiftBefore.total_baridimob_sales)).toBe(250);
  });

  it('isolates partial failures and rolls back failing order transactions cleanly', async () => {
    const ordersCountBefore = sqlite.prepare('SELECT COUNT(*) as c FROM orders').get().c;
    const stockBefore = sqlite
      .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
      .get(ingredientA.id).current_stock;

    // 1 valid order + 1 order whose payment fails (invalid method triggers rollback of order, items, AND stock!) + 1 valid standalone payment + 1 invalid standalone payment
    const validOrder = {
      offlineId: 'off-partial-valid-1',
      type: 'TAKEAWAY',
      items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: 900, quantity: 1 }],
      subtotal: 900,
      total: 900,
      paidAmount: 900,
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      payments: [{ method: 'CASH', amount: 900, tenderAmount: 900, changeAmount: 0 }],
      idempotencyKey: 'ord-off-partial-valid-1',
      createdAt: new Date().toISOString(),
    };

    const rollbackOrder = {
      offlineId: 'off-partial-rollback-2',
      type: 'TAKEAWAY',
      items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: 900, quantity: 4 }],
      subtotal: 3600,
      total: 3600,
      paidAmount: 3600,
      paymentStatus: 'PAID',
      paymentMethod: 'INVALID_CRYPTO',
      payments: [{ method: 'INVALID_CRYPTO', amount: 3600, tenderAmount: 3600, changeAmount: 0 }],
      idempotencyKey: 'ord-off-partial-rollback-2',
      createdAt: new Date().toISOString(),
    };

    // Unpaid online order for standalone offlinePayment test
    const unpaidRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: 500, quantity: 1 }],
        subtotal: 500,
        total: 500,
        idempotencyKey: 'ord-standalone-pay-target',
      });
    expect(unpaidRes.status).toBe(201);

    const res = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        offlineOrders: [validOrder, rollbackOrder],
        offlinePayments: [
          {
            offlinePaymentId: 'offpay-valid-1',
            orderId: unpaidRes.body.id,
            payments: [{ method: 'CARD', amount: 500, tenderAmount: 500, changeAmount: 0 }],
            idempotencyKey: 'offpay-valid-1',
            createdAt: new Date().toISOString(),
          },
          {
            offlinePaymentId: 'offpay-missing-order-2',
            orderId: 999999,
            payments: [{ method: 'CASH', amount: 500, tenderAmount: 500, changeAmount: 0 }],
            idempotencyKey: 'offpay-missing-order-2',
            createdAt: new Date().toISOString(),
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.syncedIds).toEqual(['off-partial-valid-1']);
    expect(res.body.failedOrders).toHaveLength(1);
    expect(res.body.failedOrders[0].offlineId).toBe('off-partial-rollback-2');
    expect(res.body.failedOrders[0].retryable).toBe(false);

    expect(res.body.syncedPaymentIds).toEqual(['offpay-valid-1']);
    expect(res.body.failedPayments).toHaveLength(1);
    expect(res.body.failedPayments[0].offlinePaymentId).toBe('offpay-missing-order-2');

    // Verify rolled-back order left zero trace in orders, order_items, payments, or stock
    const rolledBackOrd = sqlite
      .prepare("SELECT * FROM orders WHERE offline_id = 'off-partial-rollback-2'")
      .get();
    expect(rolledBackOrd).toBeUndefined();

    // Stock deducted ONLY for validOrder (1 * 0.5) + unpaidRes (1 * 0.5) = 1.0, NOT rollbackOrder (4 * 0.5 = 2.0)
    const stockAfter = sqlite
      .prepare('SELECT current_stock FROM ingredients WHERE id = ?')
      .get(ingredientA.id).current_stock;
    expect(Number(stockAfter)).toBeCloseTo(Number(stockBefore) - 1.0, 4);

    const ordersCountAfter = sqlite.prepare('SELECT COUNT(*) as c FROM orders').get().c;
    expect(ordersCountAfter).toBe(ordersCountBefore + 2);
  });

  it('recovers interrupted syncs across server restarts without creating duplicate orders or payments', async () => {
    // 1. Insert an already-synced order row (simulating order committed right before server restart, before client received ACK or before payment leg landed)
    const interruptedOrd = {
      offlineId: 'off-restart-1',
      type: 'TAKEAWAY',
      items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: 1200, quantity: 1 }],
      subtotal: 1200,
      total: 1200,
      paidAmount: 1200,
      paymentStatus: 'PAID',
      paymentMethod: 'MIXED',
      payments: [
        { method: 'CASH', amount: 700, tenderAmount: 1000, changeAmount: 300 },
        { method: 'BARIDIMOB', amount: 500, tenderAmount: 500, changeAmount: 0 },
      ],
      idempotencyKey: 'ord-off-restart-1',
      createdAt: new Date().toISOString(),
    };

    // Send only order creation first (no payments yet) to simulate mid-sync crash after order creation
    const partialRes = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        offlineOrders: [
          {
            ...interruptedOrd,
            paidAmount: 0,
            paymentStatus: 'UNPAID',
            paymentMethod: undefined,
            payments: [],
          },
        ],
      });
    expect(partialRes.status).toBe(200);
    expect(partialRes.body.syncedIds).toContain('off-restart-1');

    // Simulate full Express + SQLite server restart by closing SQLite and resetting modules
    closeSqliteHandle(sqlite);
    vi.resetModules();
    await bootstrapServer();

    // Client retries full interrupted payload after server comes back online
    const resumeRes = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ offlineOrders: [interruptedOrd] });

    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.syncedIds).toContain('off-restart-1');

    // Second retry after restart -> 0 duplicates
    const retryRes = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ offlineOrders: [interruptedOrd] });
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.syncedIds).toContain('off-restart-1');

    const ordRows = sqlite.prepare("SELECT * FROM orders WHERE offline_id = 'off-restart-1'").all();
    expect(ordRows).toHaveLength(1);
    expect(ordRows[0].payment_status).toBe('PAID');
    expect(Number(ordRows[0].paid_amount)).toBe(1200);

    const payRows = sqlite.prepare('SELECT * FROM payments WHERE order_id = ?').all(ordRows[0].id);
    expect(payRows).toHaveLength(2);
  });
});
