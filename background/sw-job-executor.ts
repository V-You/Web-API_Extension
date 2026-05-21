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
import type { WorkflowRuntime } from "../src/chat/workflow-runtime";
import { computeJobOutcome } from "../src/jobs/job-outcome";
import { wrapSdkWithGuard } from "../src/sandbox/sdk-guard";
import { appendAuditEntry } from "../src/lib/api-client";
import { compileSandboxScript, type WriteRecord, type LogEntry } from "../src/sandbox";
import { executeManageEntity } from "../src/tools/manage-entity";
import { executeLookupClearingInstitutes } from "../src/tools/lookup-clearing-institutes";
import { staticWorkflowPreflight } from "../src/chat/workflow-static-preflight";
import { bumpWorkflowCounter } from "../src/lib/workflow-counters";
import { RecoverableToolError } from "../src/tools/recoverable-error";
import { createWorkflowSdk } from "../src/sdk/workflow-sdk";
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
  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function unwrapApiData(result: unknown): unknown {
    if (result && typeof result === "object" && "data" in result) {
      return (result as { data: unknown }).data;
    }
    return result;
  }

  function recordWrite(
    tool: string, action: string,
    entityId: string, entityType: string,
    params: Record<string, unknown>,
  ) {
    writes.push({ tool, action, entityId, entityType, params, timestamp: new Date().toISOString() });
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

  const facade = createWorkflowSdk({
    creds,
    env,
    host: {
      entityWriteTransport: "internalHandler",
      contactWriteTransport: "internalHandler",
      merchantAccountWriteTransport: "internalHandler",
      signal,
      throttleRate,
      mapEntityGetResult: unwrapApiData,
      mapContactGetResult: unwrapApiData,
      resolveCardProcessorPspId: pspIdForLiveCardProcessors,
      resolveMerchantAccountCreateFields: resolveMerchantAccountClearingInstitute,
      validateMerchantAccountEditFields: true,
      bypassTransactionConfirmation: true,
      includeManagementNamespace: true,
      mapManagementEntityGetResult: unwrapApiData,
      beforeSettingsWrite: async (preview) => {
        await assertWorkflowTarget(preview.entityType as EntityType, preview.entityId, preview.description);
        recordWrite(preview.tool, preview.action, preview.entityId, preview.entityType, preview.params);
      },
      beforeEntityWrite: async (preview) => {
        await assertWorkflowTarget(preview.entityType as EntityType, preview.entityId, preview.description);
        recordWrite(preview.tool, preview.action, preview.entityId, preview.entityType, preview.params);
      },
      beforeContactWrite: async (preview) => {
        recordWrite(preview.tool, preview.action, preview.entityId, preview.entityType, preview.params);
      },
      beforeMerchantAccountWrite: async (preview) => {
        if (preview.action === "create" || preview.action === "attach") {
          await assertWorkflowTarget(preview.entityType as EntityType, preview.entityId, preview.description);
        }
        recordWrite(preview.tool, preview.action, preview.entityId, preview.entityType, preview.params);
      },
      recordTransactionWrite: (record) => recordWrite(record.tool, record.action, record.entityId, record.entityType, record.params),
      resolveTransactionParams: async (params, mode) => {
        const channelId = String(
          params.channelId
            ?? runtimeContext?.ids?.channelId
            ?? (runtimeContext?.entityType === "channel" ? runtimeContext.entityId : "")
            ?? "",
        ).trim();
        const merchantId = await resolveTransactionMerchantId(params, channelId);
        return {
          ...params,
          channelId,
          merchantId,
          ...(mode === "batch" ? { count: params.count ?? params.total ?? 3 } : {}),
          contextProvenance: params.contextProvenance ?? "Merchant derived by Job runtime from current Channel context or Channel GET.",
        };
      },
    },
  });

  // PRD 2026-05-18 D14: parity with the sandbox facade -- unknown SDK
  // members raise a structured suggestion instead of silently being
  // undefined.
  return wrapSdkWithGuard(facade, { passthroughNamespaces: ["config"] });
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
  runtime?: WorkflowRuntime;
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
    const preflight = staticWorkflowPreflight(input.script);
    if (!preflight.ok) {
      return {
        ok: false,
        jobId: "",
        error: preflight.message ?? "Workflow preflight found contract violations.",
      };
    }

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
      runtime: input.runtime,
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

    const mergedResults = [...job.results, ...results];
    const outcome = computeJobOutcome({
      results: mergedResults,
      completedSdkCalls: activeSandboxRuntime?.completedSdkCalls ?? job.completedCalls,
      totalCalls: job.totalCalls,
    });

    await updateJob(jobId, {
      state: outcome.state,
      completedAt: new Date().toISOString(),
      results: mergedResults,
      logs: [...job.logs, ...logs],
      writes: [...job.writes, ...writes],
      elapsedMs: job.elapsedMs + segmentElapsed,
      summary: outcome.summary,
      error: outcome.state === "failed"
        ? `Workflow ran to completion but ${outcome.summary.failed}/${outcome.summary.totalRecords} recorded calls failed.`
        : undefined,
    });
    if (outcome.state === "failed" || outcome.state === "partial") {
      void bumpWorkflowCounter("job_live_write_failed", outcome.state);
    }
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
      const mergedResults = [...job.results, ...results];
      const outcome = computeJobOutcome({
        results: mergedResults,
        completedSdkCalls: activeSandboxRuntime?.completedSdkCalls ?? job.completedCalls,
        totalCalls: job.totalCalls,
      });
      await updateJob(jobId, {
        state: "failed",
        completedAt: new Date().toISOString(),
        results: mergedResults,
        logs: [...job.logs, ...logs],
        writes: [...job.writes, ...writes],
        elapsedMs: job.elapsedMs + segmentElapsed,
        summary: outcome.summary,
        error: err instanceof Error ? err.message : String(err),
      });
      void bumpWorkflowCounter("job_live_write_failed", "throw");
    }
  }

  cleanup();
}
