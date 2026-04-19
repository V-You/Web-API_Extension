import { describe, expect, it } from "vitest";

import { summarizeToolResources } from "./tool-provenance";

describe("tool provenance", () => {
  it("surfaces glossary-backed describe_settings lookups", () => {
    const resources = summarizeToolResources([
      {
        name: "describe_settings",
        result: {
          glossary: { applied: true },
          familyResolution: { applied: false },
        },
      },
    ]);

    expect(resources).toEqual(["RiRo settings index", "Glossary"]);
  });

  it("deduplicates resources across multiple tool calls", () => {
    const resources = summarizeToolResources([
      { name: "manage_contact", result: {} },
      { name: "manage_entity", result: {} },
      { name: "manage_contact", result: {} },
    ]);

    expect(resources).toEqual(["Contacts API", "Hierarchy API"]);
  });
});