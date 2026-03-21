/**
 * manage_settings tool handler.
 *
 * Actions: get, set, batch_get, batch_set, list_non_default.
 *
 * Endpoint patterns:
 *   GET /{plural}/{id}/setting?key={key}  -- get (merchant/channel only)
 *   POST /{plural}/{id}/setting           -- set (all entity levels)
 *
 * Quirks:
 *   - GET only works at merchant and channel level. PSP/division GET returns 404.
 *   - POST works at all levels (PSP, division, merchant, channel).
 *   - Settings follow inheritance: higher-level values cascade down.
 */

import { apiRequest } from "../lib/api-client";
import { type EntityType, ENTITY_PLURAL } from "../lib/entity-types";
import type { ApiCredentials, Environment } from "../lib/types";

export interface ManageSettingsInput {
  action: "get" | "set" | "batch_get" | "batch_set" | "list_non_default";
  entityId?: string;
  entityType?: EntityType;
  /** Setting key (flat RiRo key) for get/set. */
  key?: string;
  /** Value to set. */
  value?: string;
  /** For batch_get: list of entity IDs (all same type). */
  entityIds?: string[];
  /** For batch_get/batch_set: list of setting keys. */
  keys?: string[];
  /** For batch_set: key-value pairs. */
  settings?: Record<string, string>;
}

export async function executeManageSettings(
  input: ManageSettingsInput,
  creds: ApiCredentials,
  env: Environment
) {
  switch (input.action) {
    case "get":
      return getSetting(input, creds, env);
    case "set":
      return setSetting(input, creds, env);
    case "batch_get":
      return batchGet(input, creds, env);
    case "batch_set":
      return batchSet(input, creds, env);
    case "list_non_default":
      return listNonDefault(input, creds, env);
    default:
      return { error: `Unknown action: ${input.action}` };
  }
}

function settingPath(entityType: EntityType, entityId: string): string {
  return `/${ENTITY_PLURAL[entityType]}/${entityId}/setting`;
}

async function getSetting(
  input: ManageSettingsInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.entityId || !input.entityType) {
    return { error: "entityId and entityType are required for get." };
  }
  if (!input.key) return { error: "key is required for get." };

  // GET only works at merchant/channel
  if (input.entityType !== "merchant" && input.entityType !== "channel") {
    return {
      error: `GET setting only works at merchant/channel level (not ${input.entityType}). Use a child entity or POST to write at this level.`,
    };
  }

  return apiRequest(creds, env, {
    path: `${settingPath(input.entityType, input.entityId)}?key=${encodeURIComponent(input.key)}`,
  });
}

async function setSetting(
  input: ManageSettingsInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.entityId || !input.entityType) {
    return { error: "entityId and entityType are required for set." };
  }
  if (!input.key || input.value === undefined) {
    return { error: "key and value are required for set." };
  }

  return apiRequest(creds, env, {
    method: "POST",
    path: settingPath(input.entityType, input.entityId),
    params: { key: input.key, value: input.value },
  }, {
    eventType: "setting_change",
    entityId: input.entityId,
    entityType: input.entityType,
  });
}

async function batchGet(
  input: ManageSettingsInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.entityType) return { error: "entityType is required for batch_get." };
  if (!input.entityIds?.length) return { error: "entityIds are required for batch_get." };
  if (!input.keys?.length) return { error: "keys are required for batch_get." };

  if (input.entityType !== "merchant" && input.entityType !== "channel") {
    return { error: `Batch GET only works at merchant/channel level (not ${input.entityType}).` };
  }

  const results: Record<string, Record<string, unknown>> = {};

  for (const entityId of input.entityIds) {
    results[entityId] = {};
    for (const key of input.keys) {
      const res = await apiRequest(creds, env, {
        path: `${settingPath(input.entityType, entityId)}?key=${encodeURIComponent(key)}`,
      });
      results[entityId][key] = res.ok ? res.data : { error: res.status };
    }
  }

  return {
    entityType: input.entityType,
    entityCount: input.entityIds.length,
    keyCount: input.keys.length,
    totalCalls: input.entityIds.length * input.keys.length,
    results,
  };
}

async function batchSet(
  input: ManageSettingsInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.entityId || !input.entityType) {
    return { error: "entityId and entityType are required for batch_set." };
  }
  if (!input.settings || Object.keys(input.settings).length === 0) {
    return { error: "settings (key-value map) are required for batch_set." };
  }

  const results: Record<string, { ok: boolean; status: number }> = {};

  for (const [key, value] of Object.entries(input.settings)) {
    const res = await apiRequest(creds, env, {
      method: "POST",
      path: settingPath(input.entityType, input.entityId),
      params: { key, value },
    }, {
      eventType: "setting_change",
      entityId: input.entityId,
      entityType: input.entityType,
    });
    results[key] = { ok: res.ok, status: res.status };
  }

  return {
    entityId: input.entityId,
    entityType: input.entityType,
    settingsCount: Object.keys(input.settings).length,
    results,
  };
}

async function listNonDefault(
  input: ManageSettingsInput,
  creds: ApiCredentials,
  env: Environment
) {
  // The API has no "list all non-default settings" endpoint.
  // This would normally require iterating all 1,225 keys -- not practical in a single call.
  // Return guidance for the agent.
  return {
    note: "The API has no endpoint to list non-default settings. Use execute_workflow with a script that iterates known keys from describe_settings and compares values to defaults. For targeted checks, use batch_get with specific keys of interest.",
  };
}
