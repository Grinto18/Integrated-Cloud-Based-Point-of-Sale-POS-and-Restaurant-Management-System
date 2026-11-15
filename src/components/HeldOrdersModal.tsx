import React, { useState, useEffect } from 'react';
import { usePos } from '../context/PosContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api } from '../services/api.ts';
import { PauseCircle, PlayCircle, Trash2, X } from 'lucide-react';

interface HeldOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HeldOrdersModal: React.FC<HeldOrdersModalProps> = ({ isOpen, onClose }) => {
  const { loadHeldOrderIntoCart, refreshDashboard, refreshHeldOrders } = usePos();
  const { t } = useLanguage();
  const [heldOrders, setHeldOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      loadHeldOrders();
    }
  }, [isOpen]);

  const loadHeldOrders = async () => {
    setIsLoading(true);
    try {
      const data = await api.getOrders({ heldOnly: true });
      setHeldOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load held orders:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResume = async (order: any) => {
    try {
      const resumed = await api.resumeHeldOrder(order.id);
      loadHeldOrderIntoCart({
        ...order,
        ...resumed,
        items: resumed?.items?.length ? resumed.items : order.items,
        isHeld: false,
      });
      await refreshDashboard();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || t('فشل استرجاع الطلب المعلق', 'Échec de reprise'));
    }
  };

  const handleCancelHeld = async (orderId: number) => {
    try {
      await api.cancelOrder(orderId, 'إلغاء من شاشة الانتظار');
      await loadHeldOrders();
      await refreshHeldOrders();
      await refreshDashboard();
    } catch (err: any) {
      setErrorMsg(err.message || t('فشل إلغاء الطلب', 'Échec d’annulation'));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4 select-none overflow-y-auto">
      <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-3xl max-w-xl w-full p-4 sm:p-6 shadow-2xl space-y-4 text-[#F7F3EA] max-h-[94vh] overflow-y-auto no-scrollbar my-auto">
        <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-[#171717] border border-[#C6A15B]/40 text-[#C6A15B] shrink-0">
              <PauseCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-black text-lg sm:text-xl text-[#C6A15B]">
                {t('الطلبات المعلقة في الانتظار', 'Commandes en Attente')}
              </h3>
              <p className="text-xs font-bold text-[#A8A29E] mt-0.5">
                {heldOrders.length} {t('طلبات معلقة محفوظة', 'en attente')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] hover:text-[#F7F3EA]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-xl bg-red-950/70 border border-red-600/60 text-red-200 text-xs font-bold">
            {errorMsg}
          </div>
        )}

        <div className="space-y-2.5 max-h-[60vh] overflow-y-auto no-scrollbar">
          {isLoading ? (
            <div className="py-10 text-center text-[#A8A29E] font-bold text-sm">
              {t('جاري التحميل...', 'Chargement...')}
            </div>
          ) : heldOrders.length === 0 ? (
            <div className="py-12 text-center text-[#A8A29E] font-bold text-sm">
              {t('لا توجد طلبات معلقة حالياً', 'Aucune commande en attente')}
            </div>
          ) : (
            heldOrders.map((ord) => (
              <div
                key={ord.id}
                className="bg-[#171717] p-3.5 rounded-2xl border border-[#33302B] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-sm"
              >
                <div>
                  <div className="font-black text-base text-[#F7F3EA] font-mono">
                    {ord.orderNumber}
                  </div>
                  <div className="text-xs font-bold text-[#A8A29E] mt-0.5">
                    {ord.type === 'DINE_IN'
                      ? t(`طاولة ${ord.tableNumber || '—'}`, `Table ${ord.tableNumber || '—'}`)
                      : ord.type}
                  </div>
                  <div className="text-[#C6A15B] font-black text-lg mt-0.5 font-mono tabular-nums">
                    {Number(ord.total).toLocaleString()} DA
                  </div>
                </div>

                <div className="flex items-center gap-2 justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-[#33302B]">
                  <button
                    type="button"
                    onClick={() => handleResume(ord)}
                    className="flex-1 sm:flex-none px-4 py-2 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] rounded-xl font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span>{t('استئناف', 'Reprendre')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCancelHeld(ord.id)}
                    className="p-2 bg-red-950/60 hover:bg-red-900 text-red-300 rounded-xl border border-red-800/70 cursor-pointer"
                    title={t('إلغاء الطلب', 'Annuler')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
