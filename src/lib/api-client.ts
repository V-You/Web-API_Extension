/**
 * ACI Web API HTTP client.
 *
 * Authentication: custom `credentials` header with raw `username:password`
 * (NOT base64, NOT standard Basic Auth).
 *
 * Content types:
 *   - GET / DELETE: no body
 *   - POST: application/x-www-form-urlencoded
 *
 * The API does NOT use PUT -- all updates are POST.
 */

import { RateLimiter } from "./rate-limiter";
import { redactSecrets } from "./redact";
import type { ApiCredentials, ApiOutcome, AuditEntry, AuditEventType, Environment } from "./types";

const DEFAULT_RATE_LIMIT = 9;
const defaultLimiter = new RateLimiter(DEFAULT_RATE_LIMIT);
const limiters = new Map<number, RateLimiter>();

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const MAX_AUDIT_ENTRIES = 200;
const MAX_AUDIT_BYTES = 200_000;

/** Check if a status code is retryable (server error or rate limit). */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  apiOutcome?: ApiOutcome;
}

export interface RequestOptions {
  /** HTTP method (default: GET). */
  method?: "GET" | "POST" | "DELETE";
  /** Path relative to the base URL, e.g. `/merchants/{id}`. */
  path: string;
  /** Form fields for POST requests (url-encoded). */
  params?: Record<string, string>;
  /** Optional abort signal for jobs and cancellable workflows. */
  signal?: AbortSignal;
  /** Optional request throttle rate in requests per second. */
  throttleRate?: number;
}

function limiterFor(rate: number | undefined): RateLimiter {
  if (!rate || rate === DEFAULT_RATE_LIMIT) return defaultLimiter;
  const normalized = Math.max(1, Math.floor(rate));
  const existing = limiters.get(normalized);
  if (existing) return existing;
  const next = new RateLimiter(normalized);
  limiters.set(normalized, next);
  return next;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

/**
 * Fetch with exponential backoff retry for transient failures.
 * Retries on network errors and 5xx/429 responses.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  limiter = defaultLimiter,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!isRetryableStatus(res.status) || attempt === MAX_RETRIES) {
        return res;
      }
      // Retryable status -- wait and try again
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES) break;
      // Network error -- wait and try again
    }
    const delay = RETRY_BASE_MS * Math.pow(2, attempt);
    await abortableDelay(delay, signal);
    await limiter.acquire(signal); // re-acquire rate limit token
  }
  throw lastError ?? new Error(`Request failed after ${MAX_RETRIES + 1} attempts`);
}

/**
 * Execute an API request against the given credentials.
 * Automatically rate-limited and audit-logged.
 */
export async function apiRequest<T = unknown>(
  creds: ApiCredentials,
  env: Environment,
  opts: RequestOptions,
  auditMeta?: { eventType: AuditEventType; entityId: string; entityType: string }
): Promise<ApiResponse<T>> {
  const limiter = limiterFor(opts.throttleRate);
  await limiter.acquire(opts.signal);

  const url = `${creds.baseUrl}${opts.path}`;
  const method = opts.method ?? "GET";

  const headers: Record<string, string> = {
    credentials: `${creds.username}:${creds.password}`,
  };

  let body: string | undefined;
  if (method === "POST" && opts.params) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.params).toString();
  }

  const res = await fetchWithRetry(url, { method, headers, body, signal: opts.signal }, opts.signal, limiter);

  let data: T;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = (await res.json()) as T;
  } else {
    data = (await res.text()) as unknown as T;
  }
  const apiOutcome = extractApiOutcome(data, opts.path);

  // Audit log
  if (auditMeta) {
    await appendAuditEntry({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      eventType: auditMeta.eventType,
      entityId: auditMeta.entityId,
      entityType: auditMeta.entityType,
      parameters: redactSecrets({
        _method: method,
        _path: opts.path,
        ...(opts.params ?? {}),
      }),
      responseStatus: res.status,
      ...(apiOutcome ? {
        apiOutcome,
        ...(apiOutcome.resultCode ? { apiResultCode: apiOutcome.resultCode } : {}),
        ...(apiOutcome.resultDescription ? { apiResultDescription: apiOutcome.resultDescription } : {}),
        ...(apiOutcome.errorCode ? { apiErrorCode: apiOutcome.errorCode } : {}),
        ...(apiOutcome.errorMessage ? { apiErrorMessage: apiOutcome.errorMessage } : {}),
      } : {}),
      environment: env,
    });
  }

  return { ok: res.ok && apiOutcome?.isError !== true, status: res.status, data, ...(apiOutcome ? { apiOutcome } : {}) };
}

export function extractApiOutcome(data: unknown, path = ""): ApiOutcome | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const source = data as Record<string, unknown>;
  const result = source.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const resultObject = result as Record<string, unknown>;
    const code = stringValue(resultObject.code);
    if (code) {
      return {
        resultCode: code,
        resultDescription: stringValue(resultObject.description) ?? stringValue(resultObject.message),
        isError: !isSuccessfulTransactionResult(code, path),
      };
    }
  }

  const error = source.error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const errorObject = error as Record<string, unknown>;
    const errorCode = stringValue(errorObject.code);
    const errorMessage = stringValue(errorObject.message) ?? stringValue(errorObject.description);
    if (errorCode || errorMessage) {
      return { errorCode, errorMessage, isError: true };
    }
  }

  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isSuccessfulTransactionResult(code: string, path: string): boolean {
  if (!path.includes("/payments") && !/^\d{3}\.\d{3}\.\d{3}$/.test(code)) return true;
  return code.startsWith("000.");
}

/** Append an entry to the local audit log. Trims on write to protect local storage. */
export async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  const result = await chrome.storage.local.get("audit");
  const log = (result.audit ?? []) as AuditEntry[];
  log.push(entry);
  const trimmed = trimAuditLog(log);
  await chrome.storage.local.set({ audit: trimmed });
}

function trimAuditLog(log: AuditEntry[]): AuditEntry[] {
  const trimmed = log.length > MAX_AUDIT_ENTRIES ? log.slice(log.length - MAX_AUDIT_ENTRIES) : [...log];
  while (trimmed.length > 1 && JSON.stringify(trimmed).length > MAX_AUDIT_BYTES) {
    trimmed.shift();
  }
  return trimmed;
}
