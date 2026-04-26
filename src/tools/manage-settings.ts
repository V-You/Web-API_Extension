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
import { extractParentFromEntityRecord, unwrapEntityRecord } from "../lib/api-shapes";
import { type EntityType, ENTITY_PLURAL } from "../lib/entity-types";
import type { ApiCredentials, Environment } from "../lib/types";
import { allSettings, getByKey } from "../sdk/riro-tree";

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
  /** For list_non_default: keyword filter to limit which settings to check. */
  query?: string;
}

interface ResolutionStep {
  entityId: string;
  entityType: EntityType;
  readable: boolean;
  value?: unknown;
}

interface EffectiveSettingResult {
  key: string;
  entityId: string;
  entityType: EntityType;
  value: unknown;
  effectiveValue: unknown;
  source: "explicit" | "inherited" | "unknown";
  sourceEntityId?: string;
  sourceEntityType?: EntityType;
  defaultValue?: string;
  resolutionPath: ResolutionStep[];
  apiLimit?: string;
  error?: string;
  status?: number;
}

interface SettingReadResult {
  ok: boolean;
  status: number;
  data: unknown;
  value: unknown;
}

interface ResolutionCache {
  parents: Map<string, { id: string; type: EntityType } | null>;
  settings: Map<string, SettingReadResult>;
}

const SETTING_READ_API_LIMIT = "GET /setting is unavailable at division and PSP level.";
const MAX_INHERITANCE_DEPTH = 10;

function createResolutionCache(): ResolutionCache {
  return {
    parents: new Map(),
    settings: new Map(),
  };
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

  return resolveEffectiveSetting(input.entityId, input.entityType, input.key, creds, env, createResolutionCache());
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

  const results: Record<string, Record<string, EffectiveSettingResult>> = {};
  let totalCalls = 0;
  const cache = createResolutionCache();

  for (const entityId of input.entityIds) {
    results[entityId] = {};
    for (const key of input.keys) {
      const resolved = await resolveEffectiveSetting(entityId, input.entityType, key, creds, env, cache);
      totalCalls += resolved.resolutionPath.length;
      results[entityId][key] = resolved;
    }
  }

  return {
    entityType: input.entityType,
    entityCount: input.entityIds.length,
    keyCount: input.keys.length,
    totalCalls,
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
  if (!input.entityId || !input.entityType) {
    return { error: "entityId and entityType are required for list_non_default." };
  }
  if (input.entityType !== "merchant" && input.entityType !== "channel") {
    return { error: `list_non_default only works at merchant/channel level (not ${input.entityType}).` };
  }

  // Determine which keys to check
  let keysToCheck: { flatKey: string; defaultValue: string }[];

  if (input.keys?.length) {
    // Explicit key list provided
    keysToCheck = input.keys.map((k) => {
      const meta = getByKey(k);
      return { flatKey: k, defaultValue: meta?.defaultValue ?? "" };
    });
  } else {
    // Use keyword query to filter, or reject if no filter provided
    const q = input.query?.toLowerCase();
    if (!q) {
      return {
        error: "Provide keys (array of flat RiRo keys) or query (keyword) to filter which settings to check. Checking all 1,225 settings would require too many API calls.",
      };
    }
    keysToCheck = allSettings()
      .filter(
        (m) =>
          m.flatKey.toLowerCase().includes(q) ||
          m.sdkPath.toLowerCase().includes(q) ||
          (m.bipPath && m.bipPath.toLowerCase().includes(q))
      )
      .map((m) => ({ flatKey: m.flatKey, defaultValue: m.defaultValue }));
  }

  if (keysToCheck.length === 0) {
    return { matchedKeys: 0, nonDefault: [] };
  }

  // Cap at 200 keys to avoid excessive API calls
  const capped = keysToCheck.length > 200;
  const subset = capped ? keysToCheck.slice(0, 200) : keysToCheck;

  const nonDefault: { key: string; currentValue: unknown; defaultValue: string; source: string; sourceEntityId?: string; sourceEntityType?: EntityType }[] = [];
  const unresolved: { key: string; defaultValue: string; apiLimit?: string }[] = [];
  const errors: { key: string; status: number }[] = [];
  const cache = createResolutionCache();

  for (const { flatKey, defaultValue } of subset) {
    const resolved = await resolveEffectiveSetting(input.entityId, input.entityType, flatKey, creds, env, cache);

    if (resolved.error && resolved.status) {
      errors.push({ key: flatKey, status: resolved.status });
      continue;
    }

    if (resolved.source === "unknown") {
      unresolved.push({ key: flatKey, defaultValue, apiLimit: resolved.apiLimit });
      continue;
    }

    const current = resolved.effectiveValue;
    if (current !== undefined && String(current) !== defaultValue) {
      nonDefault.push({
        key: flatKey,
        currentValue: current,
        defaultValue,
        source: resolved.source,
        sourceEntityId: resolved.sourceEntityId,
        sourceEntityType: resolved.sourceEntityType,
      });
    }
  }

  return {
    entityId: input.entityId,
    entityType: input.entityType,
    checkedKeys: subset.length,
    capped,
    totalMatched: keysToCheck.length,
    nonDefaultCount: nonDefault.length,
    nonDefault,
    ...(unresolved.length > 0 ? { unresolvedCount: unresolved.length, unresolved: unresolved.slice(0, 10) } : {}),
    ...(errors.length > 0 ? { errorCount: errors.length, errors: errors.slice(0, 10) } : {}),
  };
}

function hasExplicitValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

async function getParentInfo(
  entityId: string,
  entityType: EntityType,
  creds: ApiCredentials,
  env: Environment,
  cache: ResolutionCache,
): Promise<{ id: string; type: EntityType } | null> {
  if (entityType === "psp") return null;
  const cacheKey = `${entityType}:${entityId}`;
  if (cache.parents.has(cacheKey)) return cache.parents.get(cacheKey) ?? null;

  const res = await apiRequest<Record<string, unknown>>(creds, env, {
    path: `/${ENTITY_PLURAL[entityType]}/${entityId}`,
  });
  if (!res.ok || !res.data || Array.isArray(res.data)) {
    cache.parents.set(cacheKey, null);
    return null;
  }
  const parent = extractParentFromEntityRecord(unwrapEntityRecord(entityType, res.data));
  cache.parents.set(cacheKey, parent);
  return parent;
}

async function readSettingValue(
  entityId: string,
  entityType: "merchant" | "channel",
  key: string,
  creds: ApiCredentials,
  env: Environment,
  cache: ResolutionCache,
): Promise<SettingReadResult> {
  const cacheKey = `${entityType}:${entityId}:${key}`;
  const cached = cache.settings.get(cacheKey);
  if (cached) return cached;

  const res = await apiRequest(creds, env, {
    path: `${settingPath(entityType, entityId)}?key=${encodeURIComponent(key)}`,
  });
  const read = { ...res, value: extractValue(res.data) };
  cache.settings.set(cacheKey, read);
  return read;
}

async function resolveEffectiveSetting(
  entityId: string,
  entityType: EntityType,
  key: string,
  creds: ApiCredentials,
  env: Environment,
  cache: ResolutionCache,
): Promise<EffectiveSettingResult> {
  const defaultValue = getByKey(key)?.defaultValue;
  const resolutionPath: ResolutionStep[] = [];
  let currentId = entityId;
  let currentType = entityType;
  let firstValue: unknown;

  for (let depth = 0; depth < MAX_INHERITANCE_DEPTH; depth++) {
    if (currentType === "division" || currentType === "psp") {
      resolutionPath.push({ entityId: currentId, entityType: currentType, readable: false });
      return {
        key,
        entityId,
        entityType,
        value: firstValue,
        effectiveValue: null,
        source: "unknown",
        defaultValue,
        resolutionPath,
        apiLimit: SETTING_READ_API_LIMIT,
      };
    }

    const read = await readSettingValue(currentId, currentType, key, creds, env, cache);
    const step: ResolutionStep = {
      entityId: currentId,
      entityType: currentType,
      readable: true,
      value: read.value,
    };
    resolutionPath.push(step);

    if (!read.ok) {
      return {
        key,
        entityId,
        entityType,
        value: firstValue,
        effectiveValue: null,
        source: "unknown",
        defaultValue,
        resolutionPath,
        error: `Setting read failed with status ${read.status}.`,
        status: read.status,
      };
    }

    if (depth === 0) firstValue = read.value;
    if (hasExplicitValue(read.value)) {
      return {
        key,
        entityId,
        entityType,
        value: firstValue,
        effectiveValue: read.value,
        source: depth === 0 ? "explicit" : "inherited",
        sourceEntityId: currentId,
        sourceEntityType: currentType,
        defaultValue,
        resolutionPath,
      };
    }

    const parent = await getParentInfo(currentId, currentType, creds, env, cache);
    if (!parent) {
      return {
        key,
        entityId,
        entityType,
        value: firstValue,
        effectiveValue: null,
        source: "unknown",
        defaultValue,
        resolutionPath,
        apiLimit: "No readable explicit value was found and the parent entity could not be determined.",
      };
    }

    currentId = parent.id;
    currentType = parent.type;
  }

  return {
    key,
    entityId,
    entityType,
    value: firstValue,
    effectiveValue: null,
    source: "unknown",
    defaultValue,
    resolutionPath,
    apiLimit: `Max inheritance depth (${MAX_INHERITANCE_DEPTH}) exceeded.`,
  };
}

/** Extract the setting value from the API response payload. */
function extractValue(data: unknown): unknown {
  if (data && typeof data === "object" && "value" in data) {
    return (data as { value: unknown }).value;
  }
  return data;
}
