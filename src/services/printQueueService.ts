import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { exec, execFile } from 'child_process';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { printJobs } from '../db/schema.ts';
import type { PrinterConnectionType, SystemPrinterInfo } from '../types.ts';
import { buildArabicTestEscPos, buildFeedAndCutTestEscPos } from '../utils/escposArabic.ts';
import { sanitizeErrorMessage } from '../utils/redact.ts';

export interface PrintTransportResult {
  success: boolean;
  spoolerAccepted: boolean;
  hardwareConfirmed: boolean;
  mode: string;
  message: string;
  error?: string;
}

export type PrintTransportOverride = (params: {
  connectionType: PrinterConnectionType;
  printerName: string;
  targetIp?: string | null;
  targetPort?: number | null;
  copies: number;
  buffer: Buffer;
  orderNumber: string;
  isReprint: boolean;
}) => Promise<PrintTransportResult>;

let customTransportOverride: PrintTransportOverride | null = null;

export function setPrintTransportForTest(fn: PrintTransportOverride | null): void {
  customTransportOverride = fn;
}

export async function enumerateSystemPrinters(): Promise<{
  platform: string;
  isWindows: boolean;
  printers: SystemPrinterInfo[];
  supportedConnections: PrinterConnectionType[];
}> {
  const isWindows = process.platform === 'win32';
  const supportedConnections: PrinterConnectionType[] = isWindows
    ? ['WINDOWS_SPOOLER', 'NETWORK_IP', 'USB', 'BROWSER']
    : ['NETWORK_IP', 'USB', 'BROWSER'];

  if (!isWindows) {
    return {
      platform: process.platform,
      isWindows: false,
      printers: [],
      supportedConnections,
    };
  }

  const printers = await new Promise<SystemPrinterInfo[]>((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus,Default | ConvertTo-Json -Compress',
      ],
      { timeout: 4000 },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          return resolve([]);
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          const list = Array.isArray(parsed) ? parsed : [parsed];
          const mapped: SystemPrinterInfo[] = list
            .filter((p) => p && typeof p.Name === 'string' && p.Name.trim())
            .map((p) => ({
              name: String(p.Name).trim(),
              driverName: p.DriverName ? String(p.DriverName) : undefined,
              portName: p.PortName ? String(p.PortName) : undefined,
              status: p.PrinterStatus !== undefined ? String(p.PrinterStatus) : 'Unknown',
              isDefault: Boolean(p.Default),
              connectionType: 'WINDOWS_SPOOLER' as PrinterConnectionType,
            }));
          resolve(mapped);
        } catch {
          resolve([]);
        }
      }
    );
  });

  return {
    platform: process.platform,
    isWindows: true,
    printers,
    supportedConnections,
  };
}

export function isValidIpv4OrHost(value: string): boolean {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.length > 253) return false;
  return /^[a-zA-Z0-9.-]+$/.test(trimmed);
}

export async function sendToNetworkPrinter(
  ip: string,
  port: number,
  buffer: Buffer,
  copies = 1,
  timeoutMs = 3500
): Promise<PrintTransportResult> {
  const cleanIp = String(ip || '').trim();
  const cleanPort = Number.isFinite(Number(port)) && Number(port) > 0 && Number(port) <= 65535 ? Number(port) : 9100;

  if (!isValidIpv4OrHost(cleanIp)) {
    return {
      success: false,
      spoolerAccepted: false,
      hardwareConfirmed: false,
      mode: 'network_invalid_ip',
      message: 'عنوان IP للطابعة الشبكية غير صالح',
      error: 'INVALID_NETWORK_PRINTER_IP',
    };
  }

  for (let c = 0; c < copies; c++) {
    const attemptRes = await new Promise<{ ok: boolean; errMsg?: string }>((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const done = (ok: boolean, errMsg?: string) => {
        if (settled) return;
        settled = true;
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        resolve({ ok, errMsg });
      };

      socket.setTimeout(timeoutMs);
      socket.on('timeout', () => done(false, `انتهت مهلة الاتصال بالطابعة الشبكية ${cleanIp}:${cleanPort}`));
      socket.on('error', (err) => done(false, `تعذر الاتصال بالطابعة الشبكية (${cleanIp}:${cleanPort}): ${err.message}`));
      socket.connect(cleanPort, cleanIp, () => {
        socket.write(buffer, (writeErr) => {
          if (writeErr) {
            done(false, `فشل إرسال البيانات للطابعة الشبكية: ${writeErr.message}`);
          } else {
            socket.end(() => done(true));
          }
        });
      });
    });

    if (!attemptRes.ok) {
      return {
        success: false,
        spoolerAccepted: false,
        hardwareConfirmed: false,
        mode: 'network_failed',
        message: attemptRes.errMsg || 'فشل الاتصال بالطابعة الشبكية',
        error: attemptRes.errMsg || 'NETWORK_PRINTER_UNREACHABLE',
      };
    }
  }

  return {
    success: true,
    spoolerAccepted: true,
    hardwareConfirmed: true,
    mode: 'network_tcp_9100',
    message: `تم إرسال أمر الطباعة مباشرة إلى الطابعة الشبكية ${cleanIp}:${cleanPort} (${copies} نسخة).`,
  };
}

export async function sendToWindowsSpooler(
  printerName: string,
  buffer: Buffer,
  copies = 1,
  orderNumber = 'TICKET',
  isReprint = false
): Promise<PrintTransportResult> {
  if (process.platform !== 'win32') {
    return {
      success: false,
      spoolerAccepted: false,
      hardwareConfirmed: false,
      mode: 'windows_spooler_unavailable',
      message: 'خدمة Windows Spooler متاحة فقط على نظام Windows. يرجى استخدام الطباعة عبر المتصفح/Electron أو طابعة الشبكة IP.',
      error: 'WINDOWS_SPOOLER_NOT_ON_WINDOWS',
    };
  }

  const safePrinter = String(printerName || 'CAFETERIA').replace(/[^a-zA-Z0-9_\-. ]/g, '').trim() || 'CAFETERIA';
  const safeOrder = String(orderNumber || 'TICKET').replace(/[^a-zA-Z0-9_-]/g, '');
  const tempFilePath = path.join(os.tmpdir(), `gp_ticket_${safeOrder}_${Date.now()}_${isReprint ? 'dup' : 'orig'}.bin`);

  try {
    fs.writeFileSync(tempFilePath, buffer);
    const cmd = `copy /b "${tempFilePath}" "\\\\localhost\\${safePrinter}"`;

    for (let c = 0; c < copies; c++) {
      const execRes = await new Promise<{ ok: boolean; errMsg?: string }>((resolve) => {
        exec(cmd, { timeout: 6000 }, (err, stdout, stderr) => {
          if (err) {
            resolve({
              ok: false,
              errMsg: String(stderr || err.message || 'فشل إرسال البيانات إلى Windows Spooler').trim(),
            });
          } else {
            resolve({ ok: true });
          }
        });
      });

      if (!execRes.ok) {
        return {
          success: false,
          spoolerAccepted: false,
          hardwareConfirmed: false,
          mode: 'windows_spooler_failed',
          message: `فشل الإرسال إلى طابعة Windows (${safePrinter}): ${execRes.errMsg}`,
          error: execRes.errMsg,
        };
      }
    }

    // Note honestly: Windows copy/spooler acceptance does NOT guarantee paper physically exited
    return {
      success: true,
      spoolerAccepted: true,
      hardwareConfirmed: false,
      mode: 'spooled_to_windows',
      message: `تم قبول مهمة الطباعة في Windows Spooler (${safePrinter}) [${copies} نسخة] — بانتظار إخراج الورقة من الطابعة.`,
    };
  } finally {
    setTimeout(() => {
      try {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch {
        // ignore cleanup error
      }
    }, 3000).unref?.();
  }
}

export async function dispatchPrintTransport(params: {
  connectionType: PrinterConnectionType;
  printerName: string;
  targetIp?: string | null;
  targetPort?: number | null;
  copies: number;
  buffer: Buffer;
  orderNumber: string;
  isReprint: boolean;
  clientHandled?: boolean;
}): Promise<PrintTransportResult> {
  if (customTransportOverride) {
    return customTransportOverride(params);
  }

  if (params.connectionType === 'NETWORK_IP') {
    return sendToNetworkPrinter(
      params.targetIp || '',
      params.targetPort || 9100,
      params.buffer,
      params.copies
    );
  }

  if (params.connectionType === 'WINDOWS_SPOOLER') {
    return sendToWindowsSpooler(
      params.printerName,
      params.buffer,
      params.copies,
      params.orderNumber,
      params.isReprint
    );
  }

  // BROWSER / Electron silent print / USB WebSerial are executed client-side;
  // server records the job state honestly without claiming hardware exit unless confirmed.
  return {
    success: true,
    spoolerAccepted: Boolean(params.clientHandled),
    hardwareConfirmed: Boolean(params.clientHandled),
    mode: params.connectionType === 'USB' ? 'usb_client_ready' : 'browser_ready',
    message: params.clientHandled
      ? 'تم إرسال وتنفيذ مهمة الطباعة عبر واجهة سطح المكتب/المتصفح.'
      : 'تم تسجيل مهمة الطباعة وتجهيزها للتنفيذ عبر المتصفح.',
  };
}

export async function createAndProcessPrintJob(input: {
  orderId?: number | null;
  orderNumber: string;
  jobType?: string;
  printerName?: string;
  connectionType?: PrinterConnectionType;
  targetIp?: string | null;
  targetPort?: number | null;
  copies?: number;
  paperWidth?: string;
  isReprint?: boolean;
  jobKey?: string;
  requestedBy?: number | null;
  rawBase64?: string;
  textContent?: string;
  payloadPreview?: string;
  clientHandled?: boolean;
  clientError?: string | null;
}): Promise<{
  deduplicated: boolean;
  job: any;
  transportResult?: PrintTransportResult;
}> {
  const isReprint = Boolean(input.isReprint);
  const safeOrderNumber = String(input.orderNumber || 'UNKNOWN').trim() || 'UNKNOWN';
  const safePrinterName =
    String(input.printerName || 'CAFETERIA').replace(/[^a-zA-Z0-9_\-. ]/g, '').trim() || 'CAFETERIA';
  const jobType = String(input.jobType || 'RECEIPT').toUpperCase();
  const connectionType: PrinterConnectionType =
    input.connectionType && ['WINDOWS_SPOOLER', 'NETWORK_IP', 'USB', 'BROWSER'].includes(input.connectionType)
      ? input.connectionType
      : 'WINDOWS_SPOOLER';
  const copies = Math.max(1, Math.min(5, Number(input.copies) || 1));
  const paperWidth = input.paperWidth === '58mm' ? '58mm' : '80mm';
  const jobKey = input.jobKey
    ? String(input.jobKey)
    : isReprint
    ? `reprint_${safeOrderNumber}_${jobType}_${Date.now()}`
    : `orig_${safeOrderNumber}_${jobType}`;

  // Prevent automatic duplicate printing of the same jobKey when not an explicit reprint
  if (!isReprint) {
    const existing = await db
      .select()
      .from(printJobs)
      .where(eq(printJobs.jobKey, jobKey))
      .orderBy(desc(printJobs.id))
      .limit(1);

    if (existing.length > 0 && ['PENDING', 'PROCESSING', 'PRINTED'].includes(existing[0].status)) {
      return {
        deduplicated: true,
        job: existing[0],
      };
    }
  }

  const nowIso = new Date().toISOString();
  const inserted = await db
    .insert(printJobs)
    .values({
      orderId: input.orderId && Number(input.orderId) > 0 ? Number(input.orderId) : null,
      orderNumber: safeOrderNumber,
      jobType,
      printerName: safePrinterName,
      connectionType,
      targetIp: input.targetIp || null,
      targetPort: input.targetPort ? Number(input.targetPort) : 9100,
      copies,
      paperWidth,
      status: 'PENDING',
      isReprint,
      jobKey: isReprint ? `${jobKey}_${Math.random().toString(36).slice(2, 6)}` : jobKey,
      attempts: 1,
      requestedBy: input.requestedBy || null,
      spoolerAccepted: false,
      payloadPreview: input.payloadPreview || input.textContent?.slice(0, 500) || null,
      updatedAt: nowIso,
    })
    .returning();

  const jobRow = inserted[0];

  // Move to PROCESSING before dispatching
  await db
    .update(printJobs)
    .set({ status: 'PROCESSING', updatedAt: new Date().toISOString() })
    .where(eq(printJobs.id, jobRow.id));

  // If client already failed before contacting backend (e.g., WebSerial error or Electron silent print error)
  if (input.clientError) {
    const failedUpdated = await db
      .update(printJobs)
      .set({
        status: 'FAILED',
        errorMessage: String(input.clientError),
        spoolerAccepted: false,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(printJobs.id, jobRow.id))
      .returning();

    return {
      deduplicated: false,
      job: failedUpdated[0],
      transportResult: {
        success: false,
        spoolerAccepted: false,
        hardwareConfirmed: false,
        mode: 'client_failed',
        message: String(input.clientError),
        error: String(input.clientError),
      },
    };
  }

  const buffer = input.rawBase64
    ? Buffer.from(input.rawBase64, 'base64')
    : input.textContent
    ? Buffer.from(input.textContent, 'utf-8')
    : Buffer.from(`TICKET ${safeOrderNumber}\nGOLDEN PALACE POS\n\n\n`, 'utf-8');

  try {
    const transportResult = await dispatchPrintTransport({
      connectionType,
      printerName: safePrinterName,
      targetIp: input.targetIp,
      targetPort: input.targetPort,
      copies,
      buffer,
      orderNumber: safeOrderNumber,
      isReprint,
      clientHandled: input.clientHandled,
    });

    if (!transportResult.success) {
      const failedRows = await db
        .update(printJobs)
        .set({
          status: 'FAILED',
          errorMessage: transportResult.error || transportResult.message,
          spoolerAccepted: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(printJobs.id, jobRow.id))
        .returning();

      return {
        deduplicated: false,
        job: failedRows[0],
        transportResult,
      };
    }

    const doneRows = await db
      .update(printJobs)
      .set({
        status: 'PRINTED',
        spoolerAccepted: transportResult.spoolerAccepted,
        confirmedAt: transportResult.hardwareConfirmed ? new Date().toISOString() : null,
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(printJobs.id, jobRow.id))
      .returning();

    return {
      deduplicated: false,
      job: doneRows[0],
      transportResult,
    };
  } catch (err: any) {
    const errMsg = sanitizeErrorMessage(err) || 'فشل غير متوقع أثناء الطباعة';
    const failedRows = await db
      .update(printJobs)
      .set({
        status: 'FAILED',
        errorMessage: errMsg,
        spoolerAccepted: false,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(printJobs.id, jobRow.id))
      .returning();

    return {
      deduplicated: false,
      job: failedRows[0],
      transportResult: {
        success: false,
        spoolerAccepted: false,
        hardwareConfirmed: false,
        mode: 'exception',
        message: errMsg,
        error: errMsg,
      },
    };
  }
}

export async function retryExistingPrintJob(
  jobId: number,
  overrideRawBase64?: string
): Promise<{ job: any; transportResult: PrintTransportResult }> {
  const rows = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
  if (rows.length === 0) {
    throw new Error('مهمة الطباعة غير موجودة');
  }
  const existing = rows[0];
  if (existing.status === 'PRINTED') {
    throw new Error('هذه المهمة مطبوعة بالفعل. استخدم «إعادة طباعة» لطباعة نسخة إضافية.');
  }

  await db
    .update(printJobs)
    .set({
      status: 'PROCESSING',
      attempts: Number(existing.attempts || 1) + 1,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(printJobs.id, jobId));

  const buffer = overrideRawBase64
    ? Buffer.from(overrideRawBase64, 'base64')
    : Buffer.from(
        existing.payloadPreview || `RETRY TICKET ${existing.orderNumber}\nGOLDEN PALACE POS\n\n\n`,
        'utf-8'
      );

  const transportResult = await dispatchPrintTransport({
    connectionType: (existing.connectionType as PrinterConnectionType) || 'WINDOWS_SPOOLER',
    printerName: existing.printerName,
    targetIp: existing.targetIp,
    targetPort: existing.targetPort,
    copies: existing.copies || 1,
    buffer,
    orderNumber: existing.orderNumber,
    isReprint: existing.isReprint,
  });

  const updated = await db
    .update(printJobs)
    .set({
      status: transportResult.success ? 'PRINTED' : 'FAILED',
      spoolerAccepted: transportResult.spoolerAccepted,
      confirmedAt: transportResult.hardwareConfirmed ? new Date().toISOString() : null,
      errorMessage: transportResult.success ? null : transportResult.error || transportResult.message,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(printJobs.id, jobId))
    .returning();

  return { job: updated[0], transportResult };
}

export async function runLivePrinterTest(params: {
  testType: 'STANDARD' | 'ARABIC' | 'FEED_CUT';
  printerName: string;
  connectionType: PrinterConnectionType;
  targetIp?: string | null;
  targetPort?: number | null;
  paperWidth?: '58mm' | '80mm';
  arabicEncoding?: 'CP864' | 'WINDOWS_1256' | 'UTF8';
  requestedBy?: number | null;
}): Promise<{ job: any; transportResult?: PrintTransportResult }> {
  const paperWidth = params.paperWidth === '58mm' ? '58mm' : '80mm';
  const rawBytes =
    params.testType === 'FEED_CUT'
      ? buildFeedAndCutTestEscPos(4, true)
      : buildArabicTestEscPos({
          paperType: paperWidth,
          arabicEncoding: params.arabicEncoding || 'CP864',
          printerName: params.printerName,
          cutPaper: true,
        });

  const rawBase64 = Buffer.from(rawBytes).toString('base64');
  const res = await createAndProcessPrintJob({
    orderNumber: `TEST-${params.testType}-${Date.now()}`,
    jobType: 'TEST',
    printerName: params.printerName,
    connectionType: params.connectionType,
    targetIp: params.targetIp,
    targetPort: params.targetPort,
    copies: 1,
    paperWidth,
    isReprint: true, // tests can always be run repeatedly
    requestedBy: params.requestedBy,
    rawBase64,
    payloadPreview: `TEST ${params.testType} (${paperWidth}) -> ${params.connectionType}`,
    clientHandled: params.connectionType === 'BROWSER',
  });

  return { job: res.job, transportResult: res.transportResult };
}
