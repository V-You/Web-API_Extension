import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock chrome APIs
const storageStore: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};
const storageListeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];
const portDisconnectListeners: Array<() => void> = [];
const mockPort = {
  postMessage: vi.fn(),
  disconnect: vi.fn(() => {
    for (const listener of portDisconnectListeners) listener();
  }),
  onDisconnect: {
    addListener: vi.fn((fn: () => void) => {
      portDisconnectListeners.push(fn);
    }),
  },
};

vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: vi.fn(),
    connect: vi.fn(() => mockPort),
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storageStore[key] })),
      set: vi.fn(async (data: Record<string, unknown>) => Object.assign(storageStore, data)),
    },
    session: {
      get: vi.fn(async (key: string) => ({ [key]: sessionStore[key] })),
      set: vi.fn(async (data: Record<string, unknown>) => Object.assign(sessionStore, data)),
    },
    onChanged: {
      addListener: vi.fn((fn: (changes: Record<string, unknown>, area: string) => void) => {
        storageListeners.push(fn);
      }),
    },
  },
});

vi.stubGlobal("crypto", {
  ...globalThis.crypto,
  randomUUID: () => "runner-uuid-1234",
});

// Need to reset modules between tests because job-runner has module-level side effects
let startJob: typeof import("./job-runner").startJob;
let pauseJob: typeof import("./job-runner").pauseJob;
let cancelJob: typeof import("./job-runner").cancelJob;
let cancelJobById: typeof import("./job-runner").cancelJobById;
let resumeJob: typeof import("./job-runner").resumeJob;
let getActiveJobId: typeof import("./job-runner").getActiveJobId;

describe("job-runner", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    portDisconnectListeners.length = 0;
    for (const key of Object.keys(storageStore)) delete storageStore[key];
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];

    // Seed a job in storage for resume tests
    storageStore.jobs = [{
      id: "job-1",
      label: "Test",
      script: "console.log('hi')",
      state: "paused",
      createdAt: "2026-01-01T00:00:00Z",
      totalCalls: 5,
      completedCalls: 0,
      throttleRate: 9,
      elapsedMs: 0,
      results: [],
      logs: [],
      writes: [],
      env: "uat",
    }];

    vi.resetModules();
    const mod = await import("./job-runner");
    startJob = mod.startJob;
    pauseJob = mod.pauseJob;
    cancelJob = mod.cancelJob;
    cancelJobById = mod.cancelJobById;
    resumeJob = mod.resumeJob;
    getActiveJobId = mod.getActiveJobId;
  });

  const creds = { baseUrl: "https://api.test", username: "u", password: "p" };

  it("starts a job via SW message", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true, jobId: "job-1" });

    const job = await startJob({
      label: "Test",
      script: "console.log('hi')",
      totalCalls: 5,
      creds,
      env: "uat",
    });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "job_start" }),
    );
    expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: "job_keepalive" });
    expect(job.id).toBe("job-1");
    expect(getActiveJobId()).toBe("job-1");
  });

  it("stops the keepalive port when the active job reaches a terminal state", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true, jobId: "job-1" });
    await startJob({ label: "T", script: "x", totalCalls: 1, creds, env: "uat" });

    for (const listener of storageListeners) {
      listener({ jobs: { newValue: [{ ...(storageStore.jobs as Record<string, unknown>[])[0], state: "completed" }] } }, "local");
    }

    expect(mockPort.disconnect).toHaveBeenCalled();
  });

  it("reads the started job from fresh storage after the SW creates it", async () => {
    const { loadJobs } = await import("./job-store");
    await loadJobs();

    storageStore.jobs = [
      ...(storageStore.jobs as unknown[]),
      {
        id: "job-2",
        label: "Fresh job",
        script: "console.log('fresh')",
        state: "running",
        createdAt: "2026-01-01T00:00:00Z",
        totalCalls: 1,
        completedCalls: 0,
        throttleRate: 9,
        elapsedMs: 0,
        results: [],
        logs: [],
        writes: [],
        env: "uat",
      },
    ];
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true, jobId: "job-2" });

    const job = await startJob({
      label: "Fresh job",
      script: "console.log('fresh')",
      totalCalls: 1,
      creds,
      env: "uat",
    });

    expect(job.id).toBe("job-2");
    expect(job.label).toBe("Fresh job");
  });

  it("passes Chat provenance to the SW when supplied", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true, jobId: "job-1" });

    await startJob({
      label: "Chat job",
      script: "console.log('hi')",
      totalCalls: 5,
      creds,
      env: "uat",
      source: "chat",
      runtime: "long_job",
    });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "job_start",
        payload: expect.objectContaining({ source: "chat", runtime: "long_job" }),
      }),
    );
  });

  it("throws when SW reports failure", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: false, error: "Boom" });

    await expect(
      startJob({ label: "X", script: "x", totalCalls: 1, creds, env: "uat" }),
    ).rejects.toThrow("Boom");
  });

  it("retries on SW message failure", async () => {
    // Clear initial sync calls
    vi.mocked(chrome.runtime.sendMessage).mockClear();

    vi.mocked(chrome.runtime.sendMessage)
      .mockRejectedValueOnce(new Error("SW not ready"))
      .mockResolvedValueOnce({ ok: true, jobId: "job-1" });

    const job = await startJob({
      label: "Retry test",
      script: "x",
      totalCalls: 1,
      creds,
      env: "uat",
    });

    // Should have retried: 1 failed + 1 success = 2 calls for the start operation
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(job.id).toBe("job-1");
  });

  it("pauses the active job", async () => {
    // Start first
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true, jobId: "job-1" });
    await startJob({ label: "T", script: "x", totalCalls: 1, creds, env: "uat" });

    // Pause
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true });
    await pauseJob();

    expect(getActiveJobId()).toBeNull();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "job_pause" }),
    );
  });

  it("cancels the active job", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true, jobId: "job-1" });
    await startJob({ label: "T", script: "x", totalCalls: 1, creds, env: "uat" });

    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true });
    await cancelJob();

    expect(getActiveJobId()).toBeNull();
  });

  it("cancels a non-active job by ID", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true });
    await cancelJobById("other-job");

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "job_cancel", jobId: "other-job" }),
    );
  });

  it("resumes a paused job", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true });
    const job = await resumeJob("job-1", creds, "uat");

    expect(job).not.toBeNull();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "job_resume" }),
    );
    expect(getActiveJobId()).toBe("job-1");
  });

  it("returns null when resuming non-existent job", async () => {
    const job = await resumeJob("missing", creds, "uat");
    expect(job).toBeNull();
  });
});
