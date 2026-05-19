import { describe, expect, it } from "vitest";
import { classifyResult, computeJobOutcome } from "./job-outcome";

describe("classifyResult", () => {
  it("classifies ok:false as failure", () => {
    expect(classifyResult({ ok: false })).toBe("failure");
  });

  it("classifies status: 'failed' as failure (Wyoming case)", () => {
    expect(classifyResult({ state: "Wyoming", status: "failed", error: "bad shape" })).toBe("failure");
  });

  it("classifies status: 'success' as success", () => {
    expect(classifyResult({ status: "success", channelId: "abc" })).toBe("success");
  });

  it("classifies ok:true as success", () => {
    expect(classifyResult({ ok: true })).toBe("success");
  });

  it("returns ambiguous for plain objects without verdict markers", () => {
    expect(classifyResult({ foo: "bar" })).toBe("ambiguous");
  });

  it("returns ambiguous for non-objects", () => {
    expect(classifyResult("hello")).toBe("ambiguous");
    expect(classifyResult(42)).toBe("ambiguous");
    expect(classifyResult(null)).toBe("ambiguous");
  });
});

describe("computeJobOutcome", () => {
  it("maps total per-call failure to state 'failed' (Wyoming case)", () => {
    const results = Array.from({ length: 50 }, (_, i) => ({
      state: `State ${i}`,
      status: "failed",
      error: "bad shape",
    }));
    const outcome = computeJobOutcome({ results, completedSdkCalls: 0, totalCalls: 50 });
    expect(outcome.state).toBe("failed");
    expect(outcome.summary.failed).toBe(50);
    expect(outcome.summary.succeeded).toBe(0);
    expect(outcome.summary.sample).toHaveLength(3);
  });

  it("maps mixed outcomes to state 'partial'", () => {
    const results = [
      { state: "A", status: "success" },
      { state: "B", status: "failed", error: "boom" },
      { state: "C", status: "success" },
    ];
    const outcome = computeJobOutcome({ results, completedSdkCalls: 3, totalCalls: 3 });
    expect(outcome.state).toBe("partial");
    expect(outcome.summary.failed).toBe(1);
    expect(outcome.summary.succeeded).toBe(2);
  });

  it("maps all success to state 'completed'", () => {
    const results = [
      { status: "success" },
      { ok: true },
    ];
    const outcome = computeJobOutcome({ results, completedSdkCalls: 2, totalCalls: 2 });
    expect(outcome.state).toBe("completed");
    expect(outcome.summary.succeeded).toBe(2);
    expect(outcome.summary.failed).toBe(0);
  });

  it("treats zero completed SDK calls against a planned total as failed", () => {
    const outcome = computeJobOutcome({ results: [], completedSdkCalls: 0, totalCalls: 10 });
    expect(outcome.state).toBe("failed");
    expect(outcome.summary.totalRecords).toBe(0);
  });

  it("treats ambiguous-only results with no planned work as completed", () => {
    const outcome = computeJobOutcome({ results: [{ note: "hello" }], completedSdkCalls: 0, totalCalls: 0 });
    expect(outcome.state).toBe("completed");
    expect(outcome.summary.ambiguous).toBe(1);
  });
});
