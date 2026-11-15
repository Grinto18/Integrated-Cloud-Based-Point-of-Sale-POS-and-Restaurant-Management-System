// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { LanguageProvider, useLanguage } from '../context/LanguageContext.tsx';
import { PosProvider, usePos } from '../context/PosContext.tsx';
import { MenuManagement } from '../components/MenuManagement.tsx';
import { InventoryManager } from '../components/InventoryManager.tsx';
import { WasteManager } from '../components/WasteManager.tsx';
import { PurchasesManager } from '../components/PurchasesManager.tsx';
import { CustomersManager } from '../components/CustomersManager.tsx';
import { DeliveryManager } from '../components/DeliveryManager.tsx';
import { AuditLogView } from '../components/AuditLogView.tsx';
import { SettingsModal } from '../components/SettingsModal.tsx';
import { ReceiptPrint } from '../components/ReceiptPrint.tsx';
import { api } from '../services/api.ts';

vi.mock('../context/AuthContext.tsx', () => ({
  useAuth: () => ({
    user: { id: 1, uid: 'u-admin', username: 'admin', fullName: 'المدير العام', role: 'ADMIN', isActive: true },
    token: 'mock-admin-token',
    isLoading: false,
    isLocked: false,
    canAccessProtectedApi: true,
    hasRole: () => true,
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

describe('Golden Palace POS — Phase 06 Backoffice UI Unification & Completion (Frontend)', () => {
  let alertSpy: any;
  let confirmSpy: any;
  let promptSpy: any;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('golden_palace_auth_token', 'mock-admin-token');
    vi.restoreAllMocks();
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('syncs default_language and tax_rate on startup via LanguageContext & PosContext', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({
      default_language: 'fr',
      tax_rate: '19',
      restaurant_name: 'GOLDEN PALACE',
    });
    vi.spyOn(api, 'getCurrentShift').mockResolvedValue({ isOpen: false });
    vi.spyOn(api, 'getOrders').mockResolvedValue([]);
    vi.spyOn(api, 'getCashierDashboard').mockResolvedValue({});

    const Probe: React.FC = () => {
      const { lang } = useLanguage();
      const { taxRate } = usePos();
      return (
        <div>
          <span data-testid="probe-lang">{lang}</span>
          <span data-testid="probe-tax">{taxRate}</span>
        </div>
      );
    };

    render(
      <TestWrapper>
        <Probe />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByTestId('probe-lang')).toHaveTextContent('fr');
      expect(screen.getByTestId('probe-tax')).toHaveTextContent('19');
    });
  });

  it('renders MenuManagement with profit margins, category edit modal, recipe cost calculator, and in-app disable confirmation without window.confirm', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ tax_rate: '0' });
    vi.spyOn(api, 'getCurrentShift').mockResolvedValue({ isOpen: false });
    vi.spyOn(api, 'getOrders').mockResolvedValue([]);
    vi.spyOn(api, 'getCashierDashboard').mockResolvedValue({});
    vi.spyOn(api, 'getCategories').mockResolvedValue([
      { id: 1, nameAr: 'مشاوي', nameFr: 'Grillades', sortOrder: 1, isActive: true, station: 'GRILL' },
    ]);
    vi.spyOn(api, 'getProducts').mockResolvedValue([
      {
        id: 11,
        categoryId: 1,
        nameAr: 'كباب ملكي',
        nameFr: 'Kebab Royal',
        price: 1500,
        costPrice: 600,
        isAvailable: true,
        station: 'GRILL',
        recipes: [{ id: 1, productId: 11, ingredientId: 5, quantity: 0.5, ingredientName: 'لحم مفروم', ingredientCostPerUnit: 2000 }],
        variants: [],
        addons: [],
      },
    ]);
    vi.spyOn(api, 'getInventory').mockResolvedValue([
      { id: 5, nameAr: 'لحم مفروم', nameFr: 'Viande', unit: 'KG', currentStock: 20, minStock: 5, costPerUnit: 2000 },
    ]);
    const deleteProdSpy = vi.spyOn(api, 'deleteProduct').mockResolvedValue({ success: true, isAvailable: false });

    render(
      <TestWrapper>
        <MenuManagement />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getAllByText('كباب ملكي').length).toBeGreaterThanOrEqual(1);
    });

    // Check profit margin displayed (1500 - 600 = 900 -> 60%)
    expect(screen.getAllByText(/\+900 DA \(60%\)/).length).toBeGreaterThanOrEqual(1);

    // Open Edit Product modal & verify live recipe cost calculator button (0.5 * 2000 = 1000 DA)
    const editButtons = screen.getAllByTitle('تعديل');
    fireEvent.click(editButtons[0]);
    await waitFor(() => {
      expect(screen.getByText(/تطبيق تكلفة الوصفة: 1000 DA/)).toBeInTheDocument();
    });
    // Close modal
    fireEvent.click(screen.getByText('حفظ الطبق').closest('div')!.querySelector('button')!);

    // In-app disable confirmation instead of window.confirm
    const disableBtns = screen.getAllByTitle('تعطيل الطبق');
    fireEvent.click(disableBtns[0]);
    await waitFor(() => {
      expect(screen.getByText('تأكيد التعطيل')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('تأكيد التعطيل'));

    await waitFor(() => {
      expect(deleteProdSpy).toHaveBeenCalledWith(11);
    });
  });

  it('renders InventoryManager with KPIs, openingStock creation, and movements ledger modal', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ tax_rate: '0' });
    vi.spyOn(api, 'getCurrentShift').mockResolvedValue({ isOpen: false });
    vi.spyOn(api, 'getOrders').mockResolvedValue([]);
    vi.spyOn(api, 'getCashierDashboard').mockResolvedValue({});
    vi.spyOn(api, 'getInventory').mockResolvedValue([
      { id: 5, nameAr: 'لحم مفروم', nameFr: 'Viande hachée', unit: 'KG', currentStock: 3, minStock: 5, maxStock: 30, costPerUnit: 1800 },
    ]);
    vi.spyOn(api, 'getSuppliers').mockResolvedValue([]);
    const createIngSpy = vi.spyOn(api, 'createIngredient').mockResolvedValue({ id: 6, nameAr: 'زيت زيتون', unit: 'L', currentStock: 10, minStock: 2, costPerUnit: 900 });
    const movSpy = vi.spyOn(api, 'getInventoryMovements').mockResolvedValue([
      { id: 1, ingredientId: 5, ingredientNameAr: 'لحم مفروم', unit: 'KG', type: 'OPENING_STOCK', quantity: 10, createdAt: '2026-11-14T10:00:00Z' },
    ]);

    render(
      <TestWrapper>
        <InventoryManager />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getAllByText('لحم مفروم').length).toBeGreaterThanOrEqual(1);
    });

    // Open New Ingredient modal & submit openingStock
    fireEvent.click(screen.getByText('مادة أولية جديدة'));
    fireEvent.change(screen.getByPlaceholderText('لحم مفروم'), { target: { value: 'زيت زيتون' } });
    fireEvent.click(screen.getByText('حفظ المادة'));

    await waitFor(() => {
      expect(createIngSpy).toHaveBeenCalled();
    });

    // Open Movements ledger modal
    fireEvent.click(screen.getByText('سجل الحركات'));
    await waitFor(() => {
      expect(movSpy).toHaveBeenCalled();
      expect(screen.getAllByText('رصيد افتتاحي').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders AuditLogView with pagination, filters, immutability notice, and zero mutation buttons', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ tax_rate: '0' });
    vi.spyOn(api, 'getCurrentShift').mockResolvedValue({ isOpen: false });
    vi.spyOn(api, 'getOrders').mockResolvedValue([]);
    vi.spyOn(api, 'getCashierDashboard').mockResolvedValue({});
    vi.spyOn(api, 'getUsers').mockResolvedValue([
      { id: 1, uid: 'u1', username: 'admin', email: 'a@b.c', role: 'ADMIN', fullName: 'المدير العام', isActive: true },
    ]);
    vi.spyOn(api, 'getAuditLogsPaginated').mockResolvedValue({
      items: [
        { id: 10, userId: 1, userName: 'المدير العام', action: 'UPDATE_SETTINGS', details: 'Tax rate updated', createdAt: '2026-11-14 12:00:00' },
      ],
      total: 1,
      page: 1,
      limit: 25,
      totalPages: 1,
      availableActions: ['UPDATE_SETTINGS'],
    });

    render(
      <TestWrapper>
        <AuditLogView />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('سجل أمان العمليات والرقابة')).toBeInTheDocument();
      expect(screen.getByText('سجل رقابي غير قابل للتعديل أو الحذف')).toBeInTheDocument();
      expect(screen.getAllByText('Tax rate updated').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText('CSV')).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
    expect(screen.queryByText('حذف')).not.toBeInTheDocument();
  });

  it('renders SettingsModal with General Settings persistence and Staff RBAC PIN reset without displaying plaintext PINs', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({
      tax_rate: '0',
      default_language: 'ar',
      restaurant_name: 'GOLDEN PALACE POS',
    });
    vi.spyOn(api, 'getCurrentShift').mockResolvedValue({ isOpen: false });
    vi.spyOn(api, 'getOrders').mockResolvedValue([]);
    vi.spyOn(api, 'getCashierDashboard').mockResolvedValue({});
    const updateSettingsSpy = vi.spyOn(api, 'updateSettings').mockResolvedValue({ success: true });
    vi.spyOn(api, 'getUsers').mockResolvedValue([
      { id: 1, uid: 'u1', username: 'admin', email: 'admin@gp.dz', role: 'ADMIN', fullName: 'المدير العام', isActive: true, hasPin: true },
      { id: 2, uid: 'u2', username: 'cashier1', email: 'c1@gp.dz', role: 'CASHIER', fullName: 'سفيان كاشير', isActive: true, hasPin: true },
    ]);
    const updateUserSpy = vi.spyOn(api, 'updateUser').mockResolvedValue({
      id: 2,
      uid: 'u2',
      username: 'cashier1',
      email: 'c1@gp.dz',
      role: 'CASHIER',
      fullName: 'سفيان كاشير',
      isActive: true,
      hasPin: true,
    });

    render(
      <TestWrapper>
        <SettingsModal />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('GOLDEN PALACE POS')).toBeInTheDocument();
    });

    // Save General Settings
    fireEvent.click(screen.getByText('حفظ الإعدادات'));
    await waitFor(() => {
      expect(updateSettingsSpy).toHaveBeenCalled();
    });

    // Switch to Staff RBAC tab
    fireEvent.click(screen.getByText('الموظفين والأدوار (RBAC)'));
    await waitFor(() => {
      expect(screen.getByText('سفيان كاشير')).toBeInTheDocument();
      expect(screen.getAllByText('•••• (مفعّل)').length).toBe(2);
    });

    // Open PIN reset modal for cashier1 & reset encrypted PIN
    const pinButtons = screen.getAllByTitle('إعادة تعيين رمز PIN');
    fireEvent.click(pinButtons[1]);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('••••')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText('••••'), { target: { value: '4567' } });
    fireEvent.click(screen.getByText('حفظ رمز PIN'));

    await waitFor(() => {
      expect(updateUserSpy).toHaveBeenCalledWith(2, { pin: '4567' });
    });
    // Plaintext PIN must NOT remain rendered in table
    expect(screen.queryByText('4567')).not.toBeInTheDocument();
  });

  it('renders WasteManager, PurchasesManager, CustomersManager, DeliveryManager, and ReceiptPrint cleanly without browser alerts', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ tax_rate: '0' });
    vi.spyOn(api, 'getCurrentShift').mockResolvedValue({ isOpen: false });
    vi.spyOn(api, 'getOrders').mockResolvedValue([]);
    vi.spyOn(api, 'getCashierDashboard').mockResolvedValue({});
    vi.spyOn(api, 'getWasteRecords').mockResolvedValue([
      { id: 1, name: 'طماطم', quantity: 2, unit: 'KG', cost: 400, reason: 'EXPIRED', createdAt: '2026-11-14T08:00:00Z' },
    ]);
    vi.spyOn(api, 'getInventory').mockResolvedValue([]);
    vi.spyOn(api, 'getPurchases').mockResolvedValue([]);
    vi.spyOn(api, 'getSuppliers').mockResolvedValue([]);
    vi.spyOn(api, 'getCustomers').mockResolvedValue([
      { id: 1, name: 'أمين بوزيد', phone: '0550001122', totalOrders: 3, totalSpent: '4500' },
    ]);
    vi.spyOn(api, 'getDeliveries').mockResolvedValue([
      { id: 1, orderId: 10, orderNumber: 'ORD-010', customerAddress: 'حسين داي', deliveryFee: 200, status: 'PENDING', total: '2000' },
    ]);

    render(
      <TestWrapper>
        <div>
          <WasteManager />
          <PurchasesManager />
          <CustomersManager />
          <DeliveryManager />
          <ReceiptPrint
            data={{
              orderNumber: 'ORD-REC-1',
              orderType: 'TAKEAWAY',
              items: [{ nameAr: 'شاورما', quantity: 1, unitPrice: 500, total: 500 }],
              subtotal: 500,
              discount: 0,
              deliveryFee: 0,
              total: 500,
              time: '12:00:00',
              date: '14/11/2026',
            }}
            onClose={() => {}}
          />
        </div>
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getAllByText('طماطم').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('أمين بوزيد').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('ORD-010').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('المشتريات والموردين')).toBeInTheDocument();
    });
  });
});
