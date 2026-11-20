import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { useLanguage } from '../context/LanguageContext.tsx';
import { usePos } from '../context/PosContext.tsx';
import {
  Upload,
  FileSpreadsheet,
  FileJson,
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  Database,
  History,
  RefreshCw,
  ArrowRight,
  Layers,
  Copy,
} from 'lucide-react';

interface PreviewCategory {
  nameAr: string;
  nameFr?: string | null;
  sortOrder: number;
  station: string;
  productCount: number;
  isNew: boolean;
}

interface PreviewProduct {
  rowNumber: number;
  sku?: string | null;
  categoryAr: string;
  categoryFr?: string | null;
  subcategoryAr?: string | null;
  subcategoryFr?: string | null;
  nameAr: string;
  nameFr?: string | null;
  price: number;
  station: string;
  variants: { nameAr: string; nameFr?: string | null; price: number; sku?: string | null }[];
}

interface PreviewDuplicate {
  rowNumber: number;
  categoryAr: string;
  nameAr: string;
  reason: 'DUPLICATE_IN_FILE' | 'ALREADY_EXISTS_IN_DB';
  message: string;
}

interface PreviewError {
  rowNumber: number;
  field: string;
  value: string;
  message: string;
}

interface MenuImportPreview {
  filename: string;
  fileFormat: 'CSV' | 'XLSX' | 'JSON';
  canImport: boolean;
  categoriesCount: number;
  newCategoriesCount: number;
  subcategoriesCount: number;
  productsCount: number;
  variantsCount: number;
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
  categories: PreviewCategory[];
  validItems: PreviewProduct[];
  duplicates: PreviewDuplicate[];
  errors: PreviewError[];
}

interface MenuImportCommitReport {
  success: boolean;
  importId: number;
  filename: string;
  fileFormat: 'CSV' | 'XLSX' | 'JSON';
  status: string;
  backup: {
    filename: string;
    filePath: string;
    sizeBytes: number;
    integrityCheck: string;
  };
  inserted: {
    categories: number;
    products: number;
    variants: number;
  };
  skippedDuplicates: number;
  totalsInDatabase: {
    categories: number;
    products: number;
    variants: number;
  };
  verification: {
    integrityCheck: string;
    foreignKeyViolations: number;
    verified: boolean;
  };
  createdAt: string;
}

interface ImportHistoryEntry {
  id: number;
  filename: string;
  fileFormat: string;
  categoriesCount: number;
  productsCount: number;
  variantsCount: number;
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
  status: string;
  backupFilename?: string | null;
  createdAt?: string | null;
}

interface MenuImportViewProps {
  onBackToMenu?: () => void;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export const MenuImportView: React.FC<MenuImportViewProps> = ({ onBackToMenu }) => {
  const { t, isRtl } = useLanguage();
  const { refreshCatalog } = usePos();

  const [selectedFile, setSelectedFile] = useState<{
    filename: string;
    format: 'CSV' | 'XLSX' | 'JSON';
    content?: string;
    contentBase64?: string;
    sizeBytes: number;
  } | null>(null);

  const [preview, setPreview] = useState<MenuImportPreview | null>(null);
  const [previewTab, setPreviewTab] = useState<'products' | 'categories' | 'duplicates' | 'errors'>('products');
  const [confirmed, setConfirmed] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [commitReport, setCommitReport] = useState<MenuImportCommitReport | null>(null);
  const [history, setHistory] = useState<ImportHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const rows = await api.getMenuImportHistory(20);
      setHistory(Array.isArray(rows) ? rows : []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleFileSelected = async (file: File | null) => {
    if (!file) return;
    setErrorMsg('');
    setCommitReport(null);
    setPreview(null);
    setConfirmed(false);

    const lowerName = file.name.toLowerCase();
    let format: 'CSV' | 'XLSX' | 'JSON';
    if (lowerName.endsWith('.json')) format = 'JSON';
    else if (lowerName.endsWith('.xlsx')) format = 'XLSX';
    else if (lowerName.endsWith('.csv')) format = 'CSV';
    else {
      setErrorMsg(
        t(
          'صيغة الملف غير مدعومة. يرجى اختيار ملف CSV أو Excel (XLSX) أو JSON.',
          'Format non pris en charge. Veuillez choisir un fichier CSV, Excel (XLSX) ou JSON.'
        )
      );
      return;
    }

    setIsParsing(true);
    try {
      let payload: {
        filename: string;
        format: 'CSV' | 'XLSX' | 'JSON';
        content?: string;
        contentBase64?: string;
      };

      if (format === 'XLSX') {
        const ab = await file.arrayBuffer();
        payload = {
          filename: file.name,
          format,
          contentBase64: arrayBufferToBase64(ab),
        };
      } else {
        const text = await file.text();
        payload = {
          filename: file.name,
          format,
          content: text,
        };
      }

      setSelectedFile({
        ...payload,
        sizeBytes: file.size,
      });

      const result = await api.previewMenuImport(payload);
      setPreview(result);
      if (result.invalidCount > 0) {
        setPreviewTab('errors');
      } else if (result.duplicateCount > 0 && result.validCount === 0) {
        setPreviewTab('duplicates');
      } else {
        setPreviewTab('products');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t('فشل تحليل ملف القائمة', 'Échec de l’analyse du fichier menu'));
    } finally {
      setIsParsing(false);
    }
  };

  const handleCommitImport = async () => {
    if (!selectedFile || !preview || !preview.canImport || !confirmed) return;
    setIsCommitting(true);
    setErrorMsg('');
    try {
      const report = await api.commitMenuImport({
        filename: selectedFile.filename,
        format: selectedFile.format,
        content: selectedFile.content,
        contentBase64: selectedFile.contentBase64,
        confirmed: true,
      });
      setCommitReport(report);
      setConfirmed(false);
      await Promise.all([refreshCatalog(), loadHistory()]);
    } catch (err: any) {
      setErrorMsg(err?.message || t('فشل استيراد القائمة وتم التراجع الآمن', 'Échec de l’importation (rollback effectué)'));
    } finally {
      setIsCommitting(false);
    }
  };

  const resetImport = () => {
    setSelectedFile(null);
    setPreview(null);
    setCommitReport(null);
    setConfirmed(false);
    setErrorMsg('');
  };

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="flex-1 flex flex-col bg-[#141414] text-[#F7F3EA] overflow-y-auto p-5 lg:p-7 space-y-6"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2B2925] pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#C6A15B] font-semibold tracking-wide mb-1">
            <Database className="w-4 h-4" />
            <span>{t('الإدارة • استيراد القائمة الرسمية', 'Administration • Importation du Menu Officiel')}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#F7F3EA]">
            {t('وحدة استيراد قائمة الطعام', 'Module d’Importation du Menu')}
          </h1>
          <p className="text-sm text-[#A8A29E] mt-1">
            {t(
              'استيراد آمن بملفات CSV و Excel (XLSX) و JSON مع التحقق من الأسعار بالدينار، النسخ الاحتياطي التلقائي، والمعاملة الذرية.',
              'Importation sécurisée CSV, Excel (XLSX) et JSON avec validation des prix en DA, sauvegarde automatique et transaction atomique.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {onBackToMenu && (
            <button
              type="button"
              onClick={onBackToMenu}
              className="px-4 py-2.5 rounded-xl bg-[#222222] hover:bg-[#2B2925] border border-[#33302B] text-sm font-semibold text-[#F7F3EA] flex items-center gap-2 cursor-pointer transition"
            >
              <ArrowRight className={`w-4 h-4 ${isRtl ? '' : 'rotate-180'}`} />
              <span>{t('العودة لإدارة القائمة', 'Retour à la Gestion du Menu')}</span>
            </button>
          )}
          {(selectedFile || commitReport) && (
            <button
              type="button"
              onClick={resetImport}
              className="px-4 py-2.5 rounded-xl bg-[#1F1D1A] hover:bg-[#2B2925] border border-[#33302B] text-sm font-semibold text-[#C6A15B] flex items-center gap-2 cursor-pointer transition"
            >
              <RefreshCw className="w-4 h-4" />
              <span>{t('استيراد ملف جديد', 'Nouvel import')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Workflow Step Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {[
          {
            step: '01',
            label: t('اختيار الملف', 'Sélection du fichier'),
            active: !preview && !commitReport,
            done: Boolean(preview || commitReport),
          },
          {
            step: '02',
            label: t('الفحص والمعاينة', 'Validation & Aperçu'),
            active: Boolean(preview && !commitReport),
            done: Boolean(commitReport),
          },
          {
            step: '03',
            label: t('النسخ الاحتياطي والتنفيذ', 'Sauvegarde & Import'),
            active: isCommitting,
            done: Boolean(commitReport),
          },
          {
            step: '04',
            label: t('التحقق والتقرير', 'Vérification & Rapport'),
            active: Boolean(commitReport),
            done: Boolean(commitReport),
          },
        ].map((item) => (
          <div
            key={item.step}
            className={`px-4 py-3 rounded-xl border flex items-center gap-3 transition ${
              item.done
                ? 'bg-emerald-950/30 border-emerald-700/40 text-emerald-300'
                : item.active
                ? 'bg-[#221F1A] border-[#C6A15B]/70 text-[#F7F3EA]'
                : 'bg-[#1A1A1A] border-[#2B2925] text-[#8E8882]'
            }`}
          >
            <span className="font-mono font-bold text-sm">{item.step}</span>
            <span className="font-semibold">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Error Banner */}
      {errorMsg && (
        <div
          data-testid="menu-import-error"
          className="p-4 rounded-xl bg-rose-950/50 border border-rose-700/60 text-rose-200 flex items-start gap-3"
        >
          <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="text-sm font-medium">{errorMsg}</div>
        </div>
      )}

      {/* Upload Dropzone */}
      {!commitReport && (
        <section className="bg-[#1B1B1B] border border-[#2E2C27] rounded-2xl p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2">
              <h2 className="text-base font-bold text-[#F7F3EA] flex items-center gap-2">
                <Upload className="w-5 h-5 text-[#C6A15B]" />
                <span>{t('رفع ملف قائمة المطعم', 'Charger le fichier du menu')}</span>
              </h2>
              <p className="text-xs text-[#A8A29E] max-w-2xl leading-relaxed">
                {t(
                  'يدعم النظام الترميز العربي الكامل UTF-8 مع الأسماء الفرنسية والأحجام (مثل L و XL للبيتزا) والفئات الفرعية للمشروبات. يتم التحقق من كل سطر ومنع التكرار قبل أي كتابة على قاعدة البيانات.',
                  'Prend en charge l’encodage UTF-8 arabe complet, les libellés français, les tailles (L/XL pour pizzas) et les sous-catégories de boissons. Chaque ligne est vérifiée avant écriture.'
                )}
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-[#A8A29E]">
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-[#C6A15B]" /> CSV (UTF-8)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Excel (.xlsx)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <FileJson className="w-4 h-4 text-sky-400" /> JSON (.json)
                </span>
              </div>
            </div>

            <label className="shrink-0 inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#C6A15B] hover:bg-[#D4B475] text-[#141414] font-bold text-sm cursor-pointer transition shadow-lg">
              <Upload className="w-4 h-4" />
              <span>
                {isParsing
                  ? t('جاري تحليل الملف...', 'Analyse en cours...')
                  : t('اختر ملف CSV / XLSX / JSON', 'Choisir CSV / XLSX / JSON')}
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                data-testid="menu-import-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  handleFileSelected(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {selectedFile && (
            <div className="mt-4 pt-4 border-t border-[#2B2925] flex flex-wrap items-center justify-between gap-3 text-xs text-[#D6D0C6]">
              <div>
                <span className="text-[#A8A29E]">{t('الملف المحدد:', 'Fichier sélectionné :')} </span>
                <span className="font-mono font-bold text-[#F7F3EA]" dir="ltr">
                  {selectedFile.filename}
                </span>
              </div>
              <div className="flex items-center gap-4 font-mono" dir="ltr">
                <span>FORMAT: {selectedFile.format}</span>
                <span>{(selectedFile.sizeBytes / 1024).toFixed(1)} KB</span>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Preview Section */}
      {preview && !commitReport && (
        <section className="space-y-5" data-testid="menu-import-preview">
          {/* Key Numeric Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              {
                label: t('التصنيفات', 'Catégories'),
                value: preview.categoriesCount,
                sub: `${preview.newCategoriesCount} ${t('جديد', 'nouv.')}`,
                tone: 'text-[#C6A15B]',
              },
              {
                label: t('المنتجات الصالحة', 'Produits valides'),
                value: preview.validCount,
                sub: `${preview.subcategoriesCount} ${t('فرعي', 'sous-cat.')}`,
                tone: 'text-emerald-400',
              },
              {
                label: t('الأحجام / الخيارات', 'Variantes'),
                value: preview.variantsCount,
                sub: t('مثال L / XL', 'ex. L / XL'),
                tone: 'text-sky-400',
              },
              {
                label: t('عناصر مكررة', 'Doublons'),
                value: preview.duplicateCount,
                sub: t('سيتم تخطيها', 'ignorés'),
                tone: preview.duplicateCount > 0 ? 'text-amber-400' : 'text-[#A8A29E]',
              },
              {
                label: t('أخطاء التحقق', 'Erreurs'),
                value: preview.invalidCount,
                sub: preview.invalidCount > 0 ? t('تمنع الاستيراد', 'bloquant') : t('لا توجد أخطاء', 'aucune'),
                tone: preview.invalidCount > 0 ? 'text-rose-400' : 'text-emerald-400',
              },
              {
                label: t('الحالة', 'Statut'),
                value: preview.canImport ? t('جاهز', 'Prêt') : t('مرفوض', 'Bloqué'),
                sub: preview.fileFormat,
                tone: preview.canImport ? 'text-emerald-400' : 'text-rose-400',
              },
            ].map((card, i) => (
              <div
                key={i}
                className="bg-[#1B1B1B] border border-[#2E2C27] rounded-xl p-4 flex flex-col justify-between"
              >
                <div className="text-xs text-[#A8A29E] font-medium">{card.label}</div>
                <div className={`text-2xl font-bold font-mono tabular-nums mt-1 ${card.tone}`}>
                  {card.value}
                </div>
                <div className="text-[11px] text-[#8E8882] mt-1">{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Tabbed Preview Inspector */}
          <div className="bg-[#1B1B1B] border border-[#2E2C27] rounded-2xl overflow-hidden">
            <div className="flex flex-wrap items-center gap-1 border-b border-[#2B2925] px-4 pt-3 bg-[#171717]">
              {[
                {
                  id: 'products' as const,
                  label: `${t('المنتجات والأحجام', 'Produits & Variantes')} (${preview.validCount})`,
                  icon: Layers,
                },
                {
                  id: 'categories' as const,
                  label: `${t('التصنيفات', 'Catégories')} (${preview.categoriesCount})`,
                  icon: FileSpreadsheet,
                },
                {
                  id: 'duplicates' as const,
                  label: `${t('المكررات', 'Doublons')} (${preview.duplicateCount})`,
                  icon: Copy,
                },
                {
                  id: 'errors' as const,
                  label: `${t('الأخطاء', 'Erreurs')} (${preview.invalidCount})`,
                  icon: AlertTriangle,
                },
              ].map((tab) => {
                const Icon = tab.icon;
                const active = previewTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPreviewTab(tab.id)}
                    className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
                      active
                        ? 'border-[#C6A15B] text-[#C6A15B]'
                        : 'border-transparent text-[#A8A29E] hover:text-[#F7F3EA]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="max-h-[380px] overflow-auto">
              {previewTab === 'products' && (
                <table className="w-full text-xs">
                  <thead className="bg-[#171717] text-[#A8A29E] sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3 text-start">#</th>
                      <th className="py-2.5 px-3 text-start">{t('التصنيف', 'Catégorie')}</th>
                      <th className="py-2.5 px-3 text-start">{t('الفئة الفرعية', 'Sous-catégorie')}</th>
                      <th className="py-2.5 px-3 text-start">{t('المنتج (عربي)', 'Produit (AR)')}</th>
                      <th className="py-2.5 px-3 text-start">{t('الاسم (فرنسي)', 'Libellé (FR)')}</th>
                      <th className="py-2.5 px-3 text-start">{t('السعر / الأحجام', 'Prix / Variantes')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#262420]">
                    {preview.validItems.map((item) => (
                      <tr key={`${item.rowNumber}-${item.categoryAr}-${item.nameAr}`} className="hover:bg-[#22201C]">
                        <td className="py-2 px-3 font-mono text-[#8E8882]">{item.rowNumber}</td>
                        <td className="py-2 px-3 font-semibold text-[#C6A15B]">{item.categoryAr}</td>
                        <td className="py-2 px-3 text-[#A8A29E]">{item.subcategoryAr || '—'}</td>
                        <td className="py-2 px-3 font-bold text-[#F7F3EA]">{item.nameAr}</td>
                        <td className="py-2 px-3 text-[#A8A29E]" dir="ltr">{item.nameFr || '—'}</td>
                        <td className="py-2 px-3 font-mono tabular-nums" dir="ltr">
                          {item.variants.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {item.variants.map((v) => (
                                <span key={v.nameAr} className="text-[#F7F3EA] font-semibold">
                                  {v.nameAr}: {v.price} DA
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="font-bold text-[#F7F3EA]">{item.price} DA</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {previewTab === 'categories' && (
                <table className="w-full text-xs">
                  <thead className="bg-[#171717] text-[#A8A29E] sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3 text-start">{t('الترتيب', 'Ordre')}</th>
                      <th className="py-2.5 px-3 text-start">{t('التصنيف (عربي)', 'Catégorie (AR)')}</th>
                      <th className="py-2.5 px-3 text-start">{t('التصنيف (فرنسي)', 'Catégorie (FR)')}</th>
                      <th className="py-2.5 px-3 text-start">{t('المحطة', 'Station')}</th>
                      <th className="py-2.5 px-3 text-start">{t('عدد المنتجات', 'Produits')}</th>
                      <th className="py-2.5 px-3 text-start">{t('الحالة', 'Statut')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#262420]">
                    {preview.categories.map((cat) => (
                      <tr key={cat.nameAr} className="hover:bg-[#22201C]">
                        <td className="py-2.5 px-3 font-mono text-[#8E8882]">{cat.sortOrder}</td>
                        <td className="py-2.5 px-3 font-bold text-[#F7F3EA]">{cat.nameAr}</td>
                        <td className="py-2.5 px-3 text-[#A8A29E]" dir="ltr">{cat.nameFr || '—'}</td>
                        <td className="py-2.5 px-3 font-mono text-[#A8A29E]">{cat.station}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-[#C6A15B]">{cat.productCount}</td>
                        <td className="py-2.5 px-3">
                          <span className={cat.isNew ? 'text-emerald-400 font-semibold' : 'text-[#A8A29E]'}>
                            {cat.isNew ? t('تصنيف جديد', 'Nouvelle') : t('موجود مسبقاً', 'Existante')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {previewTab === 'duplicates' && (
                <div className="p-4 space-y-2">
                  {preview.duplicates.length === 0 ? (
                    <div className="text-sm text-[#A8A29E] py-6 text-center">
                      {t('لم يتم اكتشاف أي منتجات مكررة.', 'Aucun doublon détecté.')}
                    </div>
                  ) : (
                    preview.duplicates.map((dup, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-amber-950/30 border border-amber-700/40 text-xs flex items-center justify-between gap-3"
                      >
                        <div className="text-amber-200 font-medium">{dup.message}</div>
                        <span className="font-mono text-amber-400 shrink-0">
                          {t('سطر', 'Ligne')} {dup.rowNumber}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {previewTab === 'errors' && (
                <div className="p-4 space-y-2">
                  {preview.errors.length === 0 ? (
                    <div className="text-sm text-emerald-400 py-6 text-center flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{t('جميع السطور مطابقة لشروط الصحة والتسعير بالدينار.', 'Toutes les lignes sont valides.')}</span>
                    </div>
                  ) : (
                    preview.errors.map((err, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-rose-950/40 border border-rose-700/50 text-xs flex items-center justify-between gap-3"
                      >
                        <div>
                          <span className="font-bold text-rose-300">
                            {t('سطر', 'Ligne')} {err.rowNumber} ({err.field}):{' '}
                          </span>
                          <span className="text-rose-200">{err.message}</span>
                        </div>
                        {err.value && (
                          <code className="font-mono text-rose-300 bg-black/40 px-2 py-0.5 rounded" dir="ltr">
                            {err.value}
                          </code>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Explicit Admin Confirmation & Commit Bar */}
          <div className="bg-[#1B1B1B] border border-[#33302B] rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!preview.canImport || isCommitting}
                onChange={(e) => setConfirmed(e.target.checked)}
                data-testid="menu-import-confirm-checkbox"
                className="mt-1 w-4 h-4 accent-[#C6A15B] cursor-pointer"
              />
              <div className="text-xs leading-relaxed">
                <div className="font-bold text-[#F7F3EA] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#C6A15B]" />
                  <span>
                    {t(
                      'تأكيد المدير الصريح للاستيراد الآمن',
                      'Confirmation explicite de l’administrateur'
                    )}
                  </span>
                </div>
                <p className="text-[#A8A29E] mt-0.5">
                  {t(
                    'سيقوم النظام تلقائياً بإنشاء نسخة احتياطية موثّقة لقاعدة البيانات SQLite قبل تنفيذ الاستيراد ضمن معاملة واحدة قابلة للتراجع الكامل عند أي خطأ.',
                    'Le système créera automatiquement une sauvegarde SQLite vérifiée avant d’exécuter l’importation dans une transaction atomique.'
                  )}
                </p>
              </div>
            </label>

            <button
              type="button"
              disabled={!preview.canImport || !confirmed || isCommitting}
              onClick={handleCommitImport}
              data-testid="menu-import-commit-btn"
              className="shrink-0 px-6 py-3.5 rounded-xl bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-40 disabled:cursor-not-allowed text-[#141414] font-bold text-sm transition cursor-pointer flex items-center gap-2"
            >
              {isCommitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{t('جاري النسخ الاحتياطي والاستيراد...', 'Sauvegarde et importation...')}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {t(
                      `تأكيد واستيراد (${preview.validCount} منتج)`,
                      `Confirmer et importer (${preview.validCount} produits)`
                    )}
                  </span>
                </>
              )}
            </button>
          </div>
        </section>
      )}

      {/* Detailed Post-Import Verification Report */}
      {commitReport && (
        <section
          data-testid="menu-import-report"
          className="bg-[#1B1B1B] border border-emerald-700/50 rounded-2xl p-6 space-y-5"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[#2B2925] pb-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-7 h-7 text-emerald-400 shrink-0" />
              <div>
                <h2 className="text-lg font-bold text-emerald-300">
                  {t('تم استيراد القائمة الرسمية بنجاح والتحقق من سلامة قاعدة البيانات', 'Importation terminée et base de données vérifiée')}
                </h2>
                <p className="text-xs text-[#A8A29E] mt-0.5 font-mono" dir="ltr">
                  Import #{commitReport.importId} • {commitReport.filename} ({commitReport.fileFormat})
                </p>
              </div>
            </div>
            <span className="text-xs font-mono font-bold text-emerald-400">
              integrity_check: {commitReport.verification.integrityCheck}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-[#151515] border border-[#2B2925] space-y-1.5">
              <div className="text-[#A8A29E] font-semibold">{t('العناصر المضافة', 'Éléments importés')}</div>
              <div className="flex justify-between">
                <span>{t('تصنيفات جديدة:', 'Catégories :')}</span>
                <span className="font-mono font-bold text-[#F7F3EA]">{commitReport.inserted.categories}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('منتجات جديدة:', 'Produits :')}</span>
                <span className="font-mono font-bold text-emerald-400">{commitReport.inserted.products}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('أحجام/خيارات:', 'Variantes :')}</span>
                <span className="font-mono font-bold text-sky-400">{commitReport.inserted.variants}</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#151515] border border-[#2B2925] space-y-1.5">
              <div className="text-[#A8A29E] font-semibold">{t('إجمالي قاعدة البيانات الحالية', 'Totaux en base SQLite')}</div>
              <div className="flex justify-between">
                <span>{t('إجمالي التصنيفات:', 'Total catégories :')}</span>
                <span className="font-mono font-bold text-[#F7F3EA]">{commitReport.totalsInDatabase.categories}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('إجمالي المنتجات:', 'Total produits :')}</span>
                <span className="font-mono font-bold text-[#C6A15B]">{commitReport.totalsInDatabase.products}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('إجمالي الأحجام:', 'Total variantes :')}</span>
                <span className="font-mono font-bold text-[#F7F3EA]">{commitReport.totalsInDatabase.variants}</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#151515] border border-[#2B2925] space-y-1.5">
              <div className="text-[#A8A29E] font-semibold">{t('النسخة الاحتياطية السابقة للاستيراد', 'Sauvegarde pré-import')}</div>
              <div className="font-mono text-[11px] text-[#C6A15B] break-all" dir="ltr">
                {commitReport.backup.filename}
              </div>
              <div className="flex justify-between text-[#A8A29E]">
                <span>{t('فحص السلامة:', 'Intégrité :')}</span>
                <span className="font-mono text-emerald-400">{commitReport.backup.integrityCheck}</span>
              </div>
              <div className="flex justify-between text-[#A8A29E]">
                <span>{t('المفاتيح الأجنبية:', 'Clés étrangères :')}</span>
                <span className="font-mono text-emerald-400">
                  {commitReport.verification.foreignKeyViolations === 0 ? 'OK (0)' : commitReport.verification.foreignKeyViolations}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Import History Table */}
      <section className="bg-[#1B1B1B] border border-[#2E2C27] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#2B2925] flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-[#F7F3EA]">
            <History className="w-4 h-4 text-[#C6A15B]" />
            <span>{t('سجل عمليات استيراد القائمة', 'Historique des importations')}</span>
          </div>
          <button
            type="button"
            onClick={loadHistory}
            className="text-xs text-[#A8A29E] hover:text-[#C6A15B] flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t('تحديث', 'Actualiser')}</span>
          </button>
        </div>

        {loadingHistory ? (
          <div className="p-6 text-center text-xs text-[#A8A29E]">
            {t('جاري تحميل السجل...', 'Chargement de l’historique...')}
          </div>
        ) : history.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#8E8882]">
            {t('لم يتم تنفيذ أي عملية استيراد بعد.', 'Aucune importation enregistrée pour le moment.')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#171717] text-[#A8A29E]">
                <tr>
                  <th className="py-2.5 px-4 text-start">#</th>
                  <th className="py-2.5 px-4 text-start">{t('الملف', 'Fichier')}</th>
                  <th className="py-2.5 px-4 text-start">{t('الصيغة', 'Format')}</th>
                  <th className="py-2.5 px-4 text-start">{t('التصنيفات', 'Catégories')}</th>
                  <th className="py-2.5 px-4 text-start">{t('المنتجات', 'Produits')}</th>
                  <th className="py-2.5 px-4 text-start">{t('الأحجام', 'Variantes')}</th>
                  <th className="py-2.5 px-4 text-start">{t('النسخة الاحتياطية', 'Sauvegarde')}</th>
                  <th className="py-2.5 px-4 text-start">{t('التاريخ', 'Date')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#262420]">
                {history.map((row) => (
                  <tr key={row.id} className="hover:bg-[#22201C]">
                    <td className="py-2.5 px-4 font-mono text-[#8E8882]">#{row.id}</td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-[#F7F3EA]" dir="ltr">
                      {row.filename}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[#C6A15B]">{row.fileFormat}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums">{row.categoriesCount}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-emerald-400">
                      {row.productsCount}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums">{row.variantsCount}</td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-[#A8A29E]" dir="ltr">
                      {row.backupFilename || '—'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-[#A8A29E]" dir="ltr">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString('fr-FR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
