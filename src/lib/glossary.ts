import glossaryData from "../../base_data/glossary.json";

export interface GlossaryEntry {
  term: string;
  aliases: string[];
  definition: string;
  context: string;
  pattern?: string;
}

interface RuntimeGlossaryEntry extends GlossaryEntry {
  normalizedTerm: string;
  normalizedAliases: string[];
}

export interface GlossarySearchTerm {
  term: string;
  source: "query" | "glossary";
  matchedInput?: string;
  canonicalTerm?: string;
}

export interface GlossaryMatchedEntry {
  term: string;
  matchedInput: string;
  context: string;
}

export interface GlossaryExpansion {
  normalizedQuery: string;
  applied: boolean;
  searchTerms: GlossarySearchTerm[];
  matchedEntries: GlossaryMatchedEntry[];
}

const RAW_ENTRIES: GlossaryEntry[] = (glossaryData as { entries: GlossaryEntry[] }).entries;

const ENTRIES: RuntimeGlossaryEntry[] = RAW_ENTRIES.map((entry) => ({
  ...entry,
  normalizedTerm: normalizeGlossaryText(entry.term),
  normalizedAliases: (entry.aliases ?? []).map(normalizeGlossaryText).filter(Boolean),
}));

const LOOKUP = new Map<string, RuntimeGlossaryEntry[]>();

for (const entry of ENTRIES) {
  addLookup(entry.normalizedTerm, entry);
  for (const alias of entry.normalizedAliases) {
    addLookup(alias, entry);
  }
}

function addLookup(key: string, entry: RuntimeGlossaryEntry) {
  if (!key) return;
  const existing = LOOKUP.get(key);
  if (existing) {
    existing.push(entry);
  } else {
    LOOKUP.set(key, [entry]);
  }
}

export function normalizeGlossaryText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function expandGlossaryQuery(query: string): GlossaryExpansion {
  const normalizedQuery = normalizeGlossaryText(query);
  if (!normalizedQuery) {
    return {
      normalizedQuery,
      applied: false,
      searchTerms: [],
      matchedEntries: [],
    };
  }

  const directCandidates = uniquePreservingOrder([
    normalizedQuery,
    ...normalizedQuery.split(" ").filter(Boolean),
  ]);

  const searchTerms: GlossarySearchTerm[] = [];
  for (const candidate of directCandidates) {
    searchTerms.push({ term: candidate, source: "query" });
  }

  const matchedEntries: GlossaryMatchedEntry[] = [];
  const seenEntryInputs = new Set<string>();
  const seenGlossaryTerms = new Set<string>();

  for (const candidate of directCandidates) {
    const entries = LOOKUP.get(candidate) ?? [];
    for (const entry of entries) {
      const entryKey = `${entry.term}::${candidate}`;
      if (!seenEntryInputs.has(entryKey)) {
        matchedEntries.push({
          term: entry.term,
          matchedInput: candidate,
          context: entry.context,
        });
        seenEntryInputs.add(entryKey);
      }

      const expansionTerms = uniquePreservingOrder([
        entry.normalizedTerm,
        ...entry.normalizedAliases,
      ]);

      for (const term of expansionTerms) {
        if (!term || directCandidates.includes(term)) continue;
        const glossaryKey = `${entry.term}::${term}`;
        if (seenGlossaryTerms.has(glossaryKey)) continue;
        searchTerms.push({
          term,
          source: "glossary",
          matchedInput: candidate,
          canonicalTerm: entry.term,
        });
        seenGlossaryTerms.add(glossaryKey);
      }
    }
  }

  const boundedSearchTerms = uniqueSearchTerms(searchTerms).slice(0, 12);

  return {
    normalizedQuery,
    applied: matchedEntries.length > 0,
    searchTerms: boundedSearchTerms,
    matchedEntries,
  };
}

function uniquePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function uniqueSearchTerms(values: GlossarySearchTerm[]): GlossarySearchTerm[] {
  const seen = new Set<string>();
  const unique: GlossarySearchTerm[] = [];
  for (const value of values) {
    const key = `${value.source}::${value.term}::${value.canonicalTerm ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}
