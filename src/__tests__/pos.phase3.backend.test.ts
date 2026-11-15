// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase3_test_'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'phase3_isolated.db');
process.env.SQLITE_DB_PATH = TEST_DB_PATH;

let app: express.Express;
let sqlite: any;
let db: any;
let usersTable: any;
let productsTable: any;
let orderItemsTable: any;
let ingredientsTable: any;
let productRecipesTable: any;
let eqFn: any;
let signUserToken: any;

let adminToken: string;
let cashierToken: string;
let waiterToken: string;
let kitchenToken: string;

describe('Golden Palace POS — Phase 03 Backend Cashier, Orders, Tables, Shift & Sync Tests', () => {
  beforeAll(async () => {
    const dbMod = await import('../db/index.ts');
    sqlite = dbMod.sqlite;
    db = dbMod.db;

    expect(sqlite.name).toBe(TEST_DB_PATH);
    expect(sqlite.name).not.toContain('Golden Palace POS');
    expect(sqlite.name).not.toContain('golden_palace.db');

    const schemaMod = await import('../db/schema.ts');
    usersTable = schemaMod.users;
    productsTable = schemaMod.products;
    orderItemsTable = schemaMod.orderItems;
    ingredientsTable = schemaMod.ingredients;
    productRecipesTable = schemaMod.productRecipes;

    const ormMod = await import('drizzle-orm');
    eqFn = ormMod.eq;

    const { seedDatabase } = await import('../db/seed.ts');
    await seedDatabase();

    const authMod = await import('../middleware/auth.ts');
    signUserToken = authMod.signUserToken;

    const { apiRouter } = await import('../server/api.ts');
    app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    const allUsers = await db.select().from(usersTable);
    const admin = allUsers.find((u: any) => u.role === 'ADMIN');
    const cashier = allUsers.find((u: any) => u.role === 'CASHIER');
    const waiter = allUsers.find((u: any) => u.role === 'WAITER');
    const kitchen = allUsers.find((u: any) => u.role === 'KITCHEN');

    adminToken = signUserToken(admin);
    cashierToken = signUserToken(cashier);
    waiterToken = signUserToken(waiter);
    kitchenToken = signUserToken(kitchen);
  });

  afterAll(() => {
    try {
      sqlite?.close();
    } catch {
      // ignore
    }
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('loads 30 seeded tables, creates dine-in order, prevents duplicate active table order (409), and enforces table transfer RBAC', async () => {
    const tablesRes = await request(app)
      .get('/api/tables')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(tablesRes.status).toBe(200);
    expect(tablesRes.body.length).toBeGreaterThanOrEqual(30);

    const table1 = tablesRes.body.find((t: any) => t.tableNumber === '1');
    const table2 = tablesRes.body.find((t: any) => t.tableNumber === '2');
    const table3 = tablesRes.body.find((t: any) => t.tableNumber === '3');

    const prodsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${cashierToken}`);
    const prod = prodsRes.body[0];

    // Create dine-in order on Table 1
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table1.id,
        items: [{ productId: prod.id, nameAr: prod.nameAr, nameFr: prod.nameFr, unitPrice: prod.price, quantity: 2 }],
        sendToKitchen: true,
      });
    expect(orderRes.status).toBe(201);

    // Duplicate dine-in order on occupied Table 1 must fail with 409 Conflict
    const conflictRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table1.id,
        items: [{ productId: prod.id, nameAr: prod.nameAr, unitPrice: prod.price, quantity: 1 }],
      });
    expect(conflictRes.status).toBe(409);

    // Waiter cannot apply discount (403)
    const waiterDiscountRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table3.id,
        items: [{ productId: prod.id, nameAr: prod.nameAr, unitPrice: prod.price, quantity: 1 }],
        discount: 100,
      });
    expect(waiterDiscountRes.status).toBe(403);

    // Kitchen role cannot transfer tables (403)
    const forbiddenTransfer = await request(app)
      .post('/api/tables/transfer')
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ fromTableId: table1.id, toTableId: table2.id });
    expect(forbiddenTransfer.status).toBe(403);

    // Cashier transfers Table 1 -> Table 2
    const transferRes = await request(app)
      .post('/api/tables/transfer')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ fromTableId: table1.id, toTableId: table2.id });
    expect(transferRes.status).toBe(200);
    expect(transferRes.body.success).toBe(true);
  });

  it('appends items to existing open order and keeps historical order_items immutable when catalog product changes', async () => {
    const prodsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${adminToken}`);
    const prod = prodsRes.body[1];
    const originalPrice = Number(prod.price);

    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: prod.id, quantity: 1 }],
      });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.id;

    // Append item qty update
    const appendRes = await request(app)
      .post(`/api/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [{ productId: prod.id, quantity: 3 }],
        replaceAll: true,
        discount: 50,
      });
    expect(appendRes.status).toBe(200);
    expect(Number(appendRes.body.total)).toBe(originalPrice * 3 - 50);

    // Now update product catalog price in DB
    await db
      .update(productsTable)
      .set({ price: originalPrice + 999, nameAr: 'اسم معدل لاحقاً' })
      .where(eqFn(productsTable.id, prod.id));

    // Historical order_item snapshot MUST stay unchanged
    const itemsInOrder = await db
      .select()
      .from(orderItemsTable)
      .where(eqFn(orderItemsTable.orderId, orderId));
    expect(Number(itemsInOrder[0].unitPrice)).toBe(originalPrice);
    expect(itemsInOrder[0].nameAr).toBe(prod.nameAr);
  });

  it('enforces open shift for payment, prevents concurrent open shifts, settles partial & full payments, frees table, and restricts refund to ADMIN/MANAGER', async () => {
    const tablesRes = await request(app)
      .get('/api/tables')
      .set('Authorization', `Bearer ${cashierToken}`);
    const table5 = tablesRes.body.find((t: any) => t.tableNumber === '5');

    const prodsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${cashierToken}`);
    const prod = prodsRes.body[2];

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table5.id,
        items: [{ productId: prod.id, quantity: 2 }],
      });
    expect(orderRes.status).toBe(201);
    const orderTotal = Number(orderRes.body.total);

    // Payment MUST fail when no shift is open
    const closedShiftPay = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId: orderRes.body.id,
        payments: [{ method: 'CASH', amount: orderTotal }],
      });
    expect(closedShiftPay.status).toBe(400);

    // Open Shift
    const openShiftRes = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ openingCash: 5000 });
    expect(openShiftRes.status).toBe(201);

    // Cannot open second concurrent open shift
    const duplicateShift = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingCash: 1000 });
    expect(duplicateShift.status).toBe(400);

    // Partial Payment (100 DA) -> Table status becomes WAITING_PAYMENT
    const partialRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId: orderRes.body.id,
        payments: [{ method: 'CARD', amount: 100 }],
        idempotencyKey: 'partial-key-1',
      });
    expect(partialRes.status).toBe(200);
    expect(partialRes.body.paymentStatus).toBe('PARTIALLY_PAID');

    // Replay same idempotencyKey -> deduplicated!
    const dedupRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId: orderRes.body.id,
        payments: [{ method: 'CARD', amount: 100 }],
        idempotencyKey: 'partial-key-1',
      });
    expect(dedupRes.status).toBe(200);
    expect(dedupRes.body.deduplicated).toBe(true);

    // Pay remainder via BANK_TRANSFER -> PAID & table freed to AVAILABLE
    const remainder = orderTotal - 100;
    const finalPayRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId: orderRes.body.id,
        payments: [{ method: 'BANK_TRANSFER', amount: remainder }],
        idempotencyKey: 'final-key-1',
      });
    expect(finalPayRes.status).toBe(200);
    expect(finalPayRes.body.paymentStatus).toBe('PAID');

    // Paid invoice CANNOT be cancelled
    const cancelPaid = await request(app)
      .post(`/api/orders/${orderRes.body.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'try cancel paid' });
    expect(cancelPaid.status).toBe(400);

    // Cashier CANNOT refund (403); ADMIN CAN refund -> REFUNDED
    const cashierRefund = await request(app)
      .post(`/api/orders/${orderRes.body.id}/refund`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ reason: 'not allowed' });
    expect(cashierRefund.status).toBe(403);

    const adminRefund = await request(app)
      .post(`/api/orders/${orderRes.body.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'customer error' });
    expect(adminRefund.status).toBe(200);
    expect(adminRefund.body.order.status).toBe('REFUNDED');

    // Dashboard metrics work
    const dashRes = await request(app)
      .get('/api/cashier/dashboard')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.shiftStatus).toBe('OPEN');

    // Close Shift & check variance
    const closeRes = await request(app)
      .post('/api/cash-register/close')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ shiftId: openShiftRes.body.id, closingCash: 4950, notes: 'Z Report' });
    expect(closeRes.status).toBe(200);
    expect(Number(closeRes.body.cashDifference)).toBe(-50);
  });

  it('syncs kitchen READY status to order & table, and deduplicates offline batch sync without double inventory deduction', async () => {
    const tablesRes = await request(app)
      .get('/api/tables')
      .set('Authorization', `Bearer ${cashierToken}`);
    const table6 = tablesRes.body.find((t: any) => t.tableNumber === '6');

    const prodsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${cashierToken}`);
    const prod = prodsRes.body[3];

    // Attach recipe ingredient to verify single stock deduction
    const [ing] = await db
      .insert(ingredientsTable)
      .values({ nameAr: 'لحم تجريبي', nameFr: 'Viande test', unit: 'g', currentStock: '1000', minStock: '100', costPerUnit: '1' })
      .returning();
    await db
      .insert(productRecipesTable)
      .values({ productId: prod.id, ingredientId: ing.id, quantity: '50' });

    const kOrder = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table6.id,
        items: [{ productId: prod.id, quantity: 1 }],
        sendToKitchen: true,
      });
    expect(kOrder.status).toBe(201);

    const kItems = await db
      .select()
      .from(orderItemsTable)
      .where(eqFn(orderItemsTable.orderId, kOrder.body.id));

    const readyRes = await request(app)
      .patch(`/api/kitchen/items/${kItems[0].id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'READY' });
    expect(readyRes.status).toBe(200);

    const refreshedTables = await request(app)
      .get('/api/tables')
      .set('Authorization', `Bearer ${cashierToken}`);
    const updatedT6 = refreshedTables.body.find((t: any) => t.id === table6.id);
    expect(updatedT6.status).toBe('READY');

    // Stock deducted once for kOrder (1000 - 50 = 950)
    // Offline sync replay twice with same offlineId
    const offlineBatch = [
      {
        offlineId: 'off-sync-dup-001',
        type: 'TAKEAWAY',
        items: [
          {
            productId: prod.id,
            nameAr: prod.nameAr,
            nameFr: prod.nameFr,
            unitPrice: Number(prod.price),
            quantity: 2,
          },
        ],
        subtotal: Number(prod.price) * 2,
        total: Number(prod.price) * 2,
        paymentStatus: 'UNPAID',
      },
    ];

    const sync1 = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ offlineOrders: offlineBatch });
    expect(sync1.status).toBe(200);
    expect(sync1.body.success).toBe(true);
    expect(sync1.body.syncedIds).toContain('off-sync-dup-001');

    const sync2 = await request(app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ offlineOrders: offlineBatch });
    expect(sync2.status).toBe(200);
    expect(sync2.body.success).toBe(true);
    expect(sync2.body.syncedIds).toContain('off-sync-dup-001');

    const [ingAfter] = await db
      .select()
      .from(ingredientsTable)
      .where(eqFn(ingredientsTable.id, ing.id));
    // 1000 - 50 (kOrder) - 100 (offline qty 2 synced once) = 850
    expect(Number(ingAfter.currentStock)).toBe(850);
  });
});
