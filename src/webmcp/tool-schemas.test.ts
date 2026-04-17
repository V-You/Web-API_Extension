import { describe, expect, it } from "vitest";

import { HANDWRITTEN_TOOL_SCHEMAS, TOOL_SCHEMAS } from "./tool-schemas";

describe("tool schema definitions", () => {
  it("keeps the expected handwritten tool inventory stable", () => {
    expect(HANDWRITTEN_TOOL_SCHEMAS.map((schema) => schema.name)).toEqual([
      "manage_entity",
      "get_hierarchy",
      "manage_contact",
      "manage_merchant_account",
      "lookup_clearing_institutes",
      "describe_settings",
      "manage_settings",
      "get_audit_log",
      "execute_workflow",
      "describe_operation",
    ]);
  });

  it("exposes generated per-action tools alongside handwritten ones", () => {
    const names = TOOL_SCHEMAS.map((schema) => schema.name);
    // Every handwritten tool is included.
    for (const tool of HANDWRITTEN_TOOL_SCHEMAS) expect(names).toContain(tool.name);
    // A handful of spec-derived tools must be published.
    for (const expected of ["create_contact", "attach_merchant_account", "create_division", "edit_entity"]) {
      expect(names).toContain(expected);
    }
  });

  it("defines a non-empty title for each tool", () => {
    for (const schema of TOOL_SCHEMAS) {
      expect(schema.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("marks the handwritten read-only tools explicitly", () => {
    const readOnlyTools = HANDWRITTEN_TOOL_SCHEMAS.filter((schema) => schema.annotations?.readOnlyHint)
      .map((schema) => schema.name)
      .sort();

    expect(readOnlyTools).toEqual([
      "describe_operation",
      "describe_settings",
      "get_audit_log",
      "get_hierarchy",
      "lookup_clearing_institutes",
    ]);
  });

  it("documents the common contact-create payload", () => {
    const manageContact = HANDWRITTEN_TOOL_SCHEMAS.find((schema) => schema.name === "manage_contact");
    const fields = (manageContact?.inputSchema as {
      properties?: { fields?: { description?: string } };
    }).properties?.fields;

    expect(manageContact?.description).toContain("email, name, role, kind, language");
    expect(fields?.description).toContain("Do not invent username, firstName, lastName, or password");
  });

  it("generated tools declare additionalProperties: false", () => {
    const generated = TOOL_SCHEMAS.filter(
      (schema) => !HANDWRITTEN_TOOL_SCHEMAS.some((h) => h.name === schema.name),
    );
    expect(generated.length).toBeGreaterThan(10);
    for (const schema of generated) {
      expect((schema.inputSchema as { additionalProperties?: unknown }).additionalProperties).toBe(false);
    }
  });
});