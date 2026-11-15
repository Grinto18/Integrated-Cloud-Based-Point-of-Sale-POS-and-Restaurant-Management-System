// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
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
  getOfflineOrders: vi.fn(async () => []),
  deleteOfflineOrder: vi.fn(async () => {}),
}));

import { AuthProvider, useAuth } from '../context/AuthContext.tsx';
import { PosProvider, usePos } from '../context/PosContext.tsx';
import { LoginModal } from '../components/LoginModal.tsx';
import App from '../App.tsx';

const TOKEN_KEY = 'golden_palace_auth_token';

const SessionHarness: React.FC = () => {
  const { user, isLoading, isLocked, logout, lockTerminal } = useAuth();
  const { refreshShift } = usePos();

  if (isLoading) return <div data-testid="loading">loading</div>;

  return (
    <div>
      <div data-testid="user-name">{user ? user.fullName : 'NONE'}</div>
      <div data-testid="user-role">{user ? user.role : 'NONE'}</div>
      <div data-testid="locked-state">{isLocked ? 'LOCKED' : 'UNLOCKED'}</div>
      <button onClick={lockTerminal}>LOCK</button>
      <button onClick={logout}>LOGOUT</button>
      <button onClick={() => refreshShift()}>REFRESH_SHIFT</button>
      {(!user || isLocked) && <LoginModal />}
    </div>
  );
};

describe('Golden Palace POS — Frontend Auth, PIN Unlock & Session Management QA Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    mockCache.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does NOT execute protected API requests before session restoration completes (and skips /api/auth/me when unauthenticated)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('GOLDEN PALACE POS')).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    cleanup();

    // Now simulate F5 with a stored token while /api/auth/me is still pending
    localStorage.setItem(TOKEN_KEY, 'valid-jwt-token-1');
    let resolveMe!: (val: Response) => void;
    const deferredMe = new Promise<Response>((res) => {
      resolveMe = res;
    });

    const gatedFetch = vi.fn((url: string) => {
      if (url === '/api/auth/me') return deferredMe;
      if (url.startsWith('/api/cash-register/current')) {
        return Promise.resolve(
          new Response(JSON.stringify({ isOpen: false, shift: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', gatedFetch);

    render(<App />);

    // While /api/auth/me is pending, protected POS endpoints must NOT have been called yet
    expect(gatedFetch).toHaveBeenCalledTimes(1);
    expect(gatedFetch).toHaveBeenCalledWith('/api/auth/me', expect.any(Object));
    expect(
      gatedFetch.mock.calls.some((c) => String(c[0]).includes('/cash-register') || String(c[0]).includes('/orders'))
    ).toBe(false);

    // Finish resolving /api/auth/me -> App restores session and then refreshes shift/held orders
    await act(async () => {
      resolveMe(
        new Response(
          JSON.stringify({
            user: {
              id: 1,
              uid: 'u-1',
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
      expect(gatedFetch).toHaveBeenCalledWith('/api/cash-register/current', expect.any(Object));
    });
  });

  it('persists session across F5 reload online and preserves Offline-first login via cache fallback', async () => {
    localStorage.setItem(TOKEN_KEY, 'persisted-jwt-token');

    const onlineFetch = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        return new Response(
          JSON.stringify({
            user: {
              id: 1,
              uid: 'user-admin-001',
              username: 'admin',
              email: 'admin@goldenpalace.dz',
              fullName: 'المدير العام (Admin)',
              role: 'ADMIN',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', onlineFetch);

    render(
      <AuthProvider>
        <PosProvider>
          <SessionHarness />
        </PosProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('المدير العام (Admin)');
    });
    expect(mockCache.has('/auth/me')).toBe(true);

    // Simulate F5 reload while network is offline
    cleanup();
    const offlineFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', offlineFetch);

    render(
      <AuthProvider>
        <PosProvider>
          <SessionHarness />
        </PosProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('المدير العام (Admin)');
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('persisted-jwt-token');
  });

  it('clears local token, bypasses offline cache, and logs user out on HTTP 401', async () => {
    localStorage.setItem(TOKEN_KEY, 'revoked-token');
    // Pre-populate cache to prove HTTP 401 MUST NOT fall back to stale cache!
    mockCache.set('/auth/me', {
      user: { id: 1, uid: 'u1', username: 'admin', email: 'a@b.dz', fullName: 'Cached User', role: 'ADMIN' },
    });

    const unauthFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'جلسة تسجيل الدخول غير صالحة أو منتهية' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', unauthFetch);

    render(
      <AuthProvider>
        <PosProvider>
          <SessionHarness />
        </PosProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('NONE');
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('unlocks screen with correct PIN, saves refreshed token, and rejects wrong PIN without closing lock screen', async () => {
    localStorage.setItem(TOKEN_KEY, 'initial-session-token');

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
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
      if (url === '/api/auth/pin-login') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.pin === '1234') {
          return new Response(
            JSON.stringify({
              token: 'refreshed-pin-jwt-token',
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
        return new Response(JSON.stringify({ error: 'رمز PIN غير صحيح' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <PosProvider>
          <SessionHarness />
        </PosProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('المدير العام');
    });

    // Lock screen
    fireEvent.click(screen.getByText('LOCK'));
    expect(screen.getByTestId('locked-state')).toHaveTextContent('LOCKED');
    expect(screen.getByText(/الشاشة مقفلة للمستخدم/)).toBeInTheDocument();

    // Enter wrong PIN 9999 -> stays locked and shows error
    for (const digit of ['9', '9', '9', '9']) {
      fireEvent.click(screen.getByRole('button', { name: digit }));
    }

    await waitFor(() => {
      expect(screen.getByText('رمز PIN غير صحيح')).toBeInTheDocument();
    });
    expect(screen.getByTestId('locked-state')).toHaveTextContent('LOCKED');
    expect(localStorage.getItem(TOKEN_KEY)).toBe('initial-session-token');

    // Enter correct PIN 1234 -> unlocks and saves refreshed token
    for (const digit of ['1', '2', '3', '4']) {
      fireEvent.click(screen.getByRole('button', { name: digit }));
    }

    await waitFor(() => {
      expect(screen.getByTestId('locked-state')).toHaveTextContent('UNLOCKED');
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('refreshed-pin-jwt-token');
  });

  it('calls /api/auth/logout with Bearer token, invalidates local session, and resets state on HTTP 401 from mid-session calls', async () => {
    localStorage.setItem(TOKEN_KEY, 'active-token-123');

    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        return new Response(
          JSON.stringify({
            user: {
              id: 3,
              uid: 'u3',
              username: 'caissier1',
              email: 'caisse1@goldenpalace.dz',
              fullName: 'كاشير الوردية 1',
              role: 'CASHIER',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === '/api/auth/logout') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/cash-register/current') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <PosProvider>
          <SessionHarness />
        </PosProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('كاشير الوردية 1');
    });

    // Mid-session 401 invalidates React Auth state immediately
    fireEvent.click(screen.getByText('REFRESH_SHIFT'));
    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('NONE');
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();

    // Now test explicit logout
    cleanup();
    localStorage.setItem(TOKEN_KEY, 'active-token-456');
    render(
      <AuthProvider>
        <PosProvider>
          <SessionHarness />
        </PosProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('كاشير الوردية 1');
    });

    fireEvent.click(screen.getByText('LOGOUT'));

    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('NONE');
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer active-token-456',
        }),
      })
    );
  });
});
