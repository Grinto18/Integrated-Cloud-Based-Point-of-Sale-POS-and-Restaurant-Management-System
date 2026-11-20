// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PHASE2_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase2_backend_'));
const ISOLATED_DB = path.join(PHASE2_ROOT, 'golden_palace_production.db');
const ISOLATED_BACKUPS = path.join(PHASE2_ROOT, 'backups_production');

process.env.SQLITE_DB_PATH = ISOLATED_DB;
process.env.GOLDEN_PALACE_BACKUP_DIR = ISOLATED_BACKUPS;
process.env.GOLDEN_PALACE_DB_MODE = 'production';
process.env.JWT_SECRET = 'phase2_backend_reliability_test_secret_32_bytes_min';

let app: express.Express;
let ownerToken = '';
let adminToken = '';
let cashierToken = '';
let inventoryToken = '';
let kitchenToken = '';
let categoryId = 0;
let productId = 0;
let supplierId = 0;
let ingredientId = 0;
let tableAId = 0;
let tableBId = 0;

describe('Golden Palace POS — Phase 2 Backend Reliability & API Foundation', () => {
  beforeAll(async () => {
    const { apiRouter } = await import('../server/api.ts');
    const { apiErrorHandler } = await import('../middleware/errorHandler.ts');
    const { db, sqlite } = await import('../db/index.ts');
    const { users, categories, products, suppliers, ingredients, productRecipes, restaurantTables } = await import('../db/schema.ts');
    const { signUserToken, hashPin } = await import('../middleware/auth.ts');
    const bcrypt = (await import('bcryptjs')).default;

    app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api', apiRouter);
    app.use(apiErrorHandler);

    const pwdHash = bcrypt.hashSync('Palace#2026!', 10);
    const insertedUsers = await db
      .insert(users)
      .values([
        {
          uid: 'p2-owner',
          username: 'p2_owner',
          email: 'owner@palaisdor.dz',
          passwordHash: pwdHash,
          pin: await hashPin('8412'),
          fullName: 'مالك القصر',
          role: 'OWNER',
          isActive: true,
        },
        {
          uid: 'p2-admin',
          username: 'p2_admin',
          email: 'admin@palaisdor.dz',
          passwordHash: pwdHash,
          pin: await hashPin('7391'),
          fullName: 'مدير القصر',
          role: 'ADMIN',
          isActive: true,
        },
        {
          uid: 'p2-cashier',
          username: 'p2_cashier',
          email: 'cashier@palaisdor.dz',
          passwordHash: pwdHash,
          pin: await hashPin('5824'),
          fullName: 'كاشير القصر',
          role: 'CASHIER',
          isActive: true,
        },
        {
          uid: 'p2-inventory',
          username: 'p2_inventory',
          email: 'inv@palaisdor.dz',
          passwordHash: pwdHash,
          pin: await hashPin('6193'),
          fullName: 'أمين المخزون',
          role: 'INVENTORY',
          isActive: true,
        },
        {
          uid: 'p2-kitchen',
          username: 'p2_kitchen',
          email: 'kitchen@palaisdor.dz',
          passwordHash: pwdHash,
          pin: await hashPin('4927'),
          fullName: 'طباخ المطبخ',
          role: 'KITCHEN',
          isActive: true,
        },
      ])
      .returning();

    const byRole = (role: string) => insertedUsers.find((u) => u.role === role)!;
    ownerToken = signUserToken({ ...byRole('OWNER'), role: 'OWNER' });
    adminToken = signUserToken({ ...byRole('ADMIN'), role: 'ADMIN' });
    cashierToken = signUserToken({ ...byRole('CASHIER'), role: 'CASHIER' });
    inventoryToken = signUserToken({ ...byRole('INVENTORY'), role: 'INVENTORY' });
    kitchenToken = signUserToken({ ...byRole('KITCHEN'), role: 'KITCHEN' });

    const [cat] = await db
      .insert(categories)
      .values({ nameAr: 'البيتزا', nameFr: 'Pizzas', sortOrder: 1, station: 'MAIN_KITCHEN' })
      .returning();
    categoryId = cat.id;

    const [prod] = await db
      .insert(products)
      .values({
        categoryId,
        nameAr: 'بيتزا مارغريتا',
        nameFr: 'Pizza Margherita',
        price: '600',
        costPrice: '200',
        isAvailable: true,
        station: 'MAIN_KITCHEN',
      })
      .returning();
    productId = prod.id;

    const [sup] = await db
      .insert(suppliers)
      .values({ name: 'مورد الدقيق والجبن', phone: '0550112233' })
      .returning();
    supplierId = sup.id;

    const [ing] = await db
      .insert(ingredients)
      .values({
        nameAr: 'جبن موزاريلا',
        nameFr: 'Mozzarella',
        unit: 'KG',
        currentStock: '20',
        minStock: '5',
        costPerUnit: '1200',
        supplierId,
      })
      .returning();
    ingredientId = ing.id;

    await db.insert(productRecipes).values({
      productId,
      ingredientId,
      quantity: '0.2',
    });

    const tbls = await db
      .insert(restaurantTables)
      .values([
        { tableNumber: 'T1', zone: 'الصالة الرئيسية', capacity: 4, status: 'AVAILABLE' },
        { tableNumber: 'T2', zone: 'الصالة الرئيسية', capacity: 4, status: 'AVAILABLE' },
      ])
      .returning();
    tableAId = tbls[0].id;
    tableBId = tbls[1].id;

    // Ensure sqlite handle is healthy
    expect(sqlite.open).toBe(true);
  });

  afterAll(async () => {
    try {
      const dbMod = await import('../db/index.ts');
      dbMod.closeDatabase();
    } catch {
      // ignore
    }
    fs.rmSync(PHASE2_ROOT, { recursive: true, force: true });
  });

  it('1. API Contract, Unified DB Health, Malformed JSON 400 & Unknown Route 404 JSON', async () => {
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.db).toBe('connected');
    expect(health.body.schemaVersion).toBe(4);
    expect(health.body.restaurant).toContain('GOLDEN PALACE POS');
    expect(typeof health.body.time).toBe('string');

    const notFound = await request(app).get('/api/this-route-does-not-exist-p2');
    expect(notFound.status).toBe(404);
    expect(notFound.headers['content-type']).toMatch(/application\/json/);
    expect(notFound.body.code).toBe('API_ROUTE_NOT_FOUND');

    const badJson = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"identifier": "broken_json"');
    expect(badJson.status).toBe(400);
    expect(badJson.headers['content-type']).toMatch(/application\/json/);
    expect(badJson.body.code).toBe('INVALID_JSON');
  });

  it('2. Strict Route Parameter & Enum Validation across 14+ Endpoints', async () => {
    const invalidIdChecks = [
      request(app).get('/api/orders/not-a-number').set('Authorization', `Bearer ${adminToken}`),
      request(app).post('/api/orders/0/cancel').set('Authorization', `Bearer ${adminToken}`).send({ reason: 'test' }),
      request(app).post('/api/orders/-3/refund').set('Authorization', `Bearer ${adminToken}`).send({ reason: 'test' }),
      request(app).post('/api/orders/1.5/resume').set('Authorization', `Bearer ${adminToken}`),
      request(app).post('/api/orders/abc/items').set('Authorization', `Bearer ${adminToken}`).send({ items: [{ productId, quantity: 1 }] }),
      request(app).patch('/api/tables/abc/status').set('Authorization', `Bearer ${adminToken}`).send({ status: 'AVAILABLE' }),
      request(app).patch('/api/kitchen/items/abc/status').set('Authorization', `Bearer ${kitchenToken}`).send({ status: 'READY' }),
      request(app).patch('/api/deliveries/abc/status').set('Authorization', `Bearer ${adminToken}`).send({ status: 'DELIVERED' }),
      request(app).delete('/api/categories/abc').set('Authorization', `Bearer ${adminToken}`),
      request(app).delete('/api/products/abc').set('Authorization', `Bearer ${adminToken}`),
      request(app).patch('/api/products/abc/toggle-available').set('Authorization', `Bearer ${adminToken}`),
      request(app).get('/api/products/abc/price-history').set('Authorization', `Bearer ${adminToken}`),
      request(app).post('/api/sync/conflicts/abc/resolve').set('Authorization', `Bearer ${adminToken}`).send({ action: 'DISCARD' }),
      request(app).post('/api/printer/jobs/abc/confirm').set('Authorization', `Bearer ${adminToken}`),
    ];

    const responses = await Promise.all(invalidIdChecks);
    for (const res of responses) {
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
    }

    // Invalid enum values must return 400
    const badOrderType = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ type: 'INVALID_TYPE', items: [{ productId, quantity: 1 }] });
    expect(badOrderType.status).toBe(400);

    const badTableStatus = await request(app)
      .patch(`/api/tables/${tableAId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'HACKED_STATUS' });
    expect(badTableStatus.status).toBe(400);

    const missingTable = await request(app)
      .patch('/api/tables/999999/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'AVAILABLE' });
    expect(missingTable.status).toBe(404);

    const badKitchenStatus = await request(app)
      .patch('/api/kitchen/items/999999/status')
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'EXPLODED' });
    expect(badKitchenStatus.status).toBe(400);

    const badDeliveryStatus = await request(app)
      .patch('/api/deliveries/999999/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'TELEPORTED' });
    expect(badDeliveryStatus.status).toBe(400);

    const missingDelivery = await request(app)
      .patch('/api/deliveries/999999/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DELIVERED' });
    expect(missingDelivery.status).toBe(404);
  });

  it('3. RBAC Consistency: OWNER authorized across discount & admin flows; INVENTORY blocked from printer confirmation', async () => {
    // INVENTORY role cannot confirm print jobs (403)
    const invConfirm = await request(app)
      .post('/api/printer/jobs/1/confirm')
      .set('Authorization', `Bearer ${inventoryToken}`);
    expect(invConfirm.status).toBe(403);

    // Enable restrict_cashier_discount = 'true'
    const setRes = await request(app)
      .post('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ restrict_cashier_discount: 'true' });
    expect(setRes.status).toBe(200);

    // CASHIER blocked from discount on POST /orders (403)
    const cashierOrdDisc = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ type: 'TAKEAWAY', items: [{ productId, quantity: 1 }], discount: 50 });
    expect(cashierOrdDisc.status).toBe(403);

    // OWNER allowed to create discounted order (201) and modify discount on POST /orders/:id/items (200)
    const ownerOrd = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'TAKEAWAY', items: [{ productId, quantity: 2 }], discount: 100 });
    expect(ownerOrd.status).toBe(201);
    expect(Number(ownerOrd.body.discount)).toBe(100);

    // CASHIER blocked from modifying discount on POST /orders/:id/items too (403)
    const cashierEditDisc = await request(app)
      .post(`/api/orders/${ownerOrd.body.id}/items`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ items: [{ productId, quantity: 2 }], replaceAll: true, discount: 200 });
    expect(cashierEditDisc.status).toBe(403);

    // OWNER allowed to update discount on POST /orders/:id/items (200)
    const ownerEditDisc = await request(app)
      .post(`/api/orders/${ownerOrd.body.id}/items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ items: [{ productId, quantity: 2 }], replaceAll: true, discount: 150 });
    expect(ownerEditDisc.status).toBe(200);
    expect(Number(ownerEditDisc.body.discount)).toBe(150);

    // Clean up order and restore setting
    await request(app).post(`/api/orders/${ownerOrd.body.id}/cancel`).set('Authorization', `Bearer ${adminToken}`).send({ reason: 'cleanup' });
    await request(app).post('/api/settings').set('Authorization', `Bearer ${adminToken}`).send({ restrict_cashier_discount: 'false' });
  });

  it('4. Financial Integrity: Cash Shift Open/Close Validation, Partial Payment Floor, Idempotency & Refund Safety', async () => {
    // Reject invalid openingCash values
    expect(
      (await request(app).post('/api/cash-register/open').set('Authorization', `Bearer ${cashierToken}`).send({ openingCash: -100 })).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/cash-register/open').set('Authorization', `Bearer ${cashierToken}`).send({ openingCash: 'abc' })).status
    ).toBe(400);

    // Open shift cleanly
    const openShift = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ openingCash: 5000 });
    expect(openShift.status).toBe(201);
    const shiftId = openShift.body.id;

    // Duplicate open shift must fail (400)
    const dupShift = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ openingCash: 1000 });
    expect(dupShift.status).toBe(400);

    // Create dine-in order on Table A (2 x 600 = 1200 DA)
    const ordRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'DINE_IN',
        tableId: tableAId,
        items: [{ productId, quantity: 2 }],
        idempotencyKey: 'p2-order-idem-001',
      });
    expect(ordRes.status).toBe(201);
    const orderId = ordRes.body.id;
    expect(Number(ordRes.body.total)).toBe(1200);

    // Idempotent duplicate order returns same order without creating a second one
    const dupOrd = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'DINE_IN',
        tableId: tableAId,
        items: [{ productId, quantity: 2 }],
        idempotencyKey: 'p2-order-idem-001',
      });
    expect(dupOrd.status).toBe(200);
    expect(dupOrd.body.deduplicated).toBe(true);
    expect(dupOrd.body.id).toBe(orderId);

    // Partial payment of 800 DA (with invalid tenderAmount rejected first)
    const badTender = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId,
        payments: [{ method: 'CASH', amount: 800, tenderAmount: -50 }],
      });
    expect(badTender.status).toBe(400);

    const partialPay = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId,
        payments: [{ method: 'CASH', amount: 800, tenderAmount: 1000, changeAmount: 200 }],
        idempotencyKey: 'p2-pay-idem-part1',
      });
    expect(partialPay.status).toBe(200);
    expect(partialPay.body.paymentStatus).toBe('PARTIALLY_PAID');
    expect(partialPay.body.remainingDue).toBe(400);

    // Idempotent retry of same partial payment does NOT double-charge
    const dupPay = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId,
        payments: [{ method: 'CASH', amount: 800, tenderAmount: 1000, changeAmount: 200 }],
        idempotencyKey: 'p2-pay-idem-part1',
      });
    expect(dupPay.status).toBe(200);
    expect(dupPay.body.deduplicated).toBe(true);
    expect(dupPay.body.paidAmount).toBe(800);

    // Partial payment floor guard: CANNOT reduce order total below already paid 800 DA (1 x 600 = 600 < 800)
    const lowerTotalRes = await request(app)
      .post(`/api/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ productId, quantity: 1 }], replaceAll: true });
    expect(lowerTotalRes.status).toBe(400);

    // Discount > subtotal guard on POST /orders/:id/items
    const excessiveDiscRes = await request(app)
      .post(`/api/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ productId, quantity: 2 }], replaceAll: true, discount: 5000 });
    expect(excessiveDiscRes.status).toBe(400);

    // Atomic Table Transfer from Table A -> Table B (preserves WAITING_PAYMENT status)
    const transferRes = await request(app)
      .post('/api/tables/transfer')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ fromTableId: tableAId, toTableId: tableBId });
    expect(transferRes.status).toBe(200);

    // Atomic KDS item update -> READY updates order and table status
    const orderDetail = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(orderDetail.status).toBe(200);
    expect(orderDetail.body.tableId).toBe(tableBId);
    const firstItemId = orderDetail.body.items[0].id;

    const kdsRes = await request(app)
      .patch(`/api/kitchen/items/${firstItemId}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'READY' });
    expect(kdsRes.status).toBe(200);
    expect(kdsRes.body.status).toBe('READY');

    // Finish paying remaining 400 DA
    const finalPay = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId,
        payments: [{ method: 'CASH', amount: 400 }],
        idempotencyKey: 'p2-pay-idem-part2',
      });
    expect(finalPay.status).toBe(200);
    expect(finalPay.body.paymentStatus).toBe('PAID');

    // Close shift: reject negative & invalid closingCash first
    expect(
      (await request(app).post('/api/cash-register/close').set('Authorization', `Bearer ${cashierToken}`).send({ shiftId, closingCash: -1 })).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/cash-register/close').set('Authorization', `Bearer ${cashierToken}`).send({ shiftId, closingCash: 'bad' })).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/cash-register/close').set('Authorization', `Bearer ${cashierToken}`).send({ shiftId: 'bad', closingCash: 6200 })).status
    ).toBe(400);

    const closeShift = await request(app)
      .post('/api/cash-register/close')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ shiftId, closingCash: 6200 });
    expect(closeShift.status).toBe(200);
    expect(Number(closeShift.body.expectedCash)).toBe(6200); // 5000 opening + 1200 cash sales
    expect(Number(closeShift.body.difference)).toBe(0);

    // Refund AFTER shift closed: must succeed once, block double refund, and NOT mutate the CLOSED shift
    const refund1 = await request(app)
      .post(`/api/orders/${orderId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'عميل طلب الاسترداد' });
    expect(refund1.status).toBe(200);

    const refund2 = await request(app)
      .post(`/api/orders/${orderId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'محاولة تكرار' });
    expect(refund2.status).toBe(400);

    const { sqlite } = await import('../db/index.ts');
    const closedShiftRow = sqlite.prepare('SELECT total_cash_out FROM cash_shifts WHERE id = ?').get(shiftId) as any;
    expect(Number(closedShiftRow.total_cash_out)).toBe(0);
  });

  it('5. Inventory, Waste & Purchases Validation and Transaction Boundaries', async () => {
    const { sqlite } = await import('../db/index.ts');
    const beforeStock = Number((sqlite.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(ingredientId) as any).current_stock);

    // Waste rejects 0, negative, NaN quantity, negative cost, and unknown ingredientId
    expect(
      (await request(app).post('/api/waste').set('Authorization', `Bearer ${inventoryToken}`).send({ ingredientId, name: 'جبن', quantity: -5, reason: 'EXPIRED' })).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/waste').set('Authorization', `Bearer ${inventoryToken}`).send({ ingredientId, name: 'جبن', quantity: 0, reason: 'EXPIRED' })).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/waste').set('Authorization', `Bearer ${inventoryToken}`).send({ ingredientId, name: 'جبن', quantity: 1, cost: -10, reason: 'EXPIRED' })).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/waste').set('Authorization', `Bearer ${inventoryToken}`).send({ ingredientId: 999999, name: 'جبن', quantity: 1, reason: 'EXPIRED' })).status
    ).toBe(404);

    // Stock untouched after rejected waste calls
    expect(Number((sqlite.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(ingredientId) as any).current_stock)).toBe(beforeStock);

    // Valid waste atomically deducts 1.5 KG
    const okWaste = await request(app)
      .post('/api/waste')
      .set('Authorization', `Bearer ${inventoryToken}`)
      .send({ ingredientId, name: 'جبن موزاريلا', quantity: 1.5, unit: 'KG', cost: 1800, reason: 'EXPIRED' });
    expect(okWaste.status).toBe(201);
    expect(Number((sqlite.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(ingredientId) as any).current_stock)).toBeCloseTo(beforeStock - 1.5, 4);

    // Purchases reject negative/zero qty, negative unitCost, missing supplier (404), missing ingredient (404)
    expect(
      (await request(app).post('/api/purchases').set('Authorization', `Bearer ${inventoryToken}`).send({ supplierId, items: [{ ingredientId, quantity: -2, unitCost: 1000 }] })).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/purchases').set('Authorization', `Bearer ${inventoryToken}`).send({ supplierId, items: [{ ingredientId, quantity: 2, unitCost: -100 }] })).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/purchases').set('Authorization', `Bearer ${inventoryToken}`).send({ supplierId: 999999, items: [{ ingredientId, quantity: 2, unitCost: 1000 }] })).status
    ).toBe(404);
    expect(
      (await request(app).post('/api/purchases').set('Authorization', `Bearer ${inventoryToken}`).send({ supplierId, items: [{ ingredientId: 999999, quantity: 2, unitCost: 1000 }] })).status
    ).toBe(404);

    // Zero partial purchase rows inserted on rejected purchases
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM purchases').get() as any).c).toBe(0);

    // Valid purchase atomically increments stock by 5 KG and records exact total
    const okPurchase = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${inventoryToken}`)
      .send({ supplierId, items: [{ ingredientId, quantity: 5, unitCost: 1250.5 }] });
    expect(okPurchase.status).toBe(201);
    expect(Number(okPurchase.body.totalAmount)).toBe(6252.5);
    expect(Number((sqlite.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(ingredientId) as any).current_stock)).toBeCloseTo(beforeStock + 3.5, 4);

    // Atomic inventory adjustment computes exact delta inside transaction & returns 404 for unknown ID
    expect(
      (await request(app).post('/api/inventory/adjust').set('Authorization', `Bearer ${inventoryToken}`).send({ ingredientId: 'bad', actualQuantity: 10 })).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/inventory/adjust').set('Authorization', `Bearer ${inventoryToken}`).send({ ingredientId: 999999, actualQuantity: 10 })).status
    ).toBe(404);
    const okAdjust = await request(app)
      .post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${inventoryToken}`)
      .send({ ingredientId, actualQuantity: 25, reason: 'جرد دوري' });
    expect(okAdjust.status).toBe(200);
    expect(Number((sqlite.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(ingredientId) as any).current_stock)).toBe(25);
  });

  it('6. Credential-Free Structured Error Logging Redacts Secrets, JWTs, Passwords & PINs', async () => {
    const { logStructuredError } = await import('../middleware/errorHandler.ts');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      logStructuredError(
        'PHASE2_REDACTION_CHECK',
        new Error('Auth failed with Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.sig123 password=SuperSecret1 pin=7391 apiKey=sk_live_999'),
        { method: 'POST', originalUrl: '/api/auth/login?token=secret_tok_123' } as any
      );
      expect(spy).toHaveBeenCalledTimes(1);
      const loggedLine = String(spy.mock.calls[0][0]);
      const parsed = JSON.parse(loggedLine);
      expect(parsed.level).toBe('error');
      expect(parsed.context).toBe('PHASE2_REDACTION_CHECK');
      expect(loggedLine).not.toContain('SuperSecret1');
      expect(loggedLine).not.toContain('7391');
      expect(loggedLine).not.toContain('sk_live_999');
      expect(loggedLine).not.toContain('secret_tok_123');
      expect(loggedLine).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    } finally {
      spy.mockRestore();
    }
  });

  it('7. Frontend API Client Offline Compatibility: falls back on network error, NEVER on HTTP 403/404 client errors', async () => {
    // Provide minimal localStorage + fetch stubs in node environment to verify api.ts request() contract directly
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });

    const offlineStorage = await import('../services/offlineStorage.ts');
    const { api, setAuthToken } = await import('../services/api.ts');
    setAuthToken('dummy-token-for-client-contract');

    // Pre-populate cached /users data from a previous admin session
    await offlineStorage.setCachedData('/users', [{ id: 1, username: 'cached_admin' }]);

    // Case A: HTTP 403 Forbidden MUST reject and MUST NOT serve stale cached admin data!
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'عذراً، ليس لديك صلاحية للقيام بهذه العملية' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    await expect(api.getUsers()).rejects.toThrow('عذراً، ليس لديك صلاحية للقيام بهذه العملية');

    // Case B: Genuine network failure (TypeError: Failed to fetch) DOES fall back to offline cache
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const cachedUsers = await api.getUsers();
    expect(cachedUsers).toEqual([{ id: 1, username: 'cached_admin' }]);

    vi.unstubAllGlobals();
  });
});
