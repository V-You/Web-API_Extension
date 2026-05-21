import { describe, expect, it } from "vitest";

import { resolveWorkflowRuntime, selectWorkflowRuntime } from "./workflow-runtime";

describe("workflow runtime selection", () => {
  it("selects long_job for real workflow handoff", () => {
    expect(selectWorkflowRuntime({ script: "results.push(1);", hasJobHandoff: true })).toBe("long_job");
  });

  it("selects inline_sandbox for dry-run freeform scripts", () => {
    expect(selectWorkflowRuntime({ script: "results.push(1);", dryRun: true, hasJobHandoff: true })).toBe("inline_sandbox");
  });

  it("selects declarative_workflow for declarative JSON", () => {
    expect(selectWorkflowRuntime({ script: JSON.stringify({ calls: [] }), planOnly: true, hasJobHandoff: true })).toBe("declarative_workflow");
  });

  it("prefers declarative_workflow even when a job handoff is offered", () => {
    // A declarative script must never be promoted to a background Job because
    // its own runtime executes inline against the typed handlers.
    expect(
      selectWorkflowRuntime({
        script: JSON.stringify({ calls: [{ tool: "manage_entity", params: { action: "get", entityType: "merchant", entityId: "m1" } }] }),
        hasJobHandoff: true,
      }),
    ).toBe("declarative_workflow");
  });

  it("ignores impossible requested runtime metadata (back-compat)", () => {
    expect(selectWorkflowRuntime({ script: "results.push(1);", dryRun: true, requestedRuntime: "long_job" })).toBe("inline_sandbox");
  });

  it("surfaces an impossible requested runtime via resolveWorkflowRuntime", () => {
    const selection = resolveWorkflowRuntime({
      script: "results.push(1);",
      dryRun: true,
      requestedRuntime: "long_job",
    });
    expect(selection.runtime).toBe("inline_sandbox");
    expect(selection.requestedRuntimeMismatch).toBe("long_job");
  });

  it("does not flag mismatch when the requested runtime matches the resolved one", () => {
    const selection = resolveWorkflowRuntime({
      script: "results.push(1);",
      hasJobHandoff: true,
      requestedRuntime: "long_job",
    });
    expect(selection.runtime).toBe("long_job");
    expect(selection.requestedRuntimeMismatch).toBeUndefined();
  });
});
