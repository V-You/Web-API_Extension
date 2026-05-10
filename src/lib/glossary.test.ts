import glossaryData from "../../base_data/glossary.json";
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadGlossaryModule() {
  vi.resetModules();
  vi.doMock("../../base_data/glossary.json", () => ({
    default: {
      entries: [
        {
          term: "Attached MA",
          aliases: ["attached merchant account"],
          definition: "An MA attached to a channel.",
          context: "Configuration",
        },
        {
          term: "Available MA",
          aliases: ["owned merchant account"],
          definition: "An MA owned by the current entity.",
          context: "Configuration",
        },
        {
          term: "subType",
          aliases: ["payment brand"],
          definition: "Card brand subtype vocabulary.",
          context: "Configuration",
        },
      ],
    },
  }));

  return import("./glossary");
}

afterEach(() => {
  vi.doUnmock("../../base_data/glossary.json");
  vi.resetModules();
});

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
});

describe("glossary expansion", () => {
  it("resolves attached merchant account phrasing", async () => {
    const { expandGlossaryQuery } = await loadGlossaryModule();
    const result = expandGlossaryQuery("attached merchant account");

    expect(result.applied).toBe(true);
    expect(result.matchedEntries.map((entry) => entry.term)).toContain("Attached MA");
  });

  it("resolves owned merchant account phrasing", async () => {
    const { expandGlossaryQuery } = await loadGlossaryModule();
    const result = expandGlossaryQuery("owned merchant account");

    expect(result.applied).toBe(true);
    expect(result.matchedEntries.map((entry) => entry.term)).toContain("Available MA");
  });

  it("resolves payment-brand language to subtype vocabulary", async () => {
    const { expandGlossaryQuery, normalizeGlossaryText } = await loadGlossaryModule();
    const result = expandGlossaryQuery("payment brand");

    expect(result.applied).toBe(true);
    expect(result.matchedEntries.some((entry) => normalizeGlossaryText(entry.term) === "subtype")).toBe(true);
  });
});