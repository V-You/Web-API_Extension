import { describe, expect, it } from "vitest";

import { buildChatSystemPrompt, buildChatWorkflowDraftPrompt, CHAT_DISCOVERY_PROMPT_CHIPS, getDiscoveryPlaybookPurpose } from "./discovery-playbook";
import { matchConfigTestRecipes } from "./config-test-recipes";

describe("chat discovery playbook", () => {
  it("builds a system prompt that includes the discovery playbook guidance", () => {
    const prompt = buildChatSystemPrompt();

    expect(prompt).toContain("The underlying LLM currently configured for this chat is Gemini.");
    expect(prompt).toContain("Do not describe safe mode or write mode as your model name or version");
    expect(prompt).toContain("This chat runs in safe mode.");
    expect(prompt).toContain("Automation mode is disabled.");
    expect(prompt).toContain("When current BIP section context is available, use it to disambiguate scope-sensitive questions such as attached vs owned merchant accounts or contacts.");
    expect(prompt).toContain("Resolve cheap read-only ambiguity by checking the two most likely interpretations before asking the user to clarify.");
    expect(prompt).toContain("Discovery playbook:");
    expect(prompt).toContain("UI label or business phrase:");
    expect(prompt).toContain("Create another one like this:");
    expect(prompt).toContain("Payment brand or processing capability question:");
    expect(prompt).toContain("Subjective or comparative question:");
    expect(prompt).toContain("Risk or fraud configuration question:");
    expect(prompt).toContain("3DS or SCA question:");
    expect(prompt).toContain("Merchant-account troubleshooting:");
    expect(prompt).toContain("Test transaction authentication failure or missing merchantId:");
    expect(prompt).toContain("The dashboard binds context, but the Web API is authoritative.");
    expect(prompt).toContain("channel accessToken");
    expect(prompt).toContain("absent from that specific endpoint response");
    expect(prompt).toContain("Merchant-level-and-below secrets, not Channel-level tokens");
    expect(prompt).toContain("Raw bearer tokens must never appear in LLM context");
    expect(prompt).toContain("800.900.300");
    expect(prompt).toContain("Retry with send_test_transaction tokenMode=temporary");
    expect(prompt).toContain("derive it before asking the user");
    expect(prompt).toContain("Generate Api Bearer token");
    expect(prompt).toContain("Never attempt writes or code execution.");
  });

  it("builds a write-enabled prompt variant", () => {
    const prompt = buildChatSystemPrompt({ writeToolsEnabled: true });

    expect(prompt).toContain("Write tools are enabled for this browser session.");
    expect(prompt).toContain("Automation mode is disabled.");
    expect(prompt).toContain("Every mutating tool call still goes through the existing preview-confirm flow before execution.");
    expect(prompt).toContain("Prefer read tools first when you need to inspect current state before writing.");
    expect(prompt).not.toContain("This chat runs in safe mode.");
  });

  it("builds an accessToken-control prompt variant", () => {
    const prompt = buildChatSystemPrompt({ writeToolsEnabled: true, accessTokenControlEnabled: true });

    expect(prompt).toContain("accessToken control is enabled for this browser session.");
    expect(prompt).toContain("API token lifecycle tools are available.");
    expect(prompt).toContain("Never reveal raw bearer tokens");
  });

  it("builds an automation-enabled prompt variant", () => {
    const prompt = buildChatSystemPrompt({ writeToolsEnabled: true, automationModeEnabled: true, draftJobTurn: true });

    expect(prompt).toContain("Automation workflow tools are enabled for this browser session.");
    expect(prompt).toContain("Automation mode is enabled for this browser session.");
    expect(prompt).toContain("Use execute_workflow for repeated writes and backend batch work instead of calling write tools one by one.");
    expect(prompt).toContain("Workflow scripts receive context.entityId, context.entityType, and when available context.ids");
    expect(prompt).toContain("prefer one execute_workflow Job over a long chain of individual tool calls");
    expect(prompt).toContain("This is a Draft Job turn.");
    expect(prompt).not.toContain("Automation mode is disabled.");
  });

  it("builds a workflow draft prompt with snapshot context", () => {
    const prompt = buildChatWorkflowDraftPrompt({
      userRequest: "Audit dupe check",
      env: "uat",
      entityType: "merchant",
      entityId: "m1",
      entityName: "Demo merchant",
      section: "risk",
      knownIds: { merchantId: "m1", channelId: "c1" },
    });

    expect(prompt).toContain("Environment snapshot: uat.");
    expect(prompt).toContain("Target context: merchant m1.");
    expect(prompt).toContain("Entity name: Demo merchant.");
    expect(prompt).toContain("Known context IDs available in the script as context.ids: merchantId=m1, channelId=c1.");
    expect(prompt).toContain("Use context.ids.channelId and context.ids.merchantId when present");
    expect(prompt).toContain("Do not use import, export, require, fetch");
    expect(prompt).toContain("sdk.settings.edit(entityType, entityId, settings)");
    expect(prompt).toContain("sdk.config.update(entityType, entityId, settings)");
    expect(prompt).toContain("sdk.merchantAccounts.create(parentType, parentId, fields)");
    expect(prompt).toContain("include name, state, merchantId, and either clearingInstituteId or clearingInstituteName");
    expect(prompt).toContain("clearingInstituteId must be a 32-character API UUID");
    expect(prompt).toContain("Do not use mid, identification, paymentBrand, paymentBrands, brands, or config fields");
    expect(prompt).toContain("Use clearingInstituteId: processor.id only when id is a 32-character API UUID");
    expect(prompt).toContain("sdk.merchantAccounts.update(merchantAccountId, fields)");
    expect(prompt).toContain("use state: \"LIVE\" rather than status: \"ACTIVE\"");
    expect(prompt).toContain("sdk.cardProcessors.list(context.ids?.pspId)");
    expect(prompt).toContain("PSP ID is optional");
    expect(prompt).toContain("sdk.cardProcessors.list returns an array");
    expect(prompt).toContain("context.id/context.type");
    expect(prompt).toContain("sdk.transactions.sendTest");
    expect(prompt).toContain("merchantId is optional when the current context is a Channel");
    expect(prompt).toContain("Do not throw your own error for a missing parent Merchant");
    expect(prompt).toContain("Prefer transaction.status for summaries");
    expect(prompt).toContain("If transaction testing recipe context is present above");
    expect(prompt).toContain("Return only valid JSON");
    expect(prompt).toContain("The response must parse with JSON.parse");
    expect(prompt).toContain("Do not use sdk.management or sdk.manage_entity namespaces.");
    expect(prompt).toContain("The BIP glossary maps users to contacts.");
    expect(prompt).toContain("Create contacts with sdk.contacts.create(entityType, entityId, fields).");
    expect(prompt).toContain("sdk.contacts.list(entityType, entityId, \"owned\")");
    expect(prompt).toContain("These calls return arrays");
    expect(prompt).toContain("sdk.contacts.attach(entityType, entityId, contactId)");
    expect(prompt).toContain("Do not climb to the parent entity unless the user explicitly asks");
    expect(prompt).toContain("totalCalls must include the two list calls");
    expect(prompt).toContain("role: \"OPERATOR\", kind: \"SEND\", and language: \"en\"");
  });

  it("injects matched transaction-test recipes into workflow draft prompts", () => {
    const configTestRecipes = matchConfigTestRecipes({
      prompt: "Set duplicate check to 10s and send 3 transactions to test it.",
      env: "uat",
      knownIds: { channelId: "c1", merchantId: "m1" },
    });

    const prompt = buildChatWorkflowDraftPrompt({
      userRequest: "Set duplicate check to 10s and send 3 transactions to test it.",
      env: "uat",
      entityType: "channel",
      entityId: "c1",
      knownIds: { channelId: "c1", merchantId: "m1" },
      configTestRecipes,
    });

    expect(prompt).toContain("Transaction testing recipe context:");
    expect(prompt).toContain("Use recipe verification-fraud.duplicate-window v1.");
    expect(prompt).toContain("Push a final results entry with testingIntent");
  });

  it("includes the configured model name for meta questions", () => {
    const prompt = buildChatSystemPrompt({ modelName: "gemini-2.5-flash" });

    expect(prompt).toContain("The underlying LLM currently configured for this chat is gemini-2.5-flash.");
    expect(prompt).toContain("If the user asks about your model, model name, or version, answer with the configured Gemini model identifier directly.");
  });

  it("exposes the curated prompt chips and purpose text", () => {
    expect(CHAT_DISCOVERY_PROMPT_CHIPS).toContain("List all Plausibility Checks for this entity.");
    expect(CHAT_DISCOVERY_PROMPT_CHIPS).toContain("How is 3DS configured here?");
    expect(getDiscoveryPlaybookPurpose()).toContain("read-only exploration");
  });
});