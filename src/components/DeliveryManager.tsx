import React, { useState, useEffect } from 'react';
import { DeliveryOrder } from '../types.ts';
import { api } from '../services/api.ts';
import { useLanguage } from '../context/LanguageContext.tsx';
import {
  Truck,
  Phone,
  MapPin,
  X,
  User,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

export const DeliveryManager: React.FC = () => {
  const { t } = useLanguage();
  const [deliveries, setDeliveries] = useState<DeliveryOrder[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [editingDelivery, setEditingDelivery] = useState<DeliveryOrder | null>(null);
  const [driverNameInput, setDriverNameInput] = useState<string>('');
  const [driverPhoneInput, setDriverPhoneInput] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('OUT_FOR_DELIVERY');
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    loadDeliveries();
  }, []);

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback((c) => (c?.text === text ? null : c)), 4000);
  };

  const loadDeliveries = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.getDeliveries();
      setDeliveries(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setErrorMsg(err?.message || t('فشل تحميل طلبات التوصيل', 'Échec du chargement des livraisons'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!editingDelivery) return;
    setModalError(null);
    setIsSaving(true);
    try {
      await api.updateDeliveryStatus(editingDelivery.id, {
        status: selectedStatus,
        driverName: driverNameInput || undefined,
        driverPhone: driverPhoneInput || undefined,
      });
      setEditingDelivery(null);
      await loadDeliveries();
      showToast('success', t('تم تحديث حالة التوصيل بنجاح', 'Statut de livraison mis à jour'));
    } catch (err: any) {
      setModalError(err?.message || t('فشل تحديث حالة التوصيل', 'Échec de mise à jour'));
    } finally {
      setIsSaving(false);
    }
  };

  const filtered = deliveries.filter((d) => activeFilter === 'ALL' || d.status === activeFilter);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DELIVERED':
        return 'bg-emerald-950/60 text-emerald-300 border-emerald-600/50';
      case 'OUT_FOR_DELIVERY':
        return 'bg-[#C6A15B]/20 text-[#C6A15B] border-[#C6A15B]/50';
      case 'PREPARING':
        return 'bg-amber-950/60 text-amber-300 border-amber-600/50';
      case 'CANCELLED':
        return 'bg-rose-950/60 text-rose-300 border-rose-600/50';
      default:
        return 'bg-sky-950/60 text-sky-300 border-sky-600/50';
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'NEW':
        return t('جديد', 'Nouveau');
      case 'CONFIRMED':
        return t('مؤكد', 'Confirmé');
      case 'PREPARING':
        return t('قيد التحضير', 'En préparation');
      case 'OUT_FOR_DELIVERY':
        return t('مع السائق', 'En livraison');
      case 'DELIVERED':
        return t('تم التسليم', 'Livré');
      case 'CANCELLED':
        return t('ملغى', 'Annulé');
      default:
        return status;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar bg-[#171717] p-2.5 sm:p-5 select-none text-[#F7F3EA] space-y-3 sm:space-y-4">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-[#222222] p-3 sm:p-4 rounded-2xl border border-[#33302B] shadow-lg shrink-0">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          <div className="font-black text-base sm:text-xl text-[#F7F3EA] flex items-center gap-2 sm:pe-3 sm:border-e sm:border-[#33302B]">
            <div className="w-9 h-9 rounded-xl bg-[#171717] border border-[#C6A15B]/40 flex items-center justify-center text-[#C6A15B] shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <span className="whitespace-nowrap">{t('إدارة طلبات التوصيل', 'Gestion des Livraisons')}</span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {[
              { id: 'ALL', label: t('الكل', 'Tout') },
              { id: 'NEW', label: t('جديدة', 'Nouvelles') },
              { id: 'PREPARING', label: t('قيد التحضير', 'En cuisine') },
              { id: 'OUT_FOR_DELIVERY', label: t('مع السائق', 'En cours') },
              { id: 'DELIVERED', label: t('تم التسليم', 'Livrées') },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setActiveFilter(f.id)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs font-black transition cursor-pointer whitespace-nowrap shrink-0 border ${
                  activeFilter === f.id
                    ? 'bg-[#C6A15B] text-[#171717] border-[#C6A15B]'
                    : 'bg-[#171717] text-[#A8A29E] border-[#33302B] hover:border-[#C6A15B]/60'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={loadDeliveries}
          className="p-2.5 rounded-xl bg-[#171717] hover:border-[#C6A15B] border border-[#33302B] text-[#A8A29E] cursor-pointer shrink-0 self-end lg:self-auto"
          title={t('تحديث', 'Actualiser')}
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#C6A15B]' : ''}`} />
        </button>
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

      {/* Deliveries Grid */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {isLoading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-4 border-[#C6A15B] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[#A8A29E] font-bold">{t('جاري التحميل...', 'Chargement...')}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-[#A8A29E] bg-[#222222] rounded-2xl border border-[#33302B]">
            <Truck className="w-12 h-12 mb-2 text-[#33302B]" />
            <p className="text-base font-black text-[#F7F3EA]">{t('لا توجد طلبات توصيل مطابقة', 'Aucune livraison trouvée')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
            {filtered.map((d) => (
              <div
                key={d.id}
                className="bg-[#222222] border border-[#33302B] rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-4 shadow-lg hover:border-[#C6A15B]/50 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono font-black text-lg text-[#F7F3EA] block">{d.orderNumber}</span>
                    <span className="text-sm font-black text-[#C6A15B]">
                      {d.customerName || t('زبون عام', 'Client de passage')}
                    </span>
                  </div>

                  <span className={`px-2.5 py-1 rounded-xl text-xs font-black border ${getStatusColor(d.status)}`}>
                    {statusLabel(d.status)}
                  </span>
                </div>

                <div className="space-y-2 text-xs sm:text-sm font-bold text-[#A8A29E]">
                  <div className="flex items-center gap-2 text-[#F7F3EA] font-mono">
                    <Phone className="w-4 h-4 text-[#C6A15B]" />
                    <span>{d.customerPhone || '—'}</span>
                  </div>

                  <div className="flex items-start gap-2 text-[#F7F3EA]/90">
                    <MapPin className="w-4 h-4 text-[#C6A15B] shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{d.deliveryAddress}</span>
                  </div>

                  {d.driverName && (
                    <div className="flex items-center gap-2 text-[#A8A29E] pt-1">
                      <User className="w-4 h-4 text-[#C6A15B]/70" />
                      <span>
                        {t('السائق:', 'Livreur :')} {d.driverName} ({d.driverPhone || '—'})
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-[#33302B]">
                  <div className="font-mono tabular-nums font-black text-[#C6A15B] text-xl">
                    {Number(d.orderTotal || 0).toLocaleString()} <span className="text-xs text-[#A8A29E]">DA</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setModalError(null);
                      setEditingDelivery(d);
                      setDriverNameInput(d.driverName || '');
                      setDriverPhoneInput(d.driverPhone || '');
                      setSelectedStatus(d.status);
                    }}
                    className="px-3.5 py-2 bg-[#C6A15B] hover:bg-[#D4B475] text-[#171717] rounded-xl text-xs font-black transition cursor-pointer"
                  >
                    {t('تحديث الحالة / السائق', 'Mettre à jour')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Status Modal */}
      {editingDelivery && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222222] border border-[#C6A15B]/40 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-[#F7F3EA]">
            <div className="flex items-center justify-between border-b border-[#33302B] pb-3">
              <h3 className="font-black text-lg text-[#C6A15B]">
                {t('تحديث التوصيل:', 'Mettre à jour :')} {editingDelivery.orderNumber}
              </h3>
              <button
                type="button"
                onClick={() => setEditingDelivery(null)}
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
                <label className="block text-[#A8A29E] text-xs mb-1">{t('حالة التوصيل:', 'Statut livraison :')}</label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-black focus:outline-none focus:border-[#C6A15B]"
                >
                  <option value="NEW">{t('جديد (NEW)', 'Nouveau (NEW)')}</option>
                  <option value="PREPARING">{t('قيد التحضير في المطبخ', 'En préparation')}</option>
                  <option value="OUT_FOR_DELIVERY">{t('خرج للتوصيل مع السائق', 'En cours de livraison')}</option>
                  <option value="DELIVERED">{t('تم التسليم بنجاح', 'Livré')}</option>
                  <option value="CANCELLED">{t('ملغى', 'Annulé')}</option>
                </select>
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('اسم السائق:', 'Nom du livreur :')}</label>
                <input
                  type="text"
                  value={driverNameInput}
                  onChange={(e) => setDriverNameInput(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] focus:outline-none focus:border-[#C6A15B]"
                />
              </div>

              <div>
                <label className="block text-[#A8A29E] text-xs mb-1">{t('رقم هاتف السائق:', 'Téléphone du livreur :')}</label>
                <input
                  type="tel"
                  value={driverPhoneInput}
                  onChange={(e) => setDriverPhoneInput(e.target.value)}
                  className="w-full bg-[#171717] border border-[#33302B] rounded-xl p-2.5 text-[#F7F3EA] font-mono focus:outline-none focus:border-[#C6A15B]"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={isSaving}
              onClick={handleUpdateStatus}
              className="w-full py-3.5 bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717] font-black text-base rounded-2xl transition shadow-xl cursor-pointer"
            >
              {isSaving ? t('جاري التحديث...', 'Mise à jour...') : t('حفظ وتحديث', 'Enregistrer')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
