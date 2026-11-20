'use strict';

const ALLOWED_IPC_CHANNELS = Object.freeze([
  'desktop:get-printers',
  'desktop:print-silent',
  'desktop:get-info',
]);

// Permissions explicitly required by verified POS renderer features:
// - 'clipboard-sanitized-write': Used by ReceiptPrint.tsx to copy the Windows spool helper command.
// All other permissions (camera, microphone, geolocation, notifications, serial, usb, hid,
// clipboard-read, openExternal, display-capture, fullscreen, etc.) are DENIED by default.
const ALLOWED_DESKTOP_PERMISSIONS = Object.freeze(['clipboard-sanitized-write']);

// External links are blocked by default. Only explicitly approved HTTPS origins may open externally.
const DEFAULT_APPROVED_EXTERNAL_ORIGINS = Object.freeze([]);

const MAX_PRINT_PAYLOAD_BYTES = 1024;
const MAX_DEVICE_NAME_LENGTH = 256;
const MIN_PRINT_COPIES = 1;
const MAX_PRINT_COPIES = 5;

const ALLOWED_PRINT_OPTION_KEYS = new Set(['deviceName', 'copies']);
const CONTROL_OR_UNSAFE_DEVICE_CHARS = /[\x00-\x1f\x7f<>]/;

function getExpectedAppOrigin(serverPort) {
  const portNum = Number(serverPort);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return null;
  }
  return `http://127.0.0.1:${portNum}`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates whether a navigation/redirect URL strictly matches the local POS loopback origin.
 * Rejects localhost aliases, foreign ports, external HTTPS sites, file://, javascript:, data:, etc.
 */
function isAllowedAppOrigin(rawUrl, serverPort) {
  const expectedOrigin = getExpectedAppOrigin(serverPort);
  if (!expectedOrigin || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      return false;
    }
    return (
      parsed.protocol === 'http:' &&
      parsed.hostname === '127.0.0.1' &&
      parsed.port === String(serverPort) &&
      parsed.origin === expectedOrigin
    );
  } catch {
    return false;
  }
}

/**
 * Evaluates top-level window navigation or HTTP redirect attempts.
 */
function evaluateNavigation(rawUrl, serverPort) {
  if (isAllowedAppOrigin(rawUrl, serverPort)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: 'Blocked navigation to untrusted origin',
  };
}

/**
 * Validates whether an external URL is explicitly approved for opening in the OS default browser.
 * Enforces HTTPS-only, no embedded credentials, and exact origin match against approvedOrigins.
 */
function isApprovedExternalUrl(rawUrl, approvedOrigins = DEFAULT_APPROVED_EXTERNAL_ORIGINS) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { approved: false, normalizedUrl: null };
  }
  if (!Array.isArray(approvedOrigins) || approvedOrigins.length === 0) {
    return { approved: false, normalizedUrl: null };
  }

  const normalizedAllowed = new Set();
  for (const item of approvedOrigins) {
    if (typeof item !== 'string') continue;
    try {
      const parsedAllowed = new URL(item.trim());
      if (parsedAllowed.protocol === 'https:' && !parsedAllowed.username && !parsedAllowed.password) {
        normalizedAllowed.add(parsedAllowed.origin);
      }
    } catch {
      // Ignore invalid allowlist entry
    }
  }
  if (normalizedAllowed.size === 0) {
    return { approved: false, normalizedUrl: null };
  }

  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return { approved: false, normalizedUrl: null };
    }
    if (!normalizedAllowed.has(parsed.origin)) {
      return { approved: false, normalizedUrl: null };
    }
    return { approved: true, normalizedUrl: parsed.href };
  } catch {
    return { approved: false, normalizedUrl: null };
  }
}

/**
 * Controlled handler for Electron `setWindowOpenHandler`.
 * ALWAYS denies spawning child Electron BrowserWindows (`{ action: 'deny' }`).
 * Opens external URLs in the system browser ONLY if explicitly approved in `approvedExternalOrigins`.
 */
function evaluateWindowOpen(rawUrl, options = {}) {
  const {
    approvedExternalOrigins = DEFAULT_APPROVED_EXTERNAL_ORIGINS,
    openExternal,
  } = options;

  const check = isApprovedExternalUrl(rawUrl, approvedExternalOrigins);
  if (check.approved && check.normalizedUrl && typeof openExternal === 'function') {
    try {
      Promise.resolve(openExternal(check.normalizedUrl)).catch(() => {});
      return { action: 'deny', openedExternally: true, url: check.normalizedUrl };
    } catch {
      return { action: 'deny', openedExternally: false };
    }
  }

  return { action: 'deny', openedExternally: false };
}

/**
 * Deny-by-default Electron session permission evaluator.
 * Allows only explicitly documented POS permissions strictly on the local POS origin.
 */
function evaluatePermission(permission, originOrUrl, serverPort) {
  if (typeof permission !== 'string' || !ALLOWED_DESKTOP_PERMISSIONS.includes(permission)) {
    return false;
  }
  const expectedOrigin = getExpectedAppOrigin(serverPort);
  if (!expectedOrigin || typeof originOrUrl !== 'string' || !originOrUrl.trim()) {
    return false;
  }
  try {
    const parsed = new URL(originOrUrl);
    return (
      parsed.protocol === 'http:' &&
      parsed.hostname === '127.0.0.1' &&
      parsed.port === String(serverPort) &&
      parsed.origin === expectedOrigin
    );
  } catch {
    return false;
  }
}

/**
 * Identifies DevTools and view-source shortcuts that must be blocked in packaged production builds.
 * Explicitly preserves POS cashier function keys (F1-F12, Escape) and standard text editing.
 */
function isBlockedProductionShortcut(input) {
  if (!input || typeof input !== 'object') return false;
  if (input.type && input.type !== 'keyDown') return false;

  const key = String(input.key || '').toLowerCase();
  const hasCtrlOrMeta = Boolean(input.control || input.meta);
  const hasShift = Boolean(input.shift);
  const hasAlt = Boolean(input.alt);

  // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C (Windows/Linux DevTools)
  if (hasCtrlOrMeta && hasShift && (key === 'i' || key === 'j' || key === 'c')) {
    return true;
  }
  // Cmd+Option+I / Cmd+Option+J / Cmd+Option+C (macOS DevTools)
  if (Boolean(input.meta) && hasAlt && (key === 'i' || key === 'j' || key === 'c')) {
    return true;
  }
  // Ctrl+U / Cmd+Option+U (View Source)
  if (hasCtrlOrMeta && !hasShift && key === 'u') {
    return true;
  }

  return false;
}

/**
 * Builds the strict desktop Content-Security-Policy header enforced in Electron `onHeadersReceived`.
 */
function buildDesktopCspHeader(serverPort, isProduction = true) {
  const origin = getExpectedAppOrigin(serverPort) || 'http://127.0.0.1:3456';
  const scriptSrc = isProduction ? "'self'" : "'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${origin}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function validateTrustedIpcSender(event, mainWindow, serverPort) {
  const expectedOrigin = getExpectedAppOrigin(serverPort);
  if (!expectedOrigin) {
    return { valid: false, error: 'Server origin unavailable' };
  }

  if (!mainWindow || typeof mainWindow.isDestroyed !== 'function' || mainWindow.isDestroyed()) {
    return { valid: false, error: 'No active POS window' };
  }

  const targetWebContents = mainWindow.webContents;
  if (
    !targetWebContents ||
    (typeof targetWebContents.isDestroyed === 'function' && targetWebContents.isDestroyed())
  ) {
    return { valid: false, error: 'POS window contents unavailable' };
  }

  if (!event || !event.sender || event.sender !== targetWebContents) {
    return { valid: false, error: 'Unauthorized IPC sender' };
  }

  if (typeof event.sender.isDestroyed === 'function' && event.sender.isDestroyed()) {
    return { valid: false, error: 'IPC sender destroyed' };
  }

  const frame = event.senderFrame;
  if (!frame || frame.destroyed === true || typeof frame.url !== 'string' || !frame.url) {
    return { valid: false, error: 'Missing or destroyed IPC sender frame' };
  }

  if (targetWebContents.mainFrame && frame !== targetWebContents.mainFrame) {
    return { valid: false, error: 'Unauthorized IPC frame' };
  }

  if (frame.top && frame.top !== frame) {
    return { valid: false, error: 'Nested IPC frames are not permitted' };
  }

  let parsedOrigin = null;
  try {
    const parsedUrl = new URL(frame.url);
    if (
      parsedUrl.protocol !== 'http:' ||
      parsedUrl.hostname !== '127.0.0.1' ||
      parsedUrl.port !== String(serverPort)
    ) {
      return { valid: false, error: 'Unauthorized IPC origin' };
    }
    parsedOrigin = parsedUrl.origin;
  } catch {
    return { valid: false, error: 'Invalid IPC sender URL' };
  }

  if (parsedOrigin !== expectedOrigin) {
    return { valid: false, error: 'Unauthorized IPC origin' };
  }

  return { valid: true, origin: expectedOrigin };
}

function validateNoArgs(args) {
  if (!Array.isArray(args)) {
    return { valid: false, error: 'Invalid IPC argument list' };
  }
  if (args.length === 0) {
    return { valid: true };
  }
  if (args.length === 1 && args[0] === undefined) {
    return { valid: true };
  }
  return { valid: false, error: 'Unexpected IPC arguments' };
}

function validatePrintSilentArgs(args) {
  if (!Array.isArray(args) || args.length > 1) {
    return { valid: false, error: 'Invalid argument count for printSilent' };
  }

  if (args.length === 0 || args[0] === undefined) {
    return {
      valid: true,
      options: { deviceName: undefined, copies: MIN_PRINT_COPIES },
    };
  }

  const raw = args[0];
  if (!isPlainObject(raw)) {
    return { valid: false, error: 'Print options must be a plain object' };
  }

  if (Object.getOwnPropertySymbols(raw).length > 0) {
    return { valid: false, error: 'Unexpected symbol property in print options' };
  }

  let serialized;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return { valid: false, error: 'Malformed print options payload' };
  }

  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_PRINT_PAYLOAD_BYTES) {
    return { valid: false, error: 'Print options payload exceeds maximum size' };
  }

  const ownKeys = Object.getOwnPropertyNames(raw);
  for (const key of ownKeys) {
    if (!ALLOWED_PRINT_OPTION_KEYS.has(key)) {
      return { valid: false, error: 'Unexpected print option property' };
    }
  }

  let deviceName;
  if (raw.deviceName !== undefined && raw.deviceName !== null) {
    if (typeof raw.deviceName !== 'string') {
      return { valid: false, error: 'Printer deviceName must be a string' };
    }
    if (CONTROL_OR_UNSAFE_DEVICE_CHARS.test(raw.deviceName)) {
      return { valid: false, error: 'Printer deviceName contains invalid characters' };
    }
    const trimmed = raw.deviceName.trim();
    if (raw.deviceName.length > 0 && trimmed.length === 0) {
      return { valid: false, error: 'Printer deviceName cannot be whitespace only' };
    }
    if (trimmed.length > MAX_DEVICE_NAME_LENGTH) {
      return { valid: false, error: 'Printer deviceName exceeds maximum length' };
    }
    deviceName = trimmed.length > 0 ? trimmed : undefined;
  }

  let copies = MIN_PRINT_COPIES;
  if (raw.copies !== undefined) {
    if (
      typeof raw.copies !== 'number' ||
      !Number.isInteger(raw.copies) ||
      raw.copies < MIN_PRINT_COPIES ||
      raw.copies > MAX_PRINT_COPIES
    ) {
      return {
        valid: false,
        error: `Print copies must be an integer between ${MIN_PRINT_COPIES} and ${MAX_PRINT_COPIES}`,
      };
    }
    copies = raw.copies;
  }

  return {
    valid: true,
    options: { deviceName, copies },
  };
}

function buildSafeDesktopInfo({ appVersion, platform, serverPort }) {
  return {
    appName: 'GOLDEN PALACE POS',
    appVersion: String(appVersion || '1.0.0'),
    platform: String(platform || process.platform),
    serverUrl: getExpectedAppOrigin(serverPort) || '',
  };
}

/**
 * Redacts secrets, internal user paths, and JS stack traces before logging startup errors.
 */
function sanitizeStartupLogText(text) {
  if (!text) return '';
  return String(text)
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/(JWT_SECRET|password|passwordHash|pin|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, '[LOCAL_PATH]')
    .replace(/\/(?:Users|home|root|var|tmp|app|opt|etc)\/[^\s"'<>]+/g, '[LOCAL_PATH]')
    .replace(/^\s*at\s+.*$/gm, '')
    .trim();
}

/**
 * Classifies local server/database startup failures into safe, bilingual Arabic/French
 * user-facing dialogs with zero credentials, zero sensitive internal paths, and zero stack traces.
 */
function classifyStartupError(err, stderrOutput = '') {
  const errCode = typeof err?.code === 'string' ? err.code : '';
  const errName = typeof err?.name === 'string' ? err.name : '';
  const errMessage = err instanceof Error ? err.message : String(err || '');
  const combined = `${errName} ${errCode} ${errMessage}\n${String(stderrOutput || '')}`;

  // 1. Phase 1 Multi-Database Conflict / Historical Preservation Stop Guard
  if (
    /DATABASE_CONFLICT_REQUIRES_OWNER_CONFIRMATION|DatabaseConflictError|DATABASE CONFLICT STOP|DATABASE PRESERVATION STOP|MULTIPLE_POS_DATABASES|HISTORICAL_DB_WOULD_BE_BYPASSED/i.test(
      combined
    )
  ) {
    return {
      category: 'DATABASE_CONFLICT',
      code: 'GP-ERR-DB-CONFLICT',
      title: 'GOLDEN PALACE POS — تعارض في قاعدة البيانات / Conflit de base de données',
      message: [
        'توقف التشغيل تلقائياً لحماية بيانات المطعم: تم اكتشاف أكثر من ملف قاعدة بيانات محلي، ولن يختار النظام بينها تلقائياً.',
        'يرجى مراجعة ملف التقرير (database_identification_report.json) والتواصل مع مدير النظام لتحديد قاعدة البيانات المعتمدة.',
        '',
        'Démarrage interrompu par sécurité : plusieurs bases de données locales ont été détectées. Le système refuse de choisir automatiquement afin de protéger vos données.',
        'Veuillez consulter le rapport (database_identification_report.json) et contacter l’administrateur pour confirmer la base principale.',
        '',
        'Code: GP-ERR-DB-CONFLICT',
      ].join('\n'),
    };
  }

  // 2. Corrupted SQLite Database / Integrity Check Failure
  if (
    /DATABASE_CORRUPTED|SQLITE_CORRUPT|SQLITE_NOTADB|database disk image is malformed|file is not a database|integrity_check/i.test(
      combined
    )
  ) {
    return {
      category: 'DATABASE_CORRUPTED',
      code: 'GP-ERR-DB-CORRUPT',
      title: 'GOLDEN PALACE POS — تلف في قاعدة البيانات / Base de données endommagée',
      message: [
        'تعذر فتح قاعدة البيانات المحلية لأن الملف تالف أو غير مكتمل. تم إيقاف التشغيل لحماية السجلات من أي تعديل إضافي.',
        'يرجى عدم حذف أي ملفات والتواصل مع الدعم الفني لاستعادة آخر نسخة احتياطية سليمة.',
        '',
        'Impossible d’ouvrir la base de données locale : le fichier semble corrompu ou illisible. Le démarrage a été arrêté pour éviter toute perte supplémentaire.',
        'Ne supprimez aucun fichier et contactez le support technique pour restaurer la dernière sauvegarde vérifiée.',
        '',
        'Code: GP-ERR-DB-CORRUPT',
      ].join('\n'),
    };
  }

  // 3. Phase 1 Versioned Migration / Pre-Migration Backup / Rollback Failure
  if (
    /DatabaseMigrationError|MIGRATION_FAILED|PRE_MIGRATION_BACKUP_FAILED|POST_MIGRATION_INTEGRITY_FAILED|ROLLBACK_FAILED|\[DB MIGRATION FAILED\]/i.test(
      combined
    )
  ) {
    const rolledBack = /Automatically rolled back|rolledBack:\s*true/i.test(combined);
    return {
      category: 'DATABASE_MIGRATION_FAILED',
      code: 'GP-ERR-DB-MIGRATION',
      title: 'GOLDEN PALACE POS — فشل تحديث قاعدة البيانات / Échec de mise à jour de la base',
      message: [
        rolledBack
          ? 'فشل تحديث هيكل قاعدة البيانات، وقد قام النظام باسترجاع النسخة الاحتياطية السابقة تلقائياً لحماية بيانات المطعم.'
          : 'فشل تحديث هيكل قاعدة البيانات وتم إيقاف التشغيل فوراً لحماية بيانات المطعم.',
        'يرجى إبلاغ الدعم الفني قبل إعادة المحاولة.',
        '',
        rolledBack
          ? 'La mise à jour de la base de données a échoué. Une restauration automatique vers la sauvegarde préalable a été effectuée pour préserver vos données.'
          : 'La mise à jour de la base de données a échoué et le démarrage a été arrêté immédiatement pour protéger vos données.',
        'Veuillez contacter le support technique avant de relancer l’application.',
        '',
        'Code: GP-ERR-DB-MIGRATION',
      ].join('\n'),
    };
  }

  // 4. Unexpected Local Server Startup Failure (timeout, missing bundle, port error, unexpected exit)
  return {
    category: 'SERVER_STARTUP_ERROR',
    code: 'GP-ERR-SERVER-START',
    title: 'GOLDEN PALACE POS — خطأ في تشغيل الخادم المحلي / Erreur de démarrage du serveur local',
    message: [
      'تعذر تشغيل خادم نقطة البيع المحلي بشكل سليم. لم يتم تعديل بيانات المطعم.',
      'يرجى إغلاق أي نسخة مفتوحة من البرنامج وإعادة التشغيل، أو التواصل مع الدعم الفني إذا استمرت المشكلة.',
      '',
      'Le serveur local de la caisse n’a pas pu démarrer correctement. Aucune donnée du restaurant n’a été modifiée.',
      'Veuillez fermer toute autre instance du logiciel et relancer l’application, ou contacter le support technique si le problème persiste.',
      '',
      'Code: GP-ERR-SERVER-START',
    ].join('\n'),
  };
}

module.exports = {
  ALLOWED_IPC_CHANNELS,
  ALLOWED_DESKTOP_PERMISSIONS,
  DEFAULT_APPROVED_EXTERNAL_ORIGINS,
  MAX_PRINT_PAYLOAD_BYTES,
  MAX_DEVICE_NAME_LENGTH,
  MIN_PRINT_COPIES,
  MAX_PRINT_COPIES,
  getExpectedAppOrigin,
  isPlainObject,
  isAllowedAppOrigin,
  evaluateNavigation,
  isApprovedExternalUrl,
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
};
