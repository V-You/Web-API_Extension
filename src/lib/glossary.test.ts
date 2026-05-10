import glossaryData from "../../base_data/glossary.json";
import { describe, expect, it } from "vitest";

import { expandGlossaryQuery, normalizeGlossaryText } from "./glossary";

describe("glossary data", () => {
  it("keeps the shipped glossary non-empty and well-formed", () => {
    expect(Array.isArray(glossaryData.entries)).toBe(true);
    expect(glossaryData.entries.length).toBeGreaterThan(1);

    for (const entry of glossaryData.entries) {
      expect(typeof entry.term).toBe("string");
      expect(entry.term.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(entry.aliases)).toBe(true);
      expect(typeof entry.definition).toBe("string");
      expect(entry.definition.trim().length).toBeGreaterThan(0);
      expect(typeof entry.context).toBe("string");
      expect(entry.context.trim().length).toBeGreaterThan(0);
    }
  });
  it("resolves shipped aliases back to their canonical glossary terms", () => {
    const entriesWithAliases = glossaryData.entries.filter((entry) => entry.aliases.length > 0);

    expect(entriesWithAliases.length).toBeGreaterThan(1);

    for (const entry of entriesWithAliases) {
      for (const alias of entry.aliases) {
        const result = expandGlossaryQuery(alias);

        expect(result.applied, `expected glossary match for alias: ${alias}`).toBe(true);
        expect(
          result.matchedEntries.map((matchedEntry) => normalizeGlossaryText(matchedEntry.term)),
          `expected canonical term match for alias: ${alias}`,
        ).toContain(normalizeGlossaryText(entry.term));
      }
    }
  });
});