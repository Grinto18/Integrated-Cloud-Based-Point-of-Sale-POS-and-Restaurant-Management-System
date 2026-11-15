import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { usePos } from '../context/PosContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import {
  BarChart3,
  TrendingUp,
  CreditCard,
  Download,
  Printer,
  RefreshCw,
} from 'lucide-react';

export const ReportsView: React.FC = () => {
  const { setReceiptToPrint } = usePos();
  const { t } = useLanguage();
  const [dashboard, setDashboard] = useState<any>(null);
  const [salesList, setSalesList] = useState<any[]>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [reprintingId, setReprintingId] = useState<number | null>(null);

  const handleReprintOrder = async (orderId: number) => {
    try {
      setReprintingId(orderId);
      const fullOrder = await api.getOrder(orderId);
      setReceiptToPrint({
        orderNumber: fullOrder.orderNumber,
        dailySequence: fullOrder.dailySequence,
        tableNumber: fullOrder.table?.tableNumber || fullOrder.tableNumber,
        customerName: fullOrder.customer?.name || fullOrder.customerName,
        orderType: fullOrder.type,
        items: fullOrder.items || [],
        subtotal: Number(fullOrder.subtotal),
        discount: Number(fullOrder.discount || 0),
        deliveryFee: Number(fullOrder.deliveryFee || 0),
        taxRate: Number(fullOrder.taxRate || 0),
        taxAmount: Number(fullOrder.taxAmount || 0),
        total: Number(fullOrder.total),
        tenderAmount: Number(fullOrder.paidAmount || fullOrder.total),
        changeAmount: Number(fullOrder.changeAmount || 0),
        cashierName: fullOrder.cashier?.fullName || fullOrder.cashierName || 'Admin',
        time: new Date(fullOrder.createdAt).toLocaleTimeString('fr-FR'),
        date: new Date(fullOrder.createdAt).toLocaleDateString('fr-FR'),
      });
    } catch (err) {
      console.error('Failed to reprint invoice:', err);
    } finally {
      setReprintingId(null);
    }
  };

  useEffect(() => {
    loadReports();
  }, [startDate, endDate]);

  const loadReports = async () => {
    setIsLoading(true);
    try {
      const [dash, sales] = await Promise.all([
        api.getDashboardReport(startDate || undefined, endDate || undefined),
        api.getSalesReport(startDate, endDate),
      ]);
      setDashboard(dash);
      setSalesList(Array.isArray(sales) ? sales : []);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (salesList.length === 0) return;
    const headers = ['Order Number', 'Date', 'Type', 'Total (DA)', 'Discount', 'Status', 'Cashier'];
    const rows = salesList.map((s) => [
      s.orderNumber,
      new Date(s.createdAt).toLocaleDateString('fr-FR'),
      s.type,
      s.total,
      s.discount,
      s.paymentStatus,
      s.cashier || 'Admin',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `sales_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar smooth-scroll bg-[#171717] p-2.5 sm:p-5 select-none text-[#F7F3EA] space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#222222] p-3.5 sm:p-4 rounded-2xl border border-[#33302B] shadow shrink-0">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="font-black text-base sm:text-xl text-[#C6A15B] flex items-center gap-2">
            <BarChart3 className="w-6 h-6 shrink-0" />
            <span>{t('لوحة التقارير والإحصائيات', 'Rapports & Statistiques')}</span>
          </div>

          <div className="flex items-center gap-2 text-xs font-bold w-full sm:w-auto">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-[#171717] border border-[#33302B] rounded-xl px-2.5 py-1.5 text-[#F7F3EA] font-mono"
            />
            <span className="text-[#A8A29E]">{t('إلى', 'à')}</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-[#171717] border border-[#33302B] rounded-xl px-2.5 py-1.5 text-[#F7F3EA] font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <button
            type="button"
            onClick={handleExportCSV}
            className="bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] px-3.5 py-2 rounded-xl border border-[#33302B] text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#C6A15B]" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            onClick={loadReports}
            className="p-2 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#C6A15B] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Stats Grid */}
      {dashboard && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 shrink-0">
          {[
            { label: t('مبيعات اليوم', 'Ventes du jour'), val: `${Number(dashboard.salesToday || 0).toLocaleString()} DA`, color: 'text-[#C6A15B]' },
            { label: t('عدد الطلبات', 'Commandes'), val: String(dashboard.orderCount || 0), color: 'text-[#F7F3EA]' },
            { label: t('متوسط الفاتورة', 'Panier Moyen'), val: `${Number(dashboard.averageOrderValue || 0).toLocaleString()} DA`, color: 'text-[#C6A15B]' },
            { label: t('المصاريف', 'Dépenses'), val: `-${Number(dashboard.expensesToday || 0).toLocaleString()} DA`, color: 'text-rose-400' },
            { label: t('صافي المبيعات', 'Net Ventes'), val: `${Number(dashboard.netSales || 0).toLocaleString()} DA`, color: 'text-emerald-400' },
            { label: t('نواقص المخزون', 'Stock Bas'), val: String(dashboard.lowStockCount || 0), color: 'text-amber-400' },
          ].map((kpi, idx) => (
            <div key={idx} className="p-3.5 bg-[#222222] rounded-2xl border border-[#33302B]">
              <span className="text-[11px] text-[#A8A29E] font-bold block">{kpi.label}</span>
              <span className={`text-lg sm:text-xl font-black mt-1 block font-mono tabular-nums ${kpi.color}`}>
                {kpi.val}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Top Products & Payment Methods */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 shrink-0">
        <div className="bg-[#222222] rounded-2xl border border-[#33302B] p-4 space-y-3">
          <h4 className="text-sm font-black text-[#C6A15B] flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            <span>{t('الأطباق الأكثر طلباً', 'Plats Populaires')}</span>
          </h4>
          <div className="space-y-2">
            {dashboard?.topProducts?.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-[#171717] p-2.5 rounded-xl border border-[#33302B] text-xs">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#C6A15B]/20 text-[#C6A15B] font-black flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="font-bold text-[#F7F3EA]">{p.nameAr}</span>
                </div>
                <div className="font-black text-[#C6A15B] font-mono tabular-nums">
                  {p.qty}× ({Number(p.total).toLocaleString()} DA)
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#222222] rounded-2xl border border-[#33302B] p-4 space-y-3">
          <h4 className="text-sm font-black text-[#C6A15B] flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            <span>{t('المبيعات حسب طريقة الدفع', 'Répartition Paiements')}</span>
          </h4>
          <div className="space-y-2">
            {dashboard?.paymentMethods?.map((m: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-[#171717] p-2.5 rounded-xl border border-[#33302B] text-xs">
                <span className="font-black text-[#F7F3EA]">{m.method}</span>
                <div className="font-black text-[#C6A15B] font-mono tabular-nums">
                  {Number(m.total).toLocaleString()} DA ({m.count})
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-[#222222] rounded-2xl border border-[#33302B] overflow-hidden flex flex-col">
        <div className="p-3.5 border-b border-[#33302B] flex items-center justify-between">
          <h4 className="font-black text-sm text-[#C6A15B]">
            {t(`سجل الفواتير (${salesList.length})`, `Historique Factures (${salesList.length})`)}
          </h4>
        </div>

        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-start text-xs sm:text-sm">
            <thead className="bg-[#171717] text-[#A8A29E] border-b border-[#33302B] font-black">
              <tr>
                <th className="p-3 text-start">{t('رقم الفاتورة', 'N° Bon')}</th>
                <th className="p-3 text-start">{t('التاريخ', 'Date')}</th>
                <th className="p-3 text-start">{t('النوع', 'Type')}</th>
                <th className="p-3 text-start">{t('المبلغ', 'Montant')}</th>
                <th className="p-3 text-start">{t('الحالة', 'Statut')}</th>
                <th className="p-3 text-center">{t('طباعة', 'Imprimer')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#33302B] font-bold">
              {salesList.map((s) => (
                <tr key={s.id} className="hover:bg-[#1D1D1D] transition">
                  <td className="p-3 font-mono font-black text-[#F7F3EA]">{s.orderNumber}</td>
                  <td className="p-3 text-[#A8A29E] text-xs">
                    {new Date(s.createdAt).toLocaleString('fr-FR')}
                  </td>
                  <td className="p-3 text-[#F7F3EA]">{s.type}</td>
                  <td className="p-3 font-black text-[#C6A15B] font-mono tabular-nums">
                    {Number(s.total).toLocaleString()} DA
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-black ${
                        s.paymentStatus === 'PAID'
                          ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/50'
                          : 'bg-rose-950/70 text-rose-300 border border-rose-700/50'
                      }`}
                    >
                      {s.paymentStatus}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleReprintOrder(s.id)}
                      disabled={reprintingId === s.id}
                      className="px-3 py-1.5 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] rounded-xl font-black text-xs inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>{reprintingId === s.id ? '...' : t('طباعة', 'Reçu')}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
