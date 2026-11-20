const { contextBridge, ipcRenderer } = require('electron');

const MAX_PRINT_DEVICE_NAME_LENGTH = 256;
const MAX_PRINT_PAYLOAD_CHARS = 1024;
const ALLOWED_PRINT_KEYS = new Set(['deviceName', 'copies']);
const UNSAFE_DEVICE_CHARS = /[\x00-\x1f\x7f<>]/;

function assertZeroArgs(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === undefined)) {
    return;
  }
  throw new Error('Unexpected IPC arguments');
}

function sanitizePreloadPrintOptions(args) {
  if (args.length > 1) {
    return { valid: false, error: 'Invalid argument count for printSilent' };
  }
  const raw = args[0];
  if (raw === undefined) {
    return { valid: true, payload: {} };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Print options must be a plain object' };
  }
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) {
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
  if (typeof serialized !== 'string' || serialized.length > MAX_PRINT_PAYLOAD_CHARS) {
    return { valid: false, error: 'Print options payload exceeds maximum size' };
  }
  for (const key of Object.getOwnPropertyNames(raw)) {
    if (!ALLOWED_PRINT_KEYS.has(key)) {
      return { valid: false, error: 'Unexpected print option property' };
    }
  }
  const payload = {};
  if (raw.deviceName !== undefined && raw.deviceName !== null) {
    if (typeof raw.deviceName !== 'string' || UNSAFE_DEVICE_CHARS.test(raw.deviceName)) {
      return { valid: false, error: 'Invalid printer deviceName' };
    }
    const trimmed = raw.deviceName.trim();
    if ((raw.deviceName.length > 0 && trimmed.length === 0) || trimmed.length > MAX_PRINT_DEVICE_NAME_LENGTH) {
      return { valid: false, error: 'Invalid printer deviceName length' };
    }
    if (trimmed.length > 0) {
      payload.deviceName = trimmed;
    }
  }
  if (raw.copies !== undefined) {
    if (typeof raw.copies !== 'number' || !Number.isInteger(raw.copies) || raw.copies < 1 || raw.copies > 5) {
      return { valid: false, error: 'Print copies must be an integer between 1 and 5' };
    }
    payload.copies = raw.copies;
  }
  return { valid: true, payload };
}

contextBridge.exposeInMainWorld(
  'goldenPalaceDesktop',
  Object.freeze({
    isDesktop: true,
    getPrinters: (...args) => {
      assertZeroArgs(args);
      return ipcRenderer.invoke('desktop:get-printers');
    },
    printSilent: (...args) => {
      const check = sanitizePreloadPrintOptions(args);
      if (!check.valid) {
        return Promise.resolve({
          success: false,
          failureReason: check.error,
          error: check.error,
        });
      }
      return ipcRenderer.invoke('desktop:print-silent', check.payload);
    },
    getDesktopInfo: (...args) => {
      assertZeroArgs(args);
      return ipcRenderer.invoke('desktop:get-info');
    },
  })
);
