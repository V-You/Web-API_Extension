import { confirmIfMutating } from "../bridge/write-confirm-utils";
import type { EntityType } from "../lib/entity-types";
import { getActiveEnv, getCredentials } from "../lib/storage";
import type { ApiCredentials, AuditEventType, Environment } from "../lib/types";
import { executeDescribeSettings } from "./describe-settings";
import { executeGetAuditLog } from "./get-audit-log";
import { executeGetHierarchy } from "./get-hierarchy";
import { executeLookupClearingInstitutes } from "./lookup-clearing-institutes";
import { executeManageContact } from "./manage-contact";
import { executeManageEntity } from "./manage-entity";
import { executeManageMerchantAccount } from "./manage-merchant-account";
import { executeManageSettings } from "./manage-settings";
import { executeWorkflow } from "./execute-workflow";

export interface ToolSession {
  creds: ApiCredentials;
  env: Environment;
}

export type ExecuteFn = (params: Record<string, unknown>) => Promise<unknown>;

export interface ExecuteMapOptions {
  onWriteAccepted?: (description: string) => void;
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

export function createExecuteMap(options: ExecuteMapOptions = {}): Record<string, ExecuteFn> {
  return {
    manage_entity: async (params) => {
      const { creds, env } = await sessionOrError();
      const description = await confirmIfMutating("manage_entity", params, env);
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
      const { creds, env } = await sessionOrError();
      const description = await confirmIfMutating("manage_contact", params, env);
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
      const { creds, env } = await sessionOrError();
      const description = await confirmIfMutating("manage_merchant_account", params, env);
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
      const description = await confirmIfMutating("manage_settings", params, env);
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
      return executeWorkflow(
        {
          script: params.script as string,
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as string | undefined,
          dryRun: params.dryRun as boolean | undefined,
          timeoutMs: params.timeoutMs as number | undefined,
        },
        creds,
        env,
      );
    },
  };
}