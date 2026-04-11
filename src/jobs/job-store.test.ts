import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock chrome.storage.local
const storageStore: Record<string, unknown> = {};
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storageStore[key] })),
      set: vi.fn(async (data: Record<string, unknown>) => {
        Object.assign(storageStore, data);
      }),
    },
  },
});

vi.stubGlobal("crypto", {
  ...globalThis.crypto,
  randomUUID: () => "job-uuid-1234",
});

// Use dynamic import to reset module state between tests
let createJob: typeof import("./job-store").createJob;
let loadJobs: typeof import("./job-store").loadJobs;
let getJob: typeof import("./job-store").getJob;
let updateJob: typeof import("./job-store").updateJob;
let deleteJob: typeof import("./job-store").deleteJob;
let findRecoverableJobs: typeof import("./job-store").findRecoverableJobs;
let subscribe: typeof import("./job-store").subscribe;

import { estimateRuntime, estimateRemaining, type JobRecord } from "./job-store";

describe("job-store", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const key of Object.keys(storageStore)) delete storageStore[key];
    // Re-import module to reset internal cache
    vi.resetModules();
    const mod = await import("./job-store");
    createJob = mod.createJob;
    loadJobs = mod.loadJobs;
    getJob = mod.getJob;
    updateJob = mod.updateJob;
    deleteJob = mod.deleteJob;
    findRecoverableJobs = mod.findRecoverableJobs;
    subscribe = mod.subscribe;
  });

  const jobInit = {
    label: "Test job",
    script: "console.log('hello')",
    entityId: "e1",
    entityType: "psp" as const,
    totalCalls: 10,
    throttleRate: 9,
    env: "uat" as const,
  };

  it("creates a job in paused state", async () => {
    const job = await createJob(jobInit);
    expect(job.id).toBe("job-uuid-1234");
    expect(job.state).toBe("paused");
    expect(job.label).toBe("Test job");
    expect(job.completedCalls).toBe(0);
    expect(job.results).toEqual([]);
    expect(job.logs).toEqual([]);
    expect(job.writes).toEqual([]);
  });

  it("persists to chrome.storage.local", async () => {
    await createJob(jobInit);
    expect(chrome.storage.local.set).toHaveBeenCalled();
    const stored = storageStore.jobs as JobRecord[];
    expect(stored).toHaveLength(1);
    expect(stored[0].label).toBe("Test job");
  });

  it("loads jobs from storage", async () => {
    storageStore.jobs = [{ id: "j1", label: "Stored", state: "completed" }];
    const jobs = await loadJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("j1");
    expect(jobs[0].label).toBe("Stored");
  });

  it("normalizes malformed job records", async () => {
    storageStore.jobs = [{}]; // empty object
    const jobs = await loadJobs();
    expect(jobs[0].id).toBe("unknown");
    expect(jobs[0].label).toBe("Untitled");
    expect(jobs[0].state).toBe("paused");
    expect(jobs[0].results).toEqual([]);
  });

  it("retrieves a single job by ID", async () => {
    await createJob(jobInit);
    const job = await getJob("job-uuid-1234");
    expect(job).not.toBeNull();
    expect(job!.label).toBe("Test job");
  });

  it("returns null for non-existent job", async () => {
    const job = await getJob("non-existent");
    expect(job).toBeNull();
  });

  it("updates job by ID", async () => {
    await createJob(jobInit);
    const updated = await updateJob("job-uuid-1234", { state: "running", completedCalls: 5 });
    expect(updated).not.toBeNull();
    expect(updated!.state).toBe("running");
    expect(updated!.completedCalls).toBe(5);
  });

  it("returns null when updating non-existent job", async () => {
    const result = await updateJob("missing", { state: "failed" });
    expect(result).toBeNull();
  });

  it("deletes a job by ID", async () => {
    await createJob(jobInit);
    await deleteJob("job-uuid-1234");
    const job = await getJob("job-uuid-1234");
    expect(job).toBeNull();
  });

  it("finds recoverable jobs (running or paused)", async () => {
    storageStore.jobs = [
      { id: "j1", state: "running" },
      { id: "j2", state: "completed" },
      { id: "j3", state: "paused" },
      { id: "j4", state: "failed" },
    ];
    // Clear cache by loading fresh
    const recoverable = await findRecoverableJobs();
    expect(recoverable).toHaveLength(2);
    expect(recoverable.map((j) => j.id)).toContain("j1");
    expect(recoverable.map((j) => j.id)).toContain("j3");
  });

  it("notifies subscribers on changes", async () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);

    await createJob(jobInit);
    expect(listener).toHaveBeenCalled();

    unsub();
  });
});

describe("estimateRuntime", () => {
  it("formats seconds for small call counts", () => {
    const { estimatedMs, display } = estimateRuntime(9, 9);
    expect(estimatedMs).toBe(1000);
    expect(display).toContain("1s");
  });

  it("formats minutes for medium call counts", () => {
    const { display } = estimateRuntime(540, 9);
    expect(display).toContain("min");
  });

  it("formats hours for large call counts", () => {
    const { display } = estimateRuntime(50000, 9);
    expect(display).toContain("hours");
  });
});

describe("estimateRemaining", () => {
  it("returns 'almost done' when no calls remain", () => {
    const job = { totalCalls: 10, completedCalls: 10, throttleRate: 9 } as JobRecord;
    expect(estimateRemaining(job)).toBe("almost done");
  });

  it("returns estimate for remaining calls", () => {
    const job = { totalCalls: 100, completedCalls: 10, throttleRate: 9 } as JobRecord;
    const result = estimateRemaining(job);
    expect(result).toContain("90 calls");
  });
});
