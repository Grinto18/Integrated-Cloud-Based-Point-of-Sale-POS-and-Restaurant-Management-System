import React from 'react';
import { usePos } from '../context/PosContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import {
  Activity,
  Banknote,
  ChefHat,
  CheckCircle2,
  Coins,
  PauseCircle,
} from 'lucide-react';

interface CashierDashboardBarProps {
  onOpenCashRegisterModal: () => void;
  onOpenOrdersTab?: () => void;
}

export const CashierDashboardBar: React.FC<CashierDashboardBarProps> = ({
  onOpenCashRegisterModal,
  onOpenOrdersTab,
}) => {
  const { dashboardMetrics, currentShift, isShiftOpen } = usePos();
  const { t } = useLanguage();

  const activeCount = dashboardMetrics?.activeOrdersCount ?? 0;
  const preparingCount = dashboardMetrics?.preparingOrdersCount ?? 0;
  const readyCount = dashboardMetrics?.readyOrdersCount ?? 0;
  const heldCount = dashboardMetrics?.heldOrdersCount ?? 0;
  const shiftSales =
    dashboardMetrics?.shiftTotalSales ??
    (currentShift
      ? Number(currentShift.totalCashSales || 0) +
        Number(currentShift.totalCardSales || 0) +
        Number(currentShift.totalBaridimobSales || 0) +
        Number(currentShift.totalCcpSales || 0)
      : 0);

  return (
    <div
      data-testid="cashier-dashboard-bar"
      className="bg-[#171717] border-b border-[#33302B] px-2.5 sm:px-4 py-2 shrink-0 select-none"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {/* Active Orders */}
        <button
          type="button"
          onClick={onOpenOrdersTab}
          className="flex items-center justify-between bg-[#222222] hover:border-[#C6A15B]/60 border border-[#33302B] rounded-xl px-3 py-2 text-start transition cursor-pointer"
        >
          <div>
            <div className="text-[11px] text-[#A8A29E] font-bold">
              {t('الطلبات النشطة', 'Commandes Actives')}
            </div>
            <div className="text-lg font-black text-[#F7F3EA] tabular-nums">{activeCount}</div>
          </div>
          <Activity className="w-5 h-5 text-[#C6A15B] shrink-0" />
        </button>

        {/* Total Shift Sales */}
        <button
          type="button"
          onClick={onOpenCashRegisterModal}
          className="flex items-center justify-between bg-[#222222] hover:border-[#C6A15B]/60 border border-[#33302B] rounded-xl px-3 py-2 text-start transition cursor-pointer"
        >
          <div>
            <div className="text-[11px] text-[#A8A29E] font-bold">
              {t('مبيعات الوردية', 'Ventes du Shift')}
            </div>
            <div className="text-lg font-black text-[#C6A15B] tabular-nums">
              {Number(shiftSales).toLocaleString()} <span className="text-xs font-bold">DA</span>
            </div>
          </div>
          <Banknote className="w-5 h-5 text-[#C6A15B] shrink-0" />
        </button>

        {/* Preparing */}
        <div className="flex items-center justify-between bg-[#222222] border border-[#33302B] rounded-xl px-3 py-2">
          <div>
            <div className="text-[11px] text-[#A8A29E] font-bold">
              {t('قيد التحضير', 'En Préparation')}
            </div>
            <div className="text-lg font-black text-amber-400 tabular-nums">{preparingCount}</div>
          </div>
          <ChefHat className="w-5 h-5 text-amber-400 shrink-0" />
        </div>

        {/* Ready */}
        <div className="flex items-center justify-between bg-[#222222] border border-[#33302B] rounded-xl px-3 py-2">
          <div>
            <div className="text-[11px] text-[#A8A29E] font-bold">
              {t('طلبات جاهزة', 'Commandes Prêtes')}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-black text-emerald-400 tabular-nums">{readyCount}</span>
              {heldCount > 0 && (
                <span className="text-[10px] font-bold text-[#A8A29E] inline-flex items-center gap-0.5">
                  <PauseCircle className="w-3 h-3 text-[#C6A15B]" /> {heldCount}
                </span>
              )}
            </div>
          </div>
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
        </div>

        {/* Cash Register Status */}
        <button
          type="button"
          onClick={onOpenCashRegisterModal}
          className={`col-span-2 sm:col-span-1 flex items-center justify-between rounded-xl px-3 py-2 border text-start transition cursor-pointer ${
            isShiftOpen
              ? 'bg-emerald-950/40 border-emerald-600/50 hover:border-emerald-400'
              : 'bg-amber-950/40 border-[#C6A15B]/60 hover:border-[#C6A15B]'
          }`}
        >
          <div>
            <div className="text-[11px] text-[#A8A29E] font-bold">
              {t('حالة الصندوق', 'État Caisse')}
            </div>
            <div
              className={`text-sm sm:text-base font-black ${
                isShiftOpen ? 'text-emerald-400' : 'text-[#C6A15B]'
              }`}
            >
              {isShiftOpen
                ? t(`مفتوح (#${currentShift?.shiftNumber || 1})`, `Ouverte (#${currentShift?.shiftNumber || 1})`)
                : t('مغلق — افتح الآن', 'Fermée — Ouvrir')}
            </div>
          </div>
          <Coins className={`w-5 h-5 shrink-0 ${isShiftOpen ? 'text-emerald-400' : 'text-[#C6A15B]'}`} />
        </button>
      </div>
    </div>
  );
};
