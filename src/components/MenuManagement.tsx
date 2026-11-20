import React, { useState, useEffect, useMemo } from 'react';
import { Product, Category, Ingredient } from '../types.ts';
import { api } from '../services/api.ts';
import { useLanguage } from '../context/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import {
  UtensilsCrossed,
  Plus,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  History,
  Save,
  X,
  Search,
  AlertCircle,
  CheckCircle2,
  Calculator,
  RefreshCw,
  Upload,
  SlidersHorizontal,
} from 'lucide-react';

interface MenuManagementProps {
  onOpenMenuImport?: () => void;
}

export const MenuManagement: React.FC<MenuManagementProps> = ({ onOpenMenuImport }) => {
  const { lang, t } = useLanguage();
  const { hasRole } = useAuth();
  const canManage = hasRole(['ADMIN', 'MANAGER']);
  const canImportMenu = hasRole(['ADMIN', 'OWNER']);
  const canDeleteCategory = hasRole(['ADMIN']);

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<number | 'ALL'>('ALL');
  const [search, setSearch] = useState<string>('');
  const [showUnavailableOnly, setShowUnavailableOnly] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Product modal
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [isNewProduct, setIsNewProduct] = useState<boolean>(false);
  const [isSavingProduct, setIsSavingProduct] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Category modal (create or edit)
  const [editingCategory, setEditingCategory] = useState<{
    id?: number;
    nameAr: string;
    nameFr: string;
    station: string;
    isActive: boolean;
  } | null>(null);
  const [isSavingCategory, setIsSavingCategory] = useState<boolean>(false);

  // In-app delete/disable confirmation modals (no window.confirm)
  const [confirmDisableProduct, setConfirmDisableProduct] = useState<Product | null>(null);
  const [confirmDisableCategory, setConfirmDisableCategory] = useState<Category | null>(null);

  // Price history modal
  const [priceHistoryProd, setPriceHistoryProd] = useState<Product | null>(null);
  const [priceHistoryList, setPriceHistoryList] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Global Add-ons management modal (empty by default; admin-configured in SQLite)
  const [showAddonsModal, setShowAddonsModal] = useState<boolean>(false);
  const [globalAddons, setGlobalAddons] = useState<any[]>([]);
  const [loadingAddons, setLoadingAddons] = useState<boolean>(false);
  const [newAddonNameAr, setNewAddonNameAr] = useState<string>('');
  const [newAddonNameFr, setNewAddonNameFr] = useState<string>('');
  const [newAddonPrice, setNewAddonPrice] = useState<string>('');
  const [addonFormError, setAddonFormError] = useState<string>('');
  const [savingAddon, setSavingAddon] = useState<boolean>(false);

  const loadGlobalAddons = async () => {
    setLoadingAddons(true);
    try {
      const list = await api.getAddons(true);
      setGlobalAddons(Array.isArray(list) ? list : []);
    } catch {
      setGlobalAddons([]);
    } finally {
      setLoadingAddons(false);
    }
  };

  const handleCreateGlobalAddon = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddonFormError('');
    const parsedPrice = Number(newAddonPrice);
    if (!newAddonNameAr.trim() || !Number.isInteger(parsedPrice) || parsedPrice < 0) {
      setAddonFormError(t('يرجى إدخال اسم الإضافة وسعر صحيح بالدينار (عدد صحيح >= 0)', 'Nom et prix entier (>= 0 DA) requis'));
      return;
    }
    setSavingAddon(true);
    try {
      await api.createAddon({
        productId: null,
        nameAr: newAddonNameAr.trim(),
        nameFr: newAddonNameFr.trim() || undefined,
        price: parsedPrice,
        isActive: true,
      });
      setNewAddonNameAr('');
      setNewAddonNameFr('');
      setNewAddonPrice('');
      await Promise.all([loadGlobalAddons(), loadAll()]);
    } catch (err: any) {
      setAddonFormError(err?.message || t('فشل إضافة الخيار', 'Échec de création'));
    } finally {
      setSavingAddon(false);
    }
  };

  const handleToggleAddonActive = async (addon: any) => {
    try {
      await api.updateAddon(addon.id, { isActive: !addon.isActive });
      await Promise.all([loadGlobalAddons(), loadAll()]);
    } catch {
      // ignore
    }
  };

  const handleDeleteGlobalAddon = async (addonId: number) => {
    try {
      await api.deleteAddon(addonId);
      await Promise.all([loadGlobalAddons(), loadAll()]);
    } catch {
      // ignore
    }
  };

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
      const [cats, prods, ings] = await Promise.all([
        api.getCategories(),
        api.getProducts(),
        api.getInventory().catch(() => []),
      ]);
      setCategories(Array.isArray(cats) ? cats : []);
      setProducts(Array.isArray(prods) ? prods : []);
      setIngredients(Array.isArray(ings) ? ings : []);
    } catch (err: any) {
      setErrorMsg(err?.message || t('فشل تحميل بيانات القائمة', 'Échec du chargement du menu'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleAvailable = async (prod: Product) => {
    if (!canManage) return;
    try {
      await api.toggleProductAvailability(prod.id);
      await loadAll();
      showToast(
        'success',
        prod.isAvailable
          ? t(`تم إيقاف توفر "${prod.nameAr}"`, `"${prod.nameFr || prod.nameAr}" marqué indisponible`)
          : t(`تم تفعيل توفر "${prod.nameAr}"`, `"${prod.nameFr || prod.nameAr}" activé`)
      );
    } catch (err: any) {
      showToast('error', err?.message || t('فشل تغيير حالة التوفر', 'Échec de mise à jour du statut'));
    }
  };

  const handleConfirmDisableProduct = async () => {
    if (!confirmDisableProduct) return;
    try {
      await api.deleteProduct(confirmDisableProduct.id);
      const label = lang === 'fr' && confirmDisableProduct.nameFr ? confirmDisableProduct.nameFr : confirmDisableProduct.nameAr;
      setConfirmDisableProduct(null);
      await loadAll();
      showToast('success', t(`تم تعطيل الطبق "${label}" مع الحفاظ على سجل الفواتير`, `Produit "${label}" désactivé (historique conservé)`));
    } catch (err: any) {
      showToast('error', err?.message || t('فشل تعطيل الطبق', 'Échec de désactivation du produit'));
    }
  };

  const handleConfirmDisableCategory = async () => {
    if (!confirmDisableCategory) return;
    try {
      await api.deleteCategory(confirmDisableCategory.id);
      const label = lang === 'fr' && confirmDisableCategory.nameFr ? confirmDisableCategory.nameFr : confirmDisableCategory.nameAr;
      setConfirmDisableCategory(null);
      if (selectedCatId === confirmDisableCategory.id) setSelectedCatId('ALL');
      await loadAll();
      showToast('success', t(`تم تعطيل الفئة "${label}"`, `Catégorie "${label}" désactivée`));
    } catch (err: any) {
      showToast('error', err?.message || t('فشل تعطيل الفئة', 'Échec de désactivation de la catégorie'));
    }
  };

  const handleViewPriceHistory = async (prod: Product) => {
    setPriceHistoryProd(prod);
    setLoadingHistory(true);
    setPriceHistoryList([]);
    try {
      const hist = await api.getProductPriceHistory(prod.id);
      setPriceHistoryList(Array.isArray(hist) ? hist : []);
    } catch (err: any) {
      showToast('error', err?.message || t('فشل تحميل سجل الأسعار', 'Échec du chargement de l’historique'));
    } finally {
      setLoadingHistory(false);
    }
  };

  const recipeCostTotal = useMemo(() => {
    if (!editingProduct?.recipes || !Array.isArray(editingProduct.recipes)) return 0;
    return editingProduct.recipes.reduce((sum: number, r: any) => {
      const ing = ingredients.find((i) => i.id === Number(r.ingredientId));
      const unitCost = Number(ing?.costPerUnit ?? r.ingredientCostPerUnit ?? 0);
      const qty = Number(r.quantity || 0);
      return sum + (Number.isFinite(unitCost * qty) ? unitCost * qty : 0);
    }, 0);
  }, [editingProduct?.recipes, ingredients]);

  const handleSaveProduct = async () => {
    if (!editingProduct) return;
    setModalError(null);
    const numPrice = parseFloat(editingProduct.price);
    if (!String(editingProduct.nameAr || '').trim() || !Number.isFinite(numPrice) || numPrice < 0 || !editingProduct.categoryId) {
      setModalError(t('يرجى إدخال الاسم بالعربية والسعر الصحيح والفئة', 'Veuillez renseigner le nom, un prix valide et la catégorie'));
      return;
    }

    setIsSavingProduct(true);
    try {
      const payload = {
        nameAr: String(editingProduct.nameAr).trim(),
        nameFr: editingProduct.nameFr ? String(editingProduct.nameFr).trim() : null,
        price: numPrice,
        costPrice: parseFloat(editingProduct.costPrice) || 0,
        categoryId: Number(editingProduct.categoryId),
        station: editingProduct.station || 'MAIN_KITCHEN',
        barcode: editingProduct.barcode ? String(editingProduct.barcode).trim() : undefined,
        isAvailable: editingProduct.isAvailable ?? true,
        reasonForPriceChange: editingProduct.reasonForPriceChange || undefined,
        variants: editingProduct.variants || [],
        addons: editingProduct.addons || [],
        recipes: editingProduct.recipes || [],
      };

      if (isNewProduct) {
        await api.createProduct(payload);
        showToast('success', t('تمت إضافة الطبق بنجاح', 'Produit ajouté avec succès'));
      } else {
        await api.updateProduct(editingProduct.id, payload);
        showToast('success', t('تم تحديث الطبق بنجاح', 'Produit mis à jour avec succès'));
      }
      setEditingProduct(null);
      await loadAll();
    } catch (err: any) {
      setModalError(err?.message || t('فشل حفظ الطبق', 'Échec de l’enregistrement du produit'));
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleSaveCategory = async () => {
    if (!editingCategory) return;
    setModalError(null);
    if (!editingCategory.nameAr.trim()) {
      setModalError(t('اسم الفئة بالعربية مطلوب', 'Le nom arabe de la catégorie est requis'));
      return;
    }
    setIsSavingCategory(true);
    try {
      if (editingCategory.id) {
        await api.updateCategory(editingCategory.id, {
          nameAr: editingCategory.nameAr.trim(),
          nameFr: editingCategory.nameFr.trim() || null,
          station: editingCategory.station,
          isActive: editingCategory.isActive,
        });
        showToast('success', t('تم تحديث الفئة بنجاح', 'Catégorie mise à jour'));
      } else {
        await api.createCategory({
          nameAr: editingCategory.nameAr.trim(),
          nameFr: editingCategory.nameFr.trim() || undefined,
          station: editingCategory.station,
        });
        showToast('success', t('تمت إضافة الفئة بنجاح', 'Catégorie ajoutée'));
      }
      setEditingCategory(null);
      await loadAll();
    } catch (err: any) {
      setModalError(err?.message || t('فشل حفظ الفئة', 'Échec de l’enregistrement de la catégorie'));
    } finally {
      setIsSavingCategory(false);
    }
  };

  const stationLabel = (station: string) => {
    switch (station) {
      case 'GRILL':
        return t('مشاوي وفحم', 'Grillades');
      case 'DESSERT':
        return t('تحلية وحلويات', 'Desserts');
      case 'DRINKS':
        return t('مشروبات', 'Boissons');
      default:
        return t('المطبخ الرئيسي', 'Cuisine Principale');
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchCat = selectedCatId === 'ALL' || p.categoryId === selectedCatId;
    const matchAvail = !showUnavailableOnly || !p.isAvailable;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      p.nameAr.toLowerCase().includes(q) ||
      (p.nameFr && p.nameFr.toLowerCase().includes(q)) ||
      (p.barcode && p.barcode.toLowerCase().includes(q));
    return matchCat && matchAvail && matchSearch;
  });

  const catDisplayName = (c?: Category | null) =>
    !c ? '—' : lang === 'fr' && c.nameFr ? c.nameFr : c.nameAr;

  const prodDisplayName = (p: Product) =>
    lang === 'fr' && p.nameFr ? p.nameFr : p.nameAr;

  return (
    <div className="h-full flex-1 flex flex-col overflow-hidden bg-[#171717] p-2.5 sm:p-4 md:p-5 select-none text-[#F7F3EA] w-full gap-3">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-4 bg-[#222222] p-3 sm:p-4 rounded-2xl border border-[#33302B] shadow-lg shrink-0">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 min-w-0">
          <div className="font-black text-base sm:text-xl text-[#F7F3EA] flex items-center gap-2 sm:pe-3 sm:border-e sm:border-[#33302B] shrink-0">
            <div className="w-9 h-9 rounded-xl bg-[#171717] border border-[#C6A15B]/40 flex items-center justify-center text-[#C6A15B]">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <span className="whitespace-nowrap">{t('الأطباق والأسعار والوصفات', 'Menu, Prix & Recettes')}</span>
          </div>

          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 text-[#A8A29E] absolute start-3 top-2.5 sm:top-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('بحث بالاسم أو الباركود...', 'Rechercher plat ou code...')}
              className="w-full bg-[#171717] border border-[#33302B] rounded-xl ps-9 pe-3 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-[#F7F3EA] placeholder-[#A8A29E]/60 focus:outline-none focus:border-[#C6A15B]"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowUnavailableOnly((v) => !v)}
            className={`px-3 py-1.5 sm:py-2 rounded-xl text-xs font-black border transition cursor-pointer whitespace-nowrap ${
              showUnavailableOnly
                ? 'bg-rose-950/60 border-rose-500/60 text-rose-300'
                : 'bg-[#171717] border-[#33302B] text-[#A8A29E] hover:border-[#C6A15B]'
            }`}
          >
            {t('غير المتوفر فقط', 'Indisponibles uniquement')}
          </button>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0 flex-wrap">
          <button
            type="button"
            onClick={loadAll}
            className="p-2 sm:p-2.5 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#A8A29E] hover:text-[#F7F3EA] cursor-pointer"
            title={t('تحديث', 'Actualiser')}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#C6A15B]' : ''}`} />
          </button>

          {canManage && (
            <>
              {canImportMenu && onOpenMenuImport && (
                <button
                  type="button"
                  onClick={onOpenMenuImport}
                  data-testid="open-menu-import-btn"
                  className="bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl border border-[#33302B] text-xs sm:text-sm font-black transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Upload className="w-4 h-4 text-[#C6A15B]" />
                  <span>{t('استيراد القائمة', 'Importer le menu')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setAddonFormError('');
                  setShowAddonsModal(true);
                  loadGlobalAddons();
                }}
                data-testid="open-addons-manager-btn"
                className="bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl border border-[#33302B] text-xs sm:text-sm font-black transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <SlidersHorizontal className="w-4 h-4 text-[#C6A15B]" />
                <span>{t('الإضافات', 'Suppléments')}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setEditingCategory({ nameAr: '', nameFr: '', station: 'MAIN_KITCHEN', isActive: true });
                }}
                className="bg-[#171717] hover:border-[#C6A15B] text-[#C6A15B] px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl border border-[#33302B] text-xs sm:text-sm font-black transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>{t('فئة جديدة', 'Nouvelle catégorie')}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setIsNewProduct(true);
                  setEditingProduct({
                    nameAr: '',
                    nameFr: '',
                    price: '',
                    costPrice: '0',
                    categoryId: categories[0]?.id || 1,
                    station: 'MAIN_KITCHEN',
                    barcode: '',
                    isAvailable: true,
                    variants: [],
                    addons: [],
                    recipes: [],
                  });
                }}
                className="bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-black shadow-lg transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
                <span>{t('طبق جديد', 'Nouveau plat')}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inline Feedback / Error Banner */}
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
            className="text-current opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Mobile Categories Tabs (< md) */}
      <div className="md:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 shrink-0">
        <button
          type="button"
          onClick={() => setSelectedCatId('ALL')}
          className={`px-3 py-1.5 rounded-xl text-xs font-black transition whitespace-nowrap shrink-0 cursor-pointer ${
            selectedCatId === 'ALL'
              ? 'bg-[#C6A15B] text-[#171717]'
              : 'bg-[#222222] text-[#A8A29E] border border-[#33302B]'
          }`}
        >
          {t('الكل', 'Tout')} ({products.length})
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelectedCatId(c.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 ${
              selectedCatId === c.id
                ? 'bg-[#C6A15B] text-[#171717]'
                : 'bg-[#222222] text-[#F7F3EA] border border-[#33302B]'
            } ${!c.isActive ? 'opacity-50' : ''}`}
          >
            <span>{catDisplayName(c)}</span>
            <span className="font-mono tabular-nums opacity-75">
              ({products.filter((p) => p.categoryId === c.id).length})
            </span>
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex gap-3 sm:gap-4 overflow-hidden min-h-0">
        {/* Categories Sidebar (Desktop >= md) */}
        <div className="hidden md:flex flex-col w-64 lg:w-72 bg-[#222222] rounded-2xl border border-[#33302B] p-3 overflow-y-auto no-scrollbar shrink-0 shadow-lg">
          <div className="font-black text-xs uppercase tracking-wider text-[#C6A15B] px-3 py-2 border-b border-[#33302B] mb-2">
            {t('الفئات (Catégories)', 'Catégories')}
          </div>

          <button
            type="button"
            onClick={() => setSelectedCatId('ALL')}
            className={`w-full text-start px-3.5 py-2.5 rounded-xl text-sm font-black transition mb-1.5 flex items-center justify-between cursor-pointer ${
              selectedCatId === 'ALL'
                ? 'bg-[#C6A15B] text-[#171717]'
                : 'text-[#F7F3EA] hover:bg-[#171717]'
            }`}
          >
            <span>{t('جميع الأطباق', 'Tous les plats')}</span>
            <span className="font-mono tabular-nums text-xs px-2 py-0.5 rounded-lg bg-black/20">
              {products.length}
            </span>
          </button>

          {categories.map((c) => {
            const count = products.filter((p) => p.categoryId === c.id).length;
            const active = selectedCatId === c.id;
            return (
              <div
                key={c.id}
                className={`group rounded-xl mb-1.5 transition flex items-center justify-between border ${
                  active
                    ? 'bg-[#C6A15B] text-[#171717] border-[#C6A15B]'
                    : 'bg-[#171717]/60 text-[#F7F3EA] border-[#33302B]/70 hover:border-[#C6A15B]/50'
                } ${!c.isActive ? 'opacity-50' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedCatId(c.id)}
                  className="flex-1 text-start px-3 py-2.5 text-sm font-black flex items-center justify-between min-w-0 cursor-pointer"
                >
                  <span className="truncate">{catDisplayName(c)}</span>
                  <span className="text-xs font-mono tabular-nums px-1.5 py-0.5 rounded bg-black/20 shrink-0 ms-1">
                    {count}
                  </span>
                </button>
                {canManage && (
                  <div className="flex items-center pe-1.5 gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setModalError(null);
                        setEditingCategory({
                          id: c.id,
                          nameAr: c.nameAr,
                          nameFr: c.nameFr || '',
                          station: c.station || 'MAIN_KITCHEN',
                          isActive: Boolean(c.isActive),
                        });
                      }}
                      className={`p-1.5 rounded-lg transition cursor-pointer ${
                        active ? 'hover:bg-black/15 text-[#171717]' : 'hover:bg-[#222222] text-[#A8A29E] hover:text-[#C6A15B]'
                      }`}
                      title={t('تعديل الفئة', 'Modifier catégorie')}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {canDeleteCategory && c.isActive && (
                      <button
                        type="button"
                        onClick={() => setConfirmDisableCategory(c)}
                        className={`p-1.5 rounded-lg transition cursor-pointer ${
                          active ? 'hover:bg-black/15 text-[#171717]' : 'hover:bg-rose-950/60 text-[#A8A29E] hover:text-rose-400'
                        }`}
                        title={t('تعطيل الفئة', 'Désactiver catégorie')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Products Container */}
        <div className="flex-1 bg-[#222222] rounded-2xl border border-[#33302B] overflow-hidden flex flex-col shadow-lg min-h-0">
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#C6A15B] p-8">
              <div className="w-10 h-10 border-4 border-[#C6A15B] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-bold text-[#A8A29E]">{t('جاري تحميل القائمة...', 'Chargement du menu...')}</span>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[#A8A29E] p-8">
              <UtensilsCrossed className="w-12 h-12 text-[#33302B]" />
              <p className="font-black text-base text-[#F7F3EA]">
                {t('لا توجد أطباق مطابقة', 'Aucun produit trouvé')}
              </p>
              <p className="text-xs">{t('جرّب تغيير الفئة أو كلمات البحث', 'Essayez une autre catégorie ou recherche')}</p>
            </div>
          ) : (
            <>
              {/* Mobile Card List View (< md) */}
              <div className="md:hidden flex-1 overflow-y-auto p-2.5 space-y-2 no-scrollbar">
                {filteredProducts.map((p) => {
                  const price = Number(p.price || 0);
                  const cost = Number(p.costPrice || 0);
                  const margin = price - cost;
                  const marginPct = price > 0 ? Math.round((margin / price) * 100) : 0;
                  const catObj = categories.find((c) => c.id === p.categoryId);
                  return (
                    <div key={p.id} className="bg-[#171717] p-3 rounded-xl border border-[#33302B] space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-black text-sm text-[#F7F3EA]">{prodDisplayName(p)}</div>
                          {p.nameFr && p.nameAr && (
                            <div className="text-[11px] text-[#A8A29E]">
                              {lang === 'fr' ? p.nameAr : p.nameFr}
                            </div>
                          )}
                          <div className="text-[11px] text-[#A8A29E] font-bold mt-0.5">
                            {catDisplayName(catObj)} • {stationLabel(p.station)}
                          </div>
                        </div>
                        <div className="text-end shrink-0">
                          <span className="font-black text-[#C6A15B] text-base block font-mono tabular-nums">
                            {price.toLocaleString()} DA
                          </span>
                          <button
                            type="button"
                            disabled={!canManage}
                            onClick={() => handleToggleAvailable(p)}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-black inline-flex items-center gap-1 cursor-pointer ${
                              p.isAvailable
                                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-600/50'
                                : 'bg-rose-950/60 text-rose-300 border border-rose-600/50'
                            }`}
                          >
                            {p.isAvailable ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                            <span>{p.isAvailable ? t('متوفر', 'Dispo') : t('غير متوفر', 'Indispo')}</span>
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-[#33302B] text-xs">
                        <span className="text-[#A8A29E] font-mono tabular-nums text-[11px]">
                          {t('التكلفة:', 'Coût:')} {cost.toLocaleString()} DA •{' '}
                          <span className={margin >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {t('الهامش:', 'Marge:')} {margin.toLocaleString()} DA ({marginPct}%)
                          </span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleViewPriceHistory(p)}
                            className="p-1.5 rounded-lg bg-[#222222] border border-[#33302B] text-[#C6A15B] cursor-pointer"
                            title={t('سجل الأسعار', 'Historique prix')}
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setModalError(null);
                                  setIsNewProduct(false);
                                  setEditingProduct({
                                    ...p,
                                    variants: p.variants || [],
                                    addons: p.addons || [],
                                    recipes: p.recipes || [],
                                  });
                                }}
                                className="p-1.5 rounded-lg bg-[#222222] border border-[#33302B] text-[#F7F3EA] hover:border-[#C6A15B] cursor-pointer"
                                title={t('تعديل', 'Modifier')}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDisableProduct(p)}
                                className="p-1.5 rounded-lg bg-rose-950/40 border border-rose-700/50 text-rose-400 cursor-pointer"
                                title={t('تعطيل', 'Désactiver')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table View (>= md) */}
              <div className="hidden md:block overflow-auto flex-1 no-scrollbar">
                <table className="w-full text-start text-sm">
                  <thead className="bg-[#171717] text-[#A8A29E] border-b border-[#33302B] font-black text-xs uppercase sticky top-0 z-10">
                    <tr>
                      <th className="p-3.5">{t('الطبق', 'Plat')}</th>
                      <th className="p-3.5">{t('الفئة', 'Catégorie')}</th>
                      <th className="p-3.5">{t('سعر البيع', 'Prix vente')}</th>
                      <th className="p-3.5">{t('التكلفة / الهامش', 'Coût / Marge')}</th>
                      <th className="p-3.5">{t('المحطة', 'Station')}</th>
                      <th className="p-3.5">{t('الحالة', 'Statut')}</th>
                      <th className="p-3.5 text-center">{t('إجراءات', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#33302B] font-bold">
                    {filteredProducts.map((p) => {
                      const price = Number(p.price || 0);
                      const cost = Number(p.costPrice || 0);
                      const margin = price - cost;
                      const marginPct = price > 0 ? Math.round((margin / price) * 100) : 0;
                      const catObj = categories.find((c) => c.id === p.categoryId);
                      return (
                        <tr key={p.id} className="hover:bg-[#171717]/70 transition">
                          <td className="p-3.5">
                            <div className="font-black text-base text-[#F7F3EA]">{prodDisplayName(p)}</div>
                            {p.nameFr && p.nameAr && (
                              <div className="text-xs text-[#A8A29E]">{lang === 'fr' ? p.nameAr : p.nameFr}</div>
                            )}
                            {p.barcode && <div className="text-[11px] text-[#A8A29E]/70 font-mono">#{p.barcode}</div>}
                          </td>
                          <td className="p-3.5 text-[#F7F3EA]/90">{catDisplayName(catObj)}</td>
                          <td className="p-3.5 font-black text-[#C6A15B] text-lg font-mono tabular-nums">
                            {price.toLocaleString()} DA
                          </td>
                          <td className="p-3.5 font-mono tabular-nums">
                            <div className="text-xs text-[#A8A29E]">{cost.toLocaleString()} DA</div>
                            <div className={`text-xs font-black ${margin >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              +{margin.toLocaleString()} DA ({marginPct}%)
                            </div>
                          </td>
                          <td className="p-3.5">
                            <span className="text-xs bg-[#171717] text-[#F7F3EA] px-2.5 py-1 rounded-lg border border-[#33302B]">
                              {stationLabel(p.station)}
                            </span>
                          </td>
                          <td className="p-3.5">
                            <button
                              type="button"
                              disabled={!canManage}
                              onClick={() => handleToggleAvailable(p)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-black transition flex items-center gap-1.5 cursor-pointer border ${
                                p.isAvailable
                                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-600/50 hover:bg-emerald-950'
                                  : 'bg-rose-950/60 text-rose-300 border-rose-600/50 hover:bg-rose-950'
                              }`}
                            >
                              {p.isAvailable ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                              <span>{p.isAvailable ? t('متوفر', 'Disponible') : t('غير متوفر', 'Indisponible')}</span>
                            </button>
                          </td>
                          <td className="p-3.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleViewPriceHistory(p)}
                                className="p-2 rounded-xl bg-[#171717] hover:border-[#C6A15B] text-[#C6A15B] border border-[#33302B] cursor-pointer"
                                title={t('سجل تعديلات السعر', 'Historique des prix')}
                              >
                                <History className="w-4 h-4" />
                              </button>
                              {canManage && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setModalError(null);
                                      setIsNewProduct(false);
                                      setEditingProduct({
                                        ...p,
                                        variants: p.variants || [],
                                        addons: p.addons || [],
                                        recipes: p.recipes || [],
                                      });
                                    }}
                                    className="p-2 rounded-xl bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] border border-[#33302B] cursor-pointer"
                                    title={t('تعديل', 'Modifier')}
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDisableProduct(p)}
                                    className="p-2 rounded-xl bg-rose-950/40 hover:bg-rose-950 text-rose-400 border border-rose-700/50 cursor-pointer"
                                    title={t('تعطيل الطبق', 'Désactiver')}
                                  >
                                    <Trash2 className="w-4 h-4" />
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
      </div>

      {/* Product Edit / Add Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-2xl w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto no-scrollbar text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B]">
                {isNewProduct
                  ? t('إضافة طبق جديد', 'Nouveau plat')
                  : t(`تعديل: ${editingProduct.nameAr}`, `Modifier : ${editingProduct.nameFr || editingProduct.nameAr}`)}
              </h3>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] hover:text-[#F7F3EA] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-600/60 text-rose-200 text-xs font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm font-bold">
              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الاسم بالعربية *', 'Nom en arabe *')}</label>
                <input
                  type="text"
                  value={editingProduct.nameAr || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, nameAr: e.target.value })}
                  placeholder="شواء مشكل فاخر"
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الاسم بالفرنسية', 'Nom en français')}</label>
                <input
                  type="text"
                  value={editingProduct.nameFr || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, nameFr: e.target.value })}
                  placeholder="Grillade Mixte"
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('سعر البيع (DA) *', 'Prix de vente (DA) *')}</label>
                <input
                  type="number"
                  value={editingProduct.price || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, price: e.target.value })}
                  placeholder="1400"
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#C6A15B] font-mono tabular-nums font-black text-lg focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[#A8A29E] text-xs">{t('تكلفة الإنتاج (DA)', 'Coût de revient (DA)')}</label>
                  {recipeCostTotal > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditingProduct({
                          ...editingProduct,
                          costPrice: String(Math.round(recipeCostTotal * 100) / 100),
                        })
                      }
                      className="text-[11px] text-[#C6A15B] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Calculator className="w-3 h-3" />
                      <span>
                        {t('تطبيق تكلفة الوصفة:', 'Appliquer coût recette :')} {Math.round(recipeCostTotal)} DA
                      </span>
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  value={editingProduct.costPrice ?? '0'}
                  onChange={(e) => setEditingProduct({ ...editingProduct, costPrice: e.target.value })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono tabular-nums focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الفئة *', 'Catégorie *')}</label>
                <select
                  value={editingProduct.categoryId || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, categoryId: Number(e.target.value) })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black focus:outline-none focus:border-[#C6A15B]"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {catDisplayName(c)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('محطة التحضير', 'Station de préparation')}</label>
                <select
                  value={editingProduct.station || 'MAIN_KITCHEN'}
                  onChange={(e) => setEditingProduct({ ...editingProduct, station: e.target.value })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black focus:outline-none focus:border-[#C6A15B]"
                >
                  <option value="MAIN_KITCHEN">{t('المطبخ الرئيسي', 'Cuisine Principale')}</option>
                  <option value="GRILL">{t('مشاوي وفحم', 'Grillades')}</option>
                  <option value="DESSERT">{t('تحلية وحلويات', 'Desserts')}</option>
                  <option value="DRINKS">{t('مشروبات وبار', 'Boissons & Bar')}</option>
                </select>
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الباركود', 'Code-barres')}</label>
                <input
                  type="text"
                  value={editingProduct.barcode || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, barcode: e.target.value })}
                  placeholder="GP-GRL-01"
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              {!isNewProduct && (
                <div>
                  <label className="block text-[#A8A29E] text-xs mb-1">{t('سبب تعديل السعر', 'Motif changement prix')}</label>
                  <input
                    type="text"
                    value={editingProduct.reasonForPriceChange || ''}
                    onChange={(e) => setEditingProduct({ ...editingProduct, reasonForPriceChange: e.target.value })}
                    placeholder={t('تعديل أسعار الموردين...', 'Mise à jour tarif...')}
                    className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                  />
                </div>
              )}
            </div>

            {/* Recipe Ingredients Linking Section */}
            <div className="pt-3 border-t border-[#33302B] space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-black text-sm text-[#C6A15B]">
                  {t('مكونات الوصفة وخصم المخزون:', 'Recette & déduction de stock :')}
                </span>
                <button
                  type="button"
                  disabled={ingredients.length === 0}
                  onClick={() => {
                    const currentRecipes = editingProduct.recipes || [];
                    setEditingProduct({
                      ...editingProduct,
                      recipes: [...currentRecipes, { ingredientId: ingredients[0]?.id || 1, quantity: '0.100' }],
                    });
                  }}
                  className="bg-[#171717] hover:border-[#C6A15B] disabled:opacity-40 text-[#F7F3EA] border border-[#33302B] px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer"
                >
                  + {t('إضافة مكون للوصفة', 'Ajouter ingrédient')}
                </button>
              </div>

              <div className="space-y-2 max-h-40 overflow-y-auto no-scrollbar">
                {editingProduct.recipes?.map((r: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2 bg-[#171717] p-2 rounded-xl border border-[#33302B]">
                    <select
                      value={r.ingredientId}
                      onChange={(e) => {
                        const updated = [...editingProduct.recipes];
                        updated[idx] = { ...updated[idx], ingredientId: Number(e.target.value) };
                        setEditingProduct({ ...editingProduct, recipes: updated });
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
                      step="0.001"
                      value={r.quantity}
                      onChange={(e) => {
                        const updated = [...editingProduct.recipes];
                        updated[idx] = { ...updated[idx], quantity: e.target.value };
                        setEditingProduct({ ...editingProduct, recipes: updated });
                      }}
                      className="w-24 bg-[#222222] border border-[#33302B] rounded-lg p-2 text-center font-mono tabular-nums text-xs text-[#C6A15B] font-black"
                    />

                    <button
                      type="button"
                      onClick={() => {
                        const updated = editingProduct.recipes.filter((_: any, i: number) => i !== idx);
                        setEditingProduct({ ...editingProduct, recipes: updated });
                      }}
                      className="p-1.5 text-rose-400 hover:bg-rose-950/60 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Product Variants (Sizes) */}
            <div className="pt-3 border-t border-[#33302B] space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-black text-sm text-[#C6A15B]">{t('الأحجام والمتغيرات:', 'Tailles & Variantes :')}</span>
                <button
                  type="button"
                  onClick={() => {
                    const cur = editingProduct.variants || [];
                    setEditingProduct({
                      ...editingProduct,
                      variants: [...cur, { nameAr: 'حجم كبير XL', nameFr: 'Taille XL', priceAdjustment: '0' }],
                    });
                  }}
                  className="bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] border border-[#33302B] px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer"
                >
                  + {t('إضافة حجم', 'Ajouter variante')}
                </button>
              </div>

              <div className="space-y-2 max-h-36 overflow-y-auto no-scrollbar">
                {editingProduct.variants?.map((v: any, idx: number) => (
                  <div key={idx} className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-[#171717] p-2 rounded-xl border border-[#33302B]">
                    <input
                      type="text"
                      placeholder={t('الاسم (AR)', 'Nom (AR)')}
                      value={v.nameAr || ''}
                      onChange={(e) => {
                        const updated = [...editingProduct.variants];
                        updated[idx] = { ...updated[idx], nameAr: e.target.value };
                        setEditingProduct({ ...editingProduct, variants: updated });
                      }}
                      className="flex-1 min-w-[120px] bg-[#222222] border border-[#33302B] rounded-lg p-2 text-[#F7F3EA] text-xs font-bold"
                    />
                    <input
                      type="text"
                      placeholder="Nom (FR)"
                      value={v.nameFr || ''}
                      onChange={(e) => {
                        const updated = [...editingProduct.variants];
                        updated[idx] = { ...updated[idx], nameFr: e.target.value };
                        setEditingProduct({ ...editingProduct, variants: updated });
                      }}
                      className="flex-1 min-w-[110px] bg-[#222222] border border-[#33302B] rounded-lg p-2 text-[#F7F3EA] text-xs"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={v.priceAdjustment ?? '0'}
                        onChange={(e) => {
                          const updated = [...editingProduct.variants];
                          updated[idx] = { ...updated[idx], priceAdjustment: e.target.value };
                          setEditingProduct({ ...editingProduct, variants: updated });
                        }}
                        className="w-20 bg-[#222222] border border-[#33302B] rounded-lg p-2 text-center font-mono tabular-nums text-xs text-[#C6A15B] font-black"
                      />
                      <span className="text-[11px] text-[#A8A29E]">DA</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = editingProduct.variants.filter((_: any, i: number) => i !== idx);
                        setEditingProduct({ ...editingProduct, variants: updated });
                      }}
                      className="p-1.5 text-rose-400 hover:bg-rose-950/60 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Product Addons */}
            <div className="pt-3 border-t border-[#33302B] space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-black text-sm text-[#C6A15B]">{t('الإضافات الاختيارية:', 'Suppléments :')}</span>
                <button
                  type="button"
                  onClick={() => {
                    const cur = editingProduct.addons || [];
                    setEditingProduct({
                      ...editingProduct,
                      addons: [...cur, { nameAr: 'إضافة فرماج', nameFr: 'Supplément Fromage', price: '100' }],
                    });
                  }}
                  className="bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] border border-[#33302B] px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer"
                >
                  + {t('إضافة خيار', 'Ajouter supplément')}
                </button>
              </div>

              <div className="space-y-2 max-h-36 overflow-y-auto no-scrollbar">
                {editingProduct.addons?.map((a: any, idx: number) => (
                  <div key={idx} className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-[#171717] p-2 rounded-xl border border-[#33302B]">
                    <input
                      type="text"
                      placeholder={t('الاسم (AR)', 'Nom (AR)')}
                      value={a.nameAr || ''}
                      onChange={(e) => {
                        const updated = [...editingProduct.addons];
                        updated[idx] = { ...updated[idx], nameAr: e.target.value };
                        setEditingProduct({ ...editingProduct, addons: updated });
                      }}
                      className="flex-1 min-w-[120px] bg-[#222222] border border-[#33302B] rounded-lg p-2 text-[#F7F3EA] text-xs font-bold"
                    />
                    <input
                      type="text"
                      placeholder="Nom (FR)"
                      value={a.nameFr || ''}
                      onChange={(e) => {
                        const updated = [...editingProduct.addons];
                        updated[idx] = { ...updated[idx], nameFr: e.target.value };
                        setEditingProduct({ ...editingProduct, addons: updated });
                      }}
                      className="flex-1 min-w-[110px] bg-[#222222] border border-[#33302B] rounded-lg p-2 text-[#F7F3EA] text-xs"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={a.price ?? '0'}
                        onChange={(e) => {
                          const updated = [...editingProduct.addons];
                          updated[idx] = { ...updated[idx], price: e.target.value };
                          setEditingProduct({ ...editingProduct, addons: updated });
                        }}
                        className="w-20 bg-[#222222] border border-[#33302B] rounded-lg p-2 text-center font-mono tabular-nums text-xs text-[#C6A15B] font-black"
                      />
                      <span className="text-[11px] text-[#A8A29E]">DA</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = editingProduct.addons.filter((_: any, i: number) => i !== idx);
                        setEditingProduct({ ...editingProduct, addons: updated });
                      }}
                      className="p-1.5 text-rose-400 hover:bg-rose-950/60 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              disabled={isSavingProduct}
              onClick={handleSaveProduct}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl shadow-xl transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Save className="w-5 h-5" />
              <span>{isSavingProduct ? t('جاري الحفظ...', 'Enregistrement...') : t('حفظ الطبق', 'Enregistrer le plat')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Category Create / Edit Modal */}
      {editingCategory && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-xl text-[#C6A15B]">
                {editingCategory.id ? t('تعديل الفئة', 'Modifier la catégorie') : t('إضافة فئة جديدة', 'Nouvelle catégorie')}
              </h3>
              <button
                type="button"
                onClick={() => setEditingCategory(null)}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] hover:text-[#F7F3EA] cursor-pointer"
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
                <label className="block text-[#A8A29E] text-xs mb-1">{t('اسم الفئة بالعربية *', 'Nom en arabe *')}</label>
                <input
                  type="text"
                  value={editingCategory.nameAr}
                  onChange={(e) => setEditingCategory({ ...editingCategory, nameAr: e.target.value })}
                  placeholder="مأكولات بحرية"
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('الاسم بالفرنسية', 'Nom en français')}</label>
                <input
                  type="text"
                  value={editingCategory.nameFr}
                  onChange={(e) => setEditingCategory({ ...editingCategory, nameFr: e.target.value })}
                  placeholder="Poissons & Fruits de mer"
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('المحطة الموجهة لها', 'Station')}</label>
                <select
                  value={editingCategory.station}
                  onChange={(e) => setEditingCategory({ ...editingCategory, station: e.target.value })}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black focus:outline-none focus:border-[#C6A15B]"
                >
                  <option value="MAIN_KITCHEN">{t('المطبخ الرئيسي', 'Cuisine Principale')}</option>
                  <option value="GRILL">{t('مشاوي وفحم', 'Grillades')}</option>
                  <option value="DESSERT">{t('تحلية وحلويات', 'Desserts')}</option>
                  <option value="DRINKS">{t('مشروبات', 'Boissons')}</option>
                </select>
              </div>

              {editingCategory.id && (
                <label className="flex items-center gap-2.5 bg-[#171717] border border-[#33302B] rounded-xl p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingCategory.isActive}
                    onChange={(e) => setEditingCategory({ ...editingCategory, isActive: e.target.checked })}
                    className="accent-[#C6A15B] w-4 h-4"
                  />
                  <span className="text-xs font-bold text-[#F7F3EA]">{t('الفئة مفعّلة في شاشة البيع', 'Catégorie active sur la caisse')}</span>
                </label>
              )}
            </div>

            <button
              type="button"
              disabled={isSavingCategory}
              onClick={handleSaveCategory}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl shadow-xl cursor-pointer"
            >
              {isSavingCategory ? t('جاري الحفظ...', 'Enregistrement...') : t('حفظ الفئة', 'Enregistrer la catégorie')}
            </button>
          </div>
        </div>
      )}

      {/* Confirm Disable Product Modal */}
      {confirmDisableProduct && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-rose-600/50 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <h3 className="font-black text-lg text-rose-400">
              {t('تأكيد تعطيل الطبق', 'Confirmer la désactivation')}
            </h3>
            <p className="text-sm text-[#A8A29E] leading-relaxed">
              {t(
                `سيتم إيقاف "${confirmDisableProduct.nameAr}" من القائمة ولن يتم مسح بياناته من الفواتير والتقارير التاريخية.`,
                `"${confirmDisableProduct.nameFr || confirmDisableProduct.nameAr}" sera retiré du menu sans affecter les factures historiques.`
              )}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDisableProduct(null)}
                className="px-4 py-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#F7F3EA] text-xs font-bold cursor-pointer"
              >
                {t('إلغاء', 'Annuler')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDisableProduct}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black cursor-pointer"
              >
                {t('تأكيد التعطيل', 'Désactiver')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Disable Category Modal */}
      {confirmDisableCategory && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-rose-600/50 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <h3 className="font-black text-lg text-rose-400">
              {t('تأكيد تعطيل الفئة', 'Confirmer la désactivation')}
            </h3>
            <p className="text-sm text-[#A8A29E] leading-relaxed">
              {t(
                `هل تريد تعطيل الفئة "${confirmDisableCategory.nameAr}"؟ لن تُحذف الفواتير السابقة.`,
                `Désactiver la catégorie "${confirmDisableCategory.nameFr || confirmDisableCategory.nameAr}" ? L'historique reste intact.`
              )}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDisableCategory(null)}
                className="px-4 py-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#F7F3EA] text-xs font-bold cursor-pointer"
              >
                {t('إلغاء', 'Annuler')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDisableCategory}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black cursor-pointer"
              >
                {t('تأكيد التعطيل', 'Désactiver')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price History Audit Modal */}
      {priceHistoryProd && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <div>
                <h3 className="font-black text-lg text-[#F7F3EA]">{t('سجل تعديلات السعر:', 'Historique des prix :')}</h3>
                <p className="text-sm text-[#C6A15B] font-black">{prodDisplayName(priceHistoryProd)}</p>
              </div>
              <button
                type="button"
                onClick={() => setPriceHistoryProd(null)}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5 max-h-64 overflow-y-auto no-scrollbar">
              {loadingHistory ? (
                <div className="text-center py-8 text-xs text-[#A8A29E]">{t('جاري التحميل...', 'Chargement...')}</div>
              ) : priceHistoryList.length === 0 ? (
                <p className="text-center text-sm font-bold text-[#A8A29E] py-8">
                  {t('لم يتم تغيير سعر هذا الطبق من قبل', 'Aucun changement de prix enregistré')}
                </p>
              ) : (
                priceHistoryList.map((h, i) => (
                  <div key={i} className="bg-[#171717] p-3.5 rounded-2xl border border-[#33302B] text-sm">
                    <div className="flex items-center justify-between">
                      <div className="font-black font-mono tabular-nums">
                        <span className="line-through text-rose-400">{Number(h.oldPrice)} DA</span>
                        <span className="mx-2 text-[#A8A29E]">→</span>
                        <span className="text-[#C6A15B]">{Number(h.newPrice)} DA</span>
                      </div>
                      <span className="text-xs text-[#A8A29E] font-mono">
                        {new Date(h.changedAt).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                    {h.reason && <p className="text-xs text-[#F7F3EA] mt-1 font-bold">{h.reason}</p>}
                    <p className="text-[11px] text-[#A8A29E] mt-0.5">{h.changedBy || 'Admin'}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Global Add-ons Management Modal (Empty by default; Admin-configured) */}
      {showAddonsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <div>
                <h3 className="font-black text-lg text-[#F7F3EA]">
                  {t('إدارة الإضافات والخيارات المخصصة', 'Gestion des Suppléments & Options')}
                </h3>
                <p className="text-xs text-[#A8A29E] mt-0.5">
                  {t(
                    'القائمة فارغة افتراضياً؛ يمكنك إضافة إضافات عامة وتسعيرها بالدينار لتظهر عند الطلب.',
                    'Liste vide par défaut ; ajoutez vos suppléments et tarifs en DA.'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddonsModal(false)}
                className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateGlobalAddon} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <input
                type="text"
                value={newAddonNameAr}
                onChange={(e) => setNewAddonNameAr(e.target.value)}
                placeholder={t('اسم الإضافة بالعربية (مثال: جبن إضافي)', 'Nom arabe')}
                className="sm:col-span-5 bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2 text-xs font-bold text-[#F7F3EA]"
              />
              <input
                type="text"
                value={newAddonNameFr}
                onChange={(e) => setNewAddonNameFr(e.target.value)}
                placeholder={t('الاسم بالفرنسية (اختياري)', 'Nom français')}
                className="sm:col-span-4 bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2 text-xs font-bold text-[#F7F3EA]"
              />
              <input
                type="number"
                min="0"
                step="1"
                value={newAddonPrice}
                onChange={(e) => setNewAddonPrice(e.target.value)}
                placeholder="DA"
                className="sm:col-span-3 bg-[#171717] border border-[#33302B] rounded-xl px-3 py-2 text-xs font-mono font-bold text-[#C6A15B]"
              />
              {addonFormError && (
                <div className="sm:col-span-12 text-xs text-rose-400 font-bold">{addonFormError}</div>
              )}
              <button
                type="submit"
                disabled={savingAddon}
                className="sm:col-span-12 py-2.5 rounded-xl bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] font-black text-xs cursor-pointer transition"
              >
                {savingAddon ? t('جاري الحفظ...', 'Enregistrement...') : t('إضافة خيار جديد', 'Ajouter le supplément')}
              </button>
            </form>

            <div className="space-y-2 max-h-64 overflow-y-auto no-scrollbar pt-2 border-t border-[#33302B]">
              {loadingAddons ? (
                <div className="text-center py-6 text-xs text-[#A8A29E]">{t('جاري التحميل...', 'Chargement...')}</div>
              ) : globalAddons.length === 0 ? (
                <div className="text-center py-6 text-xs text-[#8E8882]">
                  {t('لا توجد إضافات مُسجّلة حالياً (قائمة فارغة افتراضياً).', 'Aucun supplément configuré.')}
                </div>
              ) : (
                globalAddons.map((addon) => (
                  <div
                    key={addon.id}
                    className="bg-[#171717] border border-[#33302B] rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-bold text-[#F7F3EA]">{addon.nameAr}</div>
                      {addon.nameFr && <div className="text-[11px] text-[#A8A29E]">{addon.nameFr}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[#C6A15B]">{Number(addon.price)} DA</span>
                      <button
                        type="button"
                        onClick={() => handleToggleAddonActive(addon)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                          addon.isActive !== false
                            ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-700/50'
                            : 'bg-neutral-800 text-[#A8A29E] border border-[#33302B]'
                        }`}
                      >
                        {addon.isActive !== false ? t('مفعّل', 'Actif') : t('معطّل', 'Inactif')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteGlobalAddon(addon.id)}
                        className="p-1.5 rounded-lg bg-rose-950/50 text-rose-300 hover:bg-rose-900/60 cursor-pointer"
                        title={t('حذف', 'Supprimer')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
