/**
 * describe_operation tool.
 *
 * Returns the generated operation manifest entry (or group of entries,
 * one per entity level) for a logical tool name. Read-only.
 *
 * Used by agents for self-correction when they need the exact method,
 * path template, required fields, and patterns of a CRUD operation.
 *
 * PRD 2026-05-18 Phase 4: the response also includes a `liveContract`
 * overlay sourced from `src/tools/live-contracts.ts`. This surfaces fields
 * the live API requires even when the OpenAPI spec marks them optional
 * (e.g. `subTypes` / `currency` on attach_merchant_account, the UUID format
 * of `clearingInstituteId` on create_merchant_account). The overlay is the
 * single source of truth: prompt guidance, runtime contracts, and this tool
 * all read from it, so the model receives consistent feedback whether it
 * inspects an operation or hits a runtime contract failure.
 */

import manifestData from "../../src_data/webapi-operation-manifest.json";
import type { WebApiOperation, WebApiOperationManifest } from "../../src_data/webapi-operation-manifest";
import { LIVE_CONTRACTS, type LiveContractEntry } from "./live-contracts";

const MANIFEST = manifestData as unknown as WebApiOperationManifest;

export interface DescribeOperationInput {
  toolName?: string;
}

export interface LiveContractOverlay {
  /** Fields that must always be present and non-empty for the live API. */
  requiredFields: string[];
  /** "Any-of" groups; at least one field in each group must be present. */
  requiredOneOf?: Array<{ fields: string[]; reason: string }>;
  /** Identifier format constraints surfaced as guidance, not auto-rejected. */
  identifierFormats?: Array<{ field: string; pattern: string; description: string }>;
  /** Suffix appended to runtime error messages to help redrafting. */
  errorHint: string;
}

export interface DescribeOperationOutput {
  ok: true;
  toolName: string;
  operations: WebApiOperation[];
  /** Live-contract overlay when one exists for this tool. */
  liveContract?: LiveContractOverlay;
}

export interface DescribeOperationError {
  ok: false;
  error: string;
  availableTools?: string[];
}

function toOverlay(entry: LiveContractEntry): LiveContractOverlay {
  return {
    requiredFields: entry.requiredFields,
    requiredOneOf: entry.requiredOneOf?.map((g) => ({ fields: g.fields, reason: g.reason })),
    identifierFormats: entry.identifierFormats?.map((f) => ({
      field: f.field,
      // RegExp serializes to "/pattern/flags"; expose .source so the model
      // sees a plain pattern string it can reason about.
      pattern: f.pattern.source,
      description: f.description,
    })),
    errorHint: entry.errorHint,
  };
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

  const overlay = LIVE_CONTRACTS[toolName];
  return {
    ok: true,
    toolName,
    operations: ops,
    ...(overlay ? { liveContract: toOverlay(overlay) } : {}),
  };
}

export function listManifestTools(): string[] {
  return MANIFEST.tools;
}

