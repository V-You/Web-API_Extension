import { describe, expect, it } from "vitest";

import { buildChatSystemPrompt, CHAT_DISCOVERY_PROMPT_CHIPS, getDiscoveryPlaybookPurpose } from "./discovery-playbook";

describe("chat discovery playbook", () => {
  it("builds a system prompt that includes the discovery playbook guidance", () => {
    const prompt = buildChatSystemPrompt();

    expect(prompt).toContain("The underlying LLM currently configured for this chat is Gemini.");
    expect(prompt).toContain("Do not describe safe mode or write mode as your model name or version");
    expect(prompt).toContain("This chat runs in safe mode.");
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
    expect(prompt).toContain("Never attempt writes or code execution.");
  });

  it("builds a write-enabled prompt variant", () => {
    const prompt = buildChatSystemPrompt({ writeToolsEnabled: true });

    expect(prompt).toContain("Write tools are enabled for this browser session.");
    expect(prompt).toContain("Every mutating tool call still goes through the existing preview-confirm flow before execution.");
    expect(prompt).toContain("Prefer read tools first when you need to inspect current state before writing.");
    expect(prompt).not.toContain("This chat runs in safe mode.");
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