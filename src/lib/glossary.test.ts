import { describe, expect, it } from "vitest";

import { expandGlossaryQuery } from "./glossary";

describe("glossary expansion", () => {
  it("resolves attached merchant account phrasing", () => {
    const result = expandGlossaryQuery("attached merchant account");

    expect(result.applied).toBe(true);
    expect(result.matchedEntries.map((entry) => entry.term)).toContain("Attached MA");
  });

  it("resolves owned merchant account phrasing", () => {
    const result = expandGlossaryQuery("owned merchant account");

    expect(result.applied).toBe(true);
    expect(result.matchedEntries.map((entry) => entry.term)).toContain("Available MA");
  });

  it("resolves payment-brand language to subtype vocabulary", () => {
    const result = expandGlossaryQuery("payment brand");

    expect(result.applied).toBe(true);
    expect(result.matchedEntries.map((entry) => entry.term)).toContain("Subtype");
  });
});