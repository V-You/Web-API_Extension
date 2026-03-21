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

  const res = await fetch(url, { method, headers, body });

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
