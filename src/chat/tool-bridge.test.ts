import { describe, expect, it } from "vitest";

import { assertChatSafeSchema, CHAT_TOOL_SCHEMAS, getChatToolDeclarations, getChatToolSchemas } from "./tool-bridge";

describe("chat tool bridge", () => {
  it("excludes execute_workflow from the chat-safe catalog", () => {
    expect(CHAT_TOOL_SCHEMAS.map((schema) => schema.name)).not.toContain("execute_workflow");
  });

  it("filters mutating actions out of mixed tool schemas", () => {
    const manageEntity = CHAT_TOOL_SCHEMAS.find((schema) => schema.name === "manage_entity");
    const manageContact = CHAT_TOOL_SCHEMAS.find((schema) => schema.name === "manage_contact");
    const manageMerchantAccount = CHAT_TOOL_SCHEMAS.find((schema) => schema.name === "manage_merchant_account");
    const manageSettings = CHAT_TOOL_SCHEMAS.find((schema) => schema.name === "manage_settings");

    expect((manageEntity?.inputSchema as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum).toEqual([
      "get",
      "search",
      "list_children",
    ]);
    expect((manageContact?.inputSchema as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum).toEqual([
      "get",
      "list",
      "find_by_username",
    ]);
    expect((manageMerchantAccount?.inputSchema as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum).toEqual([
      "get",
      "list",
    ]);
    expect((manageSettings?.inputSchema as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum).toEqual([
      "get",
      "batch_get",
      "list_non_default",
    ]);
  });

  it("removes write-only dynamic object parameters from the Gemini-facing schema", () => {
    const manageEntity = CHAT_TOOL_SCHEMAS.find((schema) => schema.name === "manage_entity");
    const manageContact = CHAT_TOOL_SCHEMAS.find((schema) => schema.name === "manage_contact");
    const manageMerchantAccount = CHAT_TOOL_SCHEMAS.find((schema) => schema.name === "manage_merchant_account");
    const manageSettings = CHAT_TOOL_SCHEMAS.find((schema) => schema.name === "manage_settings");

    const manageEntityProperties = (manageEntity?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const manageContactProperties = (manageContact?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const manageMerchantAccountProperties = (manageMerchantAccount?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const manageSettingsProperties = (manageSettings?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};

    expect(manageEntityProperties.fields).toBeUndefined();
    expect(manageContactProperties.fields).toBeUndefined();
    expect(manageMerchantAccountProperties.fields).toBeUndefined();
    expect(manageSettingsProperties.settings).toBeUndefined();
    expect(manageSettingsProperties.value).toBeUndefined();
    expect(manageSettingsProperties.query).toBeDefined();
  });

  it("expands the catalog when write tools are enabled", () => {
    const writeSchemas = getChatToolSchemas({ writeToolsEnabled: true });
    const manageEntity = writeSchemas.find((schema) => schema.name === "manage_entity");
    const manageContact = writeSchemas.find((schema) => schema.name === "manage_contact");
    const manageMerchantAccount = writeSchemas.find((schema) => schema.name === "manage_merchant_account");
    const manageSettings = writeSchemas.find((schema) => schema.name === "manage_settings");

    expect((manageEntity?.inputSchema as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum).toContain("delete");
    expect((manageContact?.inputSchema as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum).toContain("reset_password");
    expect((manageMerchantAccount?.inputSchema as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum).toContain("attach");
    expect((manageSettings?.inputSchema as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum).toContain("set");

    const manageEntityProperties = (manageEntity?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const manageContactProperties = (manageContact?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const manageMerchantAccountProperties = (manageMerchantAccount?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const manageSettingsProperties = (manageSettings?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};

    expect(manageEntityProperties.fields).toBeDefined();
    expect(manageContactProperties.fields).toBeDefined();
    expect(manageMerchantAccountProperties.fields).toBeDefined();
    expect(manageSettingsProperties.settings).toBeDefined();
    expect(manageSettingsProperties.value).toBeDefined();
  });

  it("exposes Gemini-ready tool declarations", () => {
    const declarations = getChatToolDeclarations();
    const describeSettings = declarations.find((tool) => tool.name === "describe_settings");

    expect(describeSettings).toBeDefined();
    expect(describeSettings?.parameters).toBeTruthy();
  });

  it("does not emit unsupported additionalProperties in serialized declarations", () => {
    expect(JSON.stringify(getChatToolDeclarations())).not.toContain("additionalProperties");
  });

  it("still excludes execute_workflow even when write tools are enabled", () => {
    expect(getChatToolSchemas({ writeToolsEnabled: true }).map((schema) => schema.name)).not.toContain("execute_workflow");
  });

  // Phase 3 / D11 – Gemini-safe chat declarations.
  describe("Gemini-safe chat declarations (D11/D12)", () => {
    it("preserves explicit write field names on generated tools when write is enabled", () => {
      const schemas = getChatToolSchemas({ writeToolsEnabled: true });
      const propsOf = (name: string) =>
        (schemas.find((s) => s.name === name)?.inputSchema as {
          properties?: Record<string, unknown>;
        }).properties ?? {};

      // create_contact – spec request fields survive.
      const createContact = propsOf("create_contact");
      for (const field of ["email", "name", "role", "kind", "language", "mobile"]) {
        expect(createContact[field], `create_contact.${field}`).toBeDefined();
      }

      // attach_merchant_account – BIN/descriptor fields survive.
      const attachMa = propsOf("attach_merchant_account");
      for (const field of ["merchantAccountId", "subTypes", "currency", "binRangeLimit"]) {
        expect(attachMa[field], `attach_merchant_account.${field}`).toBeDefined();
      }

      // create_merchant_account – spec request fields survive.
      const createMa = propsOf("create_merchant_account");
      expect(Object.keys(createMa).length, "create_merchant_account has fields").toBeGreaterThan(2);

      // create_division – spec request fields survive.
      const createDivision = propsOf("create_division");
      expect(createDivision.name, "create_division.name").toBeDefined();
    });

    it("forbids JSON-Schema constructs outside the D11 subset in the full declaration set", () => {
      const writeDecls = JSON.stringify(getChatToolDeclarations({ writeToolsEnabled: true }));
      for (const forbidden of ["additionalProperties", "oneOf", "allOf", "anyOf", "$ref", "\"not\":", "\"example\"", "\"examples\""]) {
        expect(writeDecls, `forbidden ${forbidden}`).not.toContain(forbidden);
      }
    });

    it("assertChatSafeSchema throws on forbidden constructs", () => {
      expect(() => assertChatSafeSchema({ type: "object", additionalProperties: false })).toThrow(/additionalProperties/);
      expect(() => assertChatSafeSchema({ oneOf: [{ type: "string" }] })).toThrow(/oneOf/);
      expect(() => assertChatSafeSchema({ type: "string", minimum: 1 })).toThrow(/minimum/);
    });

    it("assertChatSafeSchema accepts a fully-compliant subset schema", () => {
      expect(() => assertChatSafeSchema({
        type: "object",
        properties: {
          name: { type: "string", description: "A name.", pattern: "^[a-z]+$" },
          kind: { type: "string", enum: ["A", "B"] },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["name"],
      })).not.toThrow();
    });

    it("emits a stable Gemini-facing declaration inventory", () => {
      const names = getChatToolDeclarations({ writeToolsEnabled: true })
        .map((d) => d.name)
        .sort();
      expect(names).toMatchInlineSnapshot(`
        [
          "attach_merchant_account",
          "create_channel",
          "create_contact",
          "create_division",
          "create_merchant",
          "create_merchant_account",
          "delete_contact",
          "delete_entity",
          "delete_merchant_account",
          "describe_operation",
          "describe_settings",
          "detach_contact",
          "detach_merchant_account",
          "edit_contact",
          "edit_entity",
          "edit_merchant_account",
          "get_audit_log",
          "get_contact",
          "get_entity",
          "get_hierarchy",
          "get_merchant_account",
          "list_attached_contacts",
          "list_attached_merchant_accounts",
          "list_channels",
          "list_divisions",
          "list_merchants",
          "list_owned_contacts",
          "list_owned_merchant_accounts",
          "lock_contact",
          "lookup_clearing_institutes",
          "manage_contact",
          "manage_entity",
          "manage_merchant_account",
          "manage_settings",
          "set_contact_password",
          "unlock_contact",
        ]
      `);
    });
  });
});