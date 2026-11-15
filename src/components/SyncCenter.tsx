import React, { useState } from 'react';
import { usePos } from '../context/PosContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { getDeviceId } from '../services/offlineStorage.ts';
import type { SyncConflictRecord } from '../services/offlineStorage.ts';
import {
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Trash2,
  ShieldAlert,
  Activity,
  ShoppingBag,
  ArrowRightLeft,
} from 'lucide-react';

type FilterState = 'ALL' | 'PENDING' | 'RETRY_WAIT' | 'FAILED' | 'SYNCED';

export const SyncCenter: React.FC = () => {
  const { hasRole } = useAuth();
  const { t } = useLanguage();
  const {
    isOnline,
    isNavigatorOnline,
    isServerReachable,
    lastSyncAt,
    lastHealthCheckAt,
    isSyncingOffline,
    syncQueueItems,
    syncConflicts,
    syncHistory,
    checkConnectionNow,
    triggerSync,
    retrySyncItem,
    resolveSyncConflict,
    discardFailedSyncItem,
  } = usePos();

  const [filter, setFilter] = useState<FilterState>('ALL');
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [selectedTableByConflict, setSelectedTableByConflict] = useState<Record<string, number>>({});
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isPrivileged = hasRole(['ADMIN', 'MANAGER']);
  const deviceId = getDeviceId();

  const showBanner = (type: 'success' | 'error', text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 5000);
  };

  const handleTestConnection = async () => {
    setIsTestingConn(true);
    try {
      const ok = await checkConnectionNow();
      showBanner(
        ok ? 'success' : 'error',
        ok
          ? t('الخادم متصل وجاهز للمزامنة', 'Serveur joignable et prêt pour la synchronisation')
          : t('تعذر الوصول إلى الخادم حالياً', 'Serveur actuellement injoignable')
      );
    } finally {
      setIsTestingConn(false);
    }
  };

  const handleSyncAll = async () => {
    const res = await triggerSync(true, true);
    if (res.count > 0) {
      showBanner(
        'success',
        t(`تمت مزامنة ${res.count} عملية بنجاح`, `${res.count} opération(s) synchronisée(s)`)
      );
    } else if (res.conflictsCount && res.conflictsCount > 0) {
      showBanner(
        'error',
        t('توجد تعارضات تتطلب المراجعة قبل إتمام المزامنة', 'Des conflits nécessitent une résolution')
      );
    } else if (res.error) {
      showBanner('error', res.error);
    }
  };

  const unifiedQueue = [
    ...syncQueueItems.orders.map((o) => ({
      entityType: 'ORDER' as const,
      id: o.offlineId,
      operationId: o.operationId || o.offlineId,
      sequenceOrder: o.sequenceOrder ?? 0,
      label: `BON-OFF-${o.offlineId.slice(-4)}`,
      detail: `${o.type} • ${o.items?.length || 0} ${t('أصناف', 'articles')}`,
      total: Number(o.total || 0),
      queueState: o.queueState || (o.syncStatus === 'SYNCING' ? 'PROCESSING' : o.syncStatus || 'PENDING'),
      retryCount: Number(o.retryCount || 0),
      maxRetries: Number(o.maxRetries || 5),
      nextRetryAt: Number(o.nextRetryAt || 0),
      lastError: o.lastError || null,
      conflictType: o.conflictType || null,
      createdAt: o.createdAt,
    })),
    ...syncQueueItems.payments.map((p) => ({
      entityType: 'PAYMENT' as const,
      id: p.offlinePaymentId,
      operationId: p.operationId || p.offlinePaymentId,
      sequenceOrder: p.sequenceOrder ?? 0,
      label: p.orderNumber || `#${p.orderId}`,
      detail: (p.payments || []).map((l) => `${l.method}:${l.amount}`).join(' + '),
      total: (p.payments || []).reduce((s, l) => s + Number(l.amount || 0), 0),
      queueState: p.queueState || (p.syncStatus === 'SYNCING' ? 'PROCESSING' : p.syncStatus || 'PENDING'),
      retryCount: Number(p.retryCount || 0),
      maxRetries: Number(p.maxRetries || 5),
      nextRetryAt: Number(p.nextRetryAt || 0),
      lastError: p.lastError || null,
      conflictType: null,
      createdAt: p.createdAt,
    })),
    ...syncQueueItems.cashMovements.map((m) => ({
      entityType: 'CASH_MOVEMENT' as const,
      id: m.offlineMovementId,
      operationId: m.operationId || m.offlineMovementId,
      sequenceOrder: m.sequenceOrder ?? 0,
      label: m.type === 'CASH_IN' ? t('إيداع نقدي', 'Entrée Caisse') : t('سحب نقدي', 'Sortie Caisse'),
      detail: m.reason,
      total: Number(m.amount || 0),
      queueState: m.queueState || (m.syncStatus === 'SYNCING' ? 'PROCESSING' : m.syncStatus || 'PENDING'),
      retryCount: Number(m.retryCount || 0),
      maxRetries: Number(m.maxRetries || 5),
      nextRetryAt: Number(m.nextRetryAt || 0),
      lastError: m.lastError || null,
      conflictType: null,
      createdAt: m.createdAt,
    })),
  ].sort((a, b) => {
    if (a.sequenceOrder !== b.sequenceOrder) return a.sequenceOrder - b.sequenceOrder;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const pendingCount = unifiedQueue.filter((i) => i.queueState === 'PENDING').length;
  const retryWaitCount = unifiedQueue.filter((i) => i.queueState === 'RETRY_WAIT').length;
  const processingCount = unifiedQueue.filter((i) => i.queueState === 'PROCESSING').length;
  const failedCount = unifiedQueue.filter((i) => i.queueState === 'FAILED').length;

  const filteredQueue = unifiedQueue.filter((item) => {
    if (filter === 'SYNCED') return false;
    if (filter === 'ALL') return true;
    return item.queueState === filter;
  });

  const showHistorySection = filter === 'ALL' || filter === 'SYNCED';

  const conflictTitle = (type: string) => {
    switch (type) {
      case 'PRICE_CHANGED':
        return t('تغيير في الأسعار', 'Changement de prix');
      case 'PRODUCT_UNAVAILABLE':
        return t('منتج غير متوفر', 'Produit indisponible');
      case 'TABLE_OCCUPIED':
        return t('الطاولة مشغولة حالياً', 'Table déjà occupée');
      case 'TAX_RATE_CHANGED':
        return t('تغير معدل الضريبة', 'Taux TVA modifié');
      case 'STOCK_INSUFFICIENT':
        return t('رصيد المخزون غير كافٍ', 'Stock insuffisant');
      default:
        return t('خطأ تحقق من البيانات', 'Erreur de validation');
    }
  };

  const stateBadge = (state: string) => {
    switch (state) {
      case 'PROCESSING':
        return (
          <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-sky-950/80 text-sky-300 border border-sky-600/50">
            {t('جاري الإرسال', 'En cours')}
          </span>
        );
      case 'RETRY_WAIT':
        return (
          <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-amber-950/80 text-amber-300 border border-amber-600/50">
            {t('انتظار إعادة المحاولة', 'Attente réessai')}
          </span>
        );
      case 'FAILED':
        return (
          <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-rose-950/80 text-rose-300 border border-rose-600/60">
            {t('فشل — يحتاج تدخل', 'Échec')}
          </span>
        );
      case 'SYNCED':
        return (
          <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-emerald-950/80 text-emerald-300 border border-emerald-600/50">
            {t('متزامن', 'Synchronisé')}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-[#C6A15B]/20 text-[#C6A15B] border border-[#C6A15B]/50">
            {t('قيد الانتظار', 'En attente')}
          </span>
        );
    }
  };

  const handleResolve = async (
    conflict: SyncConflictRecord,
    action: any,
    newTableId?: number
  ) => {
    setBusyId(conflict.offlineId);
    try {
      const res = await resolveSyncConflict(
        conflict.offlineId,
        { action, newTableId },
        conflict.serverConflictId
      );
      if (res.count > 0) {
        showBanner('success', t('تم حل التعارض ومزامنة الطلب', 'Conflit résolu et synchronisé'));
      } else if (res.error) {
        showBanner('error', res.error);
      }
    } catch (err: any) {
      showBanner('error', err?.message || t('فشل حل التعارض', 'Erreur de résolution'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      data-testid="sync-center-view"
      className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar bg-[#171717] p-3 sm:p-5 space-y-4 text-[#F7F3EA]"
    >
      {/* Connection Health Header */}
      <div className="bg-[#222222] border border-[#33302B] rounded-2xl p-4 shadow-lg flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div
            className={`p-3 rounded-2xl border shrink-0 ${
              isOnline
                ? 'bg-emerald-950/50 border-emerald-600/60 text-emerald-400'
                : 'bg-red-950/60 border-red-600/60 text-red-300'
            }`}
          >
            {isOnline ? <Wifi className="w-6 h-6" /> : <WifiOff className="w-6 h-6" />}
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-black text-[#C6A15B]">
              {t('مركز المزامنة والعمل دون إنترنت', 'Centre de Synchronisation & Hors-Ligne')}
            </h1>
            <div className="text-xs text-[#A8A29E] font-bold flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              <span className={isOnline ? 'text-emerald-400' : 'text-red-300'}>
                {isOnline
                  ? t('متصل بالخادم', 'Serveur connecté')
                  : isNavigatorOnline && !isServerReachable
                  ? t('الشبكة متاحة لكن الخادم لا يستجيب', 'Réseau actif mais serveur injoignable')
                  : t('وضع عدم الاتصال بالشبكة', 'Mode hors ligne')}
              </span>
              <span className="font-mono">
                {t('الجهاز:', 'Terminal :')} {deviceId}
              </span>
              {lastSyncAt && (
                <span className="font-mono">
                  {t('آخر مزامنة:', 'Dernière sync :')}{' '}
                  {new Date(lastSyncAt).toLocaleTimeString('fr-FR')}
                </span>
              )}
              {lastHealthCheckAt && (
                <span className="font-mono">
                  {t('آخر فحص:', 'Dernier test :')}{' '}
                  {new Date(lastHealthCheckAt).toLocaleTimeString('fr-FR')}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="sync-test-connection-btn"
            onClick={handleTestConnection}
            disabled={isTestingConn}
            className="px-3.5 py-2.5 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#F7F3EA] text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <Activity className={`w-4 h-4 text-[#C6A15B] ${isTestingConn ? 'animate-pulse' : ''}`} />
            <span>{t('فحص الاتصال', 'Tester connexion')}</span>
          </button>

          <button
            type="button"
            data-testid="sync-now-all-btn"
            onClick={handleSyncAll}
            disabled={isSyncingOffline || !isOnline}
            className="px-4 py-2.5 rounded-xl bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-40 text-[#171717] text-xs font-black flex items-center gap-1.5 cursor-pointer shadow"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncingOffline ? 'animate-spin' : ''}`} />
            <span>{t('مزامنة الكل الآن', 'Tout synchroniser')}</span>
          </button>
        </div>
      </div>

      {banner && (
        <div
          className={`p-3 rounded-2xl text-xs sm:text-sm font-black flex items-center gap-2 border ${
            banner.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-600/60 text-emerald-300'
              : 'bg-red-950/70 border-red-600/60 text-red-200'
          }`}
        >
          {banner.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{banner.text}</span>
        </div>
      )}

      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <div className="bg-[#222222] border border-[#33302B] rounded-2xl p-3 text-center">
          <div className="text-[11px] font-bold text-[#A8A29E]">{t('في الانتظار', 'En attente')}</div>
          <div className="text-2xl font-black text-[#C6A15B] font-mono tabular-nums mt-0.5">
            {pendingCount + retryWaitCount}
          </div>
        </div>
        <div className="bg-[#222222] border border-[#33302B] rounded-2xl p-3 text-center">
          <div className="text-[11px] font-bold text-[#A8A29E]">{t('قيد التنفيذ', 'En cours')}</div>
          <div className="text-2xl font-black text-sky-400 font-mono tabular-nums mt-0.5">
            {processingCount}
          </div>
        </div>
        <div className="bg-[#222222] border border-rose-800/50 rounded-2xl p-3 text-center">
          <div className="text-[11px] font-bold text-rose-300">{t('عمليات فاشلة', 'Échouées')}</div>
          <div className="text-2xl font-black text-rose-400 font-mono tabular-nums mt-0.5">
            {failedCount}
          </div>
        </div>
        <div className="bg-[#222222] border border-amber-700/50 rounded-2xl p-3 text-center">
          <div className="text-[11px] font-bold text-amber-300">{t('تعارضات مفتوحة', 'Conflits')}</div>
          <div className="text-2xl font-black text-amber-400 font-mono tabular-nums mt-0.5">
            {syncConflicts.length}
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1 bg-[#222222] border border-emerald-700/40 rounded-2xl p-3 text-center">
          <div className="text-[11px] font-bold text-emerald-300">{t('تمت مزامنتها', 'Synchronisées')}</div>
          <div className="text-2xl font-black text-emerald-400 font-mono tabular-nums mt-0.5">
            {syncHistory.length}
          </div>
        </div>
      </div>

      {/* Conflict Resolution Panel */}
      {syncConflicts.length > 0 && (
        <div
          data-testid="sync-conflicts-panel"
          className="bg-[#222222] border border-rose-600/60 rounded-2xl p-4 space-y-3 shadow-lg"
        >
          <div className="flex items-center gap-2 text-rose-300 font-black text-base">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <span>
              {t(
                `تعارضات المزامنة التي تتطلب حلاً (${syncConflicts.length})`,
                `Conflits de synchronisation à résoudre (${syncConflicts.length})`
              )}
            </span>
          </div>

          <div className="space-y-3">
            {syncConflicts.map((conf) => {
              const snapshot = conf.serverSnapshot || {};
              const availableTables: any[] = Array.isArray(snapshot.availableTables)
                ? snapshot.availableTables
                : [];
              const chosenTableId =
                selectedTableByConflict[conf.conflictId] ?? availableTables[0]?.id ?? '';
              const isBusy = busyId === conf.offlineId;

              return (
                <div
                  key={conf.conflictId}
                  data-testid={`conflict-card-${conf.offlineId}`}
                  className="bg-[#171717] border border-[#33302B] rounded-2xl p-3.5 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-lg bg-rose-950/90 border border-rose-600/60 text-rose-300 text-xs font-black">
                          {conflictTitle(conf.conflictType)}
                        </span>
                        <span className="font-mono font-black text-sm text-[#C6A15B]">
                          BON-OFF-{conf.offlineId.slice(-4)}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-[#F7F3EA] mt-1">{conf.message}</p>
                      <div className="text-[11px] font-mono text-[#A8A29E] mt-0.5">
                        UUID: {conf.operationId}
                      </div>
                    </div>

                    {conf.orderSummary?.total !== undefined && (
                      <div className="font-mono font-black text-base text-[#C6A15B] tabular-nums">
                        {Number(conf.orderSummary.total).toLocaleString()} DA
                      </div>
                    )}
                  </div>

                  {/* Server vs Client Diff Snapshot */}
                  {(Array.isArray(snapshot.priceDiffs) && snapshot.priceDiffs.length > 0) ||
                  (snapshot.clientPrice !== undefined && snapshot.serverPrice !== undefined) ? (
                    <div className="bg-[#222222] border border-[#33302B] rounded-xl p-2.5 text-xs space-y-1">
                      {(Array.isArray(snapshot.priceDiffs)
                        ? snapshot.priceDiffs
                        : [snapshot]
                      ).map((d: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between gap-2">
                          <span className="font-bold">{d.nameAr || `#${d.productId}`}</span>
                          <span className="font-mono">
                            <span className="text-[#A8A29E]">
                              {t('محلي:', 'Local :')} {d.clientPrice} DA
                            </span>
                            {' → '}
                            <span className="text-emerald-400 font-black">
                              {t('الخادم:', 'Serveur :')} {d.serverPrice} DA
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {((Array.isArray(snapshot.unavailableProducts) && snapshot.unavailableProducts.length > 0) ||
                    (conf.conflictType === 'PRODUCT_UNAVAILABLE' && snapshot.nameAr)) && (
                    <div className="bg-[#222222] border border-[#33302B] rounded-xl p-2.5 text-xs text-rose-300 font-bold">
                      {t('أصناف غير متوفرة:', 'Articles indisponibles :')}{' '}
                      {(Array.isArray(snapshot.unavailableProducts)
                        ? snapshot.unavailableProducts
                        : [snapshot]
                      )
                        .map((p: any) => p.nameAr || `#${p.productId}`)
                        .join('، ')}
                    </div>
                  )}

                  {conf.conflictType === 'TAX_RATE_CHANGED' && (
                    <div className="bg-[#222222] border border-[#33302B] rounded-xl p-2.5 text-xs font-mono">
                      {t('الضريبة المحلية:', 'TVA locale :')} {snapshot.clientTaxRate}% →{' '}
                      <span className="text-emerald-400 font-black">
                        {t('ضريبة الخادم:', 'TVA serveur :')} {snapshot.serverTaxRate}%
                      </span>
                    </div>
                  )}

                  {((Array.isArray(snapshot.stockIssues) && snapshot.stockIssues.length > 0) ||
                    (Array.isArray(snapshot.shortages) && snapshot.shortages.length > 0)) && (
                    <div className="bg-[#222222] border border-[#33302B] rounded-xl p-2.5 text-xs space-y-1">
                      {(snapshot.shortages || snapshot.stockIssues).map((s: any, idx: number) => (
                        <div key={idx} className="flex justify-between">
                          <span className="font-bold">{s.nameAr || s.ingredientName}</span>
                          <span className="font-mono text-amber-300">
                            {t('مطلوب:', 'Requis :')} {s.required} | {t('متوفر:', 'Dispo :')} {s.available}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Conflict Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {(conf.conflictType === 'PRICE_CHANGED' ||
                      conf.conflictType === 'PRODUCT_UNAVAILABLE') && (
                      <button
                        type="button"
                        data-testid={`resolve-accept-server-${conf.offlineId}`}
                        disabled={isBusy}
                        onClick={() => handleResolve(conf, 'ACCEPT_SERVER_CATALOG')}
                        className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black cursor-pointer"
                      >
                        {conf.conflictType === 'PRODUCT_UNAVAILABLE'
                          ? t('إزالة الأصناف غير المتوفرة والمزامنة', 'Retirer indisponibles & sync')
                          : t('اعتماد أسعار الخادم والمزامنة', 'Accepter prix serveur')}
                      </button>
                    )}

                    {conf.conflictType === 'PRICE_CHANGED' && isPrivileged && (
                      <button
                        type="button"
                        data-testid={`resolve-override-price-${conf.offlineId}`}
                        disabled={isBusy}
                        onClick={() => handleResolve(conf, 'OVERRIDE_PRICE')}
                        className="px-3 py-2 rounded-xl bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] text-xs font-black cursor-pointer"
                      >
                        {t('اعتماد السعر المحلي (صلاحية مدير)', 'Forcer prix local (Manager)')}
                      </button>
                    )}

                    {conf.conflictType === 'TABLE_OCCUPIED' && (
                      <>
                        <button
                          type="button"
                          data-testid={`resolve-takeaway-${conf.offlineId}`}
                          disabled={isBusy}
                          onClick={() => handleResolve(conf, 'CONVERT_TO_TAKEAWAY')}
                          className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1 cursor-pointer"
                        >
                          <ShoppingBag className="w-3.5 h-3.5" />
                          <span>{t('تحويل إلى محمول', 'Convertir à emporter')}</span>
                        </button>

                        {availableTables.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={chosenTableId}
                              onChange={(e) =>
                                setSelectedTableByConflict((prev) => ({
                                  ...prev,
                                  [conf.conflictId]: Number(e.target.value),
                                }))
                              }
                              className="bg-[#222222] border border-[#33302B] rounded-xl px-2.5 py-1.5 text-xs font-bold text-[#F7F3EA]"
                            >
                              {availableTables.map((tb: any) => (
                                <option key={tb.id} value={tb.id}>
                                  {t(`طاولة ${tb.tableNumber}`, `Table ${tb.tableNumber}`)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              data-testid={`resolve-reassign-table-${conf.offlineId}`}
                              disabled={isBusy || !chosenTableId}
                              onClick={() =>
                                handleResolve(conf, 'REASSIGN_TABLE', Number(chosenTableId))
                              }
                              className="px-3 py-2 rounded-xl bg-[#C6A15B] text-[#171717] text-xs font-black flex items-center gap-1 cursor-pointer"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                              <span>{t('نقل للطاولة', 'Réaffecter')}</span>
                            </button>
                          </div>
                        )}

                        {isPrivileged && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleResolve(conf, 'FORCE_ATTACH_ORDER')}
                            className="px-3 py-2 rounded-xl bg-amber-950/80 border border-[#C6A15B]/60 text-[#C6A15B] text-xs font-black cursor-pointer"
                          >
                            {t('دمج مع الطاولة (مدير)', 'Forcer table (Manager)')}
                          </button>
                        )}
                      </>
                    )}

                    {conf.conflictType === 'TAX_RATE_CHANGED' && (
                      <button
                        type="button"
                        data-testid={`resolve-accept-tax-${conf.offlineId}`}
                        disabled={isBusy}
                        onClick={() => handleResolve(conf, 'ACCEPT_SERVER_TAX')}
                        className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black cursor-pointer"
                      >
                        {t('تطبيق ضريبة الخادم والمزامنة', 'Appliquer TVA serveur')}
                      </button>
                    )}

                    {conf.conflictType === 'STOCK_INSUFFICIENT' && isPrivileged && (
                      <button
                        type="button"
                        data-testid={`resolve-force-stock-${conf.offlineId}`}
                        disabled={isBusy}
                        onClick={() => handleResolve(conf, 'FORCE_STOCK')}
                        className="px-3 py-2 rounded-xl bg-[#C6A15B] text-[#171717] text-xs font-black cursor-pointer"
                      >
                        {t('تجاوز تنبيه المخزون (صلاحية مدير)', 'Forcer stock (Manager)')}
                      </button>
                    )}

                    {!isPrivileged && (
                      <span className="text-[11px] text-[#A8A29E] font-bold">
                        {t(
                          'تجاوز السعر/المخزون أو الحذف يتطلب صلاحية مدير',
                          'Forçage prix/stock ou suppression réservé au Gérant'
                        )}
                      </span>
                    )}

                    {isPrivileged && (
                      confirmDiscardId === conf.offlineId ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`confirm-discard-conflict-${conf.offlineId}`}
                            onClick={async () => {
                              await discardFailedSyncItem(
                                'ORDER',
                                conf.offlineId,
                                conf.serverConflictId
                              );
                              setConfirmDiscardId(null);
                            }}
                            className="px-3 py-2 rounded-xl bg-rose-600 text-white text-xs font-black cursor-pointer"
                          >
                            {t('تأكيد الحذف النهائي', 'Confirmer suppression')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDiscardId(null)}
                            className="px-2.5 py-2 rounded-xl bg-[#222222] text-[#A8A29E] text-xs font-bold cursor-pointer"
                          >
                            {t('إلغاء', 'Annuler')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-testid={`discard-conflict-${conf.offlineId}`}
                          onClick={() => setConfirmDiscardId(conf.offlineId)}
                          className="px-3 py-2 rounded-xl bg-rose-950/70 hover:bg-rose-900 border border-rose-700/60 text-rose-200 text-xs font-black flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t('تجاهل وحذف (مدير)', 'Ignorer & supprimer')}</span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 bg-[#222222] p-2 rounded-2xl border border-[#33302B]">
        {(
          [
            { id: 'ALL', ar: 'الكل', fr: 'Tout' },
            { id: 'PENDING', ar: 'قيد الانتظار', fr: 'En attente' },
            { id: 'RETRY_WAIT', ar: 'إعادة المحاولة', fr: 'En réessai' },
            { id: 'FAILED', ar: 'فاشلة', fr: 'Échouées' },
            { id: 'SYNCED', ar: 'سجل المتزامن', fr: 'Synchronisées' },
          ] as { id: FilterState; ar: string; fr: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`sync-filter-${tab.id}`}
            onClick={() => setFilter(tab.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
              filter === tab.id
                ? 'bg-[#C6A15B] text-[#171717]'
                : 'bg-[#171717] text-[#A8A29E] hover:text-[#F7F3EA] border border-[#33302B]'
            }`}
          >
            {t(tab.ar, tab.fr)}
          </button>
        ))}
      </div>

      {/* Active Queue List */}
      {filter !== 'SYNCED' && (
        <div data-testid="sync-queue-list" className="space-y-2.5">
          {filteredQueue.length === 0 ? (
            <div className="bg-[#222222] border border-[#33302B] rounded-2xl p-8 text-center text-[#A8A29E] font-bold text-sm">
              {t('لا توجد عمليات معلقة في هذا التصنيف', 'Aucune opération dans cette catégorie')}
            </div>
          ) : (
            filteredQueue.map((item) => {
              const secondsLeft =
                item.nextRetryAt > Date.now()
                  ? Math.ceil((item.nextRetryAt - Date.now()) / 1000)
                  : 0;
              return (
                <div
                  key={item.id}
                  data-testid={`sync-queue-item-${item.id}`}
                  className="bg-[#222222] border border-[#33302B] rounded-2xl p-3.5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#171717] border border-[#33302B] text-[#C6A15B] font-mono text-[11px] font-black">
                        #{item.sequenceOrder} • {item.entityType}
                      </span>
                      <span className="font-black text-sm text-[#F7F3EA]">{item.label}</span>
                      {stateBadge(item.queueState)}
                    </div>
                    <div className="text-xs text-[#A8A29E] font-bold">
                      {item.detail} •{' '}
                      <span className="text-[#C6A15B] font-mono font-black">
                        {item.total.toLocaleString()} DA
                      </span>
                    </div>
                    <div className="text-[11px] text-[#A8A29E] font-mono flex flex-wrap items-center gap-3">
                      <span>UUID: {item.operationId}</span>
                      <span>
                        {t('المحاولات:', 'Essais :')} {item.retryCount}/{item.maxRetries}
                      </span>
                      {secondsLeft > 0 && item.queueState === 'RETRY_WAIT' && (
                        <span className="text-amber-300 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {t(`إعادة بعد ${secondsLeft}ث`, `Réessai dans ${secondsLeft}s`)}
                        </span>
                      )}
                    </div>
                    {item.lastError && (
                      <div className="text-xs text-rose-300 bg-rose-950/50 border border-rose-700/40 rounded-lg px-2.5 py-1 mt-1">
                        {item.lastError}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      data-testid={`retry-sync-item-${item.id}`}
                      onClick={() => retrySyncItem(item.entityType, item.id)}
                      disabled={isSyncingOffline}
                      className="px-3 py-2 rounded-xl bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-40 text-[#171717] font-black text-xs flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{t('إعادة المحاولة', 'Réessayer')}</span>
                    </button>

                    {isPrivileged &&
                      (confirmDiscardId === item.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            data-testid={`confirm-discard-item-${item.id}`}
                            onClick={async () => {
                              await discardFailedSyncItem(item.entityType, item.id);
                              setConfirmDiscardId(null);
                            }}
                            className="px-2.5 py-2 rounded-xl bg-rose-600 text-white font-black text-xs cursor-pointer"
                          >
                            {t('تأكيد', 'Confirmer')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDiscardId(null)}
                            className="px-2 py-2 rounded-xl bg-[#171717] text-[#A8A29E] text-xs font-bold cursor-pointer"
                          >
                            {t('إلغاء', 'Annuler')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-testid={`discard-item-${item.id}`}
                          onClick={() => setConfirmDiscardId(item.id)}
                          className="p-2 rounded-xl bg-rose-950/70 hover:bg-rose-900 border border-rose-700/50 text-rose-300 cursor-pointer"
                          title={t('حذف العملية (مدير)', 'Supprimer (Manager)')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Synced History Audit List */}
      {showHistorySection && syncHistory.length > 0 && (
        <div className="bg-[#222222] border border-[#33302B] rounded-2xl p-4 space-y-2.5">
          <h3 className="text-sm font-black text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{t('العمليات المتزامنة حديثاً (SYNCED)', 'Historique récent (SYNCED)')}</span>
          </h3>
          <div className="space-y-1.5 max-h-64 overflow-y-auto no-scrollbar">
            {syncHistory.map((h) => (
              <div
                key={h.operationId}
                className="flex flex-wrap items-center justify-between gap-2 bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  {stateBadge('SYNCED')}
                  <span className="font-mono font-black text-[#C6A15B]">
                    {h.serverOrderNumber || h.localRef}
                  </span>
                  <span className="text-[#A8A29E] font-mono text-[11px]">{h.operationId}</span>
                  {h.deduplicated && (
                    <span className="px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 text-[10px] font-bold">
                      {t('منع تكرار', 'Dédupliqué')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 font-mono">
                  {h.total !== undefined && (
                    <span className="font-black text-[#F7F3EA]">{Number(h.total).toLocaleString()} DA</span>
                  )}
                  <span className="text-[#A8A29E]">
                    {new Date(h.syncedAt).toLocaleTimeString('fr-FR')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
