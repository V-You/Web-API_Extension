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
import { executeSendTestTransaction } from "../src/tools/send-test-transaction";
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
    if (fields.id && !fields.merchantId) fields.merchantId = fields.id;
    return fields;
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

  function extractMerchantId(value: unknown): string | null {
    if (!isRecord(value)) return null;
    const direct = value.merchantId ?? value.sender ?? value.parentId;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (isRecord(value._parent) && value._parent.type === "merchant" && typeof value._parent.id === "string") {
      return value._parent.id.trim() || null;
    }
    if (isRecord(value.data)) return extractMerchantId(value.data);
    if (isRecord(value.entity)) return extractMerchantId(value.entity);
    return null;
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

  return {
    config: {
      get: virtualSdk.config.get.bind(virtualSdk.config),
      batchGet: virtualSdk.config.batchGet.bind(virtualSdk.config),
      describe: virtualSdk.config.describe.bind(virtualSdk.config),
      validate: virtualSdk.config.validate.bind(virtualSdk.config),
      coverage: virtualSdk.config.coverage.bind(virtualSdk.config),
      async update(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        recordWrite("config", "update", entityId, entityType, { settings });
        return virtualSdk.config.update(entityType, entityId, settings);
      },
      async batchUpdate(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        recordWrite("config", "batch_update", entityId, entityType, { settings });
        return virtualSdk.config.batchUpdate(entityType, entityId, settings);
      },
    },
    settings: {
      get: virtualSdk.config.get.bind(virtualSdk.config),
      batchGet: virtualSdk.config.batchGet.bind(virtualSdk.config),
      describe: virtualSdk.config.describe.bind(virtualSdk.config),
      validate: virtualSdk.config.validate.bind(virtualSdk.config),
      coverage: virtualSdk.config.coverage.bind(virtualSdk.config),
      async edit(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        recordWrite("config", "update", entityId, entityType, { settings });
        return virtualSdk.config.update(entityType, entityId, settings);
      },
      async update(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        recordWrite("config", "update", entityId, entityType, { settings });
        return virtualSdk.config.update(entityType, entityId, settings);
      },
      async batchEdit(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        recordWrite("config", "batch_update", entityId, entityType, { settings });
        return virtualSdk.config.batchUpdate(entityType, entityId, settings);
      },
      async batchUpdate(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        recordWrite("config", "batch_update", entityId, entityType, { settings });
        return virtualSdk.config.batchUpdate(entityType, entityId, settings);
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
        return executeManageEntity({ action: "create", parentType, parentId, childType, fields }, creds, env);
      },
      async edit(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        recordWrite("manage_entity", "edit", entityId, entityType, { fields });
        return executeManageEntity({ action: "edit", entityType, entityId, fields }, creds, env);
      },
      async delete(entityType: EntityType, entityId: string) {
        recordWrite("manage_entity", "delete", entityId, entityType, {});
        return executeManageEntity({ action: "delete", entityType, entityId }, creds, env);
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
        return executeManageContact({ action: "create", entityType, entityId, fields }, creds, env, { signal, throttleRate });
      },
      async edit(contactId: string, fields: Record<string, string>) {
        recordWrite("manage_contact", "edit", contactId, "contact", { fields });
        return executeManageContact({ action: "edit", contactId, fields }, creds, env, { signal, throttleRate });
      },
      async delete(contactId: string) {
        recordWrite("manage_contact", "delete", contactId, "contact", {});
        return executeManageContact({ action: "delete", contactId }, creds, env, { signal, throttleRate });
      },
      async attach(entityType: EntityType, entityId: string, contactId: string) {
        recordWrite("manage_contact", "attach", entityId, entityType, { contactId });
        return executeManageContact({ action: "attach", entityType, entityId, contactId }, creds, env, { signal, throttleRate });
      },
      async detach(entityType: EntityType, entityId: string, contactId: string) {
        recordWrite("manage_contact", "detach", entityId, entityType, { contactId });
        return executeManageContact({ action: "detach", entityType, entityId, contactId }, creds, env, { signal, throttleRate });
      },
      async lock(contactId: string) {
        recordWrite("manage_contact", "lock", contactId, "contact", {});
        return executeManageContact({ action: "lock", contactId }, creds, env, { signal, throttleRate });
      },
      async unlock(contactId: string) {
        recordWrite("manage_contact", "unlock", contactId, "contact", {});
        return executeManageContact({ action: "unlock", contactId }, creds, env, { signal, throttleRate });
      },
      async resetPassword(contactId: string, newPassword: string) {
        recordWrite("manage_contact", "reset_password", contactId, "contact", {});
        return executeManageContact({ action: "reset_password", contactId, newPassword }, creds, env, { signal, throttleRate });
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
        const { entityType, entityId, fields } = normalizeMerchantAccountCreateArgs(args);
        recordWrite("manage_merchant_account", "create", entityId, entityType, { fields });
        return executeManageMerchantAccount({ action: "create", entityType, entityId, fields }, creds, env);
      },
      async edit(...args: unknown[]) {
        const { merchantAccountId, fields } = normalizeMerchantAccountEditArgs(args);
        recordWrite("manage_merchant_account", "edit", merchantAccountId, "merchant_account", { fields });
        return executeManageMerchantAccount({ action: "edit", merchantAccountId, fields }, creds, env);
      },
      async update(...args: unknown[]) {
        const { merchantAccountId, fields } = normalizeMerchantAccountEditArgs(args);
        recordWrite("manage_merchant_account", "edit", merchantAccountId, "merchant_account", { fields });
        return executeManageMerchantAccount({ action: "edit", merchantAccountId, fields }, creds, env);
      },
      async delete(merchantAccountId: string) {
        recordWrite("manage_merchant_account", "delete", merchantAccountId, "merchant_account", {});
        return executeManageMerchantAccount({ action: "delete", merchantAccountId }, creds, env);
      },
      async attach(entityType: EntityType, entityId: string, merchantAccountId: string, subTypes: string, currency: string) {
        recordWrite("manage_merchant_account", "attach", entityId, entityType, { merchantAccountId, subTypes, currency });
        return executeManageMerchantAccount({ action: "attach", entityType, entityId, fields: { merchantAccountId, subTypes, currency } }, creds, env);
      },
      async detach(attachedMerchantAccountId: string) {
        recordWrite("manage_merchant_account", "detach", attachedMerchantAccountId, "merchant_account", {});
        return executeManageMerchantAccount({ action: "detach", attachedMerchantAccountId }, creds, env);
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
        return listCardProcessors(pspId, creds, env);
      },
      async listLive(pspId?: string) {
        return listCardProcessors(pspId, creds, env);
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
