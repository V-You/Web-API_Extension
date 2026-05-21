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

export function selectWorkflowRuntime(input: WorkflowRuntimeSelectionInput): WorkflowRuntime {
  const requested = normalizeWorkflowRuntime(input.requestedRuntime);
  const actual = input.dryRun === true || input.planOnly === true
    ? isDeclarativeWorkflowScript(input.script) ? "declarative_workflow" : "inline_sandbox"
    : input.hasJobHandoff === true
      ? "long_job"
      : isDeclarativeWorkflowScript(input.script)
        ? "declarative_workflow"
        : "inline_sandbox";

  if (!requested) return actual;
  if (requested === "long_job" && actual === "long_job") return requested;
  if (requested === "inline_sandbox" && actual === "inline_sandbox") return requested;
  if (requested === "declarative_workflow" && actual === "declarative_workflow") return requested;
  return actual;
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
