/**
 * Isolated-world bridge -- receives tool calls from the main world and
 * executes them with full chrome API access (credentials, storage, fetch).
 *
 * Runs in the default isolated world. Credentials never cross the
 * postMessage boundary.
 *
 * Also injects the main-world registration script via a <script> element
 * so Extension.js's HMR/reloader code (which needs chrome.runtime) is
 * never loaded in the main world.
 */

import { TOOL_SCHEMAS } from "../src/webmcp/tool-schemas";
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

// -- Build timestamp (DefinePlugin may not apply to content scripts) ------

let buildTs = "unknown";
try { buildTs = __BUILD_TIMESTAMP__; } catch { /* not replaced by DefinePlugin */ }

console.log(
  `[webmcp-bridge] Isolated-world bridge ready (built ${buildTs}). URL: ${location.href}`,
);

// -- Inject main-world tool registration ----------------------------------
// We inject via <script> so Extension.js's HMR wrapper (which requires
// chrome.runtime) is never loaded in the main world.

function injectMainWorldRegistration() {
  const schemasJson = JSON.stringify(TOOL_SCHEMAS);
  const code = `(function() {
  var TOOL_SCHEMAS = ${schemasJson};
  var pending = new Map();
  var CALL_TIMEOUT_MS = 600000;
  var registered = false;
  var RETRY_MS = 2000;
  var MAX_RETRIES = 15;

  window.addEventListener("message", function(event) {
    if (event.source !== window) return;
    var d = event.data;
    if (!d || d.type !== "webmcp:tool-result") return;
    var entry = pending.get(d.callId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(d.callId);
    if (d.error) entry.reject(new Error(d.error));
    else entry.resolve(d.result || "{}");
  });

  function tryRegister() {
    if (registered) return true;
    if (!navigator.modelContext) return false;
    TOOL_SCHEMAS.forEach(function(schema) {
      navigator.modelContext.registerTool({
        name: schema.name,
        description: schema.description,
        inputSchema: schema.inputSchema,
        execute: function(params) {
          var callId = crypto.randomUUID();
          return new Promise(function(resolve, reject) {
            var timer = setTimeout(function() {
              pending.delete(callId);
              reject(new Error("Tool " + schema.name + " timed out."));
            }, CALL_TIMEOUT_MS);
            pending.set(callId, { resolve: resolve, reject: reject, timer: timer });
            window.postMessage({ type: "webmcp:tool-call", callId: callId, tool: schema.name, params: params }, "*");
          });
        }
      });
    });
    registered = true;
    console.log("[webmcp-main] Registered " + TOOL_SCHEMAS.length + " tools in main world.");
    return true;
  }

  console.log("[webmcp-main] Injected. modelContext: " + !!navigator.modelContext);

  if (!tryRegister()) {
    console.warn("[webmcp-main] navigator.modelContext not available yet -- retrying...");
    var retries = 0;
    var interval = setInterval(function() {
      retries++;
      if (tryRegister() || retries >= MAX_RETRIES) {
        clearInterval(interval);
        if (!registered) {
          console.warn("[webmcp-main] Gave up after " + MAX_RETRIES + " retries. " +
            "Ensure chrome://flags/#enable-webmcp-testing is Enabled and restart Chrome.");
        }
      }
    }, RETRY_MS);
    document.addEventListener("visibilitychange", function() {
      if (document.visibilityState === "visible" && !registered) tryRegister();
    });
  }
})();`;

  const script = document.createElement("script");
  script.textContent = code;
  (document.documentElement || document.head).appendChild(script);
  script.remove();
  console.log("[webmcp-bridge] Main-world registration script injected.");
}

injectMainWorldRegistration();
