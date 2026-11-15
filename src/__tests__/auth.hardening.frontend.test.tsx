// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockCache = new Map<string, any>();
const offlineQueueMock: any[] = [
  {
    offlineId: 'off-sync-test-1',
    type: 'TAKEAWAY',
    items: [{ productId: 101, nameAr: 'طاجين', unitPrice: 1200, quantity: 1 }],
    subtotal: 1200,
    discount: 0,
    deliveryFee: 0,
    total: 1200,
    paidAmount: 1200,
    paymentStatus: 'PAID',
    paymentMethod: 'CASH',
    idempotencyKey: 'ord-off-sync-test-1',
    createdAt: new Date().toISOString(),
  },
];

vi.mock('../services/offlineStorage.ts', () => ({
  setCachedData: vi.fn(async (key: string, data: any) => {
    mockCache.set(key, data);
  }),
  getCachedData: vi.fn(async <T,>(key: string): Promise<T | null> => {
    return (mockCache.get(key) as T) ?? null;
  }),
  saveOfflineOrder: vi.fn(async () => {}),
  getOfflineOrders: vi.fn(async () => [...offlineQueueMock]),
  deleteOfflineOrder: vi.fn(async () => {}),
  updateOfflineOrderPayment: vi.fn(async () => {}),
}));

import App from '../App.tsx';
import { SettingsModal } from '../components/SettingsModal.tsx';
import { AuthProvider } from '../context/AuthContext.tsx';
import { PosProvider } from '../context/PosContext.tsx';
import { api, setSessionRestoring } from '../services/api.ts';

const TOKEN_KEY = 'golden_palace_auth_token';

describe('Golden Palace POS — Frontend Auth Hardening Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    mockCache.clear();
    setSessionRestoring(false);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setSessionRestoring(false);
    cleanup();
    vi.unstubAllGlobals();
  });

  it('blocks protected API calls (including online sync events) while session restoration is pending', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-jwt-restoring');

    let resolveMe!: (val: Response) => void;
    const deferredMe = new Promise<Response>((res) => {
      resolveMe = res;
    });

    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return deferredMe;
      if (url === '/api/sync/batch') {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, syncedIds: ['off-sync-test-1'] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ isOpen: false, shift: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    // While /api/auth/me is pending:
    // 1) Direct non-auth API calls must be blocked before calling fetch
    await expect(api.getTables()).rejects.toThrow('SESSION_RESTORATION_IN_PROGRESS');

    // 2) Dispatching 'online' event during restoration must NOT fire /api/sync/batch
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.any(Object));
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/sync/batch')).toBe(false);

    // Complete session restoration
    await act(async () => {
      resolveMe(
        new Response(
          JSON.stringify({
            user: {
              id: 1,
              uid: 'u1',
              username: 'admin',
              email: 'admin@goldenpalace.dz',
              fullName: 'المدير العام',
              role: 'ADMIN',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cash-register/current', expect.any(Object));
    });

    // After session restoration succeeds, an online event CAN trigger sync
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/sync/batch', expect.any(Object));
    });
  });

  it('does NOT trigger protected cashier fetches when logging in as KITCHEN role', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-kitchen-token');

    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        return new Response(
          JSON.stringify({
            user: {
              id: 5,
              uid: 'u5',
              username: 'cuisine',
              email: 'kitchen@goldenpalace.dz',
              fullName: 'رئيس المطبخ',
              role: 'KITCHEN',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-tab-kitchen')).toBeInTheDocument();
    });

    expect(
      fetchMock.mock.calls.some(
        (c) => String(c[0]).includes('/cash-register/current') || String(c[0]).includes('/cashier/dashboard')
      )
    ).toBe(false);
  });

  it('displays HTTP 429 rate-limit error cleanly on PIN login in LoginModal', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/pin-login') {
        return new Response(
          JSON.stringify({ error: 'تم تجاوز عدد محاولات رمز PIN المسموحة. يرجى الانتظار 900 ثانية.' }),
          {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '900' },
          }
        );
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('GOLDEN PALACE POS')).toBeInTheDocument();
    });

    for (const digit of ['9', '9', '9', '9']) {
      fireEvent.click(screen.getByRole('button', { name: digit }));
    }

    await waitFor(() => {
      expect(screen.getByText(/تم تجاوز عدد محاولات رمز PIN المسموحة/)).toBeInTheDocument();
    });
  });

  it('renders masked PIN status via hasPin in SettingsModal without expecting raw PIN strings', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-admin-token');

    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        return new Response(
          JSON.stringify({
            user: {
              id: 1,
              uid: 'u1',
              username: 'admin',
              email: 'admin@goldenpalace.dz',
              fullName: 'المدير العام',
              role: 'ADMIN',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === '/api/settings') {
        return new Response(JSON.stringify({ restaurant_name: 'GOLDEN PALACE POS' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/users') {
        return new Response(
          JSON.stringify([
            { id: 1, fullName: 'المدير العام', username: 'admin', role: 'ADMIN', hasPin: true, isActive: true },
            { id: 2, fullName: 'موظف بدون رمز', username: 'nopin', role: 'CASHIER', hasPin: false, isActive: true },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('[]', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <PosProvider>
          <SettingsModal />
        </PosProvider>
      </AuthProvider>
    );

    fireEvent.click(screen.getByText('الموظفين والأدوار (RBAC)'));

    await waitFor(() => {
      expect(screen.getByText('المدير العام')).toBeInTheDocument();
    });
    expect(screen.getByText('•••• (مفعّل)')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
