import { describe, expect, it } from "vitest";

import { parseWorkflowDraft } from "./workflow-draft";

describe("workflow draft parsing", () => {
  it("parses a valid draft object", () => {
    const draft = parseWorkflowDraft(JSON.stringify({
      label: "Audit current entity",
      totalCalls: 3,
      script: "results.push({ ok: true });",
    }));

    expect(draft.label).toBe("Audit current entity");
    expect(draft.totalCalls).toBe(3);
    expect(draft.script).toContain("results.push");
  });

  it("accepts a fenced JSON response", () => {
    const draft = parseWorkflowDraft("```json\n{\"label\":\"T\",\"totalCalls\":\"2\",\"script\":\"console.log('x')\"}\n```");

    expect(draft.totalCalls).toBe(2);
  });

  it("rejects missing or invalid fields", () => {
    expect(() => parseWorkflowDraft("{}")).toThrow(/label/);
    expect(() => parseWorkflowDraft("{\"label\":\"x\",\"totalCalls\":0,\"script\":\"x\"}")).toThrow(/positive integer/);
  });
});
