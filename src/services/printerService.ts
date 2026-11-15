import {
  ArabicEscPosEncoding,
  PrinterConnectionType,
  PrinterProfile,
  PrintJobResult,
} from '../types.ts';
import { api } from './api.ts';
import {
  encodeEscPosLine,
  formatTwoColLine,
  getColumnsForPaper,
} from '../utils/escposArabic.ts';

const PRINTER_PROFILE_KEY = 'grine_restaurant_printer_profile';
const LAST_RECEIPT_KEY = 'grine_restaurant_last_receipt';

declare global {
  interface Window {
    goldenPalaceDesktop?: {
      isDesktop: boolean;
      platform: string;
      appVersion?: string;
      getPrinters?: () => Promise<any[]>;
      printSilent?: (options: { deviceName?: string; copies?: number }) => Promise<{ success: boolean; error?: string }>;
      getDesktopInfo?: () => Promise<any>;
    };
  }
}

export const DEFAULT_PRINTER_PROFILE: PrinterProfile = {
  name: 'CAFETERIA 80mm',
  printerName: 'CAFETERIA',
  driver: '80Normal',
  connectionType: 'WINDOWS_SPOOLER',
  networkIp: '',
  networkPort: 9100,
  arabicEncoding: 'CP864',
  paperType: '80mm',
  paperWidth: 80,
  printableWidth: 70, // 70mm safe margin to prevent left-side clipping on Windows 80Normal driver
  margins: 0,
  scale: 100,
  orientation: 'PORTRAIT',
  feedBefore: 0,
  feedAfter: 4,
  copies: 1,
  cutPaper: true,
  cashDrawer: true,
  printMethod: 'BROWSER',
  bridgeUrl: 'ws://localhost:8182',
};

// Safe printable width choices for 80mm and 58mm thermal printers
export const PRINTABLE_WIDTH_OPTIONS = [
  { value: 48, label: '48mm (قياسي لطابعات 58mm الصغيرة)' },
  { value: 50, label: '50mm (موسع لطابعات 58mm)' },
  { value: 68, label: '68mm (أقصى حماية لطابعات 80mm)' },
  { value: 70, label: '70mm (★ الوضع الموصى به لمنع قص اليسار في 80Normal)' },
  { value: 72, label: '72mm (القياسي لرأس الطباعة 576 dots)' },
  { value: 74, label: '74mm (عرض واسع)' },
  { value: 80, label: '80mm (كامل عرض الورقة 80mm)' },
];

export const printerService = {
  // Load current printer profile
  getProfile(): PrinterProfile {
    try {
      const stored = localStorage.getItem(PRINTER_PROFILE_KEY);
      if (stored) {
        return { ...DEFAULT_PRINTER_PROFILE, ...JSON.parse(stored) };
      }
    } catch {
      // Fallback
    }
    return DEFAULT_PRINTER_PROFILE;
  },

  // Save printer profile
  saveProfile(profile: PrinterProfile): void {
    localStorage.setItem(PRINTER_PROFILE_KEY, JSON.stringify(profile));
    this.applyPrintStyles(profile);
  },

  // Merge persisted SQLite printer settings into local profile without overwriting missing keys
  applySettingsProfile(settings?: Record<string, string> | null): PrinterProfile {
    const current = this.getProfile();
    if (!settings || typeof settings !== 'object') return current;
    let changed = false;
    const next: PrinterProfile = { ...current };

    if (settings.printer_name && settings.printer_name !== next.printerName) {
      next.printerName = settings.printer_name;
      changed = true;
    }
    if (settings.printer_driver && settings.printer_driver !== next.driver) {
      next.driver = settings.printer_driver;
      changed = true;
    }
    if (
      settings.printer_connection_type === 'WINDOWS_SPOOLER' ||
      settings.printer_connection_type === 'NETWORK_IP' ||
      settings.printer_connection_type === 'USB' ||
      settings.printer_connection_type === 'BROWSER'
    ) {
      if (settings.printer_connection_type !== next.connectionType) {
        next.connectionType = settings.printer_connection_type;
        changed = true;
      }
    }
    if (settings.printer_network_ip !== undefined && settings.printer_network_ip !== next.networkIp) {
      next.networkIp = settings.printer_network_ip;
      changed = true;
    }
    if (settings.printer_network_port) {
      const pPort = Number(settings.printer_network_port);
      if (Number.isFinite(pPort) && pPort > 0 && pPort <= 65535 && pPort !== next.networkPort) {
        next.networkPort = pPort;
        changed = true;
      }
    }
    if (
      settings.printer_arabic_encoding === 'CP864' ||
      settings.printer_arabic_encoding === 'WINDOWS_1256' ||
      settings.printer_arabic_encoding === 'UTF8'
    ) {
      if (settings.printer_arabic_encoding !== next.arabicEncoding) {
        next.arabicEncoding = settings.printer_arabic_encoding;
        changed = true;
      }
    }
    if (settings.paper_type === '58mm' || settings.paper_type === '80mm' || settings.paper_type === 'A4') {
      if (settings.paper_type !== next.paperType) {
        next.paperType = settings.paper_type;
        next.paperWidth = settings.paper_type === '58mm' ? 58 : settings.paper_type === 'A4' ? 210 : 80;
        changed = true;
      }
    }
    if (settings.printable_width) {
      const pw = Number(settings.printable_width);
      if (Number.isFinite(pw) && pw >= 40 && pw <= 210 && pw !== next.printableWidth) {
        next.printableWidth = pw;
        changed = true;
      }
    }
    if (settings.printer_copies) {
      const cp = Math.max(1, Math.min(5, Number(settings.printer_copies) || 1));
      if (cp !== next.copies) {
        next.copies = cp;
        changed = true;
      }
    }
    if (
      settings.print_method === 'BROWSER' ||
      settings.print_method === 'ESCPOS_RAW' ||
      settings.print_method === 'LOCAL_BRIDGE'
    ) {
      if (settings.print_method !== next.printMethod) {
        next.printMethod = settings.print_method;
        changed = true;
      }
    }
    if (settings.printer_feed_after) {
      const fa = Math.max(1, Math.min(8, Number(settings.printer_feed_after) || 4));
      if (fa !== next.feedAfter) {
        next.feedAfter = fa;
        changed = true;
      }
    }
    if (settings.printer_cut_paper !== undefined) {
      const cut = settings.printer_cut_paper !== 'false';
      if (cut !== next.cutPaper) {
        next.cutPaper = cut;
        changed = true;
      }
    }
    if (settings.printer_cash_drawer !== undefined) {
      const cd = settings.printer_cash_drawer !== 'false';
      if (cd !== next.cashDrawer) {
        next.cashDrawer = cd;
        changed = true;
      }
    }
    if (changed) {
      this.saveProfile(next);
    }
    return next;
  },

  // Apply print styles and @page size dynamically to DOM
  applyPrintStyles(profile: PrinterProfile): void {
    document.documentElement.style.setProperty(
      '--receipt-printable-width',
      `${profile.printableWidth}mm`
    );
    document.documentElement.style.setProperty(
      '--receipt-margins',
      `${profile.margins}mm`
    );

    let styleTag = document.getElementById('thermal-page-style');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'thermal-page-style';
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = `
      @page {
        size: ${profile.printableWidth}mm auto !important;
        margin: 0mm !important;
      }
    `;
  },

  // Generate direct Windows CMD spooling command
  getWindowsSpoolCommand(filename = 'ticket.prn', printerName = 'CAFETERIA'): string {
    return `copy /b "${filename}" "\\\\localhost\\${printerName}"`;
  },

  // Generate PowerShell raw direct print command
  getPowerShellSpoolCommand(filename = 'ticket.prn', printerName = 'CAFETERIA'): string {
    return `Get-Content -Path ".\\${filename}" -Encoding Byte -Raw | Out-Printer -Name "${printerName}"`;
  },

  // Reset to default
  resetProfile(): PrinterProfile {
    localStorage.removeItem(PRINTER_PROFILE_KEY);
    this.saveProfile(DEFAULT_PRINTER_PROFILE);
    return DEFAULT_PRINTER_PROFILE;
  },

  // Save last printed receipt for reprint feature
  setLastReceipt(data: any): void {
    try {
      localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(data));
    } catch {
      // Ignore
    }
  },

  // Retrieve last printed receipt
  getLastReceipt(): any | null {
    try {
      const stored = localStorage.getItem(LAST_RECEIPT_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      // Ignore
    }
    return null;
  },

  // Generate ESC/POS raw byte sequence with Arabic RTL contextual shaping + French LTR support + 58mm/80mm formatting
  generateEscPosCommands(receiptData: any, profile: PrinterProfile): Uint8Array {
    const encoding: ArabicEscPosEncoding = profile.arabicEncoding || 'CP864';
    const cols = getColumnsForPaper(profile.paperType);
    const sep = '-'.repeat(cols);
    const bytes: number[] = [];

    const pushLine = (line: string) => {
      bytes.push(...encodeEscPosLine(line, encoding));
    };

    // 1. Initialize printer: ESC @
    bytes.push(0x1b, 0x40);

    // Select thermal Arabic codepage
    if (encoding === 'CP864') {
      bytes.push(0x1b, 0x74, 22);
    } else if (encoding === 'WINDOWS_1256') {
      bytes.push(0x1b, 0x74, 37);
    }

    // 2. Open Cash Drawer if enabled
    if (profile.cashDrawer) {
      bytes.push(0x1b, 0x70, 0x00, 0x19, 0xfa);
    }

    // 3. Pre-feed lines
    if (profile.feedBefore > 0) {
      bytes.push(0x1b, 0x64, profile.feedBefore);
    }

    // 4. Center align Header
    bytes.push(0x1b, 0x61, 0x01);
    pushLine(receiptData.restaurantName || 'GOLDEN PALACE POS');
    pushLine(receiptData.restaurantBrand || "LE PALAIS D'OR - القصر الذهبي");
    if (receiptData.restaurantAddress) {
      pushLine(receiptData.restaurantAddress);
    }
    if (receiptData.restaurantPhone) {
      pushLine(`TEL: ${receiptData.restaurantPhone}`);
    }
    if (receiptData.isReprint) {
      pushLine('*** REPRINT / DUPLICATA ***');
      pushLine('*** نسخة معاد طباعتها ***');
    }
    pushLine(sep);

    // Order info
    bytes.push(0x1b, 0x61, 0x00);
    pushLine(formatTwoColLine('N° BON / الفاتورة:', receiptData.orderNumber || 'BON-0000', cols));
    pushLine(
      formatTwoColLine(
        `DATE: ${receiptData.date || ''}`,
        `HEURE: ${receiptData.time || ''}`,
        cols
      )
    );
    pushLine(`CAISSIER: ${receiptData.cashierName || 'Admin'}`);
    if (receiptData.tableNumber) {
      pushLine(`TABLE: ${receiptData.tableNumber}`);
    }
    if (receiptData.customerName) {
      pushLine(`CLIENT: ${receiptData.customerName}`);
    }
    pushLine(sep);

    // Items
    if (receiptData.items && Array.isArray(receiptData.items)) {
      for (const item of receiptData.items) {
        const qty = `${item.quantity}x `;
        const title = item.nameFr && item.nameAr ? `${item.nameAr} (${item.nameFr})` : item.nameAr || item.nameFr || 'Article';
        const lineTotal = Number(item.total ?? Number(item.unitPrice) * Number(item.quantity));
        const priceStr = `${lineTotal.toLocaleString('en-US')} DA`;
        pushLine(formatTwoColLine(`${qty}${title}`, priceStr, cols));

        if (item.selectedVariant?.nameAr) {
          pushLine(`   * ${item.selectedVariant.nameAr}`);
        }
        if (Array.isArray(item.selectedAddons) && item.selectedAddons.length > 0) {
          for (const add of item.selectedAddons) {
            pushLine(`   + ${add.nameAr} (${Number(add.price || 0)} DA)`);
          }
        }
      }
    }
    pushLine(sep);

    const subtotal = Number(receiptData.subtotal ?? receiptData.total ?? 0);
    const discount = Number(receiptData.discount || 0);
    const deliveryFee = Number(receiptData.deliveryFee || 0);
    const taxRate = Number(receiptData.taxRate || 0);
    const taxAmount = Number(receiptData.taxAmount || 0);
    const total = Number(receiptData.total || 0);
    const paidAmount = Number(
      receiptData.paidAmount ?? (receiptData.tenderAmount > 0 ? Math.min(total, receiptData.tenderAmount) : total)
    );
    const remainingAmount = Math.max(0, total - paidAmount);

    pushLine(formatTwoColLine('Sous-total:', `${subtotal.toLocaleString('en-US')} DZD`, cols));
    if (discount > 0) {
      pushLine(formatTwoColLine('Remise / الخصم:', `-${discount.toLocaleString('en-US')} DZD`, cols));
    }
    if (deliveryFee > 0) {
      pushLine(formatTwoColLine('Livraison / التوصيل:', `+${deliveryFee.toLocaleString('en-US')} DZD`, cols));
    }
    if (taxAmount > 0) {
      pushLine(
        formatTwoColLine(
          `TVA${taxRate > 0 ? ` (${taxRate}%)` : ''}:`,
          `+${taxAmount.toLocaleString('en-US')} DZD`,
          cols
        )
      );
    }

    // Bold TOTAL
    bytes.push(0x1b, 0x45, 0x01);
    pushLine(formatTwoColLine('TOTAL:', `${total.toLocaleString('en-US')} DZD`, cols));
    bytes.push(0x1b, 0x45, 0x00);

    if (receiptData.tenderAmount > 0) {
      pushLine(
        formatTwoColLine('Verse / المدفوع:', `${Number(receiptData.tenderAmount).toLocaleString('en-US')} DZD`, cols)
      );
      pushLine(
        formatTwoColLine('Rendu / الباقي:', `${Number(receiptData.changeAmount || 0).toLocaleString('en-US')} DZD`, cols)
      );
    }
    if (remainingAmount > 0.01) {
      pushLine(
        formatTwoColLine('Reste / المتبقي:', `${remainingAmount.toLocaleString('en-US')} DZD`, cols)
      );
    }
    if (Array.isArray(receiptData.payments) && receiptData.payments.length > 0) {
      for (const leg of receiptData.payments) {
        pushLine(formatTwoColLine(`PAY (${leg.method}):`, `${Number(leg.amount || 0).toLocaleString('en-US')} DA`, cols));
      }
    } else if (receiptData.paymentMethod) {
      pushLine(`PAIEMENT: ${receiptData.paymentMethod}`);
    }

    // Footer
    bytes.push(0x1b, 0x61, 0x01);
    pushLine(sep);
    pushLine(receiptData.receiptFooter || 'Merci de votre visite - شكرا لزيارتكم');
    pushLine("GOLDEN PALACE POS • LE PALAIS D'OR");

    const postFeed = profile.feedAfter > 0 ? profile.feedAfter : 3;
    bytes.push(0x1b, 0x64, postFeed);

    if (profile.cutPaper) {
      bytes.push(0x1d, 0x56, 0x42, 0x00);
    }

    return new Uint8Array(bytes);
  },

  // Download raw ESC/POS file (.prn/.bin) for direct spooling
  downloadEscPosFile(receiptData: any, profile: PrinterProfile, filename = 'receipt.prn'): void {
    const rawData = this.generateEscPosCommands(receiptData, profile);
    const blob = new Blob([rawData as unknown as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // Cache of completed job keys (strictly populated ONLY on successful print/spool)
  _completedPrintJobs: (() => {
    try {
      const stored = localStorage.getItem('gp_completed_print_jobs');
      return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  })(),
  _recentPrintJobs: new Map<string, number>(),
  _activePrintJobs: new Set<string>(),

  _persistCompletedJobs(): void {
    try {
      const arr = Array.from(this._completedPrintJobs).slice(-200);
      localStorage.setItem('gp_completed_print_jobs', JSON.stringify(arr));
    } catch {
      // Ignore storage errors
    }
  },

  isJobCompleted(receiptData: any): boolean {
    if (!receiptData) return false;
    if (receiptData.alreadyAutoPrinted) return true;
    const orderId =
      receiptData.orderNumber ||
      receiptData.id ||
      receiptData.orderId ||
      receiptData.dailySequence ||
      'unknown';
    const ticketType = receiptData.isKitchenTicket
      ? 'kitchen'
      : receiptData.isAddition
      ? 'addition'
      : 'receipt';
    const originalJobKey = `orig_${orderId}_${ticketType}`;
    return this._completedPrintJobs.has(originalJobKey);
  },

  // Resolve effective connection type from profile (never fakes unsupported Bluetooth/drivers)
  resolveConnectionType(profile: PrinterProfile): PrinterConnectionType {
    if (profile.connectionType) return profile.connectionType;
    return profile.printMethod === 'ESCPOS_RAW' ? 'WINDOWS_SPOOLER' : 'BROWSER';
  },

  // Dispatch print job via persistent SQLite print_jobs queue + selected physical/system transport
  async sendDirectPrintJob(
    receiptData: any,
    profile: PrinterProfile,
    options: { isReprint?: boolean } = {}
  ): Promise<
    PrintJobResult & {
      message: string;
    }
  > {
    this.applyPrintStyles(profile);
    this.setLastReceipt(receiptData);

    const isReprint = Boolean(options.isReprint);
    const orderRef =
      receiptData.orderNumber ||
      receiptData.id ||
      receiptData.orderId ||
      receiptData.dailySequence ||
      'unknown';
    const ticketType = receiptData.isKitchenTicket
      ? 'KITCHEN'
      : receiptData.isAddition
      ? 'ADDITION'
      : 'RECEIPT';

    const originalJobKey = `orig_${orderRef}_${ticketType.toLowerCase()}`;
    const jobKey = isReprint
      ? `reprint_${orderRef}_${ticketType.toLowerCase()}_${Date.now()}`
      : String(receiptData.printJobId || originalJobKey);

    const now = Date.now();

    if (this._activePrintJobs.has(jobKey) || (!isReprint && this._activePrintJobs.has(originalJobKey))) {
      return {
        success: true,
        method: 'DEDUP',
        status: 'PROCESSING',
        message: 'جاري تنفيذ أمر الطباعة لهذا الطلب حالياً، يرجى الانتظار.',
        timestamp: new Date().toISOString(),
      };
    }

    if (!isReprint) {
      if (this._completedPrintJobs.has(originalJobKey) || receiptData.alreadyAutoPrinted) {
        return {
          success: true,
          method: 'DEDUP',
          status: 'PRINTED',
          message:
            'تم إصدار وصل هذا الطلب بالفعل (وصل واحد فقط لكل طلب). استخدم زر «إعادة طباعة الوصل» عند الحاجة.',
          timestamp: new Date().toISOString(),
        };
      }

      if (this._recentPrintJobs.has(originalJobKey)) {
        const prev = this._recentPrintJobs.get(originalJobKey)!;
        if (now - prev < 5000) {
          return {
            success: true,
            method: 'DEDUP',
            status: 'PROCESSING',
            message: 'تم إرسال أمر الطباعة لهذا الطلب للتو.',
            timestamp: new Date().toISOString(),
          };
        }
      }
    }

    this._activePrintJobs.add(jobKey);
    if (!isReprint) {
      this._activePrintJobs.add(originalJobKey);
    }
    this._recentPrintJobs.set(originalJobKey, now);

    const numCopies = Math.max(1, Math.min(5, Number(profile.copies) || 1));
    const connectionType = this.resolveConnectionType(profile);
    const payloadPreview = `FACTURE ${receiptData.orderNumber || ''} | TOTAL ${receiptData.total || 0} DA`;

    try {
      const rawBytes = this.generateEscPosCommands({ ...receiptData, isReprint }, profile);
      let rawBase64 = '';
      for (let i = 0; i < rawBytes.length; i++) {
        rawBase64 += String.fromCharCode(rawBytes[i]);
      }
      rawBase64 = btoa(rawBase64);

      // Route A: BROWSER / Electron Silent Print (executes print dialog/silent then logs persistent print_job)
      if (connectionType === 'BROWSER') {
        let clientHandled = false;
        let clientError: string | null = null;
        try {
          if (window.goldenPalaceDesktop?.printSilent) {
            const elecRes = await window.goldenPalaceDesktop.printSilent({
              deviceName: profile.printerName,
              copies: numCopies,
            });
            if (!elecRes.success) {
              throw new Error(elecRes.error || 'فشلت الطباعة عبر نظام Windows/Electron');
            }
            clientHandled = true;
          } else {
            window.print();
            clientHandled = true;
          }
        } catch (err: any) {
          clientError = err?.message || 'فشل تشغيل نافذة الطباعة';
        }

        const spoolRes = await api
          .spoolPrintJob({
            orderId: receiptData.orderId || null,
            orderNumber: String(receiptData.orderNumber || orderRef),
            jobType: ticketType,
            printerName: profile.printerName,
            connectionType: 'BROWSER',
            paperWidth: profile.paperType === '58mm' ? '58mm' : '80mm',
            copies: numCopies,
            printJobId: jobKey,
            isReprint,
            payloadPreview,
            clientHandled,
            clientError,
          })
          .catch((e: any) => ({ success: false, error: e?.message }));

        if (clientError) {
          return {
            success: false,
            jobId: spoolRes?.jobId,
            method: 'BROWSER',
            status: 'FAILED',
            error: clientError,
            message: clientError,
            timestamp: new Date().toISOString(),
          };
        }

        if (!isReprint) {
          this._completedPrintJobs.add(originalJobKey);
          this._persistCompletedJobs();
        }
        return {
          success: true,
          jobId: spoolRes?.jobId,
          method: 'BROWSER',
          status: 'PRINTED',
          spoolerAccepted: true,
          hardwareConfirmed: Boolean(window.goldenPalaceDesktop?.printSilent),
          message: window.goldenPalaceDesktop?.printSilent
            ? `تم إرسال الوصل مباشرة عبر طابعة Windows (${profile.printerName}).`
            : `تم فتح نافذة الطباعة الحرارية بنجاح (${numCopies} نسخة).`,
          timestamp: new Date().toISOString(),
        };
      }

      // Route B: USB Web Serial (client-side serial port write + persistent print_job logging)
      if (connectionType === 'USB') {
        let clientError: string | null = null;
        try {
          await this.printViaWebSerial({ ...receiptData, isReprint }, profile);
        } catch (err: any) {
          clientError = err?.message || 'فشل الإرسال عبر منفذ USB/Serial';
        }

        const spoolRes = await api
          .spoolPrintJob({
            orderId: receiptData.orderId || null,
            orderNumber: String(receiptData.orderNumber || orderRef),
            jobType: ticketType,
            printerName: profile.printerName,
            connectionType: 'USB',
            paperWidth: profile.paperType === '58mm' ? '58mm' : '80mm',
            copies: numCopies,
            printJobId: jobKey,
            isReprint,
            rawBase64,
            payloadPreview,
            clientHandled: !clientError,
            clientError,
          })
          .catch((e: any) => ({ success: false, error: e?.message }));

        if (clientError) {
          return {
            success: false,
            jobId: spoolRes?.jobId,
            method: 'USB',
            status: 'FAILED',
            error: clientError,
            message: clientError,
            timestamp: new Date().toISOString(),
          };
        }

        if (!isReprint) {
          this._completedPrintJobs.add(originalJobKey);
          this._persistCompletedJobs();
        }
        return {
          success: true,
          jobId: spoolRes?.jobId,
          method: 'USB',
          status: 'PRINTED',
          spoolerAccepted: true,
          hardwareConfirmed: true,
          message: 'تم إرسال الوصل مباشرة عبر منفذ USB بنجاح.',
          timestamp: new Date().toISOString(),
        };
      }

      // Route C: WINDOWS_SPOOLER or NETWORK_IP (dispatched & verified on backend)
      const spoolRes = await api.spoolPrintJob({
        orderId: receiptData.orderId || null,
        orderNumber: String(receiptData.orderNumber || orderRef),
        jobType: ticketType,
        printerName: profile.printerName,
        connectionType,
        targetIp: profile.networkIp || null,
        targetPort: profile.networkPort || 9100,
        paperWidth: profile.paperType === '58mm' ? '58mm' : '80mm',
        rawBase64,
        payloadPreview,
        copies: numCopies,
        printJobId: jobKey,
        isReprint,
      });

      if (!spoolRes || spoolRes.success === false) {
        return {
          success: false,
          jobId: spoolRes?.jobId,
          method: connectionType,
          status: 'FAILED',
          spoolerAccepted: false,
          hardwareConfirmed: false,
          error: spoolRes?.error || spoolRes?.message || 'فشل إرسال أمر الطباعة',
          message: spoolRes?.error || spoolRes?.message || 'فشل إرسال أمر الطباعة',
          timestamp: new Date().toISOString(),
        };
      }

      if (!isReprint) {
        this._completedPrintJobs.add(originalJobKey);
        this._persistCompletedJobs();
      }

      if (spoolRes.mode === 'deduplicated') {
        return {
          success: true,
          jobId: spoolRes.jobId,
          method: 'DEDUP',
          status: 'PRINTED',
          spoolerAccepted: Boolean(spoolRes.spoolerAccepted),
          hardwareConfirmed: Boolean(spoolRes.hardwareConfirmed),
          message: spoolRes.message || 'تم منع تكرار الطباعة (وصل واحد فقط لكل طلب).',
          timestamp: new Date().toISOString(),
        };
      }

      return {
        success: true,
        jobId: spoolRes.jobId,
        method: connectionType,
        status: 'PRINTED',
        spoolerAccepted: Boolean(spoolRes.spoolerAccepted),
        hardwareConfirmed: Boolean(spoolRes.hardwareConfirmed),
        message:
          spoolRes.message ||
          `تم إرسال الوصل إلى طابعة (${profile.printerName}) [${numCopies} نسخة].`,
        timestamp: new Date().toISOString(),
      };
    } catch (spoolErr: any) {
      const errMsg = spoolErr?.message || 'فشل إرسال أمر الطباعة إلى الطابعة';
      console.error('Spool print job error:', errMsg);
      return {
        success: false,
        method: connectionType,
        status: 'FAILED',
        spoolerAccepted: false,
        hardwareConfirmed: false,
        error: errMsg,
        message: errMsg,
        timestamp: new Date().toISOString(),
      };
    } finally {
      this._activePrintJobs.delete(jobKey);
      if (!isReprint) {
        this._activePrintJobs.delete(originalJobKey);
      }
    }
  },

  // Direct USB / Serial POS printer via Web Serial API
  async printViaWebSerial(receiptData: any, profile: PrinterProfile): Promise<boolean> {
    if (!('serial' in navigator)) {
      throw new Error('المتصفح/النظام لا يدعم Web Serial API للطباعة المباشرة عبر USB.');
    }
    const navSerial = (navigator as any).serial;
    const port = await navSerial.requestPort();
    await port.open({ baudRate: 9600 });
    const writer = port.writable.getWriter();
    const rawData = this.generateEscPosCommands(receiptData, profile);
    await writer.write(rawData);
    writer.releaseLock();
    await port.close();
    return true;
  },

  // System Test Receipt Data
  generateTestReceiptData(profile: PrinterProfile): any {
    return {
      isDiagnosticTest: true,
      orderNumber: 'TEST-GRINE-001',
      date: new Date().toLocaleDateString('fr-FR'),
      time: new Date().toLocaleTimeString('fr-FR'),
      cashierName: 'Admin (LE PALAIS D’OR)',
      tableNumber: 'TEST',
      orderType: `اختبار طابعة حرارية ${profile.paperType}`,
      items: [
        {
          nameAr: 'طاكوس بولي',
          nameFr: 'Tacos Poulet',
          quantity: 1,
          unitPrice: 400,
          total: 400,
        },
        {
          nameAr: 'بيتزا مارغوريت (حجم L)',
          nameFr: 'Pizza Margherita',
          quantity: 1,
          unitPrice: 350,
          total: 350,
        },
        {
          nameAr: 'عصير كوكتال',
          nameFr: 'Jus Cocktail',
          quantity: 1,
          unitPrice: 250,
          total: 250,
        },
      ],
      subtotal: 1000,
      discount: 0,
      deliveryFee: 0,
      taxRate: 0,
      taxAmount: 0,
      total: 1000,
      paidAmount: 1000,
      tenderAmount: 1000,
      changeAmount: 0,
      paymentMethod: 'CASH',
      printableWidth: profile.printableWidth,
      printerName: profile.printerName,
      driver: profile.driver,
    };
  },
};
