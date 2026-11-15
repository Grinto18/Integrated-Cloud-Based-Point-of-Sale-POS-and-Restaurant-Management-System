import React, { useState, useEffect } from 'react';
import { Customer } from '../types.ts';
import { api } from '../services/api.ts';
import { useLanguage } from '../context/LanguageContext.tsx';
import { Users, Plus, Search, X, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

export const CustomersManager: React.FC = () => {
  const { t } = useLanguage();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    loadCustomers();
  }, []);

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback((c) => (c?.text === text ? null : c)), 4000);
  };

  const loadCustomers = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.getCustomers();
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setErrorMsg(err?.message || t('فشل تحميل قائمة الزبائن', 'Échec du chargement des clients'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = async () => {
    setModalError(null);
    if (!name.trim() || !phone.trim()) {
      setModalError(t('الاسم ورقم الهاتف حقول إلزامية', 'Le nom et le téléphone sont requis'));
      return;
    }
    setIsSaving(true);
    try {
      await api.createCustomer({
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setShowAddModal(false);
      setName('');
      setPhone('');
      setAddress('');
      setNotes('');
      await loadCustomers();
      showToast('success', t('تمت إضافة الزبون بنجاح', 'Client ajouté avec succès'));
    } catch (err: any) {
      setModalError(err?.message || t('فشل إضافة الزبون', 'Échec de l’ajout du client'));
    } finally {
      setIsSaving(false);
    }
  };

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      (c.address && c.address.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar bg-[#171717] p-2.5 sm:p-5 select-none text-[#F7F3EA] space-y-3 sm:space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#222222] p-3 sm:p-4 rounded-2xl border border-[#33302B] shadow-lg shrink-0">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          <div className="font-black text-base sm:text-xl text-[#F7F3EA] flex items-center gap-2 sm:pe-3 sm:border-e sm:border-[#33302B]">
            <div className="w-9 h-9 rounded-xl bg-[#171717] border border-[#C6A15B]/40 flex items-center justify-center text-[#C6A15B] shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <span className="whitespace-nowrap">{t('إدارة الزبائن', 'Gestion des Clients')}</span>
          </div>

          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 text-[#A8A29E] absolute start-3 top-2.5 sm:top-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('بحث بالاسم أو الهاتف...', 'Rechercher nom ou tél...')}
              className="w-full bg-[#171717] border border-[#33302B] rounded-xl ps-9 pe-3 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-[#F7F3EA] placeholder-[#A8A29E]/60 focus:outline-none focus:border-[#C6A15B]"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={loadCustomers}
            className="p-2.5 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#A8A29E] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#C6A15B]' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => {
              setModalError(null);
              setShowAddModal(true);
            }}
            className="bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-black transition flex items-center justify-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>{t('زبون جديد', 'Nouveau client')}</span>
          </button>
        </div>
      </div>

      {(feedback || errorMsg) && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-between gap-2 shrink-0 ${
            errorMsg || feedback?.type === 'error'
              ? 'bg-rose-950/60 border-rose-600/60 text-rose-200'
              : 'bg-emerald-950/60 border-emerald-600/60 text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {errorMsg || feedback?.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            <span>{errorMsg || feedback?.text}</span>
          </div>
          <button type="button" onClick={() => { setErrorMsg(null); setFeedback(null); }} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-[#222222] rounded-2xl border border-[#33302B] overflow-hidden flex flex-col shadow-lg flex-1 min-h-0">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 gap-3">
            <div className="w-10 h-10 border-4 border-[#C6A15B] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[#A8A29E] font-bold">{t('جاري التحميل...', 'Chargement...')}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-[#A8A29E] gap-2">
            <Users className="w-12 h-12 text-[#33302B]" />
            <p className="font-black text-[#F7F3EA]">{t('لا يوجد زبائن مسجلون', 'Aucun client trouvé')}</p>
          </div>
        ) : (
          <>
            {/* Mobile View: Cards */}
            <div className="md:hidden overflow-y-auto p-2.5 space-y-2 no-scrollbar">
              {filtered.map((c) => (
                <div key={c.id} className="bg-[#171717] p-3 rounded-xl border border-[#33302B] space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-[#F7F3EA] text-sm">{c.name}</span>
                    <span className="font-mono text-[#C6A15B] font-black">{c.phone}</span>
                  </div>
                  {c.address && <div className="text-[#A8A29E]">{c.address}</div>}
                  {c.notes && <div className="text-[#A8A29E]/75 text-[11px]">{c.notes}</div>}
                  <div className="flex items-center justify-between pt-1.5 border-t border-[#33302B] font-bold font-mono tabular-nums">
                    <span className="text-[#A8A29E]">
                      {t('الطلبات:', 'Commandes :')} {c.totalOrders}
                    </span>
                    <span className="font-black text-[#C6A15B]">
                      {Number(c.totalSpent).toLocaleString()} DA
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop View: Table */}
            <div className="hidden md:block overflow-auto flex-1 no-scrollbar">
              <table className="w-full text-start text-sm">
                <thead className="bg-[#171717] text-[#A8A29E] border-b border-[#33302B] font-black text-xs uppercase sticky top-0">
                  <tr>
                    <th className="p-4">{t('اسم الزبون', 'Nom client')}</th>
                    <th className="p-4">{t('رقم الهاتف', 'Téléphone')}</th>
                    <th className="p-4">{t('العنوان', 'Adresse')}</th>
                    <th className="p-4">{t('ملاحظات', 'Notes')}</th>
                    <th className="p-4">{t('عدد الطلبات', 'Commandes')}</th>
                    <th className="p-4">{t('إجمالي الإنفاق', 'Total dépensé')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#33302B] font-bold">
                  {filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-[#171717]/70 transition">
                      <td className="p-4 font-black text-[#F7F3EA] text-base">{c.name}</td>
                      <td className="p-4 font-mono text-[#C6A15B]">{c.phone}</td>
                      <td className="p-4 text-[#A8A29E]">{c.address || '—'}</td>
                      <td className="p-4 text-[#A8A29E] text-xs">{c.notes || '—'}</td>
                      <td className="p-4 font-mono tabular-nums font-black text-[#F7F3EA]">{c.totalOrders}</td>
                      <td className="p-4 font-mono tabular-nums font-black text-[#C6A15B] text-base">
                        {Number(c.totalSpent).toLocaleString()} DA
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B]">{t('إضافة زبون جديد', 'Nouveau client')}</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-600/60 text-rose-200 text-xs font-bold">
                {modalError}
              </div>
            )}

            <div className="space-y-3 font-bold text-sm">
              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الاسم الكامل *', 'Nom complet *')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('رقم الهاتف *', 'Téléphone *')}</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('العنوان', 'Adresse')}</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('ملاحظات', 'Notes')}</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={isSaving}
              onClick={handleAdd}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl transition shadow-xl cursor-pointer"
            >
              {isSaving ? t('جاري الحفظ...', 'Enregistrement...') : t('حفظ الزبون', 'Enregistrer le client')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
