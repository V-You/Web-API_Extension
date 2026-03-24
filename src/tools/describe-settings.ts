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
import {
  expandGlossaryQuery,
  normalizeGlossaryText,
  type GlossarySearchTerm,
} from "../lib/glossary";

export interface DescribeSettingsInput {
  /** Keyword to search for (matched against key and path). */
  query: string;
  /** Max results to return (default: 20). */
  limit?: number;
}

export function executeDescribeSettings(input: DescribeSettingsInput) {
  if (!input.query) return { error: "query is required." };

  const limit = Math.min(input.limit ?? 20, 100);
  const expansion = expandGlossaryQuery(input.query);

  const matches = allSettings()
    .map((meta) => rankMatch(meta, expansion.searchTerms))
    .filter((match): match is RankedMatch => match !== null)
    .sort((a, b) => b.score - a.score || a.meta.sdkPath.localeCompare(b.meta.sdkPath));

  const limited = matches.slice(0, limit);

  return {
    query: input.query,
    normalizedQuery: expansion.normalizedQuery,
    glossary: {
      applied: expansion.applied,
      matchedEntries: expansion.matchedEntries,
      searchTerms: expansion.searchTerms.map((term) => ({
        term: term.term,
        source: term.source,
        matchedInput: term.matchedInput,
        canonicalTerm: term.canonicalTerm,
      })),
    },
    matchCount: matches.length,
    returnedCount: limited.length,
    totalEntries: entryCount,
    results: limited.map((m) => formatEntry(m.meta, m.details)),
  };
}

interface MatchDetail {
  field: "flatKey" | "sdkPath" | "bipPath";
  term: string;
  source: "query" | "glossary";
  matchedInput?: string;
  canonicalTerm?: string;
}

interface RankedMatch {
  meta: SettingMeta;
  score: number;
  details: MatchDetail[];
}

function rankMatch(meta: SettingMeta, terms: GlossarySearchTerm[]): RankedMatch | null {
  const flatKey = normalizeGlossaryText(meta.flatKey);
  const sdkPath = normalizeGlossaryText(meta.sdkPath);
  const bipPath = normalizeGlossaryText(meta.bipPath || "");
  const details: MatchDetail[] = [];
  let score = meta.tier === "A" ? 5 : 0;

  for (const term of terms) {
    if (!term.term) continue;
    if (bipPath && bipPath.includes(term.term)) {
      details.push({
        field: "bipPath",
        term: term.term,
        source: term.source,
        matchedInput: term.matchedInput,
        canonicalTerm: term.canonicalTerm,
      });
      score += term.source === "query" ? 300 : 180;
    }
    if (sdkPath.includes(term.term)) {
      details.push({
        field: "sdkPath",
        term: term.term,
        source: term.source,
        matchedInput: term.matchedInput,
        canonicalTerm: term.canonicalTerm,
      });
      score += term.source === "query" ? 220 : 130;
    }
    if (flatKey.includes(term.term)) {
      details.push({
        field: "flatKey",
        term: term.term,
        source: term.source,
        matchedInput: term.matchedInput,
        canonicalTerm: term.canonicalTerm,
      });
      score += term.source === "query" ? 140 : 80;
    }
  }

  if (details.length === 0) return null;

  score += new Set(details.map((detail) => `${detail.field}:${detail.term}:${detail.source}`)).size;

  return { meta, score, details: dedupeDetails(details) };
}

function dedupeDetails(details: MatchDetail[]): MatchDetail[] {
  const seen = new Set<string>();
  const unique: MatchDetail[] = [];
  for (const detail of details) {
    const key = `${detail.field}:${detail.term}:${detail.source}:${detail.canonicalTerm ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(detail);
  }
  return unique;
}

function formatEntry(meta: SettingMeta, details: MatchDetail[]) {
  const match = {
    glossaryMatch: details.some((detail) => detail.source === "glossary"),
    matchedFields: [...new Set(details.map((detail) => detail.field))],
    matchedTerms: [...new Set(details.map((detail) => detail.term))],
    glossaryTerms: [...new Set(details.filter((detail) => detail.source === "glossary").map((detail) => detail.canonicalTerm ?? detail.term))],
  };

  if (meta.tier === "A") {
    return {
      tier: "A" as const,
      key: meta.flatKey,
      sdkPath: meta.sdkPath,
      bipPath: meta.bipPath,
      typeSnippet: toTypeSnippet(meta.sdkPath, meta.riroType, meta.defaultValue),
      default: meta.defaultValue || undefined,
      match,
    };
  }

  return {
    tier: "B" as const,
    key: meta.flatKey,
    sdkPath: meta.sdkPath,
    bipPath: meta.bipPath || null,
    warning: "Type metadata missing -- raw key-value only, no type validation.",
    default: meta.defaultValue || undefined,
    match,
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
