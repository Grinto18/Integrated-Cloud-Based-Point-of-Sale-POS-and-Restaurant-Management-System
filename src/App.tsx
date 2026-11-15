import React, { useState, useEffect, Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { LanguageProvider, useLanguage } from './context/LanguageContext.tsx';
import { PosProvider, usePos } from './context/PosContext.tsx';
import { Header } from './components/Header.tsx';
import { Navigation, ActiveTab } from './components/Navigation.tsx';
import { CashierDashboardBar } from './components/CashierDashboardBar.tsx';
import { PosTerminal } from './components/PosTerminal.tsx';
import { PaymentModal } from './components/PaymentModal.tsx';
import { CashRegisterModal } from './components/CashRegisterModal.tsx';
import { HeldOrdersModal } from './components/HeldOrdersModal.tsx';
import { ReceiptPrint } from './components/ReceiptPrint.tsx';
import { LoginModal } from './components/LoginModal.tsx';
import { Order } from './types.ts';
import { api, generateUuid } from './services/api.ts';
import { printerService } from './services/printerService.ts';
import { AlertTriangle, X } from 'lucide-react';

const TableMap = lazy(() => import('./components/TableMap.tsx').then((m) => ({ default: m.TableMap })));
const OrdersView = lazy(() => import('./components/OrdersView.tsx').then((m) => ({ default: m.OrdersView })));
const KitchenDisplay = lazy(() => import('./components/KitchenDisplay.tsx').then((m) => ({ default: m.KitchenDisplay })));
const MenuManagement = lazy(() => import('./components/MenuManagement.tsx').then((m) => ({ default: m.MenuManagement })));
const InventoryManager = lazy(() => import('./components/InventoryManager.tsx').then((m) => ({ default: m.InventoryManager })));
const WasteManager = lazy(() => import('./components/WasteManager.tsx').then((m) => ({ default: m.WasteManager })));
const PurchasesManager = lazy(() => import('./components/PurchasesManager.tsx').then((m) => ({ default: m.PurchasesManager })));
const CustomersManager = lazy(() => import('./components/CustomersManager.tsx').then((m) => ({ default: m.CustomersManager })));
const DeliveryManager = lazy(() => import('./components/DeliveryManager.tsx').then((m) => ({ default: m.DeliveryManager })));
const ExpensesManager = lazy(() => import('./components/ExpensesManager.tsx').then((m) => ({ default: m.ExpensesManager })));
const ReportsView = lazy(() => import('./components/ReportsView.tsx').then((m) => ({ default: m.ReportsView })));
const AuditLogView = lazy(() => import('./components/AuditLogView.tsx').then((m) => ({ default: m.AuditLogView })));
const SettingsModal = lazy(() => import('./components/SettingsModal.tsx').then((m) => ({ default: m.SettingsModal })));
const SyncCenter = lazy(() => import('./components/SyncCenter.tsx').then((m) => ({ default: m.SyncCenter })));

const MainAppContent: React.FC = () => {
  const { user, isLocked, isLoading } = useAuth();
  const { t } = useLanguage();
  const {
    receiptToPrint,
    setReceiptToPrint,
    cart,
    activeOrderId,
    setActiveOrderId,
    isShiftOpen,
    subtotal,
    discount,
    deliveryFee,
    deliveryAddress,
    taxRate,
    taxAmount,
    notes,
    total,
    orderType,
    selectedTable,
    selectedCustomer,
    clearCart,
    openCashDrawer,
    refreshShift,
    refreshHeldOrders,
    refreshDashboard,
    refreshOfflineCount,
  } = usePos();

  const [activeTab, setActiveTab] = useState<ActiveTab>('pos');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false);
  const [existingOrderForPayment, setExistingOrderForPayment] = useState<Order | null>(null);
  const [showCashRegisterModal, setShowCashRegisterModal] = useState<boolean>(false);
  const [showHeldOrdersModal, setShowHeldOrdersModal] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Clear shift error automatically once a shift is opened
  useEffect(() => {
    if (isShiftOpen && globalError) {
      setGlobalError(null);
    }
  }, [isShiftOpen]);

  // Role-aware initial workspace if default 'pos' is outside user's role
  useEffect(() => {
    if (!isLoading && user && !isLocked) {
      if (user.role === 'KITCHEN') setActiveTab('kitchen');
      else if (user.role === 'INVENTORY') setActiveTab('inventory');
      else setActiveTab('pos');

      if (['ADMIN', 'MANAGER', 'CASHIER', 'WAITER'].includes(user.role)) {
        refreshShift();
        refreshHeldOrders();
        refreshDashboard();
      }
    }
  }, [isLoading, user?.id, user?.role, isLocked]);

  // Global POS Keyboard Shortcuts (F1, F2, F3, F5, F10, F12, Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setActiveTab('pos');
      } else if (e.key === 'F1') {
        e.preventDefault();
        setActiveTab('purchases');
      } else if (e.key === 'F3') {
        e.preventDefault();
        setActiveTab('menu');
      } else if (e.key === 'F5') {
        e.preventDefault();
        setActiveTab('customers');
      } else if (e.key === 'F10') {
        e.preventDefault();
        setActiveTab('reports');
      } else if (e.key === 'F12') {
        e.preventDefault();
        setShowCashRegisterModal((prev) => !prev);
      } else if (e.key === 'Escape') {
        setShowPaymentModal(false);
        setExistingOrderForPayment(null);
        setShowCashRegisterModal(false);
        setShowHeldOrdersModal(false);
        setReceiptToPrint(null);
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isCheckingOutRef = React.useRef(false);
  const pendingCheckoutUuidRef = React.useRef<{ signature: string; uuid: string } | null>(null);

  // Reset stored checkout UUID only when cart becomes empty
  useEffect(() => {
    if (cart.length === 0) {
      pendingCheckoutUuidRef.current = null;
    }
  }, [cart.length]);

  // Quick 1-click Cash Checkout
  const handleQuickCheckout = async (printTicket: boolean) => {
    if (cart.length === 0 || isCheckingOutRef.current) return;
    isCheckingOutRef.current = true;
    setGlobalError(null);
    let createdOrder: any = null;

    try {
      // Pre-flight check: verify shift is open online before creating a new order
      if (!isShiftOpen && (typeof navigator === 'undefined' || navigator.onLine)) {
        const liveShift = await api.getCurrentShift().catch(() => null);
        if (!liveShift || (!liveShift.isOpen && liveShift.shift?.status !== 'OPEN' && liveShift.status !== 'OPEN')) {
          await refreshShift();
          setGlobalError(
            t(
              'يرجى فتح وردية الصندوق أولاً قبل استقبال المدفوعات',
              'Veuillez ouvrir une session de caisse avant d’encaisser'
            )
          );
          setShowCashRegisterModal(true);
          return;
        }
      }

      const cartSignature = JSON.stringify({
        orderType,
        tableId: selectedTable?.id || null,
        customerId: selectedCustomer?.id || null,
        discount,
        deliveryFee,
        total,
        items: cart.map((c) => ({ p: c.productId, q: c.quantity, u: c.unitPrice })),
      });
      if (!pendingCheckoutUuidRef.current || pendingCheckoutUuidRef.current.signature !== cartSignature) {
        pendingCheckoutUuidRef.current = {
          signature: cartSignature,
          uuid: generateUuid(),
        };
      }
      const checkoutUuid = pendingCheckoutUuidRef.current.uuid;
      const checkoutKey = `chk-${checkoutUuid}`;
      const safeCustomerId =
        selectedCustomer?.id && selectedCustomer.id > 0 ? selectedCustomer.id : undefined;
      const orderRes = activeOrderId
        ? await api.appendOrderItems(activeOrderId, {
            items: cart,
            replaceAll: true,
            discount,
            deliveryFee,
            notes,
            sendToKitchen: false,
          })
        : await api.createOrder({
            offlineId: `off-${checkoutUuid}`,
            operationId: checkoutUuid,
            type: orderType,
            tableId: selectedTable?.id,
            tableNumber: selectedTable?.tableNumber,
            customerId: safeCustomerId,
            deliveryAddress: orderType === 'DELIVERY' ? deliveryAddress : undefined,
            items: cart,
            discount,
            deliveryFee,
            taxRate,
            taxAmount,
            subtotal,
            total,
            notes: notes || null,
            isHeld: false,
            idempotencyKey: `ord-${checkoutKey}`,
          });
      createdOrder = orderRes;

      await api.processPayment({
        orderId: orderRes.id,
        offlineId: orderRes.offline ? orderRes.offlineId : undefined,
        payments: [{ method: 'CASH', amount: total, tenderAmount: total, changeAmount: 0 }],
        idempotencyKey: `pay-${checkoutKey}`,
        operationId: checkoutUuid,
      });

      pendingCheckoutUuidRef.current = null;

      openCashDrawer();

      const receiptData = {
        orderId: orderRes.id && orderRes.id > 0 ? orderRes.id : null,
        orderNumber: orderRes.orderNumber,
        dailySequence: orderRes.dailySequence,
        tableNumber: selectedTable?.tableNumber,
        customerName: selectedCustomer?.name,
        orderType,
        items: [...cart],
        subtotal,
        discount,
        deliveryFee,
        taxRate,
        taxAmount,
        total,
        paidAmount: total,
        paymentMethod: 'CASH',
        payments: [{ method: 'CASH', amount: total, tenderAmount: total, changeAmount: 0 }],
        tenderAmount: total,
        changeAmount: 0,
        cashierName: user?.fullName || 'Admin',
        time: new Date().toLocaleTimeString('fr-FR'),
        date: new Date().toLocaleDateString('fr-FR'),
      };

      if (printTicket) {
        const p = printerService.getProfile();
        const printRes = await printerService.sendDirectPrintJob(receiptData, p, { isReprint: false });
        setReceiptToPrint({
          ...receiptData,
          printJobRecordId: printRes.jobId || null,
          spoolerAccepted: printRes.spoolerAccepted,
          hardwareConfirmed: printRes.hardwareConfirmed,
          alreadyAutoPrinted: printRes.success,
          autoPrintError: printRes.success ? undefined : printRes.message,
        });
      }

      clearCart();
      await refreshShift();
      await refreshDashboard();
      await refreshOfflineCount();
    } catch (err: any) {
      const msg = err?.message || t('فشل إتمام البيع السريع', 'Échec du paiement rapide');
      // If order was created right before payment failed (e.g. closed shift), attach activeOrderId so retry updates instead of duplicating
      if (createdOrder?.id && !activeOrderId && !createdOrder.offline) {
        setActiveOrderId(createdOrder.id, createdOrder.orderNumber);
      }
      if (msg.includes('وردية الصندوق')) {
        await refreshShift();
        setShowCashRegisterModal(true);
      } else {
        console.error('Quick checkout failed:', err);
      }
      setGlobalError(msg);
    } finally {
      isCheckingOutRef.current = false;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#171717] flex flex-col items-center justify-center text-[#C6A15B] gap-4">
        <div className="w-14 h-14 border-4 border-[#C6A15B] border-t-transparent rounded-full animate-spin" />
        <p className="font-extrabold text-lg tracking-wide text-[#F7F3EA]">
          {t('جاري تشغيل GOLDEN PALACE POS...', 'Démarrage GOLDEN PALACE POS...')}
        </p>
      </div>
    );
  }

  if (!user || isLocked) {
    return <LoginModal />;
  }

  const openPaymentForOrder = (ord: Order) => {
    setExistingOrderForPayment(ord);
    setShowPaymentModal(true);
  };

  return (
    <div className="h-screen max-h-screen w-full flex flex-col bg-[#171717] text-[#F7F3EA] overflow-hidden font-sans select-none">
      {/* Top Header */}
      <Header
        onOpenCashRegisterModal={() => setShowCashRegisterModal(true)}
        onOpenHeldOrdersModal={() => setShowHeldOrdersModal(true)}
        onOpenSyncCenter={() => setActiveTab('sync')}
        onToggleMobileSidebar={() => setMobileSidebarOpen(true)}
      />

      {globalError && (
        <div className="bg-red-950/90 border-b border-red-600/70 text-red-200 px-4 py-2 text-xs font-black flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-[#C6A15B]" />
            <span>{globalError}</span>
          </div>
          <div className="flex items-center gap-2">
            {!isShiftOpen && (
              <button
                type="button"
                onClick={() => setShowCashRegisterModal(true)}
                className="px-3 py-1 rounded-lg bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black text-xs cursor-pointer"
              >
                {t('فتح الوردية الآن', 'Ouvrir Caisse')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setGlobalError(null)}
              className="text-red-300 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Body: Sidebar + Center Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden w-full">
        <Navigation
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            if (tab === 'caisse') {
              setShowCashRegisterModal(true);
            }
          }}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* Live Cashier Dashboard Strip */}
          {(activeTab === 'pos' || activeTab === 'tables' || activeTab === 'orders') && (
            <CashierDashboardBar
              onOpenCashRegisterModal={() => setShowCashRegisterModal(true)}
              onOpenOrdersTab={() => setActiveTab('orders')}
            />
          )}

          {/* Main Workspace */}
          <main className="flex-1 flex overflow-hidden min-h-0 relative w-full">
            {activeTab === 'pos' && (
              <PosTerminal
                onOpenPaymentModal={() => {
                  setExistingOrderForPayment(null);
                  setShowPaymentModal(true);
                }}
                onNavigateToTables={() => setActiveTab('tables')}
                onOpenHeldOrders={() => setShowHeldOrdersModal(true)}
                onQuickCheckout={handleQuickCheckout}
              />
            )}
            {activeTab === 'caisse' && (
              <div className="flex-1 flex items-center justify-center p-6 bg-[#171717]">
                <button
                  type="button"
                  onClick={() => setShowCashRegisterModal(true)}
                  className="py-5 px-10 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black text-xl rounded-2xl shadow-xl transition cursor-pointer"
                >
                  {t('فتح لوحة إدارة الصندوق والورديات (F12)', 'Ouvrir Gestion Caisse (F12)')}
                </button>
              </div>
            )}
            {activeTab !== 'pos' && activeTab !== 'caisse' && (
              <Suspense
                fallback={
                  <div className="flex-1 flex flex-col items-center justify-center bg-[#171717] text-[#C6A15B] gap-3">
                    <div className="w-10 h-10 border-4 border-[#C6A15B] border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-bold text-[#F7F3EA]">
                      {t('جاري تحميل الوحدة...', 'Chargement du module...')}
                    </span>
                  </div>
                }
              >
                {activeTab === 'tables' && (
                  <TableMap
                    onSelectTableForOrder={() => setActiveTab('pos')}
                    onPayOrder={openPaymentForOrder}
                  />
                )}
                {activeTab === 'orders' && (
                  <OrdersView
                    onOpenInPos={() => setActiveTab('pos')}
                    onPayOrder={openPaymentForOrder}
                  />
                )}
                {activeTab === 'kitchen' && <KitchenDisplay />}
                {activeTab === 'sync' && <SyncCenter />}
                {activeTab === 'menu' && <MenuManagement />}
                {activeTab === 'inventory' && <InventoryManager />}
                {activeTab === 'waste' && <WasteManager />}
                {activeTab === 'purchases' && <PurchasesManager />}
                {activeTab === 'customers' && <CustomersManager />}
                {activeTab === 'delivery' && <DeliveryManager />}
                {activeTab === 'expenses' && <ExpensesManager />}
                {activeTab === 'reports' && <ReportsView />}
                {activeTab === 'audit' && <AuditLogView />}
                {activeTab === 'settings' && <SettingsModal />}
              </Suspense>
            )}
          </main>
        </div>
      </div>

      {/* Modals */}
      <PaymentModal
        isOpen={showPaymentModal}
        existingOrder={existingOrderForPayment}
        onClose={() => {
          setShowPaymentModal(false);
          setExistingOrderForPayment(null);
        }}
        onOpenCashRegisterModal={() => {
          setShowPaymentModal(false);
          setShowCashRegisterModal(true);
        }}
        onSuccess={async (receiptData) => {
          if (receiptData?.shouldPrint) {
            const p = printerService.getProfile();
            const printRes = await printerService.sendDirectPrintJob(receiptData, p, { isReprint: false });
            setReceiptToPrint({
              ...receiptData,
              printJobRecordId: printRes.jobId || null,
              spoolerAccepted: printRes.spoolerAccepted,
              hardwareConfirmed: printRes.hardwareConfirmed,
              alreadyAutoPrinted: printRes.success,
              autoPrintError: printRes.success ? undefined : printRes.message,
            });
          } else {
            setReceiptToPrint(receiptData);
          }
        }}
      />

      <CashRegisterModal
        isOpen={showCashRegisterModal}
        onClose={() => setShowCashRegisterModal(false)}
      />

      <HeldOrdersModal
        isOpen={showHeldOrdersModal}
        onClose={() => setShowHeldOrdersModal(false)}
      />

      {receiptToPrint && (
        <ReceiptPrint data={receiptToPrint} onClose={() => setReceiptToPrint(null)} />
      )}
    </div>
  );
};

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <PosProvider>
          <MainAppContent />
        </PosProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
