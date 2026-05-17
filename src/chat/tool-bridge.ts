import { TOOL_SCHEMAS, type ToolSchema } from "../webmcp/tool-schemas";
import { createExecuteMap, type ExecuteMapOptions } from "../tools/internal-router";
import { isRecoverableToolError } from "../tools/recoverable-error";
import type { ChatToolDeclaration } from "./llm-adapter";
import { contextPacketFor, resolveChannelMerchantFromContext, type ChatContextRecord } from "./context-store";

export interface ChatToolCatalogOptions {
  writeToolsEnabled?: boolean;
  accessTokenControlEnabled?: boolean;
  automationModeEnabled?: boolean;
  context?: ChatContextRecord | null;
  startWorkflowJob?: ExecuteMapOptions["startWorkflowJob"];
}

const API_TOKEN_TOOLS = new Set([
  "list_api_tokens",
  "get_api_token",
  "create_api_token",
  "update_api_token",
  "suspend_api_token",
  "activate_api_token",
  "delete_api_token",
  "send_test_transaction",
]);

const READ_ONLY_ACTIONS: Record<string, string[]> = {
  manage_entity: ["get", "search", "list_children"],
  manage_contact: ["get", "list", "find_by_username"],
  manage_merchant_account: ["get", "list"],
  lookup_clearing_institutes: ["search", "get_fields", "list_live"],
  manage_settings: ["get", "batch_get", "list_non_default"],
};

const READ_ONLY_PROPERTIES: Record<string, string[]> = {
  manage_entity: ["action", "entityId", "entityType", "namePath", "parentId", "parentType", "childType"],
  get_hierarchy: ["pspId", "entityId", "entityType", "depth", "estimateOnly", "includeDisabled"],
  manage_contact: ["action", "contactId", "entityId", "entityType", "scope", "username"],
  manage_merchant_account: ["action", "merchantAccountId", "entityId", "entityType", "scope"],
  lookup_clearing_institutes: ["action", "query", "ciCode", "pspId"],
  describe_settings: ["query", "limit"],
  describe_operation: ["toolName"],
  manage_settings: ["action", "entityId", "entityType", "key", "entityIds", "keys", "query"],
  get_audit_log: ["eventType", "entityId", "limit", "since"],
};

const EXECUTE_MAP = createExecuteMap();

function cloneSchema(schema: ToolSchema): ToolSchema {
  return JSON.parse(JSON.stringify(schema)) as ToolSchema;
}

// D11 – Gemini-safe schema subset. Only these JSON-Schema keys are allowed
// in chat-facing declarations. Arrays need `items`; the rest are listed
// literally by the PRD.
const CHAT_ALLOWED_KEYS = new Set([
  "type",
  "properties",
  "required",
  "enum",
  "description",
  "pattern",
  "format",
  "items",
]);

// D11 – explicit block list so regressions fail loudly instead of being
// silently stripped. Kept as a separate set to produce clearer error
// messages than "unknown key".
const CHAT_FORBIDDEN_KEYS = new Set([
  "oneOf",
  "allOf",
  "anyOf",
  "$ref",
  "not",
  "additionalProperties",
  // D12 – chat token budget; full examples live in describe_operation.
  "example",
  "examples",
]);

// Part-II P2-D5: narrow, explicit drop list. Only these keys are removed
// from handwritten/generated schemas on the chat path. Anything else --
// including anything in CHAT_FORBIDDEN_KEYS -- flows through unchanged so
// that assertChatSafeSchema below has a real chance to catch regressions
// rather than silently cleaning them up.
const CHAT_DROP_KEYS = new Set([
  "additionalProperties",
  "minimum",
  "maximum",
]);

/**
 * Recursively builds the chat-facing copy of a JSON-Schema node by
 * dropping only the narrow, known non-subset keys in CHAT_DROP_KEYS.
 * Every other key (allowed or forbidden) is preserved so the subsequent
 * `assertChatSafeSchema` pass can validate the real authored shape.
 */
export function buildChatSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => buildChatSchemaValue(item));
  if (!value || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (CHAT_DROP_KEYS.has(key)) continue;
    if (key === "properties") {
      const props = source[key] as Record<string, unknown> | undefined;
      if (!props) continue;
      out.properties = Object.fromEntries(
        Object.entries(props).map(([pk, pv]) => [pk, buildChatSchemaValue(pv)]),
      );
      continue;
    }
    out[key] = buildChatSchemaValue(source[key]);
  }
  return out;
}

function buildChatSchema(schema: ToolSchema): ToolSchema {
  const base = cloneSchema(schema);
  return {
    name: base.name,
    title: base.title,
    description: base.description,
    ...(base.annotations ? { annotations: base.annotations } : {}),
    inputSchema: buildChatSchemaValue(base.inputSchema) as Record<string, unknown>,
  };
}

/**
 * Asserts that the given JSON-Schema node only contains chat-safe keys
 * (D11). Replaces the old `sanitizeSchemaValue` stripper – a violation
 * now throws instead of being silently cleaned, so snapshot tests catch
 * regressions.
 */
export function assertChatSafeSchema(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, idx) => assertChatSafeSchema(item, `${path}[${idx}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (CHAT_FORBIDDEN_KEYS.has(key)) {
      throw new Error(`chat schema violation at ${path}: forbidden key "${key}"`);
    }
    if (!CHAT_ALLOWED_KEYS.has(key)) {
      throw new Error(`chat schema violation at ${path}: unknown key "${key}"`);
    }
    const child = (value as Record<string, unknown>)[key];
    if (key === "properties" && child && typeof child === "object") {
      for (const [propName, propValue] of Object.entries(child as Record<string, unknown>)) {
        assertChatSafeSchema(propValue, `${path}.properties.${propName}`);
      }
      continue;
    }
    assertChatSafeSchema(child, `${path}.${key}`);
  }
}

function filterSchemaProperties(schema: ToolSchema): ToolSchema {
  const allowedProperties = READ_ONLY_PROPERTIES[schema.name];
  if (!allowedProperties) return schema;

  const inputSchema = schema.inputSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };

  if (inputSchema.properties) {
    inputSchema.properties = Object.fromEntries(
      Object.entries(inputSchema.properties).filter(([key]) => allowedProperties.includes(key)),
    );
  }

  if (inputSchema.required) {
    inputSchema.required = inputSchema.required.filter((key) => allowedProperties.includes(key));
  }

  return schema;
}

function toChatSchema(schema: ToolSchema, options: ChatToolCatalogOptions = {}): ToolSchema | null {
  if (API_TOKEN_TOOLS.has(schema.name) && !options.accessTokenControlEnabled) return null;

  if (schema.name === "execute_workflow") {
    if (!options.automationModeEnabled) return null;
    const chatSchema = buildChatSchema(cloneSchema(schema));
    assertChatSafeSchema(chatSchema.inputSchema);
    return chatSchema;
  }

  // Generated per-action tools: skip writes in safe mode; pass-through reads.
  const isGenerated = !(schema.name in READ_ONLY_PROPERTIES)
    && !READ_ONLY_ACTIONS[schema.name]
    && schema.name !== "execute_workflow";
  if (isGenerated) {
    const readOnly = schema.annotations?.readOnlyHint === true;
    if (!options.writeToolsEnabled && !readOnly) return null;
    const chatSchema = buildChatSchema(schema);
    assertChatSafeSchema(chatSchema.inputSchema);
    return chatSchema;
  }

  const next = options.writeToolsEnabled ? cloneSchema(schema) : filterSchemaProperties(cloneSchema(schema));
  const allowedActions = READ_ONLY_ACTIONS[next.name];
  const actionProperty = (next.inputSchema as {
    properties?: Record<string, { enum?: string[] }>;
  }).properties?.action;

  if (!options.writeToolsEnabled && allowedActions && actionProperty?.enum) {
    actionProperty.enum = actionProperty.enum.filter((action) => allowedActions.includes(action));
  }

  const chatSchema = buildChatSchema(next);
  assertChatSafeSchema(chatSchema.inputSchema);
  return chatSchema;
}

export function getChatToolSchemas(options: ChatToolCatalogOptions = {}): ToolSchema[] {
  return TOOL_SCHEMAS
    .map((schema) => toChatSchema(schema, options))
    .filter((schema): schema is ToolSchema => schema !== null);
}

export const CHAT_TOOL_SCHEMAS = getChatToolSchemas()
  .filter((schema): schema is ToolSchema => schema !== null);

export function getChatToolDeclarations(options: ChatToolCatalogOptions = {}): ChatToolDeclaration[] {
  return getChatToolSchemas(options).map((schema) => ({
    name: schema.name,
    description: schema.description,
    parameters: schema.inputSchema,
  }));
}

export async function executeChatTool(
  name: string,
  args: Record<string, unknown>,
  options: ChatToolCatalogOptions = {},
): Promise<unknown> {
  const schema = getChatToolSchemas(options).find((tool) => tool.name === name);
  if (!schema) {
    throw new Error(`Tool ${name} is not available in the current chat mode.`);
  }

  if (API_TOKEN_TOOLS.has(name) && !options.accessTokenControlEnabled) {
    throw new Error(`Tool ${name} requires accessToken control.`);
  }

  const allowedActions = READ_ONLY_ACTIONS[name];
  const requestedAction = args.action as string | undefined;
  if (!options.writeToolsEnabled && allowedActions && (!requestedAction || !allowedActions.includes(requestedAction))) {
    throw new Error(`Action ${requestedAction ?? "unknown"} is not available for ${name} in chat safe mode.`);
  }

  const executeMap = options.startWorkflowJob ? createExecuteMap({ startWorkflowJob: options.startWorkflowJob }) : EXECUTE_MAP;
  const execute = executeMap[name];
  if (!execute) {
    throw new Error(`No execute handler found for ${name}.`);
  }

  try {
    return await execute(applyContextDefaults(name, args, options));
  } catch (error) {
    if (isRecoverableToolError(error)) return error.payload;
    throw error;
  }
}

function applyContextDefaults(
  name: string,
  args: Record<string, unknown>,
  options: ChatToolCatalogOptions,
): Record<string, unknown> {
  if (name === "execute_workflow") {
    const packet = contextPacketFor(options.context ?? null);
    if (!packet) return args;
    const ids = Object.fromEntries(
      Object.entries(packet.ids).filter(([, value]) => typeof value === "string" && value.trim()),
    );
    const next = { ...args };
    if (!next.entityId) next.entityId = packet.current.entityId;
    if (!next.entityType) next.entityType = packet.current.entityType;
    next.contextSnapshot = {
      entityId: packet.current.entityId,
      entityType: packet.current.entityType,
      ...(packet.current.entityName ? { entityName: packet.current.entityName } : {}),
      ...(packet.current.section ? { section: packet.current.section } : {}),
      ...(Object.keys(ids).length > 0 ? { ids } : {}),
    };
    return next;
  }

  if (name === "lookup_clearing_institutes") {
    const packet = contextPacketFor(options.context ?? null);
    const pspId = packet?.ids.pspId ?? packet?.parentChain?.find((entry) => entry.entityType === "psp")?.entityId;
    if (!pspId || args.pspId) return args;
    return { ...args, pspId };
  }

  if (name !== "send_test_transaction") return args;
  const resolved = resolveChannelMerchantFromContext(options.context ?? null);
  if (!resolved) return args;

  const next = { ...args };
  if (!next.channelId && resolved.channelId) next.channelId = resolved.channelId;
  if (!next.merchantId && resolved.merchantId && resolved.confidence >= 90) {
    next.merchantId = resolved.merchantId;
    next.contextProvenance = resolved.provenance ?? "Merchant derived from current dashboard context.";
  }
  return next;
}