import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Printer,
  Download,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Sliders,
  Check,
  Database,
} from 'lucide-react';
import { printerService } from '../services/printerService.ts';
import { useOptionalPos } from '../context/PosContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api } from '../services/api.ts';
import { PrinterProfile } from '../types.ts';

interface ReceiptPrintProps {
  data: any | null;
  onClose: () => void;
  onOpenPrinterSettings?: () => void;
}

export const ReceiptPrint: React.FC<ReceiptPrintProps> = ({
  data,
  onClose,
}) => {
  const posContext = useOptionalPos();
  const settings = posContext?.settings || {};
  const { lang, t } = useLanguage();
  const [profile, setProfile] = useState<PrinterProfile>(printerService.getProfile());
  const [printStatus, setPrintStatus] = useState<'IDLE' | 'PRINTING' | 'PRINTED' | 'FAILED'>('IDLE');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [spoolerAccepted, setSpoolerAccepted] = useState<boolean>(false);
  const [hardwareConfirmed, setHardwareConfirmed] = useState<boolean>(false);
  const [currentJobId, setCurrentJobId] = useState<string | number | null>(null);
  const [isReprintMode, setIsReprintMode] = useState<boolean>(Boolean(data?.isReprint));
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);

  const isPrintingRef = useRef<boolean>(false);

  useEffect(() => {
    if (data) {
      const p = printerService.getProfile();
      setProfile(p);
      printerService.setLastReceipt(data);
      printerService.applyPrintStyles(p);
      setIsReprintMode(Boolean(data.isReprint));
      setCurrentJobId(data.printJobRecordId || null);

      if (data.autoPrintError) {
        setPrintStatus('FAILED');
        setSpoolerAccepted(false);
        setHardwareConfirmed(false);
        setStatusMessage(`فشل الطباعة التلقائية: ${data.autoPrintError}`);
      } else if (printerService.isJobCompleted(data) || data.alreadyAutoPrinted) {
        setPrintStatus('PRINTED');
        setSpoolerAccepted(Boolean(data.spoolerAccepted ?? true));
        setHardwareConfirmed(Boolean(data.hardwareConfirmed));
        setStatusMessage(
          t(
            'تم إرسال الوصل الأصلي لهذا الطلب. استخدم زر «إعادة طباعة الوصل» لإصدار نسخة DUPLICATA.',
            'Ticket original déjà envoyé. Utilisez « Réimprimer » pour un duplicata.'
          )
        );
      } else {
        setPrintStatus('IDLE');
        setSpoolerAccepted(false);
        setHardwareConfirmed(false);
        setStatusMessage('');
      }
    }
  }, [data]);

  if (!data) return null;

  const isKitchen = Boolean(data.isKitchenTicket);
  const isDiagnostic = Boolean(data.isDiagnosticTest);
  const isAlreadyPrinted =
    printStatus === 'PRINTED' ||
    ((printerService.isJobCompleted(data) || Boolean(data.alreadyAutoPrinted)) &&
      printStatus !== 'FAILED');
  const is58mm = profile.paperType === '58mm' || profile.printableWidth <= 54;

  const restaurantName = settings.restaurant_name || data.restaurantName || 'GOLDEN PALACE POS';
  const restaurantBrand =
    settings.restaurant_brand || data.restaurantBrand || 'القصر الذهبي • LE PALAIS D’OR';
  const restaurantAddress =
    settings.restaurant_address || data.restaurantAddress || 'شارع بلهوشات، حسين داي، الجزائر';
  const restaurantPhone = settings.restaurant_phone || data.restaurantPhone || '0791755614';
  const receiptFooter =
    settings.receipt_footer || data.receiptFooter || 'شكراً لزيارتكم • MERCI DE VOTRE VISITE';

  const enrichedData = {
    ...data,
    restaurantName,
    restaurantBrand,
    restaurantAddress,
    restaurantPhone,
    receiptFooter,
  };

  const totalAmount = Number(data.total || 0);
  const paidAmount = Number(
    data.paidAmount !== undefined
      ? data.paidAmount
      : data.tenderAmount > 0
      ? Math.min(totalAmount, Number(data.tenderAmount))
      : 0
  );
  const remainingAmount = Math.max(0, totalAmount - paidAmount);
  const paymentLegs: any[] = Array.isArray(data.payments) ? data.payments : [];

  const handleBrowserPrint = async () => {
    if (isPrintingRef.current) return;
    if (isAlreadyPrinted) {
      setStatusMessage(
        t(
          'تم إصدار وصل هذا الطلب بالفعل (وصل واحد فقط لكل طلب). لإصدار نسخة إضافية، اضغط على «إعادة طباعة الوصل».',
          'Ticket original déjà émis. Cliquez sur « Réimprimer » pour un duplicata.'
        )
      );
      return;
    }

    isPrintingRef.current = true;
    setPrintStatus('PRINTING');
    setStatusMessage(t('جاري إرسال مهمة الطباعة...', 'Envoi de la tâche d’impression...'));

    try {
      const result = await printerService.sendDirectPrintJob(enrichedData, profile, {
        isReprint: false,
      });
      if (result.jobId) setCurrentJobId(result.jobId);
      if (result.success) {
        setPrintStatus('PRINTED');
        setSpoolerAccepted(Boolean(result.spoolerAccepted));
        setHardwareConfirmed(Boolean(result.hardwareConfirmed));
        setStatusMessage(result.message || t('تم إرسال الوصل بنجاح.', 'Impression envoyée.'));
      } else {
        setPrintStatus('FAILED');
        setSpoolerAccepted(false);
        setHardwareConfirmed(false);
        setStatusMessage(`فشل الطباعة: ${result.message}`);
      }
    } catch (err: any) {
      setPrintStatus('FAILED');
      setSpoolerAccepted(false);
      setHardwareConfirmed(false);
      setStatusMessage(`خطأ أثناء الطباعة: ${err.message || 'حدث خطأ غير متوقع'}`);
    } finally {
      isPrintingRef.current = false;
    }
  };

  const handleReprint = async () => {
    if (isPrintingRef.current) return;
    isPrintingRef.current = true;
    setIsReprintMode(true);
    setPrintStatus('PRINTING');
    setStatusMessage(t('جاري إعادة طباعة نسخة DUPLICATA...', 'Réimpression DUPLICATA...'));

    try {
      const result = await printerService.sendDirectPrintJob(
        { ...enrichedData, isReprint: true },
        profile,
        { isReprint: true }
      );
      if (result.jobId) setCurrentJobId(result.jobId);
      if (result.success) {
        setPrintStatus('PRINTED');
        setSpoolerAccepted(Boolean(result.spoolerAccepted));
        setHardwareConfirmed(Boolean(result.hardwareConfirmed));
        setStatusMessage(result.message || t('تمت إعادة طباعة نسخة جديدة بنجاح.', 'Duplicata imprimé.'));
      } else {
        setPrintStatus('FAILED');
        setSpoolerAccepted(false);
        setHardwareConfirmed(false);
        setStatusMessage(`فشل إعادة الطباعة: ${result.message}`);
      }
    } catch (err: any) {
      setPrintStatus('FAILED');
      setStatusMessage(`خطأ في إعادة الطباعة: ${err.message || 'حدث خطأ'}`);
    } finally {
      isPrintingRef.current = false;
    }
  };

  const handleConfirmPhysicalOutput = async () => {
    if (!currentJobId || typeof currentJobId !== 'number') {
      setHardwareConfirmed(true);
      return;
    }
    try {
      await api.confirmPrintJob(currentJobId);
      setHardwareConfirmed(true);
      setStatusMessage(t('تم تأكيد خروج الورق فعلياً من الطابعة.', 'Sortie papier confirmée.'));
    } catch {
      setHardwareConfirmed(true);
    }
  };

  const handleWebSerialPrint = async () => {
    if (isPrintingRef.current) return;
    isPrintingRef.current = true;
    try {
      setPrintStatus('PRINTING');
      setStatusMessage(t('جاري الاتصال المباشر بمنفذ USB/Serial...', 'Connexion USB/Serial...'));
      await printerService.printViaWebSerial(enrichedData, profile);
      setPrintStatus('PRINTED');
      setSpoolerAccepted(true);
      setHardwareConfirmed(true);
      setStatusMessage(t('تمت الطباعة مباشرة عبر USB بنجاح!', 'Imprimé via USB avec succès !'));
    } catch (err: any) {
      setPrintStatus('FAILED');
      setSpoolerAccepted(false);
      setHardwareConfirmed(false);
      setStatusMessage(`فشل USB/Serial: ${err.message}`);
    } finally {
      isPrintingRef.current = false;
    }
  };

  const handleDownloadEscPos = () => {
    try {
      printerService.downloadEscPosFile(
        enrichedData,
        profile,
        `ticket_${data.orderNumber || 'receipt'}.prn`
      );
      setStatusMessage(t('تم تنزيل ملف أوامر ESC/POS (.prn).', 'Fichier ESC/POS (.prn) téléchargé.'));
    } catch (err: any) {
      setPrintStatus('FAILED');
      setStatusMessage(`فشل توليد أوامر ESC/POS: ${err.message}`);
    }
  };

  return (
    <div
      data-testid="receipt-print-modal"
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-3 select-none overflow-y-auto"
    >
      <div className="bg-[#222222] border border-[#C6A15B]/50 rounded-2xl sm:rounded-3xl max-w-xl w-full p-3.5 sm:p-5 shadow-2xl space-y-3 sm:space-y-4 max-h-[96vh] overflow-y-auto no-scrollbar my-auto text-[#F7F3EA]">
        {/* Top Controls Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between border-b border-[#33302B] pb-2.5 sm:pb-3 gap-2.5 print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#171717] border border-[#C6A15B]/40 flex items-center justify-center text-[#C6A15B] shrink-0">
              <Printer className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <span className="font-black text-base sm:text-lg text-[#C6A15B] block leading-tight">
                {isDiagnostic
                  ? t('معاينة تذكرة الفحص', 'Aperçu ticket diagnostic')
                  : isKitchen
                  ? t('تذكرة المطبخ', 'Bon Cuisine')
                  : t('معاينة إيصال الزبون', 'Aperçu Ticket Client')}
              </span>
              <span className="text-[11px] text-[#A8A29E] font-mono font-bold">
                {profile.paperType} ({profile.printableWidth}mm) • {profile.printerName} •{' '}
                {printerService.resolveConnectionType(profile)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 justify-end flex-wrap">
            <button
              type="button"
              data-testid="receipt-print-btn"
              onClick={handleBrowserPrint}
              disabled={printStatus === 'PRINTING' || isAlreadyPrinted}
              className={`px-3 py-2 text-xs sm:text-sm font-black rounded-xl transition active:scale-95 shadow-md flex items-center gap-1.5 cursor-pointer ${
                isAlreadyPrinted
                  ? 'bg-[#171717] text-[#A8A29E] border border-[#33302B] cursor-not-allowed opacity-80'
                  : 'bg-[#C6A15B] hover:bg-[#D4B475] disabled:opacity-50 text-[#171717]'
              }`}
              title={isAlreadyPrinted ? 'تم إصدار الوصل الأصلي مسبقاً' : 'طباعة الوصل الأصلي'}
            >
              {isAlreadyPrinted ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Printer className="w-4 h-4" />
              )}
              <span>
                {printStatus === 'FAILED'
                  ? t('إعادة المحاولة', 'Réessayer')
                  : isAlreadyPrinted
                  ? t('تم الإرسال', 'Envoyé')
                  : t('طباعة', 'Imprimer')}
              </span>
            </button>

            <button
              type="button"
              data-testid="receipt-reprint-btn"
              onClick={handleReprint}
              disabled={printStatus === 'PRINTING'}
              className="px-3.5 py-2 bg-[#171717] hover:border-[#C6A15B] text-[#C6A15B] text-xs sm:text-sm font-black rounded-xl border border-[#33302B] transition active:scale-95 shadow-sm flex items-center gap-1.5 cursor-pointer"
              title="إعادة طباعة نسخة جديدة من الوصل (DUPLICATA)"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{t('إعادة طباعة الوصل', 'Réimprimer')}</span>
            </button>

            {'serial' in navigator && (
              <button
                type="button"
                onClick={handleWebSerialPrint}
                className="px-2.5 py-2 bg-[#171717] hover:border-[#C6A15B] text-[#F7F3EA] rounded-xl text-xs border border-[#33302B] font-mono font-bold flex items-center gap-1 cursor-pointer"
              >
                <span>USB</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownloadEscPos}
              className="p-2 bg-[#171717] hover:border-[#C6A15B] text-[#C6A15B] rounded-xl text-xs border border-[#33302B] cursor-pointer"
              title="تصدير ملف خام ESC/POS (.prn)"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-[#171717] border border-[#33302B] text-[#A8A29E] hover:text-[#F7F3EA] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 3-Stage Truthful Operational Clarity Strip */}
        <div className="grid grid-cols-3 gap-1.5 text-[11px] font-bold print:hidden">
          <div className="p-2 rounded-xl bg-emerald-950/40 border border-emerald-700/40 text-emerald-300 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 shrink-0" />
            <span>{t('1. محفوظة بالقاعدة', '1. Enregistrée DB')}</span>
          </div>
          <div
            className={`p-2 rounded-xl border flex items-center gap-1.5 ${
              printStatus === 'FAILED'
                ? 'bg-rose-950/50 border-rose-600/60 text-rose-300'
                : spoolerAccepted || printStatus === 'PRINTED'
                ? 'bg-amber-950/40 border-[#C6A15B]/50 text-[#C6A15B]'
                : 'bg-[#171717] border-[#33302B] text-[#A8A29E]'
            }`}
          >
            <Printer className="w-3.5 h-3.5 shrink-0" />
            <span>
              {printStatus === 'FAILED'
                ? t('2. فشل الإرسال', '2. Échec envoi')
                : spoolerAccepted || printStatus === 'PRINTED'
                ? t('2. أُرسلت للمعالج', '2. Spooler OK')
                : t('2. بانتظار الطباعة', '2. En attente')}
            </span>
          </div>
          <div
            className={`p-2 rounded-xl border flex items-center justify-between gap-1 ${
              hardwareConfirmed
                ? 'bg-emerald-950/50 border-emerald-600/50 text-emerald-300'
                : 'bg-[#171717] border-[#33302B] text-[#A8A29E]'
            }`}
          >
            <span>
              {hardwareConfirmed
                ? t('3. مؤكد خروج الورق', '3. Papier confirmé')
                : t('3. لم يُؤكد الورق بعد', '3. Non confirmé')}
            </span>
            {printStatus === 'PRINTED' && !hardwareConfirmed && (
              <button
                type="button"
                onClick={handleConfirmPhysicalOutput}
                className="px-1.5 py-0.5 rounded bg-[#C6A15B] text-[#171717] text-[10px] font-black cursor-pointer"
              >
                {t('تأكيد', 'OK')}
              </button>
            )}
          </div>
        </div>

        {/* Status Notification */}
        {printStatus !== 'IDLE' && (
          <div
            data-testid="receipt-print-status"
            className={`p-3 rounded-xl text-xs sm:text-sm flex items-center gap-2.5 font-bold border print:hidden ${
              printStatus === 'PRINTED'
                ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-300'
                : printStatus === 'FAILED'
                ? 'bg-rose-950/60 border-rose-600/60 text-rose-300'
                : 'bg-[#171717] border-[#C6A15B]/60 text-[#C6A15B]'
            }`}
          >
            {printStatus === 'PRINTED' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : printStatus === 'FAILED' ? (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            ) : (
              <div className="w-4 h-4 border-2 border-[#C6A15B] border-t-transparent rounded-full animate-spin shrink-0" />
            )}
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Roll & Printable Width Quick Calibration Bar (58mm & 80mm) */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#171717] p-2.5 rounded-xl border border-[#33302B] text-xs print:hidden">
          <div className="text-[#A8A29E] font-bold flex items-center gap-1.5">
            <Sliders className="w-4 h-4 text-[#C6A15B]" />
            <span>{t('المقاس:', 'Largeur :')}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { w: 48, paper: '58mm' as const },
              { w: 50, paper: '58mm' as const },
              { w: 68, paper: '80mm' as const },
              { w: 70, paper: '80mm' as const },
              { w: 72, paper: '80mm' as const },
              { w: 80, paper: '80mm' as const },
            ].map((opt) => (
              <button
                key={opt.w}
                type="button"
                onClick={() => {
                  const updated: PrinterProfile = {
                    ...profile,
                    paperType: opt.paper,
                    paperWidth: opt.paper === '58mm' ? 58 : 80,
                    printableWidth: opt.w,
                  };
                  setProfile(updated);
                  printerService.saveProfile(updated);
                }}
                className={`px-2 py-1 rounded-lg font-mono font-bold transition text-xs cursor-pointer ${
                  profile.printableWidth === opt.w
                    ? 'bg-[#C6A15B] text-[#171717] shadow'
                    : 'bg-[#222222] text-[#A8A29E] border border-[#33302B] hover:text-[#F7F3EA]'
                }`}
              >
                {opt.w}mm {opt.w === 70 ? '★' : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Windows CMD Spool Command Bar for Diagnostics */}
        {isDiagnostic && (
          <div className="bg-[#171717] p-3 rounded-xl border border-[#33302B] text-xs text-[#A8A29E] space-y-1.5 print:hidden">
            <div className="flex items-center justify-between font-mono text-[#C6A15B] font-bold">
              <span>أمر الطباعة المباشرة (CMD):</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(printerService.getWindowsSpoolCommand()).catch(() => {});
                  setCopiedCmd(true);
                  setTimeout(() => setCopiedCmd(false), 2000);
                }}
                className="bg-[#222222] hover:border-[#C6A15B] border border-[#33302B] text-[#C6A15B] px-2.5 py-1 rounded-lg text-xs cursor-pointer"
              >
                {copiedCmd ? 'تم النسخ ✓' : 'نسخ الأمر'}
              </button>
            </div>
            <code className="block bg-black/70 text-[#F7F3EA] px-3 py-1.5 rounded-lg font-mono text-xs select-all border border-[#33302B]">
              {printerService.getWindowsSpoolCommand('ticket.prn', profile.printerName)}
            </code>
          </div>
        )}

        {/* PHYSICAL RECEIPT CONTAINER */}
        <div className="bg-neutral-950 p-3 rounded-2xl border border-neutral-800 flex justify-center max-h-[58vh] overflow-y-auto no-scrollbar">
          <div
            id="printable-receipt"
            data-testid="printable-receipt"
            dir={lang === 'fr' ? 'ltr' : 'rtl'}
            className={`bg-white text-black p-2 leading-tight select-text ${
              is58mm ? 'text-[10px]' : 'text-[11px]'
            }`}
            style={{
              width: `${profile.printableWidth}mm`,
              maxWidth: `${profile.printableWidth}mm`,
              margin: '0 auto',
              boxSizing: 'border-box',
              direction: lang === 'fr' ? 'ltr' : 'rtl',
              textAlign: lang === 'fr' ? 'left' : 'right',
              fontFamily: "'Cairo', 'Tajawal', 'Segoe UI', sans-serif",
            }}
          >
            {isDiagnostic ? (
              <div className="border-2 border-black p-1 space-y-1.5 text-center text-black">
                <div className="border-b border-dashed border-black pb-1 space-y-0.5">
                  <h1 className="text-base font-black">{restaurantName}</h1>
                  <h2 className="text-xs font-bold">{restaurantBrand}</h2>
                  <p className="text-[10px] font-bold bg-black text-white py-0.5 mt-0.5">
                    تذكرة فحص ومعايرة العرض ({profile.paperType} / {profile.printableWidth}mm)
                  </p>
                </div>

                <div className="border border-black p-1 bg-gray-50 space-y-1">
                  <div className="flex justify-between items-center text-[10px] font-black">
                    <span className="bg-black text-white px-1">[يمين]</span>
                    <span className="font-bold">[وسط]</span>
                    <span className="bg-black text-white px-1">[يسار]</span>
                  </div>
                </div>

                <div className="border-t border-b border-black py-1 font-mono text-[9px] space-y-0.5">
                  <div className="font-bold text-[10px] text-center">
                    مسطرة قياس رأس الطباعة ({profile.printableWidth}mm)
                  </div>
                  <div className="tracking-tight text-center font-bold overflow-hidden whitespace-nowrap">
                    {is58mm ? '|00--10--20--30--48mm|' : '|00---10---20---30---40---50---60---70mm|'}
                  </div>
                </div>

                <div className="border-b border-dashed border-black py-1 space-y-1 text-right text-[9px]">
                  <div>
                    <span className="font-bold block text-[10px]">اختبار النص العربي والفرنسي:</span>
                    <div className="text-[9px] font-bold text-center border-t border-gray-300 pt-0.5" dir="rtl">
                      القصر الذهبي • مشاوي وأسماك طازجة • لا لأ لإ لآ
                    </div>
                    <div className="text-[9px] font-bold text-center" dir="ltr">
                      LE PALAIS D’OR • Reçu Bilingue 0123456789 DZD
                    </div>
                  </div>
                </div>

                <div className="text-right text-[10px] py-1 border-b border-dashed border-black space-y-1">
                  <div className="flex justify-between font-bold">
                    <span>حساء حوت / Soupe poisson</span>
                    <span className="font-mono" dir="ltr">400 DA</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>شواء مشكل / Mixte Grill</span>
                    <span className="font-mono" dir="ltr">1,400 DA</span>
                  </div>
                  <div className="flex justify-between font-black border-t border-black pt-0.5 text-xs">
                    <span>المجموع / TOTAL:</span>
                    <span className="font-mono" dir="ltr">1,800 DZD</span>
                  </div>
                </div>

                <div className="pt-1 text-center font-black text-[10px] tracking-wider">
                  *** نهاية تذكرة الفحص ***
                </div>
              </div>
            ) : isKitchen ? (
              <div className="space-y-2 text-center text-black">
                <div className="border-b-2 border-black pb-2">
                  <h1 className="text-lg font-black uppercase tracking-wider">BON CUISINE</h1>
                  <div className="text-base font-black mt-0.5">
                    {data.tableNumber ? `TABLE: ${data.tableNumber}` : data.orderType}
                  </div>
                  <div className="text-xs font-bold font-mono" dir="ltr">{data.orderNumber}</div>
                  <div className="text-[10px]" dir="ltr">{data.time}</div>
                  {isReprintMode && (
                    <div className="text-[10px] font-black bg-black text-white py-0.5 mt-1">
                      *** REPRINT / DUPLICATA ***
                    </div>
                  )}
                </div>

                <div className="text-right space-y-2 py-2 border-b-2 border-black">
                  {data.items?.map((it: any, i: number) => (
                    <div key={i} className="border-b border-dashed border-gray-400 pb-1">
                      <div className="flex justify-between items-baseline font-black text-sm">
                        <span className="text-base font-black ml-1" dir="ltr">{it.quantity}×</span>
                        <span className="flex-1 break-words">{it.nameAr}</span>
                      </div>
                      {it.nameFr && <div className="text-[10px] text-gray-700" dir="ltr">{it.nameFr}</div>}
                      {it.notes && (
                        <div className="text-xs font-bold text-red-700 mt-0.5">
                          ⚠️ {it.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {data.notes && (
                  <div className="text-right text-xs font-bold py-1">
                    ملاحظة عامة: {data.notes}
                  </div>
                )}
              </div>
            ) : (
              /* STANDARD CUSTOMER RECEIPT (Arabic RTL + French LTR Bilingual) */
              <div className="space-y-1.5 text-center text-black">
                {/* Header */}
                <div className="border-b border-dashed border-black pb-1.5 space-y-0.5">
                  <h1 className="text-sm font-black tracking-wider uppercase">{restaurantName}</h1>
                  <h2 className="text-[11px] font-bold">{restaurantBrand}</h2>
                  <p className="text-[9px] leading-tight text-gray-800">{restaurantAddress}</p>
                  <p className="text-[10px] font-bold mt-0.5 font-mono" dir="ltr">
                    TEL: {restaurantPhone}
                  </p>
                  {isReprintMode && (
                    <div
                      data-testid="receipt-reprint-banner"
                      className="text-[10px] font-black bg-black text-white py-0.5 mt-1 tracking-wider"
                    >
                      *** REPRINT / DUPLICATA • نسخة معاد طباعتها ***
                    </div>
                  )}
                </div>

                {/* Order Meta */}
                <div className="text-[10px] space-y-0.5 py-1 border-b border-dashed border-black">
                  <div className="flex justify-between">
                    <span>{t('رقم الفاتورة:', 'N° BON :')}</span>
                    <span className="font-bold font-mono" dir="ltr">{data.orderNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span dir="ltr">DATE: {data.date || new Date().toLocaleDateString('fr-FR')}</span>
                    <span dir="ltr">HEURE: {data.time}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('الكاشير:', 'CAISSIER :')}</span>
                    <span className="font-bold">{data.cashierName || 'Admin'}</span>
                  </div>
                  {data.tableNumber && (
                    <div className="flex justify-between">
                      <span>{t('الطاولة:', 'TABLE :')}</span>
                      <span className="font-bold" dir="ltr">{data.tableNumber}</span>
                    </div>
                  )}
                  {data.customerName && (
                    <div className="flex justify-between">
                      <span>{t('الزبون:', 'CLIENT :')}</span>
                      <span className="font-bold">{data.customerName}</span>
                    </div>
                  )}
                </div>

                {/* Items Table */}
                <div className="py-1 border-b border-dashed border-black">
                  <table className="w-full text-[10px] table-fixed">
                    <thead>
                      <tr className="border-b border-black">
                        <th className="pb-1 text-start w-[56%]">{t('الطبق / Article', 'Article / الطبق')}</th>
                        <th className="pb-1 text-center w-[14%]">{t('ك', 'Qté')}</th>
                        <th className="pb-1 text-end w-[30%]">{t('المبلغ', 'Total')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {data.items?.map((it: any, i: number) => (
                        <tr key={i} className="py-0.5">
                          <td className="py-1 leading-tight font-bold break-words text-start">
                            <span dir="rtl" className="block">{it.nameAr}</span>
                            {it.nameFr && (
                              <span dir="ltr" className="text-[9px] font-normal text-gray-700 block">
                                {it.nameFr}
                              </span>
                            )}
                            {it.selectedVariant && (
                              <span className="text-[9px] block font-normal text-gray-700">
                                ({it.selectedVariant.nameAr})
                              </span>
                            )}
                          </td>
                          <td className="py-1 text-center font-bold font-mono" dir="ltr">
                            {it.quantity}
                          </td>
                          <td className="py-1 text-end font-mono font-bold whitespace-nowrap" dir="ltr">
                            {Number(it.total ?? Number(it.unitPrice) * Number(it.quantity)).toLocaleString('en-US')} DA
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals & Payments */}
                <div className="space-y-0.5 py-1 border-b-2 border-black text-[10px]">
                  <div className="flex justify-between">
                    <span>{t('المجموع الفرعي (Sous-total):', 'Sous-total :')}</span>
                    <span className="font-bold font-mono" dir="ltr">
                      {Number(data.subtotal ?? data.total ?? 0).toLocaleString('en-US')} DA
                    </span>
                  </div>

                  {Number(data.discount || 0) > 0 && (
                    <div className="flex justify-between">
                      <span>{t('الخصم (Remise):', 'Remise :')}</span>
                      <span className="font-bold font-mono" dir="ltr">
                        -{Number(data.discount).toLocaleString('en-US')} DA
                      </span>
                    </div>
                  )}

                  {Number(data.deliveryFee || 0) > 0 && (
                    <div className="flex justify-between">
                      <span>{t('التوصيل (Livraison):', 'Livraison :')}</span>
                      <span className="font-bold font-mono" dir="ltr">
                        +{Number(data.deliveryFee).toLocaleString('en-US')} DA
                      </span>
                    </div>
                  )}

                  {Number(data.taxAmount || 0) > 0 && (
                    <div className="flex justify-between" data-testid="receipt-tax-row">
                      <span>
                        TVA {Number(data.taxRate || 0) > 0 ? `(${Number(data.taxRate)}%)` : ''}:
                      </span>
                      <span className="font-bold font-mono" dir="ltr">
                        +{Number(data.taxAmount).toLocaleString('en-US')} DA
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between text-xs font-black pt-1 border-t border-black">
                    <span>{t('الإجمالي المستحق (TOTAL):', 'TOTAL À PAYER :')}</span>
                    <span className="text-sm font-mono font-black" dir="ltr">
                      {totalAmount.toLocaleString('en-US')} DZD
                    </span>
                  </div>

                  {Number(data.tenderAmount || 0) > 0 && (
                    <>
                      <div className="flex justify-between text-[9px] pt-0.5">
                        <span>{t('المدفوع (Versé):', 'Versé :')}</span>
                        <span className="font-bold font-mono" dir="ltr">
                          {Number(data.tenderAmount).toLocaleString('en-US')} DZD
                        </span>
                      </div>
                      <div className="flex justify-between text-[9px]">
                        <span>{t('الصرف المرجع (Rendu):', 'Rendu :')}</span>
                        <span className="font-bold font-mono" dir="ltr">
                          {Number(data.changeAmount || 0).toLocaleString('en-US')} DZD
                        </span>
                      </div>
                    </>
                  )}

                  {remainingAmount > 0.01 && (
                    <div className="flex justify-between text-[10px] font-black text-black pt-0.5">
                      <span>{t('المتبقي للدفع (Reste):', 'Reste à payer :')}</span>
                      <span className="font-mono" dir="ltr">
                        {remainingAmount.toLocaleString('en-US')} DZD
                      </span>
                    </div>
                  )}

                  {paymentLegs.length > 0 ? (
                    <div className="pt-1 border-t border-dashed border-gray-400 space-y-0.5">
                      {paymentLegs.map((leg, idx) => (
                        <div key={idx} className="flex justify-between text-[9px]">
                          <span>{t(`الدفع (${leg.method}):`, `Paiement (${leg.method}) :`)}</span>
                          <span className="font-mono font-bold" dir="ltr">
                            {Number(leg.amount || 0).toLocaleString('en-US')} DA
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    data.paymentMethod && (
                      <div className="flex justify-between text-[9px] pt-0.5">
                        <span>{t('طريقة الدفع:', 'Mode paiement :')}</span>
                        <span className="font-bold font-mono">{data.paymentMethod}</span>
                      </div>
                    )
                  )}
                </div>

                {/* Footer */}
                <div className="pt-1.5 text-center text-[9px] space-y-1">
                  <p className="font-bold">{receiptFooter}</p>
                  <p className="font-bold tracking-wider">GOLDEN PALACE POS • LE PALAIS D’OR</p>
                  <div className="border border-black px-2 py-0.5 font-mono text-[8px] tracking-widest inline-block" dir="ltr">
                    * {data.orderNumber} *
                  </div>
                  {profile.cutPaper && (
                    <div className="text-[8px] text-gray-500 font-mono pt-1">
                      [ --- سكين القطع التلقائي / AUTO CUT --- ]
                    </div>
                  )}
                </div>

                {Array.from({ length: profile.feedAfter || 3 }).map((_, idx) => (
                  <div key={idx} className="h-3"></div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
