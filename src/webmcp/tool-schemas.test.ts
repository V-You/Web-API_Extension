import { describe, expect, it } from "vitest";

import { HANDWRITTEN_TOOL_SCHEMAS, TOOL_SCHEMAS } from "./tool-schemas";

describe("tool schema definitions", () => {
  it("keeps the expected handwritten tool inventory stable", () => {
    expect(HANDWRITTEN_TOOL_SCHEMAS.map((schema) => schema.name)).toEqual([
      "manage_entity",
      "get_hierarchy",
      "manage_contact",
      "attach_contact",
      "manage_merchant_account",
      "lookup_clearing_institutes",
      "describe_settings",
      "manage_settings",
      "get_audit_log",
      "execute_workflow",
      "get_job_status",
      "describe_operation",
      "list_api_tokens",
      "get_api_token",
      "create_api_token",
      "update_api_token",
      "suspend_api_token",
      "activate_api_token",
      "delete_api_token",
    ]);
  });

  it("exposes generated per-action tools alongside handwritten ones", () => {
    const names = TOOL_SCHEMAS.map((schema) => schema.name);
    // Every handwritten tool is included.
    for (const tool of HANDWRITTEN_TOOL_SCHEMAS) expect(names).toContain(tool.name);
    // A handful of spec-derived tools must be published.
    for (const expected of ["create_contact", "attach_contact", "attach_merchant_account", "create_division", "edit_entity"]) {
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
      "get_api_token",
      "get_audit_log",
      "get_hierarchy",
      "get_job_status",
      "list_api_tokens",
      "lookup_clearing_institutes",
      "manage_contact",
      "manage_entity",
      "manage_merchant_account",
    ]);
  });

  it("handwritten umbrella tools only expose read actions (Part-II P2-D1)", () => {
    const readActions: Record<string, string[]> = {
      manage_entity: ["get", "search", "list_children"],
      manage_contact: ["get", "list", "find_by_username"],
      manage_merchant_account: ["get", "list"],
    };
    for (const [toolName, expectedActions] of Object.entries(readActions)) {
      const tool = HANDWRITTEN_TOOL_SCHEMAS.find((schema) => schema.name === toolName);
      const schema = tool?.inputSchema as {
        properties?: Record<string, { enum?: string[] }>;
      };
      expect(schema.properties?.action?.enum, `${toolName} actions`).toEqual(expectedActions);
      expect(schema.properties?.fields, `${toolName} fields bag is gone`).toBeUndefined();
    }
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

  it("documents execute_workflow as an asynchronous Job handoff", () => {
    const workflow = TOOL_SCHEMAS.find((schema) => schema.name === "execute_workflow");
    expect(workflow?.description).toContain("returns a Job receipt immediately");
    expect((workflow?.inputSchema as { properties?: Record<string, unknown> }).properties).toHaveProperty("totalCalls");
  });

  it("documents channel entity get as the Web API channelInfo payload", () => {
    const manageEntity = TOOL_SCHEMAS.find((schema) => schema.name === "manage_entity");
    expect(manageEntity?.description).toContain("channelInfo");
    expect(manageEntity?.description).toContain("accessToken");
    expect(manageEntity?.description).toContain("live responses may omit");
  });

  it("exposes get_job_status as a read-only polling tool", () => {
    const status = TOOL_SCHEMAS.find((schema) => schema.name === "get_job_status");
    expect(status?.annotations?.readOnlyHint).toBe(true);
    expect((status?.inputSchema as { required?: string[] }).required).toEqual(["jobId"]);
  });

  it("documents attach_contact as the supported existing-contact attach endpoint", () => {
    const attachContact = TOOL_SCHEMAS.find((schema) => schema.name === "attach_contact");
    expect(attachContact?.annotations?.readOnlyHint).toBeUndefined();
    expect(attachContact?.description).toContain("attachedContacts/{contactId}");
    expect((attachContact?.inputSchema as { required?: string[] }).required).toEqual(["entityId", "entityType", "contactId"]);
  });
});