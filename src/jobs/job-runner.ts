/// <reference types="chrome" />

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

import { getJob, getJobFresh, type JobRecord, type JobSource } from "./job-store";
import type { ApiCredentials, Environment } from "../lib/types";

// -- SW message helper with retry -----------------------------------------
// chrome.runtime.sendMessage can fail transiently if the SW is waking up.

const SW_MSG_RETRIES = 3;
const SW_MSG_RETRY_DELAY_MS = 500;
const SW_KEEP_ALIVE_INTERVAL_MS = 20_000;

let keepAlivePort: chrome.runtime.Port | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

function stopJobKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  try { keepAlivePort?.disconnect(); } catch { /* already disconnected */ }
  keepAlivePort = null;
}

function startJobKeepAlive() {
  if (keepAlivePort) return;
  try {
    keepAlivePort = chrome.runtime.connect({ name: "job_keepalive" });
    keepAlivePort.onDisconnect.addListener(() => {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      keepAlivePort = null;
    });
    keepAlivePort.postMessage({ type: "job_keepalive", activeJobId });
    keepAliveTimer = setInterval(() => {
      keepAlivePort?.postMessage({ type: "job_keepalive", activeJobId });
    }, SW_KEEP_ALIVE_INTERVAL_MS);
  } catch {
    stopJobKeepAlive();
  }
}

async function sendToSw<T = unknown>(message: unknown): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SW_MSG_RETRIES; attempt++) {
    try {
      const res = await chrome.runtime.sendMessage(message);
      return res as T;
    } catch (err) {
      lastError = err;
      if (attempt < SW_MSG_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, SW_MSG_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

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
    const res = await sendToSw<{ activeJobId?: string }>({ type: "job_status" });
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
    const jobs = Array.isArray(changes.jobs.newValue) ? changes.jobs.newValue : [];
    const activeJob = jobs.find((job) => job?.id === activeJobId) as { state?: string } | undefined;
    if (activeJob && ["completed", "failed", "paused", "cancelled"].includes(String(activeJob.state))) {
      stopJobKeepAlive();
    }
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
  source?: JobSource;
}

/**
 * Start a new job. Sends the spec to the service worker for execution.
 * Returns the job record.
 */
export async function startJob(input: StartJobInput): Promise<JobRecord> {
  startJobKeepAlive();

  const res = await sendToSw<{ ok: boolean; jobId?: string; error?: string }>({
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
      source: input.source,
    },
  });

  if (!res?.ok || !res.jobId) {
    stopJobKeepAlive();
    throw new Error(res?.error ?? "Failed to start job.");
  }

  activeJobId = res.jobId;
  notifyState();

  const job = await getJobFresh(res.jobId);
  if (!job) {
    stopJobKeepAlive();
    throw new Error("Job created but not found in storage.");
  }
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

  const res = await sendToSw<{ ok: boolean; error?: string }>({
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
  startJobKeepAlive();
  notifyState();
  return job;
}

// -- Pause ----------------------------------------------------------------

/**
 * Pause the active job via the service worker.
 */
export async function pauseJob(): Promise<void> {
  if (!activeJobId) return;
  await sendToSw({ type: "job_pause" });
  activeJobId = null;
  stopJobKeepAlive();
  notifyState();
}

// -- Cancel ---------------------------------------------------------------

/**
 * Cancel the active job permanently via the service worker.
 */
export async function cancelJob(): Promise<void> {
  if (!activeJobId) return;
  await sendToSw({ type: "job_cancel" });
  activeJobId = null;
  stopJobKeepAlive();
  notifyState();
}

/**
 * Cancel a job by ID (even if it's not the active one -- for paused jobs).
 */
export async function cancelJobById(jobId: string): Promise<void> {
  if (activeJobId === jobId) {
    return cancelJob();
  }
  await sendToSw({ type: "job_cancel", jobId });
}
