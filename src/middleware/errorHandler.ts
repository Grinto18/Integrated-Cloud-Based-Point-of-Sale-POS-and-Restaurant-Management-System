import type { Request, Response, NextFunction } from 'express';
import { redactSensitiveText, sanitizeErrorMessage } from '../utils/redact.ts';

/**
 * Parses a strict positive integer ID from route params or JSON body.
 * Rejects NaN, floats, zero, negative numbers, and non-numeric strings.
 */
export function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Parses a finite non-negative number (rejects NaN, Infinity, negative values, and non-numeric strings).
 */
export function parseFiniteNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

/**
 * Parses a finite strictly positive number (> 0).
 */
export function parseFinitePositive(value: unknown): number | null {
  const num = parseFiniteNonNegative(value);
  if (num === null || num <= 0) return null;
  return num;
}

/**
 * Emits a credential-free structured JSON error log line.
 * Never logs Authorization headers, cookies, passwords, PINs, or raw request bodies.
 */
export function logStructuredError(
  context: string,
  err: unknown,
  req?: Request
): void {
  const payload: Record<string, unknown> = {
    level: 'error',
    timestamp: new Date().toISOString(),
    context,
    message: sanitizeErrorMessage(err),
  };

  if (req) {
    payload.method = req.method;
    payload.path = redactSensitiveText(req.originalUrl || req.url || '');
    const user = (req as any).user;
    if (user?.id) {
      payload.userId = user.id;
      payload.userRole = user.role;
    }
  }

  console.error(JSON.stringify(payload));
}

/**
 * Clean JSON 404 handler for unmatched /api/* routes.
 */
export function apiNotFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'نقطة النهاية غير موجودة',
    code: 'API_ROUTE_NOT_FOUND',
    path: redactSensitiveText(req.path || ''),
  });
}

/**
 * Centralized Express error-handling middleware (4-argument signature).
 * Converts malformed JSON syntax errors, oversized payloads, and unexpected exceptions
 * into consistent, credential-free JSON responses without exposing stack traces.
 */
export function apiErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    return next(err);
  }

  const errStatus = typeof err?.status === 'number' ? err.status : undefined;

  // Body-parser malformed JSON SyntaxError
  if (err && (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && errStatus === 400))) {
    res.status(400).json({
      error: 'تنسيق بيانات JSON غير صالح',
      code: 'INVALID_JSON',
    });
    return;
  }

  // Body-parser payload too large
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    res.status(413).json({
      error: 'حجم الطلب يتجاوز الحد المسموح به',
      code: 'PAYLOAD_TOO_LARGE',
    });
    return;
  }

  logStructuredError('UNHANDLED_API_ERROR', err, req);

  const statusCode =
    typeof err?.status === 'number' && err.status >= 400 && err.status < 500
      ? err.status
      : 500;

  res.status(statusCode).json({
    error: statusCode === 500 ? 'حدث خطأ داخلي في الخادم' : sanitizeErrorMessage(err),
    code: statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR',
  });
}
