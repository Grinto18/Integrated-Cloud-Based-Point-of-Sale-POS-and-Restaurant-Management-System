// IndexedDB storage manager (with resilient localStorage fallback) for Golden Palace POS offline-first sync hardening

const DB_NAME = 'GoldenPalacePosDB';
const DB_VERSION = 3;
const LS_CACHE_PREFIX = 'gp_offline_cache:';
const LS_ORDERS_KEY = 'gp_offline_orders_queue';
const LS_PAYMENTS_KEY = 'gp_offline_payments_queue';
const LS_CASH_MOVEMENTS_KEY = 'gp_offline_cash_movements_queue';
const LS_CONFLICTS_KEY = 'gp_offline_sync_conflicts';
const LS_HISTORY_KEY = 'gp_offline_sync_history';
const LS_DEVICE_ID_KEY = 'gp_pos_device_id';
const LS_SEQ_KEY = 'gp_pos_sync_seq';

export type OfflineSyncStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'RETRY_WAIT'
  | 'SYNCING'
  | 'SYNCED'
  | 'FAILED';

export type CanonicalQueueState = 'PENDING' | 'PROCESSING' | 'RETRY_WAIT' | 'SYNCED' | 'FAILED';

export type SyncConflictType =
  | 'PRODUCT_UNAVAILABLE'
  | 'PRICE_CHANGED'
  | 'TABLE_OCCUPIED'
  | 'TAX_RATE_CHANGED'
  | 'STOCK_INSUFFICIENT'
  | 'VALIDATION_ERROR';

export interface SyncConflictResolution {
  action:
    | 'ACCEPT_SERVER_CATALOG'
    | 'OVERRIDE_PRICE'
    | 'CONVERT_TO_TAKEAWAY'
    | 'REASSIGN_TABLE'
    | 'ACCEPT_SERVER_TAX'
    | 'FORCE_STOCK'
    | 'FORCE_ATTACH_ORDER';
  newTableId?: number;
  resolvedAt?: string;
}

export interface OfflinePaymentLeg {
  method: string;
  amount: number;
  tenderAmount: number;
  changeAmount: number;
  transactionRef?: string | null;
  idempotencyKey?: string;
}

export interface OfflineOrderPayload {
  offlineId: string;
  operationId?: string;
  deviceId?: string;
  sequenceOrder?: number;
  type: string;
  tableId?: number | null;
  tableNumber?: string | null;
  customerId?: number | null;
  customerName?: string | null;
  deliveryAddress?: string | null;
  items: any[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  taxRate?: number;
  taxAmount?: number;
  total: number;
  paidAmount: number;
  paymentStatus: string;
  paymentMethod?: string;
  payments?: OfflinePaymentLeg[];
  notes?: string | null;
  isHeld?: boolean;
  sendToKitchen?: boolean;
  idempotencyKey: string;
  createdAt: string;
  syncStatus?: OfflineSyncStatus;
  queueState?: CanonicalQueueState;
  retryCount?: number;
  maxRetries?: number;
  nextRetryAt?: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
  strictConflictCheck?: boolean;
  enforceStockCheck?: boolean;
  conflictType?: SyncConflictType | null;
  serverSnapshot?: any;
  conflictResolution?: SyncConflictResolution | null;
}

export interface OfflinePaymentPayload {
  offlinePaymentId: string;
  operationId?: string;
  deviceId?: string;
  sequenceOrder?: number;
  orderId: number;
  orderNumber?: string | null;
  payments: OfflinePaymentLeg[];
  idempotencyKey: string;
  createdAt: string;
  syncStatus?: OfflineSyncStatus;
  queueState?: CanonicalQueueState;
  retryCount?: number;
  maxRetries?: number;
  nextRetryAt?: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
}

export interface OfflineCashMovementPayload {
  offlineMovementId: string;
  operationId?: string;
  deviceId?: string;
  sequenceOrder?: number;
  shiftId: number;
  type: 'CASH_IN' | 'CASH_OUT';
  amount: number;
  reason: string;
  idempotencyKey: string;
  createdAt: string;
  syncStatus?: OfflineSyncStatus;
  queueState?: CanonicalQueueState;
  retryCount?: number;
  maxRetries?: number;
  nextRetryAt?: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
}

export interface SyncConflictRecord {
  conflictId: string;
  serverConflictId?: number;
  operationId: string;
  offlineId: string;
  entityType: 'ORDER' | 'PAYMENT' | 'CASH_MOVEMENT';
  conflictType: SyncConflictType;
  message: string;
  serverSnapshot?: any;
  orderSummary?: {
    type?: string;
    tableNumber?: string | null;
    total?: number;
    itemsCount?: number;
  };
  createdAt: string;
}

export interface SyncHistoryEntry {
  operationId: string;
  entityType: 'ORDER' | 'PAYMENT' | 'CASH_MOVEMENT';
  localRef: string;
  serverOrderNumber?: string | null;
  total?: number;
  deduplicated?: boolean;
  queueState: 'SYNCED';
  syncedAt: string;
}

export function generateUuid(): string {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto) {
      if (typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
      }
      if (typeof globalThis.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }
    }
  } catch {
    // Fall through to deterministic-safe pseudo-UUID
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(LS_DEVICE_ID_KEY);
    if (existing) return existing;
    const created = `pos-${generateUuid().slice(0, 12)}`;
    localStorage.setItem(LS_DEVICE_ID_KEY, created);
    return created;
  } catch {
    return 'pos-terminal-1';
  }
}

export function getNextSequenceOrder(): number {
  try {
    const cur = Number(localStorage.getItem(LS_SEQ_KEY) || '0');
    const next = (Number.isFinite(cur) ? cur : 0) + 1;
    localStorage.setItem(LS_SEQ_KEY, String(next));
    return next;
  } catch {
    return Date.now();
  }
}

export function notifyOfflineQueueChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('pos:offline-queue-updated'));
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window) || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache');
      }
      if (!db.objectStoreNames.contains('offline_orders')) {
        db.createObjectStore('offline_orders', { keyPath: 'offlineId' });
      }
      if (!db.objectStoreNames.contains('offline_payments')) {
        db.createObjectStore('offline_payments', { keyPath: 'offlinePaymentId' });
      }
      if (!db.objectStoreNames.contains('offline_cash_movements')) {
        db.createObjectStore('offline_cash_movements', { keyPath: 'offlineMovementId' });
      }
      if (!db.objectStoreNames.contains('sync_conflicts')) {
        db.createObjectStore('sync_conflicts', { keyPath: 'conflictId' });
      }
      if (!db.objectStoreNames.contains('sync_history')) {
        db.createObjectStore('sync_history', { keyPath: 'operationId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readJsonArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(key: string, data: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

function readLocalQueue(): OfflineOrderPayload[] {
  return readJsonArray<OfflineOrderPayload>(LS_ORDERS_KEY);
}

function writeLocalQueue(orders: OfflineOrderPayload[]): void {
  writeJsonArray(LS_ORDERS_KEY, orders);
}

function readLocalPaymentsQueue(): OfflinePaymentPayload[] {
  return readJsonArray<OfflinePaymentPayload>(LS_PAYMENTS_KEY);
}

function writeLocalPaymentsQueue(payments: OfflinePaymentPayload[]): void {
  writeJsonArray(LS_PAYMENTS_KEY, payments);
}

export async function setCachedData(key: string, data: any): Promise<void> {
  try {
    localStorage.setItem(`${LS_CACHE_PREFIX}${key}`, JSON.stringify(data));
  } catch {
    // ignore quota
  }

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // IndexedDB unavailable; localStorage already stored
  }
}

export async function getCachedData<T = any>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    const idbVal = await new Promise<T | null>((resolve) => {
      const tx = db.transaction('cache', 'readonly');
      const req = tx.objectStore('cache').get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
    if (idbVal !== null) return idbVal;
  } catch {
    // fallback to localStorage
  }

  try {
    const raw = localStorage.getItem(`${LS_CACHE_PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function saveOfflineOrder(order: OfflineOrderPayload): Promise<void> {
  const normalized: OfflineOrderPayload = {
    operationId: order.operationId || order.offlineId || generateUuid(),
    deviceId: order.deviceId || getDeviceId(),
    sequenceOrder: order.sequenceOrder ?? getNextSequenceOrder(),
    syncStatus: 'PENDING',
    queueState: 'PENDING',
    retryCount: 0,
    maxRetries: 5,
    nextRetryAt: 0,
    ...order,
  };

  const existingQueue = readLocalQueue().filter((o) => o.offlineId !== normalized.offlineId);
  existingQueue.push(normalized);
  writeLocalQueue(existingQueue);

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('offline_orders', 'readwrite');
      tx.objectStore('offline_orders').put(normalized);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Saved in localStorage mirror cleanly
  }

  notifyOfflineQueueChanged();
}

export async function updateOfflineOrderPayment(
  offlineId: string,
  payment: {
    paymentStatus: string;
    paymentMethod: string;
    paidAmount: number;
    payments?: OfflinePaymentLeg[];
  }
): Promise<OfflineOrderPayload | null> {
  const list = await getOfflineOrders();
  const target = list.find((o) => o.offlineId === offlineId);
  if (!target) return null;
  const updated: OfflineOrderPayload = {
    ...target,
    paymentStatus: payment.paymentStatus,
    paymentMethod: payment.paymentMethod,
    paidAmount: payment.paidAmount,
    payments: payment.payments ?? target.payments,
  };
  await saveOfflineOrder(updated);
  return updated;
}

export async function updateOfflineOrderSyncState(
  offlineId: string,
  patch: Partial<
    Pick<
      OfflineOrderPayload,
      | 'syncStatus'
      | 'queueState'
      | 'retryCount'
      | 'nextRetryAt'
      | 'lastError'
      | 'lastAttemptAt'
      | 'conflictType'
      | 'serverSnapshot'
      | 'conflictResolution'
      | 'items'
      | 'type'
      | 'tableId'
      | 'tableNumber'
      | 'taxRate'
      | 'taxAmount'
      | 'subtotal'
      | 'total'
    >
  >
): Promise<OfflineOrderPayload | null> {
  const list = await getOfflineOrders();
  const target = list.find((o) => o.offlineId === offlineId);
  if (!target) return null;
  const updated: OfflineOrderPayload = {
    ...target,
    ...patch,
  };
  await saveOfflineOrder(updated);
  return updated;
}

export async function getOfflineOrders(): Promise<OfflineOrderPayload[]> {
  const lsList = readLocalQueue();
  try {
    const db = await openDB();
    const idbList = await new Promise<OfflineOrderPayload[]>((resolve) => {
      const tx = db.transaction('offline_orders', 'readonly');
      const req = tx.objectStore('offline_orders').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    if (idbList.length > 0) {
      const map = new Map<string, OfflineOrderPayload>();
      for (const item of lsList) map.set(item.offlineId, item);
      for (const item of idbList) map.set(item.offlineId, item);
      return Array.from(map.values());
    }
  } catch {
    // fallback
  }
  return lsList;
}

export async function deleteOfflineOrder(offlineId: string): Promise<void> {
  const remaining = readLocalQueue().filter((o) => o.offlineId !== offlineId);
  writeLocalQueue(remaining);

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('offline_orders', 'readwrite');
      tx.objectStore('offline_orders').delete(offlineId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }

  notifyOfflineQueueChanged();
}

export async function saveOfflinePayment(payment: OfflinePaymentPayload): Promise<void> {
  const normalized: OfflinePaymentPayload = {
    operationId: payment.operationId || payment.offlinePaymentId || generateUuid(),
    deviceId: payment.deviceId || getDeviceId(),
    sequenceOrder: payment.sequenceOrder ?? getNextSequenceOrder(),
    syncStatus: 'PENDING',
    queueState: 'PENDING',
    retryCount: 0,
    maxRetries: 5,
    nextRetryAt: 0,
    ...payment,
  };

  const existingQueue = readLocalPaymentsQueue().filter(
    (p) => p.offlinePaymentId !== normalized.offlinePaymentId
  );
  existingQueue.push(normalized);
  writeLocalPaymentsQueue(existingQueue);

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('offline_payments', 'readwrite');
      tx.objectStore('offline_payments').put(normalized);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Saved in localStorage mirror cleanly
  }

  notifyOfflineQueueChanged();
}

export async function updateOfflinePaymentSyncState(
  offlinePaymentId: string,
  patch: Partial<
    Pick<
      OfflinePaymentPayload,
      'syncStatus' | 'queueState' | 'retryCount' | 'nextRetryAt' | 'lastError' | 'lastAttemptAt'
    >
  >
): Promise<OfflinePaymentPayload | null> {
  const list = await getOfflinePayments();
  const target = list.find((p) => p.offlinePaymentId === offlinePaymentId);
  if (!target) return null;
  const updated: OfflinePaymentPayload = {
    ...target,
    ...patch,
  };
  await saveOfflinePayment(updated);
  return updated;
}

export async function getOfflinePayments(): Promise<OfflinePaymentPayload[]> {
  const lsList = readLocalPaymentsQueue();
  try {
    const db = await openDB();
    const idbList = await new Promise<OfflinePaymentPayload[]>((resolve) => {
      const tx = db.transaction('offline_payments', 'readonly');
      const req = tx.objectStore('offline_payments').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    if (idbList.length > 0) {
      const map = new Map<string, OfflinePaymentPayload>();
      for (const item of lsList) map.set(item.offlinePaymentId, item);
      for (const item of idbList) map.set(item.offlinePaymentId, item);
      return Array.from(map.values());
    }
  } catch {
    // fallback
  }
  return lsList;
}

export async function deleteOfflinePayment(offlinePaymentId: string): Promise<void> {
  const remaining = readLocalPaymentsQueue().filter((p) => p.offlinePaymentId !== offlinePaymentId);
  writeLocalPaymentsQueue(remaining);

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('offline_payments', 'readwrite');
      tx.objectStore('offline_payments').delete(offlinePaymentId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }

  notifyOfflineQueueChanged();
}

// Offline Cash Movements Queue
export async function saveOfflineCashMovement(movement: OfflineCashMovementPayload): Promise<void> {
  const normalized: OfflineCashMovementPayload = {
    operationId: movement.operationId || movement.offlineMovementId || generateUuid(),
    deviceId: movement.deviceId || getDeviceId(),
    sequenceOrder: movement.sequenceOrder ?? getNextSequenceOrder(),
    syncStatus: 'PENDING',
    queueState: 'PENDING',
    retryCount: 0,
    maxRetries: 5,
    nextRetryAt: 0,
    ...movement,
  };

  const existing = readJsonArray<OfflineCashMovementPayload>(LS_CASH_MOVEMENTS_KEY).filter(
    (m) => m.offlineMovementId !== normalized.offlineMovementId
  );
  existing.push(normalized);
  writeJsonArray(LS_CASH_MOVEMENTS_KEY, existing);

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('offline_cash_movements', 'readwrite');
      tx.objectStore('offline_cash_movements').put(normalized);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Saved cleanly in localStorage mirror
  }

  notifyOfflineQueueChanged();
}

export async function getOfflineCashMovements(): Promise<OfflineCashMovementPayload[]> {
  const lsList = readJsonArray<OfflineCashMovementPayload>(LS_CASH_MOVEMENTS_KEY);
  try {
    const db = await openDB();
    const idbList = await new Promise<OfflineCashMovementPayload[]>((resolve) => {
      const tx = db.transaction('offline_cash_movements', 'readonly');
      const req = tx.objectStore('offline_cash_movements').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    if (idbList.length > 0) {
      const map = new Map<string, OfflineCashMovementPayload>();
      for (const item of lsList) map.set(item.offlineMovementId, item);
      for (const item of idbList) map.set(item.offlineMovementId, item);
      return Array.from(map.values());
    }
  } catch {
    // fallback
  }
  return lsList;
}

export async function updateOfflineCashMovementSyncState(
  offlineMovementId: string,
  patch: Partial<
    Pick<
      OfflineCashMovementPayload,
      'syncStatus' | 'queueState' | 'retryCount' | 'nextRetryAt' | 'lastError' | 'lastAttemptAt'
    >
  >
): Promise<OfflineCashMovementPayload | null> {
  const list = await getOfflineCashMovements();
  const target = list.find((m) => m.offlineMovementId === offlineMovementId);
  if (!target) return null;
  const updated: OfflineCashMovementPayload = { ...target, ...patch };
  await saveOfflineCashMovement(updated);
  return updated;
}

export async function deleteOfflineCashMovement(offlineMovementId: string): Promise<void> {
  const remaining = readJsonArray<OfflineCashMovementPayload>(LS_CASH_MOVEMENTS_KEY).filter(
    (m) => m.offlineMovementId !== offlineMovementId
  );
  writeJsonArray(LS_CASH_MOVEMENTS_KEY, remaining);

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('offline_cash_movements', 'readwrite');
      tx.objectStore('offline_cash_movements').delete(offlineMovementId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }

  notifyOfflineQueueChanged();
}

// Sync Conflicts Storage
export async function saveSyncConflict(conflict: SyncConflictRecord): Promise<void> {
  const existing = readJsonArray<SyncConflictRecord>(LS_CONFLICTS_KEY).filter(
    (c) => c.conflictId !== conflict.conflictId
  );
  existing.push(conflict);
  writeJsonArray(LS_CONFLICTS_KEY, existing);

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('sync_conflicts', 'readwrite');
      tx.objectStore('sync_conflicts').put(conflict);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // fallback already saved
  }

  notifyOfflineQueueChanged();
}

export async function getSyncConflicts(): Promise<SyncConflictRecord[]> {
  const lsList = readJsonArray<SyncConflictRecord>(LS_CONFLICTS_KEY);
  try {
    const db = await openDB();
    const idbList = await new Promise<SyncConflictRecord[]>((resolve) => {
      const tx = db.transaction('sync_conflicts', 'readonly');
      const req = tx.objectStore('sync_conflicts').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    if (idbList.length > 0) {
      const map = new Map<string, SyncConflictRecord>();
      for (const item of lsList) map.set(item.conflictId, item);
      for (const item of idbList) map.set(item.conflictId, item);
      return Array.from(map.values());
    }
  } catch {
    // fallback
  }
  return lsList;
}

export async function removeSyncConflict(conflictId: string): Promise<void> {
  const remaining = readJsonArray<SyncConflictRecord>(LS_CONFLICTS_KEY).filter(
    (c) => c.conflictId !== conflictId && c.offlineId !== conflictId && c.operationId !== conflictId
  );
  writeJsonArray(LS_CONFLICTS_KEY, remaining);

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('sync_conflicts', 'readwrite');
      tx.objectStore('sync_conflicts').delete(conflictId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }

  notifyOfflineQueueChanged();
}

// Synced Operations History Log (SYNCED state audit)
export async function appendSyncHistory(entry: SyncHistoryEntry): Promise<void> {
  const existing = readJsonArray<SyncHistoryEntry>(LS_HISTORY_KEY).filter(
    (h) => h.operationId !== entry.operationId
  );
  const next = [entry, ...existing].slice(0, 100);
  writeJsonArray(LS_HISTORY_KEY, next);

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('sync_history', 'readwrite');
      tx.objectStore('sync_history').put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export async function getSyncHistory(): Promise<SyncHistoryEntry[]> {
  const lsList = readJsonArray<SyncHistoryEntry>(LS_HISTORY_KEY);
  try {
    const db = await openDB();
    const idbList = await new Promise<SyncHistoryEntry[]>((resolve) => {
      const tx = db.transaction('sync_history', 'readonly');
      const req = tx.objectStore('sync_history').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    if (idbList.length > 0) {
      const map = new Map<string, SyncHistoryEntry>();
      for (const item of lsList) map.set(item.operationId, item);
      for (const item of idbList) map.set(item.operationId, item);
      return Array.from(map.values())
        .sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime())
        .slice(0, 100);
    }
  } catch {
    // fallback
  }
  return lsList.sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime());
}

export async function recoverInterruptedSyncs(): Promise<number> {
  let recovered = 0;
  const orders = await getOfflineOrders();
  for (const ord of orders) {
    if (ord.syncStatus === 'SYNCING' || ord.syncStatus === 'PROCESSING' || ord.queueState === 'PROCESSING') {
      await updateOfflineOrderSyncState(ord.offlineId, {
        syncStatus: 'PENDING',
        queueState: 'PENDING',
        nextRetryAt: 0,
      });
      recovered++;
    }
  }

  const pays = await getOfflinePayments();
  for (const pay of pays) {
    if (pay.syncStatus === 'SYNCING' || pay.syncStatus === 'PROCESSING' || pay.queueState === 'PROCESSING') {
      await updateOfflinePaymentSyncState(pay.offlinePaymentId, {
        syncStatus: 'PENDING',
        queueState: 'PENDING',
        nextRetryAt: 0,
      });
      recovered++;
    }
  }

  const movements = await getOfflineCashMovements();
  for (const mov of movements) {
    if (mov.syncStatus === 'SYNCING' || mov.syncStatus === 'PROCESSING' || mov.queueState === 'PROCESSING') {
      await updateOfflineCashMovementSyncState(mov.offlineMovementId, {
        syncStatus: 'PENDING',
        queueState: 'PENDING',
        nextRetryAt: 0,
      });
      recovered++;
    }
  }

  return recovered;
}
