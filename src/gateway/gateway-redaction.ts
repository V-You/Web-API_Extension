/**
 * Per-tool allowlist + value-pattern denylist for gateway egress.
 *
 * Default policy: deny by default. A tool's params are only emitted if its
 * name is listed in TOOL_PARAM_ALLOWLIST below; only fields explicitly listed
 * survive the redaction. All survivor strings are additionally passed through
 * a PAN/CVV/JWT value-pattern denylist on top of redactSecrets().
 *
 * Card-data tools (send_test_transaction, transaction-token writes) are
 * intentionally absent from the allowlist so cardholder data can never reach
 * the gateway, even if the surface adds new fields later.
 */

import { redactSecrets } from "../lib/redact";

const REDACTED_VALUE = "[redacted]";
const OVERSIZED_LIMIT_BYTES = 40 * 1024;

/**
 * Allowed top-level param keys per tool. Use "*" sparingly. Card-data tools
 * are deliberately omitted - their params are stripped entirely.
 */
const TOOL_PARAM_ALLOWLIST: Record<string, ReadonlyArray<string>> = {
  // Read tools - identifiers, filters, and pagination only.
  list_psps: ["env"],
  list_merchants: ["env", "pspId", "includeDisabled"],
  list_channels: ["env", "merchantId", "includeDisabled"],
  list_riro_settings: ["env", "entityId", "entityType"],
  get_entity: ["env", "entityId", "entityType"],
  get_setting: ["env", "entityId", "entityType", "key"],
  get_channel_clearing_institute: ["env", "channelId"],
  describe_setting: ["env", "key"],
  search_settings: ["env", "query"],
  list_clearing_institutes: ["env"],
  // Write tools - emit only the structural shape; values still pass the
  // value-pattern denylist before egress.
  edit_entity: ["env", "entityId", "entityType", "displayName", "name", "status"],
  set_setting: ["env", "entityId", "entityType", "key", "value"],
  set_settings_batch: ["env", "entityId", "entityType", "settings"],
  create_entity: ["env", "parentId", "parentType", "entityType", "displayName", "name"],
  delete_entity: ["env", "entityId", "entityType"],
  set_channel_clearing_institute: [
    "env",
    "channelId",
    "clearingInstituteId",
    "fields",
  ],
  // Workflow / code-mode - script metadata only, not the source.
  execute_workflow: ["env", "scriptHash", "runtime", "totalCalls", "preflightStatus", "label"],
  start_workflow_job: ["env", "scriptHash", "runtime", "totalCalls", "preflightStatus", "label"],
  // Confirmation flow uses the same allowlist as the underlying write tool.
};

/** Tools whose params must NEVER reach the gateway even when called. */
const TOOL_PARAM_BLOCKLIST: ReadonlySet<string> = new Set([
  "send_test_transaction",
  "save_transaction_token",
  "delete_transaction_token",
  "list_transaction_tokens",
]);

/**
 * Returns the egress-safe param projection for a tool. Returns undefined when
 * the tool is on the blocklist or has no allowlist entry. Returns an oversized
 * marker when the projection exceeds OVERSIZED_LIMIT_BYTES.
 */
export function redactToolParams(
  toolName: string,
  params: unknown,
): Record<string, unknown> | undefined {
  if (TOOL_PARAM_BLOCKLIST.has(toolName)) return undefined;
  const allow = TOOL_PARAM_ALLOWLIST[toolName];
  if (!allow) return undefined;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {};
  }

  const source = params as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const key of allow) {
    if (key === "*") {
      for (const [k, v] of Object.entries(source)) projected[k] = v;
      break;
    }
    if (key in source) projected[key] = source[key];
  }

  const sanitized = redactSecrets(projected) as Record<string, unknown>;
  const scrubbed = scrubValues(sanitized) as Record<string, unknown>;

  const json = safeJsonStringify(scrubbed);
  if (json && byteLength(json) > OVERSIZED_LIMIT_BYTES) {
    return { _redacted: "oversized", sizeBytes: byteLength(json) };
  }
  return scrubbed;
}

/**
 * Sanitize a dashboard URL to `origin + pathname` only. Query and fragment
 * are dropped.
 */
export function sanitizeDashboardUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
}

// --- Value-pattern denylist ---------------------------------------------------

const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const DIGITS_RUN_REGEX = /\d{12,19}/g;

function scrubValues(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValues(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isCardishKey(k) ? REDACTED_VALUE : scrubValues(v);
    }
    return out;
  }
  return value;
}

function scrubString(value: string): string {
  let v = value.replace(JWT_REGEX, REDACTED_VALUE);
  v = v.replace(DIGITS_RUN_REGEX, (m) => (isLuhnValid(m) ? REDACTED_VALUE : m));
  return v;
}

function isCardishKey(key: string): boolean {
  const k = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    k === "pan" ||
    k === "cardnumber" ||
    k === "cardno" ||
    k === "ccnumber" ||
    k === "cvv" ||
    k === "cvc" ||
    k === "cvv2" ||
    k === "securitycode" ||
    k === "expirymonth" ||
    k === "expiryyear" ||
    k === "expiry" ||
    k === "holdername" ||
    k === "cardholder"
  );
}

function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum > 0 && sum % 10 === 0;
}

function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function byteLength(s: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
  return s.length;
}
