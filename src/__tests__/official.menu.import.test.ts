import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_official_menu_test_'));
const TEST_DB_PATH = path.join(TEST_ROOT, 'isolated_official_menu.db');
const TEST_BACKUP_DIR = path.join(TEST_ROOT, 'backups');

process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.BACKUP_DIR = TEST_BACKUP_DIR;
process.env.JWT_SECRET = 'official_menu_isolated_test_jwt_secret_key_32plus_chars';
process.env.NODE_ENV = 'test';

const OFFICIAL_MENU_DIR = path.resolve(process.cwd(), 'data/official-menu');
const OFFICIAL_JSON_PATH = path.join(OFFICIAL_MENU_DIR, 'golden_palace_official_menu.json');
const OFFICIAL_CSV_PATH = path.join(OFFICIAL_MENU_DIR, 'golden_palace_official_menu.csv');
const OFFICIAL_XLSX_PATH = path.join(OFFICIAL_MENU_DIR, 'golden_palace_official_menu.xlsx');

describe('GOLDEN PALACE POS — Official Menu Integration & Import Module (TEST 01 – TEST 23)', () => {
  let app: express.Express;
  let sqlite: any;
  let db: any;
  let closeDatabase: () => void;
  let ensureThirtyTables: () => Promise<void>;
  let previewMenuImport: any;
  let commitMenuImport: any;

  let adminToken = '';
  let managerToken = '';
  let cashierToken = '';
  let waiterToken = '';
  let kitchenToken = '';
  let adminUserId = 0;

  let officialJsonRaw = '';
  let officialCsvRaw = '';
  let officialXlsxBase64 = '';
  let officialJsonObj: any = null;

  beforeAll(async () => {
    officialJsonRaw = fs.readFileSync(OFFICIAL_JSON_PATH, 'utf8');
    officialCsvRaw = fs.readFileSync(OFFICIAL_CSV_PATH, 'utf8');
    officialXlsxBase64 = fs.readFileSync(OFFICIAL_XLSX_PATH).toString('base64');
    officialJsonObj = JSON.parse(officialJsonRaw);

    const dbMod = await import('../db/index.ts');
    sqlite = dbMod.sqlite;
    db = dbMod.db;
    closeDatabase = dbMod.closeDatabase;

    const seedMod = await import('../db/seed.ts');
    ensureThirtyTables = seedMod.ensureThirtyTables;

    const importMod = await import('../services/menuImportService.ts');
    previewMenuImport = importMod.previewMenuImport;
    commitMenuImport = importMod.commitMenuImport;

    const { apiRouter } = await import('../server/api.ts');
    app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api', apiRouter);
  });

  afterAll(() => {
    try {
      closeDatabase();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  async function seedTestStaffUsers() {
    const { signUserToken } = await import('../middleware/auth.ts');
    const pwHash = await bcrypt.hash('GoldenTest#2026', 10);

    const createRoleUser = (username: string, role: any, fullName: string) => {
      const res = sqlite
        .prepare(
          `INSERT INTO users (uid, username, email, password_hash, full_name, role, is_active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`
        )
        .run(`uid-${username}`, username, `${username}@goldenpalace.local`, pwHash, fullName, role);
      const id = Number(res.lastInsertRowid);
      const token = signUserToken({
        id,
        uid: `uid-${username}`,
        username,
        email: `${username}@goldenpalace.local`,
        fullName,
        role,
      });
      return { id, token };
    };

    const admin = createRoleUser('owner_admin', 'ADMIN', 'مدير القصر الذهبي');
    const manager = createRoleUser('mgr_user', 'MANAGER', 'مشرف الصالة');
    const cashier = createRoleUser('cashier_user', 'CASHIER', 'أمين الصندوق');
    const waiter = createRoleUser('waiter_user', 'WAITER', 'نادل الصالة');
    const kitchen = createRoleUser('kitchen_user', 'KITCHEN', 'شيف المطبخ');

    adminUserId = admin.id;
    adminToken = admin.token;
    managerToken = manager.token;
    cashierToken = cashier.token;
    waiterToken = waiter.token;
    kitchenToken = kitchen.token;
  }

  // TEST 01
  it('TEST 01 — Fresh empty database initialization (zero categories, products, variants, addons, orders)', async () => {
    const countOf = (table: string) =>
      Number((sqlite.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as any)?.c || 0);

    expect(countOf('categories')).toBe(0);
    expect(countOf('products')).toBe(0);
    expect(countOf('product_variants')).toBe(0);
    expect(countOf('product_addons')).toBe(0);
    expect(countOf('orders')).toBe(0);
    expect(countOf('menu_import_history')).toBe(0);

    const integrity = sqlite.pragma('integrity_check') as { integrity_check: string }[];
    expect(integrity[0]?.integrity_check).toBe('ok');

    // Seed only staff accounts for API RBAC tests (menu stays completely empty)
    await seedTestStaffUsers();
  });

  // TEST 08
  it('TEST 08 — Invalid price formats rejected (negative, decimal/float, non-numeric, missing)', async () => {
    const badCsv = [
      'category_ar,name_ar,price,variant_l_price,variant_xl_price',
      'المقبلات,منتج سالب,-100,,',
      'المقبلات,منتج عشري,250.5,,',
      'المقبلات,منتج نصي,abc,,',
      'المقبلات,منتج بدون سعر,,,',
      'البيتزا,بيتزا تالفة,400,400.75,800',
    ].join('\n');

    const previewRes = await request(app)
      .post('/api/menu/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ filename: 'invalid_prices.csv', format: 'CSV', content: badCsv });

    expect(previewRes.status).toBe(200);
    expect(previewRes.body.canImport).toBe(false);
    expect(previewRes.body.invalidCount).toBe(5);
    expect(previewRes.body.validCount).toBe(0);

    const commitRes = await request(app)
      .post('/api/menu/import/commit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ filename: 'invalid_prices.csv', format: 'CSV', content: badCsv, confirmed: true });

    expect(commitRes.status).toBe(400);
    expect(Number((sqlite.prepare('SELECT COUNT(*) as c FROM products').get() as any).c)).toBe(0);
  });

  // TEST 09
  it('TEST 09 — Malformed import files rejected cleanly (corrupt JSON, bad CSV headers, corrupt XLSX, unsupported ext)', async () => {
    const badJson = await request(app)
      .post('/api/menu/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ filename: 'corrupt.json', content: '{not-valid-json' });
    expect(badJson.status).toBe(400);

    const badCsvHeaders = await request(app)
      .post('/api/menu/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ filename: 'bad_headers.csv', content: 'col1,col2\nfoo,bar' });
    expect(badCsvHeaders.status).toBe(400);

    const badXlsx = await request(app)
      .post('/api/menu/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ filename: 'corrupt.xlsx', contentBase64: Buffer.from('not-an-xlsx-zip').toString('base64') });
    expect(badXlsx.status).toBe(400);

    const unsupportedExt = await request(app)
      .post('/api/menu/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ filename: 'menu.txt', content: 'hello' });
    expect(unsupportedExt.status).toBe(400);

    // Non-admin role cannot preview or import
    const cashierBlocked = await request(app)
      .post('/api/menu/import/preview')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ filename: 'golden_palace_official_menu.json', content: officialJsonRaw });
    expect(cashierBlocked.status).toBe(403);
  });

  // TEST 10
  it('TEST 10 — Failed import rolls back transaction completely with zero partial records', async () => {
    await expect(
      commitMenuImport(
        {
          filename: 'golden_palace_official_menu.json',
          format: 'JSON',
          content: officialJsonRaw,
          confirmed: true,
        },
        { userId: adminUserId, userName: 'مدير القصر الذهبي' },
        { failAfterProductsCount: 15, skipBackupForUnitTest: true }
      )
    ).rejects.toThrow('SIMULATED_IMPORT_TRANSACTION_FAILURE');

    expect(Number((sqlite.prepare('SELECT COUNT(*) as c FROM categories').get() as any).c)).toBe(0);
    expect(Number((sqlite.prepare('SELECT COUNT(*) as c FROM products').get() as any).c)).toBe(0);
    expect(Number((sqlite.prepare('SELECT COUNT(*) as c FROM product_variants').get() as any).c)).toBe(0);

    const rollbackLog = sqlite
      .prepare("SELECT * FROM audit_logs WHERE action = 'MENU_IMPORT_ROLLBACK'")
      .all();
    expect(rollbackLog.length).toBeGreaterThanOrEqual(1);
  });

  // TEST 02, TEST 03, TEST 11 — Preview all 3 formats (CSV, XLSX, JSON), enforce confirmation, create verified backup, commit official menu
  it('TEST 02, TEST 03 & TEST 11 — Preview CSV/XLSX/JSON, require explicit confirmation, create verified pre-import backup, and import all 12 categories & 105 products', async () => {
    // 1. Verify CSV preview parses 12 categories, 105 products, 20 variants, 0 errors, 0 duplicates
    const csvPreview = await request(app)
      .post('/api/menu/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ filename: 'golden_palace_official_menu.csv', format: 'CSV', content: officialCsvRaw });
    expect(csvPreview.status).toBe(200);
    expect(csvPreview.body.canImport).toBe(true);
    expect(csvPreview.body.categoriesCount).toBe(12);
    expect(csvPreview.body.subcategoriesCount).toBe(2);
    expect(csvPreview.body.productsCount).toBe(105);
    expect(csvPreview.body.variantsCount).toBe(20);
    expect(csvPreview.body.duplicateCount).toBe(0);
    expect(csvPreview.body.invalidCount).toBe(0);

    // 2. Verify XLSX preview parses identical counts
    const xlsxPreview = await request(app)
      .post('/api/menu/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        filename: 'golden_palace_official_menu.xlsx',
        format: 'XLSX',
        contentBase64: officialXlsxBase64,
      });
    expect(xlsxPreview.status).toBe(200);
    expect(xlsxPreview.body.canImport).toBe(true);
    expect(xlsxPreview.body.categoriesCount).toBe(12);
    expect(xlsxPreview.body.productsCount).toBe(105);
    expect(xlsxPreview.body.variantsCount).toBe(20);

    // 3. Commit without explicit confirmation MUST fail
    const unconfirmed = await request(app)
      .post('/api/menu/import/commit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        filename: 'golden_palace_official_menu.json',
        format: 'JSON',
        content: officialJsonRaw,
        confirmed: false,
      });
    expect(unconfirmed.status).toBe(400);

    // 4. Commit official menu from XLSX with explicit admin confirmation
    const commitRes = await request(app)
      .post('/api/menu/import/commit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        filename: 'golden_palace_official_menu.xlsx',
        format: 'XLSX',
        contentBase64: officialXlsxBase64,
        confirmed: true,
      });

    expect(commitRes.status).toBe(201);
    expect(commitRes.body.success).toBe(true);
    expect(commitRes.body.inserted.categories).toBe(12);
    expect(commitRes.body.inserted.products).toBe(105);
    expect(commitRes.body.inserted.variants).toBe(20);
    expect(commitRes.body.verification.verified).toBe(true);
    expect(commitRes.body.verification.integrityCheck).toBe('ok');
    expect(commitRes.body.verification.foreignKeyViolations).toBe(0);

    // TEST 11: Verified pre-import backup exists on disk
    expect(commitRes.body.backup.filename).toContain('_pre_import_');
    expect(commitRes.body.backup.integrityCheck).toBe('ok');
    expect(fs.existsSync(commitRes.body.backup.filePath)).toBe(true);
    expect(fs.statSync(commitRes.body.backup.filePath).size).toBeGreaterThan(0);

    // Verify menu_import_history recorded
    const historyRes = await request(app)
      .get('/api/menu/import/history')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.length).toBe(1);
    expect(historyRes.body[0].productsCount).toBe(105);
    expect(historyRes.body[0].backupFilename).toBe(commitRes.body.backup.filename);
  });

  // TEST 04
  it('TEST 04 — Verify exact Arabic product names and integer DA prices for all 105 products', async () => {
    const dbRows = sqlite
      .prepare(
        `SELECT c.name_ar as category_ar, p.name_ar, p.name_fr, p.price, p.subcategory_ar
         FROM products p
         JOIN categories c ON c.id = p.category_id`
      )
      .all() as { category_ar: string; name_ar: string; name_fr: string; price: any; subcategory_ar: string | null }[];

    expect(dbRows.length).toBe(105);

    const dbMap = new Map<string, number>();
    for (const r of dbRows) {
      const priceNum = Number(r.price);
      expect(Number.isInteger(priceNum)).toBe(true);
      dbMap.set(`${r.category_ar}::${r.name_ar}`, priceNum);
    }

    for (const expected of officialJsonObj.products) {
      const key = `${expected.category_ar}::${expected.name_ar}`;
      expect(dbMap.has(key)).toBe(true);
      expect(dbMap.get(key)).toBe(expected.price);
    }

    // Explicitly verify both distinct "إسكالوب ماريني" items across Grillades (400 DA) & Brochettes (50 DA)
    expect(dbMap.get('المشاوي واللحوم::إسكالوب ماريني')).toBe(400);
    expect(dbMap.get('البروشتات::إسكالوب ماريني')).toBe(50);
  });

  // TEST 05
  it('TEST 05 — Verify all 20 pizza variants (L and XL sizes with exact DA prices)', async () => {
    const variantRows = sqlite
      .prepare(
        `SELECT p.name_ar as pizza_name, pv.name_ar as size, pv.price, pv.price_adjustment
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         JOIN categories c ON c.id = p.category_id
         WHERE c.name_ar = 'البيتزا'`
      )
      .all() as { pizza_name: string; size: string; price: number; price_adjustment: any }[];

    expect(variantRows.length).toBe(20);

    const expectedPizzas = officialJsonObj.products.filter((p: any) => p.category_ar === 'البيتزا');
    expect(expectedPizzas.length).toBe(10);

    for (const pizza of expectedPizzas) {
      for (const expectedVar of pizza.variants) {
        const match = variantRows.find(
          (v) => v.pizza_name === pizza.name_ar && v.size === expectedVar.name_ar
        );
        expect(match).toBeDefined();
        expect(Number(match!.price)).toBe(expectedVar.price);
      }
    }
  });

  // TEST 06
  it('TEST 06 — Verify drinks subcategories (9 industrial drinks + 8 natural juices = 17 drinks)', async () => {
    const drinks = sqlite
      .prepare(
        `SELECT p.name_ar, p.subcategory_ar, p.subcategory_fr, p.price
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE c.name_ar = 'المشروبات'`
      )
      .all() as { name_ar: string; subcategory_ar: string; subcategory_fr: string; price: any }[];

    expect(drinks.length).toBe(17);
    const industrial = drinks.filter((d) => d.subcategory_ar === 'المشروبات الجاهزة');
    const natural = drinks.filter((d) => d.subcategory_ar === 'العصائر الطبيعية');

    expect(industrial.length).toBe(9);
    expect(natural.length).toBe(8);
    expect(industrial.every((d) => d.subcategory_fr === 'Boissons industrielles')).toBe(true);
    expect(natural.every((d) => d.subcategory_fr === 'Jus naturels')).toBe(true);
  });

  // TEST 07
  it('TEST 07 — Duplicate detection prevents duplicate products (DB & intra-file)', async () => {
    // Re-importing the exact official JSON detects all 105 as ALREADY_EXISTS_IN_DB
    const reimportPreview = await previewMenuImport({
      filename: 'golden_palace_official_menu.json',
      format: 'JSON',
      content: officialJsonRaw,
    });
    expect(reimportPreview.duplicateCount).toBe(105);
    expect(reimportPreview.validCount).toBe(0);
    expect(reimportPreview.canImport).toBe(false);

    // Intra-file duplicate detection
    const dupCsv = [
      'category_ar,name_ar,price',
      'المقبلات,طبق تجريبي فريد,220',
      'المقبلات,طبق تجريبي فريد,220',
    ].join('\n');
    const intraPreview = await previewMenuImport({
      filename: 'intra_dup.csv',
      format: 'CSV',
      content: dupCsv,
    });
    expect(intraPreview.validCount).toBe(1);
    expect(intraPreview.duplicateCount).toBe(1);
    expect(intraPreview.duplicates[0].reason).toBe('DUPLICATE_IN_FILE');
  });

  // TEST 12 & TEST 13
  it('TEST 12 & TEST 13 — Empty default addons, admin addon creation, variant + addon + quantity server pricing', async () => {
    // Product add-ons start empty by default
    const initialAddonsRes = await request(app)
      .get('/api/addons')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(initialAddonsRes.status).toBe(200);
    expect(initialAddonsRes.body.length).toBe(0);

    // Admin creates custom add-on (no hardcoded defaults)
    const createAddonRes = await request(app)
      .post('/api/addons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nameAr: 'جبن إضافي', nameFr: 'Supplément fromage', price: 100 });
    expect(createAddonRes.status).toBe(201);
    const addon = createAddonRes.body;

    // Fetch products and find Pizza Royale (L=1000, XL=2000) and Hmiss (200)
    const prodsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(prodsRes.status).toBe(200);
    expect(prodsRes.body.length).toBe(105);

    const pizzaRoyale = prodsRes.body.find((p: any) => p.nameAr === 'رويال');
    const hmiss = prodsRes.body.find((p: any) => p.nameAr === 'حميس');
    expect(pizzaRoyale).toBeDefined();
    expect(hmiss).toBeDefined();
    // Global addon is surfaced on products automatically
    expect(pizzaRoyale.addons.some((a: any) => a.id === addon.id)).toBe(true);

    const xlVariant = pizzaRoyale.variants.find((v: any) => v.nameAr === 'XL');
    expect(xlVariant.price).toBe(2000);

    // Create order: 2x Pizza Royale XL (2000) + Addon (100) = 2100 * 2 = 4200, plus 3x Hmiss (200 * 3 = 600) => 4800 DA
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [
          {
            productId: pizzaRoyale.id,
            quantity: 2,
            selectedVariant: { id: xlVariant.id },
            selectedAddons: [{ id: addon.id }],
          },
          {
            productId: hmiss.id,
            quantity: 3,
          },
        ],
      });

    expect(orderRes.status).toBe(201);
    expect(Number(orderRes.body.subtotal)).toBe(4800);
    expect(Number(orderRes.body.total)).toBe(4800);
    expect(orderRes.body.items.length).toBe(2);
    expect(Number(orderRes.body.items[0].unitPrice)).toBe(2100);
    expect(orderRes.body.items[0].variantsJson).toContain('XL');
    expect(orderRes.body.items[0].addonsJson).toContain('جبن إضافي');
  });

  // TEST 14 & TEST 15
  it('TEST 14 & TEST 15 — Authorized discount succeeds with full audit metadata; unauthorized discount rejected (403)', async () => {
    const prods = sqlite.prepare("SELECT id, price FROM products WHERE name_ar = 'بايلا'").all() as any[];
    const paella = prods[0];
    expect(Number(paella.price)).toBe(2000);

    // TEST 15: Unauthorized WAITER & KITCHEN rejected with 403
    const waiterRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: paella.id, quantity: 1 }],
        discount: 200,
        discountType: 'FIXED',
        discountReason: 'محاولة غير مصرح بها',
      });
    expect(waiterRes.status).toBe(403);

    const kitchenRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: paella.id, quantity: 1 }],
        discount: 200,
      });
    expect(kitchenRes.status).toBe(403);

    // Also verify CASHIER is blocked when restrict_cashier_discount = 'true'
    sqlite
      .prepare("INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES ('restrict_cashier_discount', 'true')")
      .run();
    const restrictedCashierRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: paella.id, quantity: 1 }],
        discount: 200,
      });
    expect(restrictedCashierRes.status).toBe(403);

    // TEST 14: Authorized MANAGER applies 10% percentage discount (200 DA on 2000 DA = 1800 DA)
    const managerRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: paella.id, quantity: 1 }],
        discountType: 'PERCENT',
        discountValue: 10,
        discountReason: 'زبون وفي',
      });
    expect(managerRes.status).toBe(201);
    expect(Number(managerRes.body.subtotal)).toBe(2000);
    expect(Number(managerRes.body.discount)).toBe(200);
    expect(Number(managerRes.body.total)).toBe(1800);
    expect(managerRes.body.discountType).toBe('PERCENT');
    expect(Number(managerRes.body.discountValue)).toBe(10);
    expect(managerRes.body.discountReason).toBe('زبون وفي');
    expect(managerRes.body.discountAuthorizedBy).toBeTruthy();
    expect(managerRes.body.discountAuthorizedAt).toBeTruthy();
  });

  // TEST 16, TEST 17, TEST 18
  it('TEST 16, TEST 17 & TEST 18 — Dine-in (30 tables), Takeaway, and Delivery orders with configurable fee', async () => {
    await ensureThirtyTables();
    const tablesRes = await request(app)
      .get('/api/tables')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(tablesRes.status).toBe(200);
    expect(tablesRes.body.length).toBe(30);

    const table5 = tablesRes.body.find((t: any) => t.tableNumber === '5');
    const couscous = sqlite.prepare("SELECT id, price FROM products WHERE name_ar = 'كسكس بالسمك'").get() as any;
    expect(Number(couscous.price)).toBe(1200);

    // TEST 16: Dine-in order occupies table 5 and rejects conflicting order on same table
    const dineInRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table5.id,
        items: [{ productId: couscous.id, quantity: 1 }],
      });
    expect(dineInRes.status).toBe(201);
    expect(dineInRes.body.type).toBe('DINE_IN');

    const conflictRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table5.id,
        items: [{ productId: couscous.id, quantity: 1 }],
      });
    expect(conflictRes.status).toBe(409);

    // TEST 17: Takeaway order
    const takeawayRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: couscous.id, quantity: 2 }],
      });
    expect(takeawayRes.status).toBe(201);
    expect(takeawayRes.body.type).toBe('TAKEAWAY');
    expect(Number(takeawayRes.body.total)).toBe(2400);

    // TEST 18: Delivery order with configurable fee (250 DA) and delivery record
    const custRes = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ name: 'أحمد بن علي', phone: '0550112233', address: 'حسين داي، الجزائر' });
    expect(custRes.status).toBe(201);

    const deliveryRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'DELIVERY',
        customerId: custRes.body.id,
        deliveryAddress: 'حسين داي، شارع طرابلس',
        deliveryFee: 250,
        items: [{ productId: couscous.id, quantity: 1 }],
      });
    expect(deliveryRes.status).toBe(201);
    expect(deliveryRes.body.type).toBe('DELIVERY');
    expect(Number(deliveryRes.body.deliveryFee)).toBe(250);
    expect(Number(deliveryRes.body.total)).toBe(1450);

    // Delivery order with NO delivery fee supplied defaults to 0 (never invented)
    const zeroFeeDelivery = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'DELIVERY',
        deliveryAddress: 'استلام قريب',
        items: [{ productId: couscous.id, quantity: 1 }],
      });
    expect(zeroFeeDelivery.status).toBe(201);
    expect(Number(zeroFeeDelivery.body.deliveryFee)).toBe(0);
    expect(Number(zeroFeeDelivery.body.total)).toBe(1200);
  });

  // TEST 19 & TEST 20
  it('TEST 19 & TEST 20 — Cash payment calculation, exact change due, and complete invoice data retrieval', async () => {
    // Open cash shift
    const shiftRes = await request(app)
      .post('/api/cash-register/open')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ openingCash: 5000 });
    expect([200, 201]).toContain(shiftRes.status);

    const entrecote = sqlite.prepare("SELECT id, price FROM products WHERE name_ar = 'أنتركوت'").get() as any;
    expect(Number(entrecote.price)).toBe(900);

    const ordRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ productId: entrecote.id, quantity: 2 }], // 1800 DA
      });
    expect(ordRes.status).toBe(201);
    const orderId = ordRes.body.id;

    // Pay 1800 DA with 2000 DA cash tender => 200 DA change due
    const payRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderId,
        payments: [
          {
            method: 'CASH',
            amount: 1800,
            tenderAmount: 2000,
            changeAmount: 200,
          },
        ],
      });
    expect([200, 201]).toContain(payRes.status);
    expect(payRes.body.paymentStatus).toBe('PAID');
    expect(Number(payRes.body.paidAmount)).toBe(1800);

    // TEST 20: Retrieve full invoice payload
    const invoiceRes = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(invoiceRes.status).toBe(200);
    expect(invoiceRes.body.orderNumber).toMatch(/^BON-/);
    expect(invoiceRes.body.paymentStatus).toBe('PAID');
    expect(Number(invoiceRes.body.total)).toBe(1800);
    expect(Number(invoiceRes.body.paidAmount)).toBe(1800);
    expect(invoiceRes.body.items[0].nameAr).toBe('أنتركوت');
    expect(invoiceRes.body.items[0].nameFr).toBe('Entrecôte');
    expect(invoiceRes.body.payments.length).toBe(1);
    expect(Number(invoiceRes.body.payments[0].tenderAmount)).toBe(2000);
    expect(Number(invoiceRes.body.payments[0].changeAmount)).toBe(200);
    expect(invoiceRes.body.cashierName).toBe('أمين الصندوق');
  });

  // TEST 21, TEST 22, TEST 23
  it('TEST 21, TEST 22 & TEST 23 — Audit logs, SQLite integrity, historical price immutability, and production DB isolation', async () => {
    const entrecote = sqlite.prepare("SELECT id, price FROM products WHERE name_ar = 'أنتركوت'").get() as any;

    // Record historical order_item unit_price BEFORE catalog price change
    const beforeSnapshot = sqlite
      .prepare('SELECT unit_price, total FROM order_items WHERE product_id = ?')
      .all(entrecote.id) as { unit_price: any; total: any }[];
    expect(beforeSnapshot.length).toBeGreaterThanOrEqual(1);
    expect(Number(beforeSnapshot[0].unit_price)).toBe(900);

    // Admin updates Entrecote catalog price from 900 DA to 1100 DA
    const updateRes = await request(app)
      .put(`/api/products/${entrecote.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price: 1100, reasonForPriceChange: 'تحديث أسعار اللحوم' });
    expect(updateRes.status).toBe(200);

    // TEST 23: Historical order_items remain strictly immutable at 900 DA
    const afterSnapshot = sqlite
      .prepare('SELECT unit_price, total FROM order_items WHERE product_id = ?')
      .all(entrecote.id) as { unit_price: any; total: any }[];
    expect(Number(afterSnapshot[0].unit_price)).toBe(900);
    expect(Number(afterSnapshot[0].total)).toBe(1800);

    // Verify price_history recorded old -> new
    const phRows = sqlite
      .prepare('SELECT old_price, new_price FROM price_history WHERE product_id = ?')
      .all(entrecote.id) as any[];
    expect(phRows.length).toBe(1);
    expect(Number(phRows[0].old_price)).toBe(900);
    expect(Number(phRows[0].new_price)).toBe(1100);

    // TEST 21: Audit logs contain MENU_IMPORT, CREATE_ADDON, APPLY_DISCOUNT, CHANGE_PRICE with previous/new values
    const actions = (
      sqlite.prepare('SELECT action, previous_value, new_value FROM audit_logs').all() as any[]
    );
    const actionNames = new Set(actions.map((a) => a.action));
    expect(actionNames.has('MENU_IMPORT')).toBe(true);
    expect(actionNames.has('CREATE_ADDON')).toBe(true);
    expect(actionNames.has('APPLY_DISCOUNT')).toBe(true);
    expect(actionNames.has('CHANGE_PRICE')).toBe(true);

    const priceChangeLog = actions.find((a) => a.action === 'CHANGE_PRICE');
    expect(priceChangeLog.previous_value).toBe('900');
    expect(priceChangeLog.new_value).toBe('1100');

    // TEST 22: SQLite integrity_check, foreign_key_check, and WAL mode
    const integrity = sqlite.pragma('integrity_check') as { integrity_check: string }[];
    expect(integrity.length).toBe(1);
    expect(integrity[0].integrity_check).toBe('ok');

    const fkViolations = sqlite.pragma('foreign_key_check') as any[];
    expect(fkViolations).toEqual([]);

    const journalMode = sqlite.pragma('journal_mode', { simple: true });
    expect(String(journalMode).toLowerCase()).toBe('wal');

    // Verify isolated test DB path is NOT inside production workspace data dir
    expect(TEST_DB_PATH.startsWith(os.tmpdir())).toBe(true);
    expect(TEST_DB_PATH).not.toContain('golden_palace_pos_production.db');
  });
});
