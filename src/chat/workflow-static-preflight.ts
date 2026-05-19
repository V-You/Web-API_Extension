/**
 * Static preflight for workflow draft scripts (PRD 2026-05-18 Phase 0, D12).
 *
 * KISS scan that runs in the chat draft loop *before* the review card is shown.
 * It catches the high-frequency forbidden-field patterns the model invents on
 * `sdk.merchantAccounts.create(...)` (paymentBrand, paymentBrands, brands,
 * config) by looking at the literal text of the create call's argument block.
 *
 * This is a Phase 0 substitute for full contract preflight. Phase 3 will replace
 * it by running the sandbox SDK with planOnlyWrites=true so the same deny list
 * fires from one place. Until then, this scan exists so a first-draft script
 * with `paymentBrand` does not have to wait for the Job to start before failing.
 *
 * Conservative by design: only flags hits where the forbidden token appears as
 * a property key (followed by `:` or `=`) inside the argument span of a
 * recognised MA create call. False positives are worse than missed catches at
 * this stage, because each false positive triggers a redraft.
 */

import forbiddenFieldsData from "../../src_data/forbidden-fields.json";

type ForbiddenRule = { reason: string; canonical?: string };
type ForbiddenByOp = Record<string, Record<string, ForbiddenRule>>;

const FORBIDDEN_BY_OP: ForbiddenByOp = (forbiddenFieldsData as { operations: ForbiddenByOp }).operations;

// SDK call patterns that map to operation manifest tool names.
// Each entry pairs a textual call prefix with the manifest tool name whose
// deny list applies inside that call's argument span.
const CALL_PATTERNS: Array<{ prefix: string; tool: string }> = [
  { prefix: "sdk.merchantAccounts.create", tool: "create_merchant_account" },
];

export interface StaticPreflightHit {
  tool: string;
  field: string;
  reason: string;
  canonical?: string;
  callPrefix: string;
}

export interface StaticPreflightResult {
  ok: boolean;
  hits: StaticPreflightHit[];
  /** Short human/model-readable message summarizing hits. */
  message?: string;
}

/**
 * Return the substring inside the parentheses of the first call to `prefix`,
 * accounting for nested parens, square brackets, braces, and string literals.
 * Returns null if no matching call is found or parens are unbalanced.
 */
function findCallArgSpan(script: string, prefix: string, startAt: number): { argText: string; endIdx: number } | null {
  const callIdx = script.indexOf(prefix, startAt);
  if (callIdx < 0) return null;
  const openIdx = script.indexOf("(", callIdx + prefix.length);
  if (openIdx < 0) return null;

  let depth = 1;
  let i = openIdx + 1;
  let stringChar: string | null = null;
  while (i < script.length) {
    const ch = script[i];
    if (stringChar) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === stringChar) stringChar = null;
      i += 1;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") { stringChar = ch; i += 1; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0 && ch === ")") {
        return { argText: script.slice(openIdx + 1, i), endIdx: i + 1 };
      }
    }
    i += 1;
  }
  return null;
}

/**
 * Detect forbidden property keys inside the argument span. A property key is
 * recognised by `field:` or `field =` patterns. Matches must not be preceded
 * by an identifier character (avoids matching `paymentBrandHint:` for `paymentBrand`).
 */
function findForbiddenKeysInArgs(argText: string, rules: Record<string, ForbiddenRule>): Array<{ field: string; rule: ForbiddenRule }> {
  const hits: Array<{ field: string; rule: ForbiddenRule }> = [];
  for (const [field, rule] of Object.entries(rules)) {
    const re = new RegExp(`(^|[^A-Za-z0-9_$])${field}\\s*[:=]`);
    if (re.test(argText)) hits.push({ field, rule });
  }
  return hits;
}

export function staticWorkflowPreflight(script: string): StaticPreflightResult {
  const hits: StaticPreflightHit[] = [];
  for (const pattern of CALL_PATTERNS) {
    const rules = FORBIDDEN_BY_OP[pattern.tool];
    if (!rules) continue;
    let cursor = 0;
    while (cursor < script.length) {
      const found = findCallArgSpan(script, pattern.prefix, cursor);
      if (!found) break;
      for (const hit of findForbiddenKeysInArgs(found.argText, rules)) {
        hits.push({
          tool: pattern.tool,
          field: hit.field,
          reason: hit.rule.reason,
          canonical: hit.rule.canonical,
          callPrefix: pattern.prefix,
        });
      }
      cursor = found.endIdx;
    }
  }

  if (hits.length === 0) return { ok: true, hits: [] };

  const lines = hits.map((h) => {
    const canonical = h.canonical ? ` Use ${h.canonical} instead.` : "";
    return `- ${h.callPrefix}(...): forbidden field "${h.field}". ${h.reason}${canonical}`;
  });
  return {
    ok: false,
    hits,
    message: `Workflow preflight found forbidden fields:\n${lines.join("\n")}`,
  };
}
