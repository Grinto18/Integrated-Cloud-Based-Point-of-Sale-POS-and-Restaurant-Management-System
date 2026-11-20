const { app, BrowserWindow, ipcMain, dialog, Menu, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { fork } = require('child_process');
const {
  DEFAULT_APPROVED_EXTERNAL_ORIGINS,
  evaluateNavigation,
  evaluateWindowOpen,
  evaluatePermission,
  isBlockedProductionShortcut,
  buildDesktopCspHeader,
  validateTrustedIpcSender,
  validateNoArgs,
  validatePrintSilentArgs,
  buildSafeDesktopInfo,
  sanitizeStartupLogText,
  classifyStartupError,
} = require('./ipcSecurity.cjs');

app.setName('Golden Palace POS');

let mainWindow = null;
let serverProcess = null;
let serverPort = 3456;
let isAppQuitting = false;
let sessionSecurityConfigured = false;
const securedWebContents = new WeakSet();

function getOrCreateDesktopJwtSecret(userDataDir) {
  const secretPath = path.join(userDataDir, '.jwt_secret');
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing.length >= 32 && new Set(existing).size >= 8) {
        try {
          fs.chmodSync(secretPath, 0o600);
        } catch {
          // Non-POSIX filesystems (Windows NTFS) ignore POSIX chmod
        }
        return existing;
      }
    }
  } catch {
    // Fall through to regenerate
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(secretPath, generated, { mode: 0o600, encoding: 'utf8' });
  try {
    fs.chmodSync(secretPath, 0o600);
  } catch {
    // Non-POSIX filesystems (Windows NTFS) ignore POSIX chmod
  }
  return generated;
}

function findAvailablePort(preferredPort = 3456) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => {
      const ephemeral = net.createServer();
      ephemeral.listen(0, '127.0.0.1', () => {
        const addr = ephemeral.address();
        const freePort = typeof addr === 'object' && addr ? addr.port : 3499;
        ephemeral.close(() => resolve(freePort));
      });
    });
    tester.once('listening', () => {
      tester.close(() => resolve(preferredPort));
    });
    tester.listen(preferredPort, '127.0.0.1');
  });
}

function waitForServerHealth(port, childProcess, getStderrTail, timeoutMs = 20000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearTimeout(pollTimer);
      childProcess?.removeListener?.('exit', onEarlyExit);
      childProcess?.removeListener?.('error', onChildError);
      fn(value);
    };

    const onEarlyExit = (code, signal) => {
      const err = new Error(`Local POS server exited unexpectedly (code=${code}, signal=${signal})`);
      err.stderrTail = typeof getStderrTail === 'function' ? getStderrTail() : '';
      finish(reject, err);
    };

    const onChildError = (childErr) => {
      const err = childErr instanceof Error ? childErr : new Error(String(childErr || 'Server process spawn error'));
      err.stderrTail = typeof getStderrTail === 'function' ? getStderrTail() : '';
      finish(reject, err);
    };

    childProcess?.once?.('exit', onEarlyExit);
    childProcess?.once?.('error', onChildError);

    const attempt = () => {
      if (settled) return;
      if (Date.now() - startedAt > timeoutMs) {
        const err = new Error('Timed out waiting for GOLDEN PALACE POS local server');
        err.stderrTail = typeof getStderrTail === 'function' ? getStderrTail() : '';
        finish(reject, err);
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 400) {
          finish(resolve);
        } else {
          pollTimer = setTimeout(attempt, 250);
        }
      });
      req.on('error', () => {
        pollTimer = setTimeout(attempt, 250);
      });
      req.setTimeout(1500, () => {
        req.destroy();
        pollTimer = setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function resolveBundledPaths() {
  const appPath = app.getAppPath();
  const unpackedRoot = appPath.endsWith('.asar')
    ? `${appPath}.unpacked`
    : path.join(path.dirname(appPath), 'app.asar.unpacked');
  const appRoot = app.isPackaged ? path.dirname(appPath) : path.resolve(__dirname, '..');

  const pickFirstExisting = (candidates) => {
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return candidates[0];
  };

  // Prefer real filesystem paths inside app.asar.unpacked so ELECTRON_RUN_AS_NODE=1 child processes
  // (where Electron's ASAR virtual filesystem is disabled) can execute server.cjs and serve dist/ cleanly.
  const distDir = pickFirstExisting([
    path.join(unpackedRoot, 'dist'),
    path.join(appRoot, 'dist'),
    path.join(appPath, 'dist'),
  ]);
  const serverEntry = pickFirstExisting([
    path.join(unpackedRoot, 'dist-electron', 'server.cjs'),
    path.join(appRoot, 'dist-electron', 'server.cjs'),
    path.join(appPath, 'dist-electron', 'server.cjs'),
  ]);
  const iconPath = pickFirstExisting([
    path.join(unpackedRoot, 'build', 'icon.ico'),
    path.join(appRoot, 'build', 'icon.ico'),
    path.join(unpackedRoot, 'build', 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.png'),
  ]);
  return { distDir, serverEntry, iconPath };
}

async function startLocalPosServer(userDataDir) {
  const dbPath = path.join(userDataDir, 'golden_palace_production.db');
  const backupDir = path.join(userDataDir, 'backups_production');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const jwtSecret = getOrCreateDesktopJwtSecret(userDataDir);
  serverPort = await findAvailablePort(3456);
  const { distDir, serverEntry } = resolveBundledPaths();

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Desktop server bundle missing at ${serverEntry}. Run npm run build:server first.`);
  }

  let startupStderrBuffer = '';
  const MAX_STDERR_BUFFER = 4096;

  serverProcess = fork(serverEntry, [], {
    cwd: userDataDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      GOLDEN_PALACE_DESKTOP: '1',
      GOLDEN_PALACE_DB_MODE: 'production',
      HOST: '127.0.0.1',
      PORT: String(serverPort),
      SQLITE_DB_PATH: dbPath,
      GOLDEN_PALACE_BACKUP_DIR: backupDir,
      GOLDEN_PALACE_DIST_DIR: distDir,
      JWT_SECRET: jwtSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  serverProcess.stdout?.on('data', (chunk) => {
    process.stdout.write(`[POS-SERVER] ${chunk}`);
  });
  serverProcess.stderr?.on('data', (chunk) => {
    const text = String(chunk);
    startupStderrBuffer = (startupStderrBuffer + text).slice(-MAX_STDERR_BUFFER);
    process.stderr.write(`[POS-SERVER-ERR] ${text}`);
  });

  await waitForServerHealth(serverPort, serverProcess, () => startupStderrBuffer);
  return { dbPath, backupDir };
}

function stopLocalPosServer() {
  return new Promise((resolve) => {
    if (!serverProcess || serverProcess.killed) {
      resolve();
      return;
    }
    const child = serverProcess;
    const forceTimeout = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore already dead process
      }
      resolve();
    }, 8500);

    child.once('exit', () => {
      clearTimeout(forceTimeout);
      serverProcess = null;
      resolve();
    });

    try {
      if (child.connected) {
        child.send({ type: 'shutdown' });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(forceTimeout);
        resolve();
      }
    }
  });
}

function configureSessionSecurity(port, isPackaged = Boolean(app?.isPackaged)) {
  const defaultSession = session?.defaultSession;
  if (!defaultSession || sessionSecurityConfigured) {
    return;
  }
  sessionSecurityConfigured = true;

  // Deny-by-default permission request handler
  if (typeof defaultSession.setPermissionRequestHandler === 'function') {
    defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const origin = details?.requestingUrl || webContents?.getURL?.() || '';
      const allowed = evaluatePermission(permission, origin, port);
      callback(Boolean(allowed));
    });
  }

  // Deny-by-default permission check handler
  if (typeof defaultSession.setPermissionCheckHandler === 'function') {
    defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      const origin = requestingOrigin || webContents?.getURL?.() || '';
      return Boolean(evaluatePermission(permission, origin, port));
    });
  }

  // Defense-in-depth desktop CSP & security response headers on loopback POS origin
  if (defaultSession.webRequest && typeof defaultSession.webRequest.onHeadersReceived === 'function') {
    const cspValue = buildDesktopCspHeader(port, true);
    defaultSession.webRequest.onHeadersReceived(
      { urls: [`http://127.0.0.1:${port}/*`] },
      (details, callback) => {
        const headers = { ...(details.responseHeaders || {}) };
        // Remove any duplicate casing before applying canonical desktop headers
        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (
            lower === 'content-security-policy' ||
            lower === 'x-frame-options' ||
            lower === 'x-content-type-options' ||
            lower === 'referrer-policy'
          ) {
            delete headers[key];
          }
        }
        headers['Content-Security-Policy'] = [cspValue];
        headers['X-Content-Type-Options'] = ['nosniff'];
        headers['X-Frame-Options'] = ['DENY'];
        headers['Referrer-Policy'] = ['no-referrer'];
        callback({ responseHeaders: headers });
      }
    );
  }
}

function attachWebContentsSecurity(contents, options = {}) {
  if (!contents || securedWebContents.has(contents)) {
    return;
  }
  securedWebContents.add(contents);

  const port = options.serverPort ?? serverPort;
  const isPackaged = options.isPackaged !== undefined ? Boolean(options.isPackaged) : Boolean(app?.isPackaged);
  const approvedExternalOrigins = options.approvedExternalOrigins || DEFAULT_APPROVED_EXTERNAL_ORIGINS;
  const openExternal =
    typeof options.openExternal === 'function'
      ? options.openExternal
      : (safeUrl) => shell?.openExternal?.(safeUrl);

  // Deny all unauthorized popup windows; only explicitly approved HTTPS links open externally
  if (typeof contents.setWindowOpenHandler === 'function') {
    contents.setWindowOpenHandler((details) => {
      const decision = evaluateWindowOpen(details?.url, {
        approvedExternalOrigins,
        openExternal,
      });
      return { action: decision.action };
    });
  }

  // Restrict top-level navigation strictly to the local loopback POS origin
  if (typeof contents.on === 'function') {
    contents.on('will-navigate', (event, navigationUrl) => {
      const check = evaluateNavigation(navigationUrl, port);
      if (!check.allowed) {
        event.preventDefault();
      }
    });

    contents.on('will-redirect', (event, navigationUrl) => {
      const check = evaluateNavigation(navigationUrl, port);
      if (!check.allowed) {
        event.preventDefault();
      }
    });

    // Lock down DevTools & view-source shortcuts in packaged production builds
    // while preserving POS cashier function keys (F1-F12) and dev diagnostics in dev mode
    if (isPackaged) {
      contents.on('before-input-event', (event, input) => {
        if (isBlockedProductionShortcut(input)) {
          event.preventDefault();
        }
      });

      contents.on('devtools-opened', () => {
        try {
          contents.closeDevTools?.();
        } catch {
          // Ignore closeDevTools error if contents is already closing
        }
      });
    }
  }
}

function configureApplicationMenu(win, isPackaged = Boolean(app?.isPackaged)) {
  if (!isPackaged) {
    // Preserve standard menu & developer diagnostics in development mode
    return;
  }
  if (Menu && typeof Menu.setApplicationMenu === 'function') {
    Menu.setApplicationMenu(null);
  }
  if (win && typeof win.removeMenu === 'function') {
    win.removeMenu();
  }
}

function registerIpcHandlers(_paths) {
  ipcMain.handle('desktop:get-printers', async (event, ...args) => {
    const senderCheck = validateTrustedIpcSender(event, mainWindow, serverPort);
    if (!senderCheck.valid) {
      throw new Error(senderCheck.error);
    }
    const argCheck = validateNoArgs(args);
    if (!argCheck.valid) {
      throw new Error(argCheck.error);
    }
    try {
      const printers = await mainWindow.webContents.getPrintersAsync();
      return printers.map((p) => ({
        name: String(p.name || ''),
        displayName: String(p.displayName || p.name || ''),
        description: String(p.description || ''),
        status: p.status,
        isDefault: Boolean(p.isDefault),
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('desktop:print-silent', async (event, ...args) => {
    const senderCheck = validateTrustedIpcSender(event, mainWindow, serverPort);
    if (!senderCheck.valid) {
      return {
        success: false,
        failureReason: senderCheck.error,
        error: senderCheck.error,
      };
    }

    const argCheck = validatePrintSilentArgs(args);
    if (!argCheck.valid) {
      return {
        success: false,
        failureReason: argCheck.error,
        error: argCheck.error,
      };
    }

    const { deviceName, copies } = argCheck.options;
    return new Promise((resolve) => {
      try {
        mainWindow.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName,
            copies,
          },
          (success, failureReason) => {
            const reason = failureReason ? String(failureReason) : undefined;
            resolve({
              success: Boolean(success),
              failureReason: reason,
              error: Boolean(success) ? undefined : reason,
            });
          }
        );
      } catch {
        resolve({
          success: false,
          failureReason: 'Desktop silent print failed',
          error: 'Desktop silent print failed',
        });
      }
    });
  });

  ipcMain.handle('desktop:get-info', async (event, ...args) => ({
    ...(() => {
      const senderCheck = validateTrustedIpcSender(event, mainWindow, serverPort);
      if (!senderCheck.valid) {
        throw new Error(senderCheck.error);
      }
      const argCheck = validateNoArgs(args);
      if (!argCheck.valid) {
        throw new Error(argCheck.error);
      }
      return buildSafeDesktopInfo({
        appVersion: app.getVersion(),
        platform: process.platform,
        serverPort,
      });
    })(),
  }));
}

function createMainWindow(iconPath) {
  const isPackaged = Boolean(app?.isPackaged);
  configureSessionSecurity(serverPort, isPackaged);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1180,
    minHeight: 740,
    title: 'GOLDEN PALACE POS — القصر الذهبي',
    backgroundColor: '#171717',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !isPackaged,
    },
  });

  configureApplicationMenu(mainWindow, isPackaged);
  attachWebContentsSecurity(mainWindow.webContents, {
    serverPort,
    isPackaged,
    approvedExternalOrigins: DEFAULT_APPROVED_EXTERNAL_ORIGINS,
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('web-contents-created', (_event, contents) => {
    attachWebContentsSecurity(contents, {
      serverPort,
      isPackaged: Boolean(app?.isPackaged),
      approvedExternalOrigins: DEFAULT_APPROVED_EXTERNAL_ORIGINS,
    });
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const userDataDir = app.getPath('userData');
    const { iconPath } = resolveBundledPaths();
    try {
      const { dbPath, backupDir } = await startLocalPosServer(userDataDir);
      registerIpcHandlers({ userDataDir, dbPath, backupDir });
      createMainWindow(iconPath);
    } catch (err) {
      const safeLog = sanitizeStartupLogText(
        `${err instanceof Error ? err.message : String(err)}\n${err?.stderrTail || ''}`
      );
      console.error('[GOLDEN-PALACE-STARTUP-ERROR]', safeLog);
      const diagnostic = classifyStartupError(err, err?.stderrTail || '');
      dialog.showErrorBox(diagnostic.title, diagnostic.message);
      await stopLocalPosServer();
      app.quit();
    }
  });

  app.on('before-quit', async (event) => {
    if (isAppQuitting) return;
    event.preventDefault();
    isAppQuitting = true;
    await stopLocalPosServer();
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
