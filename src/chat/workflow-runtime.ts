export const WORKFLOW_RUNTIMES = ["inline_sandbox", "long_job", "declarative_workflow"] as const;

export type WorkflowRuntime = typeof WORKFLOW_RUNTIMES[number];

export interface WorkflowRuntimeSelectionInput {
  script?: string;
  dryRun?: boolean;
  planOnly?: boolean;
  hasJobHandoff?: boolean;
  requestedRuntime?: unknown;
}

export function normalizeWorkflowRuntime(value: unknown): WorkflowRuntime | undefined {
  return typeof value === "string" && (WORKFLOW_RUNTIMES as readonly string[]).includes(value)
    ? value as WorkflowRuntime
    : undefined;
}

export function isDeclarativeWorkflowScript(script: string | undefined): boolean {
  const trimmed = String(script ?? "").trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Boolean(parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).calls));
  } catch {
    return false;
  }
}

export interface WorkflowRuntimeSelection {
  runtime: WorkflowRuntime;
  /** True when requestedRuntime was provided but did not match the computed runtime. */
  requestedRuntimeMismatch?: WorkflowRuntime;
}

function computeActualRuntime(input: WorkflowRuntimeSelectionInput): WorkflowRuntime {
  // Declarative JSON wins over hasJobHandoff: a declarative workflow is
  // executed synchronously through typed tools, never as a background Job,
  // regardless of whether a job handoff path is wired by the caller.
  if (isDeclarativeWorkflowScript(input.script)) return "declarative_workflow";
  if (input.dryRun === true || input.planOnly === true) return "inline_sandbox";
  if (input.hasJobHandoff === true) return "long_job";
  return "inline_sandbox";
}

export function selectWorkflowRuntime(input: WorkflowRuntimeSelectionInput): WorkflowRuntime {
  return resolveWorkflowRuntime(input).runtime;
}

export function resolveWorkflowRuntime(input: WorkflowRuntimeSelectionInput): WorkflowRuntimeSelection {
  const actual = computeActualRuntime(input);
  const requested = normalizeWorkflowRuntime(input.requestedRuntime);
  if (requested && requested !== actual) {
    return { runtime: actual, requestedRuntimeMismatch: requested };
  }
  return { runtime: actual };
}

export function workflowRuntimePromptLine(runtime: WorkflowRuntime): string {
  if (runtime === "long_job") {
    return "Workflow runtime metadata: runtime=long_job. The script will run as a background Job after confirmation. Use the same SDK reference as inline workflows.";
  }
  if (runtime === "declarative_workflow") {
    return "Workflow runtime metadata: runtime=declarative_workflow. Use declarative typed-tool calls only; the script lifecycle is validation/execution through typed tool schemas.";
  }
  return "Workflow runtime metadata: runtime=inline_sandbox. Dry-run and plan-only validation stay inline; use the same SDK reference as background Jobs.";
}
