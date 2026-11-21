// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { closeSqliteHandle, removeIsolatedTestDir } from './testCleanup.ts';

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_phase10_qa_'));
const TEST_DB_PATH = path.join(TEST_ROOT, 'phase10_isolated.db');
const TEST_BACKUP_DIR = path.join(TEST_ROOT, 'backups');
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.GOLDEN_PALACE_BACKUP_DIR = TEST_BACKUP_DIR;
process.env.JWT_SECRET = 'phase10_qa_secret_at_least_32_characters_long_12345';

let app: express.Express;
let sqlite: any;
let db: any;
let closeDatabase: (() => void) | undefined;
let signUserToken: any;
let clearRateLimitsForTest: any;
let backupManager: any;
let adminToken: string;
let cashierToken: string;
let kitchenToken: string;
let productA: any;
let ingredientA: any;

async function bootstrap() {
  const dbMod = await import('../db/index.ts');
  sqlite = dbMod.sqlite;
  db = dbMod.db;
  closeDatabase = dbMod.closeDatabase;

  const { seedDatabase } = await import('../db/seed.ts');
  await seedDatabase();

  const authMod = await import('../middleware/auth.ts');
  signUserToken = authMod.signUserToken;

  const rateMod = await import('../middleware/rateLimit.ts');
  clearRateLimitsForTest = rateMod.clearRateLimitsForTest;

  const backupMod = await import('../services/backupService.ts');
  backupManager = backupMod.backupManager;

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
  const kitchenRow = sqlite.prepare("SELECT * FROM users WHERE role = 'KITCHEN' LIMIT 1").get();

  adminToken = makeToken(adminRow);
  cashierToken = cashierRow ? makeToken(cashierRow) : adminToken;
  kitchenToken = kitchenRow ? makeToken(kitchenRow) : adminToken;
}

describe('Golden Palace POS — Phase 10 Final Financial Integrity, Security & Release QA', () => {
  beforeAll(async () => {
    await bootstrap();
    expect(sqlite.name).toBe(TEST_DB_PATH);
    expect(sqlite.name).not.toContain('golden_palace.db');

    const prods = sqlite.prepare('SELECT * FROM products WHERE is_available = 1 ORDER BY id ASC LIMIT 1').all();
    expect(prods.length).toBeGreaterThanOrEqual(1);
    productA = prods[0];

    sqlite
      .prepare(
        "INSERT INTO ingredients (name_ar, name_fr, unit, current_stock, min_stock, cost_per_unit) VALUES ('مكون فحص 10', 'Ingrédient P10', 'KG', 50, 5, 200)"
      )
      .run();
    ingredientA = sqlite.prepare("SELECT * FROM ingredients WHERE name_ar = 'مكون فحص 10'").get();
    sqlite
      .prepare('INSERT INTO product_recipes (product_id, ingredient_id, quantity) VALUES (?, ?, ?)')
      .run(productA.id, ingredientA.id, 1.5);
  });

  beforeEach(() => {
    clearRateLimitsForTest?.();
  });

  afterAll(async () => {
    try {
      if (closeDatabase) {
        closeDatabase();
      } else {
        const dbMod = await import('../db/index.ts');
        dbMod.closeDatabase();
      }
    } finally {
      closeSqliteHandle(sqlite);
    }
    removeIsolatedTestDir(TEST_ROOT);
  });

  it('1. Financial Integrity: split payments reconcile exactly, overpayment is rejected, and retries never double-charge', async () => {
    // Set 9% TVA tax_rate to verify decimal rounding consistency
    await request(app)
      .post('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tax_rate: '9' });

    const shiftRes = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ openingCash: 10000, notes: 'P10 Shift 1' });
    expect(shiftRes.status).toBe(201);
    const shiftId = shiftRes.body.id;

    const stockBefore = Number(
      (sqlite.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(ingredientA.id) as any).current_stock
    );

    const ordRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: productA.id, quantity: 2 }],
        discount: 50,
        idempotencyKey: 'p10-ord-split-1',
      });
    expect(ordRes.status).toBe(201);
    const orderTotal = Number(ordRes.body.total);
    const expectedTax = Math.round((((Number(productA.price) * 2 - 50) * 9) / 100) * 100) / 100;
    expect(Number(ordRes.body.taxAmount)).toBe(expectedTax);

    // Retry same order idempotencyKey -> returns same order ID, zero duplicate stock deduction
    const ordRetry = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: productA.id, quantity: 2 }],
        discount: 50,
        idempotencyKey: 'p10-ord-split-1',
      });
    expect(ordRetry.status).toBe(200);
    expect(ordRetry.body.id).toBe(ordRes.body.id);

    const stockAfterOrder = Number(
      (sqlite.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(ingredientA.id) as any).current_stock
    );
    expect(stockBefore - stockAfterOrder).toBeCloseTo(3.0, 4); // 2 * 1.5 KG deducted once

    // Attempting overpayment beyond orderTotal must be rejected with 400
    const overPay = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId: ordRes.body.id,
        payments: [
          { method: 'CASH', amount: orderTotal },
          { method: 'CARD', amount: 100 },
        ],
        idempotencyKey: 'p10-pay-over-1',
      });
    expect(overPay.status).toBe(400);

    // Valid split payment across CASH + CARD + CCP reconciling exactly to orderTotal
    const partCash = Math.round((orderTotal * 0.5) * 100) / 100;
    const partCard = Math.round((orderTotal * 0.25) * 100) / 100;
    const partCcp = Math.round((orderTotal - partCash - partCard) * 100) / 100;

    const splitPay = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId: ordRes.body.id,
        payments: [
          { method: 'CASH', amount: partCash, tenderAmount: partCash + 200, changeAmount: 200 },
          { method: 'CARD', amount: partCard },
          { method: 'CCP', amount: partCcp },
        ],
        idempotencyKey: 'p10-pay-split-1',
      });
    expect(splitPay.status).toBe(200);
    expect(splitPay.body.paymentStatus).toBe('PAID');
    expect(splitPay.body.remainingDue).toBe(0);

    // Retry identical split payment -> deduplicated cleanly, zero double payment rows
    const splitPayRetry = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId: ordRes.body.id,
        payments: [
          { method: 'CASH', amount: partCash },
          { method: 'CARD', amount: partCard },
          { method: 'CCP', amount: partCcp },
        ],
        idempotencyKey: 'p10-pay-split-1',
      });
    expect(splitPayRetry.status).toBe(200);
    expect(splitPayRetry.body.deduplicated).toBe(true);

    const paymentRows = sqlite
      .prepare('SELECT method, CAST(amount AS REAL) as amt FROM payments WHERE order_id = ?')
      .all(ordRes.body.id) as { method: string; amt: number }[];
    expect(paymentRows.length).toBe(3);
    const summedPayments = Math.round(paymentRows.reduce((s, r) => s + r.amt, 0) * 100) / 100;
    expect(summedPayments).toBeCloseTo(orderTotal, 2);

    // Close shift cleanly
    const closeRes = await request(app)
      .post('/api/cash-register/close')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ shiftId, closingCash: 10000 + partCash, notes: 'Close P10 Shift 1' });
    expect(closeRes.status).toBe(200);
    expect(Number(closeRes.body.expectedCash)).toBeCloseTo(10000 + partCash, 2);

    // CLOSED SHIFT IMMUTABILITY: movement, expense, and refund must NEVER alter closed shift totals
    const closedMov = await request(app)
      .post('/api/cash-register/movement')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shiftId, type: 'CASH_OUT', amount: 500, reason: 'Late tamper attempt' });
    expect(closedMov.status).toBe(400);

    const closedExp = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'SUPPLIES', amount: 500, description: 'Late tamper expense', shiftId });
    expect(closedExp.status).toBe(400);

    const negExp = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'SUPPLIES', amount: -200, description: 'Negative expense' });
    expect(negExp.status).toBe(400);

    // Refund order after shift closed -> preserves closed shift totalCashOut = 0
    const refundRes = await request(app)
      .post(`/api/orders/${ordRes.body.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Customer return after close' });
    expect(refundRes.status).toBe(200);

    const shiftAfterRefund = sqlite.prepare('SELECT total_cash_out, total_expenses FROM cash_shifts WHERE id = ?').get(shiftId) as any;
    expect(Number(shiftAfterRefund.total_cash_out)).toBe(0);
    expect(Number(shiftAfterRefund.total_expenses)).toBe(0);
  });

  it('2. Reports Reconciliation: /api/reports/dashboard matches SQLite net active orders, payments & expenses', async () => {
    // Open a clean shift, place 1 paid order & 1 cancelled order, and record 1 expense
    const openShift = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingCash: 5000, notes: 'P10 Report Shift' });
    expect(openShift.status).toBe(201);
    const shiftId = openShift.body.id;

    const validOrder = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: productA.id, quantity: 1 }],
        idempotencyKey: 'p10-rep-ord-valid',
      });
    expect(validOrder.status).toBe(201);
    const validTotal = Number(validOrder.body.total);

    await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        orderId: validOrder.body.id,
        payments: [{ method: 'CASH', amount: validTotal }],
        idempotencyKey: 'p10-rep-pay-valid',
      });

    const cancelOrder = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: productA.id, quantity: 1 }],
        idempotencyKey: 'p10-rep-ord-cancel',
      });
    expect(cancelOrder.status).toBe(201);
    await request(app)
      .post(`/api/orders/${cancelOrder.body.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Void test' });

    const expRes = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'UTILITIES', amount: 300, description: 'Water bottle pack', shiftId });
    expect(expRes.status).toBe(201);

    const dashRes = await request(app)
      .get('/api/reports/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dashRes.status).toBe(200);

    // Direct SQLite ground-truth reconciliation
    const dbSales = sqlite
      .prepare(
        "SELECT COALESCE(SUM(CAST(total AS REAL)), 0) as s, COUNT(*) as c FROM orders WHERE is_held = 0 AND status NOT IN ('CANCELLED', 'REFUNDED') AND payment_status != 'REFUNDED'"
      )
      .get() as { s: number; c: number };
    const dbExpenses = sqlite.prepare('SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as e FROM expenses').get() as { e: number };

    expect(Number(dashRes.body.salesToday)).toBeCloseTo(Number(dbSales.s), 2);
    expect(Number(dashRes.body.orderCount)).toBe(Number(dbSales.c));
    expect(Number(dashRes.body.expensesToday)).toBeCloseTo(Number(dbExpenses.e), 2);
    expect(Number(dashRes.body.netSales)).toBeCloseTo(Number(dbSales.s) - Number(dbExpenses.e), 2);
  });

  it('3. Security Audit: path traversal, SQL injection resilience, weak PIN blocking, RBAC print retry & backup permissions', async () => {
    // Path traversal blocked both in BackupManager and /api/backups/download
    expect(() => backupManager.resolveSafeBackupPath('../../etc/passwd')).toThrow();
    expect(() => backupManager.resolveSafeBackupPath('sub/backup.db')).toThrow();

    const dlTraversal = await request(app)
      .get('/api/backups/download/..%2F..%2Fpackage.json')
      .set('Authorization', `Bearer ${adminToken}`);
    expect([400, 404]).toContain(dlTraversal.status);

    // Cashier cannot access ADMIN-only backup endpoints
    const cashierBackup = await request(app)
      .get('/api/backups')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(cashierBackup.status).toBe(403);

    // Weak PIN ('0000') rejected when creating new staff user
    const weakStaffPin = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'weak_pin_tester',
        email: 'weak@goldenpalace.dz',
        password: 'StrongPassword99!',
        pin: '0000',
        fullName: 'Weak Pin',
        role: 'CASHIER',
      });
    expect(weakStaffPin.status).toBe(400);

    // SQL injection payload in search/order lookup does not drop tables or leak errors
    const sqliRes = await request(app)
      .get("/api/orders?search=' OR 1=1; DROP TABLE users; --")
      .set('Authorization', `Bearer ${adminToken}`);
    expect(sqliRes.status).toBe(200);
    const userCountAfter = (sqlite.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    expect(userCountAfter).toBeGreaterThanOrEqual(1);

    // Unauthorized retry of an isReprint job by KITCHEN role is blocked with 403
    const insertedReprint = sqlite
      .prepare(
        "INSERT INTO print_jobs (order_number, job_type, printer_name, connection_type, paper_width, status, is_reprint, job_key, attempts) VALUES ('BON-SEC-1', 'RECEIPT', 'CAFETERIA', 'WINDOWS_SPOOLER', '80mm', 'FAILED', 1, 'reprint_sec_1', 1)"
      )
      .run();
    const reprintJobId = insertedReprint.lastInsertRowid;

    const kitchenRetry = await request(app)
      .post(`/api/printer/jobs/${reprintJobId}/retry`)
      .set('Authorization', `Bearer ${kitchenToken}`);
    expect(kitchenRetry.status).toBe(403);
  });

  it('4. Electron & Windows Packaging Configuration Security Audit', () => {
    const mainCjs = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
    const preloadCjs = fs.readFileSync(path.resolve(process.cwd(), 'electron/preload.cjs'), 'utf8');
    const builderYml = fs.readFileSync(path.resolve(process.cwd(), 'electron-builder.yml'), 'utf8');

    expect(mainCjs).toContain('requestSingleInstanceLock');
    expect(mainCjs).toContain("HOST: '127.0.0.1'");
    expect(mainCjs).toContain('contextIsolation: true');
    expect(mainCjs).toContain('nodeIntegration: false');
    expect(mainCjs).toContain('.jwt_secret');
    expect(mainCjs).toContain('stopLocalPosServer');

    expect(preloadCjs).toContain('contextBridge.exposeInMainWorld');
    expect(preloadCjs).not.toContain("require('fs')");
    expect(preloadCjs).not.toContain('child_process');
    expect(preloadCjs).toContain('desktop:get-printers');
    expect(preloadCjs).toContain('desktop:print-silent');
    expect(preloadCjs).toContain('desktop:get-info');
    expect(builderYml).toContain('deleteAppDataOnUninstall: false');
    expect(builderYml).toContain('better-sqlite3');
  });

  it('5. Shift Expense Regression: assigns cashierId from auth user, blocks unauthorized roles, and rolls back atomically on failure', async () => {
    const adminRow = sqlite.prepare("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1").get() as { id: number };
    const openShiftRes = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingCash: 3000, notes: 'Expense Regression Shift' });
    // Reuse existing open shift if one is already open from test 2
    const activeShiftId =
      openShiftRes.status === 201
        ? Number(openShiftRes.body.id)
        : Number((sqlite.prepare("SELECT id FROM cash_shifts WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get() as any).id);

    const expCountBefore = (sqlite.prepare('SELECT COUNT(*) as c FROM expenses').get() as any).c;
    const movCountBefore = (sqlite.prepare('SELECT COUNT(*) as c FROM cash_movements').get() as any).c;

    // Unauthenticated & unauthorized roles rejected
    const unauthRes = await request(app)
      .post('/api/expenses')
      .send({ category: 'SUPPLIES', amount: 150, description: 'Unauth test', shiftId: activeShiftId });
    expect(unauthRes.status).toBe(401);

    const cashierRes = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ category: 'SUPPLIES', amount: 150, description: 'Cashier forbidden test', shiftId: activeShiftId });
    expect(cashierRes.status).toBe(403);

    const kitchenRes = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ category: 'SUPPLIES', amount: 150, description: 'Kitchen forbidden test', shiftId: activeShiftId });
    expect(kitchenRes.status).toBe(403);

    expect((sqlite.prepare('SELECT COUNT(*) as c FROM expenses').get() as any).c).toBe(expCountBefore);
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM cash_movements').get() as any).c).toBe(movCountBefore);

    // Valid shift-linked expense assigns cashier_id and performed_by from authenticated user
    const okExp = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'MAINTENANCE', amount: 425.5, description: 'Filter replacement', shiftId: activeShiftId });
    expect(okExp.status).toBe(201);

    const lastExpense = sqlite.prepare('SELECT * FROM expenses ORDER BY id DESC LIMIT 1').get() as any;
    const lastMovement = sqlite.prepare('SELECT * FROM cash_movements ORDER BY id DESC LIMIT 1').get() as any;
    expect(lastExpense.shift_id).toBe(activeShiftId);
    expect(lastExpense.user_id).toBe(adminRow.id);
    expect(lastMovement.type).toBe('EXPENSE');
    expect(lastMovement.shift_id).toBe(activeShiftId);
    expect(lastMovement.cashier_id).toBe(adminRow.id);
    expect(lastMovement.performed_by).toBe(adminRow.id);
    expect(Number(lastMovement.amount)).toBeCloseTo(425.5, 2);

    const shiftTotalBeforeFail = Number(
      (sqlite.prepare('SELECT total_expenses FROM cash_shifts WHERE id = ?').get(activeShiftId) as any).total_expenses
    );
    const expCountBeforeFail = (sqlite.prepare('SELECT COUNT(*) as c FROM expenses').get() as any).c;

    // Simulate mid-transaction cash_movements insert failure -> expenses insert MUST roll back atomically
    sqlite.exec(`
      CREATE TRIGGER trg_fail_cash_movement_test
      BEFORE INSERT ON cash_movements
      WHEN NEW.type = 'EXPENSE'
      BEGIN
        SELECT RAISE(ABORT, 'SIMULATED_MOVEMENT_FAILURE');
      END;
    `);
    try {
      const failedExp = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ category: 'SUPPLIES', amount: 999, description: 'Should rollback completely', shiftId: activeShiftId });
      expect(failedExp.status).toBe(500);
    } finally {
      sqlite.exec('DROP TRIGGER IF EXISTS trg_fail_cash_movement_test;');
    }

    expect((sqlite.prepare('SELECT COUNT(*) as c FROM expenses').get() as any).c).toBe(expCountBeforeFail);
    const shiftTotalAfterFail = Number(
      (sqlite.prepare('SELECT total_expenses FROM cash_shifts WHERE id = ?').get(activeShiftId) as any).total_expenses
    );
    expect(shiftTotalAfterFail).toBeCloseTo(shiftTotalBeforeFail, 2);
  });
});
