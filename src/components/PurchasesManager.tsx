import React, { useState, useEffect } from 'react';
import { Supplier, Ingredient } from '../types.ts';
import { api } from '../services/api.ts';
import { useLanguage } from '../context/LanguageContext.tsx';
import {
  FileSpreadsheet,
  Plus,
  Building,
  Trash2,
  X,
  PackageCheck,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

export const PurchasesManager: React.FC = () => {
  const { lang, t } = useLanguage();
  const [purchases, setPurchases] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'PURCHASES' | 'SUPPLIERS'>('PURCHASES');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // New Purchase modal
  const [showPurchaseModal, setShowPurchaseModal] = useState<boolean>(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [purchaseItemsList, setPurchaseItemsList] = useState<
    { ingredientId: number; quantity: string; unitCost: string }[]
  >([]);

  // New Supplier modal
  const [showSupplierModal, setShowSupplierModal] = useState<boolean>(false);
  const [supName, setSupName] = useState<string>('');
  const [supContact, setSupContact] = useState<string>('');
  const [supPhone, setSupPhone] = useState<string>('');
  const [supAddress, setSupAddress] = useState<string>('');

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
      const [p, s, ings] = await Promise.all([
        api.getPurchases(),
        api.getSuppliers(),
        api.getInventory(),
      ]);
      setPurchases(Array.isArray(p) ? p : []);
      setSuppliers(Array.isArray(s) ? s : []);
      setIngredients(Array.isArray(ings) ? ings : []);
    } catch (err: any) {
      setErrorMsg(err?.message || t('فشل تحميل بيانات المشتريات', 'Échec du chargement des achats'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddPurchaseItem = () => {
    if (ingredients.length === 0) return;
    setPurchaseItemsList([
      ...purchaseItemsList,
      { ingredientId: ingredients[0].id, quantity: '10', unitCost: String(ingredients[0].costPerUnit) },
    ]);
  };

  const handleSavePurchase = async () => {
    setModalError(null);
    if (!selectedSupplierId || purchaseItemsList.length === 0) {
      setModalError(t('يرجى اختيار المورد وإضافة بند واحد على الأقل', 'Sélectionnez un fournisseur et au moins un article'));
      return;
    }

    const parsedItems = purchaseItemsList.map((item) => ({
      ingredientId: item.ingredientId,
      quantity: parseFloat(item.quantity) || 0,
      unitCost: parseFloat(item.unitCost) || 0,
    }));

    if (parsedItems.some((i) => i.quantity <= 0 || i.unitCost < 0)) {
      setModalError(t('يجب أن تكون الكميات موجبة والأسعار صالحة', 'Les quantités doivent être positives'));
      return;
    }

    setIsSaving(true);
    try {
      await api.createPurchase({
        supplierId: Number(selectedSupplierId),
        invoiceDate,
        items: parsedItems,
      });
      setShowPurchaseModal(false);
      setPurchaseItemsList([]);
      await loadAll();
      showToast('success', t('تم تسجيل فاتورة الشراء وتحديث المخزون بنجاح', 'Achat enregistré et stock mis à jour'));
    } catch (err: any) {
      setModalError(err?.message || t('فشل حفظ فاتورة الشراء', 'Échec de l’enregistrement de l’achat'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSupplier = async () => {
    setModalError(null);
    if (!supName.trim()) {
      setModalError(t('اسم المؤسسة أو المورد مطلوب', 'Le nom du fournisseur est requis'));
      return;
    }
    setIsSaving(true);
    try {
      await api.createSupplier({
        name: supName.trim(),
        contactPerson: supContact.trim() || null,
        phone: supPhone.trim() || null,
        address: supAddress.trim() || null,
      });
      setShowSupplierModal(false);
      setSupName('');
      setSupContact('');
      setSupPhone('');
      setSupAddress('');
      await loadAll();
      showToast('success', t('تمت إضافة المورد بنجاح', 'Fournisseur ajouté'));
    } catch (err: any) {
      setModalError(err?.message || t('فشل إضافة المورد', 'Échec d’ajout du fournisseur'));
    } finally {
      setIsSaving(false);
    }
  };

  const totalPurchaseCalc = purchaseItemsList.reduce(
    (sum, it) => sum + (parseFloat(it.quantity) || 0) * (parseFloat(it.unitCost) || 0),
    0
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar bg-[#171717] p-2.5 sm:p-5 select-none text-[#F7F3EA] space-y-3 sm:space-y-4">
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#222222] p-3 sm:p-4 rounded-2xl border border-[#33302B] shadow-lg shrink-0">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="font-black text-base sm:text-xl text-[#F7F3EA] flex items-center gap-2 sm:pe-3 sm:border-e sm:border-[#33302B]">
            <div className="w-9 h-9 rounded-xl bg-[#171717] border border-[#C6A15B]/40 flex items-center justify-center text-[#C6A15B] shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <span className="whitespace-nowrap">{t('المشتريات والموردين', 'Achats & Fournisseurs')}</span>
          </div>

          <div className="flex items-center gap-1.5 bg-[#171717] p-1 rounded-xl border border-[#33302B] text-xs sm:text-sm">
            <button
              type="button"
              onClick={() => setActiveSubTab('PURCHASES')}
              className={`px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-black transition whitespace-nowrap cursor-pointer ${
                activeSubTab === 'PURCHASES'
                  ? 'bg-[#C6A15B] text-[#171717]'
                  : 'text-[#A8A29E] hover:text-[#F7F3EA]'
              }`}
            >
              {t('فواتير الشراء', 'Bons d’achat')}
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('SUPPLIERS')}
              className={`px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-black transition whitespace-nowrap cursor-pointer ${
                activeSubTab === 'SUPPLIERS'
                  ? 'bg-[#C6A15B] text-[#171717]'
                  : 'text-[#A8A29E] hover:text-[#F7F3EA]'
              }`}
            >
              {t('دليل الموردين', 'Fournisseurs')}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={loadAll}
            className="p-2.5 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#A8A29E] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#C6A15B]' : ''}`} />
          </button>

          {activeSubTab === 'PURCHASES' ? (
            <button
              type="button"
              onClick={() => {
                setModalError(null);
                setSelectedSupplierId(suppliers[0]?.id ? String(suppliers[0].id) : '');
                setPurchaseItemsList([]);
                setShowPurchaseModal(true);
              }}
              className="bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-black shadow-lg transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>{t('تسجيل فاتورة شراء', 'Nouvel achat')}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setModalError(null);
                setShowSupplierModal(true);
              }}
              className="bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-black shadow-lg transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>{t('مورد جديد', 'Nouveau fournisseur')}</span>
            </button>
          )}
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

      {/* Main Content */}
      <div className="flex-1 bg-[#222222] rounded-2xl border border-[#33302B] shadow-lg overflow-hidden flex flex-col min-h-0">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 gap-3">
            <div className="w-10 h-10 border-4 border-[#C6A15B] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[#A8A29E] font-bold">{t('جاري التحميل...', 'Chargement...')}</span>
          </div>
        ) : activeSubTab === 'PURCHASES' ? (
          purchases.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-[#A8A29E] gap-2">
              <FileSpreadsheet className="w-12 h-12 text-[#33302B]" />
              <p className="font-black text-[#F7F3EA]">{t('لا توجد فواتير مشتريات مسجلة', 'Aucun achat enregistré')}</p>
            </div>
          ) : (
            <div className="overflow-auto flex-1 no-scrollbar">
              <table className="w-full text-start text-sm">
                <thead className="bg-[#171717] text-[#A8A29E] border-b border-[#33302B] font-black text-xs uppercase sticky top-0">
                  <tr>
                    <th className="p-4">{t('رقم الفاتورة', 'N° Facture')}</th>
                    <th className="p-4">{t('المورد', 'Fournisseur')}</th>
                    <th className="p-4">{t('المبلغ الإجمالي', 'Total (DA)')}</th>
                    <th className="p-4">{t('التاريخ', 'Date')}</th>
                    <th className="p-4">{t('المستلم', 'Reçu par')}</th>
                    <th className="p-4">{t('البنود المشتراة', 'Articles')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#33302B] font-bold">
                  {purchases.map((p) => (
                    <tr key={p.id} className="hover:bg-[#171717]/70 transition">
                      <td className="p-4 font-mono font-black text-[#C6A15B]">{p.purchaseNumber}</td>
                      <td className="p-4 font-black text-[#F7F3EA]">{p.supplierName || '—'}</td>
                      <td className="p-4 font-mono tabular-nums font-black text-[#C6A15B] text-base">
                        {Number(p.totalAmount).toLocaleString()} DA
                      </td>
                      <td className="p-4 font-mono text-[#A8A29E]">{p.invoiceDate}</td>
                      <td className="p-4 text-[#F7F3EA]/80">{p.receivedByName || '—'}</td>
                      <td className="p-4 text-xs text-[#A8A29E]">
                        {p.items?.map((it: any) => `${it.ingredientName || ''}: ${it.quantity}`).join(' • ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : suppliers.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-[#A8A29E] gap-2">
            <Building className="w-12 h-12 text-[#33302B]" />
            <p className="font-black text-[#F7F3EA]">{t('لا يوجد موردين مسجلين', 'Aucun fournisseur enregistré')}</p>
          </div>
        ) : (
          <div className="overflow-auto flex-1 no-scrollbar">
            <table className="w-full text-start text-sm">
              <thead className="bg-[#171717] text-[#A8A29E] border-b border-[#33302B] font-black text-xs uppercase sticky top-0">
                <tr>
                  <th className="p-4">{t('المورد', 'Fournisseur')}</th>
                  <th className="p-4">{t('الشخص المسؤول', 'Contact')}</th>
                  <th className="p-4">{t('الهاتف', 'Téléphone')}</th>
                  <th className="p-4">{t('العنوان', 'Adresse')}</th>
                  <th className="p-4">{t('الرصيد (DA)', 'Solde (DA)')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#33302B] font-bold">
                {suppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-[#171717]/70 transition">
                    <td className="p-4 font-black text-[#F7F3EA]">{s.name}</td>
                    <td className="p-4 text-[#A8A29E]">{s.contactPerson || '—'}</td>
                    <td className="p-4 font-mono text-[#C6A15B]">{s.phone || '—'}</td>
                    <td className="p-4 text-[#A8A29E]">{s.address || '—'}</td>
                    <td className="p-4 font-mono tabular-nums font-black text-[#F7F3EA]">
                      {Number(s.balance).toLocaleString()} DA
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Purchase Modal */}
      {showPurchaseModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA] max-h-[92vh] overflow-y-auto no-scrollbar">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B] flex items-center gap-2">
                <PackageCheck className="w-6 h-6" />
                <span>{t('فاتورة مشتريات جديدة', 'Nouveau bon d’achat')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowPurchaseModal(false)}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm font-bold">
              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('المورد *', 'Fournisseur *')}</label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                >
                  <option value="">{t('-- اختر مورداً --', '-- Sélectionner --')}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('تاريخ الفاتورة', 'Date facture')}</label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono focus:outline-none focus:border-[#C6A15B]"
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-black text-sm text-[#C6A15B]">{t('المواد المشتراة:', 'Articles achetés :')}</span>
                <button
                  type="button"
                  disabled={ingredients.length === 0}
                  onClick={handleAddPurchaseItem}
                  className="bg-[#171717] border border-[#33302B] hover:border-[#C6A15B] disabled:opacity-40 text-[#C6A15B] px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('إضافة مادة', 'Ajouter article')}</span>
                </button>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto no-scrollbar">
                {purchaseItemsList.length === 0 ? (
                  <div className="p-4 text-center text-[#A8A29E] font-bold bg-[#171717] rounded-xl border border-dashed border-[#33302B] text-xs">
                    {t('اضغط "إضافة مادة" لإدراج المواد المشتراة', 'Cliquez sur "Ajouter article"')}
                  </div>
                ) : (
                  purchaseItemsList.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-[#171717] p-2.5 rounded-xl border border-[#33302B]"
                    >
                      <select
                        value={item.ingredientId}
                        onChange={(e) => {
                          const updated = [...purchaseItemsList];
                          updated[idx] = { ...updated[idx], ingredientId: Number(e.target.value) };
                          setPurchaseItemsList(updated);
                        }}
                        className="flex-1 bg-[#222222] border border-[#33302B] rounded-lg p-2 text-[#F7F3EA] font-bold text-xs"
                      >
                        {ingredients.map((ing) => (
                          <option key={ing.id} value={ing.id}>
                            {lang === 'fr' && ing.nameFr ? ing.nameFr : ing.nameAr} ({ing.unit})
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        placeholder={t('الكمية', 'Qté')}
                        value={item.quantity}
                        onChange={(e) => {
                          const updated = [...purchaseItemsList];
                          updated[idx] = { ...updated[idx], quantity: e.target.value };
                          setPurchaseItemsList(updated);
                        }}
                        className="w-20 bg-[#222222] border border-[#33302B] rounded-lg p-2 text-center font-mono tabular-nums font-bold text-xs text-[#F7F3EA]"
                      />

                      <input
                        type="number"
                        placeholder={t('السعر', 'Prix U.')}
                        value={item.unitCost}
                        onChange={(e) => {
                          const updated = [...purchaseItemsList];
                          updated[idx] = { ...updated[idx], unitCost: e.target.value };
                          setPurchaseItemsList(updated);
                        }}
                        className="w-24 bg-[#222222] border border-[#33302B] rounded-lg p-2 text-center font-mono tabular-nums font-black text-xs text-[#C6A15B]"
                      />

                      <button
                        type="button"
                        onClick={() => setPurchaseItemsList(purchaseItemsList.filter((_, i) => i !== idx))}
                        className="p-2 text-rose-400 hover:bg-rose-950/60 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="p-4 bg-[#171717] rounded-2xl border border-[#33302B] flex items-center justify-between">
              <span className="text-sm text-[#A8A29E] font-bold">{t('الإجمالي النهائي:', 'Total facture :')}</span>
              <span className="text-2xl font-black text-[#C6A15B] font-mono tabular-nums">
                {totalPurchaseCalc.toLocaleString()} DA
              </span>
            </div>

            <button
              type="button"
              disabled={isSaving}
              onClick={handleSavePurchase}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl shadow-lg transition cursor-pointer"
            >
              {isSaving ? t('جاري الحفظ...', 'Enregistrement...') : t('تأكيد وإدخال للمخزون', 'Valider et entrer en stock')}
            </button>
          </div>
        </div>
      )}

      {/* Supplier Modal */}
      {showSupplierModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B] flex items-center gap-2">
                <Building className="w-5 h-5" />
                <span>{t('إضافة مورد جديد', 'Nouveau fournisseur')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowSupplierModal(false)}
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
                <label className="block text-[#A8A29E] text-xs mb-1">{t('اسم المؤسسة أو المورد *', 'Nom du fournisseur *')}</label>
                <input
                  type="text"
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الشخص المسؤول', 'Personne de contact')}</label>
                <input
                  type="text"
                  value={supContact}
                  onChange={(e) => setSupContact(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الهاتف', 'Téléphone')}</label>
                <input
                  type="tel"
                  value={supPhone}
                  onChange={(e) => setSupPhone(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('العنوان', 'Adresse')}</label>
                <input
                  type="text"
                  value={supAddress}
                  onChange={(e) => setSupAddress(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={isSaving}
              onClick={handleSaveSupplier}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl shadow-lg cursor-pointer"
            >
              {isSaving ? t('جاري الحفظ...', 'Enregistrement...') : t('حفظ المورد', 'Enregistrer le fournisseur')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
