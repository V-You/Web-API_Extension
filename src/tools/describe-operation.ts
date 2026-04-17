/**
 * describe_operation tool.
 *
 * Returns the generated operation manifest entry (or group of entries,
 * one per entity level) for a logical tool name. Read-only.
 *
 * Used by agents for self-correction when they need the exact method,
 * path template, required fields, and patterns of a CRUD operation.
 */

import manifestData from "../../src_data/webapi-operation-manifest.json";
import type { WebApiOperation, WebApiOperationManifest } from "../../src_data/webapi-operation-manifest";

const MANIFEST = manifestData as unknown as WebApiOperationManifest;

export interface DescribeOperationInput {
  toolName?: string;
}

export interface DescribeOperationOutput {
  ok: true;
  toolName: string;
  operations: WebApiOperation[];
}

export interface DescribeOperationError {
  ok: false;
  error: string;
  availableTools?: string[];
}

export function describeOperation(
  input: DescribeOperationInput,
): DescribeOperationOutput | DescribeOperationError {
  const toolName = (input.toolName ?? "").trim();
  if (!toolName) {
    return {
      ok: false,
      error: "toolName is required.",
      availableTools: MANIFEST.tools,
    };
  }

  const ops = (MANIFEST.toolIndex as Record<string, WebApiOperation[]>)[toolName];
  if (!ops || ops.length === 0) {
    return {
      ok: false,
      error: `Unknown tool: ${toolName}.`,
      availableTools: MANIFEST.tools,
    };
  }

  return { ok: true, toolName, operations: ops };
}

export function listManifestTools(): string[] {
  return MANIFEST.tools;
}
