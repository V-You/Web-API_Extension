import { TOOL_SCHEMAS, type ToolSchema } from "../webmcp/tool-schemas";
import { createExecuteMap } from "../tools/internal-router";
import type { ChatToolDeclaration } from "./llm-adapter";

export interface ChatToolCatalogOptions {
  writeToolsEnabled?: boolean;
}

const READ_ONLY_ACTIONS: Record<string, string[]> = {
  manage_entity: ["get", "search", "list_children"],
  manage_contact: ["get", "list", "find_by_username"],
  manage_merchant_account: ["get", "list"],
  lookup_clearing_institutes: ["search", "get_fields", "list_live"],
  manage_settings: ["get", "batch_get", "list_non_default"],
};

const READ_ONLY_PROPERTIES: Record<string, string[]> = {
  manage_entity: ["action", "entityId", "entityType", "namePath", "parentId", "parentType", "childType"],
  get_hierarchy: ["pspId", "entityId", "entityType", "depth", "estimateOnly"],
  manage_contact: ["action", "contactId", "entityId", "entityType", "scope", "username"],
  manage_merchant_account: ["action", "merchantAccountId", "entityId", "entityType", "scope"],
  lookup_clearing_institutes: ["action", "query", "ciCode", "pspId"],
  describe_settings: ["query", "limit"],
  manage_settings: ["action", "entityId", "entityType", "key", "entityIds", "keys", "query"],
  get_audit_log: ["eventType", "entityId", "limit", "since"],
};

const EXECUTE_MAP = createExecuteMap();

function cloneSchema(schema: ToolSchema): ToolSchema {
  return JSON.parse(JSON.stringify(schema)) as ToolSchema;
}

function sanitizeSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSchemaValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "additionalProperties")
    .map(([key, nested]) => [key, sanitizeSchemaValue(nested)]);

  return Object.fromEntries(entries);
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
  if (schema.name === "execute_workflow") return null;

  const next = options.writeToolsEnabled ? cloneSchema(schema) : filterSchemaProperties(cloneSchema(schema));
  const allowedActions = READ_ONLY_ACTIONS[next.name];
  const actionProperty = (next.inputSchema as {
    properties?: Record<string, { enum?: string[] }>;
  }).properties?.action;

  if (!options.writeToolsEnabled && allowedActions && actionProperty?.enum) {
    actionProperty.enum = actionProperty.enum.filter((action) => allowedActions.includes(action));
  }

  return sanitizeSchemaValue(next) as ToolSchema;
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
    throw new Error(`Tool ${name} is not available in chat safe mode.`);
  }

  const allowedActions = READ_ONLY_ACTIONS[name];
  const requestedAction = args.action as string | undefined;
  if (!options.writeToolsEnabled && allowedActions && (!requestedAction || !allowedActions.includes(requestedAction))) {
    throw new Error(`Action ${requestedAction ?? "unknown"} is not available for ${name} in chat safe mode.`);
  }

  const execute = EXECUTE_MAP[name];
  if (!execute) {
    throw new Error(`No execute handler found for ${name}.`);
  }

  return execute(args);
}