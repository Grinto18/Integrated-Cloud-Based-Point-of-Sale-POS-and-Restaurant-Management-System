import * as offlineStorage from './offlineStorage.ts';
import type {
  OfflineOrderPayload,
  OfflinePaymentLeg,
  OfflinePaymentPayload,
  OfflineCashMovementPayload,
  SyncConflictRecord,
  SyncHistoryEntry,
} from './offlineStorage.ts';

export interface SyncQueueResult {
  count: number;
  failedCount?: number;
  pendingCount?: number;
  conflictsCount?: number;
  nextRetryAt?: number | null;
  error?: string;
}

export class OfflineNetworkError extends Error {
  isOffline = true;
  constructor(message = 'Network connection unavailable') {
    super(message);
    this.name = 'OfflineNetworkError';
  }
}

export function generateUuid(): string {
  const fn = getOptionalStorageFn<() => string>('generateUuid');
  if (fn) return fn();
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `uuid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOptionalStorageFn<T extends (...args: any[]) => any>(name: string): T | null {
  try {
    if (!Object.keys(offlineStorage).includes(name)) return null;
    const fn = (offlineStorage as Record<string, any>)[name];
    return typeof fn === 'function' ? (fn as T) : null;
  } catch {
    return null;
  }
}

export async function safeGetOfflinePayments(): Promise<OfflinePaymentPayload[]> {
  const fn = getOptionalStorageFn<() => Promise<OfflinePaymentPayload[]>>('getOfflinePayments');
  if (!fn) return [];
  return fn().catch(() => []);
}

export async function safeGetOfflineCashMovements(): Promise<OfflineCashMovementPayload[]> {
  const fn = getOptionalStorageFn<() => Promise<OfflineCashMovementPayload[]>>('getOfflineCashMovements');
  if (!fn) return [];
  return fn().catch(() => []);
}

export async function safeGetSyncConflicts(): Promise<SyncConflictRecord[]> {
  const fn = getOptionalStorageFn<() => Promise<SyncConflictRecord[]>>('getSyncConflicts');
  if (!fn) return [];
  return fn().catch(() => []);
}

export async function safeGetSyncHistory(): Promise<SyncHistoryEntry[]> {
  const fn = getOptionalStorageFn<() => Promise<SyncHistoryEntry[]>>('getSyncHistory');
  if (!fn) return [];
  return fn().catch(() => []);
}

export async function safeRemoveSyncConflict(id: string): Promise<void> {
  const fn = getOptionalStorageFn<(id: string) => Promise<void>>('removeSyncConflict');
  if (fn) await fn(id).catch(() => {});
}

export async function safeDeleteOfflinePayment(id: string): Promise<void> {
  const fn = getOptionalStorageFn<(id: string) => Promise<void>>('deleteOfflinePayment');
  if (fn) await fn(id).catch(() => {});
}

export async function safeDeleteOfflineCashMovement(id: string): Promise<void> {
  const fn = getOptionalStorageFn<(id: string) => Promise<void>>('deleteOfflineCashMovement');
  if (fn) await fn(id).catch(() => {});
}

export async function safeRecoverInterruptedSyncs(): Promise<number> {
  const fn = getOptionalStorageFn<() => Promise<number>>('recoverInterruptedSyncs');
  if (!fn) return 0;
  return fn().catch(() => 0);
}

export function computeBackoffMs(retryCount: number, baseMs = 2000): number {
  const safeRetries = Math.max(0, Number(retryCount) || 0);
  return Math.min(60000, baseMs * Math.pow(2, safeRetries));
}

export function isNetworkFailureError(err: any): boolean {
  if (!err) return false;
  if (err instanceof OfflineNetworkError || err?.isOffline === true) return true;
  if (err instanceof TypeError) return true;
  if (err?.name === 'AbortError') return true;
  const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('network connection unavailable') ||
    msg.includes('queued for offline sync') ||
    msg.includes('load failed') ||
    msg.includes('econnrefused') ||
    msg.includes('status 502') ||
    msg.includes('status 503') ||
    msg.includes('status 504')
  );
}

let activeSyncPromise: Promise<SyncQueueResult> | null = null;

const TOKEN_KEY = 'golden_palace_auth_token';

export const getAuthToken = (): string | null => {
  return localStorage.getItem(TOKEN_KEY);
};

export const setAuthToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
};

export const removeAuthToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
};

let sessionRestoring = false;

export const setSessionRestoring = (restoring: boolean): void => {
  sessionRestoring = restoring;
};

export const isSessionRestoring = (): boolean => sessionRestoring;

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const isAuthEndpoint = endpoint.startsWith('/auth/');
  if (sessionRestoring && !isAuthEndpoint) {
    throw new Error('SESSION_RESTORATION_IN_PROGRESS');
  }

  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let isClientHttpError = false;
  try {
    const res = await fetch(`/api${endpoint}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        isClientHttpError = true;
      }
      if (res.status === 401) {
        if (!endpoint.startsWith('/auth/login') && !endpoint.startsWith('/auth/pin-login')) {
          removeAuthToken();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('pos:unauthorized'));
          }
        }
      }
      const errorJson = await res.json().catch(() => ({}));
      if (res.status === 503 && errorJson?.offline === true) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('pos:server-unreachable'));
        }
        throw new OfflineNetworkError(errorJson.error || 'Network connection unavailable');
      }
      throw new Error(errorJson.error || `Request failed with status ${res.status}`);
    }

    const data = await res.json();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('pos:server-reachable'));
    }

    // Cache successful GET responses for offline resilience
    if (options.method === undefined || options.method === 'GET') {
      await offlineStorage.setCachedData(endpoint, data);
    }

    return data;
  } catch (error: any) {
    if (isNetworkFailureError(error) && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('pos:server-unreachable'));
    }
    // Only fall back to offline cache on genuine network / 5xx unavailability — never on HTTP 4xx (400/401/403/404/409)
    if (
      !isClientHttpError &&
      (options.method === undefined || options.method === 'GET')
    ) {
      const cached = await offlineStorage.getCachedData<T>(endpoint);
      if (cached) {
        console.warn(`Serving offline cached data for /api${endpoint}`);
        return cached;
      }
    }
    throw error;
  }
}

export const api = {
  // Auth
  login: (identifier: string, password: string) =>
    request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),
  pinLogin: (pin: string) =>
    request<{ token: string; user: any }>('/auth/pin-login', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),
  getMe: () => request<{ user: any }>('/auth/me'),
  logout: (explicitToken?: string) =>
    request<{ success: boolean }>('/auth/logout', {
      method: 'POST',
      ...(explicitToken ? { headers: { Authorization: `Bearer ${explicitToken}` } } : {}),
    }),

  // Users
  getUsers: () => request<any[]>('/users'),
  createUser: (data: any) =>
    request<any>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateUser: (id: number, data: any) =>
    request<any>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Categories & Products
  getCategories: () => request<any[]>('/categories'),
  createCategory: (data: any) =>
    request<any>('/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCategory: (id: number, data: any) =>
    request<any>(`/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteCategory: (id: number) =>
    request<any>(`/categories/${id}`, { method: 'DELETE' }),

  getProducts: () => request<any[]>('/products'),
  createProduct: (data: any) =>
    request<any>('/products', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateProduct: (id: number, data: any) =>
    request<any>(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  toggleProductAvailability: (id: number) =>
    request<any>(`/products/${id}/toggle-available`, { method: 'PATCH' }),
  deleteProduct: (id: number) =>
    request<any>(`/products/${id}`, { method: 'DELETE' }),
  getProductPriceHistory: (id: number) =>
    request<any[]>(`/products/${id}/price-history`),

  // Add-ons (Empty by default; admin-configured global/product extras)
  getAddons: (includeInactive = false) =>
    request<any[]>(`/addons${includeInactive ? '?includeInactive=true' : ''}`),
  createAddon: (data: { productId?: number | null; nameAr: string; nameFr?: string; price: number; isActive?: boolean }) =>
    request<any>('/addons', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAddon: (id: number, data: { nameAr?: string; nameFr?: string; price?: number; isActive?: boolean }) =>
    request<any>(`/addons/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteAddon: (id: number) =>
    request<any>(`/addons/${id}`, { method: 'DELETE' }),

  // Official Menu Import Module (CSV / XLSX / JSON)
  previewMenuImport: (payload: {
    filename: string;
    format?: 'CSV' | 'XLSX' | 'JSON';
    content?: string;
    contentBase64?: string;
  }) =>
    request<any>('/menu/import/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  commitMenuImport: (payload: {
    filename: string;
    format?: 'CSV' | 'XLSX' | 'JSON';
    content?: string;
    contentBase64?: string;
    confirmed: boolean;
    rejectOnDuplicates?: boolean;
  }) =>
    request<any>('/menu/import/commit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getMenuImportHistory: (limit = 30) =>
    request<any[]>(`/menu/import/history?limit=${limit}`),

  // Tables
  getTables: () => request<any[]>('/tables'),
  createTable: (data: any) =>
    request<any>('/tables', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTableStatus: (id: number, status: string, currentOrderId?: number | null) =>
    request<any>(`/tables/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, currentOrderId }),
    }),
  transferTable: (fromTableId: number, toTableId: number) =>
    request<any>('/tables/transfer', {
      method: 'POST',
      body: JSON.stringify({ fromTableId, toTableId }),
    }),
  mergeTables: (sourceTableId: number, targetTableId: number) =>
    request<any>('/tables/merge', {
      method: 'POST',
      body: JSON.stringify({ sourceTableId, targetTableId }),
    }),

  // Server Health Probe (real reachability beyond navigator.onLine)
  checkHealth: async (timeoutMs = 3000): Promise<{ reachable: boolean; latencyMs?: number; status?: string }> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { reachable: false };
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const started = Date.now();
    try {
      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!res.ok) {
        return { reachable: false };
      }
      const data = await res.json().catch(() => ({}));
      if (data?.offline === true || data?.status === 'degraded') {
        return { reachable: false };
      }
      return {
        reachable: true,
        latencyMs: Date.now() - started,
        status: data?.status || 'ok',
      };
    } catch {
      return { reachable: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  // Orders
  getOrders: (params?: { heldOnly?: boolean; limit?: number; status?: string; type?: string }) => {
    const q = new URLSearchParams();
    if (params?.heldOnly) q.set('heldOnly', 'true');
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.status) q.set('status', params.status);
    if (params?.type) q.set('type', params.type);
    const qs = q.toString();
    return request<any[]>(qs ? `/orders?${qs}` : '/orders');
  },
  getOrder: (id: number) => request<any>(`/orders/${id}`),
  createOrder: async (data: any) => {
    const uuid = generateUuid();
    const offlineId = data.offlineId || `off-${uuid}`;
    const operationId = data.operationId || uuid;
    const idempKey = data.idempotencyKey || `ord-${uuid}`;
    const deviceIdFn = getOptionalStorageFn<() => string>('getDeviceId');
    const seqFn = getOptionalStorageFn<() => number>('getNextSequenceOrder');
    const deviceId = data.deviceId || (deviceIdFn ? deviceIdFn() : 'pos-terminal-1');
    const sequenceOrder = data.sequenceOrder ?? (seqFn ? seqFn() : Date.now());

    const queueLocally = async () => {
      const subtotal = Number(
        data.subtotal ??
          (data.items || []).reduce((s: number, it: any) => s + Number(it.unitPrice) * Number(it.quantity), 0)
      );
      const discount = Number(data.discount || 0);
      const deliveryFee = Number(data.deliveryFee || 0);
      const taxRate = Number(data.taxRate || 0);
      const taxAmount = Number(data.taxAmount || 0);
      const total = Number(data.total ?? Math.max(0, subtotal - discount + taxAmount + deliveryFee));
      const payload: OfflineOrderPayload = {
        offlineId,
        operationId,
        deviceId,
        sequenceOrder,
        type: data.type || 'DINE_IN',
        tableId: data.tableId ?? null,
        tableNumber: data.tableNumber || null,
        customerId: data.customerId || null,
        customerName: data.customerName || null,
        deliveryAddress: data.deliveryAddress || null,
        items: (data.items || []).map((it: any) => ({
          ...it,
          expectedCatalogPrice: it.expectedCatalogPrice ?? Number(it.unitPrice),
        })),
        subtotal,
        discount,
        deliveryFee,
        taxRate,
        taxAmount,
        total,
        paidAmount: data.paidAmount || 0,
        paymentStatus: data.paymentStatus || 'UNPAID',
        paymentMethod: data.paymentMethod,
        payments: Array.isArray(data.payments) ? data.payments : [],
        notes: data.notes || null,
        isHeld: Boolean(data.isHeld),
        sendToKitchen: Boolean(data.sendToKitchen),
        idempotencyKey: idempKey,
        createdAt: new Date().toISOString(),
        syncStatus: 'PENDING',
        queueState: 'PENDING',
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: 0,
        strictConflictCheck: true,
      };
      await offlineStorage.saveOfflineOrder(payload);
      return {
        id: -Date.now(),
        orderNumber: `BON-OFF-${offlineId.slice(-4)}`,
        dailySequence: 0,
        ...payload,
        offline: true,
      };
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return queueLocally();
    }

    try {
      return await request<any>('/orders', {
        method: 'POST',
        body: JSON.stringify({ ...data, offlineId, operationId, idempotencyKey: idempKey }),
      });
    } catch (err: any) {
      if (isNetworkFailureError(err)) {
        return queueLocally();
      }
      throw err;
    }
  },
  appendOrderItems: (id: number, data: { items: any[]; replaceAll?: boolean; discount?: number; deliveryFee?: number; notes?: string; sendToKitchen?: boolean }) =>
    request<any>(`/orders/${id}/items`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  resumeHeldOrder: (id: number) =>
    request<any>(`/orders/${id}/resume`, { method: 'POST' }),
  cancelOrder: (id: number, reason?: string) =>
    request<any>(`/orders/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  refundOrder: (id: number, reason?: string) =>
    request<any>(`/orders/${id}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Payments (supports split payments & offline queuing for both offline orders and existing orders)
  processPayment: async (data: {
    orderId: number;
    offlineId?: string;
    orderNumber?: string | null;
    payments: any[];
    idempotencyKey?: string;
    operationId?: string;
  }) => {
    const uuid = generateUuid();
    const baseKey = data.idempotencyKey || `pay-${uuid}`;
    const operationId = data.operationId || uuid;
    const deviceIdFn = getOptionalStorageFn<() => string>('getDeviceId');
    const seqFn = getOptionalStorageFn<() => number>('getNextSequenceOrder');
    const deviceId = deviceIdFn ? deviceIdFn() : 'pos-terminal-1';
    const sequenceOrder = seqFn ? seqFn() : Date.now();

    const normalizedPayments: OfflinePaymentLeg[] = (data.payments || []).map((p: any, idx: number) => {
      const amount = Number(p.amount || 0);
      const tenderAmount = p.tenderAmount !== undefined ? Number(p.tenderAmount) : amount;
      const changeAmount =
        p.changeAmount !== undefined ? Number(p.changeAmount) : Math.max(0, tenderAmount - amount);
      return {
        method: p.method || 'CASH',
        amount,
        tenderAmount,
        changeAmount,
        transactionRef: p.transactionRef || null,
        idempotencyKey:
          p.idempotencyKey ||
          ((data.payments || []).length === 1 && idx === 0
            ? baseKey
            : `${baseKey}-${idx}-${p.method || 'CASH'}`),
      };
    });

    const totalPaid = normalizedPayments.reduce((s, p) => s + p.amount, 0);
    const primaryMethod =
      normalizedPayments.length > 1 ? 'MIXED' : normalizedPayments[0]?.method || 'CASH';

    if (data.orderId < 0 || data.offlineId) {
      if (data.offlineId) {
        const currentOrders = await offlineStorage.getOfflineOrders().catch(() => []);
        const target = currentOrders.find((o) => o.offlineId === data.offlineId);
        const existingPaid = Number(target?.paidAmount || 0);
        const targetTotal = Number(target?.total || totalPaid);
        const cumulativePaid = existingPaid + totalPaid;
        const paymentStatus = cumulativePaid >= targetTotal - 0.01 ? 'PAID' : 'PARTIALLY_PAID';
        const mergedPayments = [...(target?.payments || []), ...normalizedPayments];

        await offlineStorage.updateOfflineOrderPayment(data.offlineId, {
          paymentStatus,
          paymentMethod: mergedPayments.length > 1 ? 'MIXED' : primaryMethod,
          paidAmount: cumulativePaid,
          payments: mergedPayments,
        });
        return {
          success: true,
          offline: true,
          orderId: data.orderId,
          offlineId: data.offlineId,
          paidAmount: cumulativePaid,
          paymentStatus,
          payments: mergedPayments,
        };
      }
    }

    const queueStandalonePaymentLocally = async () => {
      const offlinePaymentId = `offpay-${uuid}`;
      const payload: OfflinePaymentPayload = {
        offlinePaymentId,
        operationId,
        deviceId,
        sequenceOrder,
        orderId: data.orderId,
        orderNumber: data.orderNumber || null,
        payments: normalizedPayments,
        idempotencyKey: baseKey,
        createdAt: new Date().toISOString(),
        syncStatus: 'PENDING',
        queueState: 'PENDING',
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: 0,
      };
      const savePayFn = getOptionalStorageFn<(p: OfflinePaymentPayload) => Promise<void>>('saveOfflinePayment');
      if (savePayFn) {
        await savePayFn(payload);
      }
      return {
        success: true,
        offline: true,
        offlinePaymentId,
        orderId: data.orderId,
        paidAmount: totalPaid,
        paymentStatus: 'PENDING_SYNC',
        payments: normalizedPayments,
      };
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine && data.orderId > 0) {
      return queueStandalonePaymentLocally();
    }

    try {
      return await request<any>('/payments', {
        method: 'POST',
        body: JSON.stringify({
          orderId: data.orderId,
          payments: normalizedPayments,
          idempotencyKey: baseKey,
        }),
      });
    } catch (err: any) {
      if (data.orderId > 0 && isNetworkFailureError(err)) {
        return queueStandalonePaymentLocally();
      }
      throw err;
    }
  },

  // Cash Register (with offline movement queue + close guard)
  getCurrentShift: () => request<any>('/cash-register/current'),
  openShift: (openingCash: number, notes?: string) =>
    request<any>('/cash-register/open', {
      method: 'POST',
      body: JSON.stringify({ openingCash, notes }),
    }),
  closeShift: async (shiftId: number, closingCash: number, notes?: string) => {
    const [pendingOrds, pendingPays, pendingMovs, conflictsList] = await Promise.all([
      offlineStorage.getOfflineOrders().catch(() => []),
      safeGetOfflinePayments(),
      safeGetOfflineCashMovements(),
      safeGetSyncConflicts(),
    ]);
    const pendingOfflineCount = pendingOrds.length + pendingPays.length + pendingMovs.length;
    if (pendingOfflineCount > 0 || conflictsList.length > 0) {
      throw new Error('لا يمكن إغلاق الوردية قبل مزامنة كافة الطلبات والمدفوعات المعلقة وحل التعارضات');
    }
    return request<any>('/cash-register/close', {
      method: 'POST',
      body: JSON.stringify({ shiftId, closingCash, notes, pendingOfflineCount }),
    });
  },
  recordCashMovement: async (data: { shiftId: number; type: 'CASH_IN' | 'CASH_OUT' | string; amount: number; reason: string; idempotencyKey?: string }) => {
    const uuid = generateUuid();
    const idempotencyKey = data.idempotencyKey || `mov-${uuid}`;
    const deviceIdFn = getOptionalStorageFn<() => string>('getDeviceId');
    const seqFn = getOptionalStorageFn<() => number>('getNextSequenceOrder');

    const queueMovementLocally = async () => {
      const payload: OfflineCashMovementPayload = {
        offlineMovementId: `offmov-${uuid}`,
        operationId: uuid,
        deviceId: deviceIdFn ? deviceIdFn() : 'pos-terminal-1',
        sequenceOrder: seqFn ? seqFn() : Date.now(),
        shiftId: data.shiftId,
        type: (data.type === 'CASH_OUT' ? 'CASH_OUT' : 'CASH_IN'),
        amount: Number(data.amount),
        reason: data.reason,
        idempotencyKey,
        createdAt: new Date().toISOString(),
        syncStatus: 'PENDING',
        queueState: 'PENDING',
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: 0,
      };
      const saveMovFn = getOptionalStorageFn<(m: OfflineCashMovementPayload) => Promise<void>>('saveOfflineCashMovement');
      if (saveMovFn) await saveMovFn(payload);
      return { ...payload, offline: true };
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return queueMovementLocally();
    }

    try {
      return await request<any>('/cash-register/movement', {
        method: 'POST',
        body: JSON.stringify({ ...data, idempotencyKey }),
      });
    } catch (err: any) {
      if (isNetworkFailureError(err)) {
        return queueMovementLocally();
      }
      throw err;
    }
  },
  getShiftHistory: () => request<any[]>('/cash-register/history'),

  // Kitchen (KDS)
  getKitchenTickets: (station?: string) => {
    const q = station ? `?station=${station}` : '';
    return request<any[]>(`/kitchen/tickets${q}`);
  },
  updateKitchenItemStatus: (id: number, status: string) =>
    request<any>(`/kitchen/items/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // Inventory
  getInventory: () => request<any[]>('/inventory'),
  createIngredient: (data: any) =>
    request<any>('/inventory', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateIngredient: (id: number, data: any) =>
    request<any>(`/inventory/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  adjustStock: (data: { ingredientId: number; actualQuantity: number; reason?: string; notes?: string }) =>
    request<any>('/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getInventoryMovements: (params?: { ingredientId?: number; type?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.ingredientId) q.set('ingredientId', String(params.ingredientId));
    if (params?.type && params.type !== 'ALL') q.set('type', params.type);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<any[]>(qs ? `/inventory/movements?${qs}` : '/inventory/movements');
  },

  // Waste (Pertes)
  getWasteRecords: () => request<any[]>('/waste'),
  recordWaste: (data: any) =>
    request<any>('/waste', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Purchases & Suppliers
  getSuppliers: () => request<any[]>('/suppliers'),
  createSupplier: (data: any) =>
    request<any>('/suppliers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getPurchases: () => request<any[]>('/purchases'),
  createPurchase: (data: any) =>
    request<any>('/purchases', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Customers & Delivery
  getCustomers: () => request<any[]>('/customers'),
  createCustomer: (data: any) =>
    request<any>('/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getDeliveries: () => request<any[]>('/deliveries'),
  updateDeliveryStatus: (id: number, data: any) =>
    request<any>(`/deliveries/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Expenses
  getExpenses: () => request<any[]>('/expenses'),
  createExpense: (data: any) =>
    request<any>('/expenses', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Cashier Dashboard & Reports
  getCashierDashboard: () => request<any>('/cashier/dashboard'),
  getDashboardReport: (startDate?: string, endDate?: string) => {
    const q = new URLSearchParams();
    if (startDate) q.set('startDate', startDate);
    if (endDate) q.set('endDate', endDate);
    const qs = q.toString();
    return request<any>(qs ? `/reports/dashboard?${qs}` : '/reports/dashboard');
  },
  getSalesReport: (startDate?: string, endDate?: string) => {
    const q = new URLSearchParams();
    if (startDate) q.set('startDate', startDate);
    if (endDate) q.set('endDate', endDate);
    return request<any[]>(`/reports/sales?${q.toString()}`);
  },

  // Settings & Audit
  getSettings: () => request<Record<string, string>>('/settings'),
  updateSettings: (data: Record<string, string>) =>
    request<any>('/settings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getAuditLogs: () => request<any[]>('/audit-logs'),
  getAuditLogsPaginated: (params?: {
    page?: number;
    limit?: number;
    userId?: number;
    action?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }) => {
    const q = new URLSearchParams();
    q.set('paginated', 'true');
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.userId) q.set('userId', String(params.userId));
    if (params?.action && params.action !== 'ALL') q.set('action', params.action);
    if (params?.startDate) q.set('startDate', params.startDate);
    if (params?.endDate) q.set('endDate', params.endDate);
    if (params?.search) q.set('search', params.search);
    return request<any>(`/audit-logs?${q.toString()}`);
  },

  // Windows Thermal Printer Spooler & Persistent Print Jobs Queue
  getPrinterStatus: () => request<any>('/printer/status'),
  spoolPrintJob: (data: {
    orderId?: number | null;
    orderNumber?: string;
    jobType?: string;
    printerName?: string;
    connectionType?: string;
    targetIp?: string | null;
    targetPort?: number | null;
    paperWidth?: string;
    rawBase64?: string;
    textContent?: string;
    payloadPreview?: string;
    copies?: number;
    printJobId?: string;
    isReprint?: boolean;
    clientHandled?: boolean;
    clientError?: string | null;
  }) =>
    request<any>('/printer/spool', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getPrintJobs: (params?: { status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<any[]>(qs ? `/printer/jobs?${qs}` : '/printer/jobs');
  },
  retryPrintJob: (id: number, rawBase64?: string) =>
    request<any>(`/printer/jobs/${id}/retry`, {
      method: 'POST',
      body: JSON.stringify(rawBase64 ? { rawBase64 } : {}),
    }),
  reprintPrintJob: (id: number, overrides?: { printerName?: string; connectionType?: string; rawBase64?: string }) =>
    request<any>(`/printer/jobs/${id}/reprint`, {
      method: 'POST',
      body: JSON.stringify(overrides || {}),
    }),
  confirmPrintJob: (id: number) =>
    request<any>(`/printer/jobs/${id}/confirm`, {
      method: 'POST',
    }),
  testPrinter: (data: {
    testType: 'STANDARD' | 'ARABIC' | 'FEED_CUT';
    printerName: string;
    connectionType: string;
    targetIp?: string | null;
    targetPort?: number | null;
    paperWidth?: '58mm' | '80mm';
    arabicEncoding?: 'CP864' | 'WINDOWS_1256' | 'UTF8';
  }) =>
    request<any>('/printer/test', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Desktop Runtime, First-Run Setup & Safe Update Guard
  getFirstRunStatus: () =>
    request<{ needsInitialAdminSetup: boolean; isDesktop: boolean; platform: string; usersCount: number }>(
      '/system/first-run-status'
    ),
  setupInitialAdmin: (data: { fullName: string; username: string; email?: string; password: string; pin: string }) =>
    request<{ token: string; user: any }>('/system/setup-admin', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getDesktopStatus: () => request<any>('/system/desktop-status'),
  runPreUpdateCheck: (currentVersion?: string, targetVersion?: string) =>
    request<any>('/system/pre-update-check', {
      method: 'POST',
      body: JSON.stringify({ currentVersion, targetVersion }),
    }),

  // Menu Reset
  resetGrineMenu: (confirm = 'CONFIRM_MENU_RESET') =>
    request<{ success: boolean; message: string }>('/menu/reset-grine', {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    }),

  // Backup & Export
  getBackups: () => request<any>('/backups'),
  createSqliteBackup: (type: 'MANUAL' | 'DAILY' | 'WEEKLY' | 'SCHEDULED' = 'MANUAL') =>
    request<any>('/backups/create', {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),
  verifySqliteBackup: (filename: string) =>
    request<any>('/backups/verify', {
      method: 'POST',
      body: JSON.stringify({ filename }),
    }),
  restoreSqliteBackup: (filename: string, confirmRestore = 'CONFIRM_RESTORE') =>
    request<any>('/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ filename, confirmRestore }),
    }),
  downloadSqliteBackup: async (filename: string): Promise<void> => {
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`/api/backups/download/${encodeURIComponent(filename)}`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Request failed with status ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
  exportBackup: async () => {
    const [settings, categories, products, inventory] = await Promise.all([
      request<Record<string, string>>('/settings').catch(() => ({})),
      request<any[]>('/categories').catch(() => []),
      request<any[]>('/products').catch(() => []),
      request<any[]>('/inventory').catch(() => []),
    ]);
    return {
      appName: 'Golden Palace POS',
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      settings,
      categories,
      products,
      inventory,
    };
  },

  // Sync Center Server Endpoints
  getSyncStatus: () => request<any>('/sync/status'),
  getSyncConflicts: () => request<any[]>('/sync/conflicts'),
  resolveServerSyncConflict: (conflictId: number, action: string) =>
    request<any>(`/sync/conflicts/${conflictId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  // Offline Sync (single-flight + FIFO + exponential backoff + conflict capture + ack-only deletion)
  syncOfflineQueue: async (
    options: { force?: boolean; includeFailed?: boolean; baseBackoffMs?: number } = {}
  ): Promise<SyncQueueResult> => {
    if (activeSyncPromise) {
      return activeSyncPromise;
    }

    const { force = false, includeFailed = false, baseBackoffMs = 2000 } = options;

    activeSyncPromise = (async (): Promise<SyncQueueResult> => {
      // Recover any items left in SYNCING/PROCESSING from a crashed tab / interrupted request
      await safeRecoverInterruptedSyncs();

      const now = Date.now();
      const [allOrders, allPayments, allMovements] = await Promise.all([
        offlineStorage.getOfflineOrders(),
        safeGetOfflinePayments(),
        safeGetOfflineCashMovements(),
      ]);

      const isItemEligible = (item: any) => {
        const isFailed = item.syncStatus === 'FAILED' || item.queueState === 'FAILED';
        if (isFailed) {
          // Resolved conflicts or explicit retry of failed items are eligible
          if (item.conflictResolution && force) return true;
          if (!includeFailed) return false;
        }
        return force || !item.nextRetryAt || now >= Number(item.nextRetryAt);
      };

      const sortFifo = <T extends { sequenceOrder?: number; createdAt?: string }>(arr: T[]) =>
        [...arr].sort((a, b) => {
          const sA = Number.isFinite(Number(a.sequenceOrder)) ? Number(a.sequenceOrder) : Number.MAX_SAFE_INTEGER;
          const sB = Number.isFinite(Number(b.sequenceOrder)) ? Number(b.sequenceOrder) : Number.MAX_SAFE_INTEGER;
          if (sA !== sB) return sA - sB;
          return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        });

      const dueOrders = sortFifo(allOrders.filter(isItemEligible));
      const duePayments = sortFifo(allPayments.filter(isItemEligible));
      const dueMovements = sortFifo(allMovements.filter(isItemEligible));

      if (dueOrders.length === 0 && duePayments.length === 0 && dueMovements.length === 0) {
        const futureRetries = [...allOrders, ...allPayments, ...allMovements]
          .filter((item) => item.syncStatus !== 'FAILED' && item.queueState !== 'FAILED')
          .map((item) => Number(item.nextRetryAt || 0))
          .filter((t) => t > now);
        const existingConflicts = await safeGetSyncConflicts();
        return {
          count: 0,
          failedCount: [...allOrders, ...allPayments, ...allMovements].filter(
            (i) => i.syncStatus === 'FAILED' || i.queueState === 'FAILED'
          ).length,
          pendingCount: allOrders.length + allPayments.length + allMovements.length,
          conflictsCount: existingConflicts.length,
          nextRetryAt: futureRetries.length > 0 ? Math.min(...futureRetries) : null,
        };
      }

      const updateOrderStateFn = getOptionalStorageFn<
        (id: string, patch: any) => Promise<OfflineOrderPayload | null>
      >('updateOfflineOrderSyncState');
      const updatePayStateFn = getOptionalStorageFn<
        (id: string, patch: any) => Promise<OfflinePaymentPayload | null>
      >('updateOfflinePaymentSyncState');
      const updateMovStateFn = getOptionalStorageFn<
        (id: string, patch: any) => Promise<OfflineCashMovementPayload | null>
      >('updateOfflineCashMovementSyncState');
      const deletePayFn = getOptionalStorageFn<(id: string) => Promise<void>>('deleteOfflinePayment');
      const deleteMovFn = getOptionalStorageFn<(id: string) => Promise<void>>('deleteOfflineCashMovement');
      const saveConflictFn = getOptionalStorageFn<(c: SyncConflictRecord) => Promise<void>>('saveSyncConflict');
      const removeConflictFn = getOptionalStorageFn<(id: string) => Promise<void>>('removeSyncConflict');
      const appendHistoryFn = getOptionalStorageFn<(h: any) => Promise<void>>('appendSyncHistory');
      const deviceIdFn = getOptionalStorageFn<() => string>('getDeviceId');

      const nowIso = new Date().toISOString();
      if (updateOrderStateFn) {
        for (const ord of dueOrders) {
          await updateOrderStateFn(ord.offlineId, {
            syncStatus: 'PROCESSING',
            queueState: 'PROCESSING',
            lastAttemptAt: nowIso,
          });
        }
      }
      if (updatePayStateFn) {
        for (const pay of duePayments) {
          await updatePayStateFn(pay.offlinePaymentId, {
            syncStatus: 'PROCESSING',
            queueState: 'PROCESSING',
            lastAttemptAt: nowIso,
          });
        }
      }
      if (updateMovStateFn) {
        for (const mov of dueMovements) {
          await updateMovStateFn(mov.offlineMovementId, {
            syncStatus: 'PROCESSING',
            queueState: 'PROCESSING',
            lastAttemptAt: nowIso,
          });
        }
      }

      try {
        const bodyPayload: any = {
          offlineOrders: dueOrders,
          deviceId: deviceIdFn ? deviceIdFn() : undefined,
        };
        if (duePayments.length > 0) {
          bodyPayload.offlinePayments = duePayments;
        }
        if (dueMovements.length > 0) {
          bodyPayload.offlineCashMovements = dueMovements;
        }

        const res = await request<any>('/sync/batch', {
          method: 'POST',
          body: JSON.stringify(bodyPayload),
        });

        const syncedOrderIds = new Set<string>(Array.isArray(res?.syncedIds) ? res.syncedIds : []);
        const syncedPayIds = new Set<string>(
          Array.isArray(res?.syncedPaymentIds) ? res.syncedPaymentIds : []
        );
        const syncedMovIds = new Set<string>(
          Array.isArray(res?.syncedCashMovementIds) ? res.syncedCashMovementIds : []
        );
        const resultMap = new Map<string, any>(
          (Array.isArray(res?.results) ? res.results : []).map((r: any) => [r.offlineId, r])
        );
        const failedOrderMap = new Map<string, any>(
          (Array.isArray(res?.failedOrders) ? res.failedOrders : []).map((f: any) => [f.offlineId, f])
        );
        const failedPayMap = new Map<string, any>(
          (Array.isArray(res?.failedPayments) ? res.failedPayments : []).map((f: any) => [
            f.offlinePaymentId,
            f,
          ])
        );
        const failedMovMap = new Map<string, any>(
          (Array.isArray(res?.failedCashMovements) ? res.failedCashMovements : []).map((f: any) => [
            f.offlineMovementId,
            f,
          ])
        );
        const serverConflictByOfflineId = new Map<string, any>(
          (Array.isArray(res?.conflicts) ? res.conflicts : []).map((c: any) => [c.offlineId, c])
        );

        let ackedCount = 0;
        let failedCount = 0;

        // Only delete queued orders after explicit server acknowledgment
        for (const ord of dueOrders) {
          const ackKey = ord.offlineId || ord.idempotencyKey;
          if (syncedOrderIds.has(ord.offlineId) || (ackKey && syncedOrderIds.has(ackKey))) {
            const syncMeta = resultMap.get(ord.offlineId) || resultMap.get(ackKey);
            await offlineStorage.deleteOfflineOrder(ord.offlineId);
            if (removeConflictFn) {
              await removeConflictFn(ord.offlineId);
            }
            if (appendHistoryFn) {
              await appendHistoryFn({
                operationId: ord.operationId || ord.offlineId,
                entityType: 'ORDER',
                localRef: `BON-OFF-${ord.offlineId.slice(-4)}`,
                serverOrderNumber: syncMeta?.orderNumber || null,
                total: Number(ord.total || 0),
                deduplicated: Boolean(syncMeta?.deduplicated),
                queueState: 'SYNCED',
                syncedAt: new Date().toISOString(),
              });
            }
            ackedCount++;
          } else {
            failedCount++;
            const failInfo = failedOrderMap.get(ord.offlineId) || failedOrderMap.get(ackKey);
            const serverConf = serverConflictByOfflineId.get(ord.offlineId);
            const prevRetries = Number(ord.retryCount || 0);
            const maxRetries = Number(ord.maxRetries || 5);
            const nextRetries = prevRetries + 1;
            const permanentlyFailed =
              failInfo?.retryable === false || Boolean(failInfo?.conflictType) || nextRetries >= maxRetries;
            const nextRetry = Date.now() + computeBackoffMs(prevRetries, baseBackoffMs);

            if (updateOrderStateFn) {
              await updateOrderStateFn(ord.offlineId, {
                syncStatus: permanentlyFailed ? 'FAILED' : 'PENDING',
                queueState: permanentlyFailed ? 'FAILED' : 'RETRY_WAIT',
                retryCount: nextRetries,
                nextRetryAt: nextRetry,
                lastError: failInfo?.error || 'لم يتم تأكيد المزامنة من الخادم',
                conflictType: failInfo?.conflictType || serverConf?.conflictType || null,
                serverSnapshot: failInfo?.serverSnapshot || serverConf?.serverSnapshot || null,
              });
            }

            if (saveConflictFn && (failInfo?.conflictType || serverConf)) {
              await saveConflictFn({
                conflictId: ord.offlineId,
                serverConflictId: serverConf?.id,
                operationId: ord.operationId || ord.offlineId,
                offlineId: ord.offlineId,
                entityType: 'ORDER',
                conflictType: failInfo?.conflictType || serverConf?.conflictType,
                message: failInfo?.error || serverConf?.message || 'تعارض أثناء المزامنة',
                serverSnapshot: failInfo?.serverSnapshot || serverConf?.serverSnapshot,
                orderSummary: {
                  type: ord.type,
                  tableNumber: ord.tableNumber,
                  total: ord.total,
                  itemsCount: ord.items?.length || 0,
                },
                createdAt: new Date().toISOString(),
              });
            }
          }
        }

        // Only delete queued payments after explicit server acknowledgment
        for (const pay of duePayments) {
          if (syncedPayIds.has(pay.offlinePaymentId)) {
            if (deletePayFn) {
              await deletePayFn(pay.offlinePaymentId);
            }
            if (appendHistoryFn) {
              await appendHistoryFn({
                operationId: pay.operationId || pay.offlinePaymentId,
                entityType: 'PAYMENT',
                localRef: pay.orderNumber || `#${pay.orderId}`,
                serverOrderNumber: pay.orderNumber || null,
                total: (pay.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0),
                queueState: 'SYNCED',
                syncedAt: new Date().toISOString(),
              });
            }
            ackedCount++;
          } else {
            failedCount++;
            const failInfo = failedPayMap.get(pay.offlinePaymentId);
            const prevRetries = Number(pay.retryCount || 0);
            const maxRetries = Number(pay.maxRetries || 5);
            const nextRetries = prevRetries + 1;
            const permanentlyFailed = failInfo?.retryable === false || nextRetries >= maxRetries;
            const nextRetry = Date.now() + computeBackoffMs(prevRetries, baseBackoffMs);
            if (updatePayStateFn) {
              await updatePayStateFn(pay.offlinePaymentId, {
                syncStatus: permanentlyFailed ? 'FAILED' : 'PENDING',
                queueState: permanentlyFailed ? 'FAILED' : 'RETRY_WAIT',
                retryCount: nextRetries,
                nextRetryAt: nextRetry,
                lastError: failInfo?.error || 'لم يتم تأكيد مزامنة الدفعة من الخادم',
              });
            }
          }
        }

        // Only delete queued cash movements after explicit server acknowledgment
        for (const mov of dueMovements) {
          if (syncedMovIds.has(mov.offlineMovementId)) {
            if (deleteMovFn) {
              await deleteMovFn(mov.offlineMovementId);
            }
            if (appendHistoryFn) {
              await appendHistoryFn({
                operationId: mov.operationId || mov.offlineMovementId,
                entityType: 'CASH_MOVEMENT',
                localRef: `${mov.type}`,
                total: Number(mov.amount || 0),
                queueState: 'SYNCED',
                syncedAt: new Date().toISOString(),
              });
            }
            ackedCount++;
          } else {
            failedCount++;
            const failInfo = failedMovMap.get(mov.offlineMovementId);
            const prevRetries = Number(mov.retryCount || 0);
            const maxRetries = Number(mov.maxRetries || 5);
            const nextRetries = prevRetries + 1;
            const permanentlyFailed = failInfo?.retryable === false || nextRetries >= maxRetries;
            const nextRetry = Date.now() + computeBackoffMs(prevRetries, baseBackoffMs);
            if (updateMovStateFn) {
              await updateMovStateFn(mov.offlineMovementId, {
                syncStatus: permanentlyFailed ? 'FAILED' : 'PENDING',
                queueState: permanentlyFailed ? 'FAILED' : 'RETRY_WAIT',
                retryCount: nextRetries,
                nextRetryAt: nextRetry,
                lastError: failInfo?.error || 'فشل مزامنة حركة الصندوق',
              });
            }
          }
        }

        const [remainingOrders, remainingPayments, remainingMovements, remainingConflicts] =
          await Promise.all([
            offlineStorage.getOfflineOrders(),
            safeGetOfflinePayments(),
            safeGetOfflineCashMovements(),
            safeGetSyncConflicts(),
          ]);

        const futureRetries = [...remainingOrders, ...remainingPayments, ...remainingMovements]
          .filter((item) => item.syncStatus !== 'FAILED' && item.queueState !== 'FAILED')
          .map((item) => Number(item.nextRetryAt || 0))
          .filter((t) => t > Date.now());

        return {
          count: ackedCount,
          failedCount,
          pendingCount:
            remainingOrders.length + remainingPayments.length + remainingMovements.length,
          conflictsCount: remainingConflicts.length,
          nextRetryAt: futureRetries.length > 0 ? Math.min(...futureRetries) : null,
        };
      } catch (err: any) {
        // Network interruption / server restart / 5xx: NEVER delete queued items; revert PROCESSING -> PENDING/RETRY_WAIT with backoff
        const errMsg = err?.message || 'انقطع الاتصال أثناء المزامنة';
        let earliestRetry: number | null = null;

        for (const ord of dueOrders) {
          const prevRetries = Number(ord.retryCount || 0);
          const nextRetries = prevRetries + 1;
          const nextRetry = Date.now() + computeBackoffMs(prevRetries, baseBackoffMs);
          if (earliestRetry === null || nextRetry < earliestRetry) earliestRetry = nextRetry;
          if (updateOrderStateFn) {
            await updateOrderStateFn(ord.offlineId, {
              syncStatus: 'PENDING',
              queueState: 'RETRY_WAIT',
              retryCount: nextRetries,
              nextRetryAt: nextRetry,
              lastError: errMsg,
            });
          }
        }

        for (const pay of duePayments) {
          const prevRetries = Number(pay.retryCount || 0);
          const nextRetries = prevRetries + 1;
          const nextRetry = Date.now() + computeBackoffMs(prevRetries, baseBackoffMs);
          if (earliestRetry === null || nextRetry < earliestRetry) earliestRetry = nextRetry;
          if (updatePayStateFn) {
            await updatePayStateFn(pay.offlinePaymentId, {
              syncStatus: 'PENDING',
              queueState: 'RETRY_WAIT',
              retryCount: nextRetries,
              nextRetryAt: nextRetry,
              lastError: errMsg,
            });
          }
        }

        for (const mov of dueMovements) {
          const prevRetries = Number(mov.retryCount || 0);
          const nextRetries = prevRetries + 1;
          const nextRetry = Date.now() + computeBackoffMs(prevRetries, baseBackoffMs);
          if (earliestRetry === null || nextRetry < earliestRetry) earliestRetry = nextRetry;
          if (updateMovStateFn) {
            await updateMovStateFn(mov.offlineMovementId, {
              syncStatus: 'PENDING',
              queueState: 'RETRY_WAIT',
              retryCount: nextRetries,
              nextRetryAt: nextRetry,
              lastError: errMsg,
            });
          }
        }

        return {
          count: 0,
          failedCount: dueOrders.length + duePayments.length + dueMovements.length,
          pendingCount: allOrders.length + allPayments.length + allMovements.length,
          nextRetryAt: earliestRetry,
          error: errMsg,
        };
      }
    })();

    try {
      return await activeSyncPromise;
    } finally {
      activeSyncPromise = null;
    }
  },
};
