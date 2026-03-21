/**
 * React hooks for job state.
 *
 * useJobs()     -- subscribe to the full job list
 * useActiveJob() -- subscribe to the currently running job ID
 */

import { useSyncExternalStore, useEffect, useState } from "react";
import {
  subscribe,
  getJobsSnapshot,
  loadJobs,
  type JobRecord,
} from "./job-store";
import {
  subscribeRunner,
  getActiveJobId,
} from "./job-runner";

/**
 * Subscribe to the full job list (for run history / recovery UI).
 * Triggers initial load on mount.
 */
export function useJobs(): JobRecord[] {
  const [loaded, setLoaded] = useState(false);
  const jobs = useSyncExternalStore(subscribe, getJobsSnapshot, getJobsSnapshot);

  useEffect(() => {
    if (!loaded) {
      loadJobs().then(() => setLoaded(true));
    }
  }, [loaded]);

  return jobs;
}

/** Subscribe to the active job ID. */
export function useActiveJobId(): string | null {
  return useSyncExternalStore(subscribeRunner, getActiveJobId, getActiveJobId);
}

/** Get the active job record (combines both subscriptions). */
export function useActiveJob(): JobRecord | null {
  const jobs = useJobs();
  const activeId = useActiveJobId();
  if (!activeId) return null;
  return jobs.find((j) => j.id === activeId) ?? null;
}
