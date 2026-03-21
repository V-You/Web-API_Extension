/**
 * Job state store.
 *
 * Persists job records to chrome.storage.local under the "jobs" key.
 * Provides CRUD, subscription for React integration via
 * useSyncExternalStore, and recovery detection for browser restarts.
 *
 * Key points per PRD:
 *   - States: running, paused, cancelled, failed, completed (section 8.3)
 *   - Persisted to chrome.storage.local for browser-restart recovery (8.4)
 *   - Runtime estimation from totalCalls / throttleRate (8.5)
 */

import type { Environment, JobState } from "../lib/types";
import type { WriteRecord } from "../sandbox/sdk-facade";
import type { LogEntry } from "../sandbox/sandbox";

// -- Types ----------------------------------------------------------------

export interface JobRecord {
  id: string;
  /** Human-readable label (e.g., "Hierarchy audit for PSP 8ac7.."). */
  label: string;
  /** The script source to execute. */
  script: string;
  /** Entity context. */
  entityId?: string;
  entityType?: string;
  /** Lifecycle state. */
  state: JobState;
  /** Timestamps. */
  createdAt: string;
  startedAt?: string;
  pausedAt?: string;
  completedAt?: string;
  /** Progress tracking. */
  totalCalls: number;
  completedCalls: number;
  throttleRate: number;
  /** Elapsed milliseconds (accumulated across pause/resume cycles). */
  elapsedMs: number;
  /** Opaque checkpoint blob the script can use to resume. */
  checkpoint?: unknown;
  /** Collected results. */
  results: unknown[];
  /** Captured console logs. */
  logs: LogEntry[];
  /** Write operations recorded during execution. */
  writes: WriteRecord[];
  /** Error message (if state is "failed"). */
  error?: string;
  /** Environment this job runs against. */
  env: Environment;
}

export interface JobProgress {
  completedCalls: number;
  totalCalls: number;
  checkpoint?: unknown;
}

// -- Storage key ----------------------------------------------------------

const STORAGE_KEY = "jobs";
const MAX_JOBS = 100;

// -- Subscription ---------------------------------------------------------

const listeners = new Set<() => void>();
let cachedJobs: JobRecord[] | null = null;

function notifyListeners() {
  cachedJobs = null; // invalidate
  for (const fn of listeners) fn();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// -- CRUD -----------------------------------------------------------------

/** Load all jobs from storage. */
export async function loadJobs(): Promise<JobRecord[]> {
  if (cachedJobs) return cachedJobs;
  const result = await chrome.storage.local.get(STORAGE_KEY);
  cachedJobs = (result[STORAGE_KEY] ?? []) as JobRecord[];
  return cachedJobs;
}

/** Persist the jobs array. */
async function saveJobs(jobs: JobRecord[]): Promise<void> {
  // Trim to max, keeping newest
  const trimmed = jobs.length > MAX_JOBS ? jobs.slice(jobs.length - MAX_JOBS) : jobs;
  await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
  cachedJobs = trimmed;
  notifyListeners();
}

/** Get a snapshot for useSyncExternalStore. */
export function getJobsSnapshot(): JobRecord[] {
  return cachedJobs ?? [];
}

/** Create a new job record. Returns the record. */
export async function createJob(
  init: Pick<JobRecord, "label" | "script" | "entityId" | "entityType" | "totalCalls" | "throttleRate" | "env">
): Promise<JobRecord> {
  const job: JobRecord = {
    id: crypto.randomUUID(),
    label: init.label,
    script: init.script,
    entityId: init.entityId,
    entityType: init.entityType,
    state: "paused",
    createdAt: new Date().toISOString(),
    totalCalls: init.totalCalls,
    completedCalls: 0,
    throttleRate: init.throttleRate,
    elapsedMs: 0,
    results: [],
    logs: [],
    writes: [],
    env: init.env,
  };
  const jobs = await loadJobs();
  jobs.push(job);
  await saveJobs(jobs);
  return job;
}

/** Update fields on an existing job. */
export async function updateJob(
  id: string,
  patch: Partial<Omit<JobRecord, "id">>
): Promise<JobRecord | null> {
  const jobs = await loadJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return null;
  Object.assign(jobs[idx], patch);
  await saveJobs(jobs);
  return jobs[idx];
}

/** Get a single job by ID. */
export async function getJob(id: string): Promise<JobRecord | null> {
  const jobs = await loadJobs();
  return jobs.find((j) => j.id === id) ?? null;
}

/** Delete a job by ID. */
export async function deleteJob(id: string): Promise<void> {
  const jobs = await loadJobs();
  const filtered = jobs.filter((j) => j.id !== id);
  await saveJobs(filtered);
}

/** Find jobs that were interrupted (running/paused when browser closed). */
export async function findRecoverableJobs(): Promise<JobRecord[]> {
  const jobs = await loadJobs();
  return jobs.filter((j) => j.state === "running" || j.state === "paused" || j.state === "resumed");
}

// -- Estimation -----------------------------------------------------------

/**
 * Estimate runtime for a given call count at a throttle rate.
 * Returns { estimatedMs, display } where display is human-readable.
 */
export function estimateRuntime(
  totalCalls: number,
  throttleRate = 9
): { estimatedMs: number; display: string } {
  const estimatedMs = Math.ceil((totalCalls / throttleRate) * 1000);

  if (estimatedMs < 60_000) {
    const secs = Math.ceil(estimatedMs / 1000);
    return { estimatedMs, display: `~${secs}s (${totalCalls} calls at ${throttleRate} req/s)` };
  }
  if (estimatedMs < 3_600_000) {
    const mins = Math.ceil(estimatedMs / 60_000);
    return { estimatedMs, display: `~${mins} min (${totalCalls} calls at ${throttleRate} req/s)` };
  }
  const hours = (estimatedMs / 3_600_000).toFixed(1);
  return { estimatedMs, display: `~${hours} hours (${totalCalls} calls at ${throttleRate} req/s)` };
}

/**
 * Estimate remaining runtime given progress so far.
 */
export function estimateRemaining(job: JobRecord): string {
  const remaining = job.totalCalls - job.completedCalls;
  if (remaining <= 0) return "almost done";
  return estimateRuntime(remaining, job.throttleRate).display;
}
