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

  // Filter out the active job from the recoverable list.
  // A stored running job with no active SW owner is recoverable after worker restart.
  const pausedJobs = orderedJobs.filter(
    (j) => j.id !== activeJob?.id && ["running", "resumed", "paused", "failed"].includes(j.state)
  );

  // Finished jobs, including empty reports so silent completions and cancellations are visible.
  const finishedJobs = orderedJobs.filter(
    (j) => j.id !== activeJob?.id && (j.state === "completed" || j.state === "cancelled")
  );

  if (!activeJob && pausedJobs.length === 0 && finishedJobs.length === 0) {
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
      {activeJob && <ActiveJobCard job={activeJob} />}
      <div className="space-y-2">
        <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">
          Recoverable jobs
        </h3>
        {pausedJobs.length > 0 ? (
          pausedJobs.map((job) => <RecoverableJobCard key={job.id} job={job} />)
        ) : (
          <p className="text-2xs text-slate-400">No recoverable jobs.</p>
        )}
      </div>
      {finishedJobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">
            Finished jobs
          </h3>
          {finishedJobs.map((job) => (
            <CompletedJobCard key={job.id} job={job} />
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
        variant={job.state === "failed" ? "failed" : job.state === "running" ? "default" : "paused"}
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
          {expanded ? "Hide" : "Preview"}
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

function RecoverableJobCard({ job }: { job: JobRecord }) {
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
          {expanded ? "Hide" : "Preview"}
        </button>
        {(job.state === "paused" || job.state === "failed") && <ResumeButton jobId={job.id} />}
        <button
          onClick={() => cancelJobById(job.id).catch((err) => setActionError(err instanceof Error ? err.message : "Failed to discard job"))}
          className="flex-1 px-2 py-1 text-xs font-medium rounded border border-red-300 text-red-700 hover:bg-red-50"
        >
          Discard
        </button>
      </div>
      {expanded && <JobPreview job={job} />}
    </div>
  );
}

function CompletedJobCard({ job }: { job: JobRecord }) {
  const [expanded, setExpanded] = useState(false);

  function downloadJson() {
    const blob = new Blob([JSON.stringify(job.results, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${job.label.replace(/[^a-z0-9]/gi, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadCsv() {
    // Best effort: convert array of objects to CSV
    const items = job.results as Record<string, unknown>[];
    if (items.length === 0) return;
    const keys = [...new Set(items.flatMap((r) => Object.keys(r)))];
    const header = keys.join(",") + "\n";
    const rows = items.map((r) =>
      keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(","),
    );
    const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${job.label.replace(/[^a-z0-9]/gi, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="border border-slate-200 rounded p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium truncate">{job.label}</span>
        <StateBadge state={job.state} />
      </div>
      <div className="text-xs text-slate-500">
        {job.results.length} result(s) &ndash; {job.completedCalls} calls
      </div>
      <div className="flex gap-2">
        <button
          onClick={downloadJson}
          className="flex-1 px-2 py-1 text-xs font-medium rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
        >
          JSON
        </button>
        <button
          onClick={downloadCsv}
          className="flex-1 px-2 py-1 text-xs font-medium rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
        >
          CSV
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-2 py-1 text-xs font-medium rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          {expanded ? "Hide" : "Preview"}
        </button>
      </div>
      {expanded && (
        <JobPreview job={job} />
      )}
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
      note: job.state === "failed" ? "SDK calls completed before the workflow script failed; this is not a successful workflow completion." : undefined,
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
  return `${base} (${pct}%)`;
}

function compareJobsNewestFirst(a: JobRecord, b: JobRecord): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}
