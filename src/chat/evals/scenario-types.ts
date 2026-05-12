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
  forbidden?: string[];
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
