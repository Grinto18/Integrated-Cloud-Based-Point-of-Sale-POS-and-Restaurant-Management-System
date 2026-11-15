import React, { useState, useEffect } from 'react';
import { Order, RestaurantTable } from '../types.ts';
import { usePos } from '../context/PosContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api } from '../services/api.ts';
import {
  Grid,
  Plus,
  RefreshCw,
  Users,
  MoveRight,
  GitMerge,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Check,
  X,
  DollarSign,
  Utensils,
} from 'lucide-react';

interface TableMapProps {
  onSelectTableForOrder: (table: RestaurantTable) => void;
  onPayOrder?: (order: Order) => void;
}

export const TableMap: React.FC<TableMapProps> = ({ onSelectTableForOrder, onPayOrder }) => {
  const { setSelectedTable, setOrderType, loadActiveOrderIntoCart, clearCart, refreshDashboard } = usePos();
  const { hasRole } = useAuth();
  const { t } = useLanguage();

  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [activeZone, setActiveZone] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'AVAILABLE' | 'OCCUPIED' | 'READY' | 'WAITING_PAYMENT' | 'INACTIVE'
  >('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Detail Modal for occupied/ready/waiting-payment tables
  const [detailTable, setDetailTable] = useState<RestaurantTable | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);

  // Transfer modal
  const [transferFromTable, setTransferFromTable] = useState<RestaurantTable | null>(null);
  const [transferToTableId, setTransferToTableId] = useState<number | null>(null);

  // Merge modal
  const [mergeSourceTable, setMergeSourceTable] = useState<RestaurantTable | null>(null);
  const [mergeTargetTableId, setMergeTargetTableId] = useState<number | null>(null);

  // Add Table modal
  const [showAddTableModal, setShowAddTableModal] = useState<boolean>(false);
  const [newTableNum, setNewTableNum] = useState<string>('');
  const [newTableZone, setNewTableZone] = useState<string>('الصالة الرئيسية');
  const [newTableCapacity, setNewTableCapacity] = useState<number>(4);

  // Status options modal
  const [selectedTableForOptions, setSelectedTableForOptions] = useState<RestaurantTable | null>(null);

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  };

  useEffect(() => {
    loadTables();
  }, []);

  const loadTables = async () => {
    setIsLoading(true);
    try {
      const data = await api.getTables();
      if (Array.isArray(data)) {
        data.sort((a: any, b: any) => {
          const numA = parseInt(String(a.tableNumber).replace(/\D/g, '') || String(a.id), 10);
          const numB = parseInt(String(b.tableNumber).replace(/\D/g, '') || String(b.id), 10);
          return numA - numB;
        });
        setTables(data);
      }
    } catch (err) {
      console.error('Failed to load tables:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const zones = ['ALL', ...Array.from(new Set(tables.map((tItem) => tItem.zone)))];

  const filteredTables = tables.filter((table) => {
    const zoneMatch = activeZone === 'ALL' || table.zone === activeZone;
    const statusMatch = statusFilter === 'ALL' || table.status === statusFilter;
    return zoneMatch && statusMatch;
  });

  const availableCount = tables.filter((tb) => tb.status === 'AVAILABLE').length;
  const occupiedCount = tables.filter((tb) => tb.status === 'OCCUPIED').length;
  const readyCount = tables.filter((tb) => tb.status === 'READY').length;
  const waitingPaymentCount = tables.filter((tb) => tb.status === 'WAITING_PAYMENT').length;
  const inactiveCount = tables.filter((tb) => tb.status === 'INACTIVE').length;

  const openTableInPos = async (table: RestaurantTable) => {
    setOrderType('DINE_IN');
    if (table.activeOrder && table.activeOrder.id) {
      try {
        const fullOrder = await api.getOrder(table.activeOrder.id);
        if (fullOrder) {
          loadActiveOrderIntoCart(fullOrder);
        } else {
          setSelectedTable(table);
        }
      } catch {
        setSelectedTable(table);
      }
    } else {
      clearCart();
      setSelectedTable(table);
    }
    setDetailTable(null);
    onSelectTableForOrder(table);
  };

  const handleTableClick = async (table: RestaurantTable) => {
    if (table.status === 'INACTIVE') {
      setSelectedTableForOptions(table);
      return;
    }

    if (table.status === 'AVAILABLE' && !table.activeOrder) {
      await openTableInPos(table);
      return;
    }

    // Occupied / Ready / Waiting Payment -> Open Table Detail modal
    setDetailTable(table);
    setDetailOrder(null);
    if (table.activeOrder?.id) {
      setIsLoadingDetail(true);
      try {
        const fullOrder = await api.getOrder(table.activeOrder.id);
        setDetailOrder(fullOrder);
      } catch {
        setDetailOrder(null);
      } finally {
        setIsLoadingDetail(false);
      }
    }
  };

  const handleExecuteTransfer = async () => {
    if (!transferFromTable || !transferToTableId) return;
    try {
      await api.transferTable(transferFromTable.id, transferToTableId);
      showFeedback(
        'success',
        t(
          `تم نقل الطلب من الطاولة ${transferFromTable.tableNumber} بنجاح`,
          `Commande transférée de la table ${transferFromTable.tableNumber}`
        )
      );
      setTransferFromTable(null);
      setTransferToTableId(null);
      setDetailTable(null);
      await loadTables();
      await refreshDashboard();
    } catch (err: any) {
      showFeedback('error', err.message || t('فشل نقل الطاولة', 'Échec du transfert'));
    }
  };

  const handleExecuteMerge = async () => {
    if (!mergeSourceTable || !mergeTargetTableId) return;
    try {
      await api.mergeTables(mergeSourceTable.id, mergeTargetTableId);
      showFeedback(
        'success',
        t(
          `تم دمج الطاولة ${mergeSourceTable.tableNumber} بنجاح`,
          `Table ${mergeSourceTable.tableNumber} fusionnée`
        )
      );
      setMergeSourceTable(null);
      setMergeTargetTableId(null);
      setDetailTable(null);
      await loadTables();
      await refreshDashboard();
    } catch (err: any) {
      showFeedback('error', err.message || t('فشل دمج الطاولات', 'Échec de la fusion'));
    }
  };

  const handleToggleTableStatus = async (table: RestaurantTable, newStatus: string) => {
    try {
      await api.updateTableStatus(table.id, newStatus, newStatus === 'AVAILABLE' ? null : undefined);
      setSelectedTableForOptions(null);
      await loadTables();
      await refreshDashboard();
    } catch (err: any) {
      showFeedback('error', err.message || t('فشل تحديث حالة الطاولة', 'Erreur mise à jour table'));
    }
  };

  const handleAddTable = async () => {
    if (!newTableNum.trim()) return;
    try {
      await api.createTable({
        tableNumber: newTableNum.trim(),
        zone: newTableZone,
        capacity: newTableCapacity,
      });
      setShowAddTableModal(false);
      setNewTableNum('');
      await loadTables();
    } catch (err: any) {
      showFeedback('error', err.message || t('فشل إنشاء الطاولة', 'Erreur création table'));
    }
  };

  const getElapsedDuration = (createdAt?: string) => {
    if (!createdAt) return t('الآن', 'Maintenant');
    try {
      const diffMins = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
      if (diffMins < 1) return t('الآن', 'Maintenant');
      if (diffMins < 60) return t(`منذ ${diffMins} د`, `${diffMins} min`);
      const hours = Math.floor(diffMins / 60);
      const rem = diffMins % 60;
      return t(`منذ ${hours} س ${rem} د`, `${hours}h ${rem}m`);
    } catch {
      return '';
    }
  };

  return (
    <div className="h-full flex-1 flex flex-col overflow-hidden bg-[#171717] p-2.5 sm:p-4 select-none text-[#F7F3EA] w-full">
      {/* Top Banner */}
      <div className="bg-[#222222] p-3 sm:p-4 rounded-2xl border border-[#33302B] shadow-lg shrink-0 space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="font-black text-base sm:text-xl text-[#C6A15B] flex items-center gap-2 shrink-0">
              <Grid className="w-5 h-5 sm:w-6 sm:h-6 text-[#C6A15B]" />
              <span className="whitespace-nowrap">
                {t(`طاولات المطعم (${tables.length})`, `Plan de Salle (${tables.length})`)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar smooth-scroll">
              {zones.map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setActiveZone(z)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0 ${
                    activeZone === z
                      ? 'bg-[#C6A15B] text-[#171717] shadow'
                      : 'bg-[#171717] hover:border-[#C6A15B]/50 text-[#A8A29E] hover:text-[#F7F3EA] border border-[#33302B]'
                  }`}
                >
                  {z === 'ALL' ? t(`الكل (${tables.length})`, `Toutes (${tables.length})`) : z}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 justify-end shrink-0">
            {hasRole(['ADMIN', 'MANAGER']) && (
              <button
                type="button"
                onClick={() => setShowAddTableModal(true)}
                className="flex items-center gap-1.5 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] px-3.5 py-2 rounded-xl text-xs font-black transition active:scale-95 shadow cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>{t('إضافة طاولة', 'Ajouter Table')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={loadTables}
              className="p-2 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#C6A15B] transition active:scale-95 cursor-pointer"
              title={t('تحديث الخريطة', 'Actualiser')}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Status Filter Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-[#33302B]">
          <div className="flex items-center gap-1.5 text-xs font-black overflow-x-auto no-scrollbar py-0.5">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-xl border transition cursor-pointer whitespace-nowrap shrink-0 ${
                statusFilter === 'ALL'
                  ? 'bg-[#C6A15B] text-[#171717] border-[#C6A15B]'
                  : 'bg-[#171717] text-[#A8A29E] border-[#33302B] hover:text-[#F7F3EA]'
              }`}
            >
              {t(`الكل (${tables.length})`, `Toutes (${tables.length})`)}
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('AVAILABLE')}
              className={`px-3 py-1.5 rounded-xl border transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                statusFilter === 'AVAILABLE'
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-emerald-950/40 text-emerald-300 border-emerald-700/50 hover:bg-emerald-950/70'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>{t(`متاحة (${availableCount})`, `Libres (${availableCount})`)}</span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('OCCUPIED')}
              className={`px-3 py-1.5 rounded-xl border transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                statusFilter === 'OCCUPIED'
                  ? 'bg-[#C6A15B] text-[#171717] border-[#C6A15B]'
                  : 'bg-[#C6A15B]/15 text-[#C6A15B] border-[#C6A15B]/40 hover:bg-[#C6A15B]/25'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-[#C6A15B] animate-pulse" />
              <span>{t(`مشغولة (${occupiedCount})`, `Occupées (${occupiedCount})`)}</span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('READY')}
              className={`px-3 py-1.5 rounded-xl border transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                statusFilter === 'READY'
                  ? 'bg-sky-600 text-white border-sky-500'
                  : 'bg-sky-950/40 text-sky-300 border-sky-700/50 hover:bg-sky-950/70'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              <span>{t(`الطلب جاهز (${readyCount})`, `Prêtes (${readyCount})`)}</span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('WAITING_PAYMENT')}
              className={`px-3 py-1.5 rounded-xl border transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                statusFilter === 'WAITING_PAYMENT'
                  ? 'bg-amber-600 text-white border-amber-500'
                  : 'bg-amber-950/40 text-amber-300 border-amber-700/50 hover:bg-amber-950/70'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>{t(`بانتظار الدفع (${waitingPaymentCount})`, `Attente Paiement (${waitingPaymentCount})`)}</span>
            </button>

            {inactiveCount > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('INACTIVE')}
                className={`px-3 py-1.5 rounded-xl border transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  statusFilter === 'INACTIVE'
                    ? 'bg-neutral-600 text-white border-neutral-500'
                    : 'bg-[#171717] text-[#A8A29E] border-[#33302B]'
                }`}
              >
                <span>{t(`معطلة (${inactiveCount})`, `Inactives (${inactiveCount})`)}</span>
              </button>
            )}
          </div>

          {feedback && (
            <div
              className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 shrink-0 border ${
                feedback.type === 'success'
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60'
                  : 'bg-red-950/80 text-red-300 border-red-600/60'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* Tables Grid */}
      <div className="flex-1 overflow-y-auto no-scrollbar pt-3 smooth-scroll">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-3 pb-8">
          {filteredTables.map((table) => {
            const isOccupied = table.status === 'OCCUPIED';
            const isReady = table.status === 'READY';
            const isWaitingPayment = table.status === 'WAITING_PAYMENT';
            const isInactive = table.status === 'INACTIVE';
            const activeOrder = table.activeOrder;

            let cardStyle = 'bg-[#222222] border-emerald-600/50 hover:border-emerald-400';
            let badgeStyle = 'bg-emerald-950/70 text-emerald-300 border-emerald-600/60';
            let statusDot = 'bg-emerald-400';
            let statusText = t('متاحة', 'Libre');

            if (isOccupied) {
              cardStyle = 'bg-[#222222] border-[#C6A15B] ring-1 ring-[#C6A15B]/40';
              badgeStyle = 'bg-[#C6A15B]/20 text-[#C6A15B] border-[#C6A15B]/60';
              statusDot = 'bg-[#C6A15B] animate-pulse';
              statusText = t('مشغولة', 'Occupée');
            } else if (isReady) {
              cardStyle = 'bg-[#222222] border-sky-500 ring-1 ring-sky-400/40';
              badgeStyle = 'bg-sky-950/70 text-sky-300 border-sky-500/60';
              statusDot = 'bg-sky-400 animate-ping';
              statusText = t('الطلب جاهز', 'Prête');
            } else if (isWaitingPayment) {
              cardStyle = 'bg-[#222222] border-amber-500 ring-1 ring-amber-500/40';
              badgeStyle = 'bg-amber-950/70 text-amber-300 border-amber-500/60';
              statusDot = 'bg-amber-400';
              statusText = t('بانتظار الدفع', 'Paiement');
            } else if (isInactive) {
              cardStyle = 'bg-[#1B1B1B] border-[#33302B] opacity-55';
              badgeStyle = 'bg-[#171717] text-[#A8A29E] border-[#33302B]';
              statusDot = 'bg-[#A8A29E]';
              statusText = t('معطلة', 'Inactive');
            }

            return (
              <div
                key={table.id}
                data-testid={`table-card-${table.tableNumber}`}
                onClick={() => handleTableClick(table)}
                className={`p-3 sm:p-4 rounded-2xl border-2 flex flex-col justify-between min-h-[168px] transition-all cursor-pointer relative shadow-md hover:shadow-xl active:scale-[0.98] ${cardStyle}`}
              >
                {/* Top */}
                <div className="flex items-start justify-between gap-1">
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl sm:text-3xl font-black text-[#F7F3EA] font-mono tabular-nums">
                        {table.tableNumber}
                      </span>
                      <span className="text-[11px] font-bold text-[#A8A29E]">
                        {t('طاولة', 'Table')}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#A8A29E] font-semibold block truncate max-w-[115px]">
                      {table.zone}
                    </span>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-black border flex items-center gap-1 shrink-0 ${badgeStyle}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                    <span>{statusText}</span>
                  </span>
                </div>

                {/* Middle */}
                <div className="my-auto py-1.5">
                  {activeOrder ? (
                    <div className="bg-[#171717] p-2.5 rounded-xl border border-[#33302B] space-y-1">
                      <div className="flex items-center justify-between text-xs font-black">
                        <span className="text-[#A8A29E] font-mono">{activeOrder.orderNumber}</span>
                        <span className="text-[#C6A15B] text-sm font-black font-mono tabular-nums">
                          {Number(activeOrder.total || 0).toLocaleString()} <span className="text-[10px]">DA</span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-[#A8A29E] font-bold">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-[#C6A15B]" />
                          <span>{getElapsedDuration(activeOrder.createdAt)}</span>
                        </span>
                        <span>
                          {table.capacity} {t('مقاعد', 'places')}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-[#A8A29E] font-bold px-1">
                      <Users className="w-4 h-4 text-[#C6A15B]" />
                      <span>
                        {t(`سعة ${table.capacity} أشخاص`, `${table.capacity} places`)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Bottom Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-[#33302B] gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTableClick(table);
                    }}
                    className={`text-xs font-black px-2.5 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1 ${
                      isOccupied || isReady
                        ? 'bg-[#C6A15B] text-[#171717] hover:bg-[#D4B475]'
                        : isWaitingPayment
                        ? 'bg-amber-600 text-white hover:bg-amber-500'
                        : isInactive
                        ? 'bg-[#171717] text-[#A8A29E]'
                        : 'bg-emerald-600 text-white hover:bg-emerald-500'
                    }`}
                  >
                    {isOccupied || isReady ? (
                      <>
                        <Utensils className="w-3.5 h-3.5" />
                        <span>{t('عرض الطلب', 'Voir')}</span>
                      </>
                    ) : isWaitingPayment ? (
                      <>
                        <DollarSign className="w-3.5 h-3.5" />
                        <span>{t('تسديد', 'Payer')}</span>
                      </>
                    ) : isInactive ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>{t('تفعيل', 'Activer')}</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5 stroke-[3]" />
                        <span>{t('طلب جديد', 'Nouvelle')}</span>
                      </>
                    )}
                  </button>

                  <div className="flex items-center gap-1">
                    {(isOccupied || isReady || isWaitingPayment) &&
                      hasRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']) && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTransferFromTable(table);
                            }}
                            className="p-1.5 bg-[#171717] hover:border-[#C6A15B] text-[#C6A15B] rounded-lg border border-[#33302B] transition cursor-pointer"
                            title={t('نقل الطلب لطاولة أخرى', 'Transférer la table')}
                          >
                            <MoveRight className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMergeSourceTable(table);
                            }}
                            className="p-1.5 bg-[#171717] hover:border-[#C6A15B] text-[#C6A15B] rounded-lg border border-[#33302B] transition cursor-pointer"
                            title={t('دمج مع طاولة أخرى', 'Fusionner')}
                          >
                            <GitMerge className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTableForOptions(table);
                      }}
                      className="p-1.5 bg-[#171717] hover:border-[#C6A15B] text-[#A8A29E] hover:text-[#F7F3EA] rounded-lg border border-[#33302B] transition cursor-pointer text-xs font-mono font-black"
                      title={t('إدارة حالة الطاولة', 'Options de table')}
                    >
                      •••
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Table Detail Modal */}
      {detailTable && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <div>
                <h3 className="font-black text-xl text-[#C6A15B]">
                  {t(`الطاولة ${detailTable.tableNumber}`, `Table ${detailTable.tableNumber}`)}
                </h3>
                <p className="text-xs text-[#A8A29E] font-bold">
                  {detailTable.zone} • {detailTable.activeOrder?.orderNumber || ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailTable(null)}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] hover:text-[#F7F3EA] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isLoadingDetail ? (
              <div className="py-8 text-center text-[#A8A29E] font-bold">
                {t('جاري تحميل تفاصيل الطلب...', 'Chargement de la commande...')}
              </div>
            ) : detailOrder ? (
              <div className="space-y-3">
                <div className="max-h-56 overflow-y-auto space-y-1.5 bg-[#171717] p-3 rounded-2xl border border-[#33302B]">
                  {(detailOrder.items || []).map((it) => (
                    <div key={it.id} className="flex items-center justify-between text-sm">
                      <span className="font-bold">
                        <span className="text-[#C6A15B] font-mono">{it.quantity}×</span> {t(it.nameAr, it.nameFr || it.nameAr)}
                      </span>
                      <span className="font-mono font-bold text-[#F7F3EA] tabular-nums">
                        {Number(it.total).toLocaleString()} DA
                      </span>
                    </div>
                  ))}
                </div>

                <div className="bg-[#171717] p-3 rounded-2xl border border-[#33302B] space-y-1 text-sm">
                  <div className="flex justify-between font-bold">
                    <span className="text-[#A8A29E]">{t('الإجمالي:', 'Total :')}</span>
                    <span className="text-[#C6A15B] font-black font-mono tabular-nums">
                      {Number(detailOrder.total).toLocaleString()} DA
                    </span>
                  </div>
                  {Number(detailOrder.paidAmount || 0) > 0 && (
                    <div className="flex justify-between font-bold text-xs text-emerald-400">
                      <span>{t('المدفوع مسبقاً:', 'Déjà payé :')}</span>
                      <span className="font-mono tabular-nums">
                        {Number(detailOrder.paidAmount).toLocaleString()} DA
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-base pt-1 border-t border-[#33302B]">
                    <span>{t('المتبقي للدفع:', 'Reste à payer :')}</span>
                    <span className="text-[#C6A15B] font-mono tabular-nums">
                      {Math.max(0, Number(detailOrder.total) - Number(detailOrder.paidAmount || 0)).toLocaleString()} DA
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#A8A29E] font-bold py-4">
                {t('لا توجد تفاصيل طلب محملة لهذه الطاولة.', 'Aucun détail de commande chargé.')}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => openTableInPos(detailTable)}
                className="py-3 px-4 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black text-sm rounded-xl flex items-center justify-center gap-2 cursor-pointer transition active:scale-95"
              >
                <Utensils className="w-4 h-4" />
                <span>{t('فتح / إضافة أصناف في الكاشير', 'Ouvrir / Modifier en Caisse')}</span>
              </button>

              {detailOrder &&
                onPayOrder &&
                detailOrder.paymentStatus !== 'PAID' &&
                hasRole(['ADMIN', 'MANAGER', 'CASHIER']) && (
                  <button
                    type="button"
                    onClick={() => {
                      const ord = detailOrder;
                      setDetailTable(null);
                      onPayOrder(ord);
                    }}
                    className="py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm rounded-xl flex items-center justify-center gap-2 cursor-pointer transition active:scale-95"
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>{t('تسديد الفاتورة الآن', 'Encaisser Maintenant')}</span>
                  </button>
                )}

              {hasRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']) && (
                <button
                  type="button"
                  onClick={() => setTransferFromTable(detailTable)}
                  className="py-2.5 px-4 bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#F7F3EA] font-bold text-sm rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                >
                  <MoveRight className="w-4 h-4 text-[#C6A15B]" />
                  <span>{t('نقل الطاولة', 'Transférer Table')}</span>
                </button>
              )}

              {hasRole(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER']) && (
                <button
                  type="button"
                  onClick={() => setMergeSourceTable(detailTable)}
                  className="py-2.5 px-4 bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#F7F3EA] font-bold text-sm rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                >
                  <GitMerge className="w-4 h-4 text-[#C6A15B]" />
                  <span>{t('دمج طاولة', 'Fusionner Table')}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Transfer Table Modal */}
      {transferFromTable && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-lg text-[#C6A15B] flex items-center gap-2">
                <MoveRight className="w-5 h-5" />
                <span>
                  {t(
                    `نقل الطلب من الطاولة ${transferFromTable.tableNumber}`,
                    `Transférer depuis Table ${transferFromTable.tableNumber}`
                  )}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setTransferFromTable(null)}
                className="p-2 rounded-xl bg-[#171717] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-sm font-bold text-[#A8A29E] mb-1.5">
                {t('اختر الطاولة الشاغرة البديلة:', 'Choisir la table disponible cible :')}
              </label>
              <select
                value={transferToTableId || ''}
                onChange={(e) => setTransferToTableId(Number(e.target.value))}
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-3 text-[#F7F3EA] text-base font-bold focus:outline-none focus:border-[#C6A15B]"
              >
                <option value="">{t('-- اختر طاولة متاحة --', '-- Sélectionner --')}</option>
                {tables
                  .filter((tb) => tb.id !== transferFromTable.id && tb.status === 'AVAILABLE')
                  .map((tb) => (
                    <option key={tb.id} value={tb.id}>
                      {t(`الطاولة ${tb.tableNumber} (${tb.zone}) - ${tb.capacity} مقاعد`, `Table ${tb.tableNumber} (${tb.zone}) - ${tb.capacity} pl.`)}
                    </option>
                  ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleExecuteTransfer}
              disabled={!transferToTableId}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-40 text-[#171717] font-black text-base rounded-xl active:scale-95 transition shadow-lg cursor-pointer"
            >
              {t('تأكيد نقل الطلب', 'Confirmer le transfert')}
            </button>
          </div>
        </div>
      )}

      {/* Merge Tables Modal */}
      {mergeSourceTable && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-lg text-[#C6A15B] flex items-center gap-2">
                <GitMerge className="w-5 h-5" />
                <span>{t(`دمج الطاولة ${mergeSourceTable.tableNumber}`, `Fusionner Table ${mergeSourceTable.tableNumber}`)}</span>
              </h3>
              <button
                type="button"
                onClick={() => setMergeSourceTable(null)}
                className="p-2 rounded-xl bg-[#171717] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#A8A29E] font-bold">
              {t(
                `سيتم دمج الطلب من الطاولة ${mergeSourceTable.tableNumber} مع الطاولة الهدف وتحرير طاولة المصدر.`,
                `La commande de la table ${mergeSourceTable.tableNumber} sera fusionnée avec la table cible.`
              )}
            </p>

            <div>
              <label className="block text-sm font-bold text-[#A8A29E] mb-1.5">
                {t('اختر الطاولة الهدف:', 'Table cible :')}
              </label>
              <select
                value={mergeTargetTableId || ''}
                onChange={(e) => setMergeTargetTableId(Number(e.target.value))}
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-3 text-[#F7F3EA] text-base font-bold focus:outline-none focus:border-[#C6A15B]"
              >
                <option value="">{t('-- اختر طاولة --', '-- Sélectionner --')}</option>
                {tables
                  .filter((tb) => tb.id !== mergeSourceTable.id && tb.status !== 'INACTIVE')
                  .map((tb) => (
                    <option key={tb.id} value={tb.id}>
                      {t(`الطاولة ${tb.tableNumber}`, `Table ${tb.tableNumber}`)} ({tb.zone})
                    </option>
                  ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleExecuteMerge}
              disabled={!mergeTargetTableId}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-40 text-[#171717] font-black text-base rounded-xl active:scale-95 transition shadow-lg cursor-pointer"
            >
              {t('تأكيد دمج الطاولات', 'Confirmer la fusion')}
            </button>
          </div>
        </div>
      )}

      {/* Table Status Options Modal */}
      {selectedTableForOptions && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-sm w-full p-5 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-lg text-[#C6A15B]">
                {t(`إدارة الطاولة ${selectedTableForOptions.tableNumber}`, `Statut Table ${selectedTableForOptions.tableNumber}`)}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedTableForOptions(null)}
                className="p-1.5 rounded-xl bg-[#171717] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleToggleTableStatus(selectedTableForOptions, 'AVAILABLE')}
                className="w-full p-3 rounded-xl bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 font-bold text-sm border border-emerald-700/50 flex items-center justify-between cursor-pointer"
              >
                <span>{t('متاحة / فارغة (AVAILABLE)', 'Libre (AVAILABLE)')}</span>
                <span className="w-3 h-3 rounded-full bg-emerald-400" />
              </button>
              <button
                type="button"
                onClick={() => handleToggleTableStatus(selectedTableForOptions, 'OCCUPIED')}
                className="w-full p-3 rounded-xl bg-[#C6A15B]/15 hover:bg-[#C6A15B]/25 text-[#C6A15B] font-bold text-sm border border-[#C6A15B]/40 flex items-center justify-between cursor-pointer"
              >
                <span>{t('مشغولة (OCCUPIED)', 'Occupée (OCCUPIED)')}</span>
                <span className="w-3 h-3 rounded-full bg-[#C6A15B]" />
              </button>
              <button
                type="button"
                onClick={() => handleToggleTableStatus(selectedTableForOptions, 'WAITING_PAYMENT')}
                className="w-full p-3 rounded-xl bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 font-bold text-sm border border-amber-700/50 flex items-center justify-between cursor-pointer"
              >
                <span>{t('بانتظار الدفع (WAITING_PAYMENT)', 'Attente Paiement')}</span>
                <span className="w-3 h-3 rounded-full bg-amber-400" />
              </button>
              <button
                type="button"
                onClick={() =>
                  handleToggleTableStatus(
                    selectedTableForOptions,
                    selectedTableForOptions.status === 'INACTIVE' ? 'AVAILABLE' : 'INACTIVE'
                  )
                }
                className="w-full p-3 rounded-xl bg-[#171717] hover:border-[#C6A15B] text-[#A8A29E] font-bold text-sm border border-[#33302B] flex items-center justify-between cursor-pointer"
              >
                <span>
                  {selectedTableForOptions.status === 'INACTIVE'
                    ? t('إعادة تفعيل الطاولة', 'Réactiver la table')
                    : t('تعطيل الطاولة مؤقتاً', 'Désactiver la table')}
                </span>
                <Ban className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Table Modal */}
      {showAddTableModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B]">
                {t('إضافة طاولة جديدة', 'Nouvelle Table')}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddTableModal(false)}
                className="p-2 rounded-xl bg-[#171717] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-bold text-[#A8A29E] mb-1">
                  {t('رقم الطاولة:', 'Numéro de table :')}
                </label>
                <input
                  type="text"
                  value={newTableNum}
                  onChange={(e) => setNewTableNum(e.target.value)}
                  placeholder="31"
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-3 text-[#F7F3EA] text-base font-black focus:outline-none focus:border-[#C6A15B]"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-[#A8A29E] mb-1">
                  {t('المنطقة:', 'Zone :')}
                </label>
                <select
                  value={newTableZone}
                  onChange={(e) => setNewTableZone(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-3 text-[#F7F3EA] font-bold text-sm focus:outline-none focus:border-[#C6A15B]"
                >
                  <option value="الصالة الرئيسية">{t('الصالة الرئيسية', 'Salle Principale')}</option>
                  <option value="الشرفة الخارجية">{t('الشرفة الخارجية', 'Terrasse')}</option>
                  <option value="صالون VIP والعائلات">{t('صالون VIP والعائلات', 'Salon VIP')}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-[#A8A29E] mb-1">
                  {t('عدد المقاعد:', 'Capacité :')}
                </label>
                <input
                  type="number"
                  min="1"
                  value={newTableCapacity}
                  onChange={(e) => setNewTableCapacity(parseInt(e.target.value) || 4)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-3 text-[#F7F3EA] text-base font-black focus:outline-none focus:border-[#C6A15B]"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddTable}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black text-base rounded-2xl active:scale-95 transition shadow-xl cursor-pointer"
            >
              {t('حفظ الطاولة', 'Enregistrer Table')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
