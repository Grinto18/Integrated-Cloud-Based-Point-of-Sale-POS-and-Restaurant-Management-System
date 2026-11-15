import { Request } from 'express';

interface BucketEntry {
  failures: number[];
  requests: number[];
  blockedUntil: number;
}

const buckets = new Map<string, BucketEntry>();

export interface RateLimitConfig {
  scope: 'LOGIN' | 'PIN_LOGIN';
  windowMs: number;
  maxFailures: number;
  blockDurationMs: number;
  burstWindowMs?: number;
  maxRequestsInBurst?: number;
}

export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  scope: 'LOGIN',
  windowMs: 15 * 60 * 1000,
  maxFailures: 5,
  blockDurationMs: 15 * 60 * 1000,
  burstWindowMs: 60 * 1000,
  maxRequestsInBurst: 30,
};

export const PIN_RATE_LIMIT: RateLimitConfig = {
  scope: 'PIN_LOGIN',
  windowMs: 15 * 60 * 1000,
  maxFailures: 5,
  blockDurationMs: 15 * 60 * 1000,
  burstWindowMs: 60 * 1000,
  maxRequestsInBurst: 40,
};

export function extractClientIp(req: Request): string {
  const raw = req.ip || req.socket?.remoteAddress || 'unknown';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

export function buildRateLimitKeys(
  scope: RateLimitConfig['scope'],
  req: Request,
  identifier?: string
): string[] {
  const ip = extractClientIp(req);
  if (scope === 'LOGIN' && identifier && identifier.trim()) {
    const normalized = identifier.trim().toLowerCase();
    return [`${scope}:ip:${ip}:id:${normalized}`, `${scope}:ip:${ip}`];
  }
  return [`${scope}:ip:${ip}`];
}

function getOrCreateBucket(key: string): BucketEntry {
  let entry = buckets.get(key);
  if (!entry) {
    entry = { failures: [], requests: [], blockedUntil: 0 };
    buckets.set(key, entry);
  }
  return entry;
}

function pruneBucket(entry: BucketEntry, config: RateLimitConfig, now: number) {
  entry.failures = entry.failures.filter((ts) => now - ts < config.windowMs);
  const burstWin = config.burstWindowMs || 60 * 1000;
  entry.requests = entry.requests.filter((ts) => now - ts < burstWin);
  if (entry.blockedUntil > 0 && entry.blockedUntil <= now) {
    entry.blockedUntil = 0;
  }
}

export function checkRateLimit(
  keys: string[],
  config: RateLimitConfig
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const maxBurst = config.maxRequestsInBurst || 40;
  const isCompositeKey = (idx: number) => keys.length > 1 && idx === 1;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const entry = getOrCreateBucket(key);
    pruneBucket(entry, config, now);

    if (entry.blockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)),
      };
    }

    // Aggregate IP key for LOGIN gets a higher failure ceiling (2x) so different usernames from a shared office NAT don't immediately lock each other out
    const failureThreshold = isCompositeKey(i) ? config.maxFailures * 2 : config.maxFailures;
    if (entry.failures.length >= failureThreshold) {
      entry.blockedUntil = now + config.blockDurationMs;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(config.blockDurationMs / 1000)),
      };
    }

    if (entry.requests.length >= maxBurst) {
      const oldest = entry.requests[0] || now;
      const burstWin = config.burstWindowMs || 60 * 1000;
      const retryMs = Math.max(1000, burstWin - (now - oldest));
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryMs / 1000),
      };
    }
  }

  // Record request timestamp in burst window
  for (const key of keys) {
    const entry = getOrCreateBucket(key);
    entry.requests.push(now);
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordRateLimitFailure(keys: string[], config: RateLimitConfig): void {
  const now = Date.now();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const entry = getOrCreateBucket(key);
    pruneBucket(entry, config, now);
    entry.failures.push(now);
    const failureThreshold = keys.length > 1 && i === 1 ? config.maxFailures * 2 : config.maxFailures;
    if (entry.failures.length >= failureThreshold) {
      entry.blockedUntil = now + config.blockDurationMs;
    }
  }
}

export function resetRateLimitFailures(keys: string[]): void {
  for (const key of keys) {
    const entry = buckets.get(key);
    if (entry) {
      entry.failures = [];
      entry.blockedUntil = 0;
    }
  }
}

export function clearRateLimitsForTest(): void {
  buckets.clear();
}
