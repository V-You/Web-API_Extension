#!/usr/bin/env node
/**
 * Web API operation-manifest generator.
 *
 * Reads:
 *   - base_data/ACI_Web-API_OpenAPI.yaml
 *   - base_data/character-value-mapping.yaml
 *
 * Writes:
 *   - src_data/webapi-operation-manifest.json
 *   - src_data/webapi-operation-manifest.d.ts
 *   - src_data/webapi-sdk.d.ts
 *   - src_data/webapi-audit-events.ts
 *
 * Flags:
 *   --check   exit 1 if the committed files differ from the freshly generated output.
 *
 * The manifest is the single source of truth for per-action tool schemas,
 * chat declarations, virtual SDK types, and `describe_operation` output.
 *
 * See md/2026-04-16_PRD_accuracy-push.md section 6.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SPEC = resolve(ROOT, "base_data/ACI_Web-API_OpenAPI.yaml");
const MAPPING = resolve(ROOT, "base_data/character-value-mapping.yaml");
const OUT_JSON = resolve(ROOT, "src_data/webapi-operation-manifest.json");
const OUT_DTS = resolve(ROOT, "src_data/webapi-operation-manifest.d.ts");
const OUT_SDK_DTS = resolve(ROOT, "src_data/webapi-sdk.d.ts");
const OUT_AUDIT = resolve(ROOT, "src_data/webapi-audit-events.ts");

/**
 * Map an OpenAPI operationId to a logical tool name + parent entity level.
 * Unknown operationIds fall into `otherOperations` untyped.
 */
const OPERATION_MAP = {
  // contacts ------------------------------------------------------------
  addContactPspLevel: { tool: "create_contact", parent: "psp" },
  addContactDivisionLevel: { tool: "create_contact", parent: "division" },
  addContactMerchantLevel: { tool: "create_contact", parent: "merchant" },
  editContact: { tool: "edit_contact", parent: null },
  getContact: { tool: "get_contact", parent: null },
  deleteContact: { tool: "delete_contact", parent: null },
  lockContact: { tool: "lock_contact", parent: null },
  unlockContact: { tool: "unlock_contact", parent: null },
  resetContactPassword: { tool: "set_contact_password", parent: null },
  listOwnedContactsPspLevel: { tool: "list_owned_contacts", parent: "psp" },
  listOwnedContactsDivisionLevel: { tool: "list_owned_contacts", parent: "division" },
  listOwnedContactsMerchantLevel: { tool: "list_owned_contacts", parent: "merchant" },
  listOwnedContactsChannelLevel: { tool: "list_owned_contacts", parent: "channel" },
  listAttachedContactsPspLevel: { tool: "list_attached_contacts", parent: "psp" },
  listAttachedContactsDivisionLevel: { tool: "list_attached_contacts", parent: "division" },
  listAttachedContactsMerchantLevel: { tool: "list_attached_contacts", parent: "merchant" },
  listAttachedContactsChannelLevel: { tool: "list_attached_contacts", parent: "channel" },
  detachContactPspLevel: { tool: "detach_contact", parent: "psp" },
  detachContactDivisionLevel: { tool: "detach_contact", parent: "division" },
  detachContactMerchantLevel: { tool: "detach_contact", parent: "merchant" },
  detachContactChannelLevel: { tool: "detach_contact", parent: "channel" },

  // entities ------------------------------------------------------------
  addDivision: { tool: "create_division", parent: "psp" },
  listDivisions: { tool: "list_divisions", parent: "psp" },
  addMerchant: { tool: "create_merchant", parent: "division" },
  listMerchants: { tool: "list_merchants", parent: "division" },
  addChannel: { tool: "create_channel", parent: "merchant" },
  listChannels: { tool: "list_channels", parent: "merchant" },
  getDivision: { tool: "get_entity", parent: "division" },
  getMerchant: { tool: "get_entity", parent: "merchant" },
  getChannel: { tool: "get_entity", parent: "channel" },
  editDivision: { tool: "edit_entity", parent: "division" },
  editMerchant: { tool: "edit_entity", parent: "merchant" },
  editChannel: { tool: "edit_entity", parent: "channel" },
  deleteDivision: { tool: "delete_entity", parent: "division" },
  deleteMerchant: { tool: "delete_entity", parent: "merchant" },
  deleteChannel: { tool: "delete_entity", parent: "channel" },

  // merchant accounts --------------------------------------------------
  addMerchantAccountPspLevel: { tool: "create_merchant_account", parent: "psp" },
  addMerchantAccountDivisionLevel: { tool: "create_merchant_account", parent: "division" },
  addMerchantAccountMerchantLevel: { tool: "create_merchant_account", parent: "merchant" },
  addMerchantAccountChannelLevel: { tool: "create_merchant_account", parent: "channel" },
  listOwnedMerchantAccountsPspLevel: { tool: "list_owned_merchant_accounts", parent: "psp" },
  listOwnedMerchantAccountsDivisionLevel: { tool: "list_owned_merchant_accounts", parent: "division" },
  listOwnedMerchantAccountsMerchantLevel: { tool: "list_owned_merchant_accounts", parent: "merchant" },
  listOwnedMerchantAccountsChannelLevel: { tool: "list_owned_merchant_accounts", parent: "channel" },
  getMerchantAccount: { tool: "get_merchant_account", parent: null },
  updateMerchantAccount: { tool: "edit_merchant_account", parent: null },
  deleteMerchantAccount: { tool: "delete_merchant_account", parent: null },
  attachMerchantAccountPspLevel: { tool: "attach_merchant_account", parent: "psp" },
  attachMerchantAccountDivisionLevel: { tool: "attach_merchant_account", parent: "division" },
  attachMerchantAccountMerchantLevel: { tool: "attach_merchant_account", parent: "merchant" },
  attachMerchantAccountChannelLevel: { tool: "attach_merchant_account", parent: "channel" },
  listAttachedMerchantAccountsPspLevel: { tool: "list_attached_merchant_accounts", parent: "psp" },
  listAttachedMerchantAccountsDivisionLevel: { tool: "list_attached_merchant_accounts", parent: "division" },
  listAttachedMerchantAccountsMerchantLevel: { tool: "list_attached_merchant_accounts", parent: "merchant" },
  listAttachedMerchantAccountsChannelLevel: { tool: "list_attached_merchant_accounts", parent: "channel" },
  detachMerchantAccount: { tool: "detach_merchant_account", parent: null },
  detachMerchantAccountWithAttachedId: { tool: "detach_merchant_account", parent: null },
  threeDEnrollmentCheck: { tool: "three_d_enrollment_check", parent: null },

  // clearing institutes ------------------------------------------------
  listClearingInstitutes: { tool: "list_clearing_institutes", parent: "psp" },

  // api tokens ---------------------------------------------------------
  listApiTokensForMerchant: { tool: "list_api_tokens", parent: "merchant" },
  createApiTokenForMerchant: { tool: "create_api_token", parent: "merchant" },
  getApiToken: { tool: "get_api_token", parent: null },
  updateApiToken: { tool: "update_api_token", parent: null },
  suspendApiToken: { tool: "suspend_api_token", parent: null },
  activateApiToken: { tool: "activate_api_token", parent: null },
  deleteApiToken: { tool: "delete_api_token", parent: null },

  // password (audit-log exempt; separate logical tool)
  setPassword: { tool: "set_contact_password", parent: null },
};

/** Actions considered destructive (gated through confirm-bridge at runtime). */
const DESTRUCTIVE_ACTIONS = new Set([
  "delete_contact",
  "delete_entity",
  "delete_merchant_account",
  "detach_contact",
  "detach_merchant_account",
  "create_api_token",
  "update_api_token",
  "suspend_api_token",
  "activate_api_token",
  "delete_api_token",
  "set_contact_password",
]);

/** Destructive values within otherwise non-destructive edit tools. */
const DESTRUCTIVE_VALUES = {
  state: ["DELETED"],
};

/** Map tool to audit event type (writes only). */
const AUDIT_EVENT_TYPE = {
  create_contact: "contact_create",
  edit_contact: "contact_edit",
  delete_contact: "contact_delete",
  lock_contact: "contact_lock",
  unlock_contact: "contact_unlock",
  set_contact_password: "contact_password_reset",
  attach_contact: "contact_attach",
  detach_contact: "contact_detach",
  create_division: "entity_create",
  create_merchant: "entity_create",
  create_channel: "entity_create",
  edit_entity: "entity_edit",
  delete_entity: "entity_delete",
  create_merchant_account: "ma_create",
  edit_merchant_account: "ma_update",
  delete_merchant_account: "ma_delete",
  attach_merchant_account: "ma_attach",
  detach_merchant_account: "ma_detach",
  create_api_token: "api_token_create",
  update_api_token: "api_token_update",
  suspend_api_token: "api_token_suspend",
  activate_api_token: "api_token_activate",
  delete_api_token: "api_token_delete",
};

// ---------------------------------------------------------------------

function loadYaml(path) {
  const text = readFileSync(path, "utf8");
  return yaml.load(text);
}

function normalizeFormatHint(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s;
}

function resolveLocalRef(spec, ref) {
  if (!ref || typeof ref !== "string" || !ref.startsWith("#/")) return null;
  return ref
    .slice(2)
    .split("/")
    .reduce((node, part) => node?.[part], spec) ?? null;
}

function resolveNode(spec, node) {
  if (!node || typeof node !== "object") return node;
  if (node.$ref) {
    return resolveNode(spec, resolveLocalRef(spec, node.$ref));
  }
  return node;
}

function mergeAllOfSchemas(spec, schema) {
  const resolved = resolveNode(spec, schema);
  if (!resolved?.allOf) return resolved;

  const merged = { ...resolved, allOf: undefined, properties: {}, required: [] };
  for (const part of resolved.allOf) {
    const child = mergeAllOfSchemas(spec, part);
    if (!child) continue;
    Object.assign(merged, child);
    merged.properties = { ...(merged.properties ?? {}), ...(child.properties ?? {}) };
    merged.required = Array.from(new Set([...(merged.required ?? []), ...(child.required ?? [])]));
  }
  delete merged.allOf;
  return merged;
}

function applyCharacterMapping(field, mapping) {
  const raw = normalizeFormatHint(field.pattern) ?? normalizeFormatHint(field.description);
  const rawMap = mapping.character_value_mapping.raw_to_canonical;
  const canonical = mapping.character_value_mapping.canonical;

  let canonicalKey = null;
  if (field.pattern && rawMap[field.pattern]) canonicalKey = rawMap[field.pattern];
  if (!canonicalKey && raw && rawMap[raw]) canonicalKey = rawMap[raw];
  if (!canonicalKey) return null;

  const rule = canonical[canonicalKey];
  if (!rule) return null;

  return { canonicalKey, rule };
}

/**
 * Detect a conditional trigger from a property description, e.g.
 * "Required for OAUTH kind contacts" -> { field: "kind", value: "OAUTH_APP" }.
 * Only known patterns are captured; unknown phrasings stay silent.
 */
function detectConditionalTrigger(name, description) {
  if (!description) return null;
  const lower = description.toLowerCase();
  if (name === "oauthRedirectUrl" && lower.includes("oauth")) {
    return { field: "kind", value: "OAUTH_APP" };
  }
  return null;
}

function deriveLogicalType(prop, mappingHit) {
  if (mappingHit?.rule.action === "suggest_boolean") return "boolean";
  if (mappingHit?.rule.action === "apply_enum") return "enum";
  if (mappingHit?.canonicalKey === "timestamp_seconds") return "timestamp_seconds";
  if (mappingHit?.rule.action === "suggest_format" && mappingHit.rule.suggested_format === "uri") return "url";
  if (prop.type === "boolean") return "boolean";
  if (prop.type === "integer" || prop.type === "number") return "integer";
  return "string";
}

function extractExampleFields(examples) {
  if (!examples) return new Set();
  const names = new Set();
  for (const ex of Object.values(examples)) {
    const val = ex?.value;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      for (const k of Object.keys(val)) names.add(k);
    }
  }
  return names;
}

function buildRequestFields(spec, op, mapping) {
  const body = op.requestBody?.content?.["application/x-www-form-urlencoded"];
  if (!body) return [];
  const schema = mergeAllOfSchemas(spec, body.schema);
  if (!schema?.properties) return [];

  const exampleFields = extractExampleFields(body.examples);
  const specRequired = new Set(schema.required ?? []);

  const out = [];
  for (const [name, prop] of Object.entries(schema.properties)) {
    const resolvedProp = mergeAllOfSchemas(spec, prop);
    const mappingHit = applyCharacterMapping(resolvedProp, mapping);
    const conditional = detectConditionalTrigger(name, resolvedProp.description);

    let required = "optional";
    if (specRequired.has(name)) required = "required_spec";
    else if (conditional) required = "conditional";
    else if (exampleFields.has(name)) required = "example_core";

    const logicalType = deriveLogicalType(resolvedProp, mappingHit);
    const field = {
      name,
      logicalType,
      required,
      description: resolvedProp.description ?? null,
    };

    const pattern = mappingHit?.rule?.pattern ?? resolvedProp.pattern ?? null;
    if (pattern) field.pattern = pattern;

    const enumVals = mappingHit?.rule?.enum ?? resolvedProp.enum ?? null;
    if (enumVals) field.enum = enumVals;

    if (mappingHit?.rule?.suggested_format) field.format = mappingHit.rule.suggested_format;
    if (resolvedProp.example !== undefined) field.example = resolvedProp.example;
    if (conditional) field.conditionalTrigger = conditional;

    if (name === "state" && DESTRUCTIVE_VALUES.state) {
      field.destructiveValues = DESTRUCTIVE_VALUES.state;
    }

    field.provenance = mappingHit
      ? ["spec", `character-value-mapping:${mappingHit.canonicalKey}`]
      : ["spec"];

    out.push(field);
  }
  return out;
}

function buildPathParams(spec, op) {
  const params = op.parameters ?? [];
  return params
    .map((p) => resolveNode(spec, p))
    .filter((p) => p?.in === "path")
    .map((p) => ({
      name: p.name,
      pattern: resolveNode(spec, p.schema)?.pattern ?? null,
      required: true,
    }));
}

function buildOperationEntry(spec, pathTemplate, method, op, mapping) {
  const opId = op.operationId;
  const mapped = OPERATION_MAP[opId];
  const entry = {
    operationId: opId ?? null,
    toolName: mapped?.tool ?? null,
    parentEntityType: mapped?.parent ?? null,
    method: method.toUpperCase(),
    pathTemplate,
    pathParams: buildPathParams(spec, op),
    request: buildRequestFields(spec, op, mapping),
    description: op.description ?? op.summary ?? null,
    auditEventType: mapped ? AUDIT_EVENT_TYPE[mapped.tool] ?? null : null,
    destructive: mapped ? DESTRUCTIVE_ACTIONS.has(mapped.tool) : false,
  };
  return entry;
}

function buildManifest(spec, mapping) {
  const operations = [];
  const unmapped = [];
  const toolIndex = {};

  for (const [pathTemplate, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
      const entry = buildOperationEntry(spec, pathTemplate, method, op, mapping);
      operations.push(entry);
      if (!entry.toolName) {
        if (entry.operationId) unmapped.push(entry.operationId);
        continue;
      }
      const list = (toolIndex[entry.toolName] ||= []);
      list.push(entry);
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: "GENERATED",
    source: {
      spec: "base_data/ACI_Web-API_OpenAPI.yaml",
      mapping: "base_data/character-value-mapping.yaml",
    },
    tools: Object.keys(toolIndex).sort(),
    toolIndex: sortKeys(toolIndex),
    operations: operations.sort((a, b) =>
      String(a.operationId).localeCompare(String(b.operationId)),
    ),
    unmappedOperationIds: unmapped.sort(),
  };
}

function sortKeys(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) out[key] = obj[key];
  return out;
}

function emitDts(manifest) {
  const tools = manifest.tools;
  const header = `// generated by tools-cli/generate-manifest.mjs -- do not edit by hand.\n`;
  const toolUnion = tools.map((t) => `  | "${t}"`).join("\n");
  const lines = [
    header,
    `export type WebApiToolName =`,
    toolUnion || '  | never',
    ``,
    `export interface WebApiRequestField {`,
    `  name: string;`,
    `  logicalType: "string" | "boolean" | "enum" | "integer" | "url" | "timestamp_seconds";`,
    `  required: "required_path" | "required_spec" | "conditional" | "example_core" | "optional";`,
    `  description: string | null;`,
    `  pattern?: string;`,
    `  enum?: string[];`,
    `  format?: string;`,
    `  example?: unknown;`,
    `  conditionalTrigger?: { field: string; value: string };`,
    `  destructiveValues?: string[];`,
    `  provenance: string[];`,
    `}`,
    ``,
    `export interface WebApiPathParam {`,
    `  name: string;`,
    `  pattern: string | null;`,
    `  required: true;`,
    `}`,
    ``,
    `export interface WebApiOperation {`,
    `  operationId: string | null;`,
    `  toolName: WebApiToolName | null;`,
    `  parentEntityType: "psp" | "division" | "merchant" | "channel" | null;`,
    `  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";`,
    `  pathTemplate: string;`,
    `  pathParams: WebApiPathParam[];`,
    `  request: WebApiRequestField[];`,
    `  description: string | null;`,
    `  auditEventType: string | null;`,
    `  destructive: boolean;`,
    `}`,
    ``,
    `export interface WebApiOperationManifest {`,
    `  schemaVersion: 1;`,
    `  generatedAt: string;`,
    `  source: { spec: string; mapping: string };`,
    `  tools: WebApiToolName[];`,
    `  toolIndex: Record<WebApiToolName, WebApiOperation[]>;`,
    `  operations: WebApiOperation[];`,
    `  unmappedOperationIds: string[];`,
    `}`,
    ``,
    `declare const manifest: WebApiOperationManifest;`,
    `export default manifest;`,
    ``,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------

/**
 * Emit a .d.ts surfacing typed parameter shapes per logical tool.
 * Consumed by the Virtual SDK to expose typed operations.
 */
function logicalTypeToTs(logical) {
  switch (logical) {
    case "boolean": return "boolean";
    case "integer": return "number";
    default: return "string";
  }
}

function tsFieldLine(field) {
  const optional = field.required === "required_spec" ? "" : "?";
  const type = field.enum && field.enum.length > 0
    ? field.enum.map((v) => JSON.stringify(v)).join(" | ")
    : logicalTypeToTs(field.logicalType);
  const doc = field.description ? `  /** ${field.description.split("\n")[0].slice(0, 160)} */\n` : "";
  return `${doc}  ${JSON.stringify(field.name)}${optional}: ${type};`;
}

function unionPathParamNames(variants) {
  const seen = new Set();
  for (const v of variants) for (const p of v.pathParams) seen.add(p.name);
  return Array.from(seen);
}

function unionRequestFieldsByName(variants) {
  const seen = new Map();
  for (const v of variants) for (const f of v.request) if (!seen.has(f.name)) seen.set(f.name, f);
  return Array.from(seen.values());
}

function emitSdkDts(manifest) {
  const lines = [
    "// generated by tools-cli/generate-manifest.mjs -- do not edit by hand.",
    "//",
    "// Typed parameter shapes for each Virtual SDK method derived from the",
    "// committed operation manifest.",
    "",
  ];
  const ifaceNames = [];
  for (const tool of manifest.tools) {
    const variants = manifest.toolIndex[tool];
    const parentTypes = new Set(variants.map((v) => v.parentEntityType).filter(Boolean));
    const multiParent = parentTypes.size > 1;

    const parentIdKeys = new Set(["pspId", "divisionId", "merchantId", "channelId"]);
    const ifaceName = `Params_${tool}`;
    ifaceNames.push([tool, ifaceName]);
    lines.push(`export interface ${ifaceName} {`);
    if (multiParent) {
      lines.push(`  parentType: ${Array.from(parentTypes).map((t) => JSON.stringify(t)).join(" | ")};`);
      lines.push(`  parentId: string;`);
    }
    for (const name of unionPathParamNames(variants)) {
      if (multiParent && parentIdKeys.has(name)) continue;
      lines.push(`  ${JSON.stringify(name)}: string;`);
    }
    for (const f of unionRequestFieldsByName(variants)) {
      lines.push(tsFieldLine(f));
    }
    if (variants.some((v) => v.destructive)) {
      lines.push(`  /** Set true to bypass the confirm bridge for destructive calls. */`);
      lines.push(`  confirm?: boolean;`);
    }
    lines.push("}");
    lines.push("");
  }

  lines.push("export interface WebApiSdk {");
  for (const [tool, iface] of ifaceNames) {
    lines.push(`  ${JSON.stringify(tool)}(params: ${iface}): Promise<{ ok: boolean; status: number; data: unknown }>;`);
  }
  lines.push("}");
  lines.push("");
  lines.push("declare const sdk: WebApiSdk;");
  lines.push("export default sdk;");
  lines.push("");

  return lines.join("\n");
}

/**
 * Emit a pure-data module listing every auditEventType observed on
 * manifest operations. Part-II P2-D4: consumers (WebMCP schemas, runtime
 * typing) import from this module so the manifest is the single source
 * of truth for API-backed audit event types.
 *
 * Main-world-safe: no chrome, no lib, no bridge imports.
 */
function emitAuditEventsModule(manifest) {
  const eventTypes = new Set();
  for (const op of manifest.operations) {
    if (op.auditEventType) eventTypes.add(op.auditEventType);
  }
  const sorted = [...eventTypes].sort();

  const lines = [
    `// generated by tools-cli/generate-manifest.mjs -- do not edit by hand.`,
    `//`,
    `// Audit event types emitted by operations in the bundled OpenAPI spec.`,
    `// Derived from manifest.operations[].auditEventType (sorted, deduplicated).`,
    `// Pure data; safe to import from main-world code.`,
    ``,
    `export const AUDIT_EVENT_TYPES = [`,
    ...sorted.map((t) => `  ${JSON.stringify(t)},`),
    `] as const;`,
    ``,
    `export type ApiAuditEventType = (typeof AUDIT_EVENT_TYPES)[number];`,
    ``,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------

function main() {
  if (!existsSync(SPEC)) {
    console.error(`OpenAPI spec not found at ${SPEC}`);
    process.exit(2);
  }
  const spec = loadYaml(SPEC);
  const mapping = loadYaml(MAPPING);
  const manifest = buildManifest(spec, mapping);
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  const dts = emitDts(manifest);
  const sdkDts = emitSdkDts(manifest);
  const auditTs = emitAuditEventsModule(manifest);

  const check = process.argv.includes("--check");
  mkdirSync(dirname(OUT_JSON), { recursive: true });

  if (check) {
    const existingJson = existsSync(OUT_JSON) ? readFileSync(OUT_JSON, "utf8") : "";
    const existingDts = existsSync(OUT_DTS) ? readFileSync(OUT_DTS, "utf8") : "";
    const existingSdkDts = existsSync(OUT_SDK_DTS) ? readFileSync(OUT_SDK_DTS, "utf8") : "";
    const existingAudit = existsSync(OUT_AUDIT) ? readFileSync(OUT_AUDIT, "utf8") : "";
    if (
      existingJson !== manifestJson
      || existingDts !== dts
      || existingSdkDts !== sdkDts
      || existingAudit !== auditTs
    ) {
      console.error(
        "manifest is stale. Run `npm run generate:manifest` and commit the result.",
      );
      process.exit(1);
    }
    console.log("manifest up to date.");
    return;
  }

  writeFileSync(OUT_JSON, manifestJson);
  writeFileSync(OUT_DTS, dts);
  writeFileSync(OUT_SDK_DTS, sdkDts);
  writeFileSync(OUT_AUDIT, auditTs);
  console.log(
    `wrote ${OUT_JSON} (${manifest.operations.length} operations, ${manifest.tools.length} tools, ${manifest.unmappedOperationIds.length} unmapped)`,
  );
}

main();
