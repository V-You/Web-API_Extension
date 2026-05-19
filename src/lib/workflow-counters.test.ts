import { beforeEach, describe, expect, it, vi } from "vitest";

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

let bumpWorkflowCounter: typeof import("./workflow-counters").bumpWorkflowCounter;
let readWorkflowCounters: typeof import("./workflow-counters").readWorkflowCounters;
let resetWorkflowCounters: typeof import("./workflow-counters").resetWorkflowCounters;

describe("workflow-counters (PRD 2026-05-18 Phase 0)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const key of Object.keys(storageStore)) delete storageStore[key];
    vi.resetModules();
    const mod = await import("./workflow-counters");
    bumpWorkflowCounter = mod.bumpWorkflowCounter;
    readWorkflowCounters = mod.readWorkflowCounters;
    resetWorkflowCounters = mod.resetWorkflowCounters;
  });

  it("starts at zero for every counter", async () => {
    const counters = await readWorkflowCounters();
    expect(counters.draftsTotal).toBe(0);
    expect(counters.preflightPassFirstTry).toBe(0);
    expect(counters.preflightFailRecovered).toBe(0);
    expect(counters.preflightFailUnrecovered).toBe(0);
    expect(counters.jobsStarted).toBe(0);
    expect(counters.jobsLiveWriteFailed).toBe(0);
    expect(counters.recent).toEqual([]);
  });

  it("increments the right counter for each kind", async () => {
    await bumpWorkflowCounter("draft_created");
    await bumpWorkflowCounter("preflight_pass_first_try");
    await bumpWorkflowCounter("preflight_fail_recovered");
    await bumpWorkflowCounter("preflight_fail_unrecovered");
    await bumpWorkflowCounter("job_started");
    await bumpWorkflowCounter("job_live_write_failed");
    const counters = await readWorkflowCounters();
    expect(counters.draftsTotal).toBe(1);
    expect(counters.preflightPassFirstTry).toBe(1);
    expect(counters.preflightFailRecovered).toBe(1);
    expect(counters.preflightFailUnrecovered).toBe(1);
    expect(counters.jobsStarted).toBe(1);
    expect(counters.jobsLiveWriteFailed).toBe(1);
    expect(counters.recent).toHaveLength(6);
  });

  it("caps the recent rolling window at 50 entries", async () => {
    for (let i = 0; i < 60; i += 1) await bumpWorkflowCounter("draft_created");
    const counters = await readWorkflowCounters();
    expect(counters.draftsTotal).toBe(60);
    expect(counters.recent).toHaveLength(50);
  });

  it("records optional notes on the rolling window", async () => {
    await bumpWorkflowCounter("job_live_write_failed", "partial");
    const counters = await readWorkflowCounters();
    expect(counters.recent[0]).toMatchObject({ kind: "job_live_write_failed", note: "partial" });
  });

  it("resetWorkflowCounters clears all fields", async () => {
    await bumpWorkflowCounter("draft_created");
    await resetWorkflowCounters();
    const counters = await readWorkflowCounters();
    expect(counters.draftsTotal).toBe(0);
    expect(counters.recent).toEqual([]);
  });
});
