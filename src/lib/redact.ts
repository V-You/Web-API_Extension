const REDACTED = "[redacted]";

const SENSITIVE_EXACT_KEYS = new Set([
  "accesstoken",
  "apibearertoken",
  "authorization",
  "bearer",
  "credentials",
  "password",
  "pwd",
  "secret",
  "token",
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (SENSITIVE_EXACT_KEYS.has(normalized)) return true;
  if (normalized.endsWith("token") && normalized !== "apitoken") return true;
  return false;
}

function redactString(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9+/=._:-]+/gi, "Bearer [redacted]");
}

export function redactSecrets<T>(value: T): T {
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item)) as T;
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactSecrets(child);
  }
  return out as T;
}

export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return REDACTED;
  return `${"*".repeat(8)}${trimmed.slice(-4)}`;
}