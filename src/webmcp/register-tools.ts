/**
 * WebMCP tool registration.
 *
 * Registers all 9 tools via navigator.modelContext.registerTool().
 * Each execute callback resolves credentials from chrome.storage.session,
 * delegates to the corresponding tool handler, and returns the result.
 *
 * Call registerAllTools() once when the extension initialises (side panel mount).
 * Returns false if WebMCP is not available.
 */

import "../webmcp/webmcp.d.ts";

import { TOOL_SCHEMAS } from "./tool-schemas";
import { getActiveEnv, getCredentials } from "../lib/storage";
import type { ApiCredentials, AuditEventType, Environment } from "../lib/types";
import { requestConfirm, type WritePreview } from "../bridge/confirm-bridge";

import { executeManageEntity } from "../tools/manage-entity";
import { executeGetHierarchy } from "../tools/get-hierarchy";
import { executeManageContact } from "../tools/manage-contact";
import { executeManageMerchantAccount } from "../tools/manage-merchant-account";
import { executeLookupClearingInstitutes } from "../tools/lookup-clearing-institutes";
import { executeDescribeSettings } from "../tools/describe-settings";
import { executeManageSettings } from "../tools/manage-settings";
import { executeGetAuditLog } from "../tools/get-audit-log";
import { executeWorkflow } from "../tools/execute-workflow";

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

// -- Write confirmation for direct tool calls -----------------------------

/** Actions that mutate data, keyed by tool name. */
const MUTATING_ACTIONS: Record<string, Set<string>> = {
  manage_entity: new Set(["create", "edit", "delete"]),
  manage_contact: new Set(["create", "edit", "delete", "attach", "detach", "lock", "unlock", "reset_password"]),
  manage_merchant_account: new Set(["create", "edit", "delete", "attach", "detach"]),
  manage_settings: new Set(["set", "batch_set"]),
};

/** HTTP methods for mutating actions. */
function httpMethod(action: string): "POST" | "DELETE" {
  return action === "delete" || action === "detach" ? "DELETE" : "POST";
}

/** Build a human-readable description for a direct tool call. */
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

/**
 * Check whether a tool call is mutating; if so, request user confirmation.
 * Throws if the user cancels.
 */
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

// -- Tool definitions -----------------------------------------------------
// Schemas (name, description, inputSchema) are imported from tool-schemas.ts.
// Here we only define the execute callbacks and zip them with the schemas.

type ExecuteFn = (params: Record<string, unknown>) => Promise<unknown>;

/** Execute callbacks keyed by tool name. */
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

/** Combined tool definitions (schema + execute). */
const TOOL_DEFS = TOOL_SCHEMAS.map((schema) => ({
  ...schema,
  execute: EXECUTE_MAP[schema.name],
}));

// -- Registration ---------------------------------------------------------

let registered = false;

/**
 * Attempt to register all tools with the WebMCP runtime.
 * Returns true if registration succeeded or was already done.
 */
function tryRegister(): boolean {
  if (registered) return true;
  if (!navigator.modelContext) return false;

  for (const def of TOOL_DEFS) {
    navigator.modelContext.registerTool({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      ...(def.annotations ? { annotations: def.annotations } : {}),
      execute: async (input, _client) => {
        try {
          const result = await def.execute(input);
          return typeof result === "string" ? result : JSON.stringify(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: msg });
        }
      },
    });
  }

  registered = true;
  console.log(`[webmcp] Registered ${TOOL_DEFS.length} tools.`);
  return true;
}

const RETRY_INTERVAL_MS = 2_000;
const MAX_RETRIES = 15; // 30 seconds total

/**
 * Register all tools with retry logic.
 *
 * navigator.modelContext may not be available immediately on page load
 * (Chrome injects it asynchronously). This retries every 2 seconds for
 * up to 30 seconds, and also retries on visibility changes.
 */
export function registerAllTools(): boolean {
  if (tryRegister()) return true;

  console.warn("[webmcp] navigator.modelContext not yet available -- will retry.");

  let retries = 0;
  const interval = setInterval(() => {
    retries++;
    if (tryRegister() || retries >= MAX_RETRIES) {
      clearInterval(interval);
      if (!registered) {
        console.warn("[webmcp] Gave up waiting for navigator.modelContext after retries.");
      }
    }
  }, RETRY_INTERVAL_MS);

  // Also try when the page becomes visible (side panel may open later)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !registered) {
      tryRegister();
    }
  });

  return false;
}

/** Whether tools have been successfully registered. */
export function isRegistered(): boolean {
  return registered;
}

/** Exported for testing -- the raw definitions array. */
export { TOOL_DEFS };
