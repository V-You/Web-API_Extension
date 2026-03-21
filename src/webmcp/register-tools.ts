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

import { getActiveEnv, getCredentials } from "../lib/storage";
import type { ApiCredentials, AuditEventType, Environment } from "../lib/types";

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

// -- Tool definitions -----------------------------------------------------

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
};

const TOOL_DEFS: ToolDef[] = [
  // 1. manage_entity
  {
    name: "manage_entity",
    description:
      "Manage payment hierarchy entities (PSP, division, merchant, channel). " +
      "Actions: get, search, list_children, create, edit, delete.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "search", "list_children", "create", "edit", "delete"],
          description: "The operation to perform.",
        },
        entityId: { type: "string", description: "Entity ID (for get, edit, delete)." },
        entityType: {
          type: "string",
          enum: ["psp", "division", "merchant", "channel"],
          description: "Entity type.",
        },
        namePath: {
          type: "string",
          description: "Slash-separated name path for search (e.g. 'MyPSP/MyDiv').",
        },
        parentId: { type: "string", description: "Parent entity ID (for list_children, create)." },
        parentType: {
          type: "string",
          enum: ["psp", "division", "merchant", "channel"],
          description: "Parent entity type.",
        },
        childType: {
          type: "string",
          enum: ["division", "merchant", "channel"],
          description: "Child type to list or create.",
        },
        fields: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Form fields for create or edit.",
        },
      },
      required: ["action"],
    },
    async execute(params) {
      const { creds, env } = await sessionOrError();
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
  },

  // 2. get_hierarchy
  {
    name: "get_hierarchy",
    description:
      "Fetch the entity hierarchy tree starting from a PSP. " +
      "Set estimateOnly=true to preview the number of API calls before executing.",
    inputSchema: {
      type: "object",
      properties: {
        pspId: { type: "string", description: "The PSP entity ID (root of the tree)." },
        depth: {
          type: "number",
          minimum: 1,
          maximum: 3,
          description: "Traversal depth: 1=divisions, 2=+merchants, 3=+channels. Default 3.",
        },
        estimateOnly: {
          type: "boolean",
          description: "If true, return call estimate without executing.",
        },
      },
      required: ["pspId"],
    },
    async execute(params) {
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
  },

  // 3. manage_contact
  {
    name: "manage_contact",
    description:
      "Manage contacts (users) on entities. " +
      "Actions: get, list, create, edit, delete, attach, detach, lock, unlock, reset_password, find_by_username.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "get", "list", "create", "edit", "delete",
            "attach", "detach", "lock", "unlock",
            "reset_password", "find_by_username",
          ],
          description: "The operation to perform.",
        },
        contactId: { type: "string", description: "Contact ID." },
        entityId: { type: "string", description: "Entity ID for context." },
        entityType: {
          type: "string",
          enum: ["psp", "division", "merchant", "channel"],
          description: "Entity type for context.",
        },
        scope: {
          type: "string",
          enum: ["owned", "attached"],
          description: "Contact scope for list (default: owned).",
        },
        fields: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Fields for create or edit.",
        },
        username: { type: "string", description: "Email for find_by_username." },
        newPassword: { type: "string", description: "New password for reset_password." },
      },
      required: ["action"],
    },
    async execute(params) {
      const { creds, env } = await sessionOrError();
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
  },

  // 4. manage_merchant_account
  {
    name: "manage_merchant_account",
    description:
      "Manage merchant accounts. " +
      "Actions: get, list, create, edit, delete, attach, detach, three_d_check.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "list", "create", "edit", "delete", "attach", "detach", "three_d_check"],
          description: "The operation to perform.",
        },
        merchantAccountId: { type: "string", description: "Merchant account ID." },
        entityId: { type: "string", description: "Entity ID for context." },
        entityType: {
          type: "string",
          enum: ["psp", "division", "merchant", "channel"],
          description: "Entity type for context.",
        },
        scope: {
          type: "string",
          enum: ["owned", "attached"],
          description: "MA scope for list (default: owned).",
        },
        fields: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Fields for create or edit.",
        },
        subTypes: {
          type: "string",
          description: "Sub-types for attach (comma-separated).",
        },
        currency: { type: "string", description: "Currency code for attach." },
        attachedMerchantAccountId: {
          type: "string",
          description: "Attached MA relationship ID for detach.",
        },
      },
      required: ["action"],
    },
    async execute(params) {
      const { creds, env } = await sessionOrError();
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
  },

  // 5. lookup_clearing_institutes
  {
    name: "lookup_clearing_institutes",
    description:
      "Search clearing institutes by keyword, get required field mappings for a CI, " +
      "or list live CIs from the API.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["search", "get_fields", "list_live"],
          description: "The operation to perform.",
        },
        query: { type: "string", description: "Search keyword (for search action)." },
        ciCode: { type: "string", description: "Exact CI code (for get_fields)." },
        pspId: { type: "string", description: "PSP ID (for list_live)." },
      },
      required: ["action"],
    },
    async execute(params) {
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
  },

  // 6. describe_settings
  {
    name: "describe_settings",
    description:
      "Search RiRo settings by keyword. Returns TypeScript interface snippets for " +
      "matching settings -- the type-on-demand pattern.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword to search for in setting keys and paths." },
        limit: {
          type: "number",
          description: "Max results to return (default: 20).",
          minimum: 1,
          maximum: 100,
        },
      },
      required: ["query"],
    },
    async execute(params) {
      return executeDescribeSettings({
        query: params.query as string,
        limit: params.limit as number | undefined,
      });
    },
  },

  // 7. manage_settings
  {
    name: "manage_settings",
    description:
      "Get or set RiRo settings on entities. " +
      "Actions: get, set, batch_get, batch_set, list_non_default.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "set", "batch_get", "batch_set", "list_non_default"],
          description: "The operation to perform.",
        },
        entityId: { type: "string", description: "Entity ID." },
        entityType: {
          type: "string",
          enum: ["psp", "division", "merchant", "channel"],
          description: "Entity type.",
        },
        key: { type: "string", description: "Setting key (flat RiRo key) for get/set." },
        value: { type: "string", description: "Value to set." },
        entityIds: {
          type: "array",
          items: { type: "string" },
          description: "Entity IDs for batch_get (all same type).",
        },
        keys: {
          type: "array",
          items: { type: "string" },
          description: "Setting keys for batch_get/batch_set.",
        },
        settings: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Key-value pairs for batch_set.",
        },
      },
      required: ["action"],
    },
    async execute(params) {
      const { creds, env } = await sessionOrError();
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
  },

  // 8. get_audit_log
  {
    name: "get_audit_log",
    description:
      "Retrieve entries from the local audit log. Supports filtering by event type, " +
      "entity ID, and time range.",
    inputSchema: {
      type: "object",
      properties: {
        eventType: {
          type: "string",
          enum: [
            "setting_change", "entity_create", "entity_delete",
            "contact_create", "contact_delete", "contact_lock",
            "contact_unlock", "contact_attach", "contact_detach",
            "contact_password_reset", "ma_create", "ma_update",
            "ma_attach", "ma_detach", "env_switch",
          ],
          description: "Filter by event type.",
        },
        entityId: { type: "string", description: "Filter by entity ID (substring match)." },
        limit: { type: "number", description: "Max entries to return (default: 50)." },
        since: { type: "string", description: "ISO timestamp -- only entries after this time." },
      },
    },
    async execute(params) {
      return executeGetAuditLog({
        eventType: params.eventType as AuditEventType | undefined,
        entityId: params.entityId as string | undefined,
        limit: params.limit as number | undefined,
        since: params.since as string | undefined,
      });
    },
  },

  // 9. execute_workflow
  {
    name: "execute_workflow",
    description:
      "Execute a TypeScript script in the local sandbox with the virtual SDK. " +
      "The agent writes code; this tool runs it locally. (Stub -- not yet implemented.)",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "TypeScript source code to execute." },
        entityId: { type: "string", description: "Entity context for the script." },
        entityType: {
          type: "string",
          enum: ["psp", "division", "merchant", "channel"],
          description: "Entity type for context.",
        },
        dryRun: {
          type: "boolean",
          description: "If true, validate only -- do not execute.",
        },
      },
      required: ["script"],
    },
    async execute(params) {
      return executeWorkflow({
        script: params.script as string,
        entityId: params.entityId as string | undefined,
        entityType: params.entityType as string | undefined,
        dryRun: params.dryRun as boolean | undefined,
      });
    },
  },
];

// -- Registration ---------------------------------------------------------

/**
 * Register all tools with the WebMCP runtime.
 * Returns true if registration succeeded, false if navigator.modelContext
 * is not available (e.g. WebMCP flag not enabled).
 */
export function registerAllTools(): boolean {
  if (!navigator.modelContext) {
    console.warn("[webmcp] navigator.modelContext not available -- tools not registered.");
    return false;
  }

  for (const def of TOOL_DEFS) {
    navigator.modelContext.registerTool({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      execute: async (params) => {
        try {
          const result = await def.execute(params);
          return typeof result === "string" ? result : JSON.stringify(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: msg });
        }
      },
    });
  }

  console.log(`[webmcp] Registered ${TOOL_DEFS.length} tools.`);
  return true;
}

/** Exported for testing -- the raw definitions array. */
export { TOOL_DEFS };
