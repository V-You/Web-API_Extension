/**
 * Job monitor component.
 *
 * Shows the active job's progress and controls, plus a list of
 * recoverable (paused/failed) jobs with resume/cancel options.
 *
 * Per PRD section 6.3 (v1 -- barebones):
 *   - State: running / paused / completed / failed / cancelled
 *   - Estimated time remaining
 *   - Actual progress: calls completed / total estimated
 *   - Elapsed time
 */

import { useEffect, useState } from "react";
import { useActiveJob, useJobs } from "../../src/jobs/use-jobs";
import { pauseJob, resumeJob, cancelJob, cancelJobById } from "../../src/jobs/job-runner";
import { estimateRemaining, type JobRecord } from "../../src/jobs/job-store";
import { getCredentials, getActiveEnv } from "../../src/lib/storage";
import { Badge, ProgressBar } from "../components";

type BadgeVariant = "info" | "write" | "status-ok" | "status-fail" | "neutral";
const STATE_BADGE: Record<string, BadgeVariant> = {
  running: "info",
  resumed: "info",
  paused: "write",
  completed: "status-ok",
  partial: "write",
  failed: "status-fail",
  cancelled: "neutral",
};

function StateBadge({ state }: { state: string }) {
  return <Badge variant={STATE_BADGE[state] ?? "neutral"}>{state}</Badge>;
}

export function JobMonitor() {
  const activeJob = useActiveJob();
  const jobs = useJobs();
  const orderedJobs = [...jobs].sort(compareJobsNewestFirst);

  const storedJobs = orderedJobs.filter((job) => job.id !== activeJob?.id);
  const storageBytes = JSON.stringify(jobs).length;
  const storagePressure = jobs.length >= 45 || storageBytes >= 180_000;

  if (!activeJob && storedJobs.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        <p className="text-sm">No active or recoverable jobs.</p>
        <p className="text-2xs mt-1 text-slate-400">
          Jobs are created when a WebMCP agent runs a workflow script or Chat starts a reviewed Draft Job.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {storagePressure && (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-2xs text-amber-700">
          Job storage is near its local retention limit ({jobs.length} jobs, {Math.round(storageBytes / 1024)} KB). Older jobs may rotate out.
        </div>
      )}
      {activeJob && <ActiveJobCard job={activeJob} />}
      {storedJobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">
            Recent jobs
          </h3>
          {storedJobs.map((job) => (
            <StoredJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveJobCard({ job }: { job: JobRecord }) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (job.state !== "running") return;
    const interval = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [job.state]);

  const pct = job.totalCalls > 0
    ? Math.min(100, Math.round((job.completedCalls / job.totalCalls) * 100))
    : 0;
  const progressText = formatJobProgress(job, pct);
  const remaining = estimateRemaining(job);
  const liveElapsed = job.state === "running"
    ? (() => {
        const startTime = job.startedAt ? Date.parse(job.startedAt) : Date.parse(job.createdAt);
        return isNaN(startTime) ? 0 : Math.max(0, Date.now() - startTime);
      })()
    : 0;
  const elapsed = formatDuration(job.elapsedMs + liveElapsed);

  async function handlePause() {
    setActionError(null);
    try { await pauseJob(); }
    catch (err) { setActionError(err instanceof Error ? err.message : "Failed to pause job"); }
  }

  async function handleCancel() {
    setActionError(null);
    try { await cancelJob(); }
    catch (err) { setActionError(err instanceof Error ? err.message : "Failed to cancel job"); }
  }

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold truncate">{job.label}</span>
        <div className="flex items-center gap-1">
          <StateBadge state={job.state} />
        </div>
      </div>

      <ProgressBar
        value={pct}
        variant={job.state === "failed" ? "failed" : job.state === "partial" ? "paused" : job.state === "running" ? "default" : "paused"}
        aria-label={progressText}
      />

      {/* Stats */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{progressText}</span>
        <span>{elapsed}</span>
      </div>
      {job.source && (
        <div className="text-2xs text-slate-400">Source: {job.source}</div>
      )}

      {job.state === "running" && (
        <div className="text-xs text-slate-500">
          Remaining: {remaining}
        </div>
      )}

      {typeof job.checkpoint === "string" && job.checkpoint && (
        <div className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
          {job.checkpoint}
        </div>
      )}

      {job.error && (
        <div className="text-xs text-red-600 bg-red-50 rounded p-1.5">
          {job.error}
        </div>
      )}

      {actionError && (
        <div className="text-xs text-red-600 bg-red-50 rounded p-1.5">
          {actionError}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 px-2 py-1 text-xs font-medium rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          {expanded ? "Hide" : "Show"}
        </button>
        {job.state === "running" && (
          <>
            <button
              onClick={handlePause}
              className="flex-1 px-2 py-1 text-xs font-medium rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              Pause
            </button>
            <button
              onClick={handleCancel}
              className="flex-1 px-2 py-1 text-xs font-medium rounded border border-red-300 text-red-700 hover:bg-red-50"
            >
              Cancel
            </button>
          </>
        )}
        {job.state === "paused" && (
          <>
            <ResumeButton jobId={job.id} />
            <button
              onClick={() => cancelJobById(job.id).catch((err) => setActionError(err instanceof Error ? err.message : "Failed to cancel job"))}
              className="flex-1 px-2 py-1 text-xs font-medium rounded border border-red-300 text-red-700 hover:bg-red-50"
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {expanded && <JobPreview job={job} />}
    </div>
  );
}

function StoredJobCard({ job }: { job: JobRecord }) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const pct = job.totalCalls > 0
    ? Math.round((job.completedCalls / job.totalCalls) * 100)
    : 0;
  const progressText = formatJobProgress(job, pct);

  return (
    <div className="border border-slate-200 rounded p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium truncate">{job.label}</span>
        <StateBadge state={job.state} />
      </div>
      <div className="text-xs text-slate-500">
        {progressText}
      </div>
      {job.error && (
        <div className="text-xs text-red-600">{job.error}</div>
      )}
      {actionError && (
        <div className="text-xs text-red-600">{actionError}</div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 px-2 py-1 text-xs font-medium rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          {expanded ? "Hide" : "Show"}
        </button>
        {(job.state === "paused" || job.state === "failed") && <ResumeButton jobId={job.id} />}
        {["running", "resumed", "paused", "failed"].includes(job.state) && (
          <button
            onClick={() => cancelJobById(job.id).catch((err) => setActionError(err instanceof Error ? err.message : "Failed to discard job"))}
            className="flex-1 px-2 py-1 text-xs font-medium rounded border border-red-300 text-red-700 hover:bg-red-50"
          >
            Discard
          </button>
        )}
      </div>
      {expanded && <JobPreview job={job} />}
    </div>
  );
}

function JobPreview({ job }: { job: JobRecord }) {
  const payload = {
    state: job.state,
    label: job.label,
    source: job.source,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    pausedAt: job.pausedAt,
    completedAt: job.completedAt,
    progress: {
      completedCalls: job.completedCalls,
      totalCalls: job.totalCalls,
      throttleRate: job.throttleRate,
      checkpoint: job.checkpoint,
      workflowCompleted: job.state === "completed",
      note:
        job.state === "failed"
          ? "SDK calls completed before the workflow script failed; this is not a successful workflow completion."
          : job.state === "partial"
            ? `Workflow ran to completion but ${job.summary?.failed ?? 0}/${job.summary?.totalRecords ?? 0} recorded calls failed. Inspect results to redraft.`
            : undefined,
    },
    error: job.error,
    context: {
      entityType: job.entityType,
      entityId: job.entityId,
      env: job.env,
    },
    script: job.script,
    logs: job.logs,
    writes: job.writes,
    results: job.results,
  };

  return (
    <pre className="mt-1 p-2 bg-slate-50 rounded text-2xs text-slate-600 overflow-x-auto max-h-56">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

function ResumeButton({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResume() {
    setBusy(true);
    setError(null);
    try {
      const env = await getActiveEnv();
      if (!env) throw new Error("No active environment");
      const creds = await getCredentials(env);
      if (!creds) throw new Error("Session not unlocked");
      await resumeJob(jobId, creds, env);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume");
    }
    setBusy(false);
  }

  return (
    <div className="flex-1">
      <button
        onClick={handleResume}
        disabled={busy}
        className="w-full px-2 py-1 text-xs font-medium rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
      >
        {busy ? "Resuming..." : "Resume"}
      </button>
      {error && <div className="text-xs text-red-600 mt-0.5">{error}</div>}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "< 1s";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function formatJobProgress(job: JobRecord, pct: number): string {
  const base = `${job.completedCalls} / ${job.totalCalls} SDK call(s)`;
  if (job.state === "failed") return `${base} completed before failure`;
  if (job.state === "partial") {
    const ok = job.summary?.succeeded ?? 0;
    const bad = job.summary?.failed ?? 0;
    return `${base} (${ok} ok / ${bad} failed)`;
  }
  return `${base} (${pct}%)`;
}

function compareJobsNewestFirst(a: JobRecord, b: JobRecord): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}
