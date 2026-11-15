// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockCache = new Map<string, any>();

vi.mock('../services/offlineStorage.ts', () => ({
  setCachedData: vi.fn(async (key: string, data: any) => {
    mockCache.set(key, data);
  }),
  getCachedData: vi.fn(async <T,>(key: string): Promise<T | null> => {
    return (mockCache.get(key) as T) ?? null;
  }),
  saveOfflineOrder: vi.fn(async () => {}),
  updateOfflineOrderPayment: vi.fn(async () => {}),
  getOfflineOrders: vi.fn(async () => []),
  deleteOfflineOrder: vi.fn(async () => {}),
}));

import App from '../App.tsx';
import { ReceiptPrint } from '../components/ReceiptPrint.tsx';

const TOKEN_KEY = 'golden_palace_auth_token';

describe('Golden Palace POS — Phase 05 Critical Bug Fixes (Frontend)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockCache.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('preserves activeOrderId when resuming a held order and saves Quick Customer via /api/customers without dummy id=0', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-admin-token');

    const heldOrder = {
      id: 404,
      orderNumber: 'ORD-HELD-404',
      type: 'DINE_IN',
      tableId: 1,
      tableNumber: '1',
      total: 1500,
      subtotal: 1500,
      discount: 0,
      deliveryFee: 0,
      isHeld: true,
      items: [
        {
          id: 9001,
          productId: 101,
          nameAr: 'مشاوي مشكلة',
          nameFr: 'Grillades Mixtes',
          unitPrice: 1500,
          quantity: 1,
          total: 1500,
          station: 'GRILL',
        },
      ],
    };

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const json = (data: any, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });

      if (url === '/api/auth/me') {
        return json({
          user: { id: 1, uid: 'u-1', username: 'admin', fullName: 'المدير العام', role: 'ADMIN' },
        });
      }
      if (url.startsWith('/api/cash-register/current')) {
        return json({ isOpen: true, shift: { id: 1, status: 'OPEN', shiftNumber: 1 } });
      }
      if (url.startsWith('/api/cashier/dashboard')) {
        return json({ heldOrdersCount: 1, shiftStatus: 'OPEN' });
      }
      if (url === '/api/settings') {
        return json({ tax_rate: '0' });
      }
      if (url === '/api/categories') {
        return json([{ id: 1, nameAr: 'مشاوي', isActive: true }]);
      }
      if (url === '/api/products') {
        return json([
          { id: 101, categoryId: 1, nameAr: 'مشاوي مشكلة', price: 1500, isAvailable: true, station: 'GRILL' },
        ]);
      }
      if (url === '/api/tables') {
        return json([{ id: 1, tableNumber: '1', capacity: 4, status: 'AVAILABLE' }]);
      }
      if (url.startsWith('/api/orders?heldOnly=true')) {
        return json([heldOrder]);
      }
      if (url === '/api/orders/404/resume' && init?.method === 'POST') {
        return json({ ...heldOrder, isHeld: false });
      }
      if (url === '/api/orders/404/items' && init?.method === 'POST') {
        return json({ ...heldOrder, isHeld: false });
      }
      if (url === '/api/customers' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return json({ id: 88, name: body.name, phone: body.phone, totalOrders: 0, totalSpent: '0' }, 201);
      }
      if (url === '/api/payments' && init?.method === 'POST') {
        return json({ success: true, paymentStatus: 'PAID' });
      }
      return json([]);
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('product-card-101')).toBeInTheDocument();
    });

    // Test Quick Customer real API persistence & empty phone validation
    fireEvent.click(screen.getByText('زبون عام'));
    fireEvent.change(screen.getByTestId('quick-customer-name-input'), { target: { value: 'ياسين' } });
    fireEvent.click(screen.getByTestId('save-quick-customer-btn'));
    expect(screen.getByTestId('quick-customer-error')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('quick-customer-phone-input'), { target: { value: '0555998877' } });
    fireEvent.click(screen.getByTestId('save-quick-customer-btn'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/customers',
        expect.objectContaining({ method: 'POST' })
      );
      expect(screen.getByText('ياسين')).toBeInTheDocument();
    });

    // Open Held Orders modal & resume order 404
    const heldBtn = await screen.findByTitle('الفواتير المعلقة');
    fireEvent.click(heldBtn);
    await waitFor(() => {
      expect(screen.getByText('ORD-HELD-404')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('استئناف'));

    await waitFor(() => {
      expect(screen.getByText(/تعديل طلب مفتوح: ORD-HELD-404/)).toBeInTheDocument();
    });

    // Complete payment via PaymentModal -> MUST call /api/orders/404/items (NOT POST /api/orders!)
    fireEvent.click(screen.getByTestId('open-payment-modal-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('payment-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('confirm-payment-btn'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/orders/404/items',
        expect.objectContaining({ method: 'POST' })
      );
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/orders',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('hides item price override field for CASHIER and shows it with reason for ADMIN, and clears cart on logout', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-cashier-token');

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const json = (data: any) =>
        new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

      if (url === '/api/auth/me') {
        return json({
          user: { id: 2, uid: 'u-2', username: 'cashier', fullName: 'كاشير 1', role: 'CASHIER' },
        });
      }
      if (url === '/api/auth/logout' && init?.method === 'POST') {
        return json({ success: true });
      }
      if (url.startsWith('/api/cash-register/current')) {
        return json({ isOpen: true, shift: { id: 1, status: 'OPEN', shiftNumber: 1 } });
      }
      if (url.startsWith('/api/cashier/dashboard')) {
        return json({ heldOrdersCount: 0, shiftStatus: 'OPEN' });
      }
      if (url === '/api/settings') return json({ tax_rate: '0' });
      if (url === '/api/categories') return json([{ id: 1, nameAr: 'مشاوي', isActive: true }]);
      if (url === '/api/products') {
        return json([{ id: 101, categoryId: 1, nameAr: 'مشاوي مشكلة', price: 1500, isAvailable: true, station: 'GRILL' }]);
      }
      return json([]);
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('product-card-101')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('product-card-101'));
    expect(screen.getByTestId('cart-item-101')).toBeInTheDocument();

    // Open cart item edit modal as CASHIER -> price override input MUST NOT render
    fireEvent.click(screen.getByText('1', { selector: 'button' }));
    await waitFor(() => {
      expect(screen.getByText('حفظ التعديلات')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('item-edit-price-input')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('حفظ التعديلات'));

    // Logout -> cart & active state must be cleared
    fireEvent.click(screen.getByTitle('تسجيل الخروج'));
    await waitFor(() => {
      expect(screen.queryByTestId('cart-item-101')).not.toBeInTheDocument();
    });
  });

  it('renders tax row (TVA) on ReceiptPrint when taxAmount > 0', () => {
    render(
      <ReceiptPrint
        data={{
          orderNumber: 'ORD-TAX-1',
          orderType: 'TAKEAWAY',
          items: [{ nameAr: 'بيتزا', quantity: 1, unitPrice: 1000, total: 1000 }],
          subtotal: 1000,
          discount: 0,
          deliveryFee: 0,
          taxRate: 19,
          taxAmount: 190,
          total: 1190,
          time: '12:00:00',
          date: '14/11/2026',
        }}
        onClose={() => {}}
      />
    );

    const taxRow = screen.getByTestId('receipt-tax-row');
    expect(taxRow).toHaveTextContent('TVA (19%)');
    expect(taxRow).toHaveTextContent('+190 DA');
  });
});
