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
import type { ApiCredentials, AuditEntry, AuditEventType, Environment } from "./types";

const limiter = new RateLimiter(9);

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

/** Check if a status code is retryable (server error or rate limit). */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export interface RequestOptions {
  /** HTTP method (default: GET). */
  method?: "GET" | "POST" | "DELETE";
  /** Path relative to the base URL, e.g. `/merchants/{id}`. */
  path: string;
  /** Form fields for POST requests (url-encoded). */
  params?: Record<string, string>;
}

/**
 * Fetch with exponential backoff retry for transient failures.
 * Retries on network errors and 5xx/429 responses.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
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
    await new Promise((r) => setTimeout(r, delay));
    await limiter.acquire(); // re-acquire rate limit token
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
  await limiter.acquire();

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

  const res = await fetchWithRetry(url, { method, headers, body });

  let data: T;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = (await res.json()) as T;
  } else {
    data = (await res.text()) as unknown as T;
  }

  // Audit log
  if (auditMeta) {
    await appendAuditEntry({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      eventType: auditMeta.eventType,
      entityId: auditMeta.entityId,
      entityType: auditMeta.entityType,
      parameters: opts.params ?? {},
      responseStatus: res.status,
      environment: env,
    });
  }

  return { ok: res.ok, status: res.status, data };
}

/** Append an entry to the local audit log (capped at 500 entries). */
async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  const result = await chrome.storage.local.get("audit");
  const log = (result.audit ?? []) as AuditEntry[];
  log.push(entry);
  // Keep only the last 500 entries
  const trimmed = log.length > 500 ? log.slice(log.length - 500) : log;
  await chrome.storage.local.set({ audit: trimmed });
}
