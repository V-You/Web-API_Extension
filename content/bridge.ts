/**
 * Isolated-world bridge -- receives tool calls from the main world and
 * executes them with full chrome API access (credentials, storage, fetch).
 *
 * Runs in the default isolated world. Credentials never cross the
 * postMessage boundary.
 */

import { getActiveEnv, getCredentials } from "../src/lib/storage";
import type { ApiCredentials, AuditEventType, Environment } from "../src/lib/types";
import { requestConfirm, type WritePreview } from "../src/bridge/confirm-bridge";

import { executeManageEntity } from "../src/tools/manage-entity";
import { executeGetHierarchy } from "../src/tools/get-hierarchy";
import { executeManageContact } from "../src/tools/manage-contact";
import { executeManageMerchantAccount } from "../src/tools/manage-merchant-account";
import { executeLookupClearingInstitutes } from "../src/tools/lookup-clearing-institutes";
import { executeDescribeSettings } from "../src/tools/describe-settings";
import { executeManageSettings } from "../src/tools/manage-settings";
import { executeGetAuditLog } from "../src/tools/get-audit-log";
import { executeWorkflow } from "../src/tools/execute-workflow";

// -- Credential helper ----------------------------------------------------

async function resolveSession(): Promise<{
  creds: ApiCredentials;
  env: Environment;
} | null> {
  const env = await getActiveEnv();
  if (!env) return null;
  const creds = await getCredentials(env);
  if (!creds) return null;
  return { creds, env };
}

function sessionOrError() {
  return resolveSession().then((s) => {
    if (!s) throw new Error("Session not unlocked. Open the side panel and enter your PIN first.");
    return s;
  });
}

// -- Write confirmation ---------------------------------------------------

const MUTATING_ACTIONS: Record<string, Set<string>> = {
  manage_entity: new Set(["create", "edit", "delete"]),
  manage_contact: new Set(["create", "edit", "delete", "attach", "detach", "lock", "unlock", "reset_password"]),
  manage_merchant_account: new Set(["create", "edit", "delete", "attach", "detach"]),
  manage_settings: new Set(["set", "batch_set"]),
};

function httpMethod(action: string): "POST" | "DELETE" {
  return action === "delete" || action === "detach" ? "DELETE" : "POST";
}

function describeDirectWrite(tool: string, action: string, params: Record<string, unknown>): string {
  const id = (params.entityId ?? params.contactId ?? params.merchantAccountId ?? params.attachedMerchantAccountId ?? "") as string;
  const type = (params.entityType ?? "") as string;
  switch (tool) {
    case "manage_entity":
      if (action === "create") return `Create ${params.childType ?? "entity"} under ${params.parentType} ${params.parentId}`;
      if (action === "delete") return `Delete ${type} ${id}`;
      return `Edit ${type} ${id}`;
    case "manage_contact":
      if (action === "create") return `Create contact on ${type} ${id}`;
      if (action === "lock") return `Lock contact ${params.contactId}`;
      if (action === "unlock") return `Unlock contact ${params.contactId}`;
      if (action === "reset_password") return `Reset password for contact ${params.contactId}`;
      if (action === "attach") return `Attach contact ${params.contactId} to ${type} ${id}`;
      if (action === "detach") return `Detach contact ${params.contactId} from ${type} ${id}`;
      if (action === "delete") return `Delete contact ${params.contactId}`;
      return `Edit contact ${params.contactId}`;
    case "manage_merchant_account":
      if (action === "create") return `Create merchant account on ${type} ${id}`;
      if (action === "attach") return `Attach merchant account to ${type} ${id}`;
      if (action === "detach") return `Detach merchant account ${params.attachedMerchantAccountId}`;
      if (action === "delete") return `Delete merchant account ${params.merchantAccountId}`;
      return `Edit merchant account ${params.merchantAccountId}`;
    case "manage_settings":
      if (action === "set") return `Set setting ${params.key} on ${type} ${id}`;
      return `Batch set ${Object.keys((params.settings as Record<string, unknown>) ?? {}).length} setting(s) on ${type} ${id}`;
    default:
      return `${action} on ${tool}`;
  }
}

async function confirmIfMutating(tool: string, params: Record<string, unknown>, env: Environment) {
  const actions = MUTATING_ACTIONS[tool];
  if (!actions) return;
  const action = params.action as string;
  if (!actions.has(action)) return;

  const preview: WritePreview = {
    tool,
    action,
    method: httpMethod(action),
    description: describeDirectWrite(tool, action, params),
    params,
    env,
  };
  const choice = await requestConfirm(preview);
  if (choice === "cancel") throw new Error("Operation cancelled by user.");
}

// -- Tool execution routing -----------------------------------------------

type ExecuteFn = (params: Record<string, unknown>) => Promise<unknown>;

const EXECUTE_MAP: Record<string, ExecuteFn> = {
  manage_entity: async (params) => {
    const { creds, env } = await sessionOrError();
    await confirmIfMutating("manage_entity", params, env);
    return executeManageEntity(
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
  },

  get_hierarchy: async (params) => {
    const { creds, env } = await sessionOrError();
    return executeGetHierarchy(
      {
        pspId: params.pspId as string,
        depth: params.depth as number | undefined,
        estimateOnly: params.estimateOnly as boolean | undefined,
      },
      creds,
      env,
    );
  },

  manage_contact: async (params) => {
    const { creds, env } = await sessionOrError();
    await confirmIfMutating("manage_contact", params, env);
    return executeManageContact(
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
  },

  manage_merchant_account: async (params) => {
    const { creds, env } = await sessionOrError();
    await confirmIfMutating("manage_merchant_account", params, env);
    return executeManageMerchantAccount(
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
    await confirmIfMutating("manage_settings", params, env);
    return executeManageSettings(
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

// -- Message listener (main world -> isolated world) ----------------------

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== "webmcp:tool-call") return;

  const { callId, tool, params } = data as {
    callId: string;
    tool: string;
    params: Record<string, unknown>;
  };

  const handler = EXECUTE_MAP[tool];
  if (!handler) {
    window.postMessage({ type: "webmcp:tool-result", callId, error: `Unknown tool: ${tool}` }, "*");
    return;
  }

  try {
    const result = await handler(params);
    const serialized = typeof result === "string" ? result : JSON.stringify(result);
    window.postMessage({ type: "webmcp:tool-result", callId, result: serialized }, "*");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    window.postMessage({ type: "webmcp:tool-result", callId, error: msg }, "*");
  }
});

console.log(
  `[webmcp-bridge] Isolated-world bridge ready (built ${__BUILD_TIMESTAMP__}). ` +
  `URL: ${location.href}`,
);
