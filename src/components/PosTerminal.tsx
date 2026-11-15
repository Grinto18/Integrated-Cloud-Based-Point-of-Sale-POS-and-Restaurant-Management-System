import React, { useState, useEffect, useRef } from 'react';
import { usePos } from '../context/PosContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { Product, Category, RestaurantTable, ProductVariant, ProductAddon } from '../types.ts';
import { api, generateUuid } from '../services/api.ts';
import { printerService } from '../services/printerService.ts';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  DollarSign,
  Utensils,
  ShoppingBag,
  Truck,
  Layers,
  ChefHat,
  Printer,
  PauseCircle,
  Percent,
  X,
  FileText,
  MapPin,
  Flame,
  Soup,
  Fish,
  Sandwich,
  Salad,
  Cake,
  GlassWater,
  Pizza,
  Sparkles,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface PosTerminalProps {
  onOpenPaymentModal: () => void;
  onNavigateToTables: () => void;
  onOpenHeldOrders: () => void;
  onQuickCheckout: (printTicket: boolean) => void;
}

export const PosTerminal: React.FC<PosTerminalProps> = ({
  onOpenPaymentModal,
  onNavigateToTables,
  onQuickCheckout,
}) => {
  const { user, hasRole } = useAuth();
  const { t, lang } = useLanguage();
  const {
    cart,
    activeOrderId,
    activeOrderNumber,
    setActiveOrderId,
    orderType,
    setOrderType,
    selectedTable,
    setSelectedTable,
    selectedCustomer,
    setSelectedCustomer,
    discount,
    setDiscount,
    deliveryFee,
    deliveryAddress,
    setDeliveryAddress,
    notes,
    taxRate,
    taxAmount,
    subtotal,
    total,
    addToCart,
    updateCartItemQuantity,
    setCartItemQuantity,
    setCartItemPrice,
    setCartItemNotes,
    removeFromCart,
    clearCart,
    openCashDrawer,
    setReceiptToPrint,
    refreshDashboard,
    refreshHeldOrders,
    refreshOfflineCount,
  } = usePos();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCartItemId, setSelectedCartItemId] = useState<string | null>(null);

  const [activeProductForOptions, setActiveProductForOptions] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | undefined>(undefined);
  const [selectedAddons, setSelectedAddons] = useState<ProductAddon[]>([]);
  const [showDiscountModal, setShowDiscountModal] = useState<boolean>(false);
  const [discountInput, setDiscountInput] = useState<string>('');
  const [showTableModal, setShowTableModal] = useState<boolean>(false);
  const [tablesList, setTablesList] = useState<RestaurantTable[]>([]);
  const [showCustomerModal, setShowCustomerModal] = useState<boolean>(false);
  const [customerNameInput, setCustomerNameInput] = useState<string>('');
  const [customerPhoneInput, setCustomerPhoneInput] = useState<string>('');
  const [customerError, setCustomerError] = useState<string>('');
  const [isSavingCustomer, setIsSavingCustomer] = useState<boolean>(false);
  const [showItemEditModal, setShowItemEditModal] = useState<boolean>(false);
  const [editQtyInput, setEditQtyInput] = useState<string>('1');
  const [editPriceInput, setEditPriceInput] = useState<string>('');
  const [editPriceReasonInput, setEditPriceReasonInput] = useState<string>('');
  const [editNotesInput, setEditNotesInput] = useState<string>('');
  const [isHoldingOrder, setIsHoldingOrder] = useState<boolean>(false);
  const [isSendingKitchen, setIsSendingKitchen] = useState<boolean>(false);
  const [isMobileCartOpen, setIsMobileCartOpen] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const pendingActionUuidRef = useRef<{ signature: string; uuid: string } | null>(null);

  useEffect(() => {
    if (cart.length === 0) {
      pendingActionUuidRef.current = null;
    }
  }, [cart.length]);

  const getStableOrderUuid = (actionKind: 'HOLD' | 'KITCHEN') => {
    const sig = JSON.stringify({
      actionKind,
      orderType,
      tableId: selectedTable?.id || null,
      total,
      items: cart.map((c) => ({ p: c.productId, q: c.quantity, u: c.unitPrice })),
    });
    if (!pendingActionUuidRef.current || pendingActionUuidRef.current.signature !== sig) {
      pendingActionUuidRef.current = { signature: sig, uuid: generateUuid() };
    }
    return pendingActionUuidRef.current.uuid;
  };

  const notify = (type: 'success' | 'error', text: string) => {
    setStatusBanner({ type, text });
    setTimeout(() => setStatusBanner(null), 4000);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [cats, prods, tables] = await Promise.all([
        api.getCategories(),
        api.getProducts(),
        api.getTables(),
      ]);
      setCategories(Array.isArray(cats) ? cats.filter((c: Category) => c.isActive) : []);
      setProducts(Array.isArray(prods) ? prods : []);
      setTablesList(Array.isArray(tables) ? tables : []);
    } catch (err) {
      console.error('Failed to load POS catalog:', err);
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchesCategory = selectedCategoryId === 'ALL' || p.categoryId === selectedCategoryId;
    const matchesSearch =
      searchQuery.trim() === '' ||
      p.nameAr.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.nameFr && p.nameFr.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.barcode && p.barcode.includes(searchQuery.trim()));
    return matchesCategory && matchesSearch;
  });

  const handleProductClick = (product: Product) => {
    if (!product.isAvailable) return;

    const hasVariants = product.variants && product.variants.length > 0;
    const hasAddons = product.addons && product.addons.length > 0;

    if (hasVariants || hasAddons) {
      setActiveProductForOptions(product);
      setSelectedVariant(hasVariants ? product.variants![0] : undefined);
      setSelectedAddons([]);
    } else {
      addToCart(product);
    }
  };

  const handleConfirmProductWithOptions = () => {
    if (activeProductForOptions) {
      addToCart(activeProductForOptions, selectedVariant, selectedAddons);
      setActiveProductForOptions(null);
    }
  };

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      const matched = products.find(
        (p) => p.barcode === searchQuery.trim() || p.barcode === `GP-${searchQuery.trim()}`
      );
      if (matched) {
        handleProductClick(matched);
        setSearchQuery('');
      }
    }
  };

  const handleHoldCurrentOrder = async () => {
    if (cart.length === 0) return;
    setIsHoldingOrder(true);
    try {
      const safeCustomerId =
        selectedCustomer?.id && selectedCustomer.id > 0 ? selectedCustomer.id : undefined;
      if (activeOrderId) {
        await api.appendOrderItems(activeOrderId, {
          items: cart,
          replaceAll: true,
          discount,
          deliveryFee,
          notes,
          sendToKitchen: false,
        });
      } else {
        const opUuid = getStableOrderUuid('HOLD');
        await api.createOrder({
          offlineId: `off-${opUuid}`,
          operationId: opUuid,
          idempotencyKey: `ord-hold-${opUuid}`,
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
          notes,
          isHeld: true,
        });
      }
      pendingActionUuidRef.current = null;
      clearCart();
      await refreshHeldOrders();
      await refreshDashboard();
      await refreshOfflineCount();
      notify('success', t('تم تعليق الطلب بنجاح', 'Commande mise en attente'));
    } catch (err: any) {
      notify('error', err.message || t('فشل تعليق الطلب', 'Échec de mise en attente'));
    } finally {
      setIsHoldingOrder(false);
    }
  };

  const handleSendToKitchen = async () => {
    if (cart.length === 0 || isSendingKitchen) return;
    setIsSendingKitchen(true);
    try {
      const safeCustomerId =
        selectedCustomer?.id && selectedCustomer.id > 0 ? selectedCustomer.id : undefined;
      let targetOrder: any;
      if (activeOrderId) {
        targetOrder = await api.appendOrderItems(activeOrderId, {
          items: cart,
          replaceAll: true,
          discount,
          deliveryFee,
          notes,
          sendToKitchen: true,
        });
      } else {
        const opUuid = getStableOrderUuid('KITCHEN');
        targetOrder = await api.createOrder({
          offlineId: `off-${opUuid}`,
          operationId: opUuid,
          idempotencyKey: `ord-kds-${opUuid}`,
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
          notes,
          isHeld: false,
          sendToKitchen: true,
        });
        pendingActionUuidRef.current = null;
        if (targetOrder?.id && !targetOrder.offline) {
          setActiveOrderId(targetOrder.id, targetOrder.orderNumber);
        }
      }

      setReceiptToPrint({
        isKitchenTicket: true,
        orderNumber: targetOrder.orderNumber,
        tableNumber: selectedTable?.tableNumber,
        orderType,
        items: cart,
        notes,
        time: new Date().toLocaleTimeString('fr-FR'),
      });
      await refreshDashboard();
      await refreshOfflineCount();
      notify(
        'success',
        targetOrder.offline
          ? t('تم حفظ الطلب محلياً (أوفلاين) للمزامنة', 'Commande enregistrée hors ligne')
          : t(`تم إرسال الطلب ${targetOrder.orderNumber} للمطبخ`, `Bon cuisine envoyé (${targetOrder.orderNumber})`)
      );
    } catch (err: any) {
      notify('error', err.message || t('فشل إرسال الطلب للمطبخ', 'Erreur envoi cuisine'));
    } finally {
      setIsSendingKitchen(false);
    }
  };

  const handlePrintAddition = () => {
    if (cart.length === 0) return;
    setReceiptToPrint({
      isAddition: true,
      orderNumber: activeOrderNumber || `BON-${Date.now().toString().slice(-4)}`,
      tableNumber: selectedTable?.tableNumber,
      customerName: selectedCustomer?.name,
      orderType,
      items: cart,
      subtotal,
      discount,
      deliveryFee,
      taxRate,
      taxAmount,
      total,
      cashierName: user?.fullName || 'Admin',
      time: new Date().toLocaleTimeString('fr-FR'),
      date: new Date().toLocaleDateString('fr-FR'),
    });
  };

  const selectedCartItem = cart.find((i) => i.id === selectedCartItemId);
  const canApplyDiscount = hasRole(['ADMIN', 'MANAGER', 'CASHIER']);
  const canCollectPayment = hasRole(['ADMIN', 'MANAGER', 'CASHIER']);

  const getCatIcon = (nameAr: string) => {
    if (nameAr.includes('بيتزا') || nameAr.includes('Pizza')) return <Pizza className="w-4 h-4" />;
    if (nameAr.includes('شورب') || nameAr.includes('مقبلات')) return <Soup className="w-4 h-4" />;
    if (nameAr.includes('مشاوي') || nameAr.includes('جمر')) return <Flame className="w-4 h-4" />;
    if (nameAr.includes('بحر') || nameAr.includes('سمك')) return <Fish className="w-4 h-4" />;
    if (nameAr.includes('طاكوس') || nameAr.includes('سندويتش')) return <Sandwich className="w-4 h-4" />;
    if (nameAr.includes('سلط')) return <Salad className="w-4 h-4" />;
    if (nameAr.includes('تحلية') || nameAr.includes('حلو')) return <Cake className="w-4 h-4" />;
    if (nameAr.includes('مشروب') || nameAr.includes('عصير')) return <GlassWater className="w-4 h-4" />;
    return <Utensils className="w-4 h-4" />;
  };

  const totalCartQuantity = cart.reduce((sum, item) => sum + item.quantity, 0);

  const renderCartPanel = (isMobileDrawer: boolean) => (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#222222] text-[#F7F3EA]">
      {/* Active Existing Order Banner */}
      {activeOrderNumber && (
        <div className="px-3 py-1.5 bg-[#C6A15B]/20 border-b border-[#C6A15B]/40 flex items-center justify-between text-xs font-black text-[#C6A15B]">
          <span>
            {t(`تعديل طلب مفتوح: ${activeOrderNumber}`, `Commande ouverte: ${activeOrderNumber}`)}
          </span>
          <button
            type="button"
            onClick={clearCart}
            className="text-[11px] underline text-[#F7F3EA] hover:text-[#C6A15B] cursor-pointer"
          >
            {t('طلب جديد', 'Nouvelle')}
          </button>
        </div>
      )}

      {/* Order Mode Switcher */}
      <div className="p-2.5 bg-[#1D1D1D] border-b border-[#33302B] flex items-center gap-1.5 shrink-0">
        {[
          { id: 'DINE_IN', ar: 'في الصالة', fr: 'Sur Place', icon: Utensils },
          { id: 'TAKEAWAY', ar: 'محمول', fr: 'Emporter', icon: ShoppingBag },
          { id: 'DELIVERY', ar: 'توصيل', fr: 'Livraison', icon: Truck },
        ].map((mode) => {
          const Icon = mode.icon;
          const active = orderType === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => setOrderType(mode.id as any)}
              className={`flex-1 py-2 px-2 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer ${
                active
                  ? 'bg-[#C6A15B] text-[#171717] shadow'
                  : 'bg-[#222222] hover:border-[#C6A15B]/40 text-[#A8A29E] hover:text-[#F7F3EA] border border-[#33302B]'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{t(mode.ar, mode.fr)}</span>
            </button>
          );
        })}
      </div>

      {/* Table / Customer Context Selectors */}
      <div className="px-2.5 py-2 bg-[#1B1B1B] border-b border-[#33302B] flex items-center justify-between gap-1.5 shrink-0 text-xs">
        {orderType === 'DINE_IN' && (
          <button
            type="button"
            onClick={() => {
              if (isMobileDrawer) setIsMobileCartOpen(false);
              setShowTableModal(true);
            }}
            className="flex-1 flex items-center justify-between bg-[#222222] hover:border-[#C6A15B] px-2.5 py-1.5 rounded-xl border border-[#33302B] text-[#F7F3EA] cursor-pointer"
          >
            <span className="text-[11px] font-bold text-[#A8A29E]">{t('الطاولة:', 'Table :')}</span>
            <span className="font-black text-[#C6A15B]">
              {selectedTable ? selectedTable.tableNumber : t('اختر', 'Choisir')}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            if (isMobileDrawer) setIsMobileCartOpen(false);
            setShowCustomerModal(true);
          }}
          className="flex-1 flex items-center justify-between bg-[#222222] hover:border-[#C6A15B] px-2.5 py-1.5 rounded-xl border border-[#33302B] text-[#F7F3EA] cursor-pointer"
        >
          <span className="text-[11px] font-bold text-[#A8A29E]">{t('الزبون:', 'Client :')}</span>
          <span className="font-bold text-[#F7F3EA] truncate max-w-[105px]">
            {selectedCustomer ? selectedCustomer.name : t('زبون عام', 'Client comptoir')}
          </span>
        </button>

        {cart.length > 0 && (
          <button
            type="button"
            onClick={clearCart}
            className="bg-red-950/60 hover:bg-red-900 text-red-300 px-2.5 py-1.5 rounded-xl border border-red-800/70 text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
            title={t('إفراغ السلة', 'Vider')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2 no-scrollbar min-h-0 bg-[#171717]">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[#A8A29E] py-12 text-center">
            <ShoppingBag className="w-12 h-12 stroke-[1.5] text-[#C6A15B]/40 mb-2" />
            <p className="font-black text-base text-[#F7F3EA]">{t('السلة فارغة', 'Panier vide')}</p>
            <p className="text-xs text-[#A8A29E] mt-1">
              {t('اضغط على أي طبق لإضافته للطلب', 'Sélectionnez un article pour commencer')}
            </p>
          </div>
        ) : (
          cart.map((item) => {
            const isSelected = selectedCartItemId === item.id;
            return (
              <div
                key={item.id}
                data-testid={`cart-item-${item.productId}`}
                onClick={() => setSelectedCartItemId(item.id)}
                className={`p-2.5 sm:p-3 rounded-xl border transition cursor-pointer ${
                  isSelected
                    ? 'bg-[#2A2620] border-[#C6A15B] ring-1 ring-[#C6A15B]/50'
                    : 'bg-[#222222] border-[#33302B] hover:border-[#C6A15B]/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-extrabold text-sm text-[#F7F3EA] leading-snug">
                      {lang === 'fr' && item.nameFr ? item.nameFr : item.nameAr}
                    </div>
                    {((lang === 'ar' && item.nameFr) || (lang === 'fr' && item.nameAr)) && (
                      <div className="text-[11px] text-[#A8A29E] truncate">
                        {lang === 'ar' ? item.nameFr : item.nameAr}
                      </div>
                    )}

                    {(item.selectedVariant || (item.selectedAddons && item.selectedAddons.length > 0)) && (
                      <div className="flex flex-wrap gap-1 mt-1 text-[11px]">
                        {item.selectedVariant && (
                          <span className="bg-[#C6A15B]/20 text-[#C6A15B] font-bold px-1.5 py-0.5 rounded border border-[#C6A15B]/40">
                            {lang === 'fr' && item.selectedVariant.nameFr
                              ? item.selectedVariant.nameFr
                              : item.selectedVariant.nameAr}
                          </span>
                        )}
                        {item.selectedAddons?.map((a, i) => (
                          <span
                            key={i}
                            className="bg-[#171717] text-[#A8A29E] font-semibold px-1.5 py-0.5 rounded border border-[#33302B]"
                          >
                            +{lang === 'fr' && a.nameFr ? a.nameFr : a.nameAr} ({Number(a.price)} DA)
                          </span>
                        ))}
                      </div>
                    )}

                    {item.notes && (
                      <p className="text-xs text-[#C6A15B] font-semibold mt-1">
                        {t(`ملاحظة: ${item.notes}`, `Note : ${item.notes}`)}
                      </p>
                    )}
                  </div>

                  <div className="font-black text-base text-[#C6A15B] font-mono tabular-nums shrink-0">
                    {item.total.toLocaleString()} <span className="text-[10px] text-[#A8A29E]">DA</span>
                  </div>
                </div>

                {/* Quantity Controls */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#33302B] text-xs">
                  <span className="text-[#A8A29E] font-bold font-mono tabular-nums">
                    {item.unitPrice} DA × {item.quantity}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={t('إنقاص الكمية', 'Diminuer quantité')}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateCartItemQuantity(item.id, -1);
                      }}
                      className="w-8 h-8 rounded-lg bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] flex items-center justify-center text-[#F7F3EA] active:scale-95 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCartItemId(item.id);
                        setEditQtyInput(String(item.quantity));
                        setEditPriceInput(String(item.unitPrice));
                        setEditPriceReasonInput(item.priceOverrideReason || '');
                        setEditNotesInput(item.notes || '');
                        if (isMobileDrawer) setIsMobileCartOpen(false);
                        setShowItemEditModal(true);
                      }}
                      className="min-w-9 h-8 px-2 rounded-lg bg-[#171717] border border-[#C6A15B]/60 font-black text-center text-[#C6A15B] text-sm font-mono tabular-nums cursor-pointer"
                    >
                      {item.quantity}
                    </button>

                    <button
                      type="button"
                      aria-label={t('زيادة الكمية', 'Augmenter quantité')}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateCartItemQuantity(item.id, 1);
                      }}
                      className="w-8 h-8 rounded-lg bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] flex items-center justify-center active:scale-95 font-black cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      aria-label={t('حذف الصنف', 'Supprimer article')}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromCart(item.id);
                      }}
                      className="w-8 h-8 rounded-lg bg-red-950/60 hover:bg-red-900 border border-red-800/70 text-red-300 flex items-center justify-center active:scale-95 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Totals */}
      <div className="p-3 bg-[#1D1D1D] border-t border-[#33302B] space-y-1 shrink-0 text-xs">
        <div className="flex items-center justify-between text-[#A8A29E] font-bold">
          <span>{t('المبلغ الأولي:', 'Sous-total :')}</span>
          <span className="font-mono font-bold text-[#F7F3EA] tabular-nums">{subtotal.toFixed(2)} DA</span>
        </div>

        {discount > 0 && (
          <div className="flex items-center justify-between text-rose-400 font-bold">
            <span>{t('الخصم:', 'Remise :')}</span>
            <span className="font-mono tabular-nums">-{discount.toFixed(2)} DA</span>
          </div>
        )}

        {taxRate > 0 && (
          <div className="flex items-center justify-between text-[#A8A29E] font-bold">
            <span>{t(`الضريبة (${taxRate}%):`, `TVA (${taxRate}%) :`)}</span>
            <span className="font-mono tabular-nums">+{taxAmount.toFixed(2)} DA</span>
          </div>
        )}

        {deliveryFee > 0 && (
          <div className="flex items-center justify-between text-[#C6A15B] font-bold">
            <span>{t('رسوم التوصيل:', 'Livraison :')}</span>
            <span className="font-mono tabular-nums">+{deliveryFee.toFixed(2)} DA</span>
          </div>
        )}

        <div className="flex items-baseline justify-between pt-1.5 border-t border-[#33302B]">
          <span className="text-sm text-[#F7F3EA] font-black">
            {t('الإجمالي:', 'TOTAL :')}
          </span>
          <span data-testid="pos-cart-total" className="text-2xl font-black text-[#C6A15B] font-mono tabular-nums">
            {total.toLocaleString()} <span className="text-sm text-[#A8A29E]">DA</span>
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="p-2.5 bg-[#222222] border-t border-[#33302B] space-y-2 shrink-0">
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={clearCart}
            className="bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] border border-[#33302B] font-bold py-2 px-2 rounded-xl text-xs flex items-center justify-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#C6A15B]" />
            <span>{t('جديد', 'Nouveau')}</span>
          </button>

          <button
            type="button"
            onClick={handleHoldCurrentOrder}
            disabled={cart.length === 0 || isHoldingOrder}
            className="bg-[#171717] hover:border-[#C6A15B] disabled:opacity-40 text-[#C6A15B] border border-[#33302B] font-bold py-2 px-2 rounded-xl text-xs flex items-center justify-center gap-1 cursor-pointer"
          >
            <PauseCircle className="w-3.5 h-3.5" />
            <span>{t('تعليق', 'Attente')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (isMobileDrawer) setIsMobileCartOpen(false);
              onNavigateToTables();
            }}
            className="bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] border border-[#33302B] font-bold py-2 px-2 rounded-xl text-xs flex items-center justify-center gap-1 cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5 text-[#C6A15B]" />
            <span>{t('الطاولات', 'Tables')}</span>
          </button>
        </div>

        {/* Primary Checkout & Pay */}
        {canCollectPayment && (
          <button
            type="button"
            onClick={() => {
              if (isMobileDrawer) setIsMobileCartOpen(false);
              onQuickCheckout(true);
            }}
            disabled={cart.length === 0}
            className="w-full bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-40 text-[#171717] font-black py-3.5 px-4 rounded-2xl text-base flex items-center justify-center gap-2 shadow-lg active:scale-95 transition cursor-pointer"
          >
            <Printer className="w-5 h-5 stroke-[2.5]" />
            <span>{t('تأكيد البيع والطباعة الفورية', 'Encaisser & Imprimer')}</span>
          </button>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {canCollectPayment && (
            <button
              type="button"
              data-testid="open-payment-modal-btn"
              onClick={() => {
                if (isMobileDrawer) setIsMobileCartOpen(false);
                onOpenPaymentModal();
              }}
              disabled={cart.length === 0}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-black py-2.5 px-3 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <DollarSign className="w-4 h-4" />
              <span>{t('الدفع والتسديد', 'Paiement')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSendToKitchen}
            disabled={cart.length === 0 || isSendingKitchen}
            className={`bg-[#171717] hover:border-[#C6A15B] disabled:opacity-40 text-[#F7F3EA] border border-[#C6A15B]/50 font-black py-2.5 px-3 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer ${
              !canCollectPayment ? 'col-span-2' : ''
            }`}
          >
            <ChefHat className="w-4 h-4 text-[#C6A15B]" />
            <span>{activeOrderId ? t('تحديث وإرسال للمطبخ', 'MàJ Cuisine') : t('إرسال للمطبخ', 'Cuisine')}</span>
          </button>
        </div>

        {/* Utility Buttons Row */}
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={handlePrintAddition}
            disabled={cart.length === 0}
            className="bg-[#171717] hover:border-[#C6A15B] disabled:opacity-40 text-[#A8A29E] hover:text-[#F7F3EA] font-bold py-2 px-1 rounded-xl flex items-center justify-center gap-1 border border-[#33302B] text-[11px] cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-[#C6A15B]" />
            <span>{t('فاتورة', 'Addition')}</span>
          </button>

          {canApplyDiscount && (
            <button
              type="button"
              onClick={() => {
                if (isMobileDrawer) setIsMobileCartOpen(false);
                setShowDiscountModal(true);
              }}
              className="bg-[#171717] hover:border-[#C6A15B] text-[#A8A29E] hover:text-[#F7F3EA] font-bold py-2 px-1 rounded-xl flex items-center justify-center gap-1 border border-[#33302B] text-[11px] cursor-pointer"
            >
              <Percent className="w-3.5 h-3.5 text-[#C6A15B]" />
              <span>{t('خصم', 'Remise')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={openCashDrawer}
            className="bg-[#171717] hover:border-[#C6A15B] text-[#A8A29E] hover:text-[#F7F3EA] font-bold py-2 px-1 rounded-xl flex items-center justify-center gap-1 border border-[#33302B] text-[11px] cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#C6A15B]" />
            <span>{t('الدرج', 'Tiroir')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const last = printerService.getLastReceipt();
              if (last) {
                setReceiptToPrint({ ...last, isReprint: true, alreadyAutoPrinted: false });
              } else {
                setReceiptToPrint(printerService.generateTestReceiptData(printerService.getProfile()));
              }
            }}
            className="bg-[#171717] hover:border-[#C6A15B] text-[#C6A15B] font-bold py-2 px-1 rounded-xl flex items-center justify-center gap-1 border border-[#33302B] text-[11px] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('إعادة', 'Réimp.')}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden bg-[#171717] text-[#F7F3EA] select-none relative w-full">
      {/* Desktop Cart Sidebar */}
      <div className="hidden lg:flex w-[420px] xl:w-[460px] bg-[#222222] border-l border-r border-[#33302B] flex-col shrink-0 shadow-xl h-full overflow-hidden">
        {renderCartPanel(false)}
      </div>

      {/* Mobile / Tablet Cart Drawer */}
      {isMobileCartOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex flex-col justify-end bg-black/75 backdrop-blur-xs">
          <div className="flex-1" onClick={() => setIsMobileCartOpen(false)} />
          <div className="bg-[#222222] rounded-t-3xl shadow-2xl max-h-[92vh] h-[85vh] flex flex-col overflow-hidden border-t border-[#C6A15B]/50">
            <div className="p-3.5 bg-[#1D1D1D] border-b border-[#33302B] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-[#C6A15B]" />
                <span className="font-black text-[#F7F3EA] text-base">
                  {t(`سلة المشتريات (${totalCartQuantity})`, `Panier (${totalCartQuantity})`)}
                </span>
                <span className="text-sm font-black text-[#C6A15B] bg-[#C6A15B]/15 px-2 py-0.5 rounded-lg font-mono tabular-nums">
                  {total.toLocaleString()} DA
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileCartOpen(false)}
                className="p-1.5 rounded-xl bg-[#222222] text-[#A8A29E] border border-[#33302B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderCartPanel(true)}
          </div>
        </div>
      )}

      {/* Main Catalog Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#171717] p-2.5 sm:p-4 space-y-2.5 min-w-0 relative">
        {statusBanner && (
          <div
            className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-2 border shrink-0 ${
              statusBanner.type === 'success'
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60'
                : 'bg-red-950/80 text-red-300 border-red-600/60'
            }`}
          >
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusBanner.text}</span>
          </div>
        )}

        {/* Search & Barcode Bar */}
        <div className="flex items-center gap-2 bg-[#222222] p-2 rounded-2xl border border-[#33302B] shrink-0">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#A8A29E] absolute right-3.5 top-3" />
            <input
              ref={barcodeInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleBarcodeKeyDown}
              placeholder={t('ابحث عن طبق أو امسح الباركود...', 'Rechercher un plat ou code-barres...')}
              className="w-full bg-[#171717] border border-[#33302B] rounded-xl pr-10 pl-8 py-2 text-sm font-bold text-[#F7F3EA] placeholder-[#A8A29E] focus:outline-none focus:border-[#C6A15B]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-3 top-2.5 text-[#A8A29E] hover:text-[#F7F3EA]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="text-xs font-black text-[#C6A15B] bg-[#171717] px-3 py-2 rounded-xl border border-[#33302B] hidden md:block shrink-0 tabular-nums">
            {filteredProducts.length} {t('طبق', 'plats')}
          </div>
        </div>

        {/* Categories Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 py-0.5 smooth-scroll">
          <button
            type="button"
            onClick={() => setSelectedCategoryId('ALL')}
            className={`px-4 py-2 rounded-xl font-black text-xs sm:text-sm flex items-center gap-1.5 transition active:scale-95 shrink-0 cursor-pointer ${
              selectedCategoryId === 'ALL'
                ? 'bg-[#C6A15B] text-[#171717] shadow'
                : 'bg-[#222222] hover:border-[#C6A15B]/50 text-[#F7F3EA] border border-[#33302B]'
            }`}
          >
            <Utensils className="w-4 h-4" />
            <span>{t('الكل', 'Tous')}</span>
          </button>

          {categories.map((cat) => {
            const isSelected = selectedCategoryId === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`px-3.5 py-2 rounded-xl font-black text-xs sm:text-sm flex items-center gap-1.5 transition active:scale-95 shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-[#C6A15B] text-[#171717] shadow'
                    : 'bg-[#222222] hover:border-[#C6A15B]/50 text-[#F7F3EA] border border-[#33302B]'
                }`}
              >
                {getCatIcon(cat.nameAr)}
                <span className="whitespace-nowrap">
                  {lang === 'fr' && cat.nameFr ? cat.nameFr : cat.nameAr}
                </span>
              </button>
            );
          })}
        </div>

        {/* Products Grid */}
        <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 smooth-scroll">
          {filteredProducts.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-[#A8A29E]">
              <Utensils className="w-12 h-12 mb-2 opacity-40" />
              <p className="text-base font-black">{t('لا توجد أطباق مطابقة للبحث', 'Aucun plat trouvé')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 pb-24 lg:pb-3">
              {filteredProducts.map((product) => {
                const priceNum = Number(product.price);
                const hasOptions =
                  (product.variants && product.variants.length > 0) ||
                  (product.addons && product.addons.length > 0);

                return (
                  <button
                    key={product.id}
                    type="button"
                    data-testid={`product-card-${product.id}`}
                    onClick={() => handleProductClick(product)}
                    disabled={!product.isAvailable}
                    className={`relative p-3 sm:p-4 rounded-2xl border text-start flex flex-col justify-between min-h-[120px] sm:min-h-[138px] transition-all active:scale-[0.97] select-none cursor-pointer shadow ${
                      product.isAvailable
                        ? 'bg-[#222222] hover:border-[#C6A15B] hover:bg-[#282520] border-[#33302B]'
                        : 'bg-[#1B1B1B] border-[#33302B] opacity-40 cursor-not-allowed'
                    }`}
                  >
                    <div>
                      <div className="font-black text-sm sm:text-base text-[#F7F3EA] line-clamp-2 leading-snug">
                        {lang === 'fr' && product.nameFr ? product.nameFr : product.nameAr}
                      </div>
                      {((lang === 'ar' && product.nameFr) || (lang === 'fr' && product.nameAr)) && (
                        <div className="text-[11px] text-[#A8A29E] font-medium line-clamp-1 mt-0.5">
                          {lang === 'ar' ? product.nameFr : product.nameAr}
                        </div>
                      )}
                    </div>

                    <div className="flex items-end justify-between mt-2.5 pt-2 border-t border-[#33302B]">
                      <div className="font-black text-base sm:text-xl text-[#C6A15B] font-mono tabular-nums">
                        {priceNum.toLocaleString()}{' '}
                        <span className="text-[11px] font-bold text-[#A8A29E]">DA</span>
                      </div>

                      {hasOptions && (
                        <span className="text-[10px] bg-[#C6A15B]/15 text-[#C6A15B] border border-[#C6A15B]/30 font-bold px-1.5 py-0.5 rounded-md">
                          {t('خيارات', 'Options')}
                        </span>
                      )}

                      {!product.isAvailable && (
                        <span className="text-[10px] bg-red-950/70 text-red-300 px-1.5 py-0.5 rounded-md border border-red-700/60 font-bold">
                          {t('غير متوفر', 'Épuisé')}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Mobile Sticky Bottom Checkout Bar */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#222222] border-t border-[#C6A15B]/40 shadow-2xl p-2.5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsMobileCartOpen(true)}
            className="flex items-center gap-2 bg-[#171717] px-3 py-2 rounded-xl border border-[#33302B] text-start shrink-0"
          >
            <div className="relative">
              <ShoppingBag className="w-5 h-5 text-[#C6A15B]" />
              {totalCartQuantity > 0 && (
                <span className="absolute -top-2 -right-2 bg-[#C6A15B] text-[#171717] text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center tabular-nums">
                  {totalCartQuantity}
                </span>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-[#A8A29E] font-bold leading-none">
                {t('السلة', 'Panier')}
              </span>
              <span className="text-sm font-black text-[#C6A15B] font-mono tabular-nums leading-tight mt-0.5">
                {total.toLocaleString()} DA
              </span>
            </div>
          </button>

          <div className="flex items-center gap-1.5 flex-1 justify-end">
            {canCollectPayment && (
              <>
                <button
                  type="button"
                  onClick={() => onQuickCheckout(true)}
                  disabled={cart.length === 0}
                  className="flex-1 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-40 text-[#171717] font-black py-2.5 px-2.5 rounded-xl text-xs flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>{t('طباعة سريعة', 'Rapide')}</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenPaymentModal}
                  disabled={cart.length === 0}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-black py-2.5 px-2.5 rounded-xl text-xs flex items-center justify-center gap-1 cursor-pointer"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>{t('تسديد', 'Payer')}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Product Variants & Addons Modal */}
      {activeProductForOptions && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B]">
                {lang === 'fr' && activeProductForOptions.nameFr
                  ? activeProductForOptions.nameFr
                  : activeProductForOptions.nameAr}
              </h3>
              <button
                type="button"
                onClick={() => setActiveProductForOptions(null)}
                className="p-2 rounded-xl bg-[#171717] text-[#A8A29E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {activeProductForOptions.variants && activeProductForOptions.variants.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-black text-[#A8A29E]">{t('الحجم / الخيار:', 'Taille / Choix :')}</label>
                <div className="grid grid-cols-2 gap-2.5">
                  {activeProductForOptions.variants.map((v) => {
                    const isSelected = selectedVariant?.id === v.id;
                    const fullPrice = Number(activeProductForOptions.price) + Number(v.priceAdjustment);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVariant(v)}
                        className={`p-3 rounded-2xl text-center border transition cursor-pointer ${
                          isSelected
                            ? 'bg-[#C6A15B] text-[#171717] border-[#C6A15B]'
                            : 'bg-[#171717] text-[#F7F3EA] border-[#33302B] hover:border-[#C6A15B]/50'
                        }`}
                      >
                        <div className="text-base font-black">{lang === 'fr' && v.nameFr ? v.nameFr : v.nameAr}</div>
                        <div className={`text-sm font-mono font-bold mt-0.5 ${isSelected ? 'text-[#171717]' : 'text-[#C6A15B]'}`}>
                          {fullPrice.toLocaleString()} DA
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {activeProductForOptions.addons && activeProductForOptions.addons.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-black text-[#A8A29E]">{t('الإضافات:', 'Suppléments :')}</label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {activeProductForOptions.addons.map((a) => {
                    const isChecked = selectedAddons.some((sa) => sa.id === a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setSelectedAddons(
                            isChecked
                              ? selectedAddons.filter((sa) => sa.id !== a.id)
                              : [...selectedAddons, a]
                          );
                        }}
                        className={`p-3 rounded-xl flex items-center justify-between text-xs border transition cursor-pointer ${
                          isChecked
                            ? 'bg-[#C6A15B]/20 border-[#C6A15B] text-[#F7F3EA]'
                            : 'bg-[#171717] border-[#33302B] text-[#A8A29E]'
                        }`}
                      >
                        <span className="font-bold">{lang === 'fr' && a.nameFr ? a.nameFr : a.nameAr}</span>
                        <span className="font-mono font-black text-[#C6A15B]">+{Number(a.price)} DA</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {(() => {
              const computedTotal =
                Number(activeProductForOptions.price) +
                (selectedVariant ? Number(selectedVariant.priceAdjustment) : 0) +
                selectedAddons.reduce((sum, a) => sum + Number(a.price), 0);
              return (
                <button
                  type="button"
                  onClick={handleConfirmProductWithOptions}
                  className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black text-base rounded-2xl shadow-xl active:scale-95 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus className="w-5 h-5 stroke-[3]" />
                  <span>{t(`تأكيد وإضافة — ${computedTotal.toLocaleString()} DA`, `Ajouter — ${computedTotal.toLocaleString()} DA`)}</span>
                </button>
              );
            })()}
          </div>
        </div>
      )}

      {/* Item Edit Modal */}
      {showItemEditModal && selectedCartItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-lg text-[#C6A15B]">
                {t(`تعديل: ${selectedCartItem.nameAr}`, `Modifier: ${selectedCartItem.nameFr || selectedCartItem.nameAr}`)}
              </h3>
              <button
                type="button"
                onClick={() => setShowItemEditModal(false)}
                className="p-2 rounded-xl bg-[#171717] text-[#A8A29E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#A8A29E] mb-1">{t('الكمية:', 'Quantité :')}</label>
                <input
                  type="number"
                  min="1"
                  value={editQtyInput}
                  onChange={(e) => setEditQtyInput(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-4 py-2.5 text-lg font-black text-[#F7F3EA]"
                />
              </div>
              {hasRole(['ADMIN', 'MANAGER']) && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-[#A8A29E] mb-1">{t('السعر (DA):', 'Prix (DA) :')}</label>
                    <input
                      type="number"
                      min="0"
                      data-testid="item-edit-price-input"
                      value={editPriceInput}
                      onChange={(e) => setEditPriceInput(e.target.value)}
                      className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-4 py-2.5 text-lg font-black text-[#F7F3EA]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#A8A29E] mb-1">
                      {t('سبب تعديل السعر (اختياري):', 'Motif modification prix :')}
                    </label>
                    <input
                      type="text"
                      data-testid="item-edit-price-reason-input"
                      value={editPriceReasonInput}
                      onChange={(e) => setEditPriceReasonInput(e.target.value)}
                      placeholder={t('تخفيض إداري / ضيافة...', 'Remise direction...')}
                      className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-4 py-2 text-sm font-bold text-[#F7F3EA]"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-bold text-[#A8A29E] mb-1">{t('ملاحظة للمطبخ:', 'Note cuisine :')}</label>
                <input
                  type="text"
                  value={editNotesInput}
                  onChange={(e) => setEditNotesInput(e.target.value)}
                  placeholder={t('بدون بصل، صوص حار...', 'Sans oignons...')}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-4 py-2.5 text-sm font-bold text-[#F7F3EA]"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const newQty = Math.max(1, parseInt(editQtyInput, 10) || 1);
                const parsedPrice = parseFloat(editPriceInput);
                const newPrice = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : selectedCartItem.unitPrice;
                setCartItemQuantity(selectedCartItem.id, newQty);
                if (hasRole(['ADMIN', 'MANAGER'])) {
                  setCartItemPrice(selectedCartItem.id, newPrice, editPriceReasonInput.trim() || undefined);
                }
                setCartItemNotes(selectedCartItem.id, editNotesInput);
                setShowItemEditModal(false);
              }}
              className="w-full py-3 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black text-base rounded-xl cursor-pointer"
            >
              {t('حفظ التعديلات', 'Enregistrer')}
            </button>
          </div>
        </div>
      )}

      {/* Discount Modal */}
      {showDiscountModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-sm w-full p-5 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-lg text-[#C6A15B]">{t('تطبيق خصم', 'Appliquer Remise')}</h3>
              <button
                type="button"
                onClick={() => setShowDiscountModal(false)}
                className="p-2 rounded-xl bg-[#171717] text-[#A8A29E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#A8A29E] mb-1">
                {t('مبلغ الخصم (DA):', 'Montant remise (DA) :')}
              </label>
              <input
                type="number"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                placeholder="200"
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-4 py-3 text-2xl font-black text-[#C6A15B] font-mono"
              />
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[0, 100, 200, 500].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setDiscountInput(String(amt))}
                  className="bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] text-xs font-black py-2 rounded-xl border border-[#33302B]"
                >
                  {amt} DA
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setDiscount(Math.max(0, parseFloat(discountInput) || 0));
                setShowDiscountModal(false);
              }}
              className="w-full py-3 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black text-base rounded-xl cursor-pointer"
            >
              {t('تطبيق الخصم', 'Appliquer')}
            </button>
          </div>
        </div>
      )}

      {/* Quick Table Selector Modal */}
      {showTableModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-xl w-full p-5 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B]">{t('اختر طاولة للطلب', 'Choisir une table')}</h3>
              <button
                type="button"
                onClick={() => setShowTableModal(false)}
                className="p-2 rounded-xl bg-[#171717] text-[#A8A29E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-h-80 overflow-y-auto p-1 no-scrollbar">
              {tablesList.map((tb) => {
                const isSelected = selectedTable?.id === tb.id;
                const isOccupied = tb.status !== 'AVAILABLE';
                return (
                  <button
                    key={tb.id}
                    type="button"
                    onClick={() => {
                      setSelectedTable(tb);
                      setShowTableModal(false);
                    }}
                    className={`p-3 rounded-2xl text-center border font-black transition cursor-pointer ${
                      isSelected
                        ? 'bg-[#C6A15B] text-[#171717] border-[#C6A15B]'
                        : isOccupied
                        ? 'bg-amber-950/50 border-amber-700/50 text-amber-300'
                        : 'bg-[#171717] hover:border-[#C6A15B] border-[#33302B] text-[#F7F3EA]'
                    }`}
                  >
                    <div className="text-lg font-mono">{tb.tableNumber}</div>
                    <div className="text-[11px] font-bold opacity-80">
                      {tb.status === 'AVAILABLE'
                        ? t(`${tb.capacity} مقاعد`, `${tb.capacity} pl.`)
                        : t('مشغولة', 'Occupée')}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Quick Customer Modal */}
      {showCustomerModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B]">{t('بيانات الزبون', 'Informations Client')}</h3>
              <button
                type="button"
                onClick={() => {
                  setCustomerError('');
                  setShowCustomerModal(false);
                }}
                className="p-2 rounded-xl bg-[#171717] text-[#A8A29E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {customerError && (
              <div
                data-testid="quick-customer-error"
                className="p-2.5 rounded-xl bg-red-950/70 border border-red-600/60 text-red-200 text-xs font-bold"
              >
                {customerError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#A8A29E] mb-1">{t('اسم الزبون:', 'Nom client :')}</label>
                <input
                  type="text"
                  data-testid="quick-customer-name-input"
                  value={customerNameInput}
                  onChange={(e) => {
                    setCustomerNameInput(e.target.value);
                    if (customerError) setCustomerError('');
                  }}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-4 py-2.5 text-base font-bold text-[#F7F3EA]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#A8A29E] mb-1">{t('رقم الهاتف:', 'Téléphone :')}</label>
                <input
                  type="tel"
                  data-testid="quick-customer-phone-input"
                  value={customerPhoneInput}
                  onChange={(e) => {
                    setCustomerPhoneInput(e.target.value);
                    if (customerError) setCustomerError('');
                  }}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-4 py-2.5 text-base font-bold text-[#F7F3EA]"
                />
              </div>
              {orderType === 'DELIVERY' && (
                <div>
                  <label className="block text-xs font-bold text-[#A8A29E] mb-1">{t('عنوان التوصيل:', 'Adresse livraison :')}</label>
                  <input
                    type="text"
                    data-testid="quick-customer-address-input"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl px-4 py-2.5 text-sm font-bold text-[#F7F3EA]"
                  />
                </div>
              )}
            </div>

            <button
              type="button"
              data-testid="save-quick-customer-btn"
              disabled={isSavingCustomer}
              onClick={async () => {
                const name = customerNameInput.trim();
                const phone = customerPhoneInput.trim();
                if (!name) {
                  setCustomerError(t('يرجى إدخال اسم الزبون', 'Veuillez saisir le nom du client'));
                  return;
                }
                if (!phone) {
                  setCustomerError(t('يرجى إدخال رقم هاتف صحيح', 'Veuillez saisir un numéro de téléphone'));
                  return;
                }
                setIsSavingCustomer(true);
                setCustomerError('');
                try {
                  const saved = await api.createCustomer({
                    name,
                    phone,
                    address: orderType === 'DELIVERY' ? deliveryAddress.trim() || undefined : undefined,
                  });
                  setSelectedCustomer(saved);
                  setShowCustomerModal(false);
                } catch (err: any) {
                  setCustomerError(err?.message || t('فشل حفظ بيانات الزبون', 'Échec d’enregistrement client'));
                } finally {
                  setIsSavingCustomer(false);
                }
              }}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl cursor-pointer"
            >
              {isSavingCustomer ? t('جاري الحفظ...', 'Enregistrement...') : t('حفظ وتحديد الزبون', 'Valider Client')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
