/**
 * Forbidden-fields deny list (PRD 2026-05-18 Phase 0, D1 + D11).
 *
 * Data-driven blocker for fields the model repeatedly invents on write operations
 * (e.g. paymentBrand on create_merchant_account). The intent is to fail fast at the
 * SDK boundary with a structured, model-actionable message, rather than letting the
 * call hit the API with a silently-ignored or wrong field.
 *
 * Keyed by manifest tool name (create_merchant_account, attach_merchant_account, ...).
 *
 * Imported by both the sandbox SDK facade (src/sandbox/sdk-facade.ts) and the
 * service-worker SDK (background/sw-job-executor.ts), so both consumption paths
 * (Chat tab + reviewed Jobs) reject the same invented fields identically.
 */

import forbiddenFieldsData from "../../src_data/forbidden-fields.json";

type ForbiddenFieldRule = { reason: string; canonical?: string };
type ForbiddenFieldsByOperation = Record<string, Record<string, ForbiddenFieldRule>>;

const FORBIDDEN_BY_OP: ForbiddenFieldsByOperation = (forbiddenFieldsData as { operations: ForbiddenFieldsByOperation }).operations;

export interface ForbiddenFieldHit {
  field: string;
  reason: string;
  canonical?: string;
}

/**
 * Return the forbidden-field hits found in `fields` for the given tool. Empty
 * array means no forbidden fields are present.
 */
export function findForbiddenFields(toolName: string, fields: Record<string, unknown>): ForbiddenFieldHit[] {
  const rules = FORBIDDEN_BY_OP[toolName];
  if (!rules) return [];
  const hits: ForbiddenFieldHit[] = [];
  for (const [field, rule] of Object.entries(rules)) {
    if (Object.prototype.hasOwnProperty.call(fields, field)) {
      hits.push({ field, reason: rule.reason, canonical: rule.canonical });
    }
  }
  return hits;
}

/**
 * Throw a structured error if `fields` contains any forbidden field for the
 * given tool. Safe to call before manifest validation - the deny list is a
 * smaller, more targeted check that produces a better message for the model.
 */
export function assertNoForbiddenFields(toolName: string, fields: Record<string, unknown>): void {
  const hits = findForbiddenFields(toolName, fields);
  if (hits.length === 0) return;
  const details = hits
    .map((hit) => {
      const canonical = hit.canonical ? ` Use ${hit.canonical} instead.` : "";
      return `${hit.field}: ${hit.reason}${canonical}`;
    })
    .join(" ");
  throw new Error(`${toolName} received forbidden field(s): ${details}`);
}
