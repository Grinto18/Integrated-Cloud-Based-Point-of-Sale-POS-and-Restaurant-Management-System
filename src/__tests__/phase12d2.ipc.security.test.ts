// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ipcSecurity = require('../../electron/ipcSecurity.cjs');

function loadPreloadInSandboxedContext(invokeMock: ReturnType<typeof vi.fn>) {
  const preloadCode = fs.readFileSync(path.resolve(process.cwd(), 'electron/preload.cjs'), 'utf8');
  let exposedName: string | null = null;
  let exposedApi: any = null;

  const sandboxedRequire = (id: string) => {
    if (id === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld: (name: string, api: any) => {
            exposedName = name;
            exposedApi = api;
          },
        },
        ipcRenderer: {
          invoke: invokeMock,
        },
      };
    }
    throw new Error(`Disallowed module require in sandboxed preload: ${id}`);
  };

  // Deliberately omit Node globals (fs, process, Buffer, __dirname) to verify sandbox: true compatibility
  const context = vm.createContext({
    require: sandboxedRequire,
    Object,
    Array,
    Set,
    String,
    Number,
    Boolean,
    Promise,
    Error,
    JSON,
  });

  const fn = vm.runInContext(
    `(function(require, Object, Array, Set, String, Number, Boolean, Promise, Error, JSON) { ${preloadCode} })`,
    context
  );
  fn(sandboxedRequire, Object, Array, Set, String, Number, Boolean, Promise, Error, JSON);

  return { exposedName, exposedApi };
}

function loadMainProcessIpcHarness(serverPort = 3456) {
  const mainCode = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();

  const mockPrint = vi.fn((opts: any, cb: (ok: boolean, reason?: string) => void) => {
    cb(true, undefined);
  });
  const mockGetPrintersAsync = vi.fn(async () => [
    {
      name: 'CAFETERIA',
      displayName: 'CAFETERIA Thermal 80mm',
      description: '80Normal Driver',
      status: 0,
      isDefault: true,
    },
  ]);

  const trustedMainFrame: any = {
    url: `http://127.0.0.1:${serverPort}/pos`,
    destroyed: false,
  };
  trustedMainFrame.top = trustedMainFrame;

  const trustedWebContents: any = {
    isDestroyed: () => false,
    mainFrame: trustedMainFrame,
    print: mockPrint,
    getPrintersAsync: mockGetPrintersAsync,
  };

  const mockWindow: any = {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(),
    on: vi.fn(),
    webContents: trustedWebContents,
  };

  // Evaluate only helper + registerIpcHandlers without executing app startup lifecycle
  const truncatedCode = mainCode.slice(0, mainCode.indexOf('const gotSingleInstanceLock'));
  const harnessCode = `${truncatedCode}
    mainWindow = __mockWindow;
    serverPort = __serverPort;
    registerIpcHandlers({ userDataDir: '/secret/userData', dbPath: '/secret/prod.db', backupDir: '/secret/backups' });
  `;

  const mainRequire = (id: string) => {
    if (id === 'electron') {
      return {
        app: { setName: vi.fn(), getVersion: () => '1.0.0', isPackaged: true, getAppPath: () => process.cwd() },
        BrowserWindow: vi.fn(() => mockWindow),
        ipcMain: {
          handle: (channel: string, listener: (...args: any[]) => Promise<any>) => {
            handlers.set(channel, listener);
          },
        },
        dialog: { showErrorBox: vi.fn() },
      };
    }
    if (id === './ipcSecurity.cjs') {
      return ipcSecurity;
    }
    return require(id);
  };

  const context = vm.createContext({
    require: mainRequire,
    __dirname: path.resolve(process.cwd(), 'electron'),
    __filename: path.resolve(process.cwd(), 'electron/main.cjs'),
    __mockWindow: mockWindow,
    __serverPort: serverPort,
    process,
    Buffer,
    URL,
    Promise,
    Error,
    Number,
    String,
    Boolean,
    setTimeout,
    clearTimeout,
  });

  vm.runInContext(harnessCode, context);

  return {
    handlers,
    mockWindow,
    trustedWebContents,
    trustedMainFrame,
    mockPrint,
    mockGetPrintersAsync,
  };
}

describe('Golden Palace POS — Phase 12-D Stage D2 IPC Security & Input Validation', () => {
  it('1-4. Sender validation: accepts trusted app sender/frame/origin and rejects wrong WebContents, wrong frame, and unauthorized origin', () => {
    const trustedFrame: any = { url: 'http://127.0.0.1:3456/orders', destroyed: false };
    trustedFrame.top = trustedFrame;

    const trustedContents: any = {
      isDestroyed: () => false,
      mainFrame: trustedFrame,
    };
    const mockWin: any = {
      isDestroyed: () => false,
      webContents: trustedContents,
    };

    // 1. Valid trusted application sender
    const validRes = ipcSecurity.validateTrustedIpcSender(
      { sender: trustedContents, senderFrame: trustedFrame },
      mockWin,
      3456
    );
    expect(validRes).toEqual({ valid: true, origin: 'http://127.0.0.1:3456' });

    // 2. Unexpected / destroyed WebContents
    const wrongContentsRes = ipcSecurity.validateTrustedIpcSender(
      { sender: { isDestroyed: () => false }, senderFrame: trustedFrame },
      mockWin,
      3456
    );
    expect(wrongContentsRes.valid).toBe(false);

    const destroyedContentsRes = ipcSecurity.validateTrustedIpcSender(
      { sender: { ...trustedContents, isDestroyed: () => true }, senderFrame: trustedFrame },
      mockWin,
      3456
    );
    expect(destroyedContentsRes.valid).toBe(false);

    // 3. Unexpected / nested / missing senderFrame
    const wrongFrame: any = { url: 'http://127.0.0.1:3456/embed', destroyed: false };
    wrongFrame.top = trustedFrame;
    const wrongFrameRes = ipcSecurity.validateTrustedIpcSender(
      { sender: trustedContents, senderFrame: wrongFrame },
      mockWin,
      3456
    );
    expect(wrongFrameRes.valid).toBe(false);

    const missingFrameRes = ipcSecurity.validateTrustedIpcSender(
      { sender: trustedContents, senderFrame: null },
      mockWin,
      3456
    );
    expect(missingFrameRes.valid).toBe(false);

    // 4. Unauthorized origins (external https, localhost alias, wrong port, file://)
    for (const badUrl of [
      'https://evil.example/phish',
      'http://localhost:3456/',
      'http://127.0.0.1:9999/',
      'file:///C:/temp/exploit.html',
      'javascript:alert(1)',
    ]) {
      const badFrame: any = { url: badUrl, destroyed: false };
      badFrame.top = badFrame;
      const badWin: any = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: badFrame } };
      const res = ipcSecurity.validateTrustedIpcSender(
        { sender: badWin.webContents, senderFrame: badFrame },
        badWin,
        3456
      );
      expect(res.valid).toBe(false);
    }
  });

  it('5-9. Input validation: rejects malformed args, oversized payloads, unexpected properties, and invalid printer names while allowing valid printer names', () => {
    // 5. Malformed arguments
    expect(ipcSecurity.validatePrintSilentArgs([123]).valid).toBe(false);
    expect(ipcSecurity.validatePrintSilentArgs([null]).valid).toBe(false);
    expect(ipcSecurity.validatePrintSilentArgs([['array']]).valid).toBe(false);
    expect(ipcSecurity.validatePrintSilentArgs([{}, {}]).valid).toBe(false);
    expect(ipcSecurity.validatePrintSilentArgs([{ copies: 0 }]).valid).toBe(false);
    expect(ipcSecurity.validatePrintSilentArgs([{ copies: 6 }]).valid).toBe(false);
    expect(ipcSecurity.validatePrintSilentArgs([{ copies: 1.5 }]).valid).toBe(false);
    expect(ipcSecurity.validatePrintSilentArgs([{ copies: '2' }]).valid).toBe(false);
    expect(ipcSecurity.validateNoArgs(['unexpected']).valid).toBe(false);

    // 6. Excessively large payload (> 1024 bytes)
    const hugePayload = { deviceName: 'A'.repeat(1200), copies: 1 };
    expect(ipcSecurity.validatePrintSilentArgs([hugePayload]).valid).toBe(false);

    // 7. Unexpected object properties (HTML injection, Electron flags, command injection)
    expect(ipcSecurity.validatePrintSilentArgs([{ deviceName: 'CAFETERIA', silent: false }]).valid).toBe(false);
    expect(ipcSecurity.validatePrintSilentArgs([{ deviceName: 'CAFETERIA', html: '<h1>x</h1>' }]).valid).toBe(false);
    expect(ipcSecurity.validatePrintSilentArgs([{ command: 'calc.exe' }]).valid).toBe(false);

    // 8. Invalid printer device names (control chars, HTML angle brackets, whitespace-only, oversized, non-string)
    for (const badName of [123, '   ', 'POS\n--cmd', 'POS\0null', 'POS<script>', 'P'.repeat(257)]) {
      expect(ipcSecurity.validatePrintSilentArgs([{ deviceName: badName, copies: 1 }]).valid).toBe(false);
    }

    // 9. Valid printer device names (Windows Spooler, PDF, UNC shared, Arabic, default empty)
    for (const goodName of ['CAFETERIA', 'Microsoft Print to PDF', '\\\\PC-CAISSE\\XP-80', 'POS-80 (Copy 1)', 'طابعة المطبخ']) {
      const ok = ipcSecurity.validatePrintSilentArgs([{ deviceName: goodName, copies: 2 }]);
      expect(ok.valid).toBe(true);
      expect(ok.options).toEqual({ deviceName: goodName, copies: 2 });
    }
    expect(ipcSecurity.validatePrintSilentArgs([]).options).toEqual({ deviceName: undefined, copies: 1 });
  });

  it('10-13. Main IPC handlers & sandboxed preload: blocks unauthorized printSilent, executes valid silent print, preserves response contracts, and stays stable after rejected calls', async () => {
    const invokeMock = vi.fn(async () => ({ success: true }));
    const { exposedName, exposedApi } = loadPreloadInSandboxedContext(invokeMock);
    expect(exposedName).toBe('goldenPalaceDesktop');
    expect(Object.keys(exposedApi).sort()).toEqual(['getDesktopInfo', 'getPrinters', 'isDesktop', 'printSilent']);
    expect((exposedApi as any).ipcRenderer).toBeUndefined();

    // Preload blocks invalid printSilent arguments before even reaching IPC
    const preloadBlocked = await exposedApi.printSilent({ deviceName: 'CAFETERIA', extra: 'evil' });
    expect(preloadBlocked.success).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();

    // Load actual electron/main.cjs handlers in isolated test harness
    const {
      handlers,
      trustedWebContents,
      trustedMainFrame,
      mockPrint,
      mockGetPrintersAsync,
    } = loadMainProcessIpcHarness(3456);

    const trustedEvent = { sender: trustedWebContents, senderFrame: trustedMainFrame };
    const evilFrame: any = { url: 'https://evil.example/attack', destroyed: false };
    evilFrame.top = evilFrame;
    const untrustedEvent = { sender: trustedWebContents, senderFrame: evilFrame };

    // 10. Unauthorized silent-print invocation fails closed without calling webContents.print
    const unauthPrint = await handlers.get('desktop:print-silent')!(untrustedEvent, {
      deviceName: 'CAFETERIA',
      copies: 1,
    });
    expect(unauthPrint.success).toBe(false);
    expect(unauthPrint.failureReason).toBeTruthy();
    expect(unauthPrint.error).toBe(unauthPrint.failureReason);
    expect(mockPrint).not.toHaveBeenCalled();

    // Rejects unauthorized get-printers & get-info without leaking local DB/backup paths
    await expect(handlers.get('desktop:get-printers')!(untrustedEvent)).rejects.toThrow('Unauthorized IPC frame');
    await expect(handlers.get('desktop:get-info')!(untrustedEvent)).rejects.toThrow('Unauthorized IPC frame');

    // 11 & 12. Legitimate silent-print, get-printers & get-info preserve existing contracts cleanly
    const validPrint = await handlers.get('desktop:print-silent')!(trustedEvent, {
      deviceName: 'CAFETERIA',
      copies: 2,
    });
    expect(validPrint).toEqual({ success: true, failureReason: undefined, error: undefined });
    expect(mockPrint).toHaveBeenCalledWith(
      { silent: true, printBackground: true, deviceName: 'CAFETERIA', copies: 2 },
      expect.any(Function)
    );

    const printers = await handlers.get('desktop:get-printers')!(trustedEvent);
    expect(mockGetPrintersAsync).toHaveBeenCalledTimes(1);
    expect(printers[0]).toMatchObject({ name: 'CAFETERIA', isDefault: true });

    const info = await handlers.get('desktop:get-info')!(trustedEvent);
    expect(info).toEqual({
      appName: 'GOLDEN PALACE POS',
      appVersion: '1.0.0',
      platform: process.platform,
      serverUrl: 'http://127.0.0.1:3456',
    });
    expect((info as any).dbPath).toBeUndefined();
    expect((info as any).userDataDir).toBeUndefined();

    // 13. Main-process handlers remain stable and responsive after multiple rejected invalid calls
    const badRes = await handlers.get('desktop:print-silent')!(trustedEvent, { copies: 999 });
    expect(badRes.success).toBe(false);
    const followUpPrint = await handlers.get('desktop:print-silent')!(trustedEvent, {
      deviceName: 'Microsoft Print to PDF',
      copies: 1,
    });
    expect(followUpPrint.success).toBe(true);
  });
});
