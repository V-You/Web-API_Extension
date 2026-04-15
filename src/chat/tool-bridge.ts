import { TOOL_SCHEMAS, type ToolSchema } from "../webmcp/tool-schemas";
import { createExecuteMap } from "../tools/internal-router";
import type { ChatToolDeclaration } from "./llm-adapter";

const READ_ONLY_ACTIONS: Record<string, string[]> = {
  manage_entity: ["get", "search", "list_children"],
  manage_contact: ["get", "list", "find_by_username"],
  manage_merchant_account: ["get", "list"],
  lookup_clearing_institutes: ["search", "get_fields", "list_live"],
  manage_settings: ["get", "batch_get", "list_non_default"],
};

const EXECUTE_MAP = createExecuteMap();

function cloneSchema(schema: ToolSchema): ToolSchema {
  return JSON.parse(JSON.stringify(schema)) as ToolSchema;
}

function toChatSchema(schema: ToolSchema): ToolSchema | null {
  if (schema.name === "execute_workflow") return null;

  const next = cloneSchema(schema);
  const allowedActions = READ_ONLY_ACTIONS[next.name];
  const actionProperty = (next.inputSchema as {
    properties?: Record<string, { enum?: string[] }>;
  }).properties?.action;

  if (allowedActions && actionProperty?.enum) {
    actionProperty.enum = actionProperty.enum.filter((action) => allowedActions.includes(action));
  }

  return next;
}

export const CHAT_TOOL_SCHEMAS = TOOL_SCHEMAS
  .map(toChatSchema)
  .filter((schema): schema is ToolSchema => schema !== null);

export function getChatToolDeclarations(): ChatToolDeclaration[] {
  return CHAT_TOOL_SCHEMAS.map((schema) => ({
    name: schema.name,
    description: schema.description,
    parameters: schema.inputSchema,
  }));
}

export async function executeChatTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const schema = CHAT_TOOL_SCHEMAS.find((tool) => tool.name === name);
  if (!schema) {
    throw new Error(`Tool ${name} is not available in chat safe mode.`);
  }

  const allowedActions = READ_ONLY_ACTIONS[name];
  const requestedAction = args.action as string | undefined;
  if (allowedActions && (!requestedAction || !allowedActions.includes(requestedAction))) {
    throw new Error(`Action ${requestedAction ?? "unknown"} is not available for ${name} in chat safe mode.`);
  }

  const execute = EXECUTE_MAP[name];
  if (!execute) {
    throw new Error(`No execute handler found for ${name}.`);
  }

  return execute(args);
}