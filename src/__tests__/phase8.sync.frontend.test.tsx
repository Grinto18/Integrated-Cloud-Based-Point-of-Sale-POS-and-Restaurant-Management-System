// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import * as offlineStorage from '../services/offlineStorage.ts';
import { api, setAuthToken } from '../services/api.ts';
import { AuthProvider } from '../context/AuthContext.tsx';
import { LanguageProvider } from '../context/LanguageContext.tsx';
import { PosProvider, usePos } from '../context/PosContext.tsx';
import { Header } from '../components/Header.tsx';
import { SyncCenter } from '../components/SyncCenter.tsx';
import { CashRegisterModal } from '../components/CashRegisterModal.tsx';
import App from '../App.tsx';

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createFetchMock(
  role: 'ADMIN' | 'CASHIER' = 'ADMIN',
  extra?: (url: string, init?: RequestInit) => Promise<Response | null> | Response | null
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (extra) {
      const handled = await extra(url, init);
      if (handled) return handled;
    }
    if (url === '/api/health') {
      return jsonRes({ status: 'ok', db: 'connected' });
    }
    if (url === '/api/auth/me') {
      return jsonRes({
        user: {
          id: role === 'ADMIN' ? 1 : 2,
          uid: role === 'ADMIN' ? 'admin-1' : 'cashier-2',
          username: role === 'ADMIN' ? 'admin' : 'cashier',
          email: 'user@goldenpalace.dz',
          fullName: role === 'ADMIN' ? 'المدير العام' : 'كاشير الصالة',
          role,
        },
      });
    }
    if (url.startsWith('/api/cash-register/current')) {
      return jsonRes({
        isOpen: true,
        shift: {
          id: 1,
          shiftNumber: '1',
          status: 'OPEN',
          openingCash: 5000,
          totalCashSales: 0,
          expectedCash: 5000,
        },
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
    if (url.startsWith('/api/categories')) {
      return jsonRes([{ id: 1, nameAr: 'أطباق', nameFr: 'Plats', isActive: true }]);
    }
    if (url.startsWith('/api/products')) {
      return jsonRes([
        {
          id: 101,
          categoryId: 1,
          nameAr: 'طاجين ملكي',
          nameFr: 'Tajine Royal',
          price: 1500,
          isAvailable: true,
          station: 'MAIN_KITCHEN',
          variants: [],
          addons: [],
        },
      ]);
    }
    if (url.startsWith('/api/tables')) {
      return jsonRes([
        { id: 1, tableNumber: '1', zone: 'الصالة', capacity: 4, status: 'AVAILABLE' },
      ]);
    }
    if (url.startsWith('/api/orders')) {
      return jsonRes([]);
    }
    return jsonRes({});
  });
}

describe('Golden Palace POS — Phase 08 Offline & Sync Hardening (Frontend)', () => {
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

  it('queues orders and cash movements when Service Worker returns 503 { offline: true }', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock('ADMIN', (url, init) => {
        if ((url === '/api/orders' || url === '/api/cash-register/movement') && init?.method === 'POST') {
          return jsonRes({ error: 'Offline cached', offline: true }, 503);
        }
        return null;
      })
    );

    const ord = await api.createOrder({
      type: 'TAKEAWAY',
      items: [{ productId: 101, nameAr: 'طاجين ملكي', unitPrice: 1500, quantity: 1 }],
      subtotal: 1500,
      total: 1500,
    });
    expect(ord.offline).toBe(true);
    expect(ord.strictConflictCheck).toBe(true);

    const mov = await api.recordCashMovement({
      shiftId: 1,
      type: 'CASH_OUT',
      amount: 400,
      reason: 'نثريات',
    });
    expect(mov.offline).toBe(true);

    const queuedOrders = await offlineStorage.getOfflineOrders();
    const queuedMovs = await offlineStorage.getOfflineCashMovements();
    expect(queuedOrders).toHaveLength(1);
    expect(queuedOrders[0].operationId).toBeTruthy();
    expect(queuedMovs).toHaveLength(1);
    expect(queuedMovs[0].idempotencyKey).toBeTruthy();
  });

  it('transitions failed queue items to FAILED at maxRetries and NEVER auto-deletes them', async () => {
    await offlineStorage.saveOfflineOrder({
      offlineId: 'off-max-1',
      operationId: '11111111-1111-4111-8111-111111111111',
      type: 'TAKEAWAY',
      items: [{ productId: 101, nameAr: 'طاجين ملكي', unitPrice: 1500, quantity: 1 }],
      subtotal: 1500,
      discount: 0,
      deliveryFee: 0,
      total: 1500,
      paidAmount: 0,
      paymentStatus: 'UNPAID',
      idempotencyKey: 'ord-off-max-1',
      createdAt: new Date().toISOString(),
      retryCount: 4,
      maxRetries: 5,
    });

    vi.stubGlobal(
      'fetch',
      createFetchMock('ADMIN', (url) => {
        if (url === '/api/sync/batch') {
          return jsonRes({
            success: false,
            syncedIds: [],
            failedOrders: [{ offlineId: 'off-max-1', error: 'فشل مؤقت متكرر', retryable: true }],
          });
        }
        return null;
      })
    );

    const res = await api.syncOfflineQueue({ force: true });
    expect(res.count).toBe(0);
    expect(res.failedCount).toBe(1);

    const remaining = await offlineStorage.getOfflineOrders();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].retryCount).toBe(5);
    expect(remaining[0].syncStatus).toBe('FAILED');
    expect(remaining[0].queueState).toBe('FAILED');
  });

  it('reuses the exact same UUID idempotency key across quick-checkout retries in App.tsx', async () => {
    const capturedKeys: string[] = [];
    let attempt = 0;

    vi.stubGlobal(
      'fetch',
      createFetchMock('ADMIN', async (url, init) => {
        if (url === '/api/orders' && init?.method === 'POST') {
          attempt++;
          const parsed = JSON.parse(String(init.body));
          capturedKeys.push(parsed.idempotencyKey);
          if (attempt === 1) {
            return jsonRes({ error: 'خطأ مؤقت في الخادم' }, 500);
          }
          return jsonRes(
            { id: 88, orderNumber: 'BON-0088', dailySequence: 88, total: 1500 },
            201
          );
        }
        if (url === '/api/payments' && init?.method === 'POST') {
          return jsonRes({ success: true }, 200);
        }
        return null;
      })
    );

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('product-card-101')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('product-card-101'));

    const quickBtns = screen.getAllByText('تأكيد البيع والطباعة الفورية');
    fireEvent.click(quickBtns[0]);
    await waitFor(() => expect(capturedKeys).toHaveLength(1));

    // Retry exact same cart checkout -> MUST reuse identical idempotencyKey
    fireEvent.click(quickBtns[0]);
    await waitFor(() => expect(capturedKeys).toHaveLength(2));
    expect(capturedKeys[0]).toBe(capturedKeys[1]);
  });

  it('detects lie-fi (navigator.onLine=true while /api/health fails) in Header and auto-syncs upon /api/health recovery', async () => {
    await offlineStorage.saveOfflineOrder({
      offlineId: 'off-liefi-1',
      operationId: '22222222-2222-4222-8222-222222222222',
      type: 'TAKEAWAY',
      items: [{ productId: 101, nameAr: 'طاجين ملكي', unitPrice: 1500, quantity: 1 }],
      subtotal: 1500,
      discount: 0,
      deliveryFee: 0,
      total: 1500,
      paidAmount: 0,
      paymentStatus: 'UNPAID',
      idempotencyKey: 'ord-off-liefi-1',
      createdAt: new Date().toISOString(),
    });

    let healthUp = false;
    vi.stubGlobal(
      'fetch',
      createFetchMock('ADMIN', (url) => {
        if (url === '/api/health') {
          return healthUp
            ? jsonRes({ status: 'ok', db: 'connected' })
            : jsonRes({ error: 'Offline', offline: true }, 503);
        }
        if (url === '/api/sync/batch') {
          return jsonRes({ syncedIds: ['off-liefi-1'], failedOrders: [], results: [{ offlineId: 'off-liefi-1', orderNumber: 'BON-0099' }] });
        }
        return null;
      })
    );

    const ProbeTrigger: React.FC = () => {
      const { checkConnectionNow } = usePos();
      return (
        <button data-testid="probe-btn" onClick={() => checkConnectionNow()}>
          probe
        </button>
      );
    };

    render(
      <LanguageProvider>
        <AuthProvider>
          <PosProvider>
            <Header onOpenCashRegisterModal={() => {}} onOpenHeldOrdersModal={() => {}} />
            <ProbeTrigger />
          </PosProvider>
        </AuthProvider>
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('network-status-badge')).toHaveTextContent('الخادم غير متاح');
    });

    healthUp = true;
    await act(async () => {
      fireEvent.click(screen.getByTestId('probe-btn'));
    });

    await waitFor(async () => {
      expect(screen.getByTestId('network-status-badge')).toHaveTextContent('متصل');
      const remaining = await offlineStorage.getOfflineOrders();
      expect(remaining).toHaveLength(0);
    });
  });

  it('renders SyncCenter conflicts with RBAC enforcement, 2-step inline discard (zero window.confirm), and blocks CashRegisterModal close when unsynced items exist', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);

    await offlineStorage.saveOfflineOrder({
      offlineId: 'off-conf-ui-1',
      operationId: '33333333-3333-4333-8333-333333333333',
      type: 'TAKEAWAY',
      items: [{ productId: 101, nameAr: 'طاجين ملكي', unitPrice: 1200, expectedCatalogPrice: 1200, quantity: 1 }],
      subtotal: 1200,
      discount: 0,
      deliveryFee: 0,
      total: 1200,
      paidAmount: 0,
      paymentStatus: 'UNPAID',
      idempotencyKey: 'ord-off-conf-ui-1',
      createdAt: new Date().toISOString(),
      syncStatus: 'FAILED',
      queueState: 'FAILED',
      conflictType: 'PRICE_CHANGED',
      serverSnapshot: {
        productId: 101,
        nameAr: 'طاجين ملكي',
        clientPrice: 1200,
        serverPrice: 1500,
      },
    });
    await offlineStorage.saveSyncConflict({
      conflictId: 'off-conf-ui-1',
      operationId: '33333333-3333-4333-8333-333333333333',
      offlineId: 'off-conf-ui-1',
      entityType: 'ORDER',
      conflictType: 'PRICE_CHANGED',
      message: 'تغير سعر الطبق من 1200 DA إلى 1500 DA',
      serverSnapshot: {
        productId: 101,
        nameAr: 'طاجين ملكي',
        clientPrice: 1200,
        serverPrice: 1500,
      },
      orderSummary: { type: 'TAKEAWAY', total: 1200, itemsCount: 1 },
      createdAt: new Date().toISOString(),
    });

    // 1. CASHIER role must NOT see OVERRIDE_PRICE or Discard buttons
    vi.stubGlobal('fetch', createFetchMock('CASHIER'));
    const { unmount } = render(
      <LanguageProvider>
        <AuthProvider>
          <PosProvider>
            <SyncCenter />
            <CashRegisterModal isOpen={true} onClose={() => {}} />
          </PosProvider>
        </AuthProvider>
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('sync-conflicts-panel')).toBeInTheDocument();
      expect(screen.getByTestId('resolve-accept-server-off-conf-ui-1')).toBeInTheDocument();
      expect(screen.getByTestId('shift-close-sync-warning')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('resolve-override-price-off-conf-ui-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('discard-conflict-off-conf-ui-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('confirm-close-shift-btn')).toBeDisabled();

    unmount();

    // 2. ADMIN role sees OVERRIDE_PRICE & 2-step inline discard (no window.confirm)
    vi.stubGlobal('fetch', createFetchMock('ADMIN'));
    render(
      <LanguageProvider>
        <AuthProvider>
          <PosProvider>
            <SyncCenter />
          </PosProvider>
        </AuthProvider>
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('resolve-override-price-off-conf-ui-1')).toBeInTheDocument();
      expect(screen.getByTestId('discard-conflict-off-conf-ui-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('discard-conflict-off-conf-ui-1'));
    await waitFor(() => expect(screen.getByTestId('confirm-discard-conflict-off-conf-ui-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-discard-conflict-off-conf-ui-1'));

    await waitFor(async () => {
      expect(await offlineStorage.getOfflineOrders()).toHaveLength(0);
      expect(await offlineStorage.getSyncConflicts()).toHaveLength(0);
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
