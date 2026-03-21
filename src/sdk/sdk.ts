/**
 * Virtual SDK -- the typed proxy layer exposed as `sdk` in the code-mode sandbox.
 *
 * Provides:
 *   sdk.config.get(entityType, entityId, sdkPath)      -- read a single setting
 *   sdk.config.update(entityType, entityId, settings)   -- write via nested object
 *   sdk.config.batchGet(entityType, entityIds, paths)   -- read multiple
 *   sdk.config.batchUpdate(entityType, entityId, settings) -- alias for update
 *   sdk.config.describe(query)                          -- search settings
 *   sdk.config.validate(settings)                       -- pre-flight only
 *   sdk.config.coverage()                               -- tier coverage stats
 *
 * The SDK translates nested typed objects to flat RiRo keys via the proxy module,
 * validates with Zod schemas, then delegates to the API client.
 */

import { apiRequest } from "../lib/api-client";
import { type EntityType, ENTITY_PLURAL } from "../lib/entity-types";
import type { ApiCredentials, Environment } from "../lib/types";
import {
  getByPath,
  sdkPathToKey,
  allSettings,
  coverageReport,
  type SettingMeta,
} from "./riro-tree";
import { flattenSettings, parseValue, type FlattenResult } from "./proxy";

// -- Types ----------------------------------------------------------------

export interface SdkContext {
  creds: ApiCredentials;
  env: Environment;
}

export interface ConfigGetResult {
  sdkPath: string;
  flatKey: string;
  value: unknown;
  raw: string;
  tier: "A" | "B";
}

export interface ConfigUpdateResult {
  ok: boolean;
  applied: Array<{ sdkPath: string; flatKey: string; value: string; status: number }>;
  errors: string[];
}

// -- SDK class ------------------------------------------------------------

export class VirtualSdk {
  private ctx: SdkContext;

  readonly config: SdkConfig;

  constructor(ctx: SdkContext) {
    this.ctx = ctx;
    this.config = new SdkConfig(ctx);
  }

  /** Update the SDK context (e.g. after credential refresh). */
  setContext(ctx: SdkContext) {
    this.ctx = ctx;
    this.config.setContext(ctx);
  }
}

class SdkConfig {
  private ctx: SdkContext;

  constructor(ctx: SdkContext) {
    this.ctx = ctx;
  }

  setContext(ctx: SdkContext) {
    this.ctx = ctx;
  }

  /**
   * Read a single setting value.
   * Only works at merchant/channel level (API constraint).
   */
  async get(
    entityType: EntityType,
    entityId: string,
    sdkPath: string
  ): Promise<ConfigGetResult> {
    if (entityType !== "merchant" && entityType !== "channel") {
      throw new Error(`GET setting only works at merchant/channel level (not ${entityType}).`);
    }

    const meta = getByPath(sdkPath);
    const flatKey = meta?.flatKey ?? sdkPathToKey(sdkPath);
    if (!flatKey) {
      throw new Error(`Unknown SDK path: ${sdkPath}`);
    }

    const path = `/${ENTITY_PLURAL[entityType]}/${entityId}/setting?key=${encodeURIComponent(flatKey)}`;
    const res = await apiRequest(this.ctx.creds, this.ctx.env, { path });

    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${JSON.stringify(res.data)}`);
    }

    const raw = extractRawValue(res.data);
    const value = meta ? parseValue(sdkPath, raw) : raw;

    return {
      sdkPath,
      flatKey,
      value,
      raw,
      tier: meta?.tier ?? "B",
    };
  }

  /**
   * Write settings via a nested typed object.
   * Works at all entity levels (PSP, division, merchant, channel).
   */
  async update(
    entityType: EntityType,
    entityId: string,
    settings: Record<string, unknown>
  ): Promise<ConfigUpdateResult> {
    const flat = flattenSettings(settings);
    if (!flat.ok) {
      return { ok: false, applied: [], errors: flat.errors };
    }

    const basePath = `/${ENTITY_PLURAL[entityType]}/${entityId}/setting`;
    const applied: ConfigUpdateResult["applied"] = [];
    const errors: string[] = [];

    for (const s of flat.settings) {
      const res = await apiRequest(this.ctx.creds, this.ctx.env, {
        method: "POST",
        path: basePath,
        params: { key: s.flatKey, value: s.value },
      }, {
        eventType: "setting_change",
        entityId,
        entityType,
      });

      if (res.ok) {
        applied.push({ sdkPath: s.sdkPath, flatKey: s.flatKey, value: s.value, status: res.status });
      } else {
        errors.push(`Failed to set ${s.sdkPath}: HTTP ${res.status}`);
      }
    }

    return { ok: errors.length === 0, applied, errors };
  }

  /**
   * Read multiple settings across multiple entities.
   * Only works at merchant/channel level.
   */
  async batchGet(
    entityType: EntityType,
    entityIds: string[],
    sdkPaths: string[]
  ): Promise<Record<string, Record<string, ConfigGetResult>>> {
    if (entityType !== "merchant" && entityType !== "channel") {
      throw new Error(`Batch GET only works at merchant/channel level (not ${entityType}).`);
    }

    const results: Record<string, Record<string, ConfigGetResult>> = {};

    for (const entityId of entityIds) {
      results[entityId] = {};
      for (const sdkPath of sdkPaths) {
        try {
          results[entityId][sdkPath] = await this.get(entityType, entityId, sdkPath);
        } catch (err) {
          results[entityId][sdkPath] = {
            sdkPath,
            flatKey: sdkPathToKey(sdkPath) ?? sdkPath,
            value: null,
            raw: "",
            tier: "B",
          };
        }
      }
    }

    return results;
  }

  /** Alias for update -- conceptually the same. */
  async batchUpdate(
    entityType: EntityType,
    entityId: string,
    settings: Record<string, unknown>
  ): Promise<ConfigUpdateResult> {
    return this.update(entityType, entityId, settings);
  }

  /**
   * Validate settings without sending to the API.
   * Returns flattened key-value pairs and any validation errors.
   */
  validate(settings: Record<string, unknown>): FlattenResult {
    return flattenSettings(settings);
  }

  /**
   * Search settings by keyword (delegates to the same logic as describe_settings tool).
   */
  describe(query: string, limit = 20): SettingMeta[] {
    const q = query.toLowerCase();
    return allSettings()
      .filter(
        (m) =>
          m.sdkPath.toLowerCase().includes(q) ||
          m.flatKey.toLowerCase().includes(q) ||
          (m.bipPath && m.bipPath.toLowerCase().includes(q))
      )
      .slice(0, limit);
  }

  /** Coverage report -- tier A vs B stats. */
  coverage() {
    return coverageReport();
  }
}

// -- Helpers --------------------------------------------------------------

/** Extract the raw setting value from an API response. */
function extractRawValue(data: unknown): string {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // API returns { key: "...", value: "..." } or { result: { value: "..." } }
    if ("value" in obj) return String(obj.value ?? "");
    if ("result" in obj && typeof obj.result === "object" && obj.result) {
      const r = obj.result as Record<string, unknown>;
      if ("value" in r) return String(r.value ?? "");
    }
  }
  return String(data ?? "");
}

/** Create a new VirtualSdk instance bound to credentials and environment. */
export function createSdk(ctx: SdkContext): VirtualSdk {
  return new VirtualSdk(ctx);
}
