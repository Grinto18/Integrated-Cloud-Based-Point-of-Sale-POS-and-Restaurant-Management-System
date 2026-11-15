// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase8_sync_'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'phase8_sync_isolated.db');
process.env.SQLITE_DB_PATH = TEST_DB_PATH;

let app: express.Express;
let sqlite: any;
let signUserToken: any;
let clearRateLimitsForTest: any;

let adminToken: string;
let cashierToken: string;
let waiterToken: string;
let productA: any;
let productUnavailable: any;
let ingredientA: any;
let activeShiftId: number;

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

  const makeToken = (row: any) =>
    signUserToken({
      id: row.id,
      uid: row.uid,
      username: row.username,
      email: row.email,
      role: row.role,
      fullName: row.full_name,
    });

  const adminRow = sqlite.prepare("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1").get();
  const cashierRow = sqlite.prepare("SELECT * FROM users WHERE role = 'CASHIER' LIMIT 1").get();
  const waiterRow = sqlite.prepare("SELECT * FROM users WHERE role = 'WAITER' LIMIT 1").get();

  adminToken = makeToken(adminRow);
  cashierToken = cashierRow ? makeToken(cashierRow) : adminToken;
  waiterToken = waiterRow ? makeToken(waiterRow) : adminToken;
}

describe('Golden Palace POS — Phase 08 Offline & Sync Hardening (Backend)', () => {
  beforeAll(async () => {
    await bootstrapServer();
    expect(sqlite.name).toBe(TEST_DB_PATH);
    expect(sqlite.name).not.toContain('golden_palace.db');

    const openRes = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingCash: 15000, notes: 'Phase 8 QA Shift' });
    expect(openRes.status).toBe(201);
    activeShiftId = openRes.body.id;

    const prods = sqlite.prepare('SELECT * FROM products WHERE is_available = 1 ORDER BY id ASC LIMIT 2').all();
    expect(prods.length).toBeGreaterThanOrEqual(2);
    productA = prods[0];
    productUnavailable = prods[1];
    sqlite.prepare('UPDATE products SET is_available = 0 WHERE id = ?').run(productUnavailable.id);

    sqlite
      .prepare(
        "INSERT INTO ingredients (name_ar, name_fr, unit, current_stock, min_stock, cost_per_unit) VALUES ('مكون فحص 8', 'Ingrédient P8', 'KG', 10, 2, 500)"
      )
      .run();
    ingredientA = sqlite.prepare("SELECT * FROM ingredients WHERE name_ar = 'مكون فحص 8'").get();
    sqlite
      .prepare('INSERT INTO product_recipes (product_id, ingredient_id, quantity) VALUES (?, ?, ?)')
      .run(productA.id, ingredientA.id, 2);
  });

  beforeEach(() => {
    clearRateLimitsForTest?.();
    sqlite.prepare("DELETE FROM sync_conflicts WHERE status = 'OPEN'").run();
  });

  afterAll(() => {
    try {
      sqlite?.close();
    } catch {
      // ignore
    }
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('exposes GET /api/health verifying SQLite DB readiness', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('connected');
    expect(res.body.timestamp).toBeTruthy();
  });

  it('processes queued batches strictly in FIFO sequenceOrder and records sync_operations without duplicating on retry', async () => {
    const stockBefore = Number(
      sqlite.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(ingredientA.id).current_stock
    );

    const uuid1 = crypto.randomUUID();
    const uuid2 = crypto.randomUUID();
    const batch = {
      deviceId: 'pos-fifo-dev',
      offlineOrders: [
        {
          offlineId: `off-${uuid2}`,
          operationId: uuid2,
          deviceId: 'pos-fifo-dev',
          sequenceOrder: 20,
          type: 'TAKEAWAY',
          items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: Number(productA.price), quantity: 1 }],
          subtotal: Number(productA.price),
          total: Number(productA.price),
          paidAmount: 0,
          paymentStatus: 'UNPAID',
          idempotencyKey: `ord-${uuid2}`,
          createdAt: new Date(Date.now() + 2000).toISOString(),
          strictConflictCheck: true,
        },
        {
          offlineId: `off-${uuid1}`,
          operationId: uuid1,
          deviceId: 'pos-fifo-dev',
          sequenceOrder: 10,
          type: 'TAKEAWAY',
          items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: Number(productA.price), quantity: 1 }],
          subtotal: Number(productA.price),
          total: Number(productA.price),
          paidAmount: 0,
          paymentStatus: 'UNPAID',
          idempotencyKey: `ord-${uuid1}`,
          createdAt: new Date(Date.now()).toISOString(),
          strictConflictCheck: true,
        },
      ],
    };

    const res1 = await request(app).post('/api/sync/batch').set('Authorization', `Bearer ${adminToken}`).send(batch);
    expect(res1.status).toBe(200);
    // Sequence 10 MUST be synced before sequence 20
    expect(res1.body.syncedIds).toEqual([`off-${uuid1}`, `off-${uuid2}`]);
    expect(res1.body.results[0].orderId).toBeLessThan(res1.body.results[1].orderId);

    // Retry exact same batch (simulated crash before client deleted local item) -> deduplicated cleanly
    const res2 = await request(app).post('/api/sync/batch').set('Authorization', `Bearer ${adminToken}`).send(batch);
    expect(res2.status).toBe(200);
    expect(res2.body.results.every((r: any) => r.deduplicated === true)).toBe(true);

    const stockAfter = Number(
      sqlite.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(ingredientA.id).current_stock
    );
    // 2 orders * 1 qty * 2 kg = 4 kg deducted ONCE (not 8 kg)
    expect(stockAfter).toBeCloseTo(stockBefore - 4, 4);
  });

  it('detects PRICE_CHANGED conflict, blocks Cashier OVERRIDE_PRICE, allows ACCEPT_SERVER_CATALOG, and allows Admin OVERRIDE_PRICE', async () => {
    const uuid = crypto.randomUUID();
    const stalePrice = Number(productA.price) - 300;
    const conflictOrder = {
      offlineId: `off-${uuid}`,
      operationId: uuid,
      type: 'TAKEAWAY',
      items: [
        {
          productId: productA.id,
          nameAr: productA.name_ar,
          unitPrice: stalePrice,
          expectedCatalogPrice: stalePrice,
          quantity: 1,
        },
      ],
      subtotal: stalePrice,
      total: stalePrice,
      paidAmount: 0,
      paymentStatus: 'UNPAID',
      idempotencyKey: `ord-${uuid}`,
      createdAt: new Date().toISOString(),
      strictConflictCheck: true,
    };

    // Cashier sync attempt triggers PRICE_CHANGED conflict
    const firstTry = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ offlineOrders: [conflictOrder] });

    expect(firstTry.status).toBe(200);
    expect(firstTry.body.syncedIds).toHaveLength(0);
    expect(firstTry.body.failedOrders[0].conflictType).toBe('PRICE_CHANGED');
    expect(firstTry.body.conflicts[0].serverSnapshot.serverPrice).toBe(Number(productA.price));
    const conflictId = firstTry.body.conflicts[0].id;

    // Cashier cannot resolve conflict with OVERRIDE_PRICE via API or batch
    const rbacConflictRes = await request(app)
      .post(`/api/sync/conflicts/${conflictId}/resolve`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ action: 'OVERRIDE_PRICE' });
    expect(rbacConflictRes.status).toBe(403);

    const rbacBatchRes = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        offlineOrders: [{ ...conflictOrder, conflictResolution: { action: 'OVERRIDE_PRICE' } }],
      });
    expect(rbacBatchRes.body.syncedIds).toHaveLength(0);
    expect(rbacBatchRes.body.failedOrders[0].conflictType).toBe('PRICE_CHANGED');

    // Waiter cannot call conflict resolve endpoint
    const waiterRes = await request(app)
      .post(`/api/sync/conflicts/${conflictId}/resolve`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ action: 'ACCEPT_SERVER_CATALOG' });
    expect(waiterRes.status).toBe(403);

    // Cashier CAN resolve via ACCEPT_SERVER_CATALOG (adopts live server price)
    const acceptRes = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        offlineOrders: [{ ...conflictOrder, conflictResolution: { action: 'ACCEPT_SERVER_CATALOG' } }],
      });
    expect(acceptRes.body.syncedIds).toContain(`off-${uuid}`);

    const savedOrder = sqlite.prepare('SELECT * FROM orders WHERE offline_id = ?').get(`off-${uuid}`);
    expect(Number(savedOrder.total)).toBe(Number(productA.price));

    // Admin CAN override price when explicitly requested
    const adminUuid = crypto.randomUUID();
    const adminOverrideRes = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        offlineOrders: [
          {
            ...conflictOrder,
            offlineId: `off-${adminUuid}`,
            operationId: adminUuid,
            idempotencyKey: `ord-${adminUuid}`,
            conflictResolution: { action: 'OVERRIDE_PRICE' },
          },
        ],
      });
    expect(adminOverrideRes.body.syncedIds).toContain(`off-${adminUuid}`);
    const overriddenOrder = sqlite.prepare('SELECT * FROM orders WHERE offline_id = ?').get(`off-${adminUuid}`);
    expect(Number(overriddenOrder.total)).toBe(stalePrice);
  });

  it('detects PRODUCT_UNAVAILABLE, TAX_RATE_CHANGED, STOCK_INSUFFICIENT, and multi-device TABLE_OCCUPIED conflicts with resolution', async () => {
    // 1. PRODUCT_UNAVAILABLE
    const unavailUuid = crypto.randomUUID();
    const unavailRes = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        offlineOrders: [
          {
            offlineId: `off-${unavailUuid}`,
            operationId: unavailUuid,
            type: 'TAKEAWAY',
            items: [{ productId: productUnavailable.id, nameAr: productUnavailable.name_ar, unitPrice: 500, quantity: 1 }],
            subtotal: 500,
            total: 500,
            idempotencyKey: `ord-${unavailUuid}`,
            strictConflictCheck: true,
          },
        ],
      });
    expect(unavailRes.body.failedOrders[0].conflictType).toBe('PRODUCT_UNAVAILABLE');

    // 2. TAX_RATE_CHANGED
    const taxUuid = crypto.randomUUID();
    const taxRes = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        offlineOrders: [
          {
            offlineId: `off-${taxUuid}`,
            operationId: taxUuid,
            type: 'TAKEAWAY',
            items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: Number(productA.price), quantity: 1 }],
            subtotal: Number(productA.price),
            taxRate: 19,
            total: Number(productA.price) * 1.19,
            idempotencyKey: `ord-${taxUuid}`,
            strictConflictCheck: true,
          },
        ],
      });
    expect(taxRes.body.failedOrders[0].conflictType).toBe('TAX_RATE_CHANGED');
    expect(taxRes.body.conflicts[0].serverSnapshot.serverTaxRate).toBe(0);

    // Resolve TAX_RATE_CHANGED with ACCEPT_SERVER_TAX
    const taxResolved = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        offlineOrders: [
          {
            offlineId: `off-${taxUuid}`,
            operationId: taxUuid,
            type: 'TAKEAWAY',
            items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: Number(productA.price), quantity: 1 }],
            subtotal: Number(productA.price),
            taxRate: 19,
            total: Number(productA.price) * 1.19,
            idempotencyKey: `ord-${taxUuid}`,
            strictConflictCheck: true,
            conflictResolution: { action: 'ACCEPT_SERVER_TAX' },
          },
        ],
      });
    expect(taxResolved.body.syncedIds).toContain(`off-${taxUuid}`);

    // 3. STOCK_INSUFFICIENT (ingredientA has <= 6 kg remaining; ask for qty 50 => 100 kg)
    const stockUuid = crypto.randomUUID();
    const stockRes = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        offlineOrders: [
          {
            offlineId: `off-${stockUuid}`,
            operationId: stockUuid,
            type: 'TAKEAWAY',
            items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: Number(productA.price), quantity: 50 }],
            subtotal: Number(productA.price) * 50,
            total: Number(productA.price) * 50,
            idempotencyKey: `ord-${stockUuid}`,
            enforceStockCheck: true,
          },
        ],
      });
    expect(stockRes.body.failedOrders[0].conflictType).toBe('STOCK_INSUFFICIENT');

    // Cashier blocked from FORCE_STOCK; Admin allowed
    const cashierForceStock = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        offlineOrders: [
          {
            offlineId: `off-${stockUuid}`,
            operationId: stockUuid,
            type: 'TAKEAWAY',
            items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: Number(productA.price), quantity: 50 }],
            subtotal: Number(productA.price) * 50,
            total: Number(productA.price) * 50,
            idempotencyKey: `ord-${stockUuid}`,
            enforceStockCheck: true,
            conflictResolution: { action: 'FORCE_STOCK' },
          },
        ],
      });
    expect(cashierForceStock.body.failedOrders[0].conflictType).toBe('STOCK_INSUFFICIENT');

    // 4. Multi-device TABLE_OCCUPIED
    const availTable = sqlite.prepare("SELECT * FROM restaurant_tables WHERE status = 'AVAILABLE' LIMIT 1").get();
    expect(availTable).toBeTruthy();

    const devAUuid = crypto.randomUUID();
    const devARes = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        deviceId: 'pos-device-A',
        offlineOrders: [
          {
            offlineId: `off-${devAUuid}`,
            operationId: devAUuid,
            type: 'DINE_IN',
            tableId: availTable.id,
            tableNumber: availTable.table_number,
            items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: Number(productA.price), quantity: 1 }],
            subtotal: Number(productA.price),
            total: Number(productA.price),
            paidAmount: 0,
            paymentStatus: 'UNPAID',
            idempotencyKey: `ord-${devAUuid}`,
          },
        ],
      });
    expect(devARes.body.syncedIds).toContain(`off-${devAUuid}`);

    const devBUuid = crypto.randomUUID();
    const devBOrder = {
      offlineId: `off-${devBUuid}`,
      operationId: devBUuid,
      type: 'DINE_IN',
      tableId: availTable.id,
      tableNumber: availTable.table_number,
      items: [{ productId: productA.id, nameAr: productA.name_ar, unitPrice: Number(productA.price), quantity: 1 }],
      subtotal: Number(productA.price),
      total: Number(productA.price),
      paidAmount: 0,
      paymentStatus: 'UNPAID',
      idempotencyKey: `ord-${devBUuid}`,
    };
    const devBRes = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ deviceId: 'pos-device-B', offlineOrders: [devBOrder] });

    expect(devBRes.body.syncedIds).toHaveLength(0);
    expect(devBRes.body.failedOrders[0].conflictType).toBe('TABLE_OCCUPIED');
    expect(devBRes.body.conflicts[0].serverSnapshot.availableTables.length).toBeGreaterThan(0);

    // Resolve Device B conflict via CONVERT_TO_TAKEAWAY
    const resolvedTable = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        deviceId: 'pos-device-B',
        offlineOrders: [{ ...devBOrder, conflictResolution: { action: 'CONVERT_TO_TAKEAWAY' } }],
      });
    expect(resolvedTable.body.syncedIds).toContain(`off-${devBUuid}`);
    const savedDevB = sqlite.prepare('SELECT * FROM orders WHERE offline_id = ?').get(`off-${devBUuid}`);
    expect(savedDevB.type).toBe('TAKEAWAY');
  });

  it('syncs offlineCashMovements idempotently and blocks shift close when pending offline items or OPEN conflicts exist', async () => {
    const movUuid = crypto.randomUUID();
    const shiftBefore = sqlite.prepare('SELECT * FROM cash_shifts WHERE id = ?').get(activeShiftId);

    const movPayload = {
      offlineCashMovements: [
        {
          offlineMovementId: `offmov-${movUuid}`,
          operationId: movUuid,
          shiftId: activeShiftId,
          type: 'CASH_IN',
          amount: 1200,
          reason: 'إيداع أوفلاين اختبار',
          idempotencyKey: `mov-${movUuid}`,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const m1 = await request(app).post('/api/sync/batch').set('Authorization', `Bearer ${cashierToken}`).send(movPayload);
    const m2 = await request(app).post('/api/sync/batch').set('Authorization', `Bearer ${cashierToken}`).send(movPayload);
    expect(m1.status).toBe(200);
    expect(m1.body.syncedCashMovementIds).toEqual([`offmov-${movUuid}`]);
    expect(m2.body.syncedCashMovementIds).toEqual([`offmov-${movUuid}`]);

    const shiftAfter = sqlite.prepare('SELECT * FROM cash_shifts WHERE id = ?').get(activeShiftId);
    expect(Number(shiftAfter.total_cash_in) - Number(shiftBefore.total_cash_in)).toBe(1200);

    // 1) Block close shift when pendingOfflineCount > 0
    const closeBlockedPending = await request(app)
      .post('/api/cash-register/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shiftId: activeShiftId, closingCash: 16200, pendingOfflineCount: 2 });
    expect(closeBlockedPending.status).toBe(409);
    expect(closeBlockedPending.body.code).toBe('UNSYNCED_OFFLINE_ITEMS');

    // 2) Create an OPEN conflict and verify shift close is blocked with OPEN_SYNC_CONFLICTS
    const badUuid = crypto.randomUUID();
    const badSync = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        offlineOrders: [
          {
            offlineId: `off-${badUuid}`,
            operationId: badUuid,
            type: 'TAKEAWAY',
            items: [{ productId: productUnavailable.id, nameAr: 'غير متوفر', unitPrice: 500, quantity: 1 }],
            subtotal: 500,
            total: 500,
            idempotencyKey: `ord-${badUuid}`,
            strictConflictCheck: true,
          },
        ],
      });
    const openConfId = badSync.body.conflicts[0].id;

    const closeBlockedConf = await request(app)
      .post('/api/cash-register/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shiftId: activeShiftId, closingCash: 16200, pendingOfflineCount: 0 });
    expect(closeBlockedConf.status).toBe(409);
    expect(closeBlockedConf.body.code).toBe('OPEN_SYNC_CONFLICTS');

    // Discard conflict as Admin -> shift close succeeds
    const discardRes = await request(app)
      .post(`/api/sync/conflicts/${openConfId}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'DISCARD' });
    expect(discardRes.status).toBe(200);

    const statusRes = await request(app).get('/api/sync/status').set('Authorization', `Bearer ${adminToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.openConflictsCount).toBe(0);
  });
});
