/**
 * Pure-data tool schema definitions for WebMCP registration.
 *
 * This file is intentionally free of chrome, lib, bridge, or tool handler
 * imports so it can be safely imported from a main-world content script
 * (which has no access to extension APIs).
 */

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
  };
}

export const TOOL_SCHEMAS: ToolSchema[] = [
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
  },

  // 2. get_hierarchy
  {
    name: "get_hierarchy",
    description:
      "Fetch the entity hierarchy tree starting from a PSP. " +
      "Set estimateOnly=true to preview the number of API calls before executing.",
    annotations: { readOnlyHint: true },
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
  },

  // 5. lookup_clearing_institutes
  {
    name: "lookup_clearing_institutes",
    description:
      "Search clearing institutes by keyword, get required field mappings for a CI, " +
      "or list live CIs from the API.",
    annotations: { readOnlyHint: true },
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
  },

  // 6. describe_settings
  {
    name: "describe_settings",
    description:
      "Search RiRo settings by keyword. Returns TypeScript interface snippets for " +
      "matching settings -- the type-on-demand pattern.",
    annotations: { readOnlyHint: true },
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
  },

  // 8. get_audit_log
  {
    name: "get_audit_log",
    description:
      "Retrieve entries from the local audit log. Supports filtering by event type, " +
      "entity ID, and time range.",
    annotations: { readOnlyHint: true },
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
  },

  // 9. execute_workflow
  {
    name: "execute_workflow",
    description:
      "Execute a TypeScript/JS script in the local sandbox with the virtual SDK. " +
      "The agent writes code; this tool runs it locally. The script has access to " +
      "sdk.config, sdk.entities, sdk.contacts, sdk.merchantAccounts, sdk.hierarchy, " +
      "sdk.clearingInstitutes, sdk.audit, plus console, sleep(ms), results array, and context.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "TypeScript/JS source code to execute." },
        entityId: { type: "string", description: "Entity context for the script." },
        entityType: {
          type: "string",
          enum: ["psp", "division", "merchant", "channel"],
          description: "Entity type for context.",
        },
        dryRun: {
          type: "boolean",
          description: "If true, validate syntax only -- do not execute.",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds (default: 600000 = 10 minutes).",
        },
      },
      required: ["script"],
    },
  },
];
