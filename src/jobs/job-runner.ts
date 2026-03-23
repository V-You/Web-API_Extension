/**
 * Job runner -- side panel messaging proxy.
 *
 * Delegates actual execution to the service worker (background/sw-job-executor.ts).
 * The side panel calls startJob/pauseJob/etc. which send messages to the SW.
 * Job state is tracked via chrome.storage.local and the subscription hooks
 * here provide useSyncExternalStore-compatible state for the React UI.
 *
 * Per PRD 8.1: long-running queries execute in the extension's service worker.
 */

import { getJob, type JobRecord } from "./job-store";
import type { ApiCredentials, Environment } from "../lib/types";

// -- Active job tracking (kept in sync via storage changes) ---------------

let activeJobId: string | null = null;

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

// -- Sync active job state from SW ----------------------------------------

/** Ask the SW for the current active job. */
async function syncActiveJobId(): Promise<void> {
  try {
    const res = await chrome.runtime.sendMessage({ type: "job_status" });
    const newId = res?.activeJobId ?? null;
    if (newId !== activeJobId) {
      activeJobId = newId;
      notifyState();
    }
  } catch {
    // SW may not be running yet
  }
}

// Poll periodically to keep side panel in sync
setInterval(syncActiveJobId, 3_000);

// Also sync when storage changes (job state updates from SW)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.jobs) {
    syncActiveJobId();
  }
});

// Initial sync
syncActiveJobId();

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
 * Start a new job. Sends the spec to the service worker for execution.
 * Returns the job record.
 */
export async function startJob(input: StartJobInput): Promise<JobRecord> {
  const res = await chrome.runtime.sendMessage({
    type: "job_start",
    payload: {
      label: input.label,
      script: input.script,
      entityId: input.entityId,
      entityType: input.entityType,
      totalCalls: input.totalCalls,
      throttleRate: input.throttleRate,
      creds: input.creds,
      env: input.env,
    },
  });

  if (!res?.ok) {
    throw new Error(res?.error ?? "Failed to start job.");
  }

  activeJobId = res.jobId;
  notifyState();

  const job = await getJob(res.jobId);
  if (!job) throw new Error("Job created but not found in storage.");
  return job;
}

// -- Resume ---------------------------------------------------------------

/**
 * Resume a paused or failed job via the service worker.
 */
export async function resumeJob(
  jobId: string,
  creds: ApiCredentials,
  env: Environment,
): Promise<JobRecord | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  const res = await chrome.runtime.sendMessage({
    type: "job_resume",
    payload: {
      jobId,
      label: job.label,
      script: job.script,
      entityId: job.entityId,
      entityType: job.entityType,
      totalCalls: job.totalCalls,
      throttleRate: job.throttleRate,
      creds,
      env,
    },
  });

  if (!res?.ok) {
    throw new Error(res?.error ?? "Failed to resume job.");
  }

  activeJobId = jobId;
  notifyState();
  return job;
}

// -- Pause ----------------------------------------------------------------

/**
 * Pause the active job via the service worker.
 */
export async function pauseJob(): Promise<void> {
  if (!activeJobId) return;
  await chrome.runtime.sendMessage({ type: "job_pause" });
  activeJobId = null;
  notifyState();
}

// -- Cancel ---------------------------------------------------------------

/**
 * Cancel the active job permanently via the service worker.
 */
export async function cancelJob(): Promise<void> {
  if (!activeJobId) return;
  await chrome.runtime.sendMessage({ type: "job_cancel" });
  activeJobId = null;
  notifyState();
}

/**
 * Cancel a job by ID (even if it's not the active one -- for paused jobs).
 */
export async function cancelJobById(jobId: string): Promise<void> {
  if (activeJobId === jobId) {
    return cancelJob();
  }
  await chrome.runtime.sendMessage({ type: "job_cancel", jobId });
}
