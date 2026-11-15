import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api.ts';
import { useLanguage } from '../context/LanguageContext.tsx';
import {
  AlertOctagon,
  Plus,
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export const WasteManager: React.FC = () => {
  const { lang, t } = useLanguage();
  const [wasteList, setWasteList] = useState<any[]>([]);
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [selectedIngId, setSelectedIngId] = useState<string>('');
  const [nameInput, setNameInput] = useState<string>('');
  const [qtyInput, setQtyInput] = useState<string>('1');
  const [unitInput, setUnitInput] = useState<string>('KG');
  const [costInput, setCostInput] = useState<string>('0');
  const [reasonInput, setReasonInput] = useState<string>('EXPIRED');
  const [notesInput, setNotesInput] = useState<string>('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    loadAll();
  }, []);

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback((c) => (c?.text === text ? null : c)), 4000);
  };

  const loadAll = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [w, ings] = await Promise.all([api.getWasteRecords(), api.getInventory()]);
      setWasteList(Array.isArray(w) ? w : []);
      setIngredients(Array.isArray(ings) ? ings : []);
    } catch (err: any) {
      setErrorMsg(err?.message || t('فشل تحميل سجل الهدر', 'Échec du chargement des pertes'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectIngredient = (ingIdStr: string) => {
    setSelectedIngId(ingIdStr);
    const ing = ingredients.find((i) => i.id === Number(ingIdStr));
    if (ing) {
      setNameInput(lang === 'fr' && ing.nameFr ? ing.nameFr : ing.nameAr);
      setUnitInput(ing.unit);
      setCostInput(String(Math.round(Number(ing.costPerUnit) * (parseFloat(qtyInput) || 1) * 100) / 100));
    }
  };

  const handleQtyChange = (val: string) => {
    setQtyInput(val);
    if (selectedIngId) {
      const ing = ingredients.find((i) => i.id === Number(selectedIngId));
      if (ing) {
        const q = parseFloat(val) || 0;
        setCostInput(String(Math.round(Number(ing.costPerUnit) * q * 100) / 100));
      }
    }
  };

  const handleSaveWaste = async () => {
    setModalError(null);
    const qty = parseFloat(qtyInput);
    if (!nameInput.trim() || !Number.isFinite(qty) || qty <= 0) {
      setModalError(t('اسم المادة والكمية الموجبة مطلوبان', 'Le nom et une quantité positive sont requis'));
      return;
    }
    setIsSaving(true);
    try {
      await api.recordWaste({
        ingredientId: selectedIngId ? Number(selectedIngId) : null,
        name: nameInput.trim(),
        quantity: qty,
        unit: unitInput || 'KG',
        cost: parseFloat(costInput) || 0,
        reason: reasonInput,
        notes: notesInput,
      });
      setShowAddModal(false);
      setNameInput('');
      setSelectedIngId('');
      setNotesInput('');
      await loadAll();
      showToast('success', t('تم تسجيل الهدر وخصمه من المخزون بنجاح', 'Perte enregistrée et déduite du stock'));
    } catch (err: any) {
      setModalError(err?.message || t('فشل تسجيل التالف', 'Échec de l’enregistrement'));
    } finally {
      setIsSaving(false);
    }
  };

  const reasonLabel = (reason: string) => {
    switch (reason) {
      case 'EXPIRED':
        return t('منتهي الصلاحية', 'Périmé');
      case 'DAMAGED':
        return t('تالف / فاسد', 'Abîmé');
      case 'BURNED':
        return t('محروق أثناء الطهي', 'Brûlé');
      case 'SPILLED':
        return t('منسكب / مهدور', 'Renversé');
      default:
        return t('أخرى', 'Autre');
    }
  };

  const totalLoss = useMemo(
    () => wasteList.reduce((sum, w) => sum + Number(w.cost || 0), 0),
    [wasteList]
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar bg-[#171717] p-2.5 sm:p-5 select-none text-[#F7F3EA] space-y-3 sm:space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#222222] p-3 sm:p-4 rounded-2xl border border-[#33302B] shadow-lg shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#171717] border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
            <AlertOctagon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-black text-lg sm:text-xl text-[#F7F3EA]">{t('سجل الهدر والتالف', 'Journal des Pertes & Gaspillage')}</h2>
            <p className="text-xs text-[#A8A29E] font-bold">
              {t('متابعة الفواقد وتلفيات المخزون وخصمها تلقائياً', 'Suivi des pertes et déduction automatique du stock')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <div className="bg-[#171717] border border-[#33302B] rounded-xl px-3 py-1.5 text-xs">
            <span className="text-[#A8A29E]">{t('إجمالي الخسائر:', 'Total pertes :')} </span>
            <span className="text-rose-400 font-mono tabular-nums font-black">{totalLoss.toLocaleString()} DA</span>
          </div>

          <button
            type="button"
            onClick={loadAll}
            className="p-2.5 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#A8A29E] hover:text-[#F7F3EA] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#C6A15B]' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => {
              setModalError(null);
              setShowAddModal(true);
            }}
            className="bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-black shadow-lg transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>{t('تسجيل تالف جديد', 'Déclarer une perte')}</span>
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

      <div className="flex-1 bg-[#222222] rounded-2xl border border-[#33302B] shadow-lg overflow-hidden flex flex-col min-h-0">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 gap-3">
            <div className="w-10 h-10 border-4 border-[#C6A15B] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[#A8A29E] font-bold">{t('جاري التحميل...', 'Chargement...')}</span>
          </div>
        ) : wasteList.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-[#A8A29E] gap-2">
            <AlertOctagon className="w-12 h-12 text-[#33302B]" />
            <p className="font-black text-[#F7F3EA]">{t('لا توجد فواقد أو تالف مسجل', 'Aucune perte enregistrée')}</p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden overflow-y-auto p-2.5 space-y-2 no-scrollbar">
              {wasteList.map((w) => (
                <div key={w.id} className="bg-[#171717] border border-[#33302B] rounded-xl p-3 space-y-2 text-xs">
                  <div className="flex items-start justify-between">
                    <span className="font-black text-sm text-[#F7F3EA]">{w.name}</span>
                    <span className="px-2 py-0.5 rounded-lg bg-rose-950/60 border border-rose-600/50 text-rose-300 font-black">
                      {reasonLabel(w.reason)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between font-mono tabular-nums">
                    <span className="text-rose-400 font-black">{Number(w.quantity)} {w.unit}</span>
                    <span className="text-[#C6A15B] font-black">{Number(w.cost).toLocaleString()} DA</span>
                  </div>
                  <div className="flex items-center justify-between text-[#A8A29E] pt-1.5 border-t border-[#33302B]">
                    <span>{w.employeeName || '—'}</span>
                    <span className="font-mono">{new Date(w.createdAt).toLocaleDateString('fr-FR')}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-auto flex-1 no-scrollbar">
              <table className="w-full text-start text-sm">
                <thead className="bg-[#171717] text-[#A8A29E] border-b border-[#33302B] font-black text-xs uppercase sticky top-0">
                  <tr>
                    <th className="p-4">{t('المادة', 'Ingrédient / Article')}</th>
                    <th className="p-4">{t('الكمية التالفة', 'Quantité')}</th>
                    <th className="p-4">{t('السبب', 'Motif')}</th>
                    <th className="p-4">{t('قيمة الخسارة (DA)', 'Coût perte (DA)')}</th>
                    <th className="p-4">{t('الموظف المسجل', 'Déclaré par')}</th>
                    <th className="p-4">{t('التاريخ', 'Date')}</th>
                    <th className="p-4">{t('ملاحظات', 'Notes')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#33302B] font-bold">
                  {wasteList.map((w) => (
                    <tr key={w.id} className="hover:bg-[#171717]/70 transition">
                      <td className="p-4 font-black text-[#F7F3EA] text-base">{w.name}</td>
                      <td className="p-4 font-mono tabular-nums font-black text-rose-400">
                        {Number(w.quantity)} {w.unit}
                      </td>
                      <td className="p-4">
                        <span className="bg-rose-950/60 text-rose-300 border border-rose-600/50 px-2.5 py-1 rounded-lg text-xs font-black">
                          {reasonLabel(w.reason)}
                        </span>
                      </td>
                      <td className="p-4 font-mono tabular-nums text-[#C6A15B] font-black text-base">
                        {Number(w.cost).toLocaleString()} DA
                      </td>
                      <td className="p-4 text-[#F7F3EA]/80">{w.employeeName || '—'}</td>
                      <td className="p-4 text-[#A8A29E] font-mono">
                        {new Date(w.createdAt).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="p-4 text-[#A8A29E] text-xs">{w.notes || '—'}</td>
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
              <h3 className="font-black text-xl text-[#C6A15B] flex items-center gap-2">
                <AlertOctagon className="w-5 h-5 text-rose-400" />
                <span>{t('تسجيل مادة تالفة', 'Enregistrer une perte')}</span>
              </h3>
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

            <div className="space-y-3 text-sm font-bold">
              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('اختر من المخزون:', 'Choisir du stock :')}</label>
                <select
                  value={selectedIngId}
                  onChange={(e) => handleSelectIngredient(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                >
                  <option value="">{t('-- أو اكتب يدوياً أدناه --', '-- Ou saisie manuelle ci-dessous --')}</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {lang === 'fr' && i.nameFr ? i.nameFr : i.nameAr} ({i.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('اسم المادة *', 'Nom article *')}</label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('الكمية *', 'Quantité *')}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={qtyInput}
                    onChange={(e) => handleQtyChange(e.target.value)}
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono tabular-nums focus:outline-none focus:border-[#C6A15B]"
                  />
                </div>
                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('الوحدة', 'Unité')}</label>
                  <input
                    type="text"
                    value={unitInput}
                    onChange={(e) => setUnitInput(e.target.value)}
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono focus:outline-none focus:border-[#C6A15B]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('سبب التلف', 'Motif')}</label>
                <select
                  value={reasonInput}
                  onChange={(e) => setReasonInput(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                >
                  <option value="EXPIRED">{t('منتهي الصلاحية', 'Périmé (EXPIRED)')}</option>
                  <option value="DAMAGED">{t('تالف أو فاسد', 'Abîmé (DAMAGED)')}</option>
                  <option value="BURNED">{t('محروق أثناء الطهي', 'Brûlé (BURNED)')}</option>
                  <option value="SPILLED">{t('منسكب أو مهدور', 'Renversé (SPILLED)')}</option>
                  <option value="OTHER">{t('أخرى', 'Autre (OTHER)')}</option>
                </select>
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('التكلفة التقديرية (DA)', 'Coût estimé (DA)')}</label>
                <input
                  type="number"
                  value={costInput}
                  onChange={(e) => setCostInput(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-rose-400 font-mono tabular-nums font-black text-lg focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('ملاحظات إضافية', 'Notes')}</label>
                <input
                  type="text"
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={isSaving}
              onClick={handleSaveWaste}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl shadow-lg transition cursor-pointer"
            >
              {isSaving ? t('جاري الحفظ...', 'Enregistrement...') : t('تأكيد وتسجيل الهدر', 'Enregistrer la perte')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
