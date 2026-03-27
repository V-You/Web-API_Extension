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
import {
  getFamilyRankingBoost,
  getSettingFamiliesForMeta,
  resolveSettingFamilies,
  type FamilySearchTerm,
  type SettingFamilyMatch,
} from "../lib/settings-family";

export interface DescribeSettingsInput {
  /** Keyword to search for (matched against key and path). */
  query: string;
  /** Max results to return (default: 20). */
  limit?: number;
}

export function executeDescribeSettings(input: DescribeSettingsInput) {
  if (!input.query) return { error: "query is required." };

  const limit = Math.min(input.limit ?? 20, 100);
  const glossaryExpansion = expandGlossaryQuery(input.query);
  const familyExpansion = resolveSettingFamilies(input.query);
  const searchTerms = filterBlockedQueryTerms(
    dedupeSearchTerms([...glossaryExpansion.searchTerms, ...familyExpansion.searchTerms]),
    familyExpansion.blockedQueryTerms,
  );

  const matches = allSettings()
    .map((meta) => rankMatch(meta, searchTerms, familyExpansion.matchedFamilies))
    .filter((match): match is RankedMatch => match !== null)
    .sort((a, b) => b.score - a.score || a.meta.sdkPath.localeCompare(b.meta.sdkPath));

  const limited = matches.slice(0, limit);
  const familyGroups = familyExpansion.applied
    ? buildFamilyGroups(limited, familyExpansion.matchedFamilies)
    : [];

  return {
    query: input.query,
    normalizedQuery: glossaryExpansion.normalizedQuery,
    glossary: {
      applied: glossaryExpansion.applied,
      matchedEntries: glossaryExpansion.matchedEntries,
      searchTerms: glossaryExpansion.searchTerms.map((term) => ({
        term: term.term,
        source: term.source,
        matchedInput: term.matchedInput,
        canonicalTerm: term.canonicalTerm,
      })),
    },
    familyResolution: {
      applied: familyExpansion.applied,
      blockedQueryTerms: familyExpansion.blockedQueryTerms,
      matchedFamilies: familyExpansion.matchedFamilies,
    },
    matchCount: matches.length,
    returnedCount: limited.length,
    totalEntries: entryCount,
    familyGroups,
    results: limited.map((m) => formatEntry(m.meta, m.details)),
  };
}

type SearchTerm = FamilySearchTerm | GlossarySearchTerm;

interface MatchDetail {
  field: "flatKey" | "sdkPath" | "bipPath";
  term: string;
  source: "query" | "glossary" | "family";
  matchedInput?: string;
  canonicalTerm?: string;
}

interface RankedMatch {
  meta: SettingMeta;
  score: number;
  details: MatchDetail[];
}

function rankMatch(
  meta: SettingMeta,
  terms: SearchTerm[],
  matchedFamilies: SettingFamilyMatch[],
): RankedMatch | null {
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
      score += scoreForMatch("bipPath", term.source);
    }
    if (sdkPath.includes(term.term)) {
      details.push({
        field: "sdkPath",
        term: term.term,
        source: term.source,
        matchedInput: term.matchedInput,
        canonicalTerm: term.canonicalTerm,
      });
      score += scoreForMatch("sdkPath", term.source);
    }
    if (flatKey.includes(term.term)) {
      details.push({
        field: "flatKey",
        term: term.term,
        source: term.source,
        matchedInput: term.matchedInput,
        canonicalTerm: term.canonicalTerm,
      });
      score += scoreForMatch("flatKey", term.source);
    }
  }

  if (details.length === 0) return null;

  score += getFamilyRankingBoost(meta, matchedFamilies);
  score += new Set(details.map((detail) => `${detail.field}:${detail.term}:${detail.source}`)).size;

  return { meta, score, details: dedupeDetails(details) };
}

function scoreForMatch(
  field: MatchDetail["field"],
  source: MatchDetail["source"],
): number {
  if (field === "bipPath") {
    if (source === "query") return 300;
    if (source === "family") return 260;
    return 180;
  }
  if (field === "sdkPath") {
    if (source === "query") return 220;
    if (source === "family") return 190;
    return 130;
  }
  if (source === "query") return 140;
  if (source === "family") return 120;
  return 80;
}

function dedupeSearchTerms(terms: SearchTerm[]): SearchTerm[] {
  const seen = new Set<string>();
  const unique: SearchTerm[] = [];
  for (const term of terms) {
    const key = `${term.source}:${term.term}:${term.canonicalTerm ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(term);
  }
  return unique;
}

function filterBlockedQueryTerms(terms: SearchTerm[], blocked: string[]): SearchTerm[] {
  if (blocked.length === 0) return terms;
  const blockedTerms = new Set(blocked);
  return terms.filter((term) => !(term.source === "query" && blockedTerms.has(term.term)));
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
    familyMatch: details.some((detail) => detail.source === "family"),
    familyShortcodes: [...new Set(details.filter((detail) => detail.source === "family").map((detail) => detail.canonicalTerm ?? detail.term))],
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

function buildFamilyGroups(matches: RankedMatch[], families: SettingFamilyMatch[]) {
  const familiesByShortcode = new Map(families.map((family) => [family.shortcode, family]));
  const groups = new Map<string, {
    aliases: string[];
    label: string;
    matchedBy: SettingFamilyMatch["matchedBy"];
    matchedInputs: string[];
    results: Array<ReturnType<typeof formatEntry>>;
    shortcode: string;
    totalSettingCount: number;
  }>();

  for (const match of matches) {
    for (const family of getSettingFamiliesForMeta(match.meta)) {
      const resolvedFamily = familiesByShortcode.get(family.shortcode);
      if (!resolvedFamily) continue;

      const existing = groups.get(family.shortcode);
      if (existing) {
        existing.results.push(formatEntry(match.meta, match.details));
        continue;
      }

      groups.set(family.shortcode, {
        aliases: family.aliases,
        label: family.label,
        matchedBy: resolvedFamily.matchedBy,
        matchedInputs: resolvedFamily.matchedInputs,
        results: [formatEntry(match.meta, match.details)],
        shortcode: family.shortcode,
        totalSettingCount: family.totalSettingCount,
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.results.length - a.results.length || a.label.localeCompare(b.label));
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
