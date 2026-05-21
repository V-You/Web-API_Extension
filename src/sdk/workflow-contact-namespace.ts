import type { EntityType } from "../lib/entity-types";
import { normalizeListResult, contactScopeKeys } from "../lib/list-contract";
import type { ApiCredentials, Environment } from "../lib/types";
import { executeManageContact, type ManageContactInput } from "../tools/manage-contact";
import { executeTypedTool } from "../tools/adapter";
import type { WorkflowWritePreview } from "./workflow-entity-namespace";

type ContactWriteTransport = "typedTool" | "internalHandler";

export interface WorkflowContactNamespaceOptions {
  creds: ApiCredentials;
  env: Environment;
  writeTransport: ContactWriteTransport;
  beforeWrite: (preview: WorkflowWritePreview) => Promise<void>;
  planOnlyWrites?: boolean;
  signal?: AbortSignal;
  throttleRate?: number;
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

async function executeContactWrite(
  options: WorkflowContactNamespaceOptions,
  typedToolName: string,
  typedParams: Record<string, unknown>,
  internalInput: ManageContactInput,
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
    await executeManageContact(internalInput, options.creds, options.env, {
      signal: options.signal,
      throttleRate: options.throttleRate,
    }),
    description,
  );
}

export function createWorkflowContactNamespace(options: WorkflowContactNamespaceOptions) {
  return {
    async get(contactId: string) {
      const result = await executeManageContact({ action: "get", contactId }, options.creds, options.env, {
        signal: options.signal,
        throttleRate: options.throttleRate,
      });
      return options.mapGetResult ? options.mapGetResult(result) : result;
    },

    async list(entityType: EntityType, entityId: string, scope?: "owned" | "attached") {
      return normalizeListResult(
        await executeManageContact({ action: "list", entityType, entityId, scope }, options.creds, options.env, {
          signal: options.signal,
          throttleRate: options.throttleRate,
        }),
        { label: `list contacts on ${entityType} ${entityId}`, candidateKeys: contactScopeKeys(scope) },
      );
    },

    async create(entityType: EntityType, entityId: string, fields: Record<string, string>) {
      await options.beforeWrite({
        tool: "manage_contact",
        action: "create",
        method: "POST",
        entityId,
        entityType,
        description: `Create contact on ${entityType} ${entityId}`,
        params: { fields },
      });
      const typedParams = { parentType: entityType, parentId: entityId, ...fields };
      return executeContactWrite(
        options,
        "create_contact",
        typedParams,
        { action: "create", entityType, entityId, fields },
        "contact create",
      );
    },

    async edit(contactId: string, fields: Record<string, string>) {
      await options.beforeWrite({
        tool: "manage_contact",
        action: "edit",
        method: "POST",
        entityId: contactId,
        entityType: "contact",
        description: `Edit contact ${contactId}`,
        params: { fields },
      });
      return executeContactWrite(
        options,
        "edit_contact",
        { contactId, ...fields },
        { action: "edit", contactId, fields },
        "contact edit",
      );
    },

    async delete(contactId: string) {
      await options.beforeWrite({
        tool: "manage_contact",
        action: "delete",
        method: "DELETE",
        entityId: contactId,
        entityType: "contact",
        description: `Delete contact ${contactId}`,
        params: {},
      });
      return executeContactWrite(
        options,
        "delete_contact",
        { contactId },
        { action: "delete", contactId },
        "contact delete",
      );
    },

    async attach(entityType: EntityType, entityId: string, contactId: string) {
      await options.beforeWrite({
        tool: "manage_contact",
        action: "attach",
        method: "POST",
        entityId,
        entityType,
        description: `Attach contact ${contactId} to ${entityType} ${entityId}`,
        params: { contactId },
      });
      // No generated per-action tool exists for attach; both lifecycle modes use the internal handler.
      if (options.planOnlyWrites) return plannedResult("manage_contact", { action: "attach", entityType, entityId, contactId });
      return assertOperationSucceeded(
        await executeManageContact({ action: "attach", entityType, entityId, contactId }, options.creds, options.env, {
          signal: options.signal,
          throttleRate: options.throttleRate,
        }),
        "contact attach",
      );
    },

    async detach(entityType: EntityType, entityId: string, contactId: string) {
      await options.beforeWrite({
        tool: "manage_contact",
        action: "detach",
        method: "DELETE",
        entityId,
        entityType,
        description: `Detach contact ${contactId} from ${entityType} ${entityId}`,
        params: { contactId },
      });
      return executeContactWrite(
        options,
        "detach_contact",
        { parentType: entityType, parentId: entityId, contactId },
        { action: "detach", entityType, entityId, contactId },
        "contact detach",
      );
    },

    async lock(contactId: string) {
      await options.beforeWrite({
        tool: "manage_contact",
        action: "lock",
        method: "POST",
        entityId: contactId,
        entityType: "contact",
        description: `Lock contact ${contactId}`,
        params: {},
      });
      return executeContactWrite(options, "lock_contact", { contactId }, { action: "lock", contactId }, "contact lock");
    },

    async unlock(contactId: string) {
      await options.beforeWrite({
        tool: "manage_contact",
        action: "unlock",
        method: "POST",
        entityId: contactId,
        entityType: "contact",
        description: `Unlock contact ${contactId}`,
        params: {},
      });
      return executeContactWrite(options, "unlock_contact", { contactId }, { action: "unlock", contactId }, "contact unlock");
    },

    async resetPassword(contactId: string, newPassword?: string) {
      await options.beforeWrite({
        tool: "manage_contact",
        action: "reset_password",
        method: "POST",
        entityId: contactId,
        entityType: "contact",
        description: `Reset password for contact ${contactId}`,
        params: {},
      });
      return executeContactWrite(
        options,
        "set_contact_password",
        { contactId },
        { action: "reset_password", contactId, newPassword },
        "contact password reset",
      );
    },
  };
}

export type WorkflowContactNamespace = ReturnType<typeof createWorkflowContactNamespace>;
