/**
 * describe_settings tool handler.
 *
 * Searches the bundled RiRo lookup (1,225 entries) by keyword and returns
 * TypeScript interface snippets for matching settings -- the "type-on-demand"
 * pattern that avoids loading all settings into the LLM prompt.
 *
 * Tier A (type + path populated): returns typed interface snippet.
 * Tier B (type or path missing): returns raw key with a warning.
 */

import {
  allSettings,
  entryCount,
  type SettingMeta,
} from "../sdk/riro-tree";

export interface DescribeSettingsInput {
  /** Keyword to search for (matched against key and path). */
  query: string;
  /** Max results to return (default: 20). */
  limit?: number;
}

export function executeDescribeSettings(input: DescribeSettingsInput) {
  if (!input.query) return { error: "query is required." };

  const q = input.query.toLowerCase();
  const limit = Math.min(input.limit ?? 20, 100);

  const matches = allSettings()
    .filter(
      (m) =>
        m.flatKey.toLowerCase().includes(q) ||
        m.sdkPath.toLowerCase().includes(q) ||
        (m.bipPath && m.bipPath.toLowerCase().includes(q))
    )
    .slice(0, limit);

  return {
    query: input.query,
    matchCount: matches.length,
    totalEntries: entryCount,
    results: matches.map((m) => formatEntry(m)),
  };
}

function formatEntry(meta: SettingMeta) {
  if (meta.tier === "A") {
    return {
      tier: "A" as const,
      key: meta.flatKey,
      sdkPath: meta.sdkPath,
      bipPath: meta.bipPath,
      typeSnippet: toTypeSnippet(meta.sdkPath, meta.riroType, meta.defaultValue),
      default: meta.defaultValue || undefined,
    };
  }

  return {
    tier: "B" as const,
    key: meta.flatKey,
    sdkPath: meta.sdkPath,
    bipPath: meta.bipPath || null,
    warning: "Type metadata missing -- raw key-value only, no type validation.",
    default: meta.defaultValue || undefined,
  };
}

/** Generate a TypeScript-style type snippet for a tier A setting. */
function toTypeSnippet(
  sdkPath: string,
  type: string,
  defaultValue: string
): string {
  const parts = sdkPath.split(".");
  const propName = parts[parts.length - 1];
  const tsType = riroTypeToTs(type);
  const defaultAnnotation = defaultValue ? ` // default: ${defaultValue}` : "";
  return `${propName}: ${tsType};${defaultAnnotation}`;
}

function riroTypeToTs(riroType: string): string {
  switch (riroType.toLowerCase()) {
    case "boolean":
      return "boolean";
    case "integer":
    case "number":
      return "number";
    case "string":
    case "text":
      return "string";
    case "stringlist":
      return "string[]";
    case "enum":
    case "predefined list":
      return "string /* enum */";
    case "list":
      return "string[] /* list */";
    default:
      return `string /* ${riroType} */`;
  }
}
