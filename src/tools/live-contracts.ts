/**
 * Live-contract overlay (PRD 2026-05-18 Phase 1, D1).
 *
 * Encodes requirements that the OpenAPI / generated operation manifest does
 * not express accurately enough for the real API. The overlay is the single
 * place where "the API really needs this field even though the spec marks it
 * optional" lives. Both consumption paths import from here so the chat tab
 * and reviewed Jobs reject the same shapes with the same message.
 *
 * Scope (Phase 1): create_merchant_account + attach_merchant_account. Other
 * tools (settings updates, send_test_transaction, CI lookup, API token
 * lifecycle) are described in PRD 6.1 but enforced elsewhere today; future
 * phases will migrate them into this overlay as they become structurally
 * checkable.
 *
 * Co-located with the forbidden-fields data file (`src_data/forbidden-fields.json`)
 * which handles the inverse direction: fields that must NOT appear. The two
 * helpers compose: `assertNoForbiddenFields` first, then `assertLiveContract`.
 */

export interface LiveContractRequiredOneOf {
  /** At least one of these field names must be present and non-empty. */
  fields: string[];
  /** Human-readable reason surfaced in the error message. */
  reason: string;
}

export interface LiveContractIdentifierFormat {
  field: string;
  pattern: RegExp;
  /** Short description of the expected format, e.g. "32-character API UUID". */
  description: string;
}

export interface LiveContractEntry {
  /** Manifest tool name (e.g. create_merchant_account). */
  tool: string;
  /** Fields that must always be present and non-empty for a successful live call. */
  requiredFields: string[];
  /** Optional "any-of" groups. Each group requires at least one field present. */
  requiredOneOf?: LiveContractRequiredOneOf[];
  /**
   * Identifier format constraints. Surfaced for Phase 3 preflight via
   * `validateIdentifierFormats`; not enforced as a hard error here because
   * existing code (`normalizeClearingInstituteIdentifier`) auto-recovers some
   * format mismatches at the boundary.
   */
  identifierFormats?: LiveContractIdentifierFormat[];
  /** Suffix appended to the error message to help the model redraft. */
  errorHint: string;
}

const CREATE_MERCHANT_ACCOUNT: LiveContractEntry = {
  tool: "create_merchant_account",
  requiredFields: ["name", "state", "merchantId"],
  requiredOneOf: [
    {
      fields: ["clearingInstituteId", "clearingInstituteName"],
      reason: "create requires a Clearing Institute selector",
    },
  ],
  identifierFormats: [
    {
      field: "clearingInstituteId",
      pattern: /^[a-f0-9]{32}$/i,
      description: "32-character API UUID",
    },
  ],
  errorHint:
    'Use sdk.merchantAccounts.create(parentType, parentId, { name, state: "LIVE", merchantId, clearingInstituteId or clearingInstituteName }).',
};

const ATTACH_MERCHANT_ACCOUNT: LiveContractEntry = {
  tool: "attach_merchant_account",
  requiredFields: ["merchantAccountId", "subTypes", "currency"],
  errorHint:
    'Use sdk.merchantAccounts.attach(entityType, entityId, merchantAccountId, "VISA", "EUR") or attach once per currency.',
};

export const LIVE_CONTRACTS: Record<string, LiveContractEntry> = {
  [CREATE_MERCHANT_ACCOUNT.tool]: CREATE_MERCHANT_ACCOUNT,
  [ATTACH_MERCHANT_ACCOUNT.tool]: ATTACH_MERCHANT_ACCOUNT,
};

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Throw a structured error if the supplied fields do not satisfy the live
 * contract for the given tool. No-op for tools without an overlay entry.
 *
 * Error message format (kept stable for prompt feedback):
 *   "<tool> is missing required field(s): <fields>. <errorHint>"
 *
 * For create_merchant_account this preserves the legacy wording so existing
 * model prompts and evaluators continue to match. For attach_merchant_account
 * the message normalizes onto the same "<tool> is missing required field(s)"
 * shape used by the rest of the overlay.
 */
export function assertLiveContract(tool: string, fields: Record<string, unknown>): void {
  const entry = LIVE_CONTRACTS[tool];
  if (!entry) return;

  const missing: string[] = entry.requiredFields.filter((field) => !isPresent(fields[field]));

  if (entry.requiredOneOf) {
    for (const group of entry.requiredOneOf) {
      const anyPresent = group.fields.some((field) => isPresent(fields[field]));
      if (!anyPresent) missing.push(group.fields.join(" or "));
    }
  }

  if (missing.length === 0) return;

  throw new Error(`${tool} is missing required field(s): ${missing.join(", ")}. ${entry.errorHint}`);
}

export interface IdentifierFormatHit {
  field: string;
  value: string;
  description: string;
}

/**
 * Return identifier format mismatches without throwing. Used by Phase 3
 * preflight; not invoked at write time because the SDK boundary already
 * normalizes some of these cases (e.g. invalid clearingInstituteId is
 * silently demoted to clearingInstituteName).
 */
export function validateIdentifierFormats(tool: string, fields: Record<string, unknown>): IdentifierFormatHit[] {
  const entry = LIVE_CONTRACTS[tool];
  if (!entry?.identifierFormats) return [];
  const hits: IdentifierFormatHit[] = [];
  for (const rule of entry.identifierFormats) {
    const raw = fields[rule.field];
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value) continue;
    if (!rule.pattern.test(value)) hits.push({ field: rule.field, value, description: rule.description });
  }
  return hits;
}
