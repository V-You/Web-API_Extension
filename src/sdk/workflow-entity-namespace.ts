import type { EntityType } from "../lib/entity-types";
import { ENTITY_PLURAL } from "../lib/entity-types";
import { extractEntityCollection } from "../lib/api-shapes";
import { normalizeListResult } from "../lib/list-contract";
import type { ApiCredentials, Environment } from "../lib/types";
import { executeManageEntity, type ManageEntityInput } from "../tools/manage-entity";
import { executeTypedTool } from "../tools/adapter";

type EntityChildType = "division" | "merchant" | "channel";
type EntityWriteTransport = "typedTool" | "internalHandler";

export interface WorkflowWritePreview {
  tool: string;
  action: string;
  method: "POST" | "DELETE";
  entityId: string;
  entityType: string;
  description: string;
  params: Record<string, unknown>;
}

export interface WorkflowEntityNamespaceOptions {
  creds: ApiCredentials;
  env: Environment;
  /** Sandbox uses typed tools; SW jobs preserve the existing internal-handler path for this migration slice. */
  writeTransport: EntityWriteTransport;
  /** Called before a write. Sandbox confirms/records; SW validates target/records. */
  beforeWrite: (preview: WorkflowWritePreview) => Promise<void>;
  /** Sandbox dry-run path: record the write but do not mutate. */
  planOnlyWrites?: boolean;
  /** Sandbox returns get envelopes; SW historically unwraps get data. */
  mapGetResult?: (result: unknown) => unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function writeFailureMessage(result: Record<string, unknown>): string {
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

function assertOperationSucceeded<T>(result: T, description: string): T {
  if (!isRecord(result)) return result;
  const errors = Array.isArray(result.errors) ? result.errors.map(String).filter(Boolean) : [];
  if (errors.length > 0) throw new Error(`${description} failed: ${errors.join("; ")}`);
  if (result.ok === false) throw new Error(`${description} failed: ${writeFailureMessage(result)}`);
  if (typeof result.error === "string" && result.error.trim()) throw new Error(`${description} failed: ${result.error.trim()}`);
  return result;
}

function plannedResult(tool: string, params: Record<string, unknown>) {
  return { ok: true, status: 0, data: { planned: true, tool, params } };
}

function typedToolForCreate(childType: EntityChildType): string {
  return childType === "division"
    ? "create_division"
    : childType === "merchant"
      ? "create_merchant"
      : "create_channel";
}

function normalizeEntityListResult(result: unknown, childType: EntityChildType): Record<string, unknown>[] {
  if (isRecord(result)) {
    if (result.ok === false) throw new Error(`list ${childType} failed: ${writeFailureMessage(result)}`);
    if (typeof result.error === "string" && result.error.trim()) throw new Error(`list ${childType} failed: ${result.error.trim()}`);
  }

  const data = isRecord(result) && "data" in result ? result.data : result;
  const rows = (() => {
    const extracted = extractEntityCollection(childType, data);
    if (extracted.length > 0 || Array.isArray(data)) return extracted;
    return normalizeListResult(result, {
      label: `list ${childType}`,
      candidateKeys: [ENTITY_PLURAL[childType]],
    });
  })();

  return rows.map((item) => {
    const normalized = { ...item };
    const entityId = typeof normalized._entityId === "string" && normalized._entityId.trim()
      ? normalized._entityId
      : childType === "channel" && typeof normalized.channel === "string" && normalized.channel.trim()
        ? normalized.channel
        : null;
    if (entityId && typeof normalized.id !== "string") normalized.id = entityId;
    return normalized;
  });
}

async function executeEntityWrite(
  options: WorkflowEntityNamespaceOptions,
  typedToolName: string,
  typedParams: Record<string, unknown>,
  internalInput: ManageEntityInput,
  description: string,
) {
  if (options.planOnlyWrites) return plannedResult(typedToolName, typedParams);

  if (options.writeTransport === "typedTool") {
    return assertOperationSucceeded(
      await executeTypedTool(typedToolName, typedParams, { creds: options.creds, env: options.env, confirm: true }),
      typedToolName,
    );
  }

  return assertOperationSucceeded(
    await executeManageEntity(internalInput, options.creds, options.env),
    description,
  );
}

export function createWorkflowEntityNamespace(options: WorkflowEntityNamespaceOptions) {
  return {
    async get(entityType: EntityType, entityId: string) {
      const result = await executeManageEntity({ action: "get", entityType, entityId }, options.creds, options.env);
      return options.mapGetResult ? options.mapGetResult(result) : result;
    },

    async search(namePath: string) {
      return executeManageEntity({ action: "search", namePath }, options.creds, options.env);
    },

    async listChildren(parentType: EntityType, parentId: string, childType: EntityChildType) {
      return normalizeEntityListResult(
        await executeManageEntity({ action: "list_children", parentType, parentId, childType }, options.creds, options.env),
        childType,
      );
    },

    async create(parentType: EntityType, parentId: string, childType: EntityChildType, fields: Record<string, string>) {
      await options.beforeWrite({
        tool: "manage_entity",
        action: "create",
        method: "POST",
        entityId: parentId,
        entityType: parentType,
        description: `Create ${childType} under ${parentType} ${parentId}`,
        params: { childType, fields },
      });
      const toolName = typedToolForCreate(childType);
      const typedParams = { parentType, parentId, ...fields };
      return executeEntityWrite(
        options,
        toolName,
        typedParams,
        { action: "create", parentType, parentId, childType, fields },
        "entity create",
      );
    },

    async edit(entityType: EntityType, entityId: string, fields: Record<string, string>) {
      await options.beforeWrite({
        tool: "manage_entity",
        action: "edit",
        method: "POST",
        entityId,
        entityType,
        description: `Edit ${entityType} ${entityId}`,
        params: { fields },
      });
      const typedParams = { parentType: entityType, parentId: entityId, ...fields };
      return executeEntityWrite(
        options,
        "edit_entity",
        typedParams,
        { action: "edit", entityType, entityId, fields },
        "entity edit",
      );
    },

    async delete(entityType: EntityType, entityId: string) {
      await options.beforeWrite({
        tool: "manage_entity",
        action: "delete",
        method: "DELETE",
        entityId,
        entityType,
        description: `Delete ${entityType} ${entityId}`,
        params: {},
      });
      const typedParams = { parentType: entityType, parentId: entityId };
      return executeEntityWrite(
        options,
        "delete_entity",
        typedParams,
        { action: "delete", entityType, entityId },
        "entity delete",
      );
    },
  };
}

export type WorkflowEntityNamespace = ReturnType<typeof createWorkflowEntityNamespace>;
