/**
 * Helpers to navigate the generated Web API operation manifest.
 *
 * Exposes a typed view of the manifest plus utilities used by the
 * typed write adapter (picking a variant by parentType, coercing
 * values at the form-encode boundary, deriving path-parameter keys).
 */

import manifestData from "../../src_data/webapi-operation-manifest.json";
import type {
  WebApiOperation,
  WebApiOperationManifest,
  WebApiRequestField,
} from "../../src_data/webapi-operation-manifest";

export const MANIFEST = manifestData as unknown as WebApiOperationManifest;

export type ToolName = string;

export type ParentEntityType = "psp" | "division" | "merchant" | "channel";

/** Maps a parent entity type to the path-parameter name the spec uses. */
export const PARENT_ID_KEY: Record<ParentEntityType, string> = {
  psp: "pspId",
  division: "divisionId",
  merchant: "merchantId",
  channel: "channelId",
};

/** Tools that have more than one variant keyed by `parentEntityType`. */
export function toolHasParentVariants(toolName: ToolName): boolean {
  const variants = (MANIFEST.toolIndex as Record<string, WebApiOperation[]>)[toolName] ?? [];
  if (variants.length <= 1) return false;
  const parents = new Set(variants.map((v) => v.parentEntityType));
  parents.delete(null);
  return parents.size > 1;
}

/** Return variants (operations) registered for a tool name. */
export function variantsFor(toolName: ToolName): WebApiOperation[] {
  return (MANIFEST.toolIndex as Record<string, WebApiOperation[]>)[toolName] ?? [];
}

/** List of parent entity types declared for a multi-variant tool. */
export function parentTypesFor(toolName: ToolName): ParentEntityType[] {
  const variants = variantsFor(toolName);
  const parents = new Set<ParentEntityType>();
  for (const v of variants) {
    if (v.parentEntityType) parents.add(v.parentEntityType as ParentEntityType);
  }
  return Array.from(parents);
}

/** Pick the operation variant matching the passed parentType (or the only one). */
export function pickOperation(
  toolName: ToolName,
  parentType?: ParentEntityType | null,
): WebApiOperation | null {
  const variants = variantsFor(toolName);
  if (variants.length === 0) return null;
  if (variants.length === 1) return variants[0];
  if (parentType) {
    const hit = variants.find((v) => v.parentEntityType === parentType);
    if (hit) return hit;
  }
  // Fallback: the first variant whose parentEntityType is explicitly null.
  const unscoped = variants.find((v) => v.parentEntityType === null);
  return unscoped ?? variants[0];
}

/**
 * Coerce a user-supplied request-field value to its canonical string form
 * for application/x-www-form-urlencoded transport. Centralizes the D7 rule.
 */
export function coerceFieldValue(field: WebApiRequestField, value: unknown): string {
  if (value === null || value === undefined) return "";

  switch (field.logicalType) {
    case "boolean":
      return normalizeBoolean(value);
    case "integer":
      return normalizeInteger(value);
    case "timestamp_seconds":
      return normalizeTimestampSeconds(value);
    case "enum":
    case "string":
    case "url":
    default:
      return String(value);
  }
}

function normalizeBoolean(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  const s = String(value).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return "true";
  if (s === "false" || s === "0" || s === "no") return "false";
  return String(value);
}

function normalizeInteger(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isFinite(parsed)) return String(parsed);
  return String(value);
}

/** YYYY-MM-DD HH:mm:ss in the spec timezone; we only format if input is numeric or ISO. */
function normalizeTimestampSeconds(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatDate(new Date(value * 1000));
  }
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return formatDate(new Date(Number(s) * 1000));
  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) return formatDate(iso);
  return s;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** Set of field names known to the operation (path params + request body). */
export function knownFieldNames(op: WebApiOperation): Set<string> {
  const names = new Set<string>();
  for (const p of op.pathParams) names.add(p.name);
  for (const f of op.request) names.add(f.name);
  return names;
}

/** Distinct audit event types mentioned in the manifest. */
export function manifestAuditEventTypes(): string[] {
  const set = new Set<string>();
  for (const op of MANIFEST.operations) {
    if (op.auditEventType) set.add(op.auditEventType);
  }
  return Array.from(set).sort();
}
