import React, { useState, useEffect } from 'react';
import { usePos } from '../context/PosContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { Order, PaymentMethod } from '../types.ts';
import { api, generateUuid } from '../services/api.ts';
import {
  X,
  Check,
  CreditCard,
  Banknote,
  Smartphone,
  Building,
  Landmark,
  Wallet,
  Printer,
  AlertTriangle,
  Plus,
  Trash2,
} from 'lucide-react';

interface PaymentModalProps {
  isOpen: boolean;
  existingOrder?: Order | null;
  onClose: () => void;
  onSuccess: (receiptData: any) => void;
  onOpenCashRegisterModal?: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  existingOrder = null,
  onClose,
  onSuccess,
  onOpenCashRegisterModal,
}) => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const {
    cart,
    activeOrderId,
    setActiveOrderId,
    orderType,
    selectedTable,
    selectedCustomer,
    discount,
    deliveryFee,
    deliveryAddress,
    taxRate,
    taxAmount,
    notes,
    subtotal,
    total,
    isShiftOpen,
    clearCart,
    openCashDrawer,
    refreshShift,
    refreshDashboard,
    refreshOfflineCount,
  } = usePos();

  const orderTotal = existingOrder ? Number(existingOrder.total) : total;
  const alreadyPaid = existingOrder ? Number(existingOrder.paidAmount || 0) : 0;
  const amountDue = Math.max(0, orderTotal - alreadyPaid);

  interface SplitLeg {
    id: string;
    method: PaymentMethod;
    amount: number;
    tenderAmount: number;
    changeAmount: number;
    transactionRef?: string;
  }

  const [activeMethod, setActiveMethod] = useState<PaymentMethod>('CASH');
  const [payAmountInput, setPayAmountInput] = useState<string>(String(amountDue));
  const [tenderInput, setTenderInput] = useState<string>(String(amountDue));
  const [isPartialMode, setIsPartialMode] = useState<boolean>(false);
  const [isSplitMode, setIsSplitMode] = useState<boolean>(false);
  const [splitLegs, setSplitLegs] = useState<SplitLeg[]>([]);
  const [splitAmountInput, setSplitAmountInput] = useState<string>(String(amountDue));
  const [splitRefInput, setSplitRefInput] = useState<string>('');
  const [printReceiptOnSuccess, setPrintReceiptOnSuccess] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const pendingPaymentUuidRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
      setActiveMethod('CASH');
      setIsPartialMode(false);
      setIsSplitMode(false);
      setSplitLegs([]);
      setSplitAmountInput(String(amountDue));
      setSplitRefInput('');
      setPayAmountInput(String(amountDue));
      setTenderInput(String(amountDue));
      pendingPaymentUuidRef.current = generateUuid();
    } else {
      pendingPaymentUuidRef.current = null;
    }
  }, [isOpen, amountDue]);

  if (!isOpen) return null;

  const splitSum = splitLegs.reduce((s, l) => s + l.amount, 0);
  const remainingForSplit = Math.max(0, amountDue - splitSum);

  const payAmount = isSplitMode
    ? splitSum
    : isPartialMode
    ? Math.min(amountDue, Math.max(0, parseFloat(payAmountInput) || 0))
    : amountDue;
  const tenderNum = isSplitMode
    ? splitLegs.reduce((s, l) => s + l.tenderAmount, 0)
    : activeMethod === 'CASH'
    ? Math.max(0, parseFloat(tenderInput) || 0)
    : payAmount;
  const changeDue = isSplitMode
    ? splitLegs.reduce((s, l) => s + l.changeAmount, 0)
    : activeMethod === 'CASH'
    ? Math.max(0, tenderNum - payAmount)
    : 0;

  const handleAddSplitLeg = () => {
    const legAmt = Math.min(remainingForSplit, Math.max(0, parseFloat(splitAmountInput) || 0));
    if (legAmt <= 0) {
      setErrorMessage(t('يرجى إدخال مبلغ صحيح للدفعة', 'Veuillez saisir un montant valide'));
      return;
    }
    const legTender =
      activeMethod === 'CASH' ? Math.max(legAmt, parseFloat(tenderInput) || legAmt) : legAmt;
    const legChange = activeMethod === 'CASH' ? Math.max(0, legTender - legAmt) : 0;

    const nextLegs: SplitLeg[] = [
      ...splitLegs,
      {
        id: `leg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        method: activeMethod,
        amount: legAmt,
        tenderAmount: legTender,
        changeAmount: legChange,
        transactionRef: splitRefInput.trim() || undefined,
      },
    ];
    setSplitLegs(nextLegs);
    const nextRemaining = Math.max(0, amountDue - nextLegs.reduce((s, l) => s + l.amount, 0));
    setSplitAmountInput(String(nextRemaining));
    setTenderInput(String(nextRemaining));
    setSplitRefInput('');
    setErrorMessage('');
  };

  const handleRemoveSplitLeg = (legId: string) => {
    const nextLegs = splitLegs.filter((l) => l.id !== legId);
    setSplitLegs(nextLegs);
    const nextRemaining = Math.max(0, amountDue - nextLegs.reduce((s, l) => s + l.amount, 0));
    setSplitAmountInput(String(nextRemaining));
    setTenderInput(String(nextRemaining));
  };

  const handleAddTender = (amount: number) => {
    const current = parseFloat(tenderInput) || 0;
    setTenderInput(String(current + amount));
  };

  const handleNumpadPress = (val: string) => {
    if (val === 'C') {
      setTenderInput('');
    } else if (val === 'EXACT') {
      setTenderInput(String(payAmount));
    } else {
      setTenderInput((prev) => (prev === '0' ? val : prev + val));
    }
  };

  const handleCompletePayment = async () => {
    if (!existingOrder && cart.length === 0) return;
    if (payAmount <= 0) {
      setErrorMessage(t('يرجى إدخال مبلغ دفع صحيح أكبر من 0', 'Veuillez saisir un montant valide'));
      return;
    }

    setIsProcessing(true);
    setErrorMessage('');
    let createdOrder: any = null;

    try {
      if (!isShiftOpen && (typeof navigator === 'undefined' || navigator.onLine)) {
        const liveShift = await api.getCurrentShift().catch(() => null);
        if (!liveShift || (!liveShift.isOpen && liveShift.shift?.status !== 'OPEN' && liveShift.status !== 'OPEN')) {
          await refreshShift();
          setErrorMessage(
            t(
              'يرجى فتح وردية الصندوق أولاً قبل استقبال المدفوعات',
              'Veuillez ouvrir une session de caisse avant d’encaisser'
            )
          );
          return;
        }
      }

      if (!pendingPaymentUuidRef.current) {
        pendingPaymentUuidRef.current = generateUuid();
      }
      const opUuid = pendingPaymentUuidRef.current;
      const idempotencyKey = `pay-${opUuid}`;
      const safeCustomerId =
        selectedCustomer?.id && selectedCustomer.id > 0 ? selectedCustomer.id : undefined;
      let targetOrder: any = existingOrder;

      if (!targetOrder) {
        if (activeOrderId) {
          targetOrder = await api.appendOrderItems(activeOrderId, {
            items: cart,
            replaceAll: true,
            discount,
            deliveryFee,
            notes,
            sendToKitchen: false,
          });
        } else {
          targetOrder = await api.createOrder({
            offlineId: `off-${opUuid}`,
            operationId: opUuid,
            type: orderType,
            tableId: selectedTable?.id,
            tableNumber: selectedTable?.tableNumber,
            customerId: safeCustomerId,
            items: cart,
            discount,
            deliveryFee,
            taxRate,
            taxAmount,
            subtotal,
            total,
            deliveryAddress: orderType === 'DELIVERY' ? deliveryAddress : undefined,
            notes,
            isHeld: false,
            idempotencyKey: `ord-${idempotencyKey}`,
          });
        }
        createdOrder = targetOrder;
      }

      const paymentsPayload = isSplitMode
        ? splitLegs.map((leg, idx) => ({
            method: leg.method,
            amount: leg.amount,
            tenderAmount: leg.tenderAmount,
            changeAmount: leg.changeAmount,
            transactionRef: leg.transactionRef,
            idempotencyKey: `txn-${idempotencyKey}-${idx}-${leg.method}`,
          }))
        : [
            {
              method: activeMethod,
              amount: payAmount,
              tenderAmount: activeMethod === 'CASH' ? Math.max(payAmount, tenderNum) : payAmount,
              changeAmount: changeDue,
              idempotencyKey: `txn-${idempotencyKey}`,
            },
          ];

      await api.processPayment({
        orderId: targetOrder.id,
        offlineId: targetOrder.offline ? targetOrder.offlineId : undefined,
        orderNumber: targetOrder.orderNumber,
        payments: paymentsPayload,
        idempotencyKey: `txn-${idempotencyKey}`,
        operationId: opUuid,
      });

      pendingPaymentUuidRef.current = null;
      openCashDrawer();

      const receiptItems = existingOrder ? existingOrder.items || [] : [...cart];
      const primaryMethodLabel = isSplitMode
        ? splitLegs.length > 1
          ? 'MIXED'
          : splitLegs[0]?.method || activeMethod
        : activeMethod;
      const receiptData = {
        orderId: targetOrder.id && targetOrder.id > 0 ? targetOrder.id : null,
        orderNumber: targetOrder.orderNumber,
        dailySequence: targetOrder.dailySequence,
        tableNumber: existingOrder?.table?.tableNumber || existingOrder?.tableNumber || selectedTable?.tableNumber,
        customerName: existingOrder?.customer?.name || existingOrder?.customerName || selectedCustomer?.name,
        orderType: existingOrder?.type || orderType,
        items: receiptItems,
        subtotal: existingOrder ? Number(existingOrder.subtotal) : subtotal,
        discount: existingOrder ? Number(existingOrder.discount || 0) : discount,
        deliveryFee: existingOrder ? Number(existingOrder.deliveryFee || 0) : deliveryFee,
        taxRate: existingOrder ? Number(existingOrder.taxRate || 0) : taxRate,
        taxAmount: existingOrder ? Number(existingOrder.taxAmount || 0) : taxAmount,
        total: orderTotal,
        paidAmount: alreadyPaid + payAmount,
        payments: paymentsPayload,
        paymentMethod: primaryMethodLabel,
        tenderAmount: isSplitMode
          ? tenderNum
          : activeMethod === 'CASH'
          ? Math.max(payAmount, tenderNum)
          : payAmount,
        changeAmount: changeDue,
        cashierName: user?.fullName || 'Admin',
        time: new Date().toLocaleTimeString('fr-FR'),
        date: new Date().toLocaleDateString('fr-FR'),
        shouldPrint: printReceiptOnSuccess,
      };

      if (!existingOrder) {
        clearCart();
      }
      await refreshShift();
      await refreshDashboard();
      await refreshOfflineCount();
      onSuccess(receiptData);
      onClose();
    } catch (err: any) {
      if (createdOrder?.id && !activeOrderId && !createdOrder.offline) {
        setActiveOrderId(createdOrder.id, createdOrder.orderNumber);
      }
      const msg = err?.message || t('فشلت معالجة عملية الدفع', 'Échec du paiement');
      if (msg.includes('وردية الصندوق')) {
        await refreshShift();
      } else {
        console.error('Payment failure:', err);
      }
      setErrorMessage(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const methods: { id: PaymentMethod; ar: string; fr: string; icon: any }[] = [
    { id: 'CASH', ar: 'نقدي', fr: 'Espèces', icon: Banknote },
    { id: 'CARD', ar: 'بطاقة بنكية', fr: 'Carte', icon: CreditCard },
    { id: 'BANK_TRANSFER', ar: 'تحويل بنكي', fr: 'Virement', icon: Landmark },
    { id: 'BARIDIMOB', ar: 'بريدي موب', fr: 'BaridiMob', icon: Smartphone },
    { id: 'CCP', ar: 'حساب CCP', fr: 'CCP', icon: Building },
    { id: 'OTHER', ar: 'أخرى', fr: 'Autre', icon: Wallet },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4 select-none overflow-y-auto">
      <div
        data-testid="payment-modal"
        className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-2xl w-full p-4 sm:p-6 shadow-2xl space-y-4 text-[#F7F3EA] max-h-[95vh] overflow-y-auto no-scrollbar my-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-[#C6A15B] flex items-center gap-2">
              <Banknote className="w-6 h-6" />
              <span>{t('تسديد الفاتورة', 'Encaissement')}</span>
            </h2>
            <p className="text-xs font-bold text-[#A8A29E] mt-0.5">
              {existingOrder
                ? `${existingOrder.orderNumber}`
                : orderType === 'DINE_IN' && selectedTable
                ? t(`الطاولة ${selectedTable.tableNumber}`, `Table ${selectedTable.tableNumber}`)
                : orderType === 'DELIVERY'
                ? t('طلب توصيل', 'Livraison')
                : t('طلب محمول', 'À emporter')}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] hover:text-[#F7F3EA] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Closed Shift Guard Warning */}
        {!isShiftOpen && (
          <div className="p-3.5 rounded-2xl bg-amber-950/60 border border-[#C6A15B] text-[#F7F3EA] flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-bold">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-[#C6A15B] shrink-0" />
              <span>
                {t(
                  'الصندوق مغلق حالياً! يجب فتح وردية قبل تسجيل عمليات الدفع.',
                  'Caisse fermée ! Ouvrez un shift avant d’encaisser.'
                )}
              </span>
            </div>
            {onOpenCashRegisterModal && (
              <button
                type="button"
                onClick={onOpenCashRegisterModal}
                className="px-3 py-1.5 rounded-xl bg-[#C6A15B] text-[#171717] font-black text-xs cursor-pointer"
              >
                {t('فتح الوردية الآن', 'Ouvrir Caisse')}
              </button>
            )}
          </div>
        )}

        {errorMessage && (
          <div className="p-3 rounded-2xl bg-red-950/70 border border-red-500/60 text-red-200 text-xs sm:text-sm text-center font-black">
            {errorMessage}
          </div>
        )}

        {/* Summary KPIs */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 bg-[#171717] p-3 rounded-2xl border border-[#33302B] text-center">
          <div className="p-2.5 rounded-xl bg-[#222222] border border-[#33302B]">
            <span className="text-[11px] text-[#A8A29E] font-bold block">
              {t('المتبقي المطلوب', 'Montant Dû')}
            </span>
            <span className="text-lg sm:text-2xl font-black text-[#C6A15B] font-mono tabular-nums">
              {amountDue.toLocaleString()} <span className="text-xs text-[#A8A29E]">DA</span>
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-[#222222] border border-[#33302B]">
            <span className="text-[11px] text-[#A8A29E] font-bold block">
              {t('المبلغ المدفوع الآن', 'Montant Payé')}
            </span>
            <span className="text-lg sm:text-2xl font-black text-[#F7F3EA] font-mono tabular-nums">
              {payAmount.toLocaleString()} <span className="text-xs text-[#A8A29E]">DA</span>
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-[#222222] border border-[#33302B]">
            <span className="text-[11px] text-[#A8A29E] font-bold block">
              {t('الباقي للزبون', 'Rendu Monnaie')}
            </span>
            <span className="text-lg sm:text-2xl font-black text-emerald-400 font-mono tabular-nums">
              {changeDue.toLocaleString()} <span className="text-xs text-[#A8A29E]">DA</span>
            </span>
          </div>
        </div>

        {/* Full / Partial / Split Payment Mode Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#171717] px-3 py-2 rounded-xl border border-[#33302B] text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                data-testid="partial-payment-toggle"
                checked={isPartialMode}
                disabled={isSplitMode}
                onChange={(e) => {
                  setIsPartialMode(e.target.checked);
                  if (!e.target.checked) {
                    setPayAmountInput(String(amountDue));
                  }
                }}
                className="w-4 h-4 accent-[#C6A15B]"
              />
              <span>{t('دفع جزئي (Partial Payment)', 'Paiement partiel')}</span>
            </label>

            <label className="flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                data-testid="split-payment-toggle"
                checked={isSplitMode}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setIsSplitMode(enabled);
                  if (enabled) {
                    setIsPartialMode(false);
                    setSplitLegs([]);
                    setSplitAmountInput(String(amountDue));
                    setTenderInput(String(amountDue));
                  }
                }}
                className="w-4 h-4 accent-[#C6A15B]"
              />
              <span className="text-[#C6A15B]">
                {t('دفع مقسّم متعدد الطرق (Split)', 'Paiement mixte / fractionné')}
              </span>
            </label>
          </div>

          {isPartialMode && !isSplitMode && (
            <div className="flex items-center gap-2">
              <span className="text-[#A8A29E] font-bold">{t('المبلغ:', 'Montant :')}</span>
              <input
                type="number"
                min="1"
                max={amountDue}
                value={payAmountInput}
                onChange={(e) => {
                  setPayAmountInput(e.target.value);
                  setTenderInput(e.target.value);
                }}
                className="w-28 bg-[#222222] border border-[#C6A15B]/60 rounded-lg px-2.5 py-1 text-sm font-black font-mono text-[#C6A15B]"
              />
            </div>
          )}
        </div>

        {/* Split Payment Legs Builder */}
        {isSplitMode && (
          <div className="bg-[#171717] border border-[#C6A15B]/40 rounded-2xl p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-black text-[#C6A15B]">
                {t(
                  `الدفعات المضافة (${splitLegs.length}) • المتبقي للتوزيع: ${remainingForSplit.toLocaleString()} DA`,
                  `Paiements ajoutés (${splitLegs.length}) • Reste: ${remainingForSplit.toLocaleString()} DA`
                )}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  data-testid="split-amount-input"
                  min="1"
                  max={remainingForSplit || amountDue}
                  value={splitAmountInput}
                  onChange={(e) => {
                    setSplitAmountInput(e.target.value);
                    setTenderInput(e.target.value);
                  }}
                  placeholder={t('المبلغ', 'Montant')}
                  className="w-28 bg-[#222222] border border-[#C6A15B]/60 rounded-lg px-2.5 py-1.5 text-sm font-black font-mono text-[#C6A15B]"
                />
                <input
                  type="text"
                  data-testid="split-ref-input"
                  value={splitRefInput}
                  onChange={(e) => setSplitRefInput(e.target.value)}
                  placeholder={t('مرجع (اختياري)', 'Réf (optionnel)')}
                  className="w-28 bg-[#222222] border border-[#33302B] rounded-lg px-2 py-1.5 text-xs text-[#F7F3EA]"
                />
                <button
                  type="button"
                  data-testid="add-split-leg-btn"
                  onClick={handleAddSplitLeg}
                  disabled={remainingForSplit <= 0}
                  className="px-3 py-1.5 rounded-xl bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-40 text-[#171717] font-black text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('إضافة دفعة', 'Ajouter')}</span>
                </button>
              </div>
            </div>

            {splitLegs.length > 0 && (
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {splitLegs.map((leg) => (
                  <div
                    key={leg.id}
                    data-testid={`split-leg-${leg.method}`}
                    className="flex items-center justify-between bg-[#222222] border border-[#33302B] rounded-xl px-3 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2 font-bold">
                      <span className="px-2 py-0.5 rounded bg-[#C6A15B]/20 text-[#C6A15B] font-mono">
                        {leg.method}
                      </span>
                      <span className="font-mono font-black text-[#F7F3EA]">
                        {leg.amount.toLocaleString()} DA
                      </span>
                      {leg.changeAmount > 0 && (
                        <span className="text-emerald-400">
                          ({t('باقي', 'Rendu')}: {leg.changeAmount.toLocaleString()} DA)
                        </span>
                      )}
                      {leg.transactionRef && (
                        <span className="text-[#A8A29E] font-mono">#{leg.transactionRef}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveSplitLeg(leg.id)}
                      className="text-red-400 hover:text-red-300 p-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Payment Methods */}
        <div>
          <label className="block text-xs font-black text-[#A8A29E] mb-2">
            {t('طريقة الدفع:', 'Mode de paiement :')}
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {methods.map((m) => {
              const Icon = m.icon;
              const isSelected = activeMethod === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`pay-method-${m.id}`}
                  onClick={() => setActiveMethod(m.id)}
                  className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition text-[11px] font-black cursor-pointer ${
                    isSelected
                      ? 'bg-[#C6A15B] text-[#171717] border-[#C6A15B] shadow'
                      : 'bg-[#171717] text-[#F7F3EA] border-[#33302B] hover:border-[#C6A15B]/50'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-center leading-tight">{t(m.ar, m.fr)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Cash Notes & Touch Numpad */}
        {activeMethod === 'CASH' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#A8A29E]">
                {t('أوراق نقدية سريعة:', 'Billets rapides :')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[100, 200, 500, 1000, 2000].map((noteVal) => (
                  <button
                    key={noteVal}
                    type="button"
                    onClick={() => handleAddTender(noteVal)}
                    className="p-2.5 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#C6A15B] font-black text-sm active:scale-95 transition font-mono cursor-pointer"
                  >
                    +{noteVal} DA
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setTenderInput(String(payAmount))}
                  className="p-2.5 rounded-xl bg-[#C6A15B]/20 hover:bg-[#C6A15B]/30 border border-[#C6A15B]/60 text-[#C6A15B] font-black text-xs active:scale-95 transition cursor-pointer"
                >
                  {t('المبلغ الدقيق', 'Exact')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5 font-mono text-base">
              {['7', '8', '9', 'C', '4', '5', '6', 'EXACT', '1', '2', '3', '00', '0', '.'].map((btn) => (
                <button
                  key={btn}
                  type="button"
                  onClick={() => handleNumpadPress(btn)}
                  className="p-2 bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] rounded-xl text-[#F7F3EA] font-black active:scale-95 transition flex items-center justify-center text-sm cursor-pointer"
                >
                  {btn}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Submit Footer */}
        <div className="pt-3 border-t border-[#33302B] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-[#A8A29E]">
            <input
              type="checkbox"
              checked={printReceiptOnSuccess}
              onChange={(e) => setPrintReceiptOnSuccess(e.target.checked)}
              className="w-4 h-4 accent-[#C6A15B] cursor-pointer"
            />
            <Printer className="w-4 h-4 text-[#C6A15B]" />
            <span>{t('طباعة الوصل تلقائياً', 'Imprimer le reçu automatiquement')}</span>
          </label>

          <button
            type="button"
            data-testid="confirm-payment-btn"
            onClick={handleCompletePayment}
            disabled={isProcessing || !isShiftOpen}
            className="py-3.5 px-6 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-40 text-[#171717] font-black text-base rounded-2xl shadow-xl flex items-center justify-center gap-2 active:scale-95 transition cursor-pointer"
          >
            {isProcessing ? (
              <span>{t('جاري المعالجة...', 'Traitement...')}</span>
            ) : (
              <>
                <Check className="w-5 h-5 stroke-[3]" />
                <span>{t('تأكيد الدفع والتسديد', 'Confirmer l’Encaissement')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
