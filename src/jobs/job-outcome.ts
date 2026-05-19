/**
 * Job outcome computation (PRD 2026-05-18 D16).
 *
 * Maps script execution into a structured outcome so the UI and the chat
 * redraft loop can react to per-call failure -- not just to whether the
 * top-level script threw.
 *
 * Heuristics for per-result classification (each independently sufficient):
 *
 *   failure
 *     - record.ok === false
 *     - record.status is one of: "failed", "FAILED", "FAILURE", "error", "ERROR"
 *     - record.state === "failed"
 *     - record.error is a non-empty string
 *
 *   success
 *     - record.ok === true
 *     - record.status is one of: "success", "SUCCESS", "ok", "OK", "completed"
 *
 *   ambiguous
 *     - none of the above (counted as neither, but the result is still kept)
 *
 * State mapping (only used when the script ran to completion without
 * throwing -- if it threw, the caller still sets "failed" the usual way):
 *
 *   completed -- failed === 0 AND (succeeded > 0 OR no result-bearing work happened)
 *   partial   -- failed > 0 AND succeeded > 0
 *   failed    -- failed > 0 AND succeeded === 0
 *              OR completedSdkCalls === 0 AND totalCalls > 0
 */

export interface JobOutcomeSummary {
  succeeded: number;
  failed: number;
  ambiguous: number;
  totalRecords: number;
  completedSdkCalls: number;
  totalCalls: number;
  sample: unknown[];
}

export interface JobOutcome {
  state: "completed" | "partial" | "failed";
  summary: JobOutcomeSummary;
}

const FAILURE_STATUS = new Set(["failed", "FAILED", "FAILURE", "error", "ERROR"]);
const SUCCESS_STATUS = new Set(["success", "SUCCESS", "ok", "OK", "completed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFailureRecord(record: Record<string, unknown>): boolean {
  if (record.ok === false) return true;
  if (record.state === "failed") return true;
  if (typeof record.error === "string" && record.error.trim()) return true;
  if (typeof record.status === "string" && FAILURE_STATUS.has(record.status)) return true;
  return false;
}

function isSuccessRecord(record: Record<string, unknown>): boolean {
  if (record.ok === true) return true;
  if (typeof record.status === "string" && SUCCESS_STATUS.has(record.status)) return true;
  return false;
}

export function classifyResult(value: unknown): "failure" | "success" | "ambiguous" {
  if (!isRecord(value)) return "ambiguous";
  if (isFailureRecord(value)) return "failure";
  if (isSuccessRecord(value)) return "success";
  return "ambiguous";
}

export interface ComputeJobOutcomeInput {
  results: unknown[];
  completedSdkCalls: number;
  totalCalls: number;
  /** Max number of sample records to keep on the summary for UI/logs. */
  sampleSize?: number;
}

export function computeJobOutcome(input: ComputeJobOutcomeInput): JobOutcome {
  const { results, completedSdkCalls, totalCalls } = input;
  const sampleSize = input.sampleSize ?? 3;

  let succeeded = 0;
  let failed = 0;
  let ambiguous = 0;
  const failureSamples: unknown[] = [];

  for (const value of results) {
    const verdict = classifyResult(value);
    if (verdict === "failure") {
      failed += 1;
      if (failureSamples.length < sampleSize) failureSamples.push(value);
    } else if (verdict === "success") {
      succeeded += 1;
    } else {
      ambiguous += 1;
    }
  }

  const summary: JobOutcomeSummary = {
    succeeded,
    failed,
    ambiguous,
    totalRecords: results.length,
    completedSdkCalls,
    totalCalls,
    sample: failureSamples,
  };

  // Total-failure case: planned work, nothing got through.
  if (totalCalls > 0 && completedSdkCalls === 0 && succeeded === 0) {
    return { state: "failed", summary };
  }

  if (failed > 0 && succeeded === 0) return { state: "failed", summary };
  if (failed > 0 && succeeded > 0) return { state: "partial", summary };
  return { state: "completed", summary };
}
