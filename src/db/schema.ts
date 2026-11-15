import { sqliteTable, text, integer, numeric, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// 1. Users & Staff Authentication / RBAC
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull().unique(), // Staff UUID
  username: text('username').notNull().unique(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  pin: text('pin'), // 4-6 digit quick touch PIN
  fullName: text('full_name').notNull(),
  role: text('role').notNull().default('CASHIER'), // ADMIN, MANAGER, CASHIER, WAITER, KITCHEN, INVENTORY
  phone: text('phone'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 2. Categories
export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nameAr: text('name_ar').notNull(),
  nameFr: text('name_fr'),
  nameEn: text('name_en'),
  icon: text('icon'),
  color: text('color').default('blue'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  station: text('station').notNull().default('MAIN_KITCHEN'), // MAIN_KITCHEN, GRILL, DRINKS, DESSERT
});

// 3. Products
export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  categoryId: integer('category_id').references(() => categories.id).notNull(),
  nameAr: text('name_ar').notNull(),
  nameFr: text('name_fr'),
  nameEn: text('name_en'),
  description: text('description'),
  price: numeric('price').notNull(),
  costPrice: numeric('cost_price').notNull().default('0'),
  image: text('image'),
  barcode: text('barcode'),
  isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true),
  station: text('station').notNull().default('MAIN_KITCHEN'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// 4. Product Variants (e.g., Small, Medium, Large)
export const productVariants = sqliteTable('product_variants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').references(() => products.id).notNull(),
  nameAr: text('name_ar').notNull(),
  nameFr: text('name_fr'),
  priceAdjustment: numeric('price_adjustment').notNull().default('0'),
});

// 5. Product Add-ons (e.g., Extra Cheese, Sauce, Fries)
export const productAddons = sqliteTable('product_addons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').references(() => products.id),
  nameAr: text('name_ar').notNull(),
  nameFr: text('name_fr'),
  price: numeric('price').notNull().default('0'),
});

// 6. Price History Audit
export const priceHistory = sqliteTable('price_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').references(() => products.id).notNull(),
  oldPrice: numeric('old_price').notNull(),
  newPrice: numeric('new_price').notNull(),
  changedByUserId: integer('changed_by_user_id').references(() => users.id),
  reason: text('reason'),
  changedAt: text('changed_at').default(sql`(datetime('now'))`),
});

// 7. Restaurant Tables (30 Tables numbered 1 to 30)
export const restaurantTables = sqliteTable('restaurant_tables', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tableNumber: text('table_number').notNull().unique(), // "1", "2", ... "30"
  zone: text('zone').notNull().default('الصالة الرئيسية'), // الصالة الرئيسية, الشرفة الخارجية, صالون VIP والعائلات
  capacity: integer('capacity').notNull().default(4),
  status: text('status').notNull().default('AVAILABLE'), // AVAILABLE, OCCUPIED, WAITING_PAYMENT, RESERVED, CLEANING, INACTIVE
  currentOrderId: integer('current_order_id'),
  posX: integer('pos_x').default(0),
  posY: integer('pos_y').default(0),
});

// 8. Customers CRM
export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  phone: text('phone').notNull().unique(),
  address: text('address'),
  notes: text('notes'),
  totalOrders: integer('total_orders').notNull().default(0),
  totalSpent: numeric('total_spent').notNull().default('0'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 9. Orders
export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderNumber: text('order_number').notNull().unique(), // e.g. BON-0001
  dailySequence: integer('daily_sequence').notNull().default(1),
  type: text('type').notNull().default('DINE_IN'), // DINE_IN, TAKEAWAY, DELIVERY
  tableId: integer('table_id').references(() => restaurantTables.id),
  customerId: integer('customer_id').references(() => customers.id),
  status: text('status').notNull().default('NEW'), // NEW, CONFIRMED, PREPARING, READY, COMPLETED, CANCELLED
  subtotal: numeric('subtotal').notNull().default('0'),
  discount: numeric('discount').notNull().default('0'),
  deliveryFee: numeric('delivery_fee').notNull().default('0'),
  taxRate: numeric('tax_rate').notNull().default('0'),
  taxAmount: numeric('tax_amount').notNull().default('0'),
  total: numeric('total').notNull().default('0'),
  paidAmount: numeric('paid_amount').notNull().default('0'),
  changeAmount: numeric('change_amount').notNull().default('0'),
  paymentStatus: text('payment_status').notNull().default('UNPAID'), // UNPAID, PARTIALLY_PAID, PAID
  cashierId: integer('cashier_id').references(() => users.id),
  waiterId: integer('waiter_id').references(() => users.id),
  notes: text('notes'),
  isHeld: integer('is_held', { mode: 'boolean' }).notNull().default(false),
  heldAt: text('held_at'),
  idempotencyKey: text('idempotency_key').unique(),
  offlineId: text('offline_id'),
  shiftId: integer('shift_id'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// 10. Order Items (Preserving exact price at time of sale)
export const orderItems = sqliteTable('order_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').references(() => orders.id).notNull(),
  productId: integer('product_id').references(() => products.id).notNull(),
  nameAr: text('name_ar').notNull(),
  nameFr: text('name_fr'),
  unitPrice: numeric('unit_price').notNull(),
  costPrice: numeric('cost_price').notNull().default('0'),
  quantity: integer('quantity').notNull().default(1),
  total: numeric('total').notNull(),
  notes: text('notes'),
  station: text('station').notNull().default('MAIN_KITCHEN'),
  status: text('status').notNull().default('NEW'), // NEW, PREPARING, READY, SERVED
  variantsJson: text('variants_json'),
  addonsJson: text('addons_json'),
});

// 11. Payments
export const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').references(() => orders.id).notNull(),
  method: text('method').notNull().default('CASH'), // CASH, CARD, CCP, MIXED
  amount: numeric('amount').notNull(),
  tenderAmount: numeric('tender_amount'),
  changeAmount: numeric('change_amount').notNull().default('0'),
  transactionRef: text('transaction_ref'),
  cashierId: integer('cashier_id').references(() => users.id),
  shiftId: integer('shift_id'),
  idempotencyKey: text('idempotency_key').unique(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 12. Cash Register Shifts
export const cashShifts = sqliteTable('cash_shifts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shiftNumber: text('shift_number').notNull(),
  cashierId: integer('cashier_id').references(() => users.id).notNull(),
  openingCash: numeric('opening_cash').notNull(),
  closingCash: numeric('closing_cash'),
  expectedCash: numeric('expected_cash'),
  actualCash: numeric('actual_cash'),
  difference: numeric('difference'),
  totalCashSales: numeric('total_cash_sales').notNull().default('0'),
  totalCardSales: numeric('total_card_sales').notNull().default('0'),
  totalCcpSales: numeric('total_ccp_sales').notNull().default('0'),
  totalBaridimobSales: numeric('total_baridimob_sales').notNull().default('0'),
  totalExpenses: numeric('total_expenses').notNull().default('0'),
  totalCashIn: numeric('total_cash_in').notNull().default('0'),
  totalCashOut: numeric('total_cash_out').notNull().default('0'),
  status: text('status').notNull().default('OPEN'), // OPEN, CLOSED
  openedAt: text('opened_at').default(sql`(datetime('now'))`),
  closedAt: text('closed_at'),
  notes: text('notes'),
});

// 13. Cash Movements (Entrées / Sorties de caisse)
export const cashMovements = sqliteTable('cash_movements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shiftId: integer('shift_id').references(() => cashShifts.id).notNull(),
  cashierId: integer('cashier_id').references(() => users.id),
  performedBy: integer('performed_by').references(() => users.id),
  type: text('type').notNull(), // IN, OUT, CASH_IN, CASH_OUT, EXPENSE
  amount: numeric('amount').notNull(),
  reason: text('reason').notNull(),
  idempotencyKey: text('idempotency_key').unique(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 14. Suppliers
export const suppliers = sqliteTable('suppliers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  contactPerson: text('contact_person'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  notes: text('notes'),
  balance: numeric('balance').notNull().default('0'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 15. Inventory Ingredients
export const ingredients = sqliteTable('ingredients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nameAr: text('name_ar').notNull(),
  nameFr: text('name_fr'),
  unit: text('unit').notNull().default('KG'), // KG, L, UNIT, PORTION
  currentStock: numeric('current_stock').notNull().default('0'),
  minStock: numeric('min_stock').notNull().default('5'),
  maxStock: numeric('max_stock'),
  costPerUnit: numeric('cost_per_unit').notNull().default('0'),
  supplierId: integer('supplier_id').references(() => suppliers.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// 16. Product Recipes (BOM / Fiche Technique)
export const productRecipes = sqliteTable('product_recipes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').references(() => products.id).notNull(),
  ingredientId: integer('ingredient_id').references(() => ingredients.id).notNull(),
  quantity: numeric('quantity').notNull(), // Amount consumed per dish
});

// 17. Inventory Stock Movements
export const inventoryMovements = sqliteTable('inventory_movements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ingredientId: integer('ingredient_id').references(() => ingredients.id).notNull(),
  type: text('type').notNull(), // PURCHASE_IN, SALE_DEDUCTION, WASTE, ADJUSTMENT, PURCHASE
  quantity: numeric('quantity').notNull(),
  cost: numeric('cost'),
  referenceType: text('reference_type'), // ORDER, PURCHASE, WASTE, AUDIT
  referenceId: integer('reference_id'),
  performedBy: integer('performed_by').references(() => users.id),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 18. Waste Management (Pertes & Déchets)
export const wasteRecords = sqliteTable('waste_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ingredientId: integer('ingredient_id').references(() => ingredients.id),
  productId: integer('product_id').references(() => products.id),
  name: text('name').notNull(),
  quantity: numeric('quantity').notNull(),
  unit: text('unit').notNull().default('KG'),
  cost: numeric('cost').notNull().default('0'),
  reason: text('reason').notNull().default('EXPIRED'), // EXPIRED, DAMAGED, BURNED, SPILLED, OTHER
  notes: text('notes'),
  employeeId: integer('employee_id').references(() => users.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 19. Purchases (Achats & Factures Fournisseurs)
export const purchases = sqliteTable('purchases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  purchaseNumber: text('purchase_number').notNull().unique(),
  supplierId: integer('supplier_id').references(() => suppliers.id).notNull(),
  totalAmount: numeric('total_amount').notNull().default('0'),
  paidAmount: numeric('paid_amount').notNull().default('0'),
  paymentStatus: text('payment_status').notNull().default('PAID'),
  invoiceDate: text('invoice_date').notNull(),
  receivedBy: integer('received_by').references(() => users.id),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 20. Purchase Items
export const purchaseItems = sqliteTable('purchase_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  purchaseId: integer('purchase_id').references(() => purchases.id).notNull(),
  ingredientId: integer('ingredient_id').references(() => ingredients.id).notNull(),
  quantity: numeric('quantity').notNull(),
  unitCost: numeric('unit_cost').notNull(),
  totalCost: numeric('total_cost').notNull(),
});

// 21. Deliveries (Livraisons)
export const deliveries = sqliteTable('deliveries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').references(() => orders.id).notNull(),
  customerId: integer('customer_id').references(() => customers.id),
  driverName: text('driver_name'),
  driverPhone: text('driver_phone'),
  customerAddress: text('customer_address'),
  deliveryAddress: text('delivery_address'),
  deliveryFee: numeric('delivery_fee').notNull().default('0'),
  status: text('status').notNull().default('PENDING'), // PENDING, ON_THE_WAY, DELIVERED, CANCELLED
  notes: text('notes'),
  assignedAt: text('assigned_at'),
  deliveredAt: text('delivered_at'),
});

// 22. Expenses (Dépenses diverses)
export const expenses = sqliteTable('expenses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shiftId: integer('shift_id').references(() => cashShifts.id),
  category: text('category').notNull(),
  amount: numeric('amount').notNull(),
  description: text('description').notNull(),
  date: text('date'),
  userId: integer('user_id').references(() => users.id),
  recordedBy: integer('recorded_by').references(() => users.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 23. Audit Trail Logs
export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  userName: text('user_name'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  details: text('details'),
  ipAddress: text('ip_address'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 24. Restaurant Settings
export const restaurantSettings = sqliteTable('restaurant_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// 25. Print Jobs Audit (Thermal Receipt Spool Log & Queue)
export const printJobs = sqliteTable('print_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').references(() => orders.id),
  orderNumber: text('order_number').notNull(),
  jobType: text('job_type').notNull().default('RECEIPT'), // RECEIPT, KITCHEN, ADDITION, TEST
  printerName: text('printer_name').notNull().default('CAFETERIA'),
  connectionType: text('connection_type').notNull().default('WINDOWS_SPOOLER'), // WINDOWS_SPOOLER, NETWORK_IP, USB, BROWSER
  targetIp: text('target_ip'),
  targetPort: integer('target_port').default(9100),
  copies: integer('copies').notNull().default(1),
  paperWidth: text('paper_width').notNull().default('80mm'), // 80mm, 58mm
  status: text('status').notNull().default('PENDING'), // PENDING, PROCESSING, PRINTED, FAILED
  errorMessage: text('error_message'),
  isReprint: integer('is_reprint', { mode: 'boolean' }).notNull().default(false),
  jobKey: text('job_key'),
  attempts: integer('attempts').notNull().default(1),
  requestedBy: integer('requested_by').references(() => users.id),
  spoolerAccepted: integer('spooler_accepted', { mode: 'boolean' }).notNull().default(false),
  confirmedAt: text('confirmed_at'),
  updatedAt: text('updated_at'),
  payloadPreview: text('payload_preview'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 26. Persistent Revoked Auth Tokens
export const revokedTokens = sqliteTable('revoked_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  jti: text('jti'),
  userId: integer('user_id').references(() => users.id),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: text('revoked_at').default(sql`(datetime('now'))`),
});

// 27. Offline Sync Operations Idempotency Ledger
export const syncOperations = sqliteTable('sync_operations', {
  operationId: text('operation_id').primaryKey(),
  entityType: text('entity_type').notNull(), // ORDER, PAYMENT, CASH_MOVEMENT
  idempotencyKey: text('idempotency_key'),
  deviceId: text('device_id'),
  sequenceOrder: integer('sequence_order').default(0),
  status: text('status').notNull().default('SYNCED'), // SYNCED, CONFLICT, FAILED
  serverEntityId: integer('server_entity_id'),
  orderNumber: text('order_number'),
  details: text('details'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// 28. Sync Conflict Records (Audit & Resolution Queue)
export const syncConflicts = sqliteTable('sync_conflicts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  operationId: text('operation_id').notNull(),
  entityType: text('entity_type').notNull(), // ORDER, PAYMENT, CASH_MOVEMENT
  conflictType: text('conflict_type').notNull(), // PRODUCT_UNAVAILABLE, PRICE_CHANGED, TABLE_OCCUPIED, TAX_RATE_CHANGED, STOCK_INSUFFICIENT, VALIDATION_ERROR
  severity: text('severity').notNull().default('WARNING'),
  payloadJson: text('payload_json').notNull(),
  serverSnapshotJson: text('server_snapshot_json'),
  message: text('message').notNull(),
  status: text('status').notNull().default('OPEN'), // OPEN, RESOLVED, DISCARDED
  resolutionAction: text('resolution_action'),
  resolvedBy: integer('resolved_by').references(() => users.id),
  resolvedAt: text('resolved_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});


