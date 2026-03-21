/**
 * Job runner engine.
 *
 * Manages execution of a single job at a time in the side panel context.
 * Wraps the sandbox with lifecycle management:
 *   - Start: creates job record, runs sandbox, updates progress
 *   - Pause: aborts the sandbox via AbortController, persists state
 *   - Resume: restarts sandbox with checkpoint data
 *   - Cancel: aborts permanently, marks as cancelled
 *
 * The sandbox's `context.checkpoint` and a `progress(completed, total)` helper
 * are injected so the script can report progress and save resume state.
 *
 * This runs in the side panel context (same as tool handlers + sandbox).
 * The service worker coordinates pause-on-tab-close and restart recovery.
 */

import { runSandbox, type SandboxResult } from "../sandbox/sandbox";
import {
  updateJob,
  getJob,
  createJob,
  type JobRecord,
  type JobProgress,
} from "./job-store";
import type { ApiCredentials, Environment } from "../lib/types";

// -- Active job state (singleton) -----------------------------------------

let activeJobId: string | null = null;
let abortController: AbortController | null = null;
let progressCallback: ((p: JobProgress) => void) | null = null;
let segmentStart = 0;

const stateListeners = new Set<() => void>();

function notifyState() {
  for (const fn of stateListeners) fn();
}

/** Subscribe to runner state changes (active job id changes). */
export function subscribeRunner(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => { stateListeners.delete(listener); };
}

/** Get the active job ID (if any). Snapshot for useSyncExternalStore. */
export function getActiveJobId(): string | null {
  return activeJobId;
}

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

// -- Start ----------------------------------------------------------------

export interface StartJobInput {
  label: string;
  script: string;
  entityId?: string;
  entityType?: string;
  totalCalls: number;
  throttleRate?: number;
  creds: ApiCredentials;
  env: Environment;
}

/**
 * Start a new job. Returns the job record immediately.
 * Execution proceeds asynchronously.
 */
export async function startJob(input: StartJobInput): Promise<JobRecord> {
  if (activeJobId) {
    throw new Error("A job is already running. Pause or cancel it first.");
  }

  const job = await createJob({
    label: input.label,
    script: input.script,
    entityId: input.entityId,
    entityType: input.entityType,
    totalCalls: input.totalCalls,
    throttleRate: input.throttleRate ?? 9,
    env: input.env,
  });

  activeJobId = job.id;
  notifyState();

  // Start execution asynchronously
  executeJob(job.id, input.creds, input.env);
  return job;
}

// -- Resume ---------------------------------------------------------------

/**
 * Resume a paused or recovered job.
 */
export async function resumeJob(
  jobId: string,
  creds: ApiCredentials,
  env: Environment
): Promise<JobRecord | null> {
  if (activeJobId) {
    throw new Error("A job is already running. Pause or cancel it first.");
  }

  const job = await getJob(jobId);
  if (!job) return null;
  if (job.state !== "paused" && job.state !== "failed") {
    throw new Error(`Cannot resume job in state "${job.state}".`);
  }

  activeJobId = jobId;
  notifyState();
  executeJob(jobId, creds, env);
  return job;
}

// -- Pause ----------------------------------------------------------------

/**
 * Pause the active job. Aborts sandbox execution and persists state.
 */
export async function pauseJob(): Promise<void> {
  if (!activeJobId) return;
  const jobId = activeJobId;

  // Abort the running sandbox
  abortController?.abort();

  // Flush pending progress
  await flushProgress(jobId, true);

  // Accumulate elapsed time for this segment
  const segmentElapsed = Date.now() - segmentStart;
  const job = await getJob(jobId);
  if (job && job.state === "running") {
    await updateJob(jobId, {
      state: "paused",
      pausedAt: new Date().toISOString(),
      elapsedMs: job.elapsedMs + segmentElapsed,
    });
  }

  cleanup();
}

// -- Cancel ---------------------------------------------------------------

/**
 * Cancel the active job permanently. Partial results are preserved.
 */
export async function cancelJob(): Promise<void> {
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

/**
 * Cancel a job by ID (even if it's not the active one -- for paused jobs).
 */
export async function cancelJobById(jobId: string): Promise<void> {
  if (activeJobId === jobId) {
    return cancelJob();
  }
  await updateJob(jobId, {
    state: "cancelled",
    completedAt: new Date().toISOString(),
  });
}

// -- Internal execution ---------------------------------------------------

function cleanup() {
  activeJobId = null;
  abortController = null;
  progressCallback = null;
  pendingProgress = null;
  notifyState();
}

async function executeJob(
  jobId: string,
  creds: ApiCredentials,
  env: Environment,
) {
  const job = await getJob(jobId);
  if (!job) { cleanup(); return; }

  // Mark as running
  await updateJob(jobId, {
    state: "running",
    startedAt: job.startedAt ?? new Date().toISOString(),
    pausedAt: undefined,
  });

  abortController = new AbortController();
  segmentStart = Date.now();

  // Set up progress callback used by the injected `progress()` function
  progressCallback = (p: JobProgress) => {
    pendingProgress = p;
    flushProgress(jobId);
  };

  const result: SandboxResult = await runSandbox({
    script: job.script,
    creds,
    env,
    entityId: job.entityId,
    entityType: job.entityType,
    timeoutMs: undefined, // no timeout for jobs -- pause/cancel via UI
    // Pass checkpoint + progress callback via the sandbox's context extension
    checkpoint: job.checkpoint,
    progressFn: progressCallback,
    abortSignal: abortController.signal,
  });

  // Flush any remaining progress
  await flushProgress(jobId, true);

  const segmentElapsed = Date.now() - segmentStart;

  // If the abort was triggered by pauseJob() or cancelJob(), they handle
  // the state update. Only update if we're still the active job.
  if (activeJobId !== jobId) return;

  if (result.status === "completed") {
    await updateJob(jobId, {
      state: "completed",
      completedAt: new Date().toISOString(),
      results: [...job.results, ...result.results],
      logs: [...job.logs, ...result.logs],
      writes: [...job.writes, ...result.writes],
      elapsedMs: job.elapsedMs + segmentElapsed,
    });
  } else if (result.status === "timeout") {
    // Sandbox was aborted (pause or cancel handled above)
    // If we're still active, treat as a pause
    await updateJob(jobId, {
      state: "paused",
      pausedAt: new Date().toISOString(),
      results: [...job.results, ...result.results],
      logs: [...job.logs, ...result.logs],
      writes: [...job.writes, ...result.writes],
      elapsedMs: job.elapsedMs + segmentElapsed,
    });
  } else {
    // error
    await updateJob(jobId, {
      state: "failed",
      completedAt: new Date().toISOString(),
      results: [...job.results, ...result.results],
      logs: [...job.logs, ...result.logs],
      writes: [...job.writes, ...result.writes],
      elapsedMs: job.elapsedMs + segmentElapsed,
      error: result.error,
    });
  }

  cleanup();
}
