/**
 * Service worker job executor.
 *
 * Owns long-running job orchestration per PRD 8.1.
 * Reuses tool handlers (which are SW-safe -- they only use fetch + chrome.storage)
 * but skips the confirm bridge (writes during a job are pre-approved at start time).
 *
 * The side panel initiates jobs and monitors progress via chrome.storage.local.
 * The SW owns the actual execution lifecycle: start, pause, resume, cancel.
 */

import { createJob, updateJob, getJob, type JobContextSnapshot, type JobRecord, type JobProgress, type JobSource } from "../src/jobs/job-store";
import { appendAuditEntry } from "../src/lib/api-client";
import { compileSandboxScript, type WriteRecord, type LogEntry } from "../src/sandbox";
import { executeManageEntity } from "../src/tools/manage-entity";
import { executeGetHierarchy } from "../src/tools/get-hierarchy";
import { executeManageContact } from "../src/tools/manage-contact";
import { executeManageMerchantAccount } from "../src/tools/manage-merchant-account";
import { executeLookupClearingInstitutes } from "../src/tools/lookup-clearing-institutes";
import { listCardProcessors } from "../src/tools/card-processors";
import { executeDescribeSettings } from "../src/tools/describe-settings";
import { executeGetAuditLog, type GetAuditLogInput } from "../src/tools/get-audit-log";
import { executeSendTestTransaction, executeSendTestTransactions } from "../src/tools/send-test-transaction";
import { knownFieldNames, pickOperation } from "../src/tools/manifest-helpers";
import { RecoverableToolError } from "../src/tools/recoverable-error";
import { createSdk, type SdkContext } from "../src/sdk/sdk";
import { abortOffscreenJob, executeJobInOffscreen, type OffscreenJobExecuteResult } from "./offscreen-job-host";
import type { EntityType } from "../src/lib/entity-types";
import type { ApiCredentials, Environment } from "../src/lib/types";

// -- Active job state (singleton per SW) ----------------------------------

let activeJobId: string | null = null;
let abortController: AbortController | null = null;
let segmentStart = 0;
let activeSandboxRuntime: { jobId: string; sdk: unknown; writes: WriteRecord[]; completedSdkCalls: number } | null = null;

interface JobRuntimeContext {
  entityId?: string | null;
  entityType?: string | null;
  ids?: Record<string, string>;
}

// -- Progress persistence -------------------------------------------------

const PROGRESS_FLUSH_INTERVAL = 5_000;
const MIN_OFFSCREEN_JOB_TIMEOUT_MS = 120_000;
let lastFlush = 0;
let pendingProgress: JobProgress | null = null;

async function flushProgress(jobId: string, force = false) {
  if (!pendingProgress) return;
  const now = Date.now();
  if (!force && now - lastFlush < PROGRESS_FLUSH_INTERVAL) return;
  lastFlush = now;
  const p = pendingProgress;
  pendingProgress = null;
  await updateJob(jobId, {
    completedCalls: p.completedCalls,
    totalCalls: p.totalCalls,
    checkpoint: p.checkpoint,
  });
}

// -- SDK facade for SW (no confirm bridge) --------------------------------

function buildSwSdk(
  creds: ApiCredentials,
  env: Environment,
  writes: WriteRecord[],
  signal?: AbortSignal,
  throttleRate?: number,
  runtimeContext?: JobRuntimeContext,
) {
  const ctx: SdkContext = { creds, env, signal, throttleRate };
  const virtualSdk = createSdk(ctx);

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function toStringRecord(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {};
    const fields = Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined && entry !== null)
        .map(([key, entry]) => [key, String(entry)]),
    );
    if (fields.status && !fields.state) fields.state = fields.status === "ACTIVE" ? "LIVE" : fields.status;
    delete fields.status;
    if (fields.id && !fields.merchantId) fields.merchantId = fields.id;
    delete fields.id;
    if (fields.mid && !fields.merchantId) fields.merchantId = fields.mid;
    delete fields.mid;
    if (fields.identification && !fields.merchantId) fields.merchantId = fields.identification;
    delete fields.identification;
    if (fields.merchant_id && !fields.merchantId) fields.merchantId = fields.merchant_id;
    delete fields.merchant_id;
    if (fields.merchant_name && !fields.name) fields.name = fields.merchant_name;
    delete fields.merchant_name;
    if (fields.merchantName && !fields.name) fields.name = fields.merchantName;
    delete fields.merchantName;
    if (fields.clearingInstitute && !fields.clearingInstituteName) fields.clearingInstituteName = fields.clearingInstitute;
    delete fields.clearingInstitute;
    if (fields.ciId && !fields.clearingInstituteId) fields.clearingInstituteId = fields.ciId;
    delete fields.ciId;
    normalizeClearingInstituteIdentifier(fields);
    if (fields.merchantId && !fields.name) fields.name = fields.merchantId;
    return fields;
  }

  function normalizeClearingInstituteIdentifier(fields: Record<string, string>) {
    const id = fields.clearingInstituteId?.trim();
    if (!id || /^[a-f0-9]{32}$/i.test(id)) return;
    if (!fields.clearingInstituteName) fields.clearingInstituteName = id;
    delete fields.clearingInstituteId;
  }

  function normalizeMerchantAccountCreateArgs(args: unknown[]): { entityType: EntityType; entityId: string; fields: Record<string, string> } {
    const [first, second, third] = args;
    if (isRecord(first)) {
      const entityType = String(first.parentType ?? first.entityType ?? "merchant") as EntityType;
      const entityId = String(first.parentId ?? first.entityId ?? first.merchantId ?? "");
      const nestedFields = isRecord(first.fields) ? first.fields : first;
      const { parentType: _parentType, parentId: _parentId, entityType: _entityType, entityId: _entityId, merchantId: _merchantId, fields: _fields, ...rest } = nestedFields;
      return { entityType, entityId, fields: toStringRecord(rest) };
    }
    if (typeof first === "string" && isRecord(second) && third === undefined) {
      return { entityType: "merchant", entityId: first, fields: toStringRecord(isRecord(second.fields) ? second.fields : second) };
    }
    return { entityType: first as EntityType, entityId: String(second ?? ""), fields: toStringRecord(third) };
  }

  function normalizeMerchantAccountEditArgs(args: unknown[]): { merchantAccountId: string; fields: Record<string, string> } {
    const [first, second] = args;
    if (isRecord(first)) {
      const merchantAccountId = String(first.merchantAccountId ?? first.id ?? "");
      const nestedFields = isRecord(first.fields) ? first.fields : first;
      const { merchantAccountId: _merchantAccountId, id: _id, fields: _fields, ...rest } = nestedFields;
      return { merchantAccountId, fields: toStringRecord(rest) };
    }
    return { merchantAccountId: String(first ?? ""), fields: toStringRecord(second) };
  }

  function assertManifestFields(toolName: string, parentType: EntityType | null, fields: Record<string, string>) {
    const op = pickOperation(toolName, parentType);
    if (!op) throw new Error(`Unknown generated operation: ${toolName}`);
    const known = knownFieldNames(op);
    const unknown = Object.keys(fields).filter((field) => !known.has(field));
    if (unknown.length > 0) {
      const accepted = op.request.map((field) => field.name).sort();
      throw new Error(`${toolName} received unknown field(s): ${unknown.join(", ")}. Accepted fields: ${accepted.join(", ")}`);
    }
  }

  function assertMerchantAccountCreateContract(fields: Record<string, string>) {
    const missing = ["name", "state", "merchantId"].filter((field) => !fields[field]);
    if (!fields.clearingInstituteId && !fields.clearingInstituteName) missing.push("clearingInstituteId or clearingInstituteName");
    if (missing.length > 0) {
      throw new Error(
        `create_merchant_account is missing required field(s): ${missing.join(", ")}. ` +
          "Use sdk.merchantAccounts.create(parentType, parentId, { name, state: \"LIVE\", merchantId, clearingInstituteId or clearingInstituteName }).",
      );
    }
  }

  function normalizeListField(value: unknown): string {
    if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean).join(",");
    return String(value ?? "").trim();
  }

  function normalizeMerchantAccountAttachArgs(args: unknown[]): { entityType: EntityType; entityId: string; merchantAccountId: string; subTypes: string; currency: string } {
    const [first, second, third, fourth, fifth] = args;
    if (isRecord(first)) {
      return {
        entityType: String(first.parentType ?? first.entityType ?? "channel") as EntityType,
        entityId: String(first.parentId ?? first.entityId ?? ""),
        merchantAccountId: String(first.merchantAccountId ?? first.id ?? ""),
        subTypes: normalizeListField(first.subTypes ?? first.subType ?? first.paymentBrand ?? first.paymentBrands),
        currency: normalizeListField(first.currency ?? first.currencies),
      };
    }
    return {
      entityType: first as EntityType,
      entityId: String(second ?? ""),
      merchantAccountId: String(third ?? ""),
      subTypes: normalizeListField(fourth),
      currency: normalizeListField(fifth),
    };
  }

  function withMerchantAccountCreateAliases(result: unknown, fields: Record<string, string>): unknown {
    if (!isRecord(result)) return result;
    const data = isRecord(result.data) ? result.data : {};
    const merchantAccountId = String(data.merchantAccountId ?? data.id ?? fields.merchantAccountId ?? fields.id ?? fields.merchantId ?? "");
    const name = String(data.name ?? fields.name ?? merchantAccountId);
    const aliases = {
      ...(merchantAccountId ? { id: merchantAccountId, merchantAccountId } : {}),
      ...(name ? { name } : {}),
    };
    return {
      ...result,
      ...aliases,
      data: {
        ...data,
        ...aliases,
      },
    };
  }

  function assertMerchantAccountAttachContract(merchantAccountId: string) {
    if (!merchantAccountId.trim()) {
      throw new Error("merchant account attach failed: merchantAccountId is required. Use the id or merchantAccountId returned by sdk.merchantAccounts.create().");
    }
  }

  function unwrapApiData(result: unknown): unknown {
    if (result && typeof result === "object" && "data" in result) {
      return (result as { data: unknown }).data;
    }
    return result;
  }

  function unwrapApiList(result: unknown): unknown[] {
    const data = unwrapApiData(result);
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
      return (data as { items: unknown[] }).items;
    }
    return [];
  }

  function recordWrite(
    tool: string, action: string,
    entityId: string, entityType: string,
    params: Record<string, unknown>,
  ) {
    writes.push({ tool, action, entityId, entityType, params, timestamp: new Date().toISOString() });
  }

  function assertWriteSucceeded<T>(result: T, description: string): T {
    if (!isRecord(result)) return result;
    const errors = Array.isArray(result.errors) ? result.errors.map(String).filter(Boolean) : [];
    if (errors.length > 0) {
      throw new Error(`${description} failed: ${errors.join("; ")}`);
    }
    if (result.ok === false) {
      throw new Error(`${description} failed: ${writeFailureMessage(result)}`);
    }
    if (typeof result.error === "string" && result.error.trim()) {
      throw new Error(`${description} failed: ${result.error.trim()}`);
    }
    return result;
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
    const status = typeof result.status === "number" ? `HTTP ${result.status}` : "unknown error";
    return status;
  }

  function stringValue(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function extractMerchantId(value: unknown): string | null {
    for (const record of unwrapEntityRecords(value)) {
      const direct = record.merchantId ?? record.sender ?? record.parentId;
      if (typeof direct === "string" && direct.trim()) return direct.trim();
      if (isRecord(direct) && typeof direct.id === "string" && direct.id.trim()) return direct.id.trim();
      if (isRecord(record._parent) && record._parent.type === "merchant" && typeof record._parent.id === "string") {
        return record._parent.id.trim() || null;
      }
    }
    return null;
  }

  function extractParentId(value: unknown, parentType: EntityType): string | null {
    const field = `${parentType}Id`;
    for (const record of unwrapEntityRecords(value)) {
      const direct = record[field];
      if (typeof direct === "string" && direct.trim()) return direct.trim();
      if (isRecord(record._parent) && record._parent.type === parentType && typeof record._parent.id === "string") {
        return record._parent.id.trim() || null;
      }
    }
    return null;
  }

  function unwrapEntityRecords(value: unknown): Record<string, unknown>[] {
    if (!isRecord(value)) return [];
    const records: Record<string, unknown>[] = [value];
    for (const key of ["data", "entity", "channel", "channelInfo", "merchant", "merchantInfo", "division", "divisionInfo"]) {
      const child = value[key];
      if (isRecord(child)) records.push(...unwrapEntityRecords(child));
    }
    return records;
  }

  async function resolveTransactionMerchantId(params: Record<string, unknown>, channelId: string): Promise<string> {
    const supplied = String(params.merchantId ?? "").trim();
    if (supplied) return supplied;

    const contextMerchantId = runtimeContext?.ids?.merchantId?.trim();
    if (contextMerchantId) return contextMerchantId;

    if (runtimeContext?.entityType === "merchant" && runtimeContext.entityId) {
      return runtimeContext.entityId;
    }

    if (channelId) {
      const entity = await executeManageEntity({ action: "get", entityType: "channel", entityId: channelId }, creds, env);
      const derived = extractMerchantId(entity);
      if (derived) return derived;
    }

    throw new Error("Could not derive parent Merchant ID from the current Channel. The Channel GET response did not include _parent, merchantId, sender, or parentId.");
  }

  function currentChannelId(): string | null {
    const fromIds = runtimeContext?.ids?.channelId?.trim();
    if (fromIds) return fromIds;
    return runtimeContext?.entityType === "channel" && runtimeContext.entityId ? runtimeContext.entityId : null;
  }

  async function currentMerchantId(): Promise<string | null> {
    const fromIds = runtimeContext?.ids?.merchantId?.trim();
    if (fromIds) return fromIds;
    if (runtimeContext?.entityType === "merchant" && runtimeContext.entityId) return runtimeContext.entityId;
    const channelId = currentChannelId();
    if (!channelId) return null;
    const entity = await executeManageEntity({ action: "get", entityType: "channel", entityId: channelId }, creds, env);
    return extractMerchantId(entity);
  }

  async function currentPspId(): Promise<string | null> {
    const fromIds = runtimeContext?.ids?.pspId?.trim();
    if (fromIds) return fromIds;
    if (runtimeContext?.entityType === "psp" && runtimeContext.entityId) return runtimeContext.entityId;

    const divisionFromIds = runtimeContext?.ids?.divisionId?.trim();
    if (divisionFromIds) {
      const division = await executeManageEntity({ action: "get", entityType: "division", entityId: divisionFromIds }, creds, env);
      const pspId = extractParentId(division, "psp");
      if (pspId) return pspId;
    }

    let merchantId = runtimeContext?.ids?.merchantId?.trim() ?? null;
    if (!merchantId && runtimeContext?.entityType === "merchant" && runtimeContext.entityId) merchantId = runtimeContext.entityId;
    if (!merchantId) merchantId = await currentMerchantId();
    if (!merchantId) return null;

    const merchant = await executeManageEntity({ action: "get", entityType: "merchant", entityId: merchantId }, creds, env);
    const pspFromMerchant = extractParentId(merchant, "psp");
    if (pspFromMerchant) return pspFromMerchant;
    const divisionId = extractParentId(merchant, "division");
    if (!divisionId) return null;
    const division = await executeManageEntity({ action: "get", entityType: "division", entityId: divisionId }, creds, env);
    return extractParentId(division, "psp");
  }

  async function pspIdForLiveCardProcessors(supplied?: string): Promise<string | undefined> {
    const trimmed = supplied?.trim();
    if (trimmed) return trimmed;
    const derived = await currentPspId();
    if (derived) return derived;
    if (runtimeContext?.entityId) {
      throw new Error("Could not derive PSP ID for live Clearing Institute lookup from the current workflow context. Use lookup_clearing_institutes with a PSP ID, or provide an exact clearingInstituteId from the live PSP list.");
    }
    return undefined;
  }

  async function resolveMerchantAccountClearingInstitute(fields: Record<string, string>): Promise<Record<string, string>> {
    if (fields.clearingInstituteId && /^[a-f0-9]{32}$/i.test(fields.clearingInstituteId)) return fields;
    const query = fields.clearingInstituteName?.trim();
    if (!query) return fields;
    const pspId = await currentPspId();
    if (!pspId) return fields;

    const lookup = await executeLookupClearingInstitutes({ action: "search", query, pspId }, creds, env);
    if (!isRecord(lookup)) return fields;
    const lookupRecord = lookup as Record<string, unknown>;
    const recommended = isRecord(lookupRecord.recommended) ? lookupRecord.recommended : null;
    const recommendedId = stringValue(recommended?.id);
    const recommendedName = stringValue(recommended?.name);

    if (recommendedId && /^[a-f0-9]{32}$/i.test(recommendedId)) {
      const resolved: Record<string, string> = { ...fields, clearingInstituteId: recommendedId };
      delete resolved.clearingInstituteName;
      return resolved;
    }
    if (recommendedName) return { ...fields, clearingInstituteName: recommendedName };

    if (lookupRecord.matchCount === 0) {
      throw new Error(`Unable to resolve Clearing Institute "${query}" in live PSP ${pspId}. Use sdk.cardProcessors.list(context.ids?.pspId) and select one of the returned exact names or IDs.`);
    }
    return fields;
  }

  async function assertWorkflowTarget(entityType: EntityType, entityId: string, action: string): Promise<void> {
    const channelId = currentChannelId();
    if (!channelId || !entityId) return;
    if (entityType === "channel" && entityId !== channelId) {
      throw new RecoverableToolError({
        ok: false,
        errorCode: "wrong_channel_target",
        failureCategory: "safety_failure",
        message: `${action} targeted Channel ${entityId}, but this workflow was launched from Channel ${channelId}.`,
        recoverable: true,
        recovery: { reason: "The user asked for changes on the current Channel.", retryArgsPatch: { channelId } },
      });
    }
    if (entityType !== "merchant") return;
    const merchantId = await currentMerchantId();
    if (!merchantId || entityId === merchantId) return;
    throw new RecoverableToolError({
      ok: false,
      errorCode: "wrong_merchant_parent",
      failureCategory: "safety_failure",
      message: `${action} targeted Merchant ${entityId}, but the current Channel ${channelId} belongs to Merchant ${merchantId}.`,
      recoverable: true,
      recovery: {
        reason: "Merchant-scoped writes in a Channel workflow must use the verified parent Merchant or use the Channel-scoped endpoint when supported.",
        retryArgsPatch: { merchantId, channelId },
      },
    });
  }

  return {
    config: {
      get: virtualSdk.config.get.bind(virtualSdk.config),
      batchGet: virtualSdk.config.batchGet.bind(virtualSdk.config),
      describe: virtualSdk.config.describe.bind(virtualSdk.config),
      validate: virtualSdk.config.validate.bind(virtualSdk.config),
      coverage: virtualSdk.config.coverage.bind(virtualSdk.config),
      async update(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        await assertWorkflowTarget(entityType, entityId, "settings update");
        recordWrite("config", "update", entityId, entityType, { settings });
        return assertWriteSucceeded(await virtualSdk.config.update(entityType, entityId, settings), "settings update");
      },
      async batchUpdate(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        await assertWorkflowTarget(entityType, entityId, "settings batch update");
        recordWrite("config", "batch_update", entityId, entityType, { settings });
        return assertWriteSucceeded(await virtualSdk.config.batchUpdate(entityType, entityId, settings), "settings batch update");
      },
    },
    settings: {
      get: virtualSdk.config.get.bind(virtualSdk.config),
      batchGet: virtualSdk.config.batchGet.bind(virtualSdk.config),
      describe: virtualSdk.config.describe.bind(virtualSdk.config),
      validate: virtualSdk.config.validate.bind(virtualSdk.config),
      coverage: virtualSdk.config.coverage.bind(virtualSdk.config),
      async edit(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        await assertWorkflowTarget(entityType, entityId, "settings update");
        recordWrite("config", "update", entityId, entityType, { settings });
        return assertWriteSucceeded(await virtualSdk.config.update(entityType, entityId, settings), "settings update");
      },
      async update(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        await assertWorkflowTarget(entityType, entityId, "settings update");
        recordWrite("config", "update", entityId, entityType, { settings });
        return assertWriteSucceeded(await virtualSdk.config.update(entityType, entityId, settings), "settings update");
      },
      async batchEdit(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        await assertWorkflowTarget(entityType, entityId, "settings batch update");
        recordWrite("config", "batch_update", entityId, entityType, { settings });
        return assertWriteSucceeded(await virtualSdk.config.batchUpdate(entityType, entityId, settings), "settings batch update");
      },
      async batchUpdate(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        await assertWorkflowTarget(entityType, entityId, "settings batch update");
        recordWrite("config", "batch_update", entityId, entityType, { settings });
        return assertWriteSucceeded(await virtualSdk.config.batchUpdate(entityType, entityId, settings), "settings batch update");
      },
    },
    entities: {
      async get(entityType: EntityType, entityId: string) {
        return unwrapApiData(await executeManageEntity({ action: "get", entityType, entityId }, creds, env));
      },
      async search(namePath: string) {
        return executeManageEntity({ action: "search", namePath }, creds, env);
      },
      async listChildren(parentType: EntityType, parentId: string, childType: "division" | "merchant" | "channel") {
        return executeManageEntity({ action: "list_children", parentType, parentId, childType }, creds, env);
      },
      async create(parentType: EntityType, parentId: string, childType: "division" | "merchant" | "channel", fields: Record<string, string>) {
        recordWrite("manage_entity", "create", parentId, parentType, { childType, fields });
        return assertWriteSucceeded(await executeManageEntity({ action: "create", parentType, parentId, childType, fields }, creds, env), "entity create");
      },
      async edit(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        recordWrite("manage_entity", "edit", entityId, entityType, { fields });
        return assertWriteSucceeded(await executeManageEntity({ action: "edit", entityType, entityId, fields }, creds, env), "entity edit");
      },
      async delete(entityType: EntityType, entityId: string) {
        recordWrite("manage_entity", "delete", entityId, entityType, {});
        return assertWriteSucceeded(await executeManageEntity({ action: "delete", entityType, entityId }, creds, env), "entity delete");
      },
    },
    hierarchy: {
      async fetch(pspId: string, depth?: number) {
        return executeGetHierarchy({ pspId, depth }, creds, env);
      },
      async estimate(pspId: string, depth?: number) {
        return executeGetHierarchy({ pspId, depth, estimateOnly: true }, creds, env);
      },
    },
    contacts: {
      async get(contactId: string) {
        return unwrapApiData(await executeManageContact({ action: "get", contactId }, creds, env, { signal, throttleRate }));
      },
      async list(entityType: EntityType, entityId: string, scope?: "owned" | "attached") {
        return unwrapApiList(await executeManageContact({ action: "list", entityType, entityId, scope }, creds, env, { signal, throttleRate }));
      },
      async create(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        recordWrite("manage_contact", "create", entityId, entityType, { fields });
        return assertWriteSucceeded(await executeManageContact({ action: "create", entityType, entityId, fields }, creds, env, { signal, throttleRate }), "contact create");
      },
      async edit(contactId: string, fields: Record<string, string>) {
        recordWrite("manage_contact", "edit", contactId, "contact", { fields });
        return assertWriteSucceeded(await executeManageContact({ action: "edit", contactId, fields }, creds, env, { signal, throttleRate }), "contact edit");
      },
      async delete(contactId: string) {
        recordWrite("manage_contact", "delete", contactId, "contact", {});
        return assertWriteSucceeded(await executeManageContact({ action: "delete", contactId }, creds, env, { signal, throttleRate }), "contact delete");
      },
      async attach(entityType: EntityType, entityId: string, contactId: string) {
        recordWrite("manage_contact", "attach", entityId, entityType, { contactId });
        return assertWriteSucceeded(await executeManageContact({ action: "attach", entityType, entityId, contactId }, creds, env, { signal, throttleRate }), "contact attach");
      },
      async detach(entityType: EntityType, entityId: string, contactId: string) {
        recordWrite("manage_contact", "detach", entityId, entityType, { contactId });
        return assertWriteSucceeded(await executeManageContact({ action: "detach", entityType, entityId, contactId }, creds, env, { signal, throttleRate }), "contact detach");
      },
      async lock(contactId: string) {
        recordWrite("manage_contact", "lock", contactId, "contact", {});
        return assertWriteSucceeded(await executeManageContact({ action: "lock", contactId }, creds, env, { signal, throttleRate }), "contact lock");
      },
      async unlock(contactId: string) {
        recordWrite("manage_contact", "unlock", contactId, "contact", {});
        return assertWriteSucceeded(await executeManageContact({ action: "unlock", contactId }, creds, env, { signal, throttleRate }), "contact unlock");
      },
      async resetPassword(contactId: string, newPassword: string) {
        recordWrite("manage_contact", "reset_password", contactId, "contact", {});
        return assertWriteSucceeded(await executeManageContact({ action: "reset_password", contactId, newPassword }, creds, env, { signal, throttleRate }), "contact password reset");
      },
    },
    merchantAccounts: {
      async get(merchantAccountId: string) {
        return executeManageMerchantAccount({ action: "get", merchantAccountId }, creds, env);
      },
      async list(entityType: EntityType, entityId: string, scope?: "owned" | "attached") {
        return executeManageMerchantAccount({ action: "list", entityType, entityId, scope }, creds, env);
      },
      async create(...args: unknown[]) {
        const { entityType, entityId, fields: rawFields } = normalizeMerchantAccountCreateArgs(args);
        const fields = await resolveMerchantAccountClearingInstitute(rawFields);
        await assertWorkflowTarget(entityType, entityId, "merchant account create");
        assertManifestFields("create_merchant_account", entityType, fields);
        assertMerchantAccountCreateContract(fields);
        recordWrite("manage_merchant_account", "create", entityId, entityType, { fields });
        return withMerchantAccountCreateAliases(
          assertWriteSucceeded(await executeManageMerchantAccount({ action: "create", entityType, entityId, fields }, creds, env), "merchant account create"),
          fields,
        );
      },
      async edit(...args: unknown[]) {
        const { merchantAccountId, fields } = normalizeMerchantAccountEditArgs(args);
        assertManifestFields("edit_merchant_account", null, fields);
        recordWrite("manage_merchant_account", "edit", merchantAccountId, "merchant_account", { fields });
        return assertWriteSucceeded(await executeManageMerchantAccount({ action: "edit", merchantAccountId, fields }, creds, env), "merchant account edit");
      },
      async update(...args: unknown[]) {
        const { merchantAccountId, fields } = normalizeMerchantAccountEditArgs(args);
        assertManifestFields("edit_merchant_account", null, fields);
        recordWrite("manage_merchant_account", "edit", merchantAccountId, "merchant_account", { fields });
        return assertWriteSucceeded(await executeManageMerchantAccount({ action: "edit", merchantAccountId, fields }, creds, env), "merchant account edit");
      },
      async activate(...args: unknown[]) {
        const { entityType, entityId, merchantAccountId, subTypes, currency } = normalizeMerchantAccountAttachArgs(args);
        return this.attach(entityType, entityId, merchantAccountId, subTypes, currency);
      },
      async delete(merchantAccountId: string) {
        recordWrite("manage_merchant_account", "delete", merchantAccountId, "merchant_account", {});
        return assertWriteSucceeded(await executeManageMerchantAccount({ action: "delete", merchantAccountId }, creds, env), "merchant account delete");
      },
      async attach(...args: unknown[]) {
        const { entityType, entityId, merchantAccountId, subTypes, currency } = normalizeMerchantAccountAttachArgs(args);
        assertMerchantAccountAttachContract(merchantAccountId);
        await assertWorkflowTarget(entityType, entityId, "merchant account attach");
        recordWrite("manage_merchant_account", "attach", entityId, entityType, { merchantAccountId, subTypes, currency });
        return assertWriteSucceeded(await executeManageMerchantAccount({ action: "attach", entityType, entityId, merchantAccountId, subTypes, currency }, creds, env), "merchant account attach");
      },
      async detach(attachedMerchantAccountId: string) {
        recordWrite("manage_merchant_account", "detach", attachedMerchantAccountId, "merchant_account", {});
        return assertWriteSucceeded(await executeManageMerchantAccount({ action: "detach", attachedMerchantAccountId }, creds, env), "merchant account detach");
      },
      async threeDCheck(merchantAccountId: string) {
        return executeManageMerchantAccount({ action: "three_d_check", merchantAccountId }, creds, env);
      },
    },
    clearingInstitutes: {
      async search(query: string) {
        return executeLookupClearingInstitutes({ action: "search", query }, creds, env);
      },
      async getFields(ciCode: string) {
        return executeLookupClearingInstitutes({ action: "get_fields", ciCode }, creds, env);
      },
      async listLive(pspId: string) {
        return executeLookupClearingInstitutes({ action: "list_live", pspId }, creds, env);
      },
    },
    cardProcessors: {
      async list(pspId?: string) {
        return listCardProcessors(await pspIdForLiveCardProcessors(pspId), creds, env);
      },
      async listLive(pspId?: string) {
        return listCardProcessors(await pspIdForLiveCardProcessors(pspId), creds, env);
      },
      async search(query: string) {
        return executeLookupClearingInstitutes({ action: "search", query }, creds, env);
      },
      async getFields(ciCode: string) {
        return executeLookupClearingInstitutes({ action: "get_fields", ciCode }, creds, env);
      },
    },
    describeSettings(query: string, limit?: number) {
      return executeDescribeSettings({ query, limit });
    },
    audit: {
      async get(opts?: GetAuditLogInput) {
        return executeGetAuditLog(opts ?? {});
      },
    },
    transactions: {
      async sendTest(params: Record<string, unknown>) {
        const channelId = String(
          params.channelId
            ?? runtimeContext?.ids?.channelId
            ?? (runtimeContext?.entityType === "channel" ? runtimeContext.entityId : "")
            ?? "",
        ).trim();
        const merchantId = await resolveTransactionMerchantId(params, channelId);
        const resolvedParams = {
          ...params,
          channelId,
          merchantId,
          contextProvenance: params.contextProvenance ?? "Merchant derived by Job runtime from current Channel context or Channel GET.",
        };
        return executeSendTestTransaction(resolvedParams, creds, env, {
          bypassWriteConfirmation: true,
          onWriteAccepted: () => recordWrite("send_test_transaction", "send", channelId, "channel", resolvedParams),
        });
      },
      async sendTestBatch(params: Record<string, unknown>) {
        const channelId = String(
          params.channelId
            ?? runtimeContext?.ids?.channelId
            ?? (runtimeContext?.entityType === "channel" ? runtimeContext.entityId : "")
            ?? "",
        ).trim();
        const merchantId = await resolveTransactionMerchantId(params, channelId);
        const resolvedParams = {
          ...params,
          channelId,
          merchantId,
          count: params.count ?? params.total ?? 3,
          contextProvenance: params.contextProvenance ?? "Merchant derived by Job runtime from current Channel context or Channel GET.",
        };
        return executeSendTestTransactions(resolvedParams, creds, env, {
          bypassWriteConfirmation: true,
          onWriteAccepted: () => recordWrite("send_test_transactions", "send_batch", channelId, "channel", resolvedParams),
        });
      },
    },
    management: {
      entities: {
        async get(entityType: EntityType, entityId: string) {
          return unwrapApiData(await executeManageEntity({ action: "get", entityType, entityId }, creds, env));
        },
      },
    },
  };
}

// -- Job execution --------------------------------------------------------

export interface SwJobStartInput {
  jobId?: string; // existing job id for resume, or undefined for new
  label: string;
  script: string;
  entityId?: string;
  entityType?: string;
  totalCalls: number;
  throttleRate?: number;
  contextSnapshot?: JobContextSnapshot;
  creds: ApiCredentials;
  env: Environment;
  source?: JobSource;
}

/** Start or resume a job in the service worker. */
export async function swStartJob(input: SwJobStartInput): Promise<{ ok: boolean; jobId: string; error?: string }> {
  if (activeJobId) {
    return { ok: false, jobId: "", error: "A job is already running. Pause or cancel it first." };
  }

  let job: JobRecord;
  if (input.jobId) {
    // Resume existing job
    const existing = await getJob(input.jobId);
    if (!existing) return { ok: false, jobId: input.jobId, error: "Job not found." };
    if (existing.state !== "paused" && existing.state !== "failed") {
      return { ok: false, jobId: input.jobId, error: `Cannot resume job in state "${existing.state}".` };
    }
    job = existing;
  } else {
    // Create a new job
    job = await createJob({
      label: input.label,
      script: input.script,
      entityId: input.entityId,
      entityType: input.entityType,
      totalCalls: input.totalCalls,
      throttleRate: input.throttleRate ?? 9,
      contextSnapshot: input.contextSnapshot,
      env: input.env,
      source: input.source,
    });
  }

  activeJobId = job.id;
  await updateJob(job.id, {
    state: "running",
    startedAt: job.startedAt ?? new Date().toISOString(),
    pausedAt: undefined,
  });
  void executeInSw(job.id, input.creds, input.env).catch(async (err) => {
    await updateJob(job.id, {
      state: "failed",
      completedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
    cleanup();
  });
  return { ok: true, jobId: job.id };
}

/** Pause the active job. */
export async function swPauseJob(): Promise<void> {
  if (!activeJobId) return;
  const jobId = activeJobId;
  abortController?.abort();
  await abortOffscreenJob(jobId).catch(() => undefined);
  await flushProgress(jobId, true);

  const segmentElapsed = Date.now() - segmentStart;
  const job = await getJob(jobId);
  if (job && (job.state === "running" || job.state === "resumed")) {
    await updateJob(jobId, {
      state: "paused",
      pausedAt: new Date().toISOString(),
      elapsedMs: job.elapsedMs + segmentElapsed,
    });
  }
  cleanup();
}

/** Cancel the active job permanently. */
export async function swCancelJob(): Promise<void> {
  if (!activeJobId) return;
  const jobId = activeJobId;
  abortController?.abort();
  await abortOffscreenJob(jobId).catch(() => undefined);
  await flushProgress(jobId, true);

  const segmentElapsed = Date.now() - segmentStart;
  const job = await getJob(jobId);
  if (job) {
    await updateJob(jobId, {
      state: "cancelled",
      completedAt: new Date().toISOString(),
      elapsedMs: job.elapsedMs + segmentElapsed,
    });
  }
  cleanup();
}

/** Cancel a specific job by id (even if paused). */
export async function swCancelJobById(jobId: string): Promise<void> {
  if (activeJobId === jobId) return swCancelJob();
  await updateJob(jobId, {
    state: "cancelled",
    completedAt: new Date().toISOString(),
  });
}

/** Get the active job id (if any). */
export function swGetActiveJobId(): string | null {
  return activeJobId;
}

// -- Internal execution ---------------------------------------------------

function cleanup() {
  activeJobId = null;
  abortController = null;
  pendingProgress = null;
  activeSandboxRuntime = null;
}

function getRuntimeFunction(path: string[]): ((...args: unknown[]) => Promise<unknown>) | null {
  let current: unknown = activeSandboxRuntime?.sdk;
  for (const segment of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "function" ? current as (...args: unknown[]) => Promise<unknown> : null;
}

export async function handleSandboxSdkCall(message: {
  jobId?: unknown;
  path?: unknown;
  args?: unknown;
}): Promise<unknown> {
  const jobId = String(message.jobId ?? "");
  if (!activeSandboxRuntime || activeSandboxRuntime.jobId !== jobId) {
    const job = await getJob(jobId);
    if (job && job.state === "running") {
      await updateJob(jobId, {
        state: "failed",
        completedAt: new Date().toISOString(),
        error: "No active sandbox runtime for this job. The service worker lost the in-memory SDK bridge while the offscreen sandbox was running.",
      });
    }
    cleanup();
    throw new Error("No active sandbox runtime for this job.");
  }

  const path = Array.isArray(message.path) ? message.path.map(String) : [];
  const args = Array.isArray(message.args) ? message.args : [];
  const fn = getRuntimeFunction(path);
  if (!fn) {
    throw new Error(`Unknown sandbox SDK method: ${path.join(".")}`);
  }

  const result = await fn(...args);
  if (activeSandboxRuntime?.jobId === jobId) activeSandboxRuntime.completedSdkCalls += 1;
  return result;
}

export async function handleSandboxProgress(message: {
  jobId?: unknown;
  completedCalls?: unknown;
  totalCalls?: unknown;
  checkpoint?: unknown;
}): Promise<void> {
  const jobId = String(message.jobId ?? "");
  if (activeJobId !== jobId) return;

  const requestedCompletedCalls = Number(message.completedCalls ?? 0);
  const completedSdkCalls = activeSandboxRuntime?.jobId === jobId
    ? activeSandboxRuntime.completedSdkCalls
    : requestedCompletedCalls;
  pendingProgress = {
    completedCalls: Math.min(requestedCompletedCalls, completedSdkCalls),
    totalCalls: Number(message.totalCalls ?? 0),
    checkpoint: message.checkpoint,
  };
  await flushProgress(jobId, true);
}

function estimateOffscreenTimeoutMs(job: JobRecord): number {
  const throttleRate = Math.max(1, job.throttleRate || 9);
  const estimatedMs = Math.ceil((Math.max(1, job.totalCalls) / throttleRate) * 1000);
  return Math.max(MIN_OFFSCREEN_JOB_TIMEOUT_MS, estimatedMs * 3 + MIN_OFFSCREEN_JOB_TIMEOUT_MS);
}

async function executeInSw(jobId: string, creds: ApiCredentials, env: Environment) {
  const job = await getJob(jobId);
  if (!job) { cleanup(); return; }

  await updateJob(jobId, {
    state: "running",
    startedAt: job.startedAt ?? new Date().toISOString(),
    pausedAt: undefined,
  });

  if (job.source === "chat" && !job.chatStartedAuditAt) {
    const timestamp = new Date().toISOString();
    await appendAuditEntry({
      id: crypto.randomUUID(),
      timestamp,
      eventType: "chat_automation_job_started",
      entityId: job.entityId ?? job.id,
      entityType: job.entityType ?? "workflow",
      parameters: {
        jobId: job.id,
        label: job.label,
        totalCalls: job.totalCalls,
      },
      responseStatus: 0,
      environment: env,
    });
    await updateJob(jobId, { chatStartedAuditAt: timestamp });
  }

  abortController = new AbortController();
  const { signal } = abortController;
  segmentStart = Date.now();

  const logs: LogEntry[] = [];
  const results: unknown[] = [];
  const writes: WriteRecord[] = [];

  const context = {
    id: job.entityId ?? job.contextSnapshot?.entityId ?? null,
    type: job.entityType ?? job.contextSnapshot?.entityType ?? null,
    entityId: job.entityId ?? job.contextSnapshot?.entityId ?? null,
    entityType: job.entityType ?? job.contextSnapshot?.entityType ?? null,
    entityName: job.contextSnapshot?.entityName ?? null,
    section: job.contextSnapshot?.section ?? null,
    ids: job.contextSnapshot?.ids ?? {},
    env,
    checkpoint: job.checkpoint ?? null,
  };

  const sdk = buildSwSdk(creds, env, writes, signal, job.throttleRate, context);
  activeSandboxRuntime = { jobId, sdk, writes, completedSdkCalls: 0 };

  // Parser-backed TS stripping (shared with sandbox.ts)
  const compiled = await compileSandboxScript(job.script);
  if (!compiled.ok) {
    const segmentElapsed = Date.now() - segmentStart;
    await updateJob(jobId, {
      state: "failed",
      completedAt: new Date().toISOString(),
      elapsedMs: job.elapsedMs + segmentElapsed,
      error: compiled.error,
    });
    cleanup();
    return;
  }

  try {
    const execution = await executeJobInOffscreen({
      jobId,
      jsCode: compiled.jsCode,
      context,
      timeoutMs: estimateOffscreenTimeoutMs(job),
    });
    results.push(...execution.results);
    logs.push(...execution.logs as LogEntry[]);

    await flushProgress(jobId, true);
    const segmentElapsed = Date.now() - segmentStart;

    if (activeJobId !== jobId) return; // paused/cancelled while awaiting

    await updateJob(jobId, {
      state: "completed",
      completedAt: new Date().toISOString(),
      results: [...job.results, ...results],
      logs: [...job.logs, ...logs],
      writes: [...job.writes, ...writes],
      elapsedMs: job.elapsedMs + segmentElapsed,
    });
  } catch (err) {
    const partial = (err as Error & { result?: Partial<OffscreenJobExecuteResult> }).result;
    if (partial) {
      if (Array.isArray(partial.results)) results.push(...partial.results);
      if (Array.isArray(partial.logs)) logs.push(...partial.logs as LogEntry[]);
    }
    if (activeSandboxRuntime?.jobId === jobId) {
      pendingProgress = {
        completedCalls: activeSandboxRuntime.completedSdkCalls,
        totalCalls: Number(partial?.totalCalls ?? job.totalCalls),
        checkpoint: pendingProgress?.checkpoint ?? job.checkpoint,
      };
    }
    await flushProgress(jobId, true);
    const segmentElapsed = Date.now() - segmentStart;

    if (activeJobId !== jobId) return;

    if (err instanceof DOMException && err.name === "AbortError") {
      // Abort from pause/cancel -- they set state themselves
      if ((await getJob(jobId))?.state === "running") {
        await updateJob(jobId, {
          state: "paused",
          pausedAt: new Date().toISOString(),
          results: [...job.results, ...results],
          logs: [...job.logs, ...logs],
          writes: [...job.writes, ...writes],
          elapsedMs: job.elapsedMs + segmentElapsed,
        });
      }
    } else {
      await updateJob(jobId, {
        state: "failed",
        completedAt: new Date().toISOString(),
        results: [...job.results, ...results],
        logs: [...job.logs, ...logs],
        writes: [...job.writes, ...writes],
        elapsedMs: job.elapsedMs + segmentElapsed,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  cleanup();
}
