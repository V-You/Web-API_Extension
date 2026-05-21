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
import type { WriteRecord } from "../sandbox/sdk-facade";
import { executeTypedTool, isReadOnlyTool } from "./adapter";
import { staticWorkflowPreflight } from "../chat/workflow-static-preflight";
import { workflowContractFailureFromPreflight } from "../chat/workflow-contract-error";
import type { ApiCredentials, Environment } from "../lib/types";

export interface ExecuteWorkflowInput {
  /** TypeScript/JS source code to execute. */
  script: string;
  /** Entity context for the script (optional). */
  entityId?: string;
  entityType?: string;
  /** If true, dry-run only -- parse and validate but do not execute. */
  dryRun?: boolean;
  /** If true, execute locally but record writes instead of mutating backend state. */
  planOnly?: boolean;
  /** Timeout in milliseconds (default: 10 minutes). */
  timeoutMs?: number;
  /** Bypass per-write prompts after an outer WebMCP confirmation. */
  autoConfirmWrites?: boolean;
}

interface DeclarativeWorkflowCall {
  tool: string;
  params: Record<string, unknown>;
}

interface DeclarativeWorkflow {
  workflowVersion?: number;
  kind?: string;
  calls: DeclarativeWorkflowCall[];
}

function parseDeclarativeWorkflow(script: string): DeclarativeWorkflow | null {
  const trimmed = script.trim();
  if (!trimmed.startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const workflow = parsed as Record<string, unknown>;
  if (!Array.isArray(workflow.calls)) return null;

  const calls = workflow.calls.map((call, index) => {
    if (!call || typeof call !== "object") {
      throw new Error(`Declarative workflow call ${index + 1} must be an object.`);
    }
    const entry = call as Record<string, unknown>;
    if (typeof entry.tool !== "string" || !entry.tool) {
      throw new Error(`Declarative workflow call ${index + 1} is missing tool.`);
    }
    if (!entry.params || typeof entry.params !== "object" || Array.isArray(entry.params)) {
      throw new Error(`Declarative workflow call ${index + 1} is missing params.`);
    }
    return { tool: entry.tool, params: entry.params as Record<string, unknown> };
  });

  return {
    workflowVersion: typeof workflow.workflowVersion === "number" ? workflow.workflowVersion : undefined,
    kind: typeof workflow.kind === "string" ? workflow.kind : undefined,
    calls,
  };
}

function recordForCall(call: DeclarativeWorkflowCall): WriteRecord {
  const params = call.params;
  const entityId = String(
    params.parentId ??
    params.entityId ??
    params.contactId ??
    params.merchantAccountId ??
    params.attachedMerchantAccountId ??
    "",
  );
  const entityType = String(params.parentType ?? params.entityType ?? "unknown");
  return {
    tool: call.tool,
    action: call.tool,
    entityId,
    entityType,
    params,
    timestamp: new Date().toISOString(),
  };
}

async function executeDeclarativeWorkflow(
  workflow: DeclarativeWorkflow,
  input: ExecuteWorkflowInput,
  creds: ApiCredentials,
  env: Environment,
) {
  const start = Date.now();
  const results: unknown[] = [];
  const writes: WriteRecord[] = [];

  for (const call of workflow.calls) {
    if (!isReadOnlyTool(call.tool)) {
      writes.push(recordForCall(call));
    }

    if (input.planOnly) {
      results.push({ tool: call.tool, planned: true, params: call.params });
      continue;
    }

    const result = await executeTypedTool(call.tool, call.params, {
      creds,
      env,
      confirm: true,
    });
    results.push({ tool: call.tool, result });
  }

  return {
    status: input.planOnly ? "planned" : "completed",
    returnValue: null,
    results,
    logs: [],
    writeCount: writes.length,
    writes,
    durationMs: Date.now() - start,
  };
}

export async function executeWorkflow(
  input: ExecuteWorkflowInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.script) {
    return { error: "script is required." };
  }

  const declarativeWorkflow = parseDeclarativeWorkflow(input.script);
  if (declarativeWorkflow) {
    return executeDeclarativeWorkflow(declarativeWorkflow, input, creds, env);
  }

  if (input.planOnly) {
    return {
      status: "error",
      returnValue: null,
      results: [],
      logs: [],
      writeCount: 0,
      writes: [],
      durationMs: 0,
      error: "planOnly for freeform workflow scripts is not available in WebMCP service-worker execution because it would require unsafe eval. Use declarative workflow JSON for planOnly, dryRun for syntax validation, or start a reviewed background Job.",
    };
  }

  const preflight = staticWorkflowPreflight(input.script);
  if (!preflight.ok) {
    const failure = workflowContractFailureFromPreflight(preflight);
    return {
      ...failure,
      returnValue: null,
      results: [],
      logs: [],
      writeCount: 0,
      writes: [],
      durationMs: 0,
    };
  }

  const result: SandboxResult = await runSandbox({
    script: input.script,
    creds,
    env,
    entityId: input.entityId,
    entityType: input.entityType,
    dryRun: input.dryRun,
    planOnly: input.planOnly,
    timeoutMs: input.timeoutMs,
    autoConfirmWrites: input.autoConfirmWrites,
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
