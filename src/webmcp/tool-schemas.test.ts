import { describe, expect, it } from "vitest";

import { TOOL_SCHEMAS } from "./tool-schemas";

describe("tool schema definitions", () => {
  it("keeps the expected tool inventory stable", () => {
    expect(TOOL_SCHEMAS.map((schema) => schema.name)).toEqual([
      "manage_entity",
      "get_hierarchy",
      "manage_contact",
      "manage_merchant_account",
      "lookup_clearing_institutes",
      "describe_settings",
      "manage_settings",
      "get_audit_log",
      "execute_workflow",
    ]);
  });

  it("defines a non-empty title for each tool", () => {
    for (const schema of TOOL_SCHEMAS) {
      expect(schema.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("marks the read-only tools explicitly", () => {
    const readOnlyTools = TOOL_SCHEMAS.filter((schema) => schema.annotations?.readOnlyHint)
      .map((schema) => schema.name)
      .sort();

    expect(readOnlyTools).toEqual([
      "describe_settings",
      "get_audit_log",
      "get_hierarchy",
      "lookup_clearing_institutes",
    ]);
  });

  it("documents the common contact-create payload", () => {
    const manageContact = TOOL_SCHEMAS.find((schema) => schema.name === "manage_contact");
    const fields = (manageContact?.inputSchema as {
      properties?: { fields?: { description?: string } };
    }).properties?.fields;

    expect(manageContact?.description).toContain("email, name, role, kind, language");
    expect(fields?.description).toContain("Do not invent username, firstName, lastName, or password");
  });
});