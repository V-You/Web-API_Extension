/**
 * Isolated-world bridge -- receives tool calls from the main world and
 * executes them with full chrome API access (credentials, storage, fetch).
 *
 * Runs in the default isolated world. Credentials never cross the
 * postMessage boundary.
 *
 * On load, asks the service worker to inject the main-world registration
 * script via chrome.scripting.executeScript (bypasses page CSP).
 */

import { getActiveEnv, getCredentials } from "../src/lib/storage";
import type { ApiCredentials, AuditEventType, Environment } from "../src/lib/types";
import { confirmIfMutating } from "../src/bridge/write-confirm-utils";

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

// -- Request main-world injection from service worker ---------------------
// Uses chrome.scripting.executeScript with world: "MAIN" to bypass page CSP.

chrome.runtime.sendMessage({ type: "webmcp:inject-main" }, (resp) => {
  if (chrome.runtime.lastError) {
    console.error("[webmcp-bridge] Failed to request main-world injection:", chrome.runtime.lastError.message);
  } else if (resp && !resp.ok) {
    console.error("[webmcp-bridge] Main-world injection failed:", resp.error);
  } else {
    console.log("[webmcp-bridge] Main-world registration injected via service worker.");
  }
});
