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
});