import { allSettings, type SettingMeta } from "../sdk/riro-tree";
import familyProfilesData from "../../src_data/settings_family_profiles.json";
import { normalizeGlossaryText } from "./glossary";

type FamilyMatchMode = "alias" | "label" | "shortcode";

export interface FamilySearchTerm {
  term: string;
  source: "family";
  matchedInput?: string;
  canonicalTerm?: string;
}

export interface SettingFamilyInfo {
  shortcode: string;
  label: string;
  aliases: string[];
  totalSettingCount: number;
}

export interface SettingFamilyMatch extends SettingFamilyInfo {
  matchedBy: FamilyMatchMode[];
  matchedInputs: string[];
}

export interface FamilySearchExpansion {
  applied: boolean;
  matchedFamilies: SettingFamilyMatch[];
  searchTerms: FamilySearchTerm[];
  blockedQueryTerms: string[];
}

interface FamilyConfig {
  aliases: string[];
  label?: string;
  rankingProfile?: FamilyRankingProfile;
}

interface FamilyRankingProfile {
  keyContainsBoosts?: Array<[string, number]>;
  keyEndsWithBoosts?: Array<[string, number]>;
  preferredKeyFragments?: string[];
  pathStartsWithBoosts?: Array<[string, number]>;
  preferredKeyMismatchPenalty?: number;
}

interface FamilyProfileEntry {
  aliases: string[];
  label?: string;
  rankingProfile?: FamilyRankingProfile;
  shortcode: string;
}

interface SettingFamilyRecord extends SettingFamilyInfo {
  normalizedAliases: string[];
  normalizedLabel: string;
  normalizedShortcode: string;
  memberKeys: Set<string>;
}

const SHORTCODE_TECH_PATTERN = /\/([a-z]{2}\.[a-z]{2}):/gi;
const SHORTCODE_PATH_PATTERN = /\(([a-z]{2}\.[a-z]{2})\)/gi;

const FAMILY_CONFIG: Record<string, FamilyConfig> = Object.fromEntries(
  ((familyProfilesData as { families: FamilyProfileEntry[] }).families ?? []).map((entry) => [
    entry.shortcode,
    {
      aliases: entry.aliases ?? [],
      label: entry.label,
      rankingProfile: entry.rankingProfile,
    },
  ]),
);

const familyByShortcode = new Map<string, SettingFamilyRecord>();
const keyToFamilyShortcodes = new Map<string, string[]>();

buildFamilyIndex();

export function resolveSettingFamilies(query: string): FamilySearchExpansion {
  const normalizedQuery = normalizeGlossaryText(query);
  const rawQuery = query.toLowerCase();
  const matchedFamilies: SettingFamilyMatch[] = [];
  const searchTerms: FamilySearchTerm[] = [];
  const blockedQueryTerms = new Set<string>();

  for (const family of familyByShortcode.values()) {
    const matchedBy = new Set<FamilyMatchMode>();
    const matchedInputs = new Set<string>();

    if (
      rawQuery.includes(family.shortcode) ||
      (family.normalizedShortcode && normalizedQuery.includes(family.normalizedShortcode))
    ) {
      matchedBy.add("shortcode");
      matchedInputs.add(family.shortcode);
      if (family.normalizedShortcode) {
        blockedQueryTerms.add(family.normalizedShortcode);
      }
      for (const token of family.normalizedShortcode.split(" ")) {
        if (token.length <= 3) blockedQueryTerms.add(token);
      }
    }

    if (family.normalizedLabel && normalizedQuery.includes(family.normalizedLabel)) {
      matchedBy.add("label");
      matchedInputs.add(family.label);
    }

    for (let index = 0; index < family.normalizedAliases.length; index++) {
      const normalizedAlias = family.normalizedAliases[index];
      if (!normalizedAlias || !normalizedQuery.includes(normalizedAlias)) continue;
      matchedBy.add("alias");
      matchedInputs.add(family.aliases[index]);
    }

    if (matchedBy.size === 0) continue;

    matchedFamilies.push({
      aliases: family.aliases,
      label: family.label,
      matchedBy: [...matchedBy].sort(),
      matchedInputs: [...matchedInputs],
      shortcode: family.shortcode,
      totalSettingCount: family.totalSettingCount,
    });

    searchTerms.push({
      term: family.normalizedShortcode,
      source: "family",
      matchedInput: [...matchedInputs][0],
      canonicalTerm: family.shortcode,
    });

    if (family.normalizedLabel && family.normalizedLabel !== family.normalizedShortcode) {
      searchTerms.push({
        term: family.normalizedLabel,
        source: "family",
        matchedInput: [...matchedInputs][0],
        canonicalTerm: family.shortcode,
      });
    }
  }

  matchedFamilies.sort((a, b) => b.totalSettingCount - a.totalSettingCount || a.shortcode.localeCompare(b.shortcode));

  return {
    applied: matchedFamilies.length > 0,
    matchedFamilies,
    searchTerms: dedupeFamilySearchTerms(searchTerms),
    blockedQueryTerms: [...blockedQueryTerms],
  };
}

export function getSettingFamiliesForMeta(meta: SettingMeta): SettingFamilyInfo[] {
  const shortcodes = keyToFamilyShortcodes.get(meta.flatKey) ?? [];
  return shortcodes
    .map((shortcode) => familyByShortcode.get(shortcode))
    .filter((family): family is SettingFamilyRecord => Boolean(family))
    .map((family) => ({
      aliases: family.aliases,
      label: family.label,
      shortcode: family.shortcode,
      totalSettingCount: family.totalSettingCount,
    }));
}

export function getFamilyRankingBoost(
  meta: SettingMeta,
  matchedFamilies: SettingFamilyMatch[],
): number {
  if (matchedFamilies.length === 0) return 0;

  let boost = 0;
  const metaFamilies = new Set(getSettingFamiliesForMeta(meta).map((family) => family.shortcode));

  for (const family of matchedFamilies) {
    if (!metaFamilies.has(family.shortcode)) continue;
    boost += applyRankingProfile(meta, FAMILY_CONFIG[family.shortcode]?.rankingProfile);
  }

  return boost;
}

function buildFamilyIndex() {
  for (const meta of allSettings()) {
    const shortcodes = extractShortcodes(meta);
    if (shortcodes.length === 0) continue;

    keyToFamilyShortcodes.set(meta.flatKey, shortcodes);

    for (const shortcode of shortcodes) {
      const config = FAMILY_CONFIG[shortcode];
      const family = ensureFamilyRecord(shortcode, config);
      family.memberKeys.add(meta.flatKey);

      const candidateLabel = extractFamilyLabel(meta, shortcode);
      if (candidateLabel && !config?.label) {
        const currentLabel = family.label;
        if (
          currentLabel === family.shortcode ||
          candidateLabel.length < currentLabel.length
        ) {
          family.label = candidateLabel;
          family.normalizedLabel = normalizeGlossaryText(candidateLabel);
        }
      }
    }
  }

  for (const family of familyByShortcode.values()) {
    family.totalSettingCount = family.memberKeys.size;
  }
}

function ensureFamilyRecord(shortcode: string, config?: FamilyConfig): SettingFamilyRecord {
  const existing = familyByShortcode.get(shortcode);
  if (existing) return existing;

  const label = config?.label ?? shortcode;
  const aliases = config?.aliases ?? [];
  const family: SettingFamilyRecord = {
    aliases,
    label,
    memberKeys: new Set<string>(),
    normalizedAliases: aliases.map(normalizeGlossaryText).filter(Boolean),
    normalizedLabel: normalizeGlossaryText(label),
    normalizedShortcode: normalizeGlossaryText(shortcode),
    shortcode,
    totalSettingCount: 0,
  };
  familyByShortcode.set(shortcode, family);
  return family;
}

function extractShortcodes(meta: SettingMeta): string[] {
  const shortcodes = new Set<string>();

  for (const match of collectMatches(meta.flatKey, SHORTCODE_TECH_PATTERN)) {
    shortcodes.add(match.toLowerCase());
  }
  for (const match of collectMatches(meta.bipPath || "", SHORTCODE_PATH_PATTERN)) {
    shortcodes.add(match.toLowerCase());
  }

  return [...shortcodes].sort();
}

function extractFamilyLabel(meta: SettingMeta, shortcode: string): string {
  if (!meta.bipPath) return "";

  const pattern = new RegExp(`\\(${escapeRegExp(shortcode)}\\)`, "i");
  const cleaned = meta.bipPath
    .split(" > ")
    .filter((segment) => pattern.test(segment))
    .map((segment) => segment.replace(pattern, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);

  return cleaned[0] ?? "";
}

function collectMatches(value: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  const scopedPattern = new RegExp(pattern.source, pattern.flags);
  let match = scopedPattern.exec(value);
  while (match) {
    matches.push(match[1]);
    match = scopedPattern.exec(value);
  }
  return matches;
}

function dedupeFamilySearchTerms(terms: FamilySearchTerm[]): FamilySearchTerm[] {
  const seen = new Set<string>();
  const unique: FamilySearchTerm[] = [];
  for (const term of terms) {
    const key = `${term.source}::${term.term}::${term.canonicalTerm ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(term);
  }
  return unique;
}

function applyRankingProfile(meta: SettingMeta, profile?: FamilyRankingProfile): number {
  if (!profile) return 0;

  const key = meta.flatKey;
  const bipPath = meta.bipPath || "";

  let boost = 0;

  for (const [fragment, value] of profile.keyContainsBoosts ?? []) {
    if (key.includes(fragment)) boost += value;
  }
  for (const [suffix, value] of profile.keyEndsWithBoosts ?? []) {
    if (key.endsWith(suffix)) boost += value;
  }
  for (const [prefix, value] of profile.pathStartsWithBoosts ?? []) {
    if (bipPath.startsWith(prefix)) boost += value;
  }
  if (
    profile.preferredKeyMismatchPenalty &&
    profile.preferredKeyFragments?.length &&
    !profile.preferredKeyFragments.some((fragment) => key.includes(fragment))
  ) {
    boost += profile.preferredKeyMismatchPenalty;
  }

  return boost;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}