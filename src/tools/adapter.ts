/**
 * Typed write adapter.
 *
 * Dispatches a generated per-action tool call through the manifest:
 *   1. Resolves the operation variant (by parentType for multi-variant tools).
 *   2. Validates path parameters are present.
 *   3. Enforces the required-field tiers (required_spec + conditional).
 *   4. Rejects unknown fields (D6).
 *   5. Coerces values at the form-encode boundary (D7).
 *   6. Routes destructive calls through the confirm bridge (D8).
 *   7. Executes the HTTP request via api-client.
 *
 * Consumers: WebMCP tool handlers registered for the per-action tool
 * names emitted by `generateToolSchemas()`.
 */

import type {
  WebApiOperation,
  WebApiRequestField,
} from "../../src_data/webapi-operation-manifest";
import { requestConfirm, type WritePreview } from "../bridge/confirm-bridge";
import { apiRequest, type ApiResponse } from "../lib/api-client";
import { redactSecrets } from "../lib/redact";
import type { ApiCredentials, AuditEventType, Environment } from "../lib/types";
import {
  coerceFieldValue,
  knownFieldNames,
  MANIFEST,
  PARENT_ID_KEY,
  pickOperation,
  toolHasParentVariants,
  variantsFor,
  type ParentEntityType,
  type ToolName,
} from "./manifest-helpers";

export interface AdapterOptions {
  creds: ApiCredentials;
  env: Environment;
  /** Bypass the confirm bridge -- used by code-mode scripts that opt in. */
  confirm?: boolean;
  onWriteAccepted?: (description: string) => void;
}

export interface AdapterError {
  ok: false;
  status: 0;
  data: { error: string; details?: unknown };
}

export type AdapterResult<T = unknown> = ApiResponse<T> | AdapterError;

/** Tools considered read-only in the manifest (no confirm-bridge routing). */
const READ_ONLY_PREFIXES = ["get_", "list_"];

export function isReadOnlyTool(toolName: ToolName): boolean {
  return READ_ONLY_PREFIXES.some((p) => toolName.startsWith(p));
}

function error(message: string, details?: unknown): AdapterError {
  return { ok: false, status: 0, data: { error: message, details } };
}

/**
 * Substitute path parameters into the template, encoding each value.
 * Returns null on a missing required path param.
 */
function buildPath(op: WebApiOperation, params: Record<string, unknown>): string | null {
  let path = op.pathTemplate;
  for (const pp of op.pathParams) {
    const raw = params[pp.name];
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return null;
    }
    path = path.replace(`{${pp.name}}`, encodeURIComponent(String(raw)));
  }
  return path;
}

/**
 * Resolve path-param aliases. For multi-variant tools the caller passes
 * `parentType` + `parentId` and we expand to the spec's path-param name.
 */
function resolveParentAlias(
  toolName: ToolName,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (!toolHasParentVariants(toolName)) return params;
  const parentType = params.parentType as ParentEntityType | undefined;
  const parentId = params.parentId as string | undefined;
  if (!parentType || !parentId) return params;
  const key = PARENT_ID_KEY[parentType];
  if (!key) return params;
  if (key in params) return params;
  const clone = { ...params };
  clone[key] = parentId;
  return clone;
}

/** List fields that are required at the spec level or by an active conditional. */
function computeRequired(
  op: WebApiOperation,
  supplied: Record<string, unknown>,
): WebApiRequestField[] {
  const needed: WebApiRequestField[] = [];
  for (const f of op.request) {
    if (f.required === "required_spec") {
      needed.push(f);
      continue;
    }
    if (f.required === "conditional" && f.conditionalTrigger) {
      const triggerValue = supplied[f.conditionalTrigger.field];
      if (triggerValue === f.conditionalTrigger.value) needed.push(f);
    }
  }
  return needed;
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

/** Check for any destructive field value (e.g. state=DELETED). */
function findDestructiveValue(
  op: WebApiOperation,
  supplied: Record<string, unknown>,
): { field: string; value: string } | null {
  for (const f of op.request) {
    if (!f.destructiveValues) continue;
    const raw = supplied[f.name];
    if (raw === undefined) continue;
    const s = String(raw);
    if (f.destructiveValues.includes(s)) return { field: f.name, value: s };
  }
  return null;
}

function buildDescription(toolName: ToolName, params: Record<string, unknown>): string {
  const id =
    (params.contactId as string | undefined) ??
    (params.merchantAccountId as string | undefined) ??
    (params.attachedMerchantAccountId as string | undefined) ??
    (params.entityId as string | undefined) ??
    (params.parentId as string | undefined) ??
    "";
  return id ? `${toolName} (${id})` : toolName;
}

/**
 * Strip soft-deleted items (state === "DISABLED") from list responses.
 * The API uses soft-delete -- the Dashboard hides these, so we match that UX.
 * Returns the count of hidden items so the caller can annotate.
 */
function filterDisabledFromList(data: Record<string, unknown>): number {
  let hidden = 0;
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (!Array.isArray(val)) continue;
    const before = val.length;
    data[key] = val.filter(
      (item: unknown) =>
        typeof item !== "object" ||
        item === null ||
        (item as Record<string, unknown>).state !== "DISABLED",
    );
    hidden += before - (data[key] as unknown[]).length;
  }
  return hidden;
}

function extractApiTokenId(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const apiToken = (data as Record<string, unknown>).apiToken;
  if (!apiToken || typeof apiToken !== "object" || Array.isArray(apiToken)) return null;
  const id = (apiToken as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id : null;
}

async function cleanupStandaloneApiTokenCreate(
  tokenId: string,
  options: AdapterOptions,
): Promise<boolean> {
  await apiRequest(options.creds, options.env, {
    method: "POST",
    path: `/apiTokens/${encodeURIComponent(tokenId)}/suspend`,
  }, {
    eventType: "api_token_suspend" as AuditEventType,
    entityId: tokenId,
    entityType: "apiToken",
  });
  await apiRequest(options.creds, options.env, {
    method: "DELETE",
    path: `/apiTokens/${encodeURIComponent(tokenId)}`,
  }, {
    eventType: "api_token_delete" as AuditEventType,
    entityId: tokenId,
    entityType: "apiToken",
  });
  return true;
}

export async function executeTypedTool<T = unknown>(
  toolName: ToolName,
  rawParams: Record<string, unknown>,
  options: AdapterOptions,
): Promise<AdapterResult<T>> {
  const variants = variantsFor(toolName);
  if (variants.length === 0) {
    return error(`Unknown typed tool: ${toolName}`);
  }

  const parentType = rawParams.parentType as ParentEntityType | undefined;
  const op = pickOperation(toolName, parentType ?? null);
  if (!op) return error(`No operation variant for ${toolName}`);

  const params = resolveParentAlias(toolName, rawParams);

  // 1. Path parameter presence
  const path = buildPath(op, params);
  if (!path) {
    const missing = op.pathParams
      .filter((p) => !hasValue(params[p.name]))
      .map((p) => p.name);
    return error(`Missing path parameter(s): ${missing.join(", ")}`);
  }

  // 2. Unknown-field rejection (ignores the reserved aliases).
  const known = knownFieldNames(op);
  const reserved = new Set(["parentType", "parentId", "confirm"]);
  const unknown = Object.keys(params).filter((k) => !known.has(k) && !reserved.has(k));
  if (unknown.length > 0) {
    const accepted = [...known].sort();
    return error(
      `Unknown field(s) for ${toolName}: ${unknown.join(", ")}`,
      { accepted },
    );
  }

  // 3. Required-field enforcement.
  const required = computeRequired(op, params);
  const missingRequired = required
    .filter((f) => !hasValue(params[f.name]))
    .map((f) => f.name);
  if (missingRequired.length > 0) {
    return error(
      `Missing required field(s) for ${toolName}: ${missingRequired.join(", ")}`,
      { required: required.map((f) => f.name) },
    );
  }

  // 4. Destructive gating.
  const destructiveValue = findDestructiveValue(op, params);
  const isDestructive = op.destructive || destructiveValue !== null;
  // Only honour confirm bypass from the options object (set programmatically
  // by trusted callers like the sandbox). Never trust rawParams.confirm --
  // a model can pass it to skip the dialog.
  const confirmBypass = options.confirm === true;
  if (isDestructive && !confirmBypass) {
    const preview: WritePreview = {
      tool: toolName,
      action: destructiveValue
        ? `${destructiveValue.field}=${destructiveValue.value}`
        : "destructive",
      method: op.method === "DELETE" ? "DELETE" : "POST",
      description: buildDescription(toolName, params),
      params: { ...params },
      env: options.env,
    };
    const choice = await requestConfirm(preview);
    if (choice === "cancel") {
      return error("Operation cancelled by user.");
    }
  }

  // 5. Coerce values at the transport boundary.
  const body: Record<string, string> = {};
  for (const f of op.request) {
    const raw = params[f.name];
    if (!hasValue(raw)) continue;
    body[f.name] = coerceFieldValue(f, raw);
  }

  // 6. Execute.
  const auditMeta = op.auditEventType
    ? {
        eventType: op.auditEventType as AuditEventType,
        entityId:
          (params.contactId as string | undefined) ??
          (params.entityId as string | undefined) ??
          (params.merchantAccountId as string | undefined) ??
          (params.parentId as string | undefined) ??
          // Fall back to the first resolved path param (e.g. merchantId, divisionId)
          op.pathParams.reduce<string | undefined>(
            (found, p) => found ?? (params[p.name] as string | undefined),
            undefined,
          ) ??
          "",
        entityType: (parentType ?? op.parentEntityType ?? "") as string,
      }
    : undefined;

  const res = await apiRequest<T>(
    options.creds,
    options.env,
    {
      method: op.method === "GET" ? "GET" : op.method === "DELETE" ? "DELETE" : "POST",
      path,
      params: Object.keys(body).length > 0 ? body : undefined,
    },
    auditMeta,
  );

  // 7. Strip soft-deleted items from list responses.
  if (
    res.ok &&
    toolName.startsWith("list_") &&
    res.data &&
    typeof res.data === "object"
  ) {
    const hidden = filterDisabledFromList(res.data as Record<string, unknown>);
    if (hidden > 0) {
      (res.data as Record<string, unknown>)._hiddenDisabled = hidden;
    }
  }

  if (res.ok && toolName === "create_api_token") {
    const tokenId = extractApiTokenId(res.data);
    if (tokenId) {
      try {
        await cleanupStandaloneApiTokenCreate(tokenId, options);
        (res.data as Record<string, unknown>)._temporaryTokenDeleted = true;
      } catch (cleanupError) {
        (res.data as Record<string, unknown>)._temporaryTokenDeleted = false;
        (res.data as Record<string, unknown>)._cleanupError = cleanupError instanceof Error ? cleanupError.message : "Token cleanup failed.";
      }
    }
  }

  if (!isReadOnlyTool(toolName)) {
    options.onWriteAccepted?.(buildDescription(toolName, params));
  }

  return { ...res, data: redactSecrets(res.data) };
}

export function manifestSource(): string {
  return MANIFEST.source.spec;
}
