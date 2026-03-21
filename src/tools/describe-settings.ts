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

import riroData from "../../base_data/riro_consolidated_lookup.json";

interface RiroEntry {
  id: number;
  key: string;
  type: string;
  path: string;
  default: string;
}

const ENTRIES: RiroEntry[] = (riroData as { entries: RiroEntry[] }).entries;

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

  const matches = ENTRIES.filter(
    (e) =>
      e.key.toLowerCase().includes(q) ||
      (e.path && e.path.toLowerCase().includes(q))
  ).slice(0, limit);

  return {
    query: input.query,
    matchCount: matches.length,
    totalEntries: ENTRIES.length,
    results: matches.map((e) => formatEntry(e)),
  };
}

function formatEntry(entry: RiroEntry) {
  const tierA = entry.type && entry.path;
  const sdkPath = keyToSdkPath(entry.key);

  if (tierA) {
    return {
      tier: "A" as const,
      key: entry.key,
      sdkPath,
      bipPath: entry.path,
      typeSnippet: toTypeSnippet(sdkPath, entry.type, entry.default),
      default: entry.default || undefined,
    };
  }

  return {
    tier: "B" as const,
    key: entry.key,
    sdkPath,
    bipPath: entry.path || null,
    warning: "Type metadata missing -- raw key-value only, no type validation.",
    default: entry.default || undefined,
  };
}

/**
 * Convert a flat RiRo key to an SDK-style dotted path.
 * e.g. "* /type:entity/module:ctpe/processing:risk/risk:avsCheck/avsCheck:active"
 *   -> "risk.avsCheck.active"
 *
 * Strategy: take the last two segments and use the value parts.
 */
function keyToSdkPath(key: string): string {
  const segments = key.split("/").filter(Boolean);
  // Skip the leading wildcard and type/module segments; use the meaningful tail
  const meaningful = segments
    .filter((s) => !s.startsWith("*") && !s.startsWith("type:") && !s.startsWith("module:"))
    .map((s) => {
      const colonIdx = s.indexOf(":");
      return colonIdx >= 0 ? s.substring(colonIdx + 1) : s;
    });

  return meaningful.join(".");
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
    case "enum":
      return "string /* enum */";
    case "list":
      return "string[] /* list */";
    default:
      return `string /* ${riroType} */`;
  }
}
