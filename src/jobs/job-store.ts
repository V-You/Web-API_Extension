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

export type JobSource = "webmcp" | "chat";

export interface JobContextSnapshot {
  entityId?: string;
  entityType?: string;
  entityName?: string;
  section?: string;
  ids?: Record<string, string>;
}

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
  contextSnapshot?: JobContextSnapshot;
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
  /** Originating path for provenance and audit. */
  source?: JobSource;
  /** Timestamp for the one-time Chat automation start audit event. */
  chatStartedAuditAt?: string;
}

export interface JobProgress {
  completedCalls: number;
  totalCalls: number;
  checkpoint?: unknown;
}

// -- Storage key ----------------------------------------------------------

const STORAGE_KEY = "jobs";
const MAX_JOBS = 50;
const MAX_JOBS_BYTES = 200_000;
const EMPTY_JOBS: JobRecord[] = [];

// -- Subscription ---------------------------------------------------------

const listeners = new Set<() => void>();
let cachedJobs: JobRecord[] | null = null;

function emitListeners() {
  for (const fn of listeners) fn();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// -- CRUD -----------------------------------------------------------------

/** Normalize a job record to ensure all fields are valid and safe to render. */
function normalizeJob(raw: unknown): JobRecord {
  const job = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  return {
    id: String(job.id ?? "unknown"),
    label: String(job.label ?? "Untitled"),
    script: String(job.script ?? ""),
    entityId: job.entityId ? String(job.entityId) : undefined,
    entityType: job.entityType ? String(job.entityType) : undefined,
    contextSnapshot: normalizeJobContextSnapshot(job.contextSnapshot),
    state: (job.state ?? "paused") as JobState,
    createdAt: String(job.createdAt ?? new Date().toISOString()),
    startedAt: job.startedAt ? String(job.startedAt) : undefined,
    pausedAt: job.pausedAt ? String(job.pausedAt) : undefined,
    completedAt: job.completedAt ? String(job.completedAt) : undefined,
    totalCalls: Number(job.totalCalls ?? 0),
    completedCalls: Number(job.completedCalls ?? 0),
    throttleRate: Number(job.throttleRate ?? 9),
    elapsedMs: Number(job.elapsedMs ?? 0),
    checkpoint: job.checkpoint, // keep as-is (not rendered)
    results: Array.isArray(job.results) ? job.results : [],
    logs: Array.isArray(job.logs) ? job.logs : [],
    writes: Array.isArray(job.writes) ? job.writes : [],
    error: job.error ? String(job.error) : undefined,
    env: (job.env ?? "uat") as Environment,
    source: job.source === "chat" ? "chat" : job.source === "webmcp" ? "webmcp" : undefined,
    chatStartedAuditAt: job.chatStartedAuditAt ? String(job.chatStartedAuditAt) : undefined,
  };
}

function normalizeJobContextSnapshot(raw: unknown): JobContextSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const ids = source.ids && typeof source.ids === "object" && !Array.isArray(source.ids)
    ? Object.fromEntries(
        Object.entries(source.ids as Record<string, unknown>)
          .filter(([, value]) => typeof value === "string" && value.trim())
          .map(([key, value]) => [key, String(value)]),
      )
    : undefined;
  const snapshot: JobContextSnapshot = {
    entityId: source.entityId ? String(source.entityId) : undefined,
    entityType: source.entityType ? String(source.entityType) : undefined,
    entityName: source.entityName ? String(source.entityName) : undefined,
    section: source.section ? String(source.section) : undefined,
    ...(ids && Object.keys(ids).length > 0 ? { ids } : {}),
  };
  return Object.values(snapshot).some((value) => value !== undefined) ? snapshot : undefined;
}

function normalizeJobs(raw: unknown): JobRecord[] {
  return Array.isArray(raw) ? raw.map(normalizeJob) : [];
}

function cacheJobs(raw: unknown): JobRecord[] {
  cachedJobs = normalizeJobs(raw);
  return cachedJobs;
}

if (typeof chrome !== "undefined") {
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      cacheJobs(changes[STORAGE_KEY].newValue);
      emitListeners();
    }
  });
}

/** Load all jobs from storage. */
export async function loadJobs(options: { fresh?: boolean } = {}): Promise<JobRecord[]> {
  if (!options.fresh && cachedJobs) return cachedJobs;
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return cacheJobs(result[STORAGE_KEY]);
}

/** Load all jobs from storage, bypassing the in-memory cache. */
export async function loadJobsFresh(): Promise<JobRecord[]> {
  return loadJobs({ fresh: true });
}

/** Persist the jobs array. */
async function saveJobs(jobs: JobRecord[]): Promise<void> {
  const trimmed = trimJobsForStorage(jobs);
  await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
  cachedJobs = trimmed;
  emitListeners();
}

function trimJobsForStorage(jobs: JobRecord[]): JobRecord[] {
  const trimmed = jobs.length > MAX_JOBS ? jobs.slice(jobs.length - MAX_JOBS) : [...jobs];
  while (trimmed.length > 1 && JSON.stringify(trimmed).length > MAX_JOBS_BYTES) {
    trimmed.shift();
  }
  return trimmed;
}

/** Get a snapshot for useSyncExternalStore. */
export function getJobsSnapshot(): JobRecord[] {
  return cachedJobs ?? EMPTY_JOBS;
}

/** Create a new job record. Returns the record. */
export async function createJob(
  init: Pick<JobRecord, "label" | "script" | "entityId" | "entityType" | "totalCalls" | "throttleRate" | "env"> & { source?: JobSource; contextSnapshot?: JobContextSnapshot }
): Promise<JobRecord> {
  const job: JobRecord = {
    id: crypto.randomUUID(),
    label: init.label,
    script: init.script,
    entityId: init.entityId,
    entityType: init.entityType,
    contextSnapshot: init.contextSnapshot,
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
    source: init.source,
  };
  const jobs = await loadJobsFresh();
  jobs.push(job);
  await saveJobs(jobs);
  return job;
}

/** Update fields on an existing job. */
export async function updateJob(
  id: string,
  patch: Partial<Omit<JobRecord, "id">>
): Promise<JobRecord | null> {
  const jobs = await loadJobsFresh();
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

/** Get a single job by ID from fresh storage. */
export async function getJobFresh(id: string): Promise<JobRecord | null> {
  const jobs = await loadJobsFresh();
  return jobs.find((j) => j.id === id) ?? null;
}

/** Delete a job by ID. */
export async function deleteJob(id: string): Promise<void> {
  const jobs = await loadJobsFresh();
  const filtered = jobs.filter((j) => j.id !== id);
  await saveJobs(filtered);
}

/** Find jobs that were interrupted (running/paused when browser closed). */
export async function findRecoverableJobs(): Promise<JobRecord[]> {
  const jobs = await loadJobsFresh();
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
