const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SENSITIVE_KV_PATTERN = /\b(password|passwordHash|pin|secret|token|jwt|authorization)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;

export function redactSensitiveText(input: string): string {
  if (!input) return input;
  return input
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(SENSITIVE_KV_PATTERN, '$1=[REDACTED]');
}

export function sanitizeErrorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : 'Unexpected error';
  return redactSensitiveText(raw);
}
