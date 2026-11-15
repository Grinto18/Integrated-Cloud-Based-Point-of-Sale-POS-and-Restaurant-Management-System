const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { fork } = require('child_process');

app.setName('Golden Palace POS');

let mainWindow = null;
let serverProcess = null;
let serverPort = 3456;
let isAppQuitting = false;

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

function waitForServerHealth(port, timeoutMs = 20000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Timed out waiting for GOLDEN PALACE POS local server'));
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 400) {
          resolve();
        } else {
          setTimeout(attempt, 250);
        }
      });
      req.on('error', () => {
        setTimeout(attempt, 250);
      });
      req.setTimeout(1500, () => {
        req.destroy();
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function resolveBundledPaths() {
  const appRoot = app.isPackaged ? path.dirname(app.getAppPath()) : path.resolve(__dirname, '..');
  const distDir = fs.existsSync(path.join(app.getAppPath(), 'dist'))
    ? path.join(app.getAppPath(), 'dist')
    : path.join(appRoot, 'dist');
  const serverEntry = fs.existsSync(path.join(app.getAppPath(), 'dist-electron', 'server.cjs'))
    ? path.join(app.getAppPath(), 'dist-electron', 'server.cjs')
    : path.join(appRoot, 'dist-electron', 'server.cjs');
  const iconPath = fs.existsSync(path.join(appRoot, 'build', 'icon.ico'))
    ? path.join(appRoot, 'build', 'icon.ico')
    : path.join(__dirname, '..', 'build', 'icon.png');
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
    process.stderr.write(`[POS-SERVER-ERR] ${chunk}`);
  });

  await waitForServerHealth(serverPort);
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

function registerIpcHandlers(paths) {
  ipcMain.handle('desktop:get-printers', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return [];
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      description: p.description || '',
      status: p.status,
      isDefault: Boolean(p.isDefault),
    }));
  });

  ipcMain.handle('desktop:print-silent', async (_event, options = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, failureReason: 'No active POS window' };
    }
    return new Promise((resolve) => {
      mainWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: options.deviceName || undefined,
          copies: Number(options.copies) > 0 ? Number(options.copies) : 1,
        },
        (success, failureReason) => {
          resolve({ success: Boolean(success), failureReason: failureReason || undefined });
        }
      );
    });
  });

  ipcMain.handle('desktop:get-info', async () => ({
    appName: 'GOLDEN PALACE POS',
    appVersion: app.getVersion(),
    platform: process.platform,
    userDataDir: paths.userDataDir,
    dbPath: paths.dbPath,
    backupDir: paths.backupDir,
    serverUrl: `http://127.0.0.1:${serverPort}`,
  }));
}

function createMainWindow(iconPath) {
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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
      dialog.showErrorBox(
        'GOLDEN PALACE POS — Startup Error',
        err instanceof Error ? err.message : String(err)
      );
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
