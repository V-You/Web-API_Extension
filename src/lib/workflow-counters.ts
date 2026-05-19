/**
 * Workflow contract diagnostic counters (PRD 2026-05-18 Phase 0, D13).
 *
 * Internal-only counters. NOT shown in normal UI. Surfaced only via a dev
 * diagnostics surface or browser console. Per D13 we deliberately do not
 * publish targets or a baseline because headline metrics tend to distort
 * the behaviour they measure.
 *
 * Stored in chrome.storage.local under METRICS_KEY. Bump-only writes plus a
 * small rolling window of recent outcomes for ad-hoc inspection. All writes
 * read-modify-write the single record; no atomic guarantees needed because
 * counter loss under contention is acceptable for a debugging signal.
 */

const METRICS_KEY = "metrics:workflowContracts:v1";
const ROLLING_WINDOW_MAX = 50;

export interface WorkflowContractCounters {
  draftsTotal: number;
  preflightPassFirstTry: number;
  preflightFailRecovered: number;
  preflightFailUnrecovered: number;
  jobsStarted: number;
  jobsLiveWriteFailed: number;
  recent: Array<{ at: string; kind: string; note?: string }>;
}

function emptyCounters(): WorkflowContractCounters {
  return {
    draftsTotal: 0,
    preflightPassFirstTry: 0,
    preflightFailRecovered: 0,
    preflightFailUnrecovered: 0,
    jobsStarted: 0,
    jobsLiveWriteFailed: 0,
    recent: [],
  };
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome?.storage?.local);
}

export async function readWorkflowCounters(): Promise<WorkflowContractCounters> {
  if (!hasChromeStorage()) return emptyCounters();
  const result = await chrome.storage.local.get(METRICS_KEY);
  const stored = result[METRICS_KEY] as Partial<WorkflowContractCounters> | undefined;
  return { ...emptyCounters(), ...stored, recent: Array.isArray(stored?.recent) ? stored!.recent! : [] };
}

async function writeCounters(next: WorkflowContractCounters): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ [METRICS_KEY]: next });
}

export type WorkflowCounterKind =
  | "draft_created"
  | "preflight_pass_first_try"
  | "preflight_fail_recovered"
  | "preflight_fail_unrecovered"
  | "job_started"
  | "job_live_write_failed";

const KIND_TO_FIELD: Record<WorkflowCounterKind, keyof WorkflowContractCounters> = {
  draft_created: "draftsTotal",
  preflight_pass_first_try: "preflightPassFirstTry",
  preflight_fail_recovered: "preflightFailRecovered",
  preflight_fail_unrecovered: "preflightFailUnrecovered",
  job_started: "jobsStarted",
  job_live_write_failed: "jobsLiveWriteFailed",
};

export async function bumpWorkflowCounter(kind: WorkflowCounterKind, note?: string): Promise<void> {
  if (!hasChromeStorage()) return;
  try {
    const current = await readWorkflowCounters();
    const field = KIND_TO_FIELD[kind];
    (current[field] as number) = ((current[field] as number) ?? 0) + 1;
    current.recent.unshift({ at: new Date().toISOString(), kind, note });
    if (current.recent.length > ROLLING_WINDOW_MAX) current.recent.length = ROLLING_WINDOW_MAX;
    await writeCounters(current);
  } catch {
    // Counters are diagnostic - never let a metrics failure break the caller.
  }
}

/** Reset counters. For tests and dev diagnostics. */
export async function resetWorkflowCounters(): Promise<void> {
  if (!hasChromeStorage()) return;
  await writeCounters(emptyCounters());
}
