import type { WritePreview } from "../bridge/confirm-bridge";
import { describeMutatingCall } from "../bridge/write-confirm-utils";
import type { Environment } from "../lib/types";
import { pickOperation, type ParentEntityType } from "../tools/manifest-helpers";
import { TOOL_SCHEMAS } from "./tool-schemas";

const WEBMCP_READ_ACTIONS: Record<string, Set<string>> = {
  manage_settings: new Set(["get", "batch_get", "list_non_default"]),
};

function generatedOperationMethod(tool: string, params: Record<string, unknown>): "POST" | "DELETE" | null {
  const parentType = params.parentType as ParentEntityType | undefined;
  const op = pickOperation(tool, parentType ?? null);
  if (!op || op.method === "GET") return null;
  return op.method === "DELETE" ? "DELETE" : "POST";
}

function generatedDescription(tool: string, params: Record<string, unknown>): string {
  const id =
    params.contactId ??
    params.merchantAccountId ??
    params.attachedMerchantAccountId ??
    params.entityId ??
    params.parentId ??
    "";
  return id ? `${tool} (${String(id)})` : tool;
}

export function isWebMcpReadOnlyInvocation(tool: string, params: Record<string, unknown>): boolean {
  const schema = TOOL_SCHEMAS.find((entry) => entry.name === tool);
  if (!schema) return false;
  if (tool === "execute_workflow" && (params.dryRun === true || params.planOnly === true)) return true;
  if (schema.annotations?.readOnlyHint === true) return true;

  const allowedActions = WEBMCP_READ_ACTIONS[tool];
  if (!allowedActions) return false;
  const action = params.action;
  return typeof action === "string" && allowedActions.has(action);
}

export function buildWebMcpWritePreview(
  tool: string,
  params: Record<string, unknown>,
  env: Environment,
): WritePreview | null {
  if (isWebMcpReadOnlyInvocation(tool, params)) return null;

  const direct = describeMutatingCall(tool, params);
  if (direct) {
    return {
      tool,
      action: direct.action,
      method: direct.method,
      description: direct.description,
      params,
      env,
    };
  }

  if (tool === "execute_workflow") {
    return {
      tool,
      action: "execute",
      method: "POST",
      description: "Execute workflow script",
      params,
      env,
    };
  }

  if (tool === "attach_contact") {
    const id = params.contactId ? String(params.contactId) : "contact";
    const type = params.entityType ? String(params.entityType) : "entity";
    const entityId = params.entityId ? String(params.entityId) : "";
    return {
      tool,
      action: "attach",
      method: "POST",
      description: `Attach contact ${id} to ${type} ${entityId}`.trim(),
      params,
      env,
    };
  }

  const method = generatedOperationMethod(tool, params);
  if (!method) return null;

  return {
    tool,
    action: tool,
    method,
    description: generatedDescription(tool, params),
    params,
    env,
  };
}