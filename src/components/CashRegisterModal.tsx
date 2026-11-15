import React, { useState, useEffect } from 'react';
import { usePos } from '../context/PosContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api, generateUuid } from '../services/api.ts';
import {
  Coins,
  X,
  Lock,
  ArrowDownRight,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

interface CashRegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CashRegisterModal: React.FC<CashRegisterModalProps> = ({ isOpen, onClose }) => {
  const {
    currentShift,
    isShiftOpen,
    offlineOrdersCount,
    conflictsCount,
    isSyncingOffline,
    triggerSync,
    refreshShift,
    refreshDashboard,
    refreshOfflineCount,
    openCashDrawer,
  } = usePos();
  const { user, hasRole } = useAuth();
  const { t } = useLanguage();

  const [activeTab, setActiveTab] = useState<'CURRENT' | 'MOVEMENT' | 'HISTORY'>('CURRENT');
  const [openingCashInput, setOpeningCashInput] = useState<string>('5000');
  const [closingCashInput, setClosingCashInput] = useState<string>('');
  const [closeNotesInput, setCloseNotesInput] = useState<string>('');
  const [movementType, setMovementType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN');
  const [movementAmount, setMovementAmount] = useState<string>('');
  const [movementReason, setMovementReason] = useState<string>('');
  const [shiftHistory, setShiftHistory] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const movementIdempRef = React.useRef<string | null>(null);

  const canOperateRegister = hasRole(['ADMIN', 'MANAGER', 'CASHIER']);
  const hasUnsyncedBlockers = offlineOrdersCount > 0 || conflictsCount > 0;

  const notify = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 5000);
  };

  useEffect(() => {
    if (isOpen) {
      setFeedback(null);
      refreshShift();
      refreshOfflineCount();
      if (activeTab === 'HISTORY') loadHistory();
    } else {
      movementIdempRef.current = null;
    }
  }, [isOpen, activeTab, refreshShift, refreshOfflineCount]);

  const loadHistory = async () => {
    try {
      const data = await api.getShiftHistory();
      setShiftHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load shift history:', err);
    }
  };

  const handleOpenShift = async () => {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      await api.openShift(parseFloat(openingCashInput) || 0);
      await refreshShift();
      await refreshDashboard();
      openCashDrawer();
      notify('success', t('تم فتح الوردية بنجاح', 'Shift ouvert avec succès'));
    } catch (err: any) {
      notify('error', err.message || t('فشل فتح الصندوق', 'Échec d’ouverture'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseShift = async () => {
    if (!currentShift) return;
    if (hasUnsyncedBlockers) {
      notify(
        'error',
        t(
          'يرجى مزامنة كافة الطلبات والمدفوعات المعلقة وحل التعارضات قبل إغلاق الوردية',
          'Veuillez synchroniser les opérations hors ligne et résoudre les conflits avant de clôturer'
        )
      );
      return;
    }
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const res = await api.closeShift(
        currentShift.id,
        parseFloat(closingCashInput) || 0,
        closeNotesInput
      );
      await refreshShift();
      await refreshDashboard();
      openCashDrawer();
      setClosingCashInput('');
      setCloseNotesInput('');
      notify(
        'success',
        t(
          `تم إغلاق الوردية (الفارق: ${Number(res.cashDifference ?? res.difference ?? 0).toLocaleString()} DA)`,
          `Caisse clôturée (Écart: ${Number(res.cashDifference ?? res.difference ?? 0).toLocaleString()} DA)`
        )
      );
    } catch (err: any) {
      notify('error', err.message || t('فشل إغلاق الصندوق', 'Échec de clôture'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecordMovement = async () => {
    if (!currentShift || !movementAmount || !movementReason) return;
    setIsSubmitting(true);
    setFeedback(null);
    try {
      if (!movementIdempRef.current) {
        movementIdempRef.current = `mov-${generateUuid()}`;
      }
      const res = await api.recordCashMovement({
        shiftId: currentShift.id,
        type: movementType,
        amount: parseFloat(movementAmount) || 0,
        reason: movementReason,
        idempotencyKey: movementIdempRef.current,
      });
      movementIdempRef.current = null;
      setMovementAmount('');
      setMovementReason('');
      await refreshOfflineCount();
      if (!res?.offline) {
        await refreshShift();
        await refreshDashboard();
      }
      openCashDrawer();
      notify(
        'success',
        res?.offline
          ? t('تم حفظ حركة الصندوق محلياً (أوفلاين) للمزامنة', 'Mouvement enregistré hors ligne pour sync')
          : t('تم تسجيل حركة الصندوق بنجاح', 'Mouvement enregistré avec succès')
      );
      setActiveTab('CURRENT');
    } catch (err: any) {
      notify('error', err.message || t('فشل تسجيل حركة الصندوق', 'Erreur mouvement caisse'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const expectedCash = Number(currentShift?.expectedCash || 0);
  const actualCountedNum = closingCashInput === '' ? null : parseFloat(closingCashInput);
  const liveVariance = actualCountedNum !== null && !Number.isNaN(actualCountedNum)
    ? actualCountedNum - expectedCash
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4 select-none overflow-y-auto">
      <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-2xl w-full p-4 sm:p-6 shadow-2xl space-y-4 text-[#F7F3EA] max-h-[95vh] overflow-y-auto no-scrollbar my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-[#171717] border border-[#C6A15B]/40 text-[#C6A15B] shrink-0">
              <Coins className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-2xl font-black text-[#C6A15B]">
                {t('إدارة الصندوق والورديات', 'Gestion de Caisse & Shifts')}
              </h2>
              <p className="text-xs font-bold text-[#A8A29E] mt-0.5">
                {t('الموظف:', 'Opérateur :')}{' '}
                <span className="text-[#F7F3EA] font-black">{user?.fullName}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] hover:text-[#F7F3EA] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-2xl text-xs sm:text-sm font-black flex items-center gap-2 border ${
              feedback.type === 'success'
                ? 'bg-emerald-950/70 border-emerald-600/60 text-emerald-300'
                : 'bg-red-950/70 border-red-600/60 text-red-200'
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

        {/* Tab switchers */}
        <div className="flex items-center gap-1.5 bg-[#171717] p-1.5 rounded-2xl border border-[#33302B] text-xs sm:text-sm overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('CURRENT')}
            className={`flex-1 py-2 px-3 rounded-xl font-black transition cursor-pointer whitespace-nowrap ${
              activeTab === 'CURRENT'
                ? 'bg-[#C6A15B] text-[#171717] shadow'
                : 'text-[#A8A29E] hover:text-[#F7F3EA]'
            }`}
          >
            {t('الوردية الحالية', 'Shift Actuel')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('MOVEMENT')}
            disabled={!isShiftOpen || !canOperateRegister}
            className={`flex-1 py-2 px-3 rounded-xl font-black transition disabled:opacity-30 cursor-pointer whitespace-nowrap ${
              activeTab === 'MOVEMENT'
                ? 'bg-[#C6A15B] text-[#171717] shadow'
                : 'text-[#A8A29E] hover:text-[#F7F3EA]'
            }`}
          >
            {t('إيداع / سحب نقدي', 'Mouvements Espèces')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('HISTORY')}
            className={`flex-1 py-2 px-3 rounded-xl font-black transition cursor-pointer whitespace-nowrap ${
              activeTab === 'HISTORY'
                ? 'bg-[#C6A15B] text-[#171717] shadow'
                : 'text-[#A8A29E] hover:text-[#F7F3EA]'
            }`}
          >
            {t('سجل الورديات', 'Historique')}
          </button>
        </div>

        {/* TAB 1: CURRENT SHIFT */}
        {activeTab === 'CURRENT' && (
          <div className="space-y-4">
            {isShiftOpen && currentShift ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                  <div className="p-3 rounded-2xl bg-[#171717] border border-[#33302B]">
                    <span className="text-[11px] text-[#A8A29E] font-bold block">
                      {t('الرصيد الافتتاحي', 'Fond initial')}
                    </span>
                    <span className="text-base font-black text-[#F7F3EA] mt-1 block font-mono tabular-nums">
                      {Number(currentShift.openingCash).toLocaleString()} DA
                    </span>
                  </div>

                  <div className="p-3 rounded-2xl bg-emerald-950/30 border border-emerald-700/50">
                    <span className="text-[11px] text-emerald-300 font-bold block">
                      {t('مبيعات نقدية', 'Ventes Espèces')}
                    </span>
                    <span className="text-base font-black text-emerald-400 mt-1 block font-mono tabular-nums">
                      +{Number(currentShift.totalCashSales).toLocaleString()} DA
                    </span>
                  </div>

                  <div className="p-3 rounded-2xl bg-[#171717] border border-[#C6A15B]/40">
                    <span className="text-[11px] text-[#C6A15B] font-bold block">
                      {t('بطاقة / تحويل / CCP', 'Carte / Virement')}
                    </span>
                    <span className="text-base font-black text-[#C6A15B] mt-1 block font-mono tabular-nums">
                      {(
                        Number(currentShift.totalCardSales || 0) +
                        Number(currentShift.totalBaridimobSales || 0) +
                        Number(currentShift.totalCcpSales || 0)
                      ).toLocaleString()}{' '}
                      DA
                    </span>
                  </div>

                  <div className="p-3 rounded-2xl bg-rose-950/30 border border-rose-700/50">
                    <span className="text-[11px] text-rose-300 font-bold block">
                      {t('مصاريف / استرجاع', 'Sorties / Remb.')}
                    </span>
                    <span className="text-base font-black text-rose-400 mt-1 block font-mono tabular-nums">
                      -{(Number(currentShift.totalExpenses || 0) + Number(currentShift.totalCashOut || 0)).toLocaleString()} DA
                    </span>
                  </div>
                </div>

                {/* Expected Cash */}
                <div className="p-4 bg-[#171717] border border-[#C6A15B]/50 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-xs text-[#A8A29E] block font-bold">
                      {t('النقد المتوقع في الدرج:', 'Espèces attendues en tiroir :')}
                    </span>
                    <span className="text-2xl sm:text-3xl font-black text-[#C6A15B] font-mono tabular-nums mt-0.5 block">
                      {expectedCash.toLocaleString()} DA
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={openCashDrawer}
                    className="px-4 py-2.5 bg-[#222222] hover:border-[#C6A15B] text-[#C6A15B] font-black text-xs rounded-xl border border-[#33302B] cursor-pointer"
                  >
                    {t('فتح الدرج', 'Ouvrir Tiroir')}
                  </button>
                </div>

                {/* Close Shift */}
                {canOperateRegister && (
                  <div className="p-4 bg-[#171717] border border-[#33302B] rounded-2xl space-y-3">
                    <h4 className="text-sm font-black text-rose-400 flex items-center gap-2">
                      <Lock className="w-4 h-4" />
                      <span>{t('إغلاق الوردية (Rapport Z)', 'Clôturer la Caisse (Rapport Z)')}</span>
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <label className="block text-xs text-[#A8A29E] font-bold mb-1">
                          {t('المبلغ الفعلي في الدرج (DA):', 'Espèces comptées (DA) :')}
                        </label>
                        <input
                          type="number"
                          value={closingCashInput}
                          onChange={(e) => setClosingCashInput(e.target.value)}
                          placeholder={String(expectedCash)}
                          className="w-full bg-[#222222] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black text-lg font-mono focus:outline-none focus:border-[#C6A15B]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#A8A29E] font-bold mb-1">
                          {t('ملاحظات الإغلاق:', 'Notes de clôture :')}
                        </label>
                        <input
                          type="text"
                          value={closeNotesInput}
                          onChange={(e) => setCloseNotesInput(e.target.value)}
                          className="w-full bg-[#222222] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-bold text-sm focus:outline-none focus:border-[#C6A15B]"
                        />
                      </div>
                    </div>

                    {liveVariance !== null && (
                      <div
                        className={`text-xs font-black px-3 py-2 rounded-xl border ${
                          liveVariance === 0
                            ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300'
                            : 'bg-amber-950/40 border-[#C6A15B]/50 text-[#C6A15B]'
                        }`}
                      >
                        {t('فارق الجرد المتوقع:', 'Écart calculé :')}{' '}
                        <span className="font-mono tabular-nums">
                          {liveVariance > 0 ? `+${liveVariance.toLocaleString()}` : liveVariance.toLocaleString()} DA
                        </span>
                      </div>
                    )}

                    {hasUnsyncedBlockers && (
                      <div
                        data-testid="shift-close-sync-warning"
                        className="p-3 rounded-xl bg-amber-950/70 border border-[#C6A15B] text-amber-200 text-xs font-black flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-[#C6A15B] shrink-0" />
                          <span>
                            {t(
                              `يرجى مزامنة ${offlineOrdersCount} عملية معلقة وحل ${conflictsCount} تعارضات قبل إغلاق الوردية`,
                              `Synchronisez ${offlineOrdersCount} opération(s) et résolvez ${conflictsCount} conflit(s) avant clôture`
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => triggerSync(true)}
                          disabled={isSyncingOffline}
                          className="px-3 py-1.5 rounded-lg bg-[#C6A15B] text-[#171717] font-black text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isSyncingOffline ? 'animate-spin' : ''}`} />
                          <span>{t('مزامنة الآن', 'Synchroniser')}</span>
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      data-testid="confirm-close-shift-btn"
                      onClick={handleCloseShift}
                      disabled={closingCashInput === '' || isSubmitting || hasUnsyncedBlockers}
                      className="w-full py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-black text-sm rounded-xl transition cursor-pointer"
                    >
                      {t('تأكيد إغلاق الوردية', 'Confirmer la Clôture')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Open Shift Form */
              <div className="p-6 bg-[#171717] rounded-2xl border border-[#33302B] text-center space-y-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-[#C6A15B]/15 border border-[#C6A15B]/40 flex items-center justify-center text-[#C6A15B]">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-[#F7F3EA]">
                    {t('الصندوق مغلق حالياً', 'La caisse est fermée')}
                  </h3>
                  <p className="text-xs font-bold text-[#A8A29E] mt-1">
                    {t(
                      'أدخل الرصيد الافتتاحي لفتح الوردية وبدء استقبال المدفوعات',
                      'Saisissez le fond de caisse pour démarrer le shift'
                    )}
                  </p>
                </div>

                {canOperateRegister ? (
                  <>
                    <div className="max-w-xs mx-auto text-start">
                      <label className="block text-xs font-bold text-[#A8A29E] mb-1">
                        {t('الرصيد الافتتاحي (DA):', 'Fond de caisse (DA) :')}
                      </label>
                      <input
                        type="number"
                        value={openingCashInput}
                        onChange={(e) => setOpeningCashInput(e.target.value)}
                        className="w-full bg-[#222222] border border-[#C6A15B]/50 rounded-2xl p-3 text-center text-2xl font-black text-[#C6A15B] font-mono focus:outline-none focus:border-[#C6A15B]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenShift}
                      disabled={isSubmitting}
                      className="w-full max-w-xs mx-auto py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black text-base rounded-2xl shadow-xl transition block cursor-pointer"
                    >
                      {t('فتح الوردية الآن', 'Ouvrir la Caisse')}
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-amber-400 font-bold">
                    {t('يتطلب صلاحية كاشير أو مدير لفتح الصندوق', 'Autorisation Caissier ou Gérant requise')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: CASH MOVEMENTS */}
        {activeTab === 'MOVEMENT' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMovementType('CASH_IN')}
                className={`p-3 rounded-2xl border flex items-center justify-center gap-2 font-black text-sm cursor-pointer ${
                  movementType === 'CASH_IN'
                    ? 'bg-emerald-600 text-white border-emerald-500'
                    : 'bg-[#171717] text-[#A8A29E] border-[#33302B]'
                }`}
              >
                <ArrowDownRight className="w-5 h-5" />
                <span>{t('إيداع نقدي', 'Entrée d’argent')}</span>
              </button>

              <button
                type="button"
                onClick={() => setMovementType('CASH_OUT')}
                className={`p-3 rounded-2xl border flex items-center justify-center gap-2 font-black text-sm cursor-pointer ${
                  movementType === 'CASH_OUT'
                    ? 'bg-rose-600 text-white border-rose-500'
                    : 'bg-[#171717] text-[#A8A29E] border-[#33302B]'
                }`}
              >
                <ArrowUpRight className="w-5 h-5" />
                <span>{t('سحب نقدي', 'Sortie d’argent')}</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#A8A29E] mb-1">{t('المبلغ (DA):', 'Montant (DA) :')}</label>
              <input
                type="number"
                value={movementAmount}
                onChange={(e) => setMovementAmount(e.target.value)}
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-3 text-[#F7F3EA] font-black text-xl font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#A8A29E] mb-1">{t('السبب والبيان:', 'Motif :')}</label>
              <input
                type="text"
                value={movementReason}
                onChange={(e) => setMovementReason(e.target.value)}
                className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-3 text-[#F7F3EA] font-bold text-sm"
              />
            </div>

            <button
              type="button"
              onClick={handleRecordMovement}
              disabled={isSubmitting || !movementAmount || !movementReason}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-40 text-[#171717] font-black text-base rounded-2xl cursor-pointer"
            >
              {t('تسجيل الحركة النقدية', 'Enregistrer Mouvement')}
            </button>
          </div>
        )}

        {/* TAB 3: SHIFTS HISTORY */}
        {activeTab === 'HISTORY' && (
          <div className="space-y-2.5 max-h-80 overflow-y-auto no-scrollbar">
            {shiftHistory.map((s) => (
              <div key={s.id} className="p-3.5 rounded-2xl bg-[#171717] border border-[#33302B] text-xs space-y-1.5">
                <div className="flex items-center justify-between font-black">
                  <span className="text-[#C6A15B] text-sm">
                    {t(`وردية #${s.shiftNumber}`, `Shift #${s.shiftNumber}`)} ({s.status})
                  </span>
                  <span className="text-[#A8A29E] font-mono">
                    {new Date(s.openedAt).toLocaleDateString('fr-FR')}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 font-bold">
                  <div>
                    <span className="text-[#A8A29E]">{t('افتتاحي:', 'Initial :')} </span>
                    <span className="text-[#F7F3EA] font-mono tabular-nums">{Number(s.openingCash).toLocaleString()} DA</span>
                  </div>
                  <div>
                    <span className="text-[#A8A29E]">{t('مبيعات نقدية:', 'Espèces :')} </span>
                    <span className="text-emerald-400 font-mono tabular-nums">{Number(s.totalCashSales).toLocaleString()} DA</span>
                  </div>
                  <div>
                    <span className="text-[#A8A29E]">{t('الفارق:', 'Écart :')} </span>
                    <span className="text-[#C6A15B] font-mono tabular-nums">
                      {Number(s.cashDifference ?? s.difference ?? 0).toLocaleString()} DA
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-[#A8A29E] font-semibold">
                  {t('الكاشير:', 'Caissier :')} {s.cashierName}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
