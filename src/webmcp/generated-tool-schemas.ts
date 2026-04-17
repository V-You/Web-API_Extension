/**
 * Per-action WebMCP tool schemas generated from the operation manifest.
 *
 * Each entry is a flat JSON-Schema object (no oneOf/allOf/anyOf) so it
 * survives Gemini-style sanitization. Used both for WebMCP publication
 * and as the input to the chat-declaration generator (Phase 3).
 */

import type {
  WebApiOperation,
  WebApiRequestField,
} from "../../src_data/webapi-operation-manifest";
import {
  MANIFEST,
  parentTypesFor,
  toolHasParentVariants,
  variantsFor,
  type ToolName,
} from "../tools/manifest-helpers";

import type { ToolSchema } from "./tool-schemas";

const READ_TOOL_PREFIXES = ["get_", "list_"];

function logicalTypeToJsonType(field: WebApiRequestField): string {
  switch (field.logicalType) {
    case "boolean":
      return "boolean";
    case "integer":
      return "integer";
    case "enum":
    case "string":
    case "url":
    case "timestamp_seconds":
    default:
      return "string";
  }
}

function shortDescription(raw: string | null): string {
  if (!raw) return "";
  const first = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return (first ?? raw).slice(0, 160);
}

function buildFieldSchema(field: WebApiRequestField): Record<string, unknown> {
  const prop: Record<string, unknown> = {
    type: logicalTypeToJsonType(field),
    description: shortDescription(field.description),
  };
  if (field.enum && field.enum.length > 0) prop.enum = field.enum;
  if (field.pattern) prop.pattern = field.pattern;
  if (field.format) prop.format = field.format;
  return prop;
}

/** Unique path params across all variants of a tool. */
function unionPathParams(variants: WebApiOperation[]): { name: string; pattern: string | null }[] {
  const seen = new Map<string, { name: string; pattern: string | null }>();
  for (const v of variants) {
    for (const p of v.pathParams) {
      if (!seen.has(p.name)) seen.set(p.name, { name: p.name, pattern: p.pattern });
    }
  }
  return Array.from(seen.values());
}

/** Union of request fields across variants (first occurrence wins). */
function unionRequestFields(variants: WebApiOperation[]): WebApiRequestField[] {
  const seen = new Map<string, WebApiRequestField>();
  for (const v of variants) {
    for (const f of v.request) if (!seen.has(f.name)) seen.set(f.name, f);
  }
  return Array.from(seen.values());
}

function titleFromToolName(toolName: ToolName): string {
  return toolName
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildDescription(toolName: ToolName, variants: WebApiOperation[]): string {
  const first = variants[0];
  const methodPath = variants
    .map((v) => `${v.method} ${v.pathTemplate}`)
    .join(" | ");
  const note = first.description ? ` ${shortDescription(first.description)}` : "";
  const destructive = first.destructive ? " Destructive: routed through the confirm bridge." : "";
  return `${toolName} -> ${methodPath}.${note}${destructive}`;
}

function isReadTool(toolName: ToolName): boolean {
  return READ_TOOL_PREFIXES.some((p) => toolName.startsWith(p));
}

function buildToolSchema(toolName: ToolName): ToolSchema {
  const variants = variantsFor(toolName);
  const multiParent = toolHasParentVariants(toolName);
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  // Path params: reserve `parentType`/`parentId` for multi-variant tools,
  // otherwise surface the spec's literal names.
  if (multiParent) {
    properties.parentType = {
      type: "string",
      enum: parentTypesFor(toolName),
      description: "Parent entity type for the selected variant.",
    };
    properties.parentId = {
      type: "string",
      description: "Parent entity ID (maps to pspId/divisionId/merchantId/channelId).",
    };
    required.push("parentType", "parentId");
  }

  const pathParams = unionPathParams(variants);
  const parentIdKeys = new Set(["pspId", "divisionId", "merchantId", "channelId"]);
  for (const p of pathParams) {
    if (multiParent && parentIdKeys.has(p.name)) continue;
    properties[p.name] = {
      type: "string",
      description: `Path parameter ${p.name}.`,
      ...(p.pattern ? { pattern: p.pattern } : {}),
    };
    required.push(p.name);
  }

  // Request-body fields.
  const fields = unionRequestFields(variants);
  for (const f of fields) {
    if (properties[f.name]) continue; // path and body may collide on contactId rarely
    properties[f.name] = buildFieldSchema(f);
    if (f.required === "required_spec") required.push(f.name);
  }

  // Allow an explicit `confirm` bypass for destructive ops invoked from sandbox scripts.
  if (variants.some((v) => v.destructive)) {
    properties.confirm = {
      type: "boolean",
      description: "Set true to bypass the confirm bridge for destructive calls.",
    };
  }

  const schema: ToolSchema = {
    name: toolName,
    title: titleFromToolName(toolName),
    description: buildDescription(toolName, variants),
    inputSchema: {
      type: "object",
      properties,
      required: Array.from(new Set(required)).sort(),
      additionalProperties: false,
    },
  };

  if (isReadTool(toolName)) schema.annotations = { readOnlyHint: true };

  return schema;
}

/** Tool names the manifest exposes but that are served by handwritten schemas. */
const HANDWRITTEN_OVERRIDES = new Set<string>([
  // `list_clearing_institutes` is surfaced via the existing lookup_clearing_institutes
  // tool; the generated variant would overlap.
  "list_clearing_institutes",
]);

export function generateToolSchemas(): ToolSchema[] {
  const out: ToolSchema[] = [];
  for (const toolName of MANIFEST.tools) {
    if (HANDWRITTEN_OVERRIDES.has(toolName)) continue;
    out.push(buildToolSchema(toolName));
  }
  return out;
}

export const GENERATED_TOOL_SCHEMAS: ToolSchema[] = generateToolSchemas();

export function generatedToolNames(): string[] {
  return GENERATED_TOOL_SCHEMAS.map((s) => s.name);
}
