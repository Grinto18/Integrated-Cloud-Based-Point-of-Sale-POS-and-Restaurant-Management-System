// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import EventEmitter from 'events';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';
import {
  buildContentSecurityPolicy,
  createSecurityHeadersMiddleware,
  createStrictCorsMiddleware,
  resolveAllowedCorsOrigins,
} from '../middleware/httpSecurity.ts';

const require = createRequire(import.meta.url);
const ipcSecurity = require('../../electron/ipcSecurity.cjs');

function createElectronMainHarness(options: { isPackaged: boolean; serverPort?: number }) {
  const mainCode = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
  const serverPort = options.serverPort ?? 3456;

  let capturedWindowOptions: any = null;
  let windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null;
  const webContentsEvents = new Map<string, Array<(...args: any[]) => void>>();
  let permissionRequestHandler:
    | ((wc: any, perm: string, cb: (allowed: boolean) => void, details?: any) => void)
    | null = null;
  let permissionCheckHandler:
    | ((wc: any, perm: string, origin: string) => boolean)
    | null = null;
  let headersReceivedListener: ((details: any, cb: (res: any) => void) => void) | null = null;

  const mockCloseDevTools = vi.fn();
  const mockOpenExternal = vi.fn(async () => undefined);
  const mockSetApplicationMenu = vi.fn();
  const mockRemoveMenu = vi.fn();
  const mockLoadURL = vi.fn();
  const mockPrint = vi.fn((_opts: any, cb: (ok: boolean, reason?: string) => void) => cb(true));
  const mockGetPrintersAsync = vi.fn(async () => []);
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();

  const trustedMainFrame: any = {
    url: `http://127.0.0.1:${serverPort}/`,
    destroyed: false,
  };
  trustedMainFrame.top = trustedMainFrame;

  const mockWebContents: any = {
    isDestroyed: () => false,
    mainFrame: trustedMainFrame,
    getURL: () => `http://127.0.0.1:${serverPort}/`,
    print: mockPrint,
    getPrintersAsync: mockGetPrintersAsync,
    closeDevTools: mockCloseDevTools,
    setWindowOpenHandler: (fn: (details: { url: string }) => { action: string }) => {
      windowOpenHandler = fn;
    },
    on: (event: string, listener: (...args: any[]) => void) => {
      if (!webContentsEvents.has(event)) webContentsEvents.set(event, []);
      webContentsEvents.get(event)!.push(listener);
    },
  };

  const mockWindow: any = {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    focus: vi.fn(),
    loadURL: mockLoadURL,
    removeMenu: mockRemoveMenu,
    on: vi.fn(),
    webContents: mockWebContents,
  };

  const truncatedCode = mainCode.slice(0, mainCode.indexOf('const gotSingleInstanceLock'));
  const harnessCode = `${truncatedCode}
    serverPort = __serverPort;
    registerIpcHandlers({ userDataDir: '/tmp/secret', dbPath: '/tmp/secret.db', backupDir: '/tmp/backups' });
    createMainWindow('/nonexistent/icon.ico');
    __exports.waitForServerHealth = waitForServerHealth;
    __exports.attachWebContentsSecurity = attachWebContentsSecurity;
  `;

  const exportedFns: Record<string, any> = {};

  const mainRequire = (id: string) => {
    if (id === 'electron') {
      return {
        app: {
          setName: vi.fn(),
          getVersion: () => '1.0.0',
          isPackaged: options.isPackaged,
          getAppPath: () => process.cwd(),
        },
        BrowserWindow: function MockBrowserWindow(opts: any) {
          capturedWindowOptions = opts;
          return mockWindow;
        },
        ipcMain: {
          handle: (channel: string, listener: (...args: any[]) => Promise<any>) => {
            handlers.set(channel, listener);
          },
        },
        dialog: { showErrorBox: vi.fn() },
        Menu: { setApplicationMenu: mockSetApplicationMenu },
        shell: { openExternal: mockOpenExternal },
        session: {
          defaultSession: {
            setPermissionRequestHandler: (fn: any) => {
              permissionRequestHandler = fn;
            },
            setPermissionCheckHandler: (fn: any) => {
              permissionCheckHandler = fn;
            },
            webRequest: {
              onHeadersReceived: (_filter: any, fn: any) => {
                headersReceivedListener = fn;
              },
            },
          },
        },
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
    __serverPort: serverPort,
    __exports: exportedFns,
    process,
    Buffer,
    URL,
    Promise,
    Error,
    Number,
    String,
    Boolean,
    WeakSet,
    Set,
    Map,
    Object,
    Array,
    setTimeout,
    clearTimeout,
  });

  vm.runInContext(harnessCode, context);

  return {
    capturedWindowOptions,
    windowOpenHandler: windowOpenHandler as ((details: { url: string }) => { action: string }) | null,
    webContentsEvents,
    permissionRequestHandler: permissionRequestHandler as
      | ((wc: any, perm: string, cb: (allowed: boolean) => void, details?: any) => void)
      | null,
    permissionCheckHandler: permissionCheckHandler as
      | ((wc: any, perm: string, origin: string) => boolean)
      | null,
    headersReceivedListener: headersReceivedListener as
      | ((details: any, cb: (res: any) => void) => void)
      | null,
    mockCloseDevTools,
    mockOpenExternal,
    mockSetApplicationMenu,
    mockRemoveMenu,
    mockLoadURL,
    mockWebContents,
    trustedMainFrame,
    handlers,
    waitForServerHealth: exportedFns.waitForServerHealth as (
      port: number,
      child: any,
      getStderr: () => string,
      timeoutMs?: number
    ) => Promise<void>,
  };
}

describe('Golden Palace POS — Phase 3 Electron & Desktop Security Hardening', () => {
  it('1. Electron Window Security: denies unauthorized popups, blocks untrusted navigation/redirects, and restricts external browser opening to approved HTTPS origins only', () => {
    const harness = createElectronMainHarness({ isPackaged: true, serverPort: 3456 });

    expect(harness.windowOpenHandler).toBeTruthy();
    expect(harness.mockLoadURL).toHaveBeenCalledWith('http://127.0.0.1:3456');

    // Unauthorized popups are ALWAYS denied and never trigger shell.openExternal
    for (const url of [
      'https://evil.example/phish',
      'http://localhost:3456/popup',
      'http://127.0.0.1:3456/popup',
      'file:///C:/Windows/win.ini',
      'javascript:alert(1)',
      'ms-msdt:/id',
    ]) {
      expect(harness.windowOpenHandler!({ url })).toEqual({ action: 'deny' });
    }
    expect(harness.mockOpenExternal).not.toHaveBeenCalled();

    // Controlled external-browser mechanism: opens ONLY explicitly approved HTTPS origins
    const controlledOpen = vi.fn(async () => undefined);
    const approvedDecision = ipcSecurity.evaluateWindowOpen('https://support.goldenpalace.dz/docs', {
      approvedExternalOrigins: ['https://support.goldenpalace.dz'],
      openExternal: controlledOpen,
    });
    expect(approvedDecision).toMatchObject({ action: 'deny', openedExternally: true });
    expect(controlledOpen).toHaveBeenCalledWith('https://support.goldenpalace.dz/docs');

    controlledOpen.mockClear();
    for (const rejectedExternal of [
      'http://support.goldenpalace.dz/insecure',
      'https://user:pass@support.goldenpalace.dz/creds',
      'https://support.goldenpalace.dz.evil.com/spoof',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ]) {
      const dec = ipcSecurity.evaluateWindowOpen(rejectedExternal, {
        approvedExternalOrigins: ['https://support.goldenpalace.dz'],
        openExternal: controlledOpen,
      });
      expect(dec).toEqual({ action: 'deny', openedExternally: false });
    }
    expect(controlledOpen).not.toHaveBeenCalled();

    // will-navigate and will-redirect allow ONLY exact local loopback origin and block everything else
    const willNavigateListeners = harness.webContentsEvents.get('will-navigate') || [];
    const willRedirectListeners = harness.webContentsEvents.get('will-redirect') || [];
    expect(willNavigateListeners.length).toBeGreaterThanOrEqual(1);
    expect(willRedirectListeners.length).toBeGreaterThanOrEqual(1);

    const allowedNavEvent = { preventDefault: vi.fn() };
    willNavigateListeners.forEach((fn) => fn(allowedNavEvent, 'http://127.0.0.1:3456/orders'));
    expect(allowedNavEvent.preventDefault).not.toHaveBeenCalled();

    for (const badUrl of [
      'https://evil.example/',
      'http://localhost:3456/',
      'http://127.0.0.1:9999/',
      'file:///C:/secret.html',
      'javascript:alert(1)',
      'data:text/html,<h1>pwn</h1>',
    ]) {
      const navEv = { preventDefault: vi.fn() };
      willNavigateListeners.forEach((fn) => fn(navEv, badUrl));
      expect(navEv.preventDefault).toHaveBeenCalledTimes(1);

      const redirEv = { preventDefault: vi.fn() };
      willRedirectListeners.forEach((fn) => fn(redirEv, badUrl));
      expect(redirEv.preventDefault).toHaveBeenCalledTimes(1);
    }
  });

  it('2. Permission Security: denies all permissions by default and allows only documented POS clipboard-sanitized-write on trusted local origin', () => {
    const harness = createElectronMainHarness({ isPackaged: true, serverPort: 3456 });
    expect(harness.permissionRequestHandler).toBeTruthy();
    expect(harness.permissionCheckHandler).toBeTruthy();

    const deniedPermissions = [
      'media',
      'camera',
      'microphone',
      'geolocation',
      'notifications',
      'midi',
      'midiSysex',
      'pointerLock',
      'fullscreen',
      'openExternal',
      'clipboard-read',
      'display-capture',
      'serial',
      'usb',
      'hid',
    ];

    for (const perm of deniedPermissions) {
      const cb = vi.fn();
      harness.permissionRequestHandler!(
        harness.mockWebContents,
        perm,
        cb,
        { requestingUrl: 'http://127.0.0.1:3456/' }
      );
      expect(cb).toHaveBeenCalledWith(false);
      expect(
        harness.permissionCheckHandler!(harness.mockWebContents, perm, 'http://127.0.0.1:3456')
      ).toBe(false);
    }

    // Documented POS permission (clipboard-sanitized-write for ReceiptPrint spool command copy)
    const allowedCb = vi.fn();
    harness.permissionRequestHandler!(
      harness.mockWebContents,
      'clipboard-sanitized-write',
      allowedCb,
      { requestingUrl: 'http://127.0.0.1:3456/pos' }
    );
    expect(allowedCb).toHaveBeenCalledWith(true);
    expect(
      harness.permissionCheckHandler!(
        harness.mockWebContents,
        'clipboard-sanitized-write',
        'http://127.0.0.1:3456'
      )
    ).toBe(true);

    // Even clipboard-sanitized-write is DENIED for any untrusted origin
    const badOriginCb = vi.fn();
    harness.permissionRequestHandler!(
      harness.mockWebContents,
      'clipboard-sanitized-write',
      badOriginCb,
      { requestingUrl: 'https://evil.example/' }
    );
    expect(badOriginCb).toHaveBeenCalledWith(false);
    expect(
      harness.permissionCheckHandler!(
        harness.mockWebContents,
        'clipboard-sanitized-write',
        'http://localhost:3456'
      )
    ).toBe(false);
  });

  it('3. Production DevTools & Menu Lockdown: disables DevTools, menu, and DevTools shortcuts in packaged builds while preserving POS F1-F12 hotkeys and dev mode diagnostics', () => {
    // Packaged Production Build
    const prod = createElectronMainHarness({ isPackaged: true, serverPort: 3456 });
    expect(prod.capturedWindowOptions.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: false,
    });
    expect(prod.mockSetApplicationMenu).toHaveBeenCalledWith(null);
    expect(prod.mockRemoveMenu).toHaveBeenCalledTimes(1);

    // Blocked DevTools & view-source shortcuts in production
    const beforeInputListeners = prod.webContentsEvents.get('before-input-event') || [];
    expect(beforeInputListeners.length).toBeGreaterThanOrEqual(1);
    for (const blockedInput of [
      { type: 'keyDown', control: true, shift: true, key: 'I' },
      { type: 'keyDown', control: true, shift: true, key: 'J' },
      { type: 'keyDown', control: true, shift: true, key: 'C' },
      { type: 'keyDown', meta: true, alt: true, key: 'i' },
      { type: 'keyDown', control: true, shift: false, key: 'u' },
    ]) {
      const ev = { preventDefault: vi.fn() };
      beforeInputListeners.forEach((fn) => fn(ev, blockedInput));
      expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    }

    // Preserved POS cashier shortcuts (F1, F2, F12 Cash Register, Escape, Ctrl+C/V)
    for (const allowedInput of [
      { type: 'keyDown', key: 'F1' },
      { type: 'keyDown', key: 'F2' },
      { type: 'keyDown', key: 'F12' },
      { type: 'keyDown', key: 'Escape' },
      { type: 'keyDown', control: true, shift: false, key: 'c' },
      { type: 'keyDown', control: true, shift: false, key: 'v' },
    ]) {
      const ev = { preventDefault: vi.fn() };
      beforeInputListeners.forEach((fn) => fn(ev, allowedInput));
      expect(ev.preventDefault).not.toHaveBeenCalled();
    }

    // Defense-in-depth devtools-opened immediately closes DevTools in packaged builds
    const devtoolsListeners = prod.webContentsEvents.get('devtools-opened') || [];
    expect(devtoolsListeners.length).toBeGreaterThanOrEqual(1);
    devtoolsListeners.forEach((fn) => fn());
    expect(prod.mockCloseDevTools).toHaveBeenCalledTimes(1);

    // Development Mode: preserves DevTools & standard menu for developer diagnostics
    const dev = createElectronMainHarness({ isPackaged: false, serverPort: 3456 });
    expect(dev.capturedWindowOptions.webPreferences.devTools).toBe(true);
    expect(dev.mockSetApplicationMenu).not.toHaveBeenCalled();
    expect(dev.mockRemoveMenu).not.toHaveBeenCalled();
    expect((dev.webContentsEvents.get('devtools-opened') || []).length).toBe(0);
  });

  it('4. HTTP Security (CORS Allowlist, Preflight OPTIONS & Security Headers/CSP): enforces strict origins, rejects unauthorized preflights, and injects hardened headers', async () => {
    // Desktop Production Express App
    const desktopConfig = {
      port: 3456,
      isDesktop: true,
      isProduction: true,
      allowIframePreview: false,
    };
    const desktopApp = express();
    desktopApp.disable('x-powered-by');
    desktopApp.use(createSecurityHeadersMiddleware(desktopConfig, ));
    desktopApp.use(createStrictCorsMiddleware(desktopConfig, {}));
    desktopApp.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

    // 4a. Same-origin / no Origin header succeeds with zero wildcard and full security headers
    const sameOriginRes = await request(desktopApp).get('/api/health');
    expect(sameOriginRes.status).toBe(200);
    expect(sameOriginRes.headers['access-control-allow-origin']).toBeUndefined();
    expect(sameOriginRes.headers['x-powered-by']).toBeUndefined();
    expect(sameOriginRes.headers['x-content-type-options']).toBe('nosniff');
    expect(sameOriginRes.headers['x-frame-options']).toBe('DENY');
    expect(sameOriginRes.headers['referrer-policy']).toBe('no-referrer');
    expect(sameOriginRes.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(sameOriginRes.headers['permissions-policy']).toContain('camera=()');
    const csp = sameOriginRes.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('*');

    // 4b. Approved Electron desktop origin passes GET & OPTIONS preflight
    const allowedGet = await request(desktopApp)
      .get('/api/health')
      .set('Origin', 'http://127.0.0.1:3456');
    expect(allowedGet.status).toBe(200);
    expect(allowedGet.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3456');
    expect(allowedGet.headers['vary']).toContain('Origin');

    const allowedPreflight = await request(desktopApp)
      .options('/api/health')
      .set('Origin', 'http://127.0.0.1:3456')
      .set('Access-Control-Request-Method', 'POST');
    expect(allowedPreflight.status).toBe(204);
    expect(allowedPreflight.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3456');
    expect(allowedPreflight.headers['access-control-allow-methods']).toContain('POST');

    // 4c. Rejected origins fail with 403 and NO Access-Control-Allow-Origin (both GET and preflight OPTIONS)
    for (const badOrigin of [
      'https://evil.example',
      'http://localhost:3456',
      'http://127.0.0.1:9999',
      'null',
      'file://',
    ]) {
      const badGet = await request(desktopApp).get('/api/health').set('Origin', badOrigin);
      expect(badGet.status).toBe(403);
      expect(badGet.body.code).toBe('CORS_ORIGIN_DENIED');
      expect(badGet.headers['access-control-allow-origin']).toBeUndefined();

      const badPreflight = await request(desktopApp)
        .options('/api/health')
        .set('Origin', badOrigin)
        .set('Access-Control-Request-Method', 'DELETE');
      expect(badPreflight.status).toBe(403);
      expect(badPreflight.headers['access-control-allow-origin']).toBeUndefined();
    }

    // 4d. Development allowlist supports explicit local dev origins without wildcard `*`
    const devOrigins = resolveAllowedCorsOrigins(
      { port: 3000, isDesktop: false, isProduction: false },
      { CORS_ALLOWED_ORIGINS: 'https://staging.goldenpalace.dz, *' }
    );
    expect(devOrigins.has('http://127.0.0.1:3000')).toBe(true);
    expect(devOrigins.has('http://localhost:3000')).toBe(true);
    expect(devOrigins.has('https://staging.goldenpalace.dz')).toBe(true);
    expect(devOrigins.has('*')).toBe(false);

    // 4e. Electron onHeadersReceived defense-in-depth injects desktop CSP cleanly
    const prodHarness = createElectronMainHarness({ isPackaged: true, serverPort: 3456 });
    expect(prodHarness.headersReceivedListener).toBeTruthy();
    const headerCb = vi.fn();
    prodHarness.headersReceivedListener!(
      { responseHeaders: { 'content-security-policy': ['default-src *'] } },
      headerCb
    );
    expect(headerCb).toHaveBeenCalledTimes(1);
    const mergedHeaders = headerCb.mock.calls[0][0].responseHeaders;
    expect(mergedHeaders['Content-Security-Policy'][0]).toBe(
      buildContentSecurityPolicy(desktopConfig)
    );
    expect(mergedHeaders['X-Frame-Options']).toEqual(['DENY']);
  });

  it('5. Electron IPC & Preload Audit: enforces strict channel set, frozen API, Symbol rejection, and blocks unauthorized senders/arguments', async () => {
    const harness = createElectronMainHarness({ isPackaged: true, serverPort: 3456 });
    expect(Array.from(harness.handlers.keys()).sort()).toEqual([
      'desktop:get-info',
      'desktop:get-printers',
      'desktop:print-silent',
    ]);

    // Symbol property smuggling rejected by IPC sanitizer
    const symPayload: any = { deviceName: 'CAFETERIA', copies: 1 };
    symPayload[Symbol('inject')] = 'bad';
    expect(ipcSecurity.validatePrintSilentArgs([symPayload]).valid).toBe(false);

    // Preload exposes frozen bridge with zero fs/shell/child_process/ipcRenderer access
    const preloadSrc = fs.readFileSync(path.resolve(process.cwd(), 'electron/preload.cjs'), 'utf8');
    expect(preloadSrc).toContain('Object.freeze');
    expect(preloadSrc).not.toContain('shell');
    expect(preloadSrc).not.toContain('child_process');
    expect(preloadSrc).not.toContain("require('fs')");

    // Unauthorized sender & malformed args rejected on actual registered handlers
    const spoofedEvent = {
      sender: { isDestroyed: () => false },
      senderFrame: harness.trustedMainFrame,
    };
    await expect(harness.handlers.get('desktop:get-printers')!(spoofedEvent)).rejects.toThrow(
      'Unauthorized IPC sender'
    );
    await expect(
      harness.handlers.get('desktop:get-info')!(
        { sender: harness.mockWebContents, senderFrame: harness.trustedMainFrame },
        'extra-arg'
      )
    ).rejects.toThrow('Unexpected IPC arguments');
  });

  it('6. Safe Arabic/French Startup Error Diagnostics: distinguishes DB conflict, migration failure, corruption, and server errors without leaking credentials, paths, or stack traces', async () => {
    const cases = [
      {
        expectedCategory: 'DATABASE_CONFLICT',
        expectedCode: 'GP-ERR-DB-CONFLICT',
        err: new Error('Local POS server exited unexpectedly (code=1)'),
        stderr:
          'DatabaseConflictError: DATABASE CONFLICT STOP in C:\\Users\\Owner\\AppData\\Roaming\\Golden Palace POS (JWT_SECRET=abc1234567890)\n    at assertNoDatabaseConflict (/app/applet/src/db/migrationManager.ts:411:11)',
      },
      {
        expectedCategory: 'DATABASE_MIGRATION_FAILED',
        expectedCode: 'GP-ERR-DB-MIGRATION',
        err: new Error('Local POS server exited unexpectedly (code=1)'),
        stderr:
          '❌ [DB MIGRATION FAILED] v5 (005_bad) on /home/cashier/golden_palace_production.db: syntax error [Automatically rolled back to gp_pos_pre_migration.db]\n    at runVersionedMigrations (/app/dist-electron/server.cjs:990:15)',
      },
      {
        expectedCategory: 'DATABASE_CORRUPTED',
        expectedCode: 'GP-ERR-DB-CORRUPT',
        err: new Error('Local POS server exited unexpectedly (code=1)'),
        stderr:
          'SqliteError: SQLITE_CORRUPT: database disk image is malformed at C:\\Users\\Cashier\\AppData\\Local\\Temp\\db.sqlite Bearer eyJhbGciOiJIUzI1NiJ9.secret.sig',
      },
      {
        expectedCategory: 'SERVER_STARTUP_ERROR',
        expectedCode: 'GP-ERR-SERVER-START',
        err: new Error(
          'Desktop server bundle missing at C:\\Users\\Admin\\AppData\\server.cjs password=TopSecret123!\n    at startLocalPosServer (electron/main.cjs:121:11)'
        ),
        stderr: '',
      },
    ];

    for (const c of cases) {
      const diag = ipcSecurity.classifyStartupError(c.err, c.stderr);
      expect(diag.category).toBe(c.expectedCategory);
      expect(diag.code).toBe(c.expectedCode);
      // Must include Arabic and French user-facing guidance
      expect(diag.title).toMatch(/[\u0600-\u06FF]/);
      expect(diag.message).toMatch(/[\u0600-\u06FF]/);
      expect(diag.message).toMatch(/[A-Za-zÀ-ÿ]{5,}/);
      // Must NEVER leak credentials, internal user paths, or stack traces
      expect(diag.message).not.toMatch(/JWT_SECRET|abc1234567890|TopSecret123|Bearer\s+eyJ/i);
      expect(diag.message).not.toMatch(/C:\\Users|\/home\/cashier|\/app\/applet/i);
      expect(diag.message).not.toMatch(/at\s+\w+\s*\(/);
    }

    // Sanitizer redacts secrets, paths, and stack frames for console logs
    const sanitized = ipcSecurity.sanitizeStartupLogText(
      'Error JWT_SECRET=mysecret123 Bearer tok.123.456 in C:\\Users\\Admin\\.jwt_secret\n    at boom (/home/user/server.cjs:10:2)'
    );
    expect(sanitized).not.toContain('mysecret123');
    expect(sanitized).not.toContain('tok.123.456');
    expect(sanitized).not.toContain('C:\\Users\\Admin');
    expect(sanitized).not.toContain('at boom');

    // waitForServerHealth fails fast on early child process exit with stderrTail (no 20s hang)
    const harness = createElectronMainHarness({ isPackaged: true, serverPort: 3456 });
    const fakeChild = new EventEmitter();
    const startMs = Date.now();
    const waitPromise = harness.waitForServerHealth(
      59999,
      fakeChild,
      () => 'DATABASE CONFLICT STOP: MULTIPLE_POS_DATABASES',
      15000
    );
    setTimeout(() => fakeChild.emit('exit', 1, null), 30);

    await expect(waitPromise).rejects.toMatchObject({
      stderrTail: 'DATABASE CONFLICT STOP: MULTIPLE_POS_DATABASES',
    });
    expect(Date.now() - startMs).toBeLessThan(2000);
  });
});
