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
import { WORKFLOW_SDK_REFERENCE_METHODS } from "../../src_data/workflow-sdk-reference";
import { suggestClosest } from "../sandbox/sdk-guard";

type ForbiddenRule = { reason: string; canonical?: string };
type ForbiddenByOp = Record<string, Record<string, ForbiddenRule>>;

const FORBIDDEN_BY_OP: ForbiddenByOp = (forbiddenFieldsData as { operations: ForbiddenByOp }).operations;

const EXTRA_RUNTIME_METHODS = [
  // The generated markdown reference currently lists async methods parsed from
  // the facade. The Virtual Settings read helpers are bound methods and are
  // still valid runtime SDK members, so include them until the generator is
  // registry-driven (PRD 2026-05-20 Step 2).
  "config.get",
  "config.batchGet",
  "config.describe",
  "config.validate",
  "config.coverage",
  "settings.get",
  "settings.batchGet",
  "settings.describe",
  "settings.validate",
  "settings.coverage",
  "describeSettings",
] as const;

const SDK_METHODS = new Set<string>([
  ...WORKFLOW_SDK_REFERENCE_METHODS,
  ...EXTRA_RUNTIME_METHODS,
]);

const SDK_NAMESPACES = new Map<string, string[]>();
for (const path of SDK_METHODS) {
  const [namespace, method] = path.split(".");
  if (!namespace || !method) continue;
  const methods = SDK_NAMESPACES.get(namespace) ?? [];
  methods.push(method);
  SDK_NAMESPACES.set(namespace, methods);
}

const TOP_LEVEL_SDK_MEMBERS = new Set([
  ...SDK_NAMESPACES.keys(),
  ...[...SDK_METHODS].filter((path) => !path.includes(".")),
]);

// SDK call patterns that map to operation manifest tool names.
// Each entry pairs a textual call prefix with the manifest tool name whose
// deny list applies inside that call's argument span. PRD 2026-05-18 Phase 3
// expands the prefix list so forbidden fields are caught on every write surface
// the deny list covers, not only MA create.
const CALL_PATTERNS: Array<{ prefix: string; tool: string }> = [
  { prefix: "sdk.merchantAccounts.create", tool: "create_merchant_account" },
  { prefix: "sdk.merchantAccounts.edit", tool: "edit_merchant_account" },
  { prefix: "sdk.merchantAccounts.update", tool: "edit_merchant_account" },
  { prefix: "sdk.entities.create", tool: "create_entity" },
  { prefix: "sdk.entities.edit", tool: "edit_entity" },
  { prefix: "sdk.contacts.create", tool: "create_contact" },
  { prefix: "sdk.contacts.edit", tool: "edit_contact" },
];

// PRD 2026-05-18 Phase 3 contract checks beyond forbidden-fields. Each entry
// runs after forbidden-field scanning and produces a structural blocker for
// the literal-arg case. Dynamic-arg cases are still caught at the SDK
// boundary by the live-contract overlay (assertLiveContract) on first call,
// which runs before any API transport.
const CONTRACT_CHECKS: ReadonlyArray<ContractCheck> = [
  // Exit criterion: missing currency on MA attach is blocked before any write.
  {
    prefix: "sdk.merchantAccounts.attach",
    tool: "attach_merchant_account",
    inspect(argText) {
      // Positional form: attach(entityType, entityId, merchantAccountId, subTypes, currency).
      // We can only inspect the literal positional case; object-form goes through
      // the live-contract overlay at runtime.
      const parts = splitTopLevelArgs(argText);
      if (parts.length >= 5) {
        const currency = parts[4].trim();
        if (currency === '""' || currency === "''" || currency === "``") {
          return [{
            field: "currency",
            reason: "attach_merchant_account requires a non-empty currency. Use sdk.merchantAccounts.attach(entityType, entityId, merchantAccountId, \"VISA\", \"EUR\").",
            canonical: "currency",
          }];
        }
        const subTypes = parts[3].trim();
        if (subTypes === '""' || subTypes === "''" || subTypes === "``" || subTypes === "[]") {
          return [{
            field: "subTypes",
            reason: "attach_merchant_account requires at least one payment brand in subTypes. Use sdk.merchantAccounts.attach(entityType, entityId, merchantAccountId, \"VISA\", \"EUR\") or attach once per brand.",
            canonical: "subTypes",
          }];
        }
      }
      return [];
    },
  },
  // Exit criterion: unresolved CI label is blocked before any MA create. We
  // catch the literal "clearingInstituteId: \"ACCEPTANCE\"" pattern (a CI code
  // or label) where the value is clearly not a 32-char UUID. Dynamic values
  // still pass through resolveMerchantAccountClearingInstitute at runtime.
  {
    prefix: "sdk.merchantAccounts.create",
    tool: "create_merchant_account",
    inspect(argText) {
      const literal = matchStringPropertyLiteral(argText, "clearingInstituteId");
      if (literal === null) return [];
      const trimmed = literal.trim();
      if (trimmed && !/^[a-f0-9]{32}$/i.test(trimmed)) {
        return [{
          field: "clearingInstituteId",
          reason: `clearingInstituteId must be a 32-character API UUID, got ${JSON.stringify(literal)}. Use clearingInstituteName for CI codes or labels, or look up the UUID with sdk.cardProcessors.list().`,
          canonical: "clearingInstituteName",
        }];
      }
      return [];
    },
  },
  // Exit criterion: invalid setting types are coerced or blocked. We flag
  // literal string values on the known typed duplicate-check RiRo keys, which
  // is the highest-frequency settings-type bug the model emits. Other typed
  // keys are validated by the RiRo proxy at write time.
  {
    prefix: "sdk.settings.edit",
    tool: "edit_settings",
    inspect: inspectDoublicationKeys,
  },
  {
    prefix: "sdk.settings.batchEdit",
    tool: "batch_edit_settings",
    inspect: inspectDoublicationKeys,
  },
  {
    prefix: "sdk.config.update",
    tool: "edit_settings",
    inspect: inspectDoublicationKeys,
  },
];

interface ContractCheckHit {
  field: string;
  reason: string;
  canonical?: string;
}

interface ContractCheck {
  prefix: string;
  tool: string;
  inspect: (argText: string) => ContractCheckHit[];
}

/**
 * Split a parenthesised arg span on top-level commas, ignoring commas inside
 * nested brackets, braces, parens, and string literals.
 */
function splitTopLevelArgs(argText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let stringChar: string | null = null;
  let start = 0;
  for (let i = 0; i < argText.length; i += 1) {
    const ch = argText[i];
    if (stringChar) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === stringChar) stringChar = null;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") { stringChar = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(argText.slice(start, i));
      start = i + 1;
    }
  }
  if (start < argText.length) parts.push(argText.slice(start));
  return parts;
}

/**
 * Return the literal string value assigned to `field` inside the arg text, or
 * null when the value is non-literal (variable, expression, missing).
 * Matches `field: "value"`, `'field': "value"`, and `"field": "value"` shapes.
 */
function matchStringPropertyLiteral(argText: string, field: string): string | null {
  // Optional surrounding quote on the key handles `"doublication:timeframe":`,
  // which RiRo settings use because the key contains colons and slashes.
  const re = new RegExp(`(^|[^A-Za-z0-9_$])["'\`]?${field}["'\`]?\\s*:\\s*(['"\`])((?:\\\\.|(?!\\2).)*)\\2`);
  const m = re.exec(argText);
  return m ? m[3] : null;
}

const DOUBLICATION_TYPED_KEYS = [
  "doublication:active",
  "doublication:timeframe",
];

function inspectDoublicationKeys(argText: string): ContractCheckHit[] {
  const hits: ContractCheckHit[] = [];
  for (const key of DOUBLICATION_TYPED_KEYS) {
    const literal = matchStringPropertyLiteral(argText, key.replace(/[^a-z0-9]/gi, "\\$&"));
    if (literal === null) continue;
    const trimmed = literal.trim();
    if (key === "doublication:active" && (trimmed === "true" || trimmed === "false")) {
      hits.push({
        field: key,
        reason: `${key} expects a boolean (true / false), not a string. Use ${trimmed} without quotes.`,
        canonical: key,
      });
    } else if (key === "doublication:timeframe" && /^[0-9]+$/.test(trimmed)) {
      hits.push({
        field: key,
        reason: `${key} expects a number, not a string. Use ${trimmed} without quotes.`,
        canonical: key,
      });
    }
  }
  return hits;
}

export interface StaticPreflightHit {
  kind?: "forbidden_field" | "unknown_sdk_member" | "sdk_reflection";
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

function maskStringsAndComments(script: string): string {
  let out = "";
  let i = 0;
  while (i < script.length) {
    const ch = script[i];
    const next = script[i + 1];

    if (ch === "/" && next === "/") {
      out += "  ";
      i += 2;
      while (i < script.length && script[i] !== "\n") { out += " "; i += 1; }
      continue;
    }

    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < script.length) {
        if (script[i] === "*" && script[i + 1] === "/") { out += "  "; i += 2; break; }
        out += script[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += " ";
      i += 1;
      while (i < script.length) {
        const current = script[i];
        if (current === "\\") { out += "  "; i += 2; continue; }
        out += current === "\n" ? "\n" : " ";
        i += 1;
        if (current === quote) break;
      }
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

function findSdkContractHits(script: string): StaticPreflightHit[] {
  const masked = maskStringsAndComments(script);
  const hits: StaticPreflightHit[] = [];
  const seen = new Set<string>();

  const addHit = (hit: StaticPreflightHit) => {
    const key = `${hit.kind}:${hit.callPrefix}:${hit.field}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };

  const reflectionPatterns: Array<{ re: RegExp; callPrefix: string }> = [
    { re: /\bObject\s*\.\s*(?:keys|entries|values|getOwnPropertyNames)\s*\(\s*sdk(?:\s*\.\s*[A-Za-z_$][\w$]*)?\s*\)/g, callPrefix: "Object reflection over sdk" },
    { re: /\bReflect\s*\.\s*ownKeys\s*\(\s*sdk(?:\s*\.\s*[A-Za-z_$][\w$]*)?\s*\)/g, callPrefix: "Reflect.ownKeys over sdk" },
    { re: /\bfor\s*\([^)]*\bin\s+sdk(?:\s*\.\s*[A-Za-z_$][\w$]*)?\s*\)/g, callPrefix: "for-in reflection over sdk" },
    { re: /\bconsole\s*\.\s*(?:log|dir|debug)\s*\(\s*sdk(?:\s*\.\s*[A-Za-z_$][\w$]*)?\s*\)/g, callPrefix: "console reflection over sdk" },
  ];

  for (const pattern of reflectionPatterns) {
    if (!pattern.re.test(masked)) continue;
    addHit({
      kind: "sdk_reflection",
      tool: "workflow_sdk",
      field: "sdk",
      reason: "Use the SDK reference; reflection is unsupported.",
      callPrefix: pattern.callPrefix,
    });
  }

  const sdkMemberRe = /\bsdk\s*\.\s*([A-Za-z_$][\w$]*)\s*(?:\.\s*([A-Za-z_$][\w$]*))?/g;
  for (const match of masked.matchAll(sdkMemberRe)) {
    const namespace = match[1];
    const method = match[2];
    if (!namespace) continue;

    if (!method) {
      if (!TOP_LEVEL_SDK_MEMBERS.has(namespace)) {
        addHit({
          kind: "unknown_sdk_member",
          tool: "workflow_sdk",
          field: namespace,
          reason: `Unknown SDK member: \`sdk.${namespace}\`. Known members: ${[...TOP_LEVEL_SDK_MEMBERS].sort().join(", ")}.`,
          canonical: suggestClosest(namespace, [...TOP_LEVEL_SDK_MEMBERS]),
          callPrefix: `sdk.${namespace}`,
        });
      }
      continue;
    }

    const methods = SDK_NAMESPACES.get(namespace);
    if (!methods) {
      addHit({
        kind: "unknown_sdk_member",
        tool: "workflow_sdk",
        field: namespace,
        reason: `Unknown SDK member: \`sdk.${namespace}\`. Known members: ${[...TOP_LEVEL_SDK_MEMBERS].sort().join(", ")}.`,
        canonical: suggestClosest(namespace, [...TOP_LEVEL_SDK_MEMBERS]),
        callPrefix: `sdk.${namespace}`,
      });
      continue;
    }

    if (!methods.includes(method)) {
      const suggestion = suggestClosest(method, methods);
      addHit({
        kind: "unknown_sdk_member",
        tool: "workflow_sdk",
        field: method,
        reason: `Unknown SDK member: \`sdk.${namespace}.${method}\`.${suggestion ? ` Did you mean \`${suggestion}\`?` : ""} Known members: ${methods.join(", ")}.`,
        canonical: suggestion,
        callPrefix: `sdk.${namespace}.${method}`,
      });
    }
  }

  return hits;
}

export function staticWorkflowPreflight(script: string): StaticPreflightResult {
  const hits: StaticPreflightHit[] = [];
  hits.push(...findSdkContractHits(script));
  for (const pattern of CALL_PATTERNS) {
    const rules = FORBIDDEN_BY_OP[pattern.tool];
    if (!rules) continue;
    let cursor = 0;
    while (cursor < script.length) {
      const found = findCallArgSpan(script, pattern.prefix, cursor);
      if (!found) break;
      for (const hit of findForbiddenKeysInArgs(found.argText, rules)) {
        hits.push({
          kind: "forbidden_field",
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

  // PRD 2026-05-18 Phase 3: contract checks beyond the forbidden-fields deny
  // list (MA attach missing currency, MA create with a non-UUID CI label,
  // typed RiRo settings keys with stringified values).
  for (const check of CONTRACT_CHECKS) {
    let cursor = 0;
    while (cursor < script.length) {
      const found = findCallArgSpan(script, check.prefix, cursor);
      if (!found) break;
      for (const hit of check.inspect(found.argText)) {
        hits.push({
          kind: "forbidden_field",
          tool: check.tool,
          field: hit.field,
          reason: hit.reason,
          canonical: hit.canonical,
          callPrefix: check.prefix,
        });
      }
      cursor = found.endIdx;
    }
  }

  if (hits.length === 0) return { ok: true, hits: [] };

  const lines = hits.map((h) => {
    if (h.kind === "unknown_sdk_member" || h.kind === "sdk_reflection") {
      const canonical = h.canonical ? ` Suggested member: ${h.canonical}.` : "";
      return `- ${h.callPrefix}: ${h.reason}${canonical}`;
    }
    const canonical = h.canonical ? ` Use ${h.canonical} instead.` : "";
    return `- ${h.callPrefix}(...): forbidden field "${h.field}". ${h.reason}${canonical}`;
  });
  return {
    ok: false,
    hits,
    message: `Workflow preflight found contract violations:\n${lines.join("\n")}`,
  };
}
