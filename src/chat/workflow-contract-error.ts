import type { StaticPreflightResult } from "./workflow-static-preflight";

export type WorkflowContractErrorKind =
  | "unknown_sdk_member"
  | "sdk_reflection"
  | "precheck_failed"
  | "runtime_failed"
  | "runtime_mismatch";

export interface WorkflowContractErrorInfo {
  kind: WorkflowContractErrorKind;
  message: string;
  suggest?: string;
  fixHint: string;
}

export interface WorkflowContractFailureResult {
  status: "error";
  errorKind: WorkflowContractErrorKind;
  error: string;
  errorInfo: WorkflowContractErrorInfo;
  preflight?: StaticPreflightResult;
}

function firstContractKind(preflight: StaticPreflightResult): WorkflowContractErrorKind {
  const hit = preflight.hits.find((entry) => entry.kind === "unknown_sdk_member" || entry.kind === "sdk_reflection");
  if (hit?.kind === "unknown_sdk_member" || hit?.kind === "sdk_reflection") return hit.kind;
  return "precheck_failed";
}

function firstSuggestion(preflight: StaticPreflightResult): string | undefined {
  return preflight.hits.find((entry) => entry.canonical)?.canonical;
}

function fixHintFor(kind: WorkflowContractErrorKind, suggest?: string): string {
  if (kind === "unknown_sdk_member") {
    return suggest
      ? `Use the workflow SDK reference and replace the unknown method with \`${suggest}\` if it matches the requested operation.`
      : "Use only methods listed in the workflow SDK reference; do not invent aliases.";
  }
  if (kind === "sdk_reflection") {
    return "Use the workflow SDK reference; runtime reflection over sdk is unsupported.";
  }
  if (kind === "runtime_failed") {
    return "Rewrite the workflow against the workflow SDK reference before retrying.";
  }
  if (kind === "runtime_mismatch") {
    return "Set runtime to the value the host computed (or omit runtime and let the host decide).";
  }
  return "Rewrite the workflow using the workflow SDK reference before retrying.";
}

export function workflowContractFailureFromRuntimeMismatch(
  requested: string,
  actual: string,
): WorkflowContractFailureResult {
  const message = `Requested runtime "${requested}" does not match the computed runtime "${actual}" for this workflow. The host will not silently override lifecycle.`;
  return {
    status: "error",
    errorKind: "runtime_mismatch",
    error: message,
    errorInfo: {
      kind: "runtime_mismatch",
      message,
      suggest: actual,
      fixHint: fixHintFor("runtime_mismatch"),
    },
  };
}

export function workflowContractFailureFromPreflight(preflight: StaticPreflightResult): WorkflowContractFailureResult {
  const kind = firstContractKind(preflight);
  const suggest = firstSuggestion(preflight);
  const message = preflight.message ?? "Workflow preflight found contract violations.";
  return {
    status: "error",
    errorKind: kind,
    error: message,
    errorInfo: {
      kind,
      message,
      ...(suggest ? { suggest } : {}),
      fixHint: fixHintFor(kind, suggest),
    },
    preflight,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isWorkflowContractFailure(result: unknown): result is Record<string, unknown> {
  if (!isRecord(result)) return false;
  const info = isRecord(result.errorInfo) ? result.errorInfo : null;
  if (typeof info?.kind === "string" && ["unknown_sdk_member", "sdk_reflection", "precheck_failed", "runtime_failed", "runtime_mismatch"].includes(info.kind)) {
    return true;
  }
  return result.status === "error" && (
    result.errorKind === "precheck_failed" ||
    result.errorKind === "unknown_sdk_member" ||
    result.errorKind === "sdk_reflection" ||
    result.errorKind === "runtime_mismatch" ||
    (typeof result.error === "string" && /Workflow preflight found contract violations|Unknown SDK member/i.test(result.error))
  );
}

export function workflowContractFailureText(result: Record<string, unknown>): string {
  const info = isRecord(result.errorInfo) ? result.errorInfo : null;
  const message = typeof info?.message === "string" && info.message.trim()
    ? info.message.trim()
    : typeof result.error === "string" && result.error.trim()
      ? result.error.trim()
      : "Workflow preflight found contract violations.";
  const fixHint = typeof info?.fixHint === "string" && info.fixHint.trim()
    ? info.fixHint.trim()
    : "Rewrite the workflow using only the methods listed in the workflow SDK reference.";

  return [
    "The workflow draft failed SDK contract preflight and was not started.",
    message,
    `${fixHint} Do not switch to per-action write tools in this turn.`,
  ].join("\n\n");
}
