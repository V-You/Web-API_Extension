import { requestConfirm, type WritePreview } from "../bridge/confirm-bridge";
import { confirmIfMutating, describeMutatingCall } from "../bridge/write-confirm-utils";
import type { EntityType } from "../lib/entity-types";
import { getActiveEnv, getCredentials } from "../lib/storage";
import type { ApiCredentials, AuditEventType, Environment } from "../lib/types";
import { executeTypedTool, isReadOnlyTool } from "./adapter";
import { executeDescribeSettings } from "./describe-settings";
import { executeGetAuditLog } from "./get-audit-log";
import { executeGetHierarchy } from "./get-hierarchy";
import { executeLookupClearingInstitutes } from "./lookup-clearing-institutes";
import { executeManageContact } from "./manage-contact";
import { executeManageEntity } from "./manage-entity";
import { executeManageMerchantAccount } from "./manage-merchant-account";
import { executeManageSettings } from "./manage-settings";
import { executeWorkflow } from "./execute-workflow";
import { describeOperation } from "./describe-operation";
import { MANIFEST } from "./manifest-helpers";

export interface ToolSession {
  creds: ApiCredentials;
  env: Environment;
}

export type ExecuteFn = (params: Record<string, unknown>) => Promise<unknown>;

export interface ExecuteMapOptions {
  onWriteAccepted?: (description: string) => void;
  bypassWriteConfirmation?: boolean;
}

export async function resolveSession(): Promise<ToolSession | null> {
  const env = await getActiveEnv();
  if (!env) return null;

  const creds = await getCredentials(env);
  if (!creds) return null;

  return { creds, env };
}

export async function sessionOrError(): Promise<ToolSession> {
  const session = await resolveSession();
  if (!session) {
    throw new Error("Session not unlocked. Open the side panel and enter your PIN first.");
  }

  return session;
}

function reportWriteAccepted(
  description: string | undefined,
  onWriteAccepted?: (description: string) => void,
) {
  if (description && onWriteAccepted) {
    onWriteAccepted(description);
  }
}

async function confirmOrDescribeIfMutating(
  tool: string,
  params: Record<string, unknown>,
  env: Environment,
  options: ExecuteMapOptions,
): Promise<string | undefined> {
  if (options.bypassWriteConfirmation) {
    return describeMutatingCall(tool, params)?.description;
  }
  return confirmIfMutating(tool, params, env);
}

async function confirmWorkflowIfNeeded(
  params: Record<string, unknown>,
  env: Environment,
  options: ExecuteMapOptions,
): Promise<boolean> {
  if (params.dryRun === true || params.planOnly === true) return false;
  if (options.bypassWriteConfirmation) return true;

  const preview: WritePreview = {
    tool: "execute_workflow",
    action: "execute",
    method: "POST",
    description: "Execute workflow script",
    params,
    env,
  };
  const choice = await requestConfirm(preview);
  if (choice === "cancel") throw new Error("Operation cancelled by user.");
  return true;
}

export function createExecuteMap(options: ExecuteMapOptions = {}): Record<string, ExecuteFn> {
  const map = buildHandwrittenExecuteMap(options);
  return registerGeneratedToolExecutors(map, options);
}

function buildHandwrittenExecuteMap(options: ExecuteMapOptions = {}): Record<string, ExecuteFn> {
  // Externally reachable umbrella actions (writes moved to per-action tools per Part-II P2-D1).
  const READ_ONLY_UMBRELLA_ACTIONS: Record<string, Set<string>> = {
    manage_entity: new Set(["get", "search", "list_children"]),
    manage_contact: new Set(["get", "list", "find_by_username"]),
    manage_merchant_account: new Set(["get", "list"]),
  };

  const guardReadOnly = (tool: string, action: unknown): void => {
    const allowed = READ_ONLY_UMBRELLA_ACTIONS[tool];
    if (!allowed) return;
    if (typeof action !== "string" || !allowed.has(action)) {
      throw new Error(
        `${tool} only supports read actions (${[...allowed].join(", ")}). ` +
          `For writes, use the dedicated per-action tools.`,
      );
    }
  };

  return {
    manage_entity: async (params) => {
      guardReadOnly("manage_entity", params.action);
      const { creds, env } = await sessionOrError();
      const description = await confirmOrDescribeIfMutating("manage_entity", params, env, options);
      const result = await executeManageEntity(
        {
          action: params.action as "get",
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as "psp" | undefined,
          namePath: params.namePath as string | undefined,
          parentId: params.parentId as string | undefined,
          parentType: params.parentType as "psp" | undefined,
          childType: params.childType as "division" | undefined,
          fields: params.fields as Record<string, string> | undefined,
        },
        creds,
        env,
      );
      reportWriteAccepted(description, options.onWriteAccepted);
      return result;
    },

    get_hierarchy: async (params) => {
      const { creds, env } = await sessionOrError();
      return executeGetHierarchy(
        {
          pspId: params.pspId as string | undefined,
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as EntityType | undefined,
          depth: params.depth as number | undefined,
          estimateOnly: params.estimateOnly as boolean | undefined,
        },
        creds,
        env,
      );
    },

    manage_contact: async (params) => {
      guardReadOnly("manage_contact", params.action);
      const { creds, env } = await sessionOrError();
      const description = await confirmOrDescribeIfMutating("manage_contact", params, env, options);
      const result = await executeManageContact(
        {
          action: params.action as "get",
          contactId: params.contactId as string | undefined,
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as "psp" | undefined,
          scope: params.scope as "owned" | "attached" | undefined,
          fields: params.fields as Record<string, string> | undefined,
          username: params.username as string | undefined,
          newPassword: params.newPassword as string | undefined,
        },
        creds,
        env,
      );
      reportWriteAccepted(description, options.onWriteAccepted);
      return result;
    },

    manage_merchant_account: async (params) => {
      guardReadOnly("manage_merchant_account", params.action);
      const { creds, env } = await sessionOrError();
      const description = await confirmOrDescribeIfMutating("manage_merchant_account", params, env, options);
      const result = await executeManageMerchantAccount(
        {
          action: params.action as "get",
          merchantAccountId: params.merchantAccountId as string | undefined,
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as "psp" | undefined,
          scope: params.scope as "owned" | "attached" | undefined,
          fields: params.fields as Record<string, string> | undefined,
          subTypes: params.subTypes as string | undefined,
          currency: params.currency as string | undefined,
          attachedMerchantAccountId: params.attachedMerchantAccountId as string | undefined,
        },
        creds,
        env,
      );
      reportWriteAccepted(description, options.onWriteAccepted);
      return result;
    },

    lookup_clearing_institutes: async (params) => {
      const { creds, env } = await sessionOrError();
      return executeLookupClearingInstitutes(
        {
          action: params.action as "search",
          query: params.query as string | undefined,
          ciCode: params.ciCode as string | undefined,
          pspId: params.pspId as string | undefined,
        },
        creds,
        env,
      );
    },

    describe_settings: async (params) => {
      return executeDescribeSettings({
        query: params.query as string,
        limit: params.limit as number | undefined,
      });
    },

    manage_settings: async (params) => {
      const { creds, env } = await sessionOrError();
      const description = await confirmOrDescribeIfMutating("manage_settings", params, env, options);
      const result = await executeManageSettings(
        {
          action: params.action as "get",
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as "psp" | undefined,
          key: params.key as string | undefined,
          value: params.value as string | undefined,
          entityIds: params.entityIds as string[] | undefined,
          keys: params.keys as string[] | undefined,
          settings: params.settings as Record<string, string> | undefined,
          query: params.query as string | undefined,
        },
        creds,
        env,
      );
      reportWriteAccepted(description, options.onWriteAccepted);
      return result;
    },

    get_audit_log: async (params) => {
      return executeGetAuditLog({
        eventType: params.eventType as AuditEventType | undefined,
        entityId: params.entityId as string | undefined,
        limit: params.limit as number | undefined,
        since: params.since as string | undefined,
      });
    },

    execute_workflow: async (params) => {
      const { creds, env } = await sessionOrError();
      const autoConfirmWrites = await confirmWorkflowIfNeeded(params, env, options);
      return executeWorkflow(
        {
          script: params.script as string,
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as string | undefined,
          dryRun: params.dryRun as boolean | undefined,
          planOnly: params.planOnly as boolean | undefined,
          timeoutMs: params.timeoutMs as number | undefined,
          autoConfirmWrites,
        },
        creds,
        env,
      );
    },

    describe_operation: async (params) => {
      return describeOperation({ toolName: params.toolName as string | undefined });
    },
  };
}

/**
 * Register each generated per-action tool (from the manifest) onto an
 * existing execute-map. Typed writes go through the adapter which
 * enforces required-field tiers, rejects unknown fields, coerces values,
 * and routes destructive calls through the confirm bridge.
 */
export function registerGeneratedToolExecutors(
  map: Record<string, ExecuteFn>,
  options: ExecuteMapOptions = {},
): Record<string, ExecuteFn> {
  const handwrittenOverrides = new Set<string>(Object.keys(map));
  const ignoredByWebMcp = new Set<string>(["list_clearing_institutes"]);

  for (const toolName of MANIFEST.tools) {
    if (handwrittenOverrides.has(toolName)) continue;
    if (ignoredByWebMcp.has(toolName)) continue;

    map[toolName] = async (params) => {
      const { creds, env } = await sessionOrError();
      return executeTypedTool(toolName, params, {
        creds,
        env,
        confirm: options.bypassWriteConfirmation === true,
        onWriteAccepted: isReadOnlyTool(toolName) ? undefined : options.onWriteAccepted,
      });
    };
  }

  return map;
}