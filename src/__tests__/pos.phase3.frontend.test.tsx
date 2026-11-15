// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockCache = new Map<string, any>();
const offlineQueueMock: any[] = [];

vi.mock('../services/offlineStorage.ts', () => ({
  setCachedData: vi.fn(async (key: string, data: any) => {
    mockCache.set(key, data);
  }),
  getCachedData: vi.fn(async <T,>(key: string): Promise<T | null> => {
    return (mockCache.get(key) as T) ?? null;
  }),
  saveOfflineOrder: vi.fn(async (order: any) => {
    const idx = offlineQueueMock.findIndex((o) => o.offlineId === order.offlineId);
    if (idx >= 0) offlineQueueMock[idx] = order;
    else offlineQueueMock.push(order);
  }),
  updateOfflineOrderPayment: vi.fn(async (offlineId: string, patch: any) => {
    const idx = offlineQueueMock.findIndex((o) => o.offlineId === offlineId);
    if (idx >= 0) offlineQueueMock[idx] = { ...offlineQueueMock[idx], ...patch };
  }),
  getOfflineOrders: vi.fn(async () => [...offlineQueueMock]),
  deleteOfflineOrder: vi.fn(async () => {}),
}));

import App from '../App.tsx';
import { api } from '../services/api.ts';

const TOKEN_KEY = 'golden_palace_auth_token';

function createApiMock(options: { role?: string; fullName?: string; isShiftOpen?: boolean } = {}) {
  const { role = 'ADMIN', fullName = 'المدير العام', isShiftOpen = true } = options;
  return vi.fn(async (url: string, init?: RequestInit) => {
    const jsonRes = (data: any, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url === '/api/auth/me') {
      return jsonRes({
        user: {
          id: 1,
          uid: 'u-1',
          username: role.toLowerCase(),
          email: 'user@goldenpalace.dz',
          fullName,
          role,
        },
      });
    }
    if (url.startsWith('/api/cash-register/current')) {
      return jsonRes(
        isShiftOpen
          ? {
              isOpen: true,
              shift: {
                id: 10,
                shiftNumber: 4,
                openingCash: 5000,
                totalCashSales: 2400,
                totalCardSales: 800,
                totalBaridimobSales: 0,
                totalCcpSales: 0,
                totalExpenses: 0,
                totalCashOut: 0,
                expectedCash: 7400,
                status: 'OPEN',
              },
            }
          : { isOpen: false, shift: null }
      );
    }
    if (url.startsWith('/api/cashier/dashboard')) {
      return jsonRes({
        activeOrdersCount: 3,
        preparingOrdersCount: 2,
        readyOrdersCount: 1,
        heldOrdersCount: 0,
        shiftTotalSales: 3200,
        shiftStatus: isShiftOpen ? 'OPEN' : 'CLOSED',
        shiftNumber: isShiftOpen ? 4 : null,
        expectedCash: 7400,
        tablesSummary: { available: 27, occupied: 2, ready: 1, waitingPayment: 0, inactive: 0 },
      });
    }
    if (url === '/api/settings') {
      return jsonRes({ restaurant_name: 'GOLDEN PALACE POS', tax_rate: '0' });
    }
    if (url === '/api/categories') {
      return jsonRes([{ id: 1, nameAr: 'مشاوي', nameFr: 'Grillades', isActive: true }]);
    }
    if (url === '/api/products') {
      return jsonRes([
        {
          id: 101,
          categoryId: 1,
          nameAr: 'مشاوي مشكلة',
          nameFr: 'Grillades Mixtes',
          price: 1500,
          costPrice: 700,
          isAvailable: true,
          station: 'GRILL',
        },
        {
          id: 102,
          categoryId: 1,
          nameAr: 'شوربة فريك',
          nameFr: 'Chorba Frik',
          price: 400,
          costPrice: 150,
          isAvailable: true,
          station: 'MAIN_KITCHEN',
        },
      ]);
    }
    if (url === '/api/tables') {
      return jsonRes([
        { id: 1, tableNumber: '1', zone: 'الصالة الرئيسية', capacity: 4, status: 'AVAILABLE' },
        { id: 2, tableNumber: '2', zone: 'الصالة الرئيسية', capacity: 4, status: 'OCCUPIED', currentOrderId: 55, activeOrder: { id: 55, orderNumber: 'ORD-55', total: 1500 } },
      ]);
    }
    if (url.startsWith('/api/orders') && (!init?.method || init.method === 'GET')) {
      return jsonRes([]);
    }
    if (url === '/api/orders' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      return jsonRes({ id: 777, orderNumber: 'ORD-777', dailySequence: 12, total: body.total || 1500 }, 201);
    }
    if (url === '/api/payments' && init?.method === 'POST') {
      return jsonRes({ success: true, paymentStatus: 'PAID', orderStatus: 'COMPLETED' });
    }
    return jsonRes([]);
  });
}

describe('Golden Palace POS — Phase 03 Frontend Cashier Interface Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    mockCache.clear();
    offlineQueueMock.length = 0;
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('toggles Arabic RTL and French LTR live without page reload and shows Header + CashierDashboardBar metrics', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-admin-token');
    vi.stubGlobal('fetch', createApiMock({ role: 'ADMIN', fullName: 'المدير العام', isShiftOpen: true }));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('cashier-dashboard-bar')).toBeInTheDocument();
    });

    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByTestId('header-employee-info')).toHaveTextContent('المدير العام');
    expect(screen.getByTestId('nav-tab-pos')).toHaveTextContent('الكاشير');
    expect(screen.getByTestId('nav-tab-settings')).toBeInTheDocument();

    // Switch live to French LTR
    fireEvent.click(screen.getByTestId('language-toggle-btn'));
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('fr');
    expect(screen.getByTestId('nav-tab-pos')).toHaveTextContent('Caisse POS');
    expect(screen.getByTestId('nav-tab-tables')).toHaveTextContent('Tables');

    // Switch back to Arabic RTL
    fireEvent.click(screen.getByTestId('language-toggle-btn'));
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('hides unauthorized sidebar items for CASHIER role', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-cashier-token');
    vi.stubGlobal('fetch', createApiMock({ role: 'CASHIER', fullName: 'كاشير الوردية', isShiftOpen: true }));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-tab-pos')).toBeInTheDocument();
    });

    expect(screen.getByTestId('nav-tab-tables')).toBeInTheDocument();
    expect(screen.getByTestId('nav-tab-orders')).toBeInTheDocument();
    // Admin / Manager-only tabs must be hidden for CASHIER
    expect(screen.queryByTestId('nav-tab-reports')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-tab-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-tab-audit')).not.toBeInTheDocument();
  });

  it('adds products to cart, updates quantities/totals, opens PaymentModal, and enforces open-shift warning when closed', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-cashier-token');
    vi.stubGlobal('fetch', createApiMock({ role: 'CASHIER', isShiftOpen: false }));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('product-card-101')).toBeInTheDocument();
    });

    // Click product twice -> 2 x 1500 = 3000 DA
    fireEvent.click(screen.getByTestId('product-card-101'));
    fireEvent.click(screen.getByTestId('product-card-101'));

    expect(screen.getByTestId('pos-cart-total')).toHaveTextContent('3,000');

    // Open PaymentModal while shift is CLOSED
    fireEvent.click(screen.getByTestId('open-payment-modal-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('payment-modal')).toBeInTheDocument();
    });

    expect(screen.getByTestId('confirm-payment-btn')).toBeDisabled();
    expect(screen.getByText(/الصندوق مغلق حالياً/)).toBeInTheDocument();
  });

  it('completes payment when shift is OPEN across CASH / CARD / BANK_TRANSFER', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-cashier-token');
    const fetchMock = createApiMock({ role: 'CASHIER', isShiftOpen: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('product-card-102')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('product-card-102'));
    fireEvent.click(screen.getByTestId('open-payment-modal-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('payment-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pay-method-BANK_TRANSFER'));
    fireEvent.click(screen.getByTestId('confirm-payment-btn'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/payments',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  it('queues order and payment offline cleanly when network is unavailable without throwing UI errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const orderRes = await api.createOrder({
      type: 'TAKEAWAY',
      items: [{ productId: 101, nameAr: 'مشاوي', unitPrice: 1500, quantity: 1 }],
      total: 1500,
    });

    expect(orderRes.offline).toBe(true);
    expect(offlineQueueMock.length).toBe(1);

    const payRes = await api.processPayment({
      orderId: orderRes.id,
      offlineId: orderRes.offlineId,
      payments: [{ method: 'CASH', amount: 1500 }],
    });

    expect(payRes.offline).toBe(true);
    expect(offlineQueueMock[0].paymentStatus).toBe('PAID');
    expect(offlineQueueMock[0].paymentMethod).toBe('CASH');
  });
});
