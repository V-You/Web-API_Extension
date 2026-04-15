import { describe, expect, it } from "vitest";

import { CHAT_TOOL_SCHEMAS, getChatToolDeclarations } from "./tool-bridge";

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
});