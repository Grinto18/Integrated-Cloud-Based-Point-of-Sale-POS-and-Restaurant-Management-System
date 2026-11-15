import React, { useState, useEffect, useCallback } from 'react';
import { AuditLog, User as PosUser } from '../types.ts';
import { api } from '../services/api.ts';
import { useLanguage } from '../context/LanguageContext.tsx';
import {
  ShieldCheck,
  Search,
  RefreshCw,
  Clock,
  User,
  Download,
  Lock,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';

export const AuditLogView: React.FC = () => {
  const { t } = useLanguage();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [usersList, setUsersList] = useState<PosUser[]>([]);
  const [availableActions, setAvailableActions] = useState<string[]>([]);

  // Filters & Pagination
  const [search, setSearch] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedAction, setSelectedAction] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const pageSize = 25;

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .getUsers()
      .then((u) => setUsersList(Array.isArray(u) ? u : []))
      .catch(() => {});
  }, []);

  const loadLogs = useCallback(
    async (targetPage = page) => {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const res = await api.getAuditLogsPaginated({
          page: targetPage,
          limit: pageSize,
          userId: selectedUserId ? Number(selectedUserId) : undefined,
          action: selectedAction !== 'ALL' ? selectedAction : undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          search: search.trim() || undefined,
        });

        if (Array.isArray(res)) {
          // Graceful fallback if cached array
          setLogs(res);
          setTotal(res.length);
          setTotalPages(1);
        } else {
          setLogs(Array.isArray(res?.items) ? res.items : []);
          setTotal(Number(res?.total || 0));
          setTotalPages(Math.max(1, Number(res?.totalPages || 1)));
          if (Array.isArray(res?.availableActions)) {
            setAvailableActions(res.availableActions);
          }
        }
      } catch (err: any) {
        setErrorMsg(err?.message || t('فشل تحميل سجل العمليات', 'Échec du chargement du journal d’audit'));
      } finally {
        setIsLoading(false);
      }
    },
    [page, selectedUserId, selectedAction, startDate, endDate, search, t]
  );

  useEffect(() => {
    loadLogs(page);
  }, [page, selectedUserId, selectedAction, startDate, endDate]);

  const handleApplySearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (page !== 1) setPage(1);
    else loadLogs(1);
  };

  const handleResetFilters = () => {
    setSearch('');
    setSelectedUserId('');
    setSelectedAction('ALL');
    setStartDate('');
    setEndDate('');
    if (page !== 1) setPage(1);
    else {
      // Load immediately with cleared criteria
      setTimeout(() => loadLogs(1), 0);
    }
  };

  const fetchAllFilteredForExport = async (): Promise<AuditLog[]> => {
    try {
      const res = await api.getAuditLogsPaginated({
        page: 1,
        limit: 500,
        userId: selectedUserId ? Number(selectedUserId) : undefined,
        action: selectedAction !== 'ALL' ? selectedAction : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: search.trim() || undefined,
      });
      return Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : logs;
    } catch {
      return logs;
    }
  };

  const handleExportCSV = async () => {
    const exportRows = await fetchAllFilteredForExport();
    if (exportRows.length === 0) return;
    const headers = ['ID', 'Action', 'User', 'EntityType', 'EntityId', 'Details', 'Timestamp'];
    const csvLines = exportRows.map((l) =>
      [
        l.id,
        `"${(l.action || '').replace(/"/g, '""')}"`,
        `"${(l.userName || 'System').replace(/"/g, '""')}"`,
        `"${(l.entityType || '').replace(/"/g, '""')}"`,
        `"${(l.entityId || '').replace(/"/g, '""')}"`,
        `"${(l.details || '').replace(/"/g, '""')}"`,
        `"${l.createdAt || ''}"`,
      ].join(',')
    );
    const content = '\uFEFF' + [headers.join(','), ...csvLines].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportJSON = async () => {
    const exportRows = await fetchAllFilteredForExport();
    if (exportRows.length === 0) return;
    const blob = new Blob([JSON.stringify(exportRows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar bg-[#171717] p-2.5 sm:p-5 select-none text-[#F7F3EA] space-y-3 sm:space-y-4">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-[#222222] p-3 sm:p-4 rounded-2xl border border-[#33302B] shadow-lg shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#171717] border border-[#C6A15B]/40 flex items-center justify-center text-[#C6A15B] shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-black text-base sm:text-xl text-[#F7F3EA]">
              {t('سجل أمان العمليات والرقابة', 'Journal d’Audit & Sécurité')}
            </h2>
            <p className="text-[11px] sm:text-xs text-[#C6A15B] font-bold flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>
                {t('سجل رقابي غير قابل للتعديل أو الحذف', 'Journal strictement immuable (lecture seule)')}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={logs.length === 0}
            className="px-3 py-2 rounded-xl bg-[#171717] hover:border-[#C6A15B] disabled:opacity-40 border border-[#33302B] text-[#F7F3EA] text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#C6A15B]" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            onClick={handleExportJSON}
            disabled={logs.length === 0}
            className="px-3 py-2 rounded-xl bg-[#171717] hover:border-[#C6A15B] disabled:opacity-40 border border-[#33302B] text-[#F7F3EA] text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#C6A15B]" />
            <span>JSON</span>
          </button>

          <button
            type="button"
            onClick={() => loadLogs(page)}
            className="px-3 py-2 rounded-xl bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{t('تحديث', 'Actualiser')}</span>
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <form
        onSubmit={handleApplySearch}
        className="bg-[#222222] p-3 rounded-2xl border border-[#33302B] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 shrink-0"
      >
        <div className="relative lg:col-span-2">
          <Search className="w-4 h-4 text-[#A8A29E] absolute start-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('بحث في التفاصيل أو الموظف...', 'Rechercher détails ou utilisateur...')}
            className="w-full bg-[#171717] border border-[#33302B] rounded-xl ps-9 pe-3 py-2 text-xs text-[#F7F3EA] placeholder-[#A8A29E]/60 focus:outline-none focus:border-[#C6A15B]"
          />
        </div>

        <select
          value={selectedUserId}
          onChange={(e) => {
            setSelectedUserId(e.target.value);
            setPage(1);
          }}
          className="bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2 text-xs font-bold text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
        >
          <option value="">{t('جميع الموظفين', 'Tous les employés')}</option>
          {usersList.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </select>

        <select
          value={selectedAction}
          onChange={(e) => {
            setSelectedAction(e.target.value);
            setPage(1);
          }}
          className="bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2 text-xs font-bold text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
        >
          <option value="ALL">{t('كل العمليات', 'Toutes les actions')}</option>
          {availableActions.map((act) => (
            <option key={act} value={act}>
              {act}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            setPage(1);
          }}
          aria-label={t('من تاريخ', 'Date début')}
          className="bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2 text-xs font-mono text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
        />

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
            aria-label={t('إلى تاريخ', 'Date fin')}
            className="flex-1 bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2 text-xs font-mono text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
          />
          <button
            type="button"
            onClick={handleResetFilters}
            className="p-2 rounded-xl bg-[#171717] border border-[#33302B] hover:border-[#C6A15B] text-[#A8A29E] hover:text-[#C6A15B] cursor-pointer"
            title={t('إعادة ضبط الفلاتر', 'Réinitialiser filtres')}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </form>

      {errorMsg && (
        <div className="px-4 py-2.5 rounded-xl bg-rose-950/60 border border-rose-600/60 text-rose-200 text-xs font-bold flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Table */}
      <div className="flex-1 bg-[#222222] rounded-2xl border border-[#33302B] shadow-lg overflow-hidden flex flex-col min-h-0">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 gap-3">
            <div className="w-10 h-10 border-4 border-[#C6A15B] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[#A8A29E] font-bold">{t('جاري تحميل السجلات...', 'Chargement des journaux...')}</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-[#A8A29E] gap-2">
            <ShieldCheck className="w-12 h-12 text-[#33302B]" />
            <p className="font-black text-[#F7F3EA]">{t('لا توجد سجلات مطابقة', 'Aucun enregistrement trouvé')}</p>
          </div>
        ) : (
          <div className="overflow-auto flex-1 no-scrollbar">
            <table className="w-full text-start text-sm">
              <thead className="bg-[#171717] text-[#A8A29E] border-b border-[#33302B] font-black text-xs uppercase sticky top-0">
                <tr>
                  <th className="p-3.5">{t('نوع العملية', 'Action')}</th>
                  <th className="p-3.5">{t('الموظف المسؤول', 'Utilisateur')}</th>
                  <th className="p-3.5">{t('التفاصيل والبيان', 'Détails')}</th>
                  <th className="p-3.5">{t('الوقت والتاريخ', 'Horodatage')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#33302B] font-bold">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-[#171717]/70 transition">
                    <td className="p-3.5">
                      <span className="bg-[#171717] text-[#C6A15B] border border-[#C6A15B]/40 px-2.5 py-1 rounded-lg text-xs font-black font-mono">
                        {l.action}
                      </span>
                    </td>
                    <td className="p-3.5 text-[#F7F3EA]">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-[#A8A29E]" />
                        <span>{l.userName || 'System'}</span>
                      </div>
                    </td>
                    <td className="p-3.5 text-[#F7F3EA]/85 text-xs sm:text-sm">{l.details || '—'}</td>
                    <td className="p-3.5 font-mono tabular-nums text-[#A8A29E] text-xs">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#C6A15B]/70" />
                        <span>{new Date(l.createdAt).toLocaleString('fr-FR')}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="bg-[#171717] border-t border-[#33302B] px-4 py-2.5 flex items-center justify-between text-xs font-bold text-[#A8A29E] shrink-0">
          <span className="font-mono tabular-nums">
            {t('إجمالي السجلات:', 'Total :')} {total} • {t('صفحة', 'Page')} {page} / {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg bg-[#222222] border border-[#33302B] hover:border-[#C6A15B] disabled:opacity-40 text-[#F7F3EA] flex items-center gap-1 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
              <span>{t('السابق', 'Précédent')}</span>
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 rounded-lg bg-[#222222] border border-[#33302B] hover:border-[#C6A15B] disabled:opacity-40 text-[#F7F3EA] flex items-center gap-1 cursor-pointer"
            >
              <span>{t('التالي', 'Suivant')}</span>
              <ChevronLeft className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
