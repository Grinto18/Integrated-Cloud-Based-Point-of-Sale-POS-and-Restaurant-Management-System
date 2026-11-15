import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { useLanguage } from '../context/LanguageContext.tsx';
import { usePos } from '../context/PosContext.tsx';
import {
  ChefHat,
  Flame,
  GlassWater,
  Cake,
  Clock,
  RefreshCw,
} from 'lucide-react';

export const KitchenDisplay: React.FC = () => {
  const { t, lang } = useLanguage();
  const { refreshDashboard } = usePos();
  const [tickets, setTickets] = useState<any[]>([]);
  const [activeStation, setActiveStation] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  useEffect(() => {
    loadTickets();
    const interval = setInterval(() => {
      if (autoRefresh) loadTickets();
    }, 6000);
    return () => clearInterval(interval);
  }, [activeStation, autoRefresh]);

  const loadTickets = async () => {
    try {
      const data = await api.getKitchenTickets(activeStation);
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load kitchen tickets:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateItemStatus = async (itemId: number, nextStatus: string) => {
    try {
      await api.updateKitchenItemStatus(itemId, nextStatus);
      await loadTickets();
      await refreshDashboard();
    } catch (err) {
      console.error('Failed to update kitchen item:', err);
    }
  };

  const getElapsedMinutes = (dateStr: string) => {
    const elapsed = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    return Math.max(0, elapsed);
  };

  const stations = [
    { id: 'ALL', ar: 'الكل', fr: 'Toutes Stations', icon: ChefHat },
    { id: 'MAIN_KITCHEN', ar: 'المطبخ الرئيسي', fr: 'Cuisine Principale', icon: ChefHat },
    { id: 'GRILL', ar: 'مشاوي وفحم', fr: 'Grill', icon: Flame },
    { id: 'DESSERT', ar: 'تحلية وحلويات', fr: 'Desserts', icon: Cake },
    { id: 'DRINKS', ar: 'مشروبات وعصائر', fr: 'Boissons', icon: GlassWater },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#171717] p-2.5 sm:p-4 select-none text-[#F7F3EA] space-y-3">
      {/* Top Controls */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#222222] p-3 sm:p-4 rounded-2xl border border-[#33302B] shadow shrink-0">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <div className="font-black text-base sm:text-xl text-[#C6A15B] flex items-center gap-2 shrink-0">
            <ChefHat className="w-6 h-6 shrink-0" />
            <span className="whitespace-nowrap">{t('شاشة المطبخ (KDS)', 'Écran Cuisine (KDS)')}</span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {stations.map((s) => {
              const Icon = s.icon;
              const isSelected = activeStation === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveStation(s.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'bg-[#C6A15B] text-[#171717] shadow'
                      : 'bg-[#171717] hover:border-[#C6A15B]/50 text-[#A8A29E] hover:text-[#F7F3EA] border border-[#33302B]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t(s.ar, s.fr)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2.5 justify-end shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-[#A8A29E] font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 accent-[#C6A15B] cursor-pointer"
            />
            <span>{t('تحديث تلقائي', 'Auto-refresh')}</span>
          </label>

          <button
            type="button"
            onClick={loadTickets}
            className="p-2 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#C6A15B] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tickets Board */}
      <div className="flex-1 overflow-x-auto overflow-y-auto pt-1 no-scrollbar">
        {tickets.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[#A8A29E] py-12">
            <ChefHat className="w-14 h-14 stroke-[1.5] text-[#C6A15B]/40 mb-3" />
            <h3 className="text-lg font-black text-[#F7F3EA]">
              {t('لا توجد طلبات قيد التحضير حالياً', 'Aucune commande en préparation')}
            </h3>
          </div>
        ) : (
          <div className="flex gap-3 h-full pb-2">
            {tickets.map((ticket) => {
              const elapsed = getElapsedMinutes(ticket.createdAt);
              const isUrgent = elapsed > 15;
              const isWarning = elapsed > 8 && !isUrgent;

              return (
                <div
                  key={ticket.id}
                  className={`w-72 sm:w-84 h-full flex flex-col rounded-2xl border-2 shadow-lg bg-[#222222] shrink-0 overflow-hidden ${
                    isUrgent
                      ? 'border-rose-500'
                      : isWarning
                      ? 'border-amber-500'
                      : 'border-[#C6A15B]/50'
                  }`}
                >
                  <div
                    className={`p-3.5 border-b border-[#33302B] flex items-center justify-between text-sm font-black ${
                      isUrgent
                        ? 'bg-rose-950/60'
                        : isWarning
                        ? 'bg-amber-950/50'
                        : 'bg-[#1D1D1D]'
                    }`}
                  >
                    <div>
                      <span className="text-lg font-black text-[#F7F3EA] font-mono block">
                        {ticket.orderNumber}
                      </span>
                      <span className="text-xs font-bold text-[#A8A29E]">
                        {ticket.type === 'DINE_IN'
                          ? t(`طاولة ${ticket.tableNumber || '—'}`, `Table ${ticket.tableNumber || '—'}`)
                          : ticket.type === 'DELIVERY'
                          ? t('توصيل منزلي', 'Livraison')
                          : t('طلب محمول', 'À emporter')}
                      </span>
                    </div>

                    <div className="text-end font-mono">
                      <div className="flex items-center gap-1 text-base font-black text-[#C6A15B] tabular-nums">
                        <Clock className="w-4 h-4" />
                        <span>{elapsed} m</span>
                      </div>
                      <span className="text-xs text-[#A8A29E]">
                        {new Date(ticket.createdAt).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-2 no-scrollbar bg-[#171717]">
                    {ticket.items?.map((item: any) => {
                      const isReady = item.status === 'READY';
                      const isPreparing = item.status === 'PREPARING';

                      return (
                        <div
                          key={item.id}
                          className={`p-3 rounded-xl border transition ${
                            isReady
                              ? 'bg-emerald-950/40 border-emerald-600/60 text-emerald-200'
                              : isPreparing
                              ? 'bg-[#2A2620] border-[#C6A15B] text-[#F7F3EA]'
                              : 'bg-[#222222] border-[#33302B] text-[#F7F3EA]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono font-black text-base text-[#C6A15B] bg-[#171717] px-2 py-0.5 rounded-lg border border-[#33302B]">
                                {item.quantity}×
                              </span>
                              <div>
                                <span className="font-black text-sm">
                                  {lang === 'fr' && item.nameFr ? item.nameFr : item.nameAr}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                const next =
                                  item.status === 'NEW'
                                    ? 'PREPARING'
                                    : item.status === 'PREPARING'
                                    ? 'READY'
                                    : 'SERVED';
                                handleUpdateItemStatus(item.id, next);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition cursor-pointer ${
                                isReady
                                  ? 'bg-emerald-600 text-white'
                                  : isPreparing
                                  ? 'bg-[#C6A15B] text-[#171717]'
                                  : 'bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] border border-[#33302B]'
                              }`}
                            >
                              {isReady
                                ? t('جاهز ✓', 'Prêt ✓')
                                : isPreparing
                                ? t('تأكيد الجاهزية', 'Marquer Prêt')
                                : t('بدء التحضير', 'Préparer')}
                            </button>
                          </div>

                          {item.notes && (
                            <div className="mt-2 text-xs text-[#C6A15B] font-bold bg-[#171717] px-2 py-1 rounded border border-[#33302B]">
                              {item.notes}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {ticket.notes && (
                    <div className="px-3.5 py-2 bg-[#1D1D1D] border-t border-[#33302B] text-xs font-bold text-[#A8A29E]">
                      {ticket.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
