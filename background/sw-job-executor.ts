/**
 * Service worker job executor.
 *
 * Runs long-running job scripts in the service worker context per PRD 8.1.
 * Reuses tool handlers (which are SW-safe -- they only use fetch + chrome.storage)
 * but skips the confirm bridge (writes during a job are pre-approved at start time).
 *
 * The side panel initiates jobs and monitors progress via chrome.storage.local.
 * The SW owns the actual execution lifecycle: start, pause, resume, cancel.
 */

import { createJob, updateJob, getJob, type JobRecord, type JobProgress } from "../src/jobs/job-store";
import { executeManageEntity } from "../src/tools/manage-entity";
import { executeGetHierarchy } from "../src/tools/get-hierarchy";
import { executeManageContact } from "../src/tools/manage-contact";
import { executeManageMerchantAccount } from "../src/tools/manage-merchant-account";
import { executeLookupClearingInstitutes } from "../src/tools/lookup-clearing-institutes";
import { executeDescribeSettings } from "../src/tools/describe-settings";
import { executeManageSettings } from "../src/tools/manage-settings";
import { executeGetAuditLog, type GetAuditLogInput } from "../src/tools/get-audit-log";
import { createSdk, type SdkContext } from "../src/sdk/sdk";
import type { EntityType } from "../src/lib/entity-types";
import type { ApiCredentials, Environment } from "../src/lib/types";

// -- Active job state (singleton per SW) ----------------------------------

let activeJobId: string | null = null;
let abortController: AbortController | null = null;
let segmentStart = 0;

// -- Progress persistence -------------------------------------------------

const PROGRESS_FLUSH_INTERVAL = 5_000;
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

// -- TS annotation stripping (same as sandbox.ts) -------------------------

function stripTypeAnnotations(src: string): string {
  let code = src.replace(/^[ \t]*(export\s+)?(interface|type)\s+\w[\s\S]*?^[ \t]*}/gm, "");
  code = code.replace(/\bas\s+\w+(\[\])?(\s*[<][^>]*[>])?\b/g, "");
  code = code.replace(
    /(\w)\s*:\s*(string|number|boolean|any|unknown|void|never|null|undefined|Record<[^>]+>|Array<[^>]+>|\w+\[\]|\w+)(\s*[,)=;\n])/g,
    "$1$3",
  );
  code = code.replace(/(\w+)\s*<[^>]+>\s*\(/g, "$1(");
  return code;
}

// -- SDK facade for SW (no confirm bridge) --------------------------------

interface WriteRecord {
  tool: string;
  action: string;
  entityId: string;
  entityType: string;
  params: Record<string, unknown>;
  timestamp: string;
}

function buildSwSdk(creds: ApiCredentials, env: Environment, writes: WriteRecord[]) {
  const ctx: SdkContext = { creds, env };
  const virtualSdk = createSdk(ctx);

  function recordWrite(
    tool: string, action: string,
    entityId: string, entityType: string,
    params: Record<string, unknown>,
  ) {
    writes.push({ tool, action, entityId, entityType, params, timestamp: new Date().toISOString() });
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
    entities: {
      async get(entityType: EntityType, entityId: string) {
        return executeManageEntity({ action: "get", entityType, entityId }, creds, env);
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
        return executeManageContact({ action: "get", contactId }, creds, env);
      },
      async list(entityType: EntityType, entityId: string, scope?: "owned" | "attached") {
        return executeManageContact({ action: "list", entityType, entityId, scope }, creds, env);
      },
      async create(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        recordWrite("manage_contact", "create", entityId, entityType, { fields });
        return executeManageContact({ action: "create", entityType, entityId, fields }, creds, env);
      },
      async edit(contactId: string, fields: Record<string, string>) {
        recordWrite("manage_contact", "edit", contactId, "contact", { fields });
        return executeManageContact({ action: "edit", contactId, fields }, creds, env);
      },
      async delete(contactId: string) {
        recordWrite("manage_contact", "delete", contactId, "contact", {});
        return executeManageContact({ action: "delete", contactId }, creds, env);
      },
      async attach(entityType: EntityType, entityId: string, contactId: string) {
        recordWrite("manage_contact", "attach", entityId, entityType, { contactId });
        return executeManageContact({ action: "attach", entityType, entityId, contactId }, creds, env);
      },
      async detach(entityType: EntityType, entityId: string, contactId: string) {
        recordWrite("manage_contact", "detach", entityId, entityType, { contactId });
        return executeManageContact({ action: "detach", entityType, entityId, contactId }, creds, env);
      },
      async lock(contactId: string) {
        recordWrite("manage_contact", "lock", contactId, "contact", {});
        return executeManageContact({ action: "lock", contactId }, creds, env);
      },
      async unlock(contactId: string) {
        recordWrite("manage_contact", "unlock", contactId, "contact", {});
        return executeManageContact({ action: "unlock", contactId }, creds, env);
      },
      async resetPassword(contactId: string, newPassword: string) {
        recordWrite("manage_contact", "reset_password", contactId, "contact", {});
        return executeManageContact({ action: "reset_password", contactId, newPassword }, creds, env);
      },
    },
    merchantAccounts: {
      async get(merchantAccountId: string) {
        return executeManageMerchantAccount({ action: "get", merchantAccountId }, creds, env);
      },
      async list(entityType: EntityType, entityId: string, scope?: "owned" | "attached") {
        return executeManageMerchantAccount({ action: "list", entityType, entityId, scope }, creds, env);
      },
      async create(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        recordWrite("manage_merchant_account", "create", entityId, entityType, { fields });
        return executeManageMerchantAccount({ action: "create", entityType, entityId, fields }, creds, env);
      },
      async edit(merchantAccountId: string, fields: Record<string, string>) {
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
    describeSettings(query: string, limit?: number) {
      return executeDescribeSettings({ query, limit });
    },
    audit: {
      async get(opts?: GetAuditLogInput) {
        return executeGetAuditLog(opts ?? {});
      },
    },
  };
}

// -- AsyncFunction constructor --------------------------------------------

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

// -- Job execution --------------------------------------------------------

interface LogEntry {
  level: "log" | "warn" | "error";
  args: unknown[];
  timestamp: string;
}

export interface SwJobStartInput {
  jobId?: string; // existing job id for resume, or undefined for new
  label: string;
  script: string;
  entityId?: string;
  entityType?: string;
  totalCalls: number;
  throttleRate?: number;
  creds: ApiCredentials;
  env: Environment;
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
      env: input.env,
    });
  }

  activeJobId = job.id;
  executeInSw(job.id, input.creds, input.env);
  return { ok: true, jobId: job.id };
}

/** Pause the active job. */
export async function swPauseJob(): Promise<void> {
  if (!activeJobId) return;
  const jobId = activeJobId;
  abortController?.abort();
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
}

async function executeInSw(jobId: string, creds: ApiCredentials, env: Environment) {
  const job = await getJob(jobId);
  if (!job) { cleanup(); return; }

  await updateJob(jobId, {
    state: "running",
    startedAt: job.startedAt ?? new Date().toISOString(),
    pausedAt: undefined,
  });

  abortController = new AbortController();
  const { signal } = abortController;
  segmentStart = Date.now();

  const logs: LogEntry[] = [];
  const results: unknown[] = [];
  const writes: WriteRecord[] = [];

  const sdk = buildSwSdk(creds, env, writes);

  const consoleProxy = {
    log: (...args: unknown[]) => logs.push({ level: "log", args, timestamp: new Date().toISOString() }),
    warn: (...args: unknown[]) => logs.push({ level: "warn", args, timestamp: new Date().toISOString() }),
    error: (...args: unknown[]) => logs.push({ level: "error", args, timestamp: new Date().toISOString() }),
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });

  const progress = (completedCalls: number, totalCalls: number, checkpoint?: unknown) => {
    pendingProgress = { completedCalls, totalCalls, checkpoint };
    flushProgress(jobId);
  };

  const context = {
    entityId: job.entityId ?? null,
    entityType: job.entityType ?? null,
    env,
    checkpoint: job.checkpoint ?? null,
  };

  const jsCode = stripTypeAnnotations(job.script);

  try {
    const fn = new AsyncFunction(
      "sdk", "console", "sleep", "results", "context", "signal", "progress",
      jsCode,
    );

    await fn(sdk, consoleProxy, sleep, results, context, signal, progress);

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
