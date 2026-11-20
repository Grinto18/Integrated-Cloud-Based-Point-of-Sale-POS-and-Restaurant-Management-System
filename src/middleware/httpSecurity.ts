import type { Request, Response, NextFunction } from 'express';

export interface HttpSecurityConfig {
  port: number;
  isDesktop: boolean;
  isProduction: boolean;
  allowedOrigins?: string[];
  allowIframePreview?: boolean;
}

/**
 * Normalizes an origin string to its canonical `scheme://host[:port]` form.
 * Rejects wildcards (`*`), non-HTTP(S) schemes, credentials, and malformed URLs.
 */
export function normalizeHttpOrigin(rawOrigin: string | undefined | null): string | null {
  if (!rawOrigin || typeof rawOrigin !== 'string') return null;
  const trimmed = rawOrigin.trim();
  if (!trimmed || trimmed === '*' || trimmed.toLowerCase() === 'null') return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Parses comma-separated origin allowlist environment values safely.
 */
export function parseAllowedOriginsEnv(rawValue?: string): string[] {
  if (!rawValue || typeof rawValue !== 'string') return [];
  const results: string[] = [];
  for (const token of rawValue.split(',')) {
    const normalized = normalizeHttpOrigin(token);
    if (normalized) {
      results.push(normalized);
    }
  }
  return results;
}

/**
 * Computes the strict set of allowed CORS origins for the active runtime mode.
 * Never returns `*` (wildcard).
 */
export function resolveAllowedCorsOrigins(
  config: HttpSecurityConfig,
  env: NodeJS.ProcessEnv = process.env
): Set<string> {
  const allowed = new Set<string>();

  for (const explicit of config.allowedOrigins || []) {
    const normalized = normalizeHttpOrigin(explicit);
    if (normalized) allowed.add(normalized);
  }

  for (const fromEnv of parseAllowedOriginsEnv(env.CORS_ALLOWED_ORIGINS || env.ALLOWED_ORIGINS)) {
    allowed.add(fromEnv);
  }

  const port = Number.isInteger(config.port) && config.port > 0 ? config.port : 3000;

  if (config.isDesktop) {
    // Packaged Electron desktop binds strictly to loopback 127.0.0.1:<serverPort>
    allowed.add(`http://127.0.0.1:${port}`);
    return allowed;
  }

  const appUrlOrigin = normalizeHttpOrigin(env.APP_URL);
  if (appUrlOrigin) {
    allowed.add(appUrlOrigin);
  }

  if (!config.isProduction) {
    // Explicit local development origins (never wildcard)
    allowed.add(`http://127.0.0.1:${port}`);
    allowed.add(`http://localhost:${port}`);
    allowed.add('http://127.0.0.1:3000');
    allowed.add('http://localhost:3000');
    allowed.add('http://127.0.0.1:5173');
    allowed.add('http://localhost:5173');
  }

  return allowed;
}

/**
 * Checks whether an incoming request Origin header is permitted.
 */
export function isAllowedRequestOrigin(
  rawOrigin: string | undefined,
  req: Pick<Request, 'headers' | 'protocol'>,
  config: HttpSecurityConfig,
  allowedOrigins: Set<string>
): { allowed: boolean; normalizedOrigin: string | null } {
  const normalizedOrigin = normalizeHttpOrigin(rawOrigin);
  if (!normalizedOrigin) {
    return { allowed: false, normalizedOrigin: null };
  }

  if (allowedOrigins.has(normalizedOrigin)) {
    return { allowed: true, normalizedOrigin };
  }

  // In non-desktop web deployments (e.g., reverse proxy / Cloud Run / AI Studio preview),
  // allow exact same-host origin matching the Host header without ever enabling wildcard `*`.
  if (!config.isDesktop) {
    const rawHost =
      (typeof req.headers['x-forwarded-host'] === 'string'
        ? req.headers['x-forwarded-host'].split(',')[0].trim()
        : undefined) ||
      (typeof req.headers.host === 'string' ? req.headers.host.trim() : undefined);

    if (rawHost) {
      const rawProto =
        typeof req.headers['x-forwarded-proto'] === 'string'
          ? req.headers['x-forwarded-proto'].split(',')[0].trim()
          : req.protocol || 'http';
      const proto = rawProto === 'https' ? 'https' : 'http';
      const sameHostOrigin = normalizeHttpOrigin(`${proto}://${rawHost}`);
      if (sameHostOrigin && sameHostOrigin === normalizedOrigin) {
        return { allowed: true, normalizedOrigin };
      }
    }
  }

  return { allowed: false, normalizedOrigin };
}

/**
 * Strict CORS middleware replacing permissive wildcard `cors()`.
 * - Same-origin / non-browser requests without an Origin header pass through without `*`.
 * - Approved origins receive exact origin reflection and clean 204 preflight responses.
 * - Unapproved origins receive 403 JSON without Access-Control-Allow-Origin (including preflight OPTIONS).
 */
export function createStrictCorsMiddleware(
  config: HttpSecurityConfig,
  env: NodeJS.ProcessEnv = process.env
) {
  const allowedOrigins = resolveAllowedCorsOrigins(config, env);

  return function strictCorsMiddleware(req: Request, res: Response, next: NextFunction): void {
    res.vary('Origin');

    const rawOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (!rawOrigin) {
      next();
      return;
    }

    const check = isAllowedRequestOrigin(rawOrigin, req, config, allowedOrigins);
    if (!check.allowed || !check.normalizedOrigin) {
      res.status(403).json({
        error: 'مصدر الطلب غير مصرح به',
        code: 'CORS_ORIGIN_DENIED',
      });
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', check.normalizedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Idempotency-Key');
    res.setHeader('Access-Control-Max-Age', '600');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}

/**
 * Builds a strict Content-Security-Policy header aligned with GOLDEN PALACE POS assets:
 * - Zero `unsafe-eval`, zero wildcards (`*`).
 * - Production / Desktop strictly enforces `script-src 'self'` and `frame-ancestors 'none'`.
 * - Inline styles are allowed for React styles & dynamic thermal `@page` receipt width rules.
 * - Google Fonts origins are allowlisted for Cairo/Tajawal typography (graceful offline fallback).
 */
export function buildContentSecurityPolicy(config: HttpSecurityConfig): string {
  const port = Number.isInteger(config.port) && config.port > 0 ? config.port : 3000;
  const scriptSrc =
    config.isDesktop || config.isProduction ? "'self'" : "'self' 'unsafe-inline'";
  const connectSources = [`'self'`, `http://127.0.0.1:${port}`];
  if (!config.isDesktop && !config.isProduction) {
    connectSources.push(`http://localhost:${port}`);
  }

  const frameAncestors =
    config.isDesktop || (config.isProduction && !config.allowIframePreview)
      ? "'none'"
      : "'self' https://aistudio.google.com https://*.google.com";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src ${connectSources.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');
}

/**
 * Express middleware emitting hardened HTTP security headers and CSP on every response.
 */
export function createSecurityHeadersMiddleware(config: HttpSecurityConfig) {
  const cspHeader = buildContentSecurityPolicy(config);
  const denyFraming = config.isDesktop || (config.isProduction && !config.allowIframePreview);

  return function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Content-Security-Policy', cspHeader);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), display-capture=(), interest-cohort=()'
    );
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (denyFraming) {
      res.setHeader('X-Frame-Options', 'DENY');
    }
    next();
  };
}
