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

import { useState, useEffect } from "react";
import { useActiveJob, useJobs } from "../../src/jobs/use-jobs";
import { pauseJob, resumeJob, cancelJob, cancelJobById } from "../../src/jobs/job-runner";
import { estimateRemaining, findRecoverableJobs, type JobRecord } from "../../src/jobs/job-store";
import { getCredentials, getActiveEnv } from "../../src/lib/storage";

export function JobMonitor() {
  const activeJob = useActiveJob();
  const jobs = useJobs();
  const [recoverable, setRecoverable] = useState<JobRecord[]>([]);

  useEffect(() => {
    findRecoverableJobs().then(setRecoverable);
  }, [jobs]);

  // Filter out the active job from the recoverable list
  const pausedJobs = recoverable.filter(
    (j) => j.id !== activeJob?.id && (j.state === "paused" || j.state === "failed")
  );

  if (!activeJob && pausedJobs.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        <p className="text-sm">No active or recoverable jobs.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {activeJob && <ActiveJobCard job={activeJob} />}
      {pausedJobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Recoverable jobs
          </h3>
          {pausedJobs.map((job) => (
            <RecoverableJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveJobCard({ job }: { job: JobRecord }) {
  const pct = job.totalCalls > 0
    ? Math.min(100, Math.round((job.completedCalls / job.totalCalls) * 100))
    : 0;
  const remaining = estimateRemaining(job);
  const liveElapsed = job.state === "running"
    ? (() => {
        const startTime = job.startedAt ? Date.parse(job.startedAt) : Date.parse(job.createdAt);
        return isNaN(startTime) ? 0 : Math.max(0, Date.now() - startTime);
      })()
    : 0;
  const elapsed = formatDuration(job.elapsedMs + liveElapsed);

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold truncate">{job.label}</span>
        <StateBadge state={job.state} />
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            job.state === "running" ? "bg-blue-500" : "bg-slate-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{job.completedCalls} / {job.totalCalls} calls ({pct}%)</span>
        <span>{elapsed}</span>
      </div>

      {job.state === "running" && (
        <div className="text-xs text-slate-500">
          Remaining: {remaining}
        </div>
      )}

      {job.error && (
        <div className="text-xs text-red-600 bg-red-50 rounded p-1.5">
          {job.error}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2 pt-1">
        {job.state === "running" && (
          <>
            <button
              onClick={() => pauseJob()}
              className="flex-1 px-2 py-1 text-xs font-medium rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              Pause
            </button>
            <button
              onClick={() => cancelJob()}
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
              onClick={() => cancelJobById(job.id)}
              className="flex-1 px-2 py-1 text-xs font-medium rounded border border-red-300 text-red-700 hover:bg-red-50"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function RecoverableJobCard({ job }: { job: JobRecord }) {
  const pct = job.totalCalls > 0
    ? Math.round((job.completedCalls / job.totalCalls) * 100)
    : 0;

  return (
    <div className="border border-slate-200 rounded p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium truncate">{job.label}</span>
        <StateBadge state={job.state} />
      </div>
      <div className="text-xs text-slate-500">
        {job.completedCalls} / {job.totalCalls} calls ({pct}%)
      </div>
      {job.error && (
        <div className="text-xs text-red-600">{job.error}</div>
      )}
      <div className="flex gap-2">
        <ResumeButton jobId={job.id} />
        <button
          onClick={() => cancelJobById(job.id)}
          className="flex-1 px-2 py-1 text-xs font-medium rounded border border-red-300 text-red-700 hover:bg-red-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function ResumeButton({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState(false);

  async function handleResume() {
    setBusy(true);
    try {
      const env = await getActiveEnv();
      if (!env) throw new Error("No active environment");
      const creds = await getCredentials(env);
      if (!creds) throw new Error("Session not unlocked");
      await resumeJob(jobId, creds, env);
    } catch {
      // swallow -- job store will reflect the state
    }
    setBusy(false);
  }

  return (
    <button
      onClick={handleResume}
      disabled={busy}
      className="flex-1 px-2 py-1 text-xs font-medium rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
    >
      {busy ? "Resuming..." : "Resume"}
    </button>
  );
}

function StateBadge({ state }: { state: string }) {
  const styles: Record<string, string> = {
    running: "bg-blue-100 text-blue-700",
    paused: "bg-amber-100 text-amber-700",
    resumed: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    cancelled: "bg-slate-100 text-slate-500",
  };
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${styles[state] ?? "bg-slate-100 text-slate-500"}`}>
      {state}
    </span>
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
