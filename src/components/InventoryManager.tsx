import React, { useState, useEffect, useMemo } from 'react';
import { Ingredient, Supplier, InventoryMovement } from '../types.ts';
import { api } from '../services/api.ts';
import { useLanguage } from '../context/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import {
  Package,
  Plus,
  AlertTriangle,
  X,
  Search,
  Edit2,
  History,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  SlidersHorizontal,
} from 'lucide-react';

export const InventoryManager: React.FC = () => {
  const { lang, t } = useLanguage();
  const { hasRole } = useAuth();
  const canEdit = hasRole(['ADMIN', 'MANAGER', 'INVENTORY']);

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState<string>('');
  const [lowStockOnly, setLowStockOnly] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Adjustment modal
  const [adjustingIng, setAdjustingIng] = useState<Ingredient | null>(null);
  const [actualQtyInput, setActualQtyInput] = useState<string>('');
  const [adjustReasonInput, setAdjustReasonInput] = useState<string>('جرد دوري');
  const [isSavingAdjust, setIsSavingAdjust] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Add / Edit Ingredient modal
  const [ingredientModal, setIngredientModal] = useState<{
    id?: number;
    nameAr: string;
    nameFr: string;
    unit: string;
    openingStock: string;
    minStock: string;
    maxStock: string;
    costPerUnit: string;
    supplierId: string;
  } | null>(null);
  const [isSavingIng, setIsSavingIng] = useState<boolean>(false);

  // Movements Ledger modal
  const [showMovementsModal, setShowMovementsModal] = useState<boolean>(false);
  const [movementsList, setMovementsList] = useState<InventoryMovement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState<boolean>(false);
  const [movementIngFilter, setMovementIngFilter] = useState<string>('ALL');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('ALL');

  useEffect(() => {
    loadAll();
  }, []);

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => {
      setFeedback((cur) => (cur?.text === text ? null : cur));
    }, 4000);
  };

  const loadAll = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [ings, sups] = await Promise.all([
        api.getInventory(),
        api.getSuppliers().catch(() => []),
      ]);
      setIngredients(Array.isArray(ings) ? ings : []);
      setSuppliers(Array.isArray(sups) ? sups : []);
    } catch (err: any) {
      setErrorMsg(err?.message || t('فشل تحميل بيانات المخزون', 'Échec du chargement du stock'));
    } finally {
      setIsLoading(false);
    }
  };

  const openMovementsModal = async (ingId?: number) => {
    const ingFilter = ingId ? String(ingId) : 'ALL';
    setMovementIngFilter(ingFilter);
    setMovementTypeFilter('ALL');
    setShowMovementsModal(true);
    await loadMovements(ingFilter, 'ALL');
  };

  const loadMovements = async (ingFilter = movementIngFilter, typeFilter = movementTypeFilter) => {
    setMovementsLoading(true);
    try {
      const rows = await api.getInventoryMovements({
        ingredientId: ingFilter !== 'ALL' ? Number(ingFilter) : undefined,
        type: typeFilter !== 'ALL' ? typeFilter : undefined,
        limit: 150,
      });
      setMovementsList(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      showToast('error', err?.message || t('فشل تحميل حركات المخزون', 'Échec du chargement des mouvements'));
    } finally {
      setMovementsLoading(false);
    }
  };

  const handleExecuteAdjustment = async () => {
    if (!adjustingIng) return;
    setModalError(null);
    const qty = parseFloat(actualQtyInput);
    if (!Number.isFinite(qty) || qty < 0) {
      setModalError(t('الكمية الفعلية يجب أن تكون رقماً غير سالب', 'La quantité réelle doit être >= 0'));
      return;
    }
    setIsSavingAdjust(true);
    try {
      await api.adjustStock({
        ingredientId: adjustingIng.id,
        actualQuantity: qty,
        reason: adjustReasonInput,
      });
      setAdjustingIng(null);
      await loadAll();
      showToast('success', t('تمت تسوية الرصيد وتسجيل الحركة بنجاح', 'Stock ajusté avec succès'));
    } catch (err: any) {
      setModalError(err?.message || t('فشل تسوية المخزون', 'Échec de l’ajustement du stock'));
    } finally {
      setIsSavingAdjust(false);
    }
  };

  const handleSaveIngredient = async () => {
    if (!ingredientModal) return;
    setModalError(null);
    if (!ingredientModal.nameAr.trim()) {
      setModalError(t('اسم المادة بالعربية مطلوب', 'Le nom en arabe est requis'));
      return;
    }
    const minVal = parseFloat(ingredientModal.minStock);
    const maxVal = ingredientModal.maxStock.trim() !== '' ? parseFloat(ingredientModal.maxStock) : null;
    const costVal = parseFloat(ingredientModal.costPerUnit);
    const openingVal = parseFloat(ingredientModal.openingStock || '0');

    if (!Number.isFinite(minVal) || minVal < 0 || (maxVal !== null && (!Number.isFinite(maxVal) || maxVal < minVal))) {
      setModalError(t('تحقق من قيم الحد الأدنى والأقصى للمخزون', 'Vérifiez les seuils min/max'));
      return;
    }

    setIsSavingIng(true);
    try {
      if (ingredientModal.id) {
        await api.updateIngredient(ingredientModal.id, {
          nameAr: ingredientModal.nameAr.trim(),
          nameFr: ingredientModal.nameFr.trim() || null,
          unit: ingredientModal.unit,
          minStock: minVal,
          maxStock: maxVal,
          costPerUnit: Number.isFinite(costVal) && costVal >= 0 ? costVal : 0,
          supplierId: ingredientModal.supplierId ? Number(ingredientModal.supplierId) : null,
        });
        showToast('success', t('تم تحديث المادة الأولية بنجاح', 'Ingrédient mis à jour'));
      } else {
        await api.createIngredient({
          nameAr: ingredientModal.nameAr.trim(),
          nameFr: ingredientModal.nameFr.trim() || null,
          unit: ingredientModal.unit,
          openingStock: Number.isFinite(openingVal) && openingVal >= 0 ? openingVal : 0,
          minStock: minVal,
          maxStock: maxVal,
          costPerUnit: Number.isFinite(costVal) && costVal >= 0 ? costVal : 0,
          supplierId: ingredientModal.supplierId ? Number(ingredientModal.supplierId) : null,
        });
        showToast('success', t('تمت إضافة المادة الأولية للمخزون', 'Ingrédient ajouté au stock'));
      }
      setIngredientModal(null);
      await loadAll();
    } catch (err: any) {
      setModalError(err?.message || t('فشل حفظ بيانات المادة', 'Échec de l’enregistrement'));
    } finally {
      setIsSavingIng(false);
    }
  };

  const kpis = useMemo(() => {
    const lowCount = ingredients.filter((i) => Number(i.currentStock) <= Number(i.minStock)).length;
    const valuation = ingredients.reduce(
      (sum, i) => sum + Math.max(0, Number(i.currentStock || 0)) * Number(i.costPerUnit || 0),
      0
    );
    return { total: ingredients.length, lowCount, valuation };
  }, [ingredients]);

  const filtered = ingredients.filter((i) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      i.nameAr.toLowerCase().includes(q) ||
      (i.nameFr && i.nameFr.toLowerCase().includes(q));
    const isLow = Number(i.currentStock) <= Number(i.minStock);
    return matchesSearch && (!lowStockOnly || isLow);
  });

  const ingDisplayName = (i: Ingredient) => (lang === 'fr' && i.nameFr ? i.nameFr : i.nameAr);

  const movementTypeBadge = (type: string) => {
    switch (type) {
      case 'OPENING_STOCK':
        return { label: t('رصيد افتتاحي', 'Stock initial'), cls: 'bg-[#C6A15B]/20 text-[#C6A15B] border-[#C6A15B]/50' };
      case 'PURCHASE':
        return { label: t('شراء', 'Achat'), cls: 'bg-emerald-950/60 text-emerald-300 border-emerald-600/50' };
      case 'SALE_DEDUCTION':
        return { label: t('استهلاك طلب', 'Déduction vente'), cls: 'bg-sky-950/60 text-sky-300 border-sky-600/50' };
      case 'ADJUSTMENT':
        return { label: t('تسوية جرد', 'Ajustement'), cls: 'bg-amber-950/60 text-amber-300 border-amber-600/50' };
      case 'WASTE':
        return { label: t('هدر / تالف', 'Perte'), cls: 'bg-rose-950/60 text-rose-300 border-rose-600/50' };
      case 'CANCEL_RESTORE':
      case 'REFUND_RESTORE':
      case 'ORDER_ADJUSTMENT_RESTORE':
        return { label: t('استرجاع للمخزون', 'Retour stock'), cls: 'bg-emerald-950/60 text-emerald-300 border-emerald-600/50' };
      default:
        return { label: type, cls: 'bg-[#171717] text-[#A8A29E] border-[#33302B]' };
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar bg-[#171717] p-2.5 sm:p-5 select-none text-[#F7F3EA] space-y-3 sm:space-y-4">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-[#222222] p-3 sm:p-4 rounded-2xl border border-[#33302B] shadow-lg shrink-0">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          <div className="font-black text-base sm:text-xl text-[#F7F3EA] flex items-center gap-2 sm:pe-3 sm:border-e sm:border-[#33302B]">
            <div className="w-9 h-9 rounded-xl bg-[#171717] border border-[#C6A15B]/40 flex items-center justify-center text-[#C6A15B] shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <span className="whitespace-nowrap">{t('إدارة المخزون والمواد الأولية', 'Gestion des Stocks & Ingrédients')}</span>
          </div>

          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 text-[#A8A29E] absolute start-3 top-2.5 sm:top-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('بحث في المواد...', 'Rechercher ingrédient...')}
              className="w-full bg-[#171717] border border-[#33302B] rounded-xl ps-9 pe-3 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-[#F7F3EA] placeholder-[#A8A29E]/60 focus:outline-none focus:border-[#C6A15B]"
            />
          </div>

          <button
            type="button"
            onClick={() => setLowStockOnly((v) => !v)}
            className={`px-3 py-1.5 sm:py-2 rounded-xl text-xs font-black border transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              lowStockOnly
                ? 'bg-rose-950/60 border-rose-500/60 text-rose-300'
                : 'bg-[#171717] border-[#33302B] text-[#A8A29E] hover:border-[#C6A15B]'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              {t('نواقص المخزون', 'Stock critique')} ({kpis.lowCount})
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 justify-end flex-wrap">
          <button
            type="button"
            onClick={loadAll}
            className="p-2 sm:p-2.5 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#A8A29E] hover:text-[#F7F3EA] cursor-pointer"
            title={t('تحديث', 'Actualiser')}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#C6A15B]' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => openMovementsModal()}
            className="bg-[#171717] hover:border-[#C6A15B] text-[#C6A15B] border border-[#33302B] px-3.5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-black transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <History className="w-4 h-4" />
            <span>{t('سجل الحركات', 'Mouvements')}</span>
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setModalError(null);
                setIngredientModal({
                  nameAr: '',
                  nameFr: '',
                  unit: 'KG',
                  openingStock: '0',
                  minStock: '5',
                  maxStock: '',
                  costPerUnit: '500',
                  supplierId: '',
                });
              }}
              className="bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-black shadow-lg transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
              <span>{t('مادة أولية جديدة', 'Nouvel ingrédient')}</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
        <div className="bg-[#222222] border border-[#33302B] rounded-2xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-xs text-[#A8A29E] font-bold block">{t('إجمالي المواد المسجلة', 'Total ingrédients')}</span>
            <span className="text-2xl font-black text-[#F7F3EA] font-mono tabular-nums">{kpis.total}</span>
          </div>
          <Package className="w-7 h-7 text-[#C6A15B]/70" />
        </div>

        <div className="bg-[#222222] border border-[#33302B] rounded-2xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-xs text-[#A8A29E] font-bold block">{t('تنبيهات الحد الأدنى', 'Alertes stock faible')}</span>
            <span className={`text-2xl font-black font-mono tabular-nums ${kpis.lowCount > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {kpis.lowCount}
            </span>
          </div>
          <AlertTriangle className={`w-7 h-7 ${kpis.lowCount > 0 ? 'text-rose-400' : 'text-emerald-400/70'}`} />
        </div>

        <div className="bg-[#222222] border border-[#33302B] rounded-2xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-xs text-[#A8A29E] font-bold block">{t('القيمة التقديرية للمخزون', 'Valorisation du stock')}</span>
            <span className="text-2xl font-black text-[#C6A15B] font-mono tabular-nums">
              {Math.round(kpis.valuation).toLocaleString()} DA
            </span>
          </div>
          <SlidersHorizontal className="w-7 h-7 text-[#C6A15B]/70" />
        </div>
      </div>

      {/* Feedback Banner */}
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
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{errorMsg || feedback?.text}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setFeedback(null);
            }}
            className="opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table & Cards */}
      <div className="bg-[#222222] rounded-2xl border border-[#33302B] overflow-hidden flex flex-col shadow-lg flex-1 min-h-0">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-10">
            <div className="w-10 h-10 border-4 border-[#C6A15B] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-bold text-[#A8A29E]">{t('جاري تحميل المخزون...', 'Chargement du stock...')}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 p-10 text-[#A8A29E]">
            <Package className="w-12 h-12 text-[#33302B]" />
            <p className="font-black text-base text-[#F7F3EA]">{t('لا توجد مواد مطابقة', 'Aucun ingrédient trouvé')}</p>
          </div>
        ) : (
          <>
            {/* Mobile View: Cards */}
            <div className="md:hidden overflow-y-auto p-2.5 space-y-2 no-scrollbar">
              {filtered.map((ing) => {
                const stock = Number(ing.currentStock);
                const min = Number(ing.minStock);
                const isLow = stock <= min;
                return (
                  <div key={ing.id} className="bg-[#171717] p-3 rounded-xl border border-[#33302B] space-y-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-black text-[#F7F3EA] text-sm">{ingDisplayName(ing)}</div>
                        {ing.nameFr && ing.nameAr && (
                          <div className="text-[#A8A29E] text-[11px]">{lang === 'fr' ? ing.nameAr : ing.nameFr}</div>
                        )}
                      </div>
                      <span
                        className={`font-mono tabular-nums px-2 py-0.5 rounded-lg border font-black ${
                          isLow
                            ? 'text-rose-300 bg-rose-950/60 border-rose-600/60'
                            : 'text-emerald-300 bg-emerald-950/50 border-emerald-600/50'
                        }`}
                      >
                        {stock.toFixed(2)} {ing.unit}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[#A8A29E] font-bold font-mono tabular-nums">
                      <span>
                        {t('الحد الأدنى:', 'Seuil min :')} {min.toFixed(2)} {ing.unit}
                      </span>
                      <span className="text-[#C6A15B] font-black">
                        {Number(ing.costPerUnit).toLocaleString()} DA/{ing.unit}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[#33302B]">
                      <span className="text-[#A8A29E] text-[11px]">
                        {t('المورد:', 'Fournisseur :')} {ing.supplierName || '—'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openMovementsModal(ing.id)}
                          className="p-1.5 rounded-lg bg-[#222222] border border-[#33302B] text-[#A8A29E] hover:text-[#C6A15B] cursor-pointer"
                          title={t('سجل الحركات', 'Historique')}
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setModalError(null);
                                setIngredientModal({
                                  id: ing.id,
                                  nameAr: ing.nameAr,
                                  nameFr: ing.nameFr || '',
                                  unit: ing.unit,
                                  openingStock: String(ing.currentStock),
                                  minStock: String(ing.minStock),
                                  maxStock: ing.maxStock ? String(ing.maxStock) : '',
                                  costPerUnit: String(ing.costPerUnit),
                                  supplierId: ing.supplierId ? String(ing.supplierId) : '',
                                });
                              }}
                              className="p-1.5 rounded-lg bg-[#222222] border border-[#33302B] text-[#F7F3EA] cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setModalError(null);
                                setAdjustingIng(ing);
                                setActualQtyInput(String(stock));
                              }}
                              className="px-2.5 py-1 bg-[#C6A15B] text-[#171717] rounded-lg text-xs font-black cursor-pointer"
                            >
                              {t('جرد وتسوية', 'Ajuster')}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop View: Table */}
            <div className="hidden md:block overflow-auto no-scrollbar flex-1">
              <table className="w-full text-start text-sm">
                <thead className="bg-[#171717] text-[#A8A29E] border-b border-[#33302B] font-black text-xs uppercase sticky top-0 z-10">
                  <tr>
                    <th className="p-3.5">{t('المادة الأولية', 'Ingrédient')}</th>
                    <th className="p-3.5">{t('الوحدة', 'Unité')}</th>
                    <th className="p-3.5">{t('الرصيد الحالي', 'Stock actuel')}</th>
                    <th className="p-3.5">{t('الحد الأدنى / الأقصى', 'Min / Max')}</th>
                    <th className="p-3.5">{t('تكلفة الوحدة', 'Coût unitaire')}</th>
                    <th className="p-3.5">{t('المورد', 'Fournisseur')}</th>
                    <th className="p-3.5 text-center">{t('الإجراءات', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#33302B] font-bold">
                  {filtered.map((ing) => {
                    const stock = Number(ing.currentStock);
                    const min = Number(ing.minStock);
                    const isLow = stock <= min;
                    return (
                      <tr key={ing.id} className="hover:bg-[#171717]/70 transition">
                        <td className="p-3.5 font-black text-[#F7F3EA] text-base">
                          <div>{ingDisplayName(ing)}</div>
                          {ing.nameFr && ing.nameAr && (
                            <div className="text-xs text-[#A8A29E] font-semibold">
                              {lang === 'fr' ? ing.nameAr : ing.nameFr}
                            </div>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-[#A8A29E]">{ing.unit}</td>
                        <td className="p-3.5 font-mono tabular-nums">
                          <span
                            className={`px-3 py-1 rounded-xl border font-black inline-flex items-center gap-1.5 ${
                              isLow
                                ? 'text-rose-300 bg-rose-950/60 border-rose-600/60'
                                : 'text-emerald-300 bg-emerald-950/50 border-emerald-600/50'
                            }`}
                          >
                            {isLow && <AlertTriangle className="w-3.5 h-3.5" />}
                            {stock.toFixed(3)} {ing.unit}
                          </span>
                        </td>
                        <td className="p-3.5 font-mono tabular-nums text-[#A8A29E] text-xs">
                          {min.toFixed(2)} {ing.maxStock ? ` / ${Number(ing.maxStock).toFixed(2)}` : ''}
                        </td>
                        <td className="p-3.5 font-mono tabular-nums font-black text-[#C6A15B]">
                          {Number(ing.costPerUnit).toLocaleString()} DA
                        </td>
                        <td className="p-3.5 text-[#A8A29E]">{ing.supplierName || '—'}</td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openMovementsModal(ing.id)}
                              className="p-2 rounded-xl bg-[#171717] hover:border-[#C6A15B] text-[#A8A29E] hover:text-[#C6A15B] border border-[#33302B] cursor-pointer"
                              title={t('سجل حركات المادة', 'Historique mouvements')}
                            >
                              <History className="w-4 h-4" />
                            </button>
                            {canEdit && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModalError(null);
                                    setIngredientModal({
                                      id: ing.id,
                                      nameAr: ing.nameAr,
                                      nameFr: ing.nameFr || '',
                                      unit: ing.unit,
                                      openingStock: String(ing.currentStock),
                                      minStock: String(ing.minStock),
                                      maxStock: ing.maxStock ? String(ing.maxStock) : '',
                                      costPerUnit: String(ing.costPerUnit),
                                      supplierId: ing.supplierId ? String(ing.supplierId) : '',
                                    });
                                  }}
                                  className="p-2 rounded-xl bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] border border-[#33302B] cursor-pointer"
                                  title={t('تعديل بيانات المادة', 'Modifier ingrédient')}
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModalError(null);
                                    setAdjustingIng(ing);
                                    setActualQtyInput(String(stock));
                                  }}
                                  className="px-3.5 py-2 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] rounded-xl text-xs font-black transition cursor-pointer"
                                >
                                  {t('جرد وتسوية', 'Ajuster')}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Adjustment Modal */}
      {adjustingIng && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-lg text-[#C6A15B]">
                {t('تسوية جرد:', 'Ajustement inventaire :')} {ingDisplayName(adjustingIng)}
              </h3>
              <button
                type="button"
                onClick={() => setAdjustingIng(null)}
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
              <div className="p-3 bg-[#171717] rounded-2xl border border-[#33302B] text-[#A8A29E]">
                {t('الرصيد المسجل في النظام:', 'Stock théorique système :')}{' '}
                <span className="text-[#C6A15B] font-mono tabular-nums font-black text-base">
                  {Number(adjustingIng.currentStock)} {adjustingIng.unit}
                </span>
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">
                  {t('الكمية الفعلية الموجودة:', 'Quantité réelle comptée :')}
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={actualQtyInput}
                  onChange={(e) => setActualQtyInput(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-3 text-emerald-400 font-mono tabular-nums font-black text-xl focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('السبب أو الملاحظة:', 'Motif ou note :')}</label>
                <input
                  type="text"
                  value={adjustReasonInput}
                  onChange={(e) => setAdjustReasonInput(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-3 text-[#F7F3EA] text-sm focus:outline-none focus:border-[#C6A15B]"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={isSavingAdjust}
              onClick={handleExecuteAdjustment}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl transition shadow-xl cursor-pointer"
            >
              {isSavingAdjust ? t('جاري الحفظ...', 'Enregistrement...') : t('تأكيد التسوية', 'Confirmer l’ajustement')}
            </button>
          </div>
        </div>
      )}

      {/* Add / Edit Ingredient Modal */}
      {ingredientModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA] max-h-[92vh] overflow-y-auto no-scrollbar">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B]">
                {ingredientModal.id ? t('تعديل مادة أولية', 'Modifier ingrédient') : t('إضافة مادة أولية للمخزن', 'Nouvel ingrédient')}
              </h3>
              <button
                type="button"
                onClick={() => setIngredientModal(null)}
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
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الاسم بالعربية *', 'Nom en arabe *')}</label>
                <input
                  type="text"
                  value={ingredientModal.nameAr}
                  onChange={(e) => setIngredientModal({ ...ingredientModal, nameAr: e.target.value })}
                  placeholder="لحم مفروم"
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الاسم بالفرنسية', 'Nom en français')}</label>
                <input
                  type="text"
                  value={ingredientModal.nameFr}
                  onChange={(e) => setIngredientModal({ ...ingredientModal, nameFr: e.target.value })}
                  placeholder="Viande hachée"
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('الوحدة', 'Unité')}</label>
                  <select
                    value={ingredientModal.unit}
                    onChange={(e) => setIngredientModal({ ...ingredientModal, unit: e.target.value })}
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black focus:outline-none focus:border-[#C6A15B]"
                  >
                    <option value="KG">{t('كيلوغرام (KG)', 'Kilogramme (KG)')}</option>
                    <option value="G">{t('غرام (G)', 'Gramme (G)')}</option>
                    <option value="L">{t('لتر (L)', 'Litre (L)')}</option>
                    <option value="ML">{t('ميليلتر (ML)', 'Millilitre (ML)')}</option>
                    <option value="PIECE">{t('حبة / علبة (PIECE)', 'Pièce (PIECE)')}</option>
                  </select>
                </div>

                {!ingredientModal.id && (
                  <div>
                    <label className="block text-[#A8A29E] text-xs mb-1">{t('الرصيد الافتتاحي', 'Stock initial')}</label>
                    <input
                      type="number"
                      step="0.001"
                      value={ingredientModal.openingStock}
                      onChange={(e) => setIngredientModal({ ...ingredientModal, openingStock: e.target.value })}
                      className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-emerald-400 font-mono tabular-nums font-black focus:outline-none focus:border-[#C6A15B]"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('الحد الأدنى للتنبيه', 'Seuil minimum')}</label>
                  <input
                    type="number"
                    step="0.001"
                    value={ingredientModal.minStock}
                    onChange={(e) => setIngredientModal({ ...ingredientModal, minStock: e.target.value })}
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono tabular-nums font-black focus:outline-none focus:border-[#C6A15B]"
                  />
                </div>

                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('الحد الأقصى (اختياري)', 'Seuil max (optionnel)')}</label>
                  <input
                    type="number"
                    step="0.001"
                    value={ingredientModal.maxStock}
                    onChange={(e) => setIngredientModal({ ...ingredientModal, maxStock: e.target.value })}
                    placeholder="—"
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono tabular-nums focus:outline-none focus:border-[#C6A15B]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('سعر التكلفة لكل وحدة (DA)', 'Coût unitaire (DA)')}</label>
                <input
                  type="number"
                  value={ingredientModal.costPerUnit}
                  onChange={(e) => setIngredientModal({ ...ingredientModal, costPerUnit: e.target.value })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#C6A15B] font-mono tabular-nums font-black text-lg focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('المورد', 'Fournisseur')}</label>
                <select
                  value={ingredientModal.supplierId}
                  onChange={(e) => setIngredientModal({ ...ingredientModal, supplierId: e.target.value })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-bold focus:outline-none focus:border-[#C6A15B]"
                >
                  <option value="">{t('-- اختياري --', '-- Optionnel --')}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              disabled={isSavingIng}
              onClick={handleSaveIngredient}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl transition shadow-xl cursor-pointer"
            >
              {isSavingIng ? t('جاري الحفظ...', 'Enregistrement...') : t('حفظ المادة', 'Enregistrer')}
            </button>
          </div>
        </div>
      )}

      {/* Inventory Movements Ledger Modal */}
      {showMovementsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-4xl w-full p-4 sm:p-6 shadow-2xl space-y-4 text-[#F7F3EA] max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3 shrink-0">
              <h3 className="font-black text-lg sm:text-xl text-[#C6A15B] flex items-center gap-2">
                <History className="w-5 h-5" />
                <span>{t('سجل حركات المخزون (Ledger)', 'Journal des mouvements de stock')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowMovementsModal(false)}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <select
                value={movementIngFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setMovementIngFilter(val);
                  loadMovements(val, movementTypeFilter);
                }}
                className="bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2 text-xs font-bold text-[#F7F3EA]"
              >
                <option value="ALL">{t('جميع المواد', 'Tous les ingrédients')}</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {ingDisplayName(i)}
                  </option>
                ))}
              </select>

              <select
                value={movementTypeFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setMovementTypeFilter(val);
                  loadMovements(movementIngFilter, val);
                }}
                className="bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2 text-xs font-bold text-[#F7F3EA]"
              >
                <option value="ALL">{t('كل أنواع الحركات', 'Tous les types')}</option>
                <option value="OPENING_STOCK">{t('رصيد افتتاحي', 'Stock initial')}</option>
                <option value="PURCHASE">{t('مشتريات', 'Achats')}</option>
                <option value="SALE_DEDUCTION">{t('استهلاك مبيعات', 'Déduction ventes')}</option>
                <option value="ADJUSTMENT">{t('تسوية جرد', 'Ajustements')}</option>
                <option value="WASTE">{t('هدر وتلف', 'Pertes')}</option>
              </select>
            </div>

            <div className="flex-1 overflow-auto no-scrollbar border border-[#33302B] rounded-2xl bg-[#171717]">
              {movementsLoading ? (
                <div className="p-10 text-center text-xs text-[#A8A29E]">{t('جاري التحميل...', 'Chargement...')}</div>
              ) : movementsList.length === 0 ? (
                <div className="p-10 text-center text-sm text-[#A8A29E]">
                  {t('لا توجد حركات مسجلة وفق الفلتر المحدد', 'Aucun mouvement trouvé')}
                </div>
              ) : (
                <table className="w-full text-start text-xs">
                  <thead className="bg-[#222222] text-[#A8A29E] border-b border-[#33302B] sticky top-0">
                    <tr>
                      <th className="p-3">{t('المادة', 'Ingrédient')}</th>
                      <th className="p-3">{t('نوع الحركة', 'Type')}</th>
                      <th className="p-3">{t('الكمية', 'Quantité')}</th>
                      <th className="p-3">{t('ملاحظات', 'Notes')}</th>
                      <th className="p-3">{t('الموظف', 'Utilisateur')}</th>
                      <th className="p-3">{t('التاريخ', 'Date')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#33302B] font-bold">
                    {movementsList.map((m) => {
                      const q = Number(m.quantity);
                      const badge = movementTypeBadge(m.type);
                      return (
                        <tr key={m.id} className="hover:bg-[#222222]/60">
                          <td className="p-3 text-[#F7F3EA]">
                            {lang === 'fr' && m.ingredientNameFr ? m.ingredientNameFr : m.ingredientNameAr || `#${m.ingredientId}`}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-lg border text-[11px] font-black ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className={`p-3 font-mono tabular-nums font-black ${q >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {q > 0 ? `+${q}` : q} {m.unit || ''}
                          </td>
                          <td className="p-3 text-[#A8A29E] max-w-xs truncate">{m.notes || '—'}</td>
                          <td className="p-3 text-[#F7F3EA]/80">{m.performedByName || 'System'}</td>
                          <td className="p-3 font-mono text-[#A8A29E]">{new Date(m.createdAt).toLocaleString('fr-FR')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
