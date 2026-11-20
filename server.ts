import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { apiRouter } from './src/server/api.ts';
import { ensureServerRuntimeJwtSecret, getJwtSecret } from './src/middleware/auth.ts';
import { apiErrorHandler } from './src/middleware/errorHandler.ts';
import {
  createSecurityHeadersMiddleware,
  createStrictCorsMiddleware,
} from './src/middleware/httpSecurity.ts';
import { sanitizeErrorMessage } from './src/utils/redact.ts';
import { backupManager } from './src/services/backupService.ts';
import { closeDatabase, db, sqlite } from './src/db/index.ts';
import { users } from './src/db/schema.ts';
import { seedDatabase, ensureThirtyTables } from './src/db/seed.ts';
import { runFirstRunDatabaseAudit } from './src/services/desktopLifecycle.ts';

// Ensure server runtime has a valid JWT secret:
// - Cloud Run / Web Production: fail fast if JWT_SECRET (or JWT_SECRET_FILE) is missing or insecure
// - Electron Desktop / Dev: preserve persistent local CSPRNG secret
try {
  ensureServerRuntimeJwtSecret();
  getJwtSecret();
} catch (err: any) {
  console.error(`❌ ${err?.message || 'CRITICAL SECURITY ERROR: Invalid JWT_SECRET configuration.'}`);
  if (process.env.NODE_ENV === 'production' && process.env.GOLDEN_PALACE_DESKTOP !== '1') {
    console.error(
      'ℹ️ Cloud Run production requires a stable >=32-byte JWT_SECRET via environment variable or Google Secret Manager (JWT_SECRET / JWT_SECRET_FILE).'
    );
  }
  process.exit(1);
}

function readBackupSchedulerConfig(): {
  autoEnabled: boolean;
  intervalHours: number;
  retentionCount: number;
} {
  const defaults = { autoEnabled: true, intervalHours: 6, retentionCount: 14 };
  try {
    if (!sqlite || !sqlite.open) return defaults;
    const rows = sqlite
      .prepare(
        "SELECT key, value FROM restaurant_settings WHERE key IN ('backup_auto_enabled', 'backup_interval_hours', 'backup_retention_count')"
      )
      .all() as { key: string; value: string }[];
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const autoEnabled = map.get('backup_auto_enabled') !== 'false';
    const parsedInterval = Number(map.get('backup_interval_hours'));
    const parsedRetention = Number(map.get('backup_retention_count'));
    return {
      autoEnabled,
      intervalHours: Number.isFinite(parsedInterval) && parsedInterval >= 1 ? parsedInterval : 6,
      retentionCount: Number.isFinite(parsedRetention) && parsedRetention >= 1 ? Math.floor(parsedRetention) : 14,
    };
  } catch {
    return defaults;
  }
}

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception in server:', sanitizeErrorMessage(err));
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection in server:', sanitizeErrorMessage(reason));
});

const app = express();
app.disable('x-powered-by');

const portArgIndex = process.argv.indexOf('--port');
const argPort = portArgIndex !== -1 ? process.argv[portArgIndex + 1] : undefined;
const PORT = Number(argPort || process.env.PORT || 3000);

const hostArgIndex = process.argv.indexOf('--host');
const argHost = hostArgIndex !== -1 ? process.argv[hostArgIndex + 1] : undefined;
const HOST = argHost || process.env.HOST || '0.0.0.0';

const isDesktopRuntime = process.env.GOLDEN_PALACE_DESKTOP === '1';
const isProductionRuntime = process.env.NODE_ENV === 'production';
const allowIframePreview =
  !isDesktopRuntime &&
  (!isProductionRuntime ||
    /ais-(dev|pre)-/i.test(process.env.APP_URL || '') ||
    process.env.ALLOW_IFRAME_PREVIEW === '1');

const httpSecurityConfig = {
  port: PORT,
  isDesktop: isDesktopRuntime,
  isProduction: isProductionRuntime,
  allowIframePreview,
};

app.use(createSecurityHeadersMiddleware(httpSecurityConfig));
app.use(createStrictCorsMiddleware(httpSecurityConfig));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Mount All Backend API Routes (includes live DB-verified /api/health and JSON 404/error handlers)
app.use('/api', apiRouter);
app.use('/api', apiErrorHandler);

let httpServer: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;

async function handleGracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`🛡️ Received ${signal}, running safe SQLite shutdown backup...`);

  const forceTimer = setTimeout(() => {
    closeDatabase();
    process.exit(0);
  }, 8000);
  if (typeof forceTimer.unref === 'function') forceTimer.unref();

  try {
    const cfg = readBackupSchedulerConfig();
    await backupManager.runShutdownBackup(cfg.retentionCount);
  } catch (err) {
    console.error('Shutdown backup failed:', sanitizeErrorMessage(err));
  } finally {
    closeDatabase();
    if (httpServer) {
      httpServer.close(() => {
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }
}

process.on('SIGTERM', () => {
  void handleGracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void handleGracefulShutdown('SIGINT');
});
process.on('message', (msg: any) => {
  if (msg === 'shutdown' || (msg && typeof msg === 'object' && msg.type === 'shutdown')) {
    void handleGracefulShutdown('IPC_SHUTDOWN');
  }
});

async function initializeDatabaseAndBackups() {
  try {
    const isProductionOrDesktop =
      process.env.GOLDEN_PALACE_DB_MODE === 'production' ||
      process.env.GOLDEN_PALACE_DESKTOP === '1' ||
      process.env.SKIP_DEFAULT_USER_SEED === '1' ||
      process.env.NODE_ENV === 'production';

    if (isProductionOrDesktop) {
      // Production / Desktop safe init: never inject demo users, categories, products, or tables
      const audit = runFirstRunDatabaseAudit(sqlite);
      if (audit.integrityCheck !== 'ok') {
        console.error('❌ DATABASE_CORRUPTED: PRAGMA integrity_check failed during startup audit.');
        closeDatabase();
        process.exit(1);
      }
      console.log(
        `🖥️ Production SQLite ready (${audit.dbPath}) — users: ${audit.usersCount}, integrity: ${audit.integrityCheck}`
      );
    } else if (process.env.GOLDEN_PALACE_ALLOW_DEMO_SEED === '1') {
      const existingUsers = await db.select().from(users).limit(1);
      if (existingUsers.length === 0) {
        console.log('📦 Seeding initial Golden Palace POS development SQLite database...');
        await seedDatabase({ allowDemoUsers: true });
      }
      await ensureThirtyTables();
    } else {
      const existingUsers = await db.select().from(users).limit(1);
      if (existingUsers.length === 0) {
        console.log('🛡️ Empty database initialized without demo users (complete setup at /api/system/setup-admin or set GOLDEN_PALACE_ALLOW_DEMO_SEED=1 in dev).');
      }
      await ensureThirtyTables();
    }

    // Start periodic daily/weekly/interval SQLite backup scheduler
    backupManager.startScheduler(readBackupSchedulerConfig);
    setTimeout(() => {
      const cfg = readBackupSchedulerConfig();
      backupManager.checkAndRunScheduledBackups(cfg).catch((err) => {
        console.warn('Initial scheduled backup check note:', sanitizeErrorMessage(err));
      });
    }, 5000).unref();
  } catch (seedErr) {
    console.warn('DB initialization note:', sanitizeErrorMessage(seedErr));
  }
}

async function bootstrap() {
  await initializeDatabaseAndBackups();

  const isProduction = process.env.NODE_ENV === 'production';
  const distPath = process.env.GOLDEN_PALACE_DIST_DIR || path.resolve(process.cwd(), 'dist');

  if (isProduction && fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API route not found' });
      }
      return res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else if (!isProduction) {
    // Development Mode with Vite Middleware (HMR disabled per environment constraints)
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.error('❌ Production dist directory not found:', distPath);
  }

  // Centralized error handler fallback for body-parser / unexpected middleware errors
  app.use(apiErrorHandler);

  httpServer = app.listen(Number(PORT), HOST, () => {
    console.log(`🏰 GOLDEN PALACE POS Server active on http://${HOST}:${PORT}`);
    if (typeof process.send === 'function') {
      process.send({ type: 'server-ready', host: HOST, port: PORT });
    }
  });
}

void bootstrap();

