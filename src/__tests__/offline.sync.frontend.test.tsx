// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import * as offlineStorage from '../services/offlineStorage.ts';
import { api, computeBackoffMs, setAuthToken } from '../services/api.ts';
import { AuthProvider } from '../context/AuthContext.tsx';
import { LanguageProvider } from '../context/LanguageContext.tsx';
import { PosProvider } from '../context/PosContext.tsx';
import { OrdersView } from '../components/OrdersView.tsx';
import { PaymentModal } from '../components/PaymentModal.tsx';
import { Header } from '../components/Header.tsx';

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAuthAndShiftFetchMock(extraHandler?: (url: string, init?: RequestInit) => Promise<Response> | Response | null) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (extraHandler) {
      const handled = await extraHandler(url, init);
      if (handled) return handled;
    }
    if (url === '/api/auth/me') {
      return jsonRes({
        user: {
          id: 1,
          uid: 'admin-1',
          username: 'admin',
          email: 'admin@goldenpalace.dz',
          fullName: 'المدير العام',
          role: 'ADMIN',
        },
      });
    }
    if (url.startsWith('/api/cash-register/current')) {
      return jsonRes({
        isOpen: true,
        shift: { id: 1, shiftNumber: '1', status: 'OPEN', openingCash: 5000, totalCashSales: 0 },
      });
    }
    if (url.startsWith('/api/cashier/dashboard')) {
      return jsonRes({
        activeOrdersCount: 0,
        preparingOrdersCount: 0,
        readyOrdersCount: 0,
        heldOrdersCount: 0,
        shiftTotalSales: 0,
        shiftStatus: 'OPEN',
        shiftNumber: '1',
        expectedCash: 5000,
        tablesSummary: { total: 30, available: 30, occupied: 0, waitingPayment: 0 },
      });
    }
    if (url.startsWith('/api/settings')) {
      return jsonRes({ tax_rate: '0', currency: 'DA' });
    }
    if (url.startsWith('/api/orders')) {
      return jsonRes([]);
    }
    return jsonRes({});
  });
}

describe('Golden Palace POS — Offline-First Sync, Exponential Backoff & Split Payment Tests (Frontend)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    setAuthToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZXhwIjo0MTAyNDQ0ODAwfQ.sig');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('queues offline orders & split payments on network loss and displays them in OrdersView until server confirmation', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    vi.stubGlobal('fetch', createAuthAndShiftFetchMock());

    const created = await api.createOrder({
      type: 'TAKEAWAY',
      items: [{ productId: 101, nameAr: 'طاجين ملكي', nameFr: 'Tajine Royal', unitPrice: 1500, quantity: 1 }],
      subtotal: 1500,
      total: 1500,
    });

    expect(created.offline).toBe(true);
    expect(created.offlineId).toBeTruthy();

    // Pay with split methods (CASH + CARD + BARIDIMOB) while offline
    const payRes = await api.processPayment({
      orderId: created.id,
      offlineId: created.offlineId,
      payments: [
        { method: 'CASH', amount: 700, tenderAmount: 1000, changeAmount: 300 },
        { method: 'CARD', amount: 500, tenderAmount: 500, changeAmount: 0 },
        { method: 'BARIDIMOB', amount: 300, tenderAmount: 300, changeAmount: 0 },
      ],
      idempotencyKey: 'pay-split-off-1',
    });

    expect(payRes.offline).toBe(true);
    expect(payRes.paymentStatus).toBe('PAID');
    expect(payRes.paidAmount).toBe(1500);
    expect(payRes.payments).toHaveLength(3);

    const queued = await offlineStorage.getOfflineOrders();
    expect(queued).toHaveLength(1);
    expect(queued[0].payments).toHaveLength(3);
    expect(queued[0].paymentMethod).toBe('MIXED');

    // Render Header + OrdersView and assert pending offline order card is visible
    render(
      <LanguageProvider>
        <AuthProvider>
          <PosProvider>
            <Header onOpenCashRegisterModal={() => {}} onOpenHeldOrdersModal={() => {}} />
            <OrdersView onOpenInPos={() => {}} onPayOrder={() => {}} />
          </PosProvider>
        </AuthProvider>
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId(`offline-order-card-${created.offlineId}`)).toBeInTheDocument();
      expect(screen.getByTestId('offline-queue-banner')).toBeInTheDocument();
      expect(screen.getByTestId('header-sync-btn')).toHaveTextContent('1');
    });

    const card = screen.getByTestId(`offline-order-card-${created.offlineId}`);
    expect(card).toHaveTextContent('بانتظار المزامنة');
    expect(card).toHaveTextContent('CASH:700');
    expect(card).toHaveTextContent('CARD:500');
    expect(card).toHaveTextContent('BARIDIMOB:300');
  });

  it('queues order when fetch fails with network TypeError even while navigator.onLine is true', async () => {
    vi.stubGlobal(
      'fetch',
      createAuthAndShiftFetchMock((url, init) => {
        if (url === '/api/orders' && init?.method === 'POST') {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return null;
      })
    );

    const created = await api.createOrder({
      type: 'DINE_IN',
      tableId: 3,
      tableNumber: '3',
      items: [{ productId: 102, nameAr: 'كسكس', unitPrice: 1200, quantity: 1 }],
      subtotal: 1200,
      total: 1200,
    });

    expect(created.offline).toBe(true);
    const queued = await offlineStorage.getOfflineOrders();
    expect(queued).toHaveLength(1);
    expect(queued[0].tableNumber).toBe('3');
  });

  it('never deletes queued orders on failed/interrupted sync, recovers SYNCING state, and applies exponential backoff', async () => {
    // Save an order stuck in SYNCING (as if browser refreshed / crashed mid-sync)
    await offlineStorage.saveOfflineOrder({
      offlineId: 'off-interrupted-1',
      type: 'TAKEAWAY',
      items: [{ productId: 1, nameAr: 'شاورما', unitPrice: 600, quantity: 1 }],
      subtotal: 600,
      discount: 0,
      deliveryFee: 0,
      total: 600,
      paidAmount: 600,
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      payments: [{ method: 'CASH', amount: 600, tenderAmount: 600, changeAmount: 0 }],
      idempotencyKey: 'ord-off-interrupted-1',
      createdAt: new Date().toISOString(),
      syncStatus: 'SYNCING',
      retryCount: 0,
      nextRetryAt: 0,
    });

    // Simulate /sync/batch dropping connection
    const fetchMock = createAuthAndShiftFetchMock((url) => {
      if (url === '/api/sync/batch') {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return null;
    });
    vi.stubGlobal('fetch', fetchMock);

    // Backoff curve checks: 2s -> 4s -> 8s -> 16s -> capped at 60s
    expect(computeBackoffMs(0)).toBe(2000);
    expect(computeBackoffMs(1)).toBe(4000);
    expect(computeBackoffMs(2)).toBe(8000);
    expect(computeBackoffMs(10)).toBe(60000);

    const firstAttempt = await api.syncOfflineQueue({ baseBackoffMs: 1000 });
    expect(firstAttempt.count).toBe(0);
    expect(firstAttempt.failedCount).toBe(1);
    expect(firstAttempt.nextRetryAt).toBeGreaterThan(Date.now());

    // Order MUST still be present, reverted to PENDING, with retryCount = 1
    let queue = await offlineStorage.getOfflineOrders();
    expect(queue).toHaveLength(1);
    expect(queue[0].syncStatus).toBe('PENDING');
    expect(queue[0].retryCount).toBe(1);

    // Before backoff window expires, non-forced syncOfflineQueue skips duplicate hammering
    const skipped = await api.syncOfflineQueue({ force: false, baseBackoffMs: 1000 });
    expect(skipped.count).toBe(0);
    const syncCallsBeforeWait = fetchMock.mock.calls.filter(([u]) => u === '/api/sync/batch').length;
    expect(syncCallsBeforeWait).toBe(1);

    // Force retry succeeds when server recovers
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/sync/batch') {
        return jsonRes({ syncedIds: ['off-interrupted-1'], failedOrders: [] });
      }
      return jsonRes({});
    });

    const recoveredAttempt = await api.syncOfflineQueue({ force: true });
    expect(recoveredAttempt.count).toBe(1);
    queue = await offlineStorage.getOfflineOrders();
    expect(queue).toHaveLength(0);
  });

  it('deletes only server-acknowledged items on partial batch failure and keeps single-flight sync on reconnect burst', async () => {
    await offlineStorage.saveOfflineOrder({
      offlineId: 'off-ok-1',
      type: 'TAKEAWAY',
      items: [{ productId: 1, nameAr: 'طاجين', unitPrice: 1000, quantity: 1 }],
      subtotal: 1000,
      discount: 0,
      deliveryFee: 0,
      total: 1000,
      paidAmount: 0,
      paymentStatus: 'UNPAID',
      idempotencyKey: 'ord-off-ok-1',
      createdAt: new Date().toISOString(),
    });
    await offlineStorage.saveOfflineOrder({
      offlineId: 'off-bad-2',
      type: 'TAKEAWAY',
      items: [{ productId: 99999, nameAr: 'غير متوفر', unitPrice: 500, quantity: 1 }],
      subtotal: 500,
      discount: 0,
      deliveryFee: 0,
      total: 500,
      paidAmount: 0,
      paymentStatus: 'UNPAID',
      idempotencyKey: 'ord-off-bad-2',
      createdAt: new Date().toISOString(),
    });

    let batchCalls = 0;
    let resolveDelayedBatch: ((r: Response) => void) | null = null;

    vi.stubGlobal(
      'fetch',
      createAuthAndShiftFetchMock((url) => {
        if (url === '/api/sync/batch') {
          batchCalls++;
          return new Promise<Response>((resolve) => {
            resolveDelayedBatch = resolve;
          });
        }
        return null;
      })
    );

    // Trigger 2 concurrent sync calls (single-flight lock must coalesce into 1 HTTP request)
    const p1 = api.syncOfflineQueue({ force: true });
    const p2 = api.syncOfflineQueue({ force: true });

    await waitFor(() => expect(batchCalls).toBe(1));

    resolveDelayedBatch!(
      jsonRes({
        success: false,
        syncedIds: ['off-ok-1'],
        failedOrders: [{ offlineId: 'off-bad-2', error: 'المنتج غير موجود', retryable: false }],
      })
    );

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.count).toBe(1);
    expect(r2.count).toBe(1);
    expect(batchCalls).toBe(1);

    const remaining = await offlineStorage.getOfflineOrders();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].offlineId).toBe('off-bad-2');
    expect(remaining[0].syncStatus).toBe('FAILED');
    expect(remaining[0].lastError).toBe('المنتج غير موجود');
  });

  it('automatically syncs on online reconnection event and clears OrdersView pending cards', async () => {
    await offlineStorage.saveOfflineOrder({
      offlineId: 'off-recon-1',
      type: 'TAKEAWAY',
      items: [{ productId: 1, nameAr: 'مشاوي', unitPrice: 1800, quantity: 1 }],
      subtotal: 1800,
      discount: 0,
      deliveryFee: 0,
      total: 1800,
      paidAmount: 1800,
      paymentStatus: 'PAID',
      paymentMethod: 'CARD',
      payments: [{ method: 'CARD', amount: 1800, tenderAmount: 1800, changeAmount: 0 }],
      idempotencyKey: 'ord-off-recon-1',
      createdAt: new Date().toISOString(),
    });

    const fetchMock = createAuthAndShiftFetchMock((url) => {
      if (url === '/api/sync/batch') {
        return jsonRes({ syncedIds: ['off-recon-1'], failedOrders: [] });
      }
      return null;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LanguageProvider>
        <AuthProvider>
          <PosProvider>
            <OrdersView onOpenInPos={() => {}} onPayOrder={() => {}} />
          </PosProvider>
        </AuthProvider>
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('offline-order-card-off-recon-1')).toBeInTheDocument();
    });

    await act(async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(async () => {
      const q = await offlineStorage.getOfflineOrders();
      expect(q).toHaveLength(0);
      expect(screen.queryByTestId('offline-order-card-off-recon-1')).not.toBeInTheDocument();
    });
  });

  it('queues offline split payments from PaymentModal for existing online orders during outage', async () => {
    vi.stubGlobal('fetch', createAuthAndShiftFetchMock());

    const existingOrder: any = {
      id: 42,
      orderNumber: 'BON-0042',
      dailySequence: 42,
      type: 'TAKEAWAY',
      status: 'CONFIRMED',
      subtotal: 1500,
      discount: 0,
      deliveryFee: 0,
      total: 1500,
      paidAmount: 0,
      changeAmount: 0,
      paymentStatus: 'UNPAID',
      isHeld: false,
      createdAt: new Date().toISOString(),
      items: [{ id: 1, orderId: 42, productId: 10, nameAr: 'طاجين', unitPrice: 1500, quantity: 1, total: 1500 }],
    };

    const onSuccess = vi.fn();
    const onClose = vi.fn();

    const { usePos } = await import('../context/PosContext.tsx');
    const ShiftInitializer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
      const { refreshShift } = usePos();
      React.useEffect(() => {
        refreshShift();
      }, [refreshShift]);
      return <>{children}</>;
    };

    render(
      <LanguageProvider>
        <AuthProvider>
          <PosProvider>
            <ShiftInitializer>
              <PaymentModal
                isOpen={true}
                existingOrder={existingOrder}
                onClose={onClose}
                onSuccess={onSuccess}
              />
            </ShiftInitializer>
          </PosProvider>
        </AuthProvider>
      </LanguageProvider>
    );

    // Wait for open shift to load before simulating sudden network outage
    await waitFor(() => {
      expect(screen.getByTestId('confirm-payment-btn')).not.toBeDisabled();
    });

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    // Enable split mode and add CASH (1000 DA) + BARIDIMOB (500 DA)
    fireEvent.click(screen.getByTestId('split-payment-toggle'));
    fireEvent.change(screen.getByTestId('split-amount-input'), { target: { value: '1000' } });
    fireEvent.click(screen.getByTestId('add-split-leg-btn'));

    fireEvent.click(screen.getByTestId('pay-method-BARIDIMOB'));
    fireEvent.click(screen.getByTestId('add-split-leg-btn'));

    expect(screen.getByTestId('split-leg-CASH')).toBeInTheDocument();
    expect(screen.getByTestId('split-leg-BARIDIMOB')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-payment-btn'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    const queuedPays = await offlineStorage.getOfflinePayments();
    expect(queuedPays).toHaveLength(1);
    expect(queuedPays[0].orderId).toBe(42);
    expect(queuedPays[0].payments).toHaveLength(2);
    expect(queuedPays[0].payments.map((p) => p.method)).toEqual(['CASH', 'BARIDIMOB']);
  });
});
