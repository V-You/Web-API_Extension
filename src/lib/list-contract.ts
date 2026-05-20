/**
 * Universal list contract for the workflow SDK surface.
 *
 * Every `sdk.*.list*` / `sdk.*.search` / `sdk.entities.listChildren` method
 * must return a plain `Record<string, unknown>[]`. This helper unwraps the
 * tool-handler envelope `{ ok, status, data }`, raw arrays, and common
 * plural-keyed payloads, then returns an array - or throws a clear,
 * actionable error.
 *
 * This module is the single source of truth used by both the sandbox facade
 * (src/sandbox/sdk-facade.ts) and the service-worker job executor
 * (background/sw-job-executor.ts). Do not duplicate this logic; if a new
 * list-returning method is added to either SDK, route it through here so
 * model-generated scripts can rely on a single, consistent contract.
 *
 * Background: PRD md/2026-05-18_PRD_contract-first-workflow-sdk.md.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function describeFailure(result: Record<string, unknown>): string {
  const outcome = isRecord(result.apiOutcome) ? result.apiOutcome : null;
  const data = isRecord(result.data) ? result.data : null;
  const dataError = isRecord(data?.error) ? data.error : null;
  const messages = [
    stringValue(outcome?.errorCode),
    stringValue(outcome?.errorMessage),
    stringValue(dataError?.code),
    stringValue(dataError?.message),
    stringValue(data?.error),
  ].filter(Boolean);
  if (messages.length > 0) return messages.join(" - ");
  return typeof result.status === "number" ? `HTTP ${result.status}` : "unknown error";
}

export interface NormalizeListOptions {
  /** Human-readable label injected into thrown error messages. */
  label: string;
  /** Plural keys to try when the payload is an object wrapper. */
  candidateKeys?: string[];
}

/**
 * Normalize any list-shaped result into a `Record<string, unknown>[]`.
 *
 * Behaviour:
 *  - `{ ok: false, ... }` envelope -> throws `<label> failed: ...`.
 *  - `{ error: "..." }` shape       -> throws `<label> failed: ...`.
 *  - `{ ok: true, data: X }`        -> recurses into `X`.
 *  - raw array                      -> returns array of records.
 *  - object with one array prop     -> returns that array (last-resort).
 *  - object with `candidateKeys[i]` array -> returns that array.
 *  - anything else                  -> returns `[]`.
 */
export function normalizeListResult(
  result: unknown,
  options: NormalizeListOptions,
): Record<string, unknown>[] {
  const { label, candidateKeys = [] } = options;

  if (isRecord(result)) {
    if (result.ok === false) throw new Error(`${label} failed: ${describeFailure(result)}`);
    if (typeof result.error === "string" && result.error.trim()) {
      throw new Error(`${label} failed: ${result.error.trim()}`);
    }
  }

  const payload = isRecord(result) && "data" in result ? result.data : result;

  if (Array.isArray(payload)) return payload.filter(isRecord);

  if (isRecord(payload)) {
    for (const key of candidateKeys) {
      const value = payload[key];
      if (Array.isArray(value)) return value.filter(isRecord);
    }
    const arrayValues = Object.values(payload).filter(Array.isArray) as unknown[][];
    if (arrayValues.length === 1) return arrayValues[0].filter(isRecord);
  }

  return [];
}

/** Common candidate-key sets shared by both SDK facades. */
export const LIST_KEYS = {
  contactsOwned: ["ownedContacts", "contacts"],
  contactsAttached: ["attachedContacts", "contacts"],
  merchantAccountsOwned: ["ownedMerchantAccounts", "merchantAccounts"],
  merchantAccountsAttached: ["attachedMerchantAccounts", "merchantAccounts"],
  clearingInstitutesSearch: ["matches", "clearingInstitutes"],
  clearingInstitutesLive: ["clearingInstitutes", "matches"],
  cardProcessors: ["matches", "cardProcessors", "clearingInstitutes"],
} as const;

export function contactScopeKeys(scope?: "owned" | "attached"): string[] {
  return scope === "attached" ? [...LIST_KEYS.contactsAttached] : [...LIST_KEYS.contactsOwned];
}

export function merchantAccountScopeKeys(scope?: "owned" | "attached"): string[] {
  return scope === "attached"
    ? [...LIST_KEYS.merchantAccountsAttached]
    : [...LIST_KEYS.merchantAccountsOwned];
}
