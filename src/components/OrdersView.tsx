import React, { useState, useEffect } from 'react';
import { Order } from '../types.ts';
import { usePos } from '../context/PosContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api, safeGetOfflinePayments } from '../services/api.ts';
import * as offlineStorage from '../services/offlineStorage.ts';
import type { OfflineOrderPayload, OfflinePaymentPayload } from '../services/offlineStorage.ts';
import {
  ClipboardList,
  RefreshCw,
  Search,
  Printer,
  ChefHat,
  DollarSign,
  RotateCcw,
  Ban,
  Edit3,
  X,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface OrdersViewProps {
  onOpenInPos: () => void;
  onPayOrder: (order: Order) => void;
}

export const OrdersView: React.FC<OrdersViewProps> = ({ onOpenInPos, onPayOrder }) => {
  const { loadActiveOrderIntoCart, setReceiptToPrint, refreshDashboard, triggerSync } = usePos();
  const { hasRole } = useAuth();
  const { t } = useLanguage();

  const [orders, setOrders] = useState<Order[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<OfflineOrderPayload[]>([]);
  const [offlinePaymentsQueue, setOfflinePaymentsQueue] = useState<OfflinePaymentPayload[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'HELD' | 'COMPLETED' | 'REFUNDED'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const notify = (type: 'success' | 'error', text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 4000);
  };

  const refreshLocalQueuesOnly = async () => {
    const [queued, queuedPays] = await Promise.all([
      offlineStorage.getOfflineOrders().catch(() => []),
      safeGetOfflinePayments(),
    ]);
    setOfflineQueue(Array.isArray(queued) ? queued : []);
    setOfflinePaymentsQueue(Array.isArray(queuedPays) ? queuedPays : []);
  };

  const loadOrders = async () => {
    setIsLoading(true);
    try {
      const [remote, queued, queuedPays] = await Promise.all([
        api.getOrders({ limit: 80 }).catch(() => []),
        offlineStorage.getOfflineOrders().catch(() => []),
        safeGetOfflinePayments(),
      ]);
      setOrders(Array.isArray(remote) ? remote : []);
      setOfflineQueue(Array.isArray(queued) ? queued : []);
      setOfflinePaymentsQueue(Array.isArray(queuedPays) ? queuedPays : []);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    const handleQueueUpdated = () => {
      refreshLocalQueuesOnly();
    };
    window.addEventListener('pos:offline-queue-updated', handleQueueUpdated);
    return () => window.removeEventListener('pos:offline-queue-updated', handleQueueUpdated);
  }, []);

  const filteredOrders = orders.filter((ord) => {
    if (statusFilter === 'ACTIVE') {
      if (ord.isHeld || ['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(ord.status)) return false;
    } else if (statusFilter === 'HELD') {
      if (!ord.isHeld) return false;
    } else if (statusFilter === 'COMPLETED') {
      if (ord.paymentStatus !== 'PAID' && ord.status !== 'COMPLETED') return false;
    } else if (statusFilter === 'REFUNDED') {
      if (ord.status !== 'REFUNDED' && ord.paymentStatus !== 'REFUNDED') return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        ord.orderNumber.toLowerCase().includes(q) ||
        (ord.tableNumber && String(ord.tableNumber).toLowerCase().includes(q)) ||
        (ord.customerName && ord.customerName.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleOpenDetail = async (ord: Order) => {
    try {
      const full = await api.getOrder(ord.id);
      setSelectedOrder(full || ord);
    } catch {
      setSelectedOrder(ord);
    }
  };

  const handlePrintReceipt = (ord: Order, kitchen = false) => {
    setReceiptToPrint({
      orderId: ord.id,
      isKitchenTicket: kitchen,
      orderNumber: ord.orderNumber,
      dailySequence: ord.dailySequence,
      tableNumber: ord.table?.tableNumber || ord.tableNumber,
      customerName: ord.customer?.name || ord.customerName,
      orderType: ord.type,
      items: ord.items || [],
      subtotal: Number(ord.subtotal),
      discount: Number(ord.discount || 0),
      deliveryFee: Number(ord.deliveryFee || 0),
      taxRate: Number(ord.taxRate || 0),
      taxAmount: Number(ord.taxAmount || 0),
      total: Number(ord.total),
      paidAmount: Number(ord.paidAmount || 0),
      tenderAmount: Number(ord.paidAmount || 0),
      changeAmount: Number(ord.changeAmount || 0),
      payments: (ord as any).payments || [],
      cashierName: ord.cashier?.fullName || ord.cashierName || 'Admin',
      notes: ord.notes,
      time: new Date(ord.createdAt).toLocaleTimeString('fr-FR'),
      date: new Date(ord.createdAt).toLocaleDateString('fr-FR'),
    });
  };

  const handleCancelOrder = async (ord: Order) => {
    try {
      await api.cancelOrder(ord.id, t('إلغاء من سجل الطلبات', 'Annulation depuis commandes'));
      notify('success', t(`تم إلغاء الطلب ${ord.orderNumber}`, `Commande ${ord.orderNumber} annulée`));
      setSelectedOrder(null);
      await loadOrders();
      await refreshDashboard();
    } catch (err: any) {
      notify('error', err.message || t('تعذر إلغاء الطلب', 'Impossible d’annuler'));
    }
  };

  const handleRefundOrder = async (ord: Order) => {
    try {
      await api.refundOrder(ord.id, t('استرجاع فاتورة', 'Remboursement facture'));
      notify('success', t(`تم استرجاع الطلب ${ord.orderNumber} بنجاح`, `Commande ${ord.orderNumber} remboursée`));
      setSelectedOrder(null);
      await loadOrders();
      await refreshDashboard();
    } catch (err: any) {
      notify('error', err.message || t('تعذر استرجاع الطلب', 'Erreur remboursement'));
    }
  };

  const statusBadge = (ord: Order) => {
    if (ord.status === 'REFUNDED' || ord.paymentStatus === 'REFUNDED') {
      return <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-rose-950/70 text-rose-300 border border-rose-700/60">{t('مسترجع', 'Remboursé')}</span>;
    }
    if (ord.status === 'CANCELLED') {
      return <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-neutral-800 text-[#A8A29E] border border-[#33302B]">{t('ملغى', 'Annulé')}</span>;
    }
    if (ord.paymentStatus === 'PAID') {
      return <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-emerald-950/70 text-emerald-300 border border-emerald-700/60">{t('مدفوع', 'Payé')}</span>;
    }
    if (ord.paymentStatus === 'PARTIALLY_PAID') {
      return <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-amber-950/70 text-amber-300 border border-amber-600/60">{t('دفع جزئي', 'Partiel')}</span>;
    }
    if (ord.isHeld) {
      return <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-[#C6A15B]/20 text-[#C6A15B] border border-[#C6A15B]/50">{t('معلق', 'En attente')}</span>;
    }
    if (ord.status === 'READY') {
      return <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-sky-950/70 text-sky-300 border border-sky-600/60">{t('جاهز', 'Prêt')}</span>;
    }
    return <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-amber-950/60 text-amber-200 border border-amber-700/50">{t('قيد التحضير', 'En cours')}</span>;
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#171717] p-2.5 sm:p-4 space-y-3 text-[#F7F3EA] select-none">
      {/* Top Filter & Search Bar */}
      <div className="bg-[#222222] p-3 sm:p-4 rounded-2xl border border-[#33302B] shadow-lg shrink-0 space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ClipboardList className="w-6 h-6 text-[#C6A15B]" />
            <h2 className="text-lg sm:text-xl font-black text-[#C6A15B]">
              {t('إدارة الطلبات والفواتير', 'Gestion des Commandes')}
            </h2>
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#A8A29E] absolute right-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('بحث برقم الطلب أو الطاولة...', 'Rechercher N° bon ou table...')}
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl pr-9 pl-3 py-2 text-sm text-[#F7F3EA] placeholder-[#A8A29E] focus:outline-none focus:border-[#C6A15B]"
              />
            </div>

            <button
              type="button"
              onClick={loadOrders}
              className="p-2.5 rounded-xl bg-[#171717] border border-[#33302B] hover:border-[#C6A15B] text-[#C6A15B] cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#33302B]">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {[
              { id: 'ALL', ar: 'الكل', fr: 'Toutes' },
              { id: 'ACTIVE', ar: 'النشطة', fr: 'Actives' },
              { id: 'HELD', ar: 'المعلقة', fr: 'En attente' },
              { id: 'COMPLETED', ar: 'المدفوعة', fr: 'Payées' },
              { id: 'REFUNDED', ar: 'المسترجعة', fr: 'Remboursées' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer whitespace-nowrap ${
                  statusFilter === f.id
                    ? 'bg-[#C6A15B] text-[#171717]'
                    : 'bg-[#171717] text-[#A8A29E] hover:text-[#F7F3EA] border border-[#33302B]'
                }`}
              >
                {t(f.ar, f.fr)}
              </button>
            ))}
          </div>

          {actionMsg && (
            <div
              className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 border ${
                actionMsg.type === 'success'
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50'
                  : 'bg-red-950/80 text-red-300 border-red-600/50'
              }`}
            >
              {actionMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
              <span>{actionMsg.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* Offline Pending Queue Banner */}
      {(offlineQueue.length > 0 || offlinePaymentsQueue.length > 0) && (
        <div
          data-testid="offline-queue-banner"
          className="bg-amber-950/50 border border-[#C6A15B] rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 shrink-0"
        >
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-[#F7F3EA]">
            <WifiOff className="w-4 h-4 text-[#C6A15B]" />
            <span>
              {t(
                `يوجد ${offlineQueue.length} طلبات و ${offlinePaymentsQueue.length} دفعات محفوظة محلياً بانتظار المزامنة`,
                `${offlineQueue.length} commande(s) et ${offlinePaymentsQueue.length} paiement(s) hors ligne en attente de synchronisation`
              )}
            </span>
          </div>
          <button
            type="button"
            data-testid="sync-now-btn"
            onClick={async () => {
              await triggerSync(true);
              await loadOrders();
            }}
            className="px-3 py-1.5 rounded-xl bg-[#C6A15B] text-[#171717] font-black text-xs cursor-pointer"
          >
            {t('مزامنة الآن', 'Synchroniser')}
          </button>
        </div>
      )}

      {/* Orders List / Table */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-2">
        {filteredOrders.length === 0 && offlineQueue.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-[#A8A29E]">
            <ClipboardList className="w-12 h-12 mb-2 opacity-50" />
            <p className="font-bold text-base">{t('لا توجد طلبات مطابقة', 'Aucune commande trouvée')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 pb-6">
            {/* Queued Offline Orders (kept visible until server confirmation) */}
            {offlineQueue
              .filter((off) => {
                if (!searchQuery.trim()) return true;
                const q = searchQuery.toLowerCase();
                return (
                  `bon-off-${off.offlineId.slice(-4)}`.includes(q) ||
                  off.offlineId.toLowerCase().includes(q) ||
                  (off.tableNumber && String(off.tableNumber).toLowerCase().includes(q))
                );
              })
              .map((off) => {
                const offNumber = `BON-OFF-${off.offlineId.slice(-4)}`;
                const offTotal = Number(off.total || 0);
                const offPaid = Number(off.paidAmount || 0);
                const legsSummary =
                  off.payments && off.payments.length > 0
                    ? off.payments.map((p) => `${p.method}:${p.amount}`).join(' • ')
                    : off.paymentMethod || '';
                const effectiveState = off.queueState || off.syncStatus;
                const syncBadgeText =
                  effectiveState === 'SYNCING' || effectiveState === 'PROCESSING'
                    ? t('جاري المزامنة...', 'Synchronisation...')
                    : effectiveState === 'FAILED' || off.conflictType
                    ? t('تحتاج مراجعة/إعادة', 'Échec / Conflit')
                    : effectiveState === 'RETRY_WAIT'
                    ? t('انتظار إعادة المحاولة', 'Attente réessai')
                    : t('بانتظار المزامنة', 'En attente de sync');

                return (
                  <div
                    key={off.offlineId}
                    data-testid={`offline-order-card-${off.offlineId}`}
                    className={`bg-[#222222] rounded-2xl p-3.5 space-y-2 shadow-md border ${
                      effectiveState === 'FAILED' || off.conflictType
                        ? 'border-rose-600/80'
                        : 'border-[#C6A15B]/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono font-black text-base text-[#C6A15B] flex items-center gap-1.5">
                          <WifiOff className="w-4 h-4 shrink-0" />
                          <span>{offNumber}</span>
                        </div>
                        <div className="text-xs text-[#A8A29E] font-bold">
                          {off.type === 'DINE_IN'
                            ? t(`طاولة ${off.tableNumber || '—'}`, `Table ${off.tableNumber || '—'}`)
                            : off.type === 'DELIVERY'
                            ? t('توصيل', 'Livraison')
                            : t('محمول', 'À emporter')}
                          {' • '}
                          {new Date(off.createdAt).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-black border ${
                          effectiveState === 'FAILED' || off.conflictType
                            ? 'bg-rose-950/80 text-rose-300 border-rose-600/60'
                            : 'bg-amber-950/80 text-[#C6A15B] border-[#C6A15B]/50'
                        }`}
                      >
                        {syncBadgeText}
                      </span>
                    </div>

                    <div className="text-xs text-[#A8A29E] flex flex-wrap items-center justify-between gap-1">
                      <span>
                        {off.items?.length || 0} {t('أصناف', 'articles')}
                        {legsSummary ? ` • ${legsSummary}` : ''}
                      </span>
                      {Number(off.retryCount || 0) > 0 && (
                        <span className="font-mono text-amber-300">
                          {t(`محاولات: ${off.retryCount}`, `Tentatives: ${off.retryCount}`)}
                        </span>
                      )}
                    </div>

                    {off.lastError && (
                      <div className="text-[11px] text-amber-300 bg-amber-950/50 border border-amber-700/40 rounded-lg px-2 py-1 truncate">
                        {off.lastError}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-[#33302B]">
                      <span className="text-lg font-black text-[#C6A15B] font-mono tabular-nums">
                        {offTotal.toLocaleString()} DA
                      </span>
                      <span className="text-xs font-bold text-emerald-400">
                        {offPaid > 0
                          ? t(`مدفوع محلياً (${off.paymentStatus})`, `Payé localement (${off.paymentStatus})`)
                          : t('غير مدفوع', 'Non payé')}
                      </span>
                    </div>
                  </div>
                );
              })}

            {filteredOrders.map((ord) => {
              const totalVal = Number(ord.total || 0);
              const paidVal = Number(ord.paidAmount || 0);
              const dueVal = Math.max(0, totalVal - paidVal);

              return (
                <div
                  key={ord.id}
                  data-testid={`order-card-${ord.orderNumber}`}
                  onClick={() => handleOpenDetail(ord)}
                  className="bg-[#222222] hover:border-[#C6A15B]/70 border border-[#33302B] rounded-2xl p-3.5 space-y-2.5 cursor-pointer transition shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono font-black text-base text-[#F7F3EA]">
                        {ord.orderNumber}
                      </div>
                      <div className="text-xs text-[#A8A29E] font-bold">
                        {ord.type === 'DINE_IN'
                          ? t(`طاولة ${ord.tableNumber || '—'}`, `Table ${ord.tableNumber || '—'}`)
                          : ord.type === 'DELIVERY'
                          ? t('توصيل', 'Livraison')
                          : t('محمول', 'À emporter')}
                        {' • '}
                        {new Date(ord.createdAt).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                    {statusBadge(ord)}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#33302B]">
                    <div>
                      <span className="text-lg font-black text-[#C6A15B] font-mono tabular-nums">
                        {totalVal.toLocaleString()} DA
                      </span>
                      {ord.paymentStatus === 'PARTIALLY_PAID' && (
                        <div className="text-[11px] text-amber-300 font-bold tabular-nums">
                          {t(`متبقي: ${dueVal.toLocaleString()} DA`, `Reste: ${dueVal.toLocaleString()} DA`)}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {ord.paymentStatus !== 'PAID' &&
                        ord.status !== 'CANCELLED' &&
                        ord.status !== 'REFUNDED' &&
                        hasRole(['ADMIN', 'MANAGER', 'CASHIER']) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPayOrder(ord);
                            }}
                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black flex items-center gap-1 cursor-pointer"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            <span>{t('تسديد', 'Payer')}</span>
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetail(ord);
                        }}
                        className="px-2.5 py-1.5 bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#F7F3EA] rounded-xl text-xs font-bold cursor-pointer"
                      >
                        {t('تفاصيل', 'Détails')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 text-[#F7F3EA] max-h-[92vh] overflow-y-auto no-scrollbar">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <div>
                <h3 className="font-black text-xl text-[#C6A15B] font-mono">
                  {selectedOrder.orderNumber}
                </h3>
                <p className="text-xs text-[#A8A29E] font-bold">
                  {new Date(selectedOrder.createdAt).toLocaleString('fr-FR')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {statusBadge(selectedOrder)}
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="p-2 rounded-xl bg-[#171717] text-[#A8A29E] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Items */}
            <div className="bg-[#171717] border border-[#33302B] rounded-2xl p-3 space-y-2 max-h-56 overflow-y-auto">
              {(selectedOrder.items || []).map((it) => (
                <div key={it.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-mono font-black text-[#C6A15B]">{it.quantity}× </span>
                    <span className="font-bold">{t(it.nameAr, it.nameFr || it.nameAr)}</span>
                    {it.notes && <div className="text-[11px] text-[#A8A29E]">{it.notes}</div>}
                  </div>
                  <span className="font-mono font-black tabular-nums">
                    {Number(it.total).toLocaleString()} DA
                  </span>
                </div>
              ))}
            </div>

            {/* Financial summary */}
            <div className="bg-[#171717] border border-[#33302B] rounded-2xl p-3 space-y-1 text-sm">
              <div className="flex justify-between text-[#A8A29E]">
                <span>{t('المبلغ الإجمالي:', 'Total :')}</span>
                <span className="font-mono font-black text-[#C6A15B] tabular-nums">
                  {Number(selectedOrder.total).toLocaleString()} DA
                </span>
              </div>
              <div className="flex justify-between text-emerald-400">
                <span>{t('المبلغ المدفوع:', 'Payé :')}</span>
                <span className="font-mono font-bold tabular-nums">
                  {Number(selectedOrder.paidAmount || 0).toLocaleString()} DA
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => handlePrintReceipt(selectedOrder, false)}
                className="py-2.5 px-3 bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#F7F3EA] font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4 text-[#C6A15B]" />
                <span>{t('طباعة الفاتورة', 'Imprimer Reçu')}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePrintReceipt(selectedOrder, true)}
                className="py-2.5 px-3 bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#F7F3EA] font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ChefHat className="w-4 h-4 text-[#C6A15B]" />
                <span>{t('تذكرة المطبخ', 'Bon Cuisine')}</span>
              </button>

              {selectedOrder.paymentStatus !== 'PAID' &&
                selectedOrder.status !== 'CANCELLED' &&
                selectedOrder.status !== 'REFUNDED' && (
                  <button
                    type="button"
                    onClick={() => {
                      loadActiveOrderIntoCart(selectedOrder);
                      setSelectedOrder(null);
                      onOpenInPos();
                    }}
                    className="py-2.5 px-3 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 className="w-4 h-4" />
                    <span>{t('تعديل في الكاشير', 'Modifier en POS')}</span>
                  </button>
                )}

              {selectedOrder.paymentStatus !== 'PAID' &&
                selectedOrder.status !== 'CANCELLED' &&
                selectedOrder.status !== 'REFUNDED' &&
                hasRole(['ADMIN', 'MANAGER', 'CASHIER']) && (
                  <button
                    type="button"
                    onClick={() => {
                      const ord = selectedOrder;
                      setSelectedOrder(null);
                      onPayOrder(ord);
                    }}
                    className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>{t('تسديد الفاتورة', 'Encaisser')}</span>
                  </button>
                )}

              {selectedOrder.paymentStatus === 'UNPAID' &&
                selectedOrder.status !== 'CANCELLED' &&
                hasRole(['ADMIN', 'MANAGER', 'CASHIER']) && (
                  <button
                    type="button"
                    onClick={() => handleCancelOrder(selectedOrder)}
                    className="py-2.5 px-3 bg-red-950/60 hover:bg-red-900/70 border border-red-700/60 text-red-200 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Ban className="w-4 h-4" />
                    <span>{t('إلغاء الطلب', 'Annuler')}</span>
                  </button>
                )}

              {selectedOrder.paymentStatus === 'PAID' &&
                selectedOrder.status !== 'REFUNDED' &&
                hasRole(['ADMIN', 'MANAGER']) && (
                  <button
                    type="button"
                    onClick={() => handleRefundOrder(selectedOrder)}
                    className="col-span-2 py-2.5 px-3 bg-rose-950/70 hover:bg-rose-900/80 border border-rose-600/60 text-rose-200 font-black text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>{t('استرجاع الفاتورة (Refund)', 'Rembourser Facture')}</span>
                  </button>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
