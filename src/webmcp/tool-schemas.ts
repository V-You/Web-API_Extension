/**
 * Pure-data tool schema definitions for WebMCP registration.
 *
 * This file is intentionally free of chrome, lib, bridge, or tool handler
 * imports so it can be safely imported from a main-world content script
 * (which has no access to extension APIs).
 *
 * The handwritten tool entries declared below are concatenated with the
 * generated per-action tool schemas (from the operation manifest) in
 * `GENERATED_TOOL_SCHEMAS` to form the published inventory.
 */

export interface ToolSchema {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
  };
}

// Imported after the interface so the generated module can re-use the type.
// The import is type-safe for main-world use: GENERATED_TOOL_SCHEMAS only
// depends on the committed manifest JSON and a tiny pure-data helpers module.
import { GENERATED_TOOL_SCHEMAS } from "./generated-tool-schemas";
// Part-II P2-D4: AUDIT_EVENT_TYPES is pure data generated from the manifest;
// main-world-safe (no chrome, lib, or bridge imports).
import { AUDIT_EVENT_TYPES } from "../../src_data/webapi-audit-events";

const HANDWRITTEN_TOOL_SCHEMAS: ToolSchema[] = [
  // 1. manage_entity -- read-only umbrella (writes are in the generated per-action tools:
  // create_division, create_merchant, create_channel, edit_entity, delete_entity).
  {
    name: "manage_entity",
    title: "Manage entity (read-only)",
    description:
      "Read payment hierarchy entities (PSP, division, merchant, channel). " +
      "For channels, get returns the Web API channelInfo payload, which may include accessToken, login, pwd, and secret when the API exposes them. " +
      "Actions: get, search, list_children. For writes, use the dedicated per-action tools " +
      "(create_division, create_merchant, create_channel, edit_entity, delete_entity).",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "search", "list_children"],
          description: "The read operation to perform.",
        },
        entityId: { type: "string", description: "Entity ID (for get)." },
        entityType: {
          type: "string",
          enum: ["psp", "division", "merchant", "channel"],
          description: "Entity type.",
        },
        namePath: {
          type: "string",
          description: "Slash-separated name path for search (e.g. 'MyPSP/MyDiv').",
        },
        parentId: { type: "string", description: "Parent entity ID (for list_children)." },
        parentType: {
          type: "string",
          enum: ["psp", "division", "merchant", "channel"],
          description: "Parent entity type.",
        },
        childType: {
          type: "string",
          enum: ["division", "merchant", "channel"],
          description: "Child type to list.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },

  // 2. get_hierarchy
  {
    name: "get_hierarchy",
    title: "Get hierarchy",
    description:
      "Fetch the entity hierarchy tree starting from a PSP, division, merchant, or channel. " +
      "Set estimateOnly=true to preview the number of API calls before executing.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        pspId: { type: "string", description: "Legacy PSP root ID. Use entityId + entityType for any root." },
        entityId: { type: "string", description: "Root entity ID for psp, division, merchant, or channel traversal." },
        entityType: {
          type: "string",
          enum: ["psp", "division", "merchant", "channel"],
          description: "Root entity type for the hierarchy traversal.",
        },
        depth: {
          type: "number",
          minimum: 1,
          maximum: 3,
          description: "Traversal depth below the selected root: 1=direct children, 2=+grandchildren, 3=max available depth. Default 3.",
        },
        estimateOnly: {
          type: "boolean",
          description: "If true, return call estimate without executing.",
        },
        includeDisabled: {
          type: "boolean",
          description: "If true, include entities with state DISABLED instead of hiding them by default.",
        },
      },
      additionalProperties: false,
    },
  },

  // 3. manage_contact -- read-only umbrella (writes are in the generated per-action tools:
  // create_contact, edit_contact, delete_contact, detach_contact, lock_contact, unlock_contact,
  // set_contact_password).
  {
    name: "manage_contact",
    title: "Manage contact (read-only)",
    description:
      "Read contacts (users) on entities. " +
      "Actions: get, list, find_by_username. For writes, use the dedicated per-action tools " +
      "(create_contact, edit_contact, delete_contact, detach_contact, lock_contact, " +
      "unlock_contact, set_contact_password).",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "list", "find_by_username"],
          description: "The read operation to perform.",
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
        username: { type: "string", description: "Email for find_by_username." },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },

  // 4. manage_merchant_account -- read-only umbrella (writes are in the generated per-action tools:
  // create_merchant_account, edit_merchant_account, delete_merchant_account,
  // attach_merchant_account, detach_merchant_account).
  {
    name: "manage_merchant_account",
    title: "Manage merchant account (read-only)",
    description:
      "Read merchant accounts. " +
      "Actions: get, list. For writes, use the dedicated per-action tools " +
      "(create_merchant_account, edit_merchant_account, delete_merchant_account, " +
      "attach_merchant_account, detach_merchant_account).",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "list"],
          description: "The read operation to perform.",
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
      },
      required: ["action"],
      additionalProperties: false,
    },
  },

  // 5. lookup_clearing_institutes
  {
    name: "lookup_clearing_institutes",
    title: "Lookup clearing institutes",
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
      additionalProperties: false,
    },
  },

  // 6. describe_settings
  {
    name: "describe_settings",
    title: "Describe settings",
    description:
      "Search RiRo settings by keyword, setting shortcode, or glossary and family alias. Returns TypeScript interface snippets for " +
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
      additionalProperties: false,
    },
  },

  // 7. manage_settings
  {
    name: "manage_settings",
    title: "Manage settings",
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
        query: {
          type: "string",
          description: "Keyword filter for list_non_default when exact keys are not known.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },

  // 8. get_audit_log
  {
    name: "get_audit_log",
    title: "Get audit log",
    description:
      "Retrieve entries from the local audit log. Supports filtering by event type, " +
      "entity ID, and time range.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        eventType: {
          type: "string",
          // Part-II P2-D4: API-backed values come from the generated
          // manifest-derived list; extension-only events are appended.
          enum: [
            ...AUDIT_EVENT_TYPES,
            "setting_change",
            "env_switch",
            "contact_attach",
            "get_entity",
          ],
          description: "Filter by event type.",
        },
        entityId: { type: "string", description: "Filter by entity ID (substring match)." },
        limit: { type: "number", description: "Max entries to return (default: 50)." },
        since: { type: "string", description: "ISO timestamp -- only entries after this time." },
      },
      additionalProperties: false,
    },
  },

  // 9. execute_workflow
  {
    name: "execute_workflow",
    title: "Execute workflow",
    description:
      "Start a background Job that executes a TypeScript/JS script in the local sandbox with the virtual SDK. " +
      "Use this for repeated writes and backend batch work instead of calling write tools one by one. " +
      "For real runs, this tool returns a Job receipt immediately; use get_job_status with the returned jobId to poll progress and retrieve final results. " +
      "The agent writes code; the extension runs it locally. The script has access to " +
      "sdk.config, sdk.entities, sdk.contacts, sdk.merchantAccounts, sdk.hierarchy, " +
      "sdk.clearingInstitutes, sdk.audit, plus console, sleep(ms), results array, and context.",
    inputSchema: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "TypeScript/JS source code to execute, or a JSON declarative workflow with a calls array for CSP-safe backend batches.",
        },
        entityId: { type: "string", description: "Entity context for the script." },
        entityType: {
          type: "string",
          enum: ["psp", "division", "merchant", "channel"],
          description: "Entity type for context.",
        },
        label: {
          type: "string",
          description: "Optional human-readable Job label shown in the Jobs tab.",
        },
        totalCalls: {
          type: "number",
          minimum: 1,
          description: "Optional estimated API call count for Jobs tab progress and runtime estimate.",
        },
        dryRun: {
          type: "boolean",
          description: "If true, validate syntax only -- do not execute.",
        },
        planOnly: {
          type: "boolean",
          description: "If true, execute locally and record planned writes without mutating backend state.",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds (default: 600000 = 10 minutes).",
        },
      },
      required: ["script"],
      additionalProperties: false,
    },
  },

  // 10. get_job_status
  {
    name: "get_job_status",
    title: "Get job status",
    description:
      "Read the status of a background Job started by execute_workflow or the Chat Draft Job flow. " +
      "Use this after execute_workflow returns a jobId. By default it returns state, progress, timestamps, error, and result counts; set includeDetails=true to include logs, writes, results, and script.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Job ID returned by execute_workflow." },
        includeDetails: {
          type: "boolean",
          description: "If true, include script, logs, writes, and results. Default false.",
        },
      },
      required: ["jobId"],
      additionalProperties: false,
    },
  },

  // 11. describe_operation
  {
    name: "describe_operation",
    title: "Describe operation",
    description:
      "Return the generated manifest entry for a typed Web API operation tool, " +
      "including HTTP method, path template, required fields, patterns, enums, " +
      "and conditional triggers. Use this to self-correct before invoking a write tool.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        toolName: {
          type: "string",
          description: "Logical tool name, e.g. create_contact, attach_merchant_account, create_division.",
        },
      },
      required: ["toolName"],
      additionalProperties: false,
    },
  },
];

/**
 * Full published WebMCP inventory: 11 handwritten umbrellas + generated
 * per-action write/read tools derived from the operation manifest.
 */
export const TOOL_SCHEMAS: ToolSchema[] = [
  ...HANDWRITTEN_TOOL_SCHEMAS,
  ...GENERATED_TOOL_SCHEMAS,
];

export { HANDWRITTEN_TOOL_SCHEMAS };
