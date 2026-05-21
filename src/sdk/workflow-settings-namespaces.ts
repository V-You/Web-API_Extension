import type { EntityType } from "../lib/entity-types";
import type { ConfigGetResult, ConfigUpdateResult } from "./sdk";
import type { FlattenResult } from "./proxy";
import type { SettingMeta } from "./riro-tree";
import type { WorkflowWritePreview } from "./workflow-entity-namespace";

interface WorkflowConfigApi {
  get(entityType: EntityType, entityId: string, sdkPath: string): Promise<ConfigGetResult>;
  batchGet(entityType: EntityType, entityIds: string[], sdkPaths: string[]): Promise<Record<string, Record<string, ConfigGetResult>>>;
  describe(query: string, limit?: number): SettingMeta[];
  validate(settings: Record<string, unknown>): FlattenResult;
  coverage(): unknown;
  update(entityType: EntityType, entityId: string, settings: Record<string, unknown>): Promise<ConfigUpdateResult>;
  batchUpdate(entityType: EntityType, entityId: string, settings: Record<string, unknown>): Promise<ConfigUpdateResult>;
}

export interface WorkflowSettingsNamespacesOptions {
  config: WorkflowConfigApi;
  beforeWrite: (preview: WorkflowWritePreview) => Promise<void>;
  planOnlyWrites?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function writeFailureMessage(result: Record<string, unknown>): string {
  const outcome = isRecord(result.apiOutcome) ? result.apiOutcome : null;
  const data = isRecord(result.data) ? result.data : null;
  const dataError = isRecord(data?.error) ? data.error : null;
  const messages = [
    stringValue(outcome?.errorCode),
    stringValue(outcome?.errorMessage),
    stringValue(dataError?.code),
    stringValue(dataError?.message),
    stringValue(data?.error),
  ].filter(Boolean);
  if (messages.length > 0) return messages.join(" - ");
  return typeof result.status === "number" ? `HTTP ${result.status}` : "unknown error";
}

function assertWriteSucceeded<T>(result: T, description: string): T {
  if (!isRecord(result)) return result;
  const errors = Array.isArray(result.errors) ? result.errors.map(String).filter(Boolean) : [];
  if (errors.length > 0) throw new Error(`${description} failed: ${errors.join("; ")}`);
  if (result.ok === false) throw new Error(`${description} failed: ${writeFailureMessage(result)}`);
  if (typeof result.error === "string" && result.error.trim()) throw new Error(`${description} failed: ${result.error.trim()}`);
  return result;
}

function plannedSettingsResult(): ConfigUpdateResult {
  return { ok: true, applied: [], errors: [] };
}

async function runSettingsWrite(
  options: WorkflowSettingsNamespacesOptions,
  action: "update" | "batch_update",
  entityType: EntityType,
  entityId: string,
  settings: Record<string, unknown>,
) {
  const keys = Object.keys(settings);
  const description = action === "batch_update"
    ? `Batch update ${keys.length} setting(s) on ${entityType} ${entityId}`
    : `Update ${keys.length} setting(s) on ${entityType} ${entityId}`;

  await options.beforeWrite({
    tool: "config",
    action,
    method: "POST",
    entityId,
    entityType,
    description,
    params: { settings },
  });

  if (options.planOnlyWrites) return plannedSettingsResult();
  const result = action === "batch_update"
    ? await options.config.batchUpdate(entityType, entityId, settings)
    : await options.config.update(entityType, entityId, settings);
  return assertWriteSucceeded(result, action === "batch_update" ? "settings batch update" : "settings update");
}

export function createWorkflowSettingsNamespaces(options: WorkflowSettingsNamespacesOptions) {
  const commonReads = {
    get: options.config.get.bind(options.config),
    batchGet: options.config.batchGet.bind(options.config),
    describe: options.config.describe.bind(options.config),
    validate: options.config.validate.bind(options.config),
    coverage: options.config.coverage.bind(options.config),
  };

  const config = {
    ...commonReads,
    update: (entityType: EntityType, entityId: string, settings: Record<string, unknown>) =>
      runSettingsWrite(options, "update", entityType, entityId, settings),
    batchUpdate: (entityType: EntityType, entityId: string, settings: Record<string, unknown>) =>
      runSettingsWrite(options, "batch_update", entityType, entityId, settings),
  };

  const settings = {
    ...commonReads,
    edit: (entityType: EntityType, entityId: string, settingsRecord: Record<string, unknown>) =>
      runSettingsWrite(options, "update", entityType, entityId, settingsRecord),
    update: (entityType: EntityType, entityId: string, settingsRecord: Record<string, unknown>) =>
      runSettingsWrite(options, "update", entityType, entityId, settingsRecord),
    batchEdit: (entityType: EntityType, entityId: string, settingsRecord: Record<string, unknown>) =>
      runSettingsWrite(options, "batch_update", entityType, entityId, settingsRecord),
    batchUpdate: (entityType: EntityType, entityId: string, settingsRecord: Record<string, unknown>) =>
      runSettingsWrite(options, "batch_update", entityType, entityId, settingsRecord),
  };

  return { config, settings };
}

export type WorkflowSettingsNamespaces = ReturnType<typeof createWorkflowSettingsNamespaces>;
