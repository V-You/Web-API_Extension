/**
 * execute_workflow tool handler.
 *
 * Executes a TypeScript/JS script in the code-mode sandbox with the virtual SDK
 * available as `sdk`. This is the code-mode entry point -- the agent writes
 * a script, and this tool runs it locally.
 *
 * The sandbox provides:
 *   - `sdk` -- full API facade (config, entities, contacts, MAs, hierarchy, CI, audit)
 *   - `console` -- captured log/warn/error (returned in output)
 *   - `sleep(ms)` -- async delay (respects cancellation)
 *   - `results` -- array the script can push structured output to
 *   - `context` -- { entityId, entityType, env } if provided
 *   - `signal` -- AbortSignal for cooperative cancellation
 *
 * Write operations are recorded for the preview/confirm bridge (build step 5).
 */

import { runSandbox, type SandboxResult } from "../sandbox/sandbox";
import type { ApiCredentials, Environment } from "../lib/types";

export interface ExecuteWorkflowInput {
  /** TypeScript/JS source code to execute. */
  script: string;
  /** Entity context for the script (optional). */
  entityId?: string;
  entityType?: string;
  /** If true, dry-run only -- parse and validate but do not execute. */
  dryRun?: boolean;
  /** Timeout in milliseconds (default: 10 minutes). */
  timeoutMs?: number;
}

export async function executeWorkflow(
  input: ExecuteWorkflowInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.script) {
    return { error: "script is required." };
  }

  const result: SandboxResult = await runSandbox({
    script: input.script,
    creds,
    env,
    entityId: input.entityId,
    entityType: input.entityType,
    dryRun: input.dryRun,
    timeoutMs: input.timeoutMs,
  });

  return {
    status: result.status,
    returnValue: result.returnValue,
    results: result.results,
    logs: result.logs.map((l) => `[${l.level}] ${l.args.map(String).join(" ")}`),
    writeCount: result.writes.length,
    writes: result.writes,
    durationMs: result.durationMs,
    error: result.error,
  };
}
