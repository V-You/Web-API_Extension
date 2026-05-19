export interface ChatScenarioFixture {
  id: string;
  prompt: string;
  mode: {
    writeToolsEnabled?: boolean;
    accessTokenControlEnabled?: boolean;
    automationModeEnabled?: boolean;
  };
  context?: unknown;
  expectedTrace: Array<{
    tool: string;
    args?: Record<string, unknown>;
  }>;
  expectedRecipes?: string[];
  forbiddenRecipes?: string[];
  expectedWorkflowShape?: {
    transactionHelper?: string;
    count?: number;
    phaseTypes?: string[];
    constants?: string[];
  };
  forbidden?: string[];
}

/**
 * PRD 2026-05-18 Phase 5 fixture: pairs a freeform user prompt with the
 * workflow script we expect the model to draft, plus the static-preflight
 * outcome we expect for that script. These fixtures replay prompts that
 * previously failed and document the expected behavior of the contract
 * pipeline (preflight gate + describe_operation overlay + runtime contracts).
 */
export interface WorkflowPreflightScenario {
  id: string;
  /** Original prompt that previously produced an unsafe draft. */
  prompt: string;
  /** The workflow script under test (a draft a model might emit). */
  workflowScript: string;
  /** Expected static-preflight outcome. */
  expectedPreflight: "ok" | "blocked";
  /** When blocked, substrings the preflight message must contain. */
  expectedMessageIncludes?: string[];
  /** Optional list of tool names that must NEVER appear in expected calls. */
  forbiddenTools?: string[];
  /** Human-readable note on why this fixture exists. */
  note: string;
}

export interface ObservedToolTrace {
  tool: string;
  args: Record<string, unknown>;
}

export function validateScenarioTrace(
  fixture: ChatScenarioFixture,
  observed: ObservedToolTrace[],
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (let index = 0; index < fixture.expectedTrace.length; index++) {
    const expected = fixture.expectedTrace[index];
    const actual = observed[index];
    if (!actual) {
      errors.push(`Missing tool call ${index}: ${expected.tool}`);
      continue;
    }
    if (actual.tool !== expected.tool) {
      errors.push(`Tool call ${index}: expected ${expected.tool}, got ${actual.tool}`);
    }
    for (const [key, value] of Object.entries(expected.args ?? {})) {
      if (actual.args[key] !== value) {
        errors.push(`Tool call ${index} arg ${key}: expected ${String(value)}, got ${String(actual.args[key])}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
