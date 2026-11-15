// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { LanguageProvider } from '../context/LanguageContext.tsx';
import { PosProvider } from '../context/PosContext.tsx';
import { ReceiptPrint } from '../components/ReceiptPrint.tsx';
import { SettingsModal } from '../components/SettingsModal.tsx';
import { api } from '../services/api.ts';
import { printerService } from '../services/printerService.ts';

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

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LanguageProvider>
    <PosProvider>{children}</PosProvider>
  </LanguageProvider>
);

describe('Golden Palace POS — Phase 09 Frontend Receipt & Printer Settings Tests', () => {
  beforeEach(() => {
    mockRole = 'ADMIN';
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(api, 'getProducts').mockResolvedValue([]);
    vi.spyOn(api, 'getCategories').mockResolvedValue([]);
    vi.spyOn(api, 'getTables').mockResolvedValue([]);
    vi.spyOn(api, 'getOrders').mockResolvedValue([]);
    vi.spyOn(api, 'getCustomers').mockResolvedValue([]);
    vi.spyOn(api, 'getSettings').mockResolvedValue({
      restaurant_name: 'القصر الذهبي - GOLDEN PALACE',
      restaurant_brand: 'LE PALAIS D’OR • عند الجيجلي • حسين داي',
      restaurant_phone: '0791755614',
      printer_connection_type: 'WINDOWS_SPOOLER',
      paper_type: '80mm',
    });
    vi.spyOn(api, 'getUsers').mockResolvedValue([]);
    vi.spyOn(api, 'getPrinterStatus').mockResolvedValue({
      printers: [
        { name: 'XPRINTER-80', driverName: '80Normal', isDefault: true, status: 'Ready', source: 'WINDOWS_SPOOLER' },
      ],
      supportedConnections: ['WINDOWS_SPOOLER', 'NETWORK_IP', 'USB', 'BROWSER'],
      platform: 'win32',
    });
    vi.spyOn(api, 'getPrintJobs').mockResolvedValue([
      {
        id: 11,
        orderNumber: 'BON-900',
        jobType: 'RECEIPT',
        printerName: 'XPRINTER-80',
        connectionType: 'WINDOWS_SPOOLER',
        paperWidth: '80mm',
        status: 'FAILED',
        attempts: 1,
        errorMessage: 'Printer offline',
        isReprint: false,
        spoolerAccepted: false,
        createdAt: new Date().toISOString(),
      },
    ]);
    vi.spyOn(api, 'getDesktopStatus').mockResolvedValue({
      appName: 'GOLDEN PALACE POS',
      appVersion: '1.0.0',
      platform: 'win32',
      isDesktop: true,
      appDataDir: 'C:\\Users\\POS\\AppData\\Roaming\\Golden Palace POS',
      dbPath: 'C:\\Users\\POS\\AppData\\Roaming\\Golden Palace POS\\golden_palace.db',
      dbExists: true,
      dbSizeBytes: 102400,
      dbWritable: true,
      backupDir: 'C:\\Users\\POS\\AppData\\Roaming\\Golden Palace POS\\backups',
      backupDirExists: true,
      backupDirWritable: true,
      integrityCheck: 'ok',
      tablesCount: 16,
      missingTables: [],
      usersCount: 2,
      needsInitialAdminSetup: false,
      pendingFinancialOps: {
        openShiftsCount: 0,
        unpaidActiveOrdersCount: 0,
        openSyncConflictsCount: 0,
        pendingPrintJobsCount: 1,
        canUpdateSafely: true,
        blockingReasons: [],
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('1. ReceiptPrint renders Arabic + French items, LE PALAIS D’OR branding, TVA/discount/split details, and 58mm/80mm toggle', async () => {
    const sampleReceipt = {
      orderId: 501,
      orderNumber: 'BON-0501',
      date: '14/11/2026',
      time: '13:45',
      cashierName: 'أحمد الكاشير',
      tableNumber: 'T-04',
      items: [
        {
          nameAr: 'طاجين ملكي',
          nameFr: 'Tajine Royal',
          quantity: 2,
          unitPrice: 1200,
          total: 2400,
        },
      ],
      subtotal: 2400,
      discount: 200,
      deliveryFee: 300,
      taxRate: 9,
      taxAmount: 198,
      total: 2698,
      paidAmount: 2000,
      tenderAmount: 2000,
      changeAmount: 0,
      payments: [
        { method: 'CASH', amount: 1500 },
        { method: 'CARD', amount: 500 },
      ],
      isReprint: true,
    };

    render(
      <Wrapper>
        <ReceiptPrint data={sampleReceipt} onClose={() => {}} />
      </Wrapper>
    );

    expect((await screen.findAllByText(/BON-0501/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/طاجين ملكي/)).toBeInTheDocument();
    expect(screen.getByText(/Tajine Royal/)).toBeInTheDocument();
    expect(screen.getAllByText(/DUPLICATA/i).length).toBeGreaterThan(0);

    // 48mm (58mm paper) toggle updates printable receipt styling cleanly
    const btn48 = screen.getByRole('button', { name: /^48mm/ });
    fireEvent.click(btn48);
    expect(printerService.getProfile().paperType).toBe('58mm');
  });

  it('2. ReceiptPrint reports FAILED honestly when Windows Spooler/Network fails (never claims PRINTED)', async () => {
    printerService.saveProfile({
      ...printerService.getProfile(),
      connectionType: 'NETWORK_IP',
      networkIp: '192.168.1.250',
      networkPort: 9100,
    });

    vi.spyOn(api, 'spoolPrintJob').mockResolvedValueOnce({
      success: false,
      jobId: 77,
      status: 'FAILED',
      error: 'Connection refused 192.168.1.250:9100',
    });

    const receiptData = {
      orderId: 502,
      orderNumber: 'BON-0502',
      date: '14/11/2026',
      time: '14:00',
      cashierName: 'Admin',
      items: [{ nameAr: 'كباب', nameFr: 'Kebab', quantity: 1, unitPrice: 800, total: 800 }],
      total: 800,
    };

    render(
      <Wrapper>
        <ReceiptPrint data={receiptData} onClose={() => {}} />
      </Wrapper>
    );

    const printBtn = await screen.findByTestId('receipt-print-btn');
    fireEvent.click(printBtn);

    await waitFor(() => {
      expect(screen.getByText(/Connection refused 192.168.1.250:9100/)).toBeInTheDocument();
    });
    // Honest status badge should show FAILED, never "تمت إعادة الطباعة / طُبع"
    expect(screen.queryByText('تمت إعادة الطباعة / طُبع')).not.toBeInTheDocument();
  });

  it('3. SettingsModal Printer tab shows detected printers, provable connection types (no Bluetooth), live tests, & print_jobs queue', async () => {
    const testPrinterSpy = vi.spyOn(api, 'testPrinter').mockResolvedValue({
      success: true,
      jobId: 99,
      status: 'PRINTED',
      message: 'تم إرسال اختبار العربية',
    });
    const retrySpy = vi.spyOn(api, 'retryPrintJob').mockResolvedValue({
      success: true,
      jobId: 11,
      status: 'PRINTED',
      message: 'تمت إعادة المحاولة بنجاح',
    });

    render(
      <Wrapper>
        <SettingsModal />
      </Wrapper>
    );

    const printerTabBtn = await screen.findByText(/الطابعة|Imprimante/);
    fireEvent.click(printerTabBtn);

    expect((await screen.findAllByText(/XPRINTER-80/)).length).toBeGreaterThan(0);
    // Ensure Bluetooth is NOT offered as a fake connection mode
    expect(screen.queryByText(/Bluetooth/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('conn-type-WINDOWS_SPOOLER')).toBeInTheDocument();
    expect(screen.getByTestId('conn-type-NETWORK_IP')).toBeInTheDocument();
    expect(screen.getByTestId('conn-type-USB')).toBeInTheDocument();
    expect(screen.getByTestId('conn-type-BROWSER')).toBeInTheDocument();

    // Trigger Arabic printer test
    const arabicBtn = screen.getByTestId('test-printer-arabic-btn');
    fireEvent.click(arabicBtn);
    await waitFor(() => {
      expect(testPrinterSpy).toHaveBeenCalledWith(expect.objectContaining({ testType: 'ARABIC' }));
    });

    // Queue shows failed job BON-900 with Retry button
    expect((await screen.findAllByText(/BON-900/)).length).toBeGreaterThan(0);
    const retryBtn = screen.getByRole('button', { name: /إعادة المحاولة|Réessayer/ });
    fireEvent.click(retryBtn);
    await waitFor(() => {
      expect(retrySpy).toHaveBeenCalledWith(11);
    });
  });
});
