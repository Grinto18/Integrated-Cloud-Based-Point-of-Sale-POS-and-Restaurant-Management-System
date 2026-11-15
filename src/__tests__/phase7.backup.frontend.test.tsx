// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { LanguageProvider } from '../context/LanguageContext.tsx';
import { PosProvider } from '../context/PosContext.tsx';
import { SettingsModal } from '../components/SettingsModal.tsx';
import { api } from '../services/api.ts';

let mockRole: 'ADMIN' | 'CASHIER' = 'ADMIN';

vi.mock('../context/AuthContext.tsx', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      uid: 'u-admin',
      username: 'admin',
      fullName: 'المدير العام',
      role: mockRole,
      isActive: true,
    },
    token: 'mock-admin-token',
    isLoading: false,
    isLocked: false,
    canAccessProtectedApi: true,
    hasRole: (roles: string[]) => roles.includes(mockRole),
  }),
}));

vi.mock('../services/offlineStorage.ts', () => ({
  setCachedData: vi.fn(async () => {}),
  getCachedData: vi.fn(async () => null),
  saveOfflineOrder: vi.fn(async () => {}),
  updateOfflineOrderPayment: vi.fn(async () => {}),
  getOfflineOrders: vi.fn(async () => []),
  deleteOfflineOrder: vi.fn(async () => {}),
}));

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LanguageProvider>
    <PosProvider>{children}</PosProvider>
  </LanguageProvider>
);

const sampleOverview = {
  backups: [
    {
      filename: 'gp_pos_manual_2026-11-14T12-00-00-000Z_ab12.db',
      type: 'MANUAL' as const,
      createdAt: '2026-11-14T12:00:00.000Z',
      sizeBytes: 245760,
      status: 'VERIFIED' as const,
      integrityCheck: 'ok',
      recordCounts: {
        orders: 42,
        order_items: 118,
        payments: 42,
        ingredients: 15,
        users: 4,
        products: 25,
        cash_shifts: 3,
      },
    },
    {
      filename: 'gp_pos_daily_2026-11-13T08-00-00-000Z_cd34.db',
      type: 'DAILY' as const,
      createdAt: '2026-11-13T08:00:00.000Z',
      sizeBytes: 230400,
      status: 'VERIFIED' as const,
      integrityCheck: 'ok',
    },
  ],
  lastVerifiedBackup: {
    filename: 'gp_pos_manual_2026-11-14T12-00-00-000Z_ab12.db',
    type: 'MANUAL' as const,
    createdAt: '2026-11-14T12:00:00.000Z',
    sizeBytes: 245760,
    status: 'VERIFIED' as const,
    integrityCheck: 'ok',
    recordCounts: {
      orders: 42,
      order_items: 118,
      payments: 42,
      ingredients: 15,
      users: 4,
      products: 25,
      cash_shifts: 3,
    },
  },
  lastAttempt: null,
  config: {
    autoEnabled: true,
    intervalHours: 6,
    retentionCount: 14,
  },
  backupDirectory: '/tmp/isolated/backups',
};

describe('Golden Palace POS — Phase 07 Backup & Disaster Recovery UI Tests (Frontend)', () => {
  let alertSpy: any;
  let confirmSpy: any;
  let promptSpy: any;

  beforeEach(() => {
    mockRole = 'ADMIN';
    localStorage.clear();
    localStorage.setItem('golden_palace_auth_token', 'mock-admin-token');
    vi.restoreAllMocks();
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => null);

    vi.spyOn(api, 'getSettings').mockResolvedValue({
      default_language: 'ar',
      tax_rate: '0',
      backup_auto_enabled: 'true',
      backup_interval_hours: '6',
      backup_retention_count: '14',
    });
    vi.spyOn(api, 'getUsers').mockResolvedValue([]);
    vi.spyOn(api, 'getCurrentShift').mockResolvedValue({ isOpen: false });
    vi.spyOn(api, 'getOrders').mockResolvedValue([]);
    vi.spyOn(api, 'getCashierDashboard').mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('displays last backup status, backups list, and allows manual backup creation & verification in Arabic', async () => {
    const getBackupsSpy = vi.spyOn(api, 'getBackups').mockResolvedValue(sampleOverview);
    const createSpy = vi.spyOn(api, 'createSqliteBackup').mockResolvedValue({
      success: true,
      backup: {
        filename: 'gp_pos_manual_2026-11-14T13-00-00-000Z_xy99.db',
        type: 'MANUAL',
        createdAt: '2026-11-14T13:00:00.000Z',
        sizeBytes: 250000,
        status: 'VERIFIED',
        integrityCheck: 'ok',
      },
    });
    const verifySpy = vi.spyOn(api, 'verifySqliteBackup').mockResolvedValue({
      success: true,
      verification: {
        filename: 'gp_pos_manual_2026-11-14T12-00-00-000Z_ab12.db',
        valid: true,
        status: 'VERIFIED',
        integrityCheck: 'ok',
      },
    });

    render(
      <TestWrapper>
        <SettingsModal />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /النسخ الاحتياطي/ }));

    await waitFor(() => {
      expect(getBackupsSpy).toHaveBeenCalled();
      expect(screen.getByText('gp_pos_manual_2026-11-14T12-00-00-000Z_ab12.db')).toBeInTheDocument();
      expect(screen.getByText('240.0 KB • MANUAL')).toBeInTheDocument();
      expect(screen.getByText('VERIFIED (ok)')).toBeInTheDocument();
    });

    // Trigger manual backup button
    fireEvent.click(screen.getByRole('button', { name: /إنشاء نسخة احتياطية الآن/ }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith('MANUAL');
      expect(screen.getByText(/تم إنشاء نسخة احتياطية والتحقق من سلامتها/)).toBeInTheDocument();
    });

    // Trigger verify button on first backup row
    const verifyButtons = screen.getAllByRole('button', { name: /^فحص$/ });
    fireEvent.click(verifyButtons[0]);

    await waitFor(() => {
      expect(verifySpy).toHaveBeenCalledWith('gp_pos_manual_2026-11-14T12-00-00-000Z_ab12.db');
      expect(screen.getByText(/سليمة \(integrity_check: ok\)/)).toBeInTheDocument();
    });
  });

  it('requires two-step in-app confirmation modals before restoring backup and surfaces corrupted restore errors cleanly', async () => {
    vi.spyOn(api, 'getBackups').mockResolvedValue(sampleOverview);
    const restoreSpy = vi
      .spyOn(api, 'restoreSqliteBackup')
      .mockResolvedValueOnce({
        success: true,
        restoredFrom: 'gp_pos_manual_2026-11-14T12-00-00-000Z_ab12.db',
        preRestoreBackup: 'gp_pos_pre_restore_snapshot.db',
      })
      .mockRejectedValueOnce(new Error('النسخة الاحتياطية المختارة تالفة وتم منع الاستعادة'));

    render(
      <TestWrapper>
        <SettingsModal />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /النسخ الاحتياطي/ }));

    await waitFor(() => {
      expect(screen.getByText('gp_pos_manual_2026-11-14T12-00-00-000Z_ab12.db')).toBeInTheDocument();
    });

    // Step 1: Click Restore on row -> opens Warning Modal (API NOT called yet!)
    const restoreBtns = screen.getAllByRole('button', { name: /^استعادة$/ });
    fireEvent.click(restoreBtns[0]);

    expect(screen.getByText(/تحذير: استعادة قاعدة البيانات/)).toBeInTheDocument();
    expect(restoreSpy).not.toHaveBeenCalled();

    // Step 2: Click Continue -> opens Final Explicit Confirmation Modal (API still NOT called yet!)
    fireEvent.click(screen.getByRole('button', { name: /متابعة إلى التأكيد النهائي/ }));
    expect(screen.getByText(/التأكيد النهائي للاستعادة/)).toBeInTheDocument();
    expect(restoreSpy).not.toHaveBeenCalled();

    // Step 3: Click Confirm Restore -> calls restoreSqliteBackup with CONFIRM_RESTORE
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الاستعادة الآن/ }));

    await waitFor(() => {
      expect(restoreSpy).toHaveBeenCalledWith('gp_pos_manual_2026-11-14T12-00-00-000Z_ab12.db', 'CONFIRM_RESTORE');
      expect(screen.getByText(/تمت استعادة قاعدة البيانات/)).toBeInTheDocument();
    });

    // Attempt second restore which fails with corrupted backup error -> shown inside modal
    fireEvent.click(screen.getAllByRole('button', { name: /^استعادة$/ })[1]);
    fireEvent.click(screen.getByRole('button', { name: /متابعة إلى التأكيد النهائي/ }));
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الاستعادة الآن/ }));

    await waitFor(() => {
      expect(screen.getAllByText(/النسخة الاحتياطية المختارة تالفة وتم منع الاستعادة/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders Backup tab in French LTR and restricts non-admin access cleanly', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ default_language: 'fr', tax_rate: '0' });
    vi.spyOn(api, 'getBackups').mockResolvedValue(sampleOverview);

    const { rerender } = render(
      <TestWrapper>
        <SettingsModal />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sauvegarde' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sauvegarde' }));

    await waitFor(() => {
      expect(screen.getByText('Statut de la dernière sauvegarde (SQLite)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Créer une sauvegarde maintenant/ })).toBeInTheDocument();
    });

    // Switch role to non-admin (CASHIER)
    mockRole = 'CASHIER';
    rerender(
      <TestWrapper>
        <SettingsModal />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/réservée à l’ADMIN/)).toBeInTheDocument();
    });
  });
});
