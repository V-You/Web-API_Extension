import { describe, expect, it } from "vitest";

import { selectWorkflowRuntime } from "./workflow-runtime";

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

  it("ignores impossible requested runtime metadata", () => {
    expect(selectWorkflowRuntime({ script: "results.push(1);", dryRun: true, requestedRuntime: "long_job" })).toBe("inline_sandbox");
  });
});
