import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  CartItem,
  Product,
  ProductVariant,
  ProductAddon,
  RestaurantTable,
  Customer,
  CashShift,
  CashierDashboardMetrics,
} from '../types.ts';
import {
  api,
  getAuthToken,
  SyncQueueResult,
  safeGetOfflinePayments,
  safeGetOfflineCashMovements,
  safeGetSyncConflicts,
  safeGetSyncHistory,
  safeRemoveSyncConflict,
  safeDeleteOfflinePayment,
  safeDeleteOfflineCashMovement,
  safeRecoverInterruptedSyncs,
} from '../services/api.ts';
import * as offlineStorage from '../services/offlineStorage.ts';
import type {
  OfflineOrderPayload,
  OfflinePaymentPayload,
  OfflineCashMovementPayload,
  SyncConflictRecord,
  SyncConflictResolution,
  SyncHistoryEntry,
} from '../services/offlineStorage.ts';
import { printerService } from '../services/printerService.ts';
import { useAuth } from './AuthContext.tsx';
import { useLanguage } from './LanguageContext.tsx';

export interface SyncQueueSnapshot {
  orders: OfflineOrderPayload[];
  payments: OfflinePaymentPayload[];
  cashMovements: OfflineCashMovementPayload[];
}

interface PosContextType {
  cart: CartItem[];
  activeOrderId: number | null;
  activeOrderNumber: string | null;
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  selectedTable: RestaurantTable | null;
  selectedCustomer: Customer | null;
  selectedWaiter: string;
  discount: number;
  deliveryFee: number;
  deliveryAddress: string;
  notes: string;
  taxRate: number;
  taxAmount: number;
  settings: Record<string, string>;
  currentShift: CashShift | null;
  isShiftOpen: boolean;
  dashboardMetrics: CashierDashboardMetrics | null;
  subtotal: number;
  total: number;
  heldOrdersCount: number;
  isOnline: boolean;
  isNavigatorOnline: boolean;
  isServerReachable: boolean;
  lastSyncAt: string | null;
  lastHealthCheckAt: string | null;
  offlineOrdersCount: number;
  failedSyncCount: number;
  conflictsCount: number;
  syncQueueItems: SyncQueueSnapshot;
  syncConflicts: SyncConflictRecord[];
  syncHistory: SyncHistoryEntry[];
  isSyncingOffline: boolean;
  receiptToPrint: any | null;

  // Actions
  setOrderType: (type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY') => void;
  setSelectedTable: (table: RestaurantTable | null) => void;
  setSelectedCustomer: (customer: Customer | null) => void;
  setSelectedWaiter: (waiter: string) => void;
  setDiscount: (discount: number) => void;
  setDeliveryFee: (fee: number) => void;
  setDeliveryAddress: (address: string) => void;
  setNotes: (notes: string) => void;
  setActiveOrderId: (id: number | null, orderNumber?: string | null) => void;
  addToCart: (product: Product, variant?: ProductVariant, addons?: ProductAddon[], quantity?: number) => void;
  updateCartItemQuantity: (id: string, delta: number) => void;
  setCartItemQuantity: (id: string, qty: number) => void;
  setCartItemPrice: (id: string, newPrice: number, reason?: string) => void;
  setCartItemNotes: (id: string, notes: string) => void;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  loadHeldOrderIntoCart: (order: any) => void;
  loadActiveOrderIntoCart: (order: any) => void;
  refreshShift: () => Promise<void>;
  refreshHeldOrders: () => Promise<void>;
  refreshDashboard: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshOfflineCount: () => Promise<void>;
  catalogVersion: number;
  refreshCatalog: () => Promise<void>;
  checkConnectionNow: () => Promise<boolean>;
  triggerSync: (force?: boolean, includeFailed?: boolean) => Promise<SyncQueueResult>;
  retrySyncItem: (entityType: 'ORDER' | 'PAYMENT' | 'CASH_MOVEMENT', id: string) => Promise<SyncQueueResult>;
  resolveSyncConflict: (
    offlineId: string,
    resolution: SyncConflictResolution,
    serverConflictId?: number
  ) => Promise<SyncQueueResult>;
  discardFailedSyncItem: (
    entityType: 'ORDER' | 'PAYMENT' | 'CASH_MOVEMENT',
    id: string,
    serverConflictId?: number
  ) => Promise<void>;
  setReceiptToPrint: (receipt: any | null) => void;
  openCashDrawer: () => void;
}

const PosContext = createContext<PosContextType | undefined>(undefined);

export const PosProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeOrderId, setActiveOrderIdState] = useState<number | null>(null);
  const [activeOrderNumber, setActiveOrderNumber] = useState<string | null>(null);
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>('DINE_IN');
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedWaiter, setSelectedWaiter] = useState<string>('المدير العام');
  const [discount, setDiscount] = useState<number>(0);
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [taxRate, setTaxRate] = useState<number>(0);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [catalogVersion, setCatalogVersion] = useState<number>(0);

  const refreshCatalog = useCallback(async () => {
    setCatalogVersion((v) => v + 1);
  }, []);

  const [currentShift, setCurrentShift] = useState<CashShift | null>(null);
  const [isShiftOpen, setIsShiftOpen] = useState<boolean>(false);
  const [dashboardMetrics, setDashboardMetrics] = useState<CashierDashboardMetrics | null>(null);
  const [heldOrdersCount, setHeldOrdersCount] = useState<number>(0);
  const [isNavigatorOnline, setIsNavigatorOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isServerReachable, setIsServerReachable] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastHealthCheckAt, setLastHealthCheckAt] = useState<string | null>(null);
  const [offlineOrdersCount, setOfflineOrdersCount] = useState<number>(0);
  const [failedSyncCount, setFailedSyncCount] = useState<number>(0);
  const [conflictsCount, setConflictsCount] = useState<number>(0);
  const [syncQueueItems, setSyncQueueItems] = useState<SyncQueueSnapshot>({
    orders: [],
    payments: [],
    cashMovements: [],
  });
  const [syncConflicts, setSyncConflicts] = useState<SyncConflictRecord[]>([]);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[]>([]);
  const [isSyncingOffline, setIsSyncingOffline] = useState<boolean>(false);
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasUnreachableRef = React.useRef<boolean>(false);
  const healthProbeFailedRef = React.useRef<boolean>(false);
  const { user, isLoading: isAuthLoading, isLocked } = useAuth();
  const { applyDefaultLanguage } = useLanguage();
  const canAccessProtectedApi = !isAuthLoading && Boolean(user) && !isLocked && Boolean(getAuthToken());

  const [receiptToPrint, setReceiptToPrint] = useState<any | null>(null);
  const prevUserIdRef = React.useRef<number | null>(null);

  const isOnline = isNavigatorOnline && isServerReachable;

  const refreshOfflineCount = useCallback(async () => {
    const [ordersList, paymentsList, movementsList, conflictsList, historyList] = await Promise.all([
      offlineStorage.getOfflineOrders().catch(() => []),
      safeGetOfflinePayments(),
      safeGetOfflineCashMovements(),
      safeGetSyncConflicts(),
      safeGetSyncHistory(),
    ]);
    const totalPending = ordersList.length + paymentsList.length + movementsList.length;
    const failedTotal = [...ordersList, ...paymentsList, ...movementsList].filter(
      (i) => i.syncStatus === 'FAILED' || i.queueState === 'FAILED'
    ).length;

    setOfflineOrdersCount(totalPending);
    setFailedSyncCount(failedTotal);
    setConflictsCount(conflictsList.length);
    setSyncQueueItems({
      orders: ordersList,
      payments: paymentsList,
      cashMovements: movementsList,
    });
    setSyncConflicts(conflictsList);
    setSyncHistory(historyList);
  }, []);

  const refreshShift = useCallback(async () => {
    if (!canAccessProtectedApi) return;
    try {
      const res = await api.getCurrentShift();
      if (res?.isOpen && res?.shift) {
        setCurrentShift(res.shift);
        setIsShiftOpen(true);
      } else {
        setCurrentShift(null);
        setIsShiftOpen(false);
      }
    } catch {
      // Offline / unauthenticated fallback
    }
  }, [canAccessProtectedApi]);

  const refreshHeldOrders = useCallback(async () => {
    if (!canAccessProtectedApi) return;
    try {
      const list = await api.getOrders({ heldOnly: true });
      setHeldOrdersCount(Array.isArray(list) ? list.length : 0);
    } catch {
      // Ignore
    }
  }, [canAccessProtectedApi]);

  const refreshSettings = useCallback(async () => {
    if (!canAccessProtectedApi) return;
    try {
      const loaded = await api.getSettings();
      if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        setSettings(loaded);
        if (loaded.tax_rate !== undefined) {
          setTaxRate(Math.max(0, Number(loaded.tax_rate) || 0));
        }
        if (loaded.default_language) {
          applyDefaultLanguage(loaded.default_language);
        }
        printerService.applySettingsProfile(loaded);
      }
    } catch {
      // Ignore
    }
  }, [canAccessProtectedApi]);

  const refreshDashboard = useCallback(async () => {
    if (!canAccessProtectedApi) return;
    try {
      const data = await api.getCashierDashboard();
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        setDashboardMetrics(data);
        if (typeof data.heldOrdersCount === 'number') {
          setHeldOrdersCount(data.heldOrdersCount);
        }
      }
    } catch {
      // Ignore
    }
    await refreshSettings();
  }, [canAccessProtectedApi, refreshSettings]);

  // Apply persisted settings automatically on startup/session restore regardless of user role
  useEffect(() => {
    if (canAccessProtectedApi) {
      refreshSettings();
    }
  }, [canAccessProtectedApi, refreshSettings]);

  const triggerSync = useCallback(
    async (force = false, includeFailed = false): Promise<SyncQueueResult> => {
      if (!canAccessProtectedApi) return { count: 0 };
      if (typeof navigator !== 'undefined' && !navigator.onLine) return { count: 0 };
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      setIsSyncingOffline(true);
      try {
        const res = await api.syncOfflineQueue({ force, includeFailed });
        await refreshOfflineCount();
        if (res.count > 0) {
          setLastSyncAt(new Date().toISOString());
          healthProbeFailedRef.current = false;
          setIsServerReachable(true);
          wasUnreachableRef.current = false;
          await refreshShift();
          await refreshDashboard();
        }
        if (
          res.nextRetryAt &&
          res.nextRetryAt > Date.now() &&
          (typeof navigator === 'undefined' || navigator.onLine)
        ) {
          const delay = Math.max(500, res.nextRetryAt - Date.now());
          retryTimerRef.current = setTimeout(() => {
            triggerSync(false);
          }, delay);
        }
        return res;
      } catch (err) {
        console.error('Offline sync failed:', err);
        return { count: 0 };
      } finally {
        setIsSyncingOffline(false);
      }
    },
    [canAccessProtectedApi, refreshOfflineCount, refreshShift, refreshDashboard]
  );

  const checkConnectionNow = useCallback(async (): Promise<boolean> => {
    const navUp = typeof navigator === 'undefined' || navigator.onLine;
    setIsNavigatorOnline(navUp);
    if (!navUp) {
      healthProbeFailedRef.current = true;
      setIsServerReachable(false);
      wasUnreachableRef.current = true;
      setLastHealthCheckAt(new Date().toISOString());
      return false;
    }

    const res = await api.checkHealth(3000);
    setLastHealthCheckAt(new Date().toISOString());
    if (res.reachable) {
      const recovered = wasUnreachableRef.current;
      wasUnreachableRef.current = false;
      healthProbeFailedRef.current = false;
      setIsServerReachable(true);
      if (recovered && canAccessProtectedApi) {
        const [ords, pays, movs] = await Promise.all([
          offlineStorage.getOfflineOrders().catch(() => []),
          safeGetOfflinePayments(),
          safeGetOfflineCashMovements(),
        ]);
        const hasPending = [...ords, ...pays, ...movs].some(
          (i) => i.syncStatus !== 'FAILED' && i.queueState !== 'FAILED'
        );
        if (hasPending) {
          triggerSync(true);
        }
      }
      return true;
    }

    healthProbeFailedRef.current = true;
    wasUnreachableRef.current = true;
    setIsServerReachable(false);
    return false;
  }, [canAccessProtectedApi, triggerSync]);

  const retrySyncItem = useCallback(
    async (entityType: 'ORDER' | 'PAYMENT' | 'CASH_MOVEMENT', id: string): Promise<SyncQueueResult> => {
      if (entityType === 'ORDER') {
        await offlineStorage.updateOfflineOrderSyncState(id, {
          syncStatus: 'PENDING',
          queueState: 'PENDING',
          nextRetryAt: 0,
          lastError: null,
        });
      } else if (entityType === 'PAYMENT') {
        await offlineStorage.updateOfflinePaymentSyncState(id, {
          syncStatus: 'PENDING',
          queueState: 'PENDING',
          nextRetryAt: 0,
          lastError: null,
        });
      } else {
        await offlineStorage.updateOfflineCashMovementSyncState(id, {
          syncStatus: 'PENDING',
          queueState: 'PENDING',
          nextRetryAt: 0,
          lastError: null,
        });
      }
      await refreshOfflineCount();
      return triggerSync(true, true);
    },
    [refreshOfflineCount, triggerSync]
  );

  const resolveSyncConflict = useCallback(
    async (
      offlineId: string,
      resolution: SyncConflictResolution,
      serverConflictId?: number
    ): Promise<SyncQueueResult> => {
      const ordersList = await offlineStorage.getOfflineOrders().catch(() => []);
      const target = ordersList.find((o) => o.offlineId === offlineId);
      if (target) {
        const patch: any = {
          syncStatus: 'PENDING',
          queueState: 'PENDING',
          nextRetryAt: 0,
          lastError: null,
          conflictType: null,
          conflictResolution: {
            ...resolution,
            resolvedAt: resolution.resolvedAt || new Date().toISOString(),
          },
        };

        const snapshot = target.serverSnapshot;
        if (resolution.action === 'CONVERT_TO_TAKEAWAY') {
          patch.type = 'TAKEAWAY';
          patch.tableId = null;
          patch.tableNumber = null;
        } else if (resolution.action === 'REASSIGN_TABLE' && resolution.newTableId) {
          patch.tableId = resolution.newTableId;
          const matchedTable = Array.isArray(snapshot?.availableTables)
            ? snapshot.availableTables.find((tb: any) => Number(tb.id) === Number(resolution.newTableId))
            : null;
          if (matchedTable?.tableNumber) {
            patch.tableNumber = matchedTable.tableNumber;
          }
        } else if (resolution.action === 'ACCEPT_SERVER_CATALOG') {
          const priceMap = new Map<number, number>();
          if (Array.isArray(snapshot?.priceDiffs)) {
            for (const d of snapshot.priceDiffs) {
              priceMap.set(Number(d.productId), Number(d.serverPrice));
            }
          }
          if (snapshot?.productId !== undefined && snapshot?.serverPrice !== undefined) {
            priceMap.set(Number(snapshot.productId), Number(snapshot.serverPrice));
          }

          const unavailableIds = new Set<number>();
          if (Array.isArray(snapshot?.unavailableProducts)) {
            for (const p of snapshot.unavailableProducts) {
              unavailableIds.add(Number(p.productId));
            }
          }
          if (snapshot?.productId !== undefined && snapshot?.isAvailable === false) {
            unavailableIds.add(Number(snapshot.productId));
          }

          const updatedItems = (target.items || [])
            .filter((it: any) => !unavailableIds.has(Number(it.productId)))
            .map((it: any) => {
              const srvPrice = priceMap.get(Number(it.productId));
              const unitPrice = srvPrice !== undefined ? srvPrice : Number(it.unitPrice);
              return {
                ...it,
                unitPrice,
                expectedCatalogPrice: unitPrice,
                total: unitPrice * Number(it.quantity),
              };
            });
          const newSub = updatedItems.reduce((s: number, it: any) => s + Number(it.total || 0), 0);
          const curTaxRate = Number(target.taxRate || 0);
          const taxableAmt = Math.max(0, newSub - Number(target.discount || 0));
          const newTaxAmt = Math.round(((taxableAmt * curTaxRate) / 100) * 100) / 100;
          patch.items = updatedItems;
          patch.subtotal = newSub;
          patch.taxAmount = newTaxAmt;
          patch.total = Math.max(0, taxableAmt + newTaxAmt + Number(target.deliveryFee || 0));
        } else if (resolution.action === 'ACCEPT_SERVER_TAX' && snapshot?.serverTaxRate !== undefined) {
          const newRate = Number(snapshot.serverTaxRate);
          const curSub = Number(target.subtotal || 0);
          const taxableAmt = Math.max(0, curSub - Number(target.discount || 0));
          const newTaxAmt = Math.round(((taxableAmt * newRate) / 100) * 100) / 100;
          patch.taxRate = newRate;
          patch.taxAmount = newTaxAmt;
          patch.total = Math.max(0, taxableAmt + newTaxAmt + Number(target.deliveryFee || 0));
        }

        await offlineStorage.updateOfflineOrderSyncState(offlineId, patch);
      }

      await safeRemoveSyncConflict(offlineId);
      if (serverConflictId) {
        await api.resolveServerSyncConflict(serverConflictId, resolution.action).catch(() => null);
      }
      await refreshOfflineCount();
      return triggerSync(true, true);
    },
    [refreshOfflineCount, triggerSync]
  );

  const discardFailedSyncItem = useCallback(
    async (
      entityType: 'ORDER' | 'PAYMENT' | 'CASH_MOVEMENT',
      id: string,
      serverConflictId?: number
    ): Promise<void> => {
      if (entityType === 'ORDER') {
        await offlineStorage.deleteOfflineOrder(id);
      } else if (entityType === 'PAYMENT') {
        await safeDeleteOfflinePayment(id);
      } else {
        await safeDeleteOfflineCashMovement(id);
      }
      await safeRemoveSyncConflict(id);
      if (serverConflictId) {
        await api.resolveServerSyncConflict(serverConflictId, 'DISCARD').catch(() => null);
      }
      await refreshOfflineCount();
    },
    [refreshOfflineCount]
  );

  // Recover interrupted syncs on session ready & run periodic /api/health probe
  useEffect(() => {
    if (!canAccessProtectedApi) return;
    safeRecoverInterruptedSyncs();
    checkConnectionNow();
    const interval = setInterval(() => {
      checkConnectionNow();
    }, 20000);
    return () => clearInterval(interval);
  }, [canAccessProtectedApi, checkConnectionNow]);

  useEffect(() => {
    const handleOnline = () => {
      setIsNavigatorOnline(true);
      healthProbeFailedRef.current = false;
      setIsServerReachable(true);
      wasUnreachableRef.current = false;
      triggerSync(true);
    };
    const handleOffline = () => {
      setIsNavigatorOnline(false);
      setIsServerReachable(false);
      wasUnreachableRef.current = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
    const handleServerUnreachable = () => {
      wasUnreachableRef.current = true;
      setIsServerReachable(false);
    };
    const handleServerReachable = () => {
      if (healthProbeFailedRef.current) return;
      setIsServerReachable(true);
      wasUnreachableRef.current = false;
    };
    const handleQueueUpdated = () => {
      refreshOfflineCount();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('pos:server-unreachable', handleServerUnreachable);
    window.addEventListener('pos:server-reachable', handleServerReachable);
    window.addEventListener('pos:offline-queue-updated', handleQueueUpdated);

    refreshOfflineCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('pos:server-unreachable', handleServerUnreachable);
      window.removeEventListener('pos:server-reachable', handleServerReachable);
      window.removeEventListener('pos:offline-queue-updated', handleQueueUpdated);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [triggerSync, refreshOfflineCount]);

  const setActiveOrderId = (id: number | null, orderNumber: string | null = null) => {
    setActiveOrderIdState(id);
    setActiveOrderNumber(orderNumber);
  };

  // Add item to cart
  const addToCart = (
    product: Product,
    variant?: ProductVariant,
    addons: ProductAddon[] = [],
    quantity: number = 1
  ) => {
    const basePrice = Number(product.price);
    const resolvedBaseWithVariant =
      variant && variant.price !== null && variant.price !== undefined
        ? Number(variant.price)
        : basePrice + (variant ? Number(variant.priceAdjustment) : 0);
    const addonsTotal = addons.reduce((sum, a) => sum + Number(a.price), 0);
    const unitPrice = resolvedBaseWithVariant + addonsTotal;

    const existingIndex = cart.findIndex((item) => {
      if (item.productId !== product.id) return false;
      const vMatch = (!item.selectedVariant && !variant) || item.selectedVariant?.id === variant?.id;
      const aMatch =
        (item.selectedAddons?.length || 0) === addons.length &&
        addons.every((a) => item.selectedAddons?.some((ia) => ia.id === a.id));
      return vMatch && aMatch;
    });

    if (existingIndex > -1) {
      const updated = [...cart];
      const newQty = updated[existingIndex].quantity + quantity;
      updated[existingIndex] = {
        ...updated[existingIndex],
        quantity: newQty,
        total: updated[existingIndex].unitPrice * newQty,
      };
      setCart(updated);
    } else {
      const newItem: CartItem = {
        id: `cart-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        productId: product.id,
        nameAr: product.nameAr,
        nameFr: product.nameFr,
        unitPrice,
        costPrice: Number(product.costPrice || 0),
        quantity,
        total: unitPrice * quantity,
        station: product.station,
        selectedVariant: variant,
        selectedAddons: addons,
      };
      setCart([...cart, newItem]);
    }
  };

  const updateCartItemQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty, total: item.unitPrice * newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const setCartItemQuantity = (id: string, qty: number) => {
    if (qty <= 0) {
      removeFromCart(id);
      return;
    }
    setCart((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity: qty, total: item.unitPrice * qty } : item))
    );
  };

  const setCartItemPrice = (id: string, newPrice: number, reason?: string) => {
    setCart((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              unitPrice: newPrice,
              total: newPrice * item.quantity,
              priceOverrideReason: reason ?? item.priceOverrideReason,
            }
          : item
      )
    );
  };

  const setCartItemNotes = (id: string, itemNotes: string) => {
    setCart((prev) => prev.map((item) => (item.id === id ? { ...item, notes: itemNotes } : item)));
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const clearCart = () => {
    setCart([]);
    setActiveOrderIdState(null);
    setActiveOrderNumber(null);
    setDiscount(0);
    setDeliveryFee(0);
    setDeliveryAddress('');
    setNotes('');
    setSelectedTable(null);
    setSelectedCustomer(null);
  };

  useEffect(() => {
    if (!isAuthLoading) {
      if (!user && prevUserIdRef.current !== null) {
        clearCart();
        setCurrentShift(null);
        setIsShiftOpen(false);
        setDashboardMetrics(null);
        setHeldOrdersCount(0);
        setReceiptToPrint(null);
      }
      prevUserIdRef.current = user?.id ?? null;
    }
  }, [isAuthLoading, user]);

  const loadActiveOrderIntoCart = (order: any) => {
    const loadedItems: CartItem[] = (order.items || []).map((it: any) => ({
      id: `cart-ord-${it.id}`,
      productId: it.productId,
      nameAr: it.nameAr,
      nameFr: it.nameFr,
      unitPrice: Number(it.unitPrice),
      costPrice: Number(it.costPrice || 0),
      quantity: Number(it.quantity),
      total: Number(it.total),
      station: it.station || 'MAIN_KITCHEN',
      notes: it.notes,
      priceOverrideReason: it.priceOverrideReason,
      selectedVariant: it.variantsJson ? JSON.parse(it.variantsJson) : undefined,
      selectedAddons: it.addonsJson ? JSON.parse(it.addonsJson) : undefined,
    }));

    setCart(loadedItems);
    setActiveOrderIdState(order.id || null);
    setActiveOrderNumber(order.orderNumber || null);
    setOrderType(order.type || 'DINE_IN');
    setDiscount(Number(order.discount) || 0);
    setDeliveryFee(Number(order.deliveryFee) || 0);
    setDeliveryAddress(order.deliveryAddress || order.delivery?.customerAddress || '');
    setNotes(order.notes || '');

    if (order.tableId) {
      setSelectedTable({
        id: order.tableId,
        tableNumber: order.tableNumber || order.table?.tableNumber || `${order.tableId}`,
        zone: order.zone || 'الصالة الرئيسية',
        capacity: 4,
        status: 'OCCUPIED',
        currentOrderId: order.id,
      });
    } else {
      setSelectedTable(null);
    }

    if (order.customerId) {
      setSelectedCustomer({
        id: order.customerId,
        name: order.customerName || order.customer?.name || 'زبون',
        phone: order.customerPhone || order.customer?.phone || '',
        totalOrders: 1,
        totalSpent: order.total,
      });
    } else {
      setSelectedCustomer(null);
    }

    refreshHeldOrders();
  };

  const loadHeldOrderIntoCart = (order: any) => {
    loadActiveOrderIntoCart(order);
  };

  const openCashDrawer = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    } catch {
      // Ignore audio errors
    }
  };

  const subtotal = cart.reduce((sum, item) => sum + item.total, 0);
  const taxable = Math.max(0, subtotal - discount);
  const taxAmount = Math.round(((taxable * taxRate) / 100) * 100) / 100;
  const total = Math.max(0, taxable + taxAmount + deliveryFee);

  return (
    <PosContext.Provider
      value={{
        cart,
        activeOrderId,
        activeOrderNumber,
        orderType,
        selectedTable,
        selectedCustomer,
        selectedWaiter,
        discount,
        deliveryFee,
        deliveryAddress,
        notes,
        taxRate,
        taxAmount,
        settings,
        currentShift,
        isShiftOpen,
        dashboardMetrics,
        subtotal,
        total,
        heldOrdersCount,
        isOnline,
        isNavigatorOnline,
        isServerReachable,
        lastSyncAt,
        lastHealthCheckAt,
        offlineOrdersCount,
        failedSyncCount,
        conflictsCount,
        syncQueueItems,
        syncConflicts,
        syncHistory,
        isSyncingOffline,
        receiptToPrint,
        setOrderType,
        setSelectedTable,
        setSelectedCustomer,
        setSelectedWaiter,
        setDiscount,
        setDeliveryFee,
        setDeliveryAddress,
        setNotes,
        setActiveOrderId,
        addToCart,
        updateCartItemQuantity,
        setCartItemQuantity,
        setCartItemPrice,
        setCartItemNotes,
        removeFromCart,
        clearCart,
        loadHeldOrderIntoCart,
        loadActiveOrderIntoCart,
        refreshShift,
        refreshHeldOrders,
        refreshDashboard,
        refreshSettings,
        refreshOfflineCount,
        catalogVersion,
        refreshCatalog,
        checkConnectionNow,
        triggerSync,
        retrySyncItem,
        resolveSyncConflict,
        discardFailedSyncItem,
        setReceiptToPrint,
        openCashDrawer,
      }}
    >
      {children}
    </PosContext.Provider>
  );
};

export const usePos = () => {
  const context = useContext(PosContext);
  if (!context) throw new Error('usePos must be used within PosProvider');
  return context;
};

export const useOptionalPos = () => useContext(PosContext);
