/**
 * PRD 2026-05-18 Phase 5: regression tests that replay each
 * WORKFLOW_PREFLIGHT_SCENARIOS fixture through staticWorkflowPreflight and
 * assert the expected ok/blocked outcome. New scenarios added to the fixture
 * file are picked up automatically.
 */

import { describe, expect, it } from "vitest";

import { staticWorkflowPreflight } from "../workflow-static-preflight";
import { WORKFLOW_PREFLIGHT_SCENARIOS } from "./scenario-fixtures";

describe("workflow preflight scenarios (PRD 2026-05-18 Phase 5)", () => {
  it("ships at least the six initial Phase 5 regression scenarios", () => {
    const ids = WORKFLOW_PREFLIGHT_SCENARIOS.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "ma-barclays-attach-visa-eur-dupe-check-send",
        "ma-five-acceptance-mids-different-currencies",
        "ci-lookup-barclays-readonly",
        "dupe-check-stringified-settings-blocked",
        "ma-attach-missing-currency-blocked",
        "ma-create-non-uuid-ci-id-blocked",
        "uncalled-runworkflow-wrapper",
      ]),
    );
  });

  for (const scenario of WORKFLOW_PREFLIGHT_SCENARIOS) {
    it(`${scenario.id} - preflight ${scenario.expectedPreflight}`, () => {
      const result = staticWorkflowPreflight(scenario.workflowScript);
      if (scenario.expectedPreflight === "ok") {
        expect(
          result.ok,
          `expected ${scenario.id} to pass preflight, got: ${result.message ?? "(no message)"}`,
        ).toBe(true);
      } else {
        expect(result.ok, `expected ${scenario.id} to be blocked`).toBe(false);
        for (const needle of scenario.expectedMessageIncludes ?? []) {
          expect(result.message ?? "").toContain(needle);
        }
      }
    });
  }

  it("forbiddenTools scenarios do not invoke writes (documented for trace-replay tooling)", () => {
    const readOnly = WORKFLOW_PREFLIGHT_SCENARIOS.filter((s) => (s.forbiddenTools?.length ?? 0) > 0);
    for (const scenario of readOnly) {
      for (const banned of scenario.forbiddenTools!) {
        // Surface as a script-text assertion: the fixture must not literally
        // mention a banned write tool name in its script body.
        expect(scenario.workflowScript, `${scenario.id} script mentions banned tool ${banned}`)
          .not.toContain(banned);
      }
    }
  });
});
