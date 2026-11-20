export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN' | 'INVENTORY';

export interface User {
  id: number;
  uid: string;
  username: string;
  email: string;
  fullName: string;
  role: Role;
  phone?: string | null;
  pin?: string;
  hasPin?: boolean;
  isActive?: boolean;
}

export interface Category {
  id: number;
  nameAr: string;
  nameFr?: string | null;
  nameEn?: string | null;
  icon?: string | null;
  color?: string | null;
  sortOrder: number;
  isActive: boolean;
  station: string;
}

export interface ProductVariant {
  id: number;
  productId: number;
  nameAr: string;
  nameFr?: string | null;
  price?: number | null;
  priceAdjustment: string | number;
  sku?: string | null;
  isActive?: boolean;
}

export interface ProductAddon {
  id: number;
  productId?: number | null;
  nameAr: string;
  nameFr?: string | null;
  price: string | number;
  isActive?: boolean;
  createdAt?: string | null;
}

export interface ProductRecipeItem {
  id?: number;
  productId: number;
  ingredientId: number;
  quantity: string | number;
  ingredientName?: string;
  ingredientNameFr?: string | null;
  ingredientUnit?: string | null;
  ingredientCostPerUnit?: string | number | null;
}

export interface Product {
  id: number;
  categoryId: number;
  nameAr: string;
  nameFr?: string | null;
  nameEn?: string | null;
  sku?: string | null;
  subcategoryAr?: string | null;
  subcategoryFr?: string | null;
  description?: string | null;
  price: string | number;
  costPrice?: string | number;
  image?: string | null;
  barcode?: string | null;
  isAvailable: boolean;
  isActive?: boolean;
  station: string;
  variants?: ProductVariant[];
  addons?: ProductAddon[];
  recipes?: ProductRecipeItem[];
}

export interface RestaurantTable {
  id: number;
  tableNumber: string;
  zone: string;
  capacity: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'READY' | 'WAITING_PAYMENT' | 'RESERVED' | 'CLEANING' | 'INACTIVE';
  currentOrderId?: number | null;
  activeOrder?: {
    id: number;
    orderNumber: string;
    total: number;
    paidAmount?: number;
    status: string;
    paymentStatus: string;
    createdAt?: string;
  } | null;
}

export interface CartItem {
  id: string; // unique cart line ID
  productId: number;
  nameAr: string;
  nameFr?: string | null;
  unitPrice: number;
  costPrice: number;
  quantity: number;
  total: number;
  notes?: string;
  station: string;
  selectedVariant?: ProductVariant;
  selectedAddons?: ProductAddon[];
  priceOverrideReason?: string;
}

export interface Order {
  id: number;
  orderNumber: string;
  dailySequence: number;
  type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  tableId?: number | null;
  tableNumber?: string;
  table?: { tableNumber: string } | null;
  customerId?: number | null;
  customerName?: string;
  customer?: { name: string; phone?: string } | null;
  customerPhone?: string;
  status: 'NEW' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
  subtotal: string | number;
  discount: string | number;
  discountType?: 'FIXED' | 'PERCENT' | null;
  discountValue?: string | number | null;
  discountReason?: string | null;
  discountAuthorizedBy?: number | null;
  discountAuthorizedAt?: string | null;
  deliveryFee: string | number;
  taxRate?: string | number;
  taxAmount?: string | number;
  deliveryAddress?: string | null;
  total: string | number;
  paidAmount: string | number;
  changeAmount: string | number;
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED';
  cashierId?: number | null;
  cashierName?: string;
  cashier?: { fullName: string } | null;
  waiterId?: number | null;
  notes?: string | null;
  isHeld: boolean;
  heldAt?: string | null;
  idempotencyKey?: string;
  offlineId?: string;
  createdAt: string;
  items?: OrderItem[];
}

export interface OrderItem {
  id: number;
  orderId: number;
  productId: number;
  nameAr: string;
  nameFr?: string | null;
  unitPrice: string | number;
  costPrice?: string | number;
  quantity: number;
  total: string | number;
  notes?: string | null;
  station: string;
  status: string;
  variantsJson?: string | null;
  addonsJson?: string | null;
}

export type PaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CCP' | 'BARIDIMOB' | 'OTHER';

export interface PaymentRecord {
  id?: number;
  orderId: number;
  method: PaymentMethod | 'REFUND';
  amount: number;
  tenderAmount?: number;
  changeAmount?: number;
  transactionRef?: string;
}

export interface CashierDashboardMetrics {
  activeOrdersCount: number;
  preparingOrdersCount: number;
  readyOrdersCount: number;
  heldOrdersCount: number;
  shiftTotalSales: number;
  shiftStatus: 'OPEN' | 'CLOSED';
  shiftNumber: string | number | null;
  expectedCash: number;
  tablesSummary: {
    total: number;
    available: number;
    occupied: number;
    waitingPayment: number;
  };
}

export interface CashShift {
  id: number;
  shiftNumber: number;
  cashierId: number;
  cashierName?: string;
  openingCash: string | number;
  closingCash?: string | number | null;
  expectedCash?: string | number | null;
  cashDifference?: string | number | null;
  totalCashSales: string | number;
  totalCardSales: string | number;
  totalCcpSales: string | number;
  totalBaridimobSales: string | number;
  totalExpenses: string | number;
  totalCashIn: string | number;
  totalCashOut: string | number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string | null;
  notes?: string | null;
  movements?: CashMovement[];
}

export interface CashMovement {
  id: number;
  shiftId: number;
  type: 'CASH_IN' | 'CASH_OUT' | 'EXPENSE';
  amount: string | number;
  reason: string;
  performedBy?: number;
  createdAt: string;
}

export interface Ingredient {
  id: number;
  nameAr: string;
  nameFr?: string | null;
  unit: string;
  currentStock: string | number;
  minStock: string | number;
  maxStock?: string | number | null;
  costPerUnit: string | number;
  supplierId?: number | null;
  supplierName?: string;
}

export interface InventoryMovement {
  id: number;
  ingredientId: number;
  ingredientNameAr?: string | null;
  ingredientNameFr?: string | null;
  unit?: string | null;
  type: string;
  quantity: string | number;
  cost?: string | number | null;
  referenceType?: string | null;
  referenceId?: number | null;
  performedBy?: number | null;
  performedByName?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface Supplier {
  id: number;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  balance: string | number;
  notes?: string | null;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  address?: string | null;
  notes?: string | null;
  totalOrders: number;
  totalSpent: string | number;
}

export interface DeliveryOrder {
  id: number;
  orderId: number;
  orderNumber?: string;
  orderTotal?: string | number;
  customerId?: number | null;
  customerName?: string;
  customerPhone?: string;
  driverName?: string | null;
  driverPhone?: string | null;
  deliveryAddress: string;
  deliveryFee: string | number;
  status: 'NEW' | 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
  notes?: string | null;
  createdAt: string;
}

export interface Expense {
  id: number;
  category: string;
  amount: string | number;
  description: string;
  date: string;
  userId?: number;
  userName?: string;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  userId?: number;
  userName?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: string;
  ipAddress?: string;
  createdAt: string;
}

export interface PaginatedAuditLogsResponse {
  items: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  availableActions: string[];
}

export interface RestaurantSettings {
  restaurant_name: string;
  restaurant_brand: string;
  restaurant_address: string;
  restaurant_phone: string;
  currency: string;
  receipt_size: '80mm' | '58mm' | 'A4';
  tax_rate: string;
  default_language: string;
  theme: string;
  receipt_header?: string;
  receipt_footer?: string;
  receipt_show_tax?: string;
  low_stock_alert_enabled?: string;
  low_stock_alert_threshold?: string;
  auto_deduct_stock?: string;
  printer_name?: string;
  printer_driver?: string;
  printer_connection_type?: string;
  printer_network_ip?: string;
  printer_network_port?: string;
  printer_arabic_encoding?: string;
  paper_type?: string;
  printable_width?: string;
  printer_copies?: string;
  print_method?: string;
  printer_feed_after?: string;
  printer_cut_paper?: string;
  printer_cash_drawer?: string;
  backup_auto_enabled?: string;
  backup_interval_hours?: string;
  backup_retention_count?: string;
}

export type BackupKind = 'MANUAL' | 'DAILY' | 'WEEKLY' | 'SHUTDOWN' | 'PRE_RESTORE' | 'SCHEDULED';
export type BackupHealthStatus = 'VERIFIED' | 'FAILED' | 'CORRUPTED' | 'UNVERIFIED';

export interface BackupRecordCounts {
  orders: number;
  order_items: number;
  payments: number;
  ingredients: number;
  users: number;
  products: number;
  cash_shifts: number;
}

export interface BackupVerificationResult {
  filename: string;
  filePath: string;
  valid: boolean;
  status: BackupHealthStatus;
  sizeBytes: number;
  integrityCheck: string;
  canOpen: boolean;
  missingTables: string[];
  recordCounts: BackupRecordCounts;
  verifiedAt: string;
  error?: string;
}

export interface BackupManifestEntry {
  filename: string;
  type: BackupKind;
  createdAt: string;
  sizeBytes: number;
  status: BackupHealthStatus;
  integrityCheck: string;
  recordCounts?: BackupRecordCounts;
  verifiedAt?: string;
  durationMs?: number;
  error?: string;
}

export interface BackupsOverviewResponse {
  backups: BackupManifestEntry[];
  lastVerifiedBackup: BackupManifestEntry | null;
  lastAttempt: BackupManifestEntry | null;
  config: {
    autoEnabled: boolean;
    intervalHours: number;
    retentionCount: number;
  };
  backupDirectory: string;
}

export interface BackupRestoreResponse {
  success: boolean;
  restoredFrom: string;
  preRestoreBackup: string;
  postRestoreVerification: BackupVerificationResult;
  restoredAt: string;
}

// -------------------------------------------------------------
// Thermal Printer Profiles, Connections & Print Job Queue
// -------------------------------------------------------------
export type PaperType = '80mm' | '58mm' | 'A4';
export type PrintMethod = 'BROWSER' | 'ESCPOS_RAW' | 'LOCAL_BRIDGE';
export type PrinterConnectionType = 'WINDOWS_SPOOLER' | 'NETWORK_IP' | 'USB' | 'BROWSER';
export type ArabicEscPosEncoding = 'CP864' | 'WINDOWS_1256' | 'UTF8';

export interface PrinterProfile {
  name: string; // e.g. "CAFETERIA 80mm"
  printerName: string; // Windows printer name: "CAFETERIA"
  driver: string; // Driver name: "80Normal"
  connectionType?: PrinterConnectionType;
  networkIp?: string;
  networkPort?: number;
  arabicEncoding?: ArabicEscPosEncoding;
  paperType: PaperType; // 80mm or 58mm
  paperWidth: number; // 80 or 58 (mm)
  printableWidth: number; // 70 / 72 (mm) for 80mm, 48 (mm) for 58mm
  margins: number; // 0 (mm)
  scale: number; // 100 (%)
  orientation: 'PORTRAIT' | 'LANDSCAPE';
  feedBefore: number; // 0 lines
  feedAfter: number; // 3-5 lines
  copies: number; // 1
  cutPaper: boolean; // true
  cashDrawer: boolean; // true
  printMethod: PrintMethod;
  bridgeUrl?: string; // e.g. "ws://localhost:8182"
}

export interface SystemPrinterInfo {
  name: string;
  driverName?: string;
  portName?: string;
  status?: string;
  isDefault?: boolean;
  connectionType: PrinterConnectionType;
}

export interface PrintJobRecord {
  id: number;
  orderId?: number | null;
  orderNumber: string;
  jobType: string;
  printerName: string;
  connectionType: string;
  targetIp?: string | null;
  targetPort?: number | null;
  copies: number;
  paperWidth: string;
  status: 'PENDING' | 'PROCESSING' | 'PRINTED' | 'FAILED';
  errorMessage?: string | null;
  isReprint: boolean;
  jobKey?: string | null;
  attempts: number;
  requestedBy?: number | null;
  spoolerAccepted: boolean;
  confirmedAt?: string | null;
  updatedAt?: string | null;
  payloadPreview?: string | null;
  createdAt: string;
}

export interface PrintJobResult {
  success: boolean;
  jobId?: string | number;
  method: PrintMethod | PrinterConnectionType | 'DEDUP';
  status: 'PRINTED' | 'FAILED' | 'PENDING' | 'PROCESSING';
  spoolerAccepted?: boolean;
  hardwareConfirmed?: boolean;
  error?: string;
  timestamp: string;
}

export interface DesktopRuntimeStatus {
  appName: string;
  appVersion: string;
  platform: string;
  isDesktop: boolean;
  appDataDir: string;
  dbPath: string;
  dbExists: boolean;
  dbSizeBytes: number;
  dbWritable: boolean;
  backupDir: string;
  backupDirExists: boolean;
  backupDirWritable: boolean;
  integrityCheck: string;
  tablesCount: number;
  missingTables: string[];
  usersCount: number;
  needsInitialAdminSetup: boolean;
  pendingFinancialOps: {
    openShiftsCount: number;
    unpaidActiveOrdersCount: number;
    openSyncConflictsCount: number;
    pendingPrintJobsCount: number;
    canUpdateSafely: boolean;
    blockingReasons: string[];
  };
}
