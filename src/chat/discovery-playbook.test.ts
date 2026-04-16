import { describe, expect, it } from "vitest";

import { buildChatSystemPrompt, CHAT_DISCOVERY_PROMPT_CHIPS, getDiscoveryPlaybookPurpose } from "./discovery-playbook";

describe("chat discovery playbook", () => {
  it("builds a system prompt that includes the discovery playbook guidance", () => {
    const prompt = buildChatSystemPrompt();

    expect(prompt).toContain("This chat runs in safe mode.");
    expect(prompt).toContain("Discovery playbook:");
    expect(prompt).toContain("UI label or business phrase:");
    expect(prompt).toContain("Subjective or comparative question:");
    expect(prompt).toContain("Never attempt writes or code execution.");
  });

  it("exposes the curated prompt chips and purpose text", () => {
    expect(CHAT_DISCOVERY_PROMPT_CHIPS).toContain("List all Plausibility Checks for this entity.");
    expect(getDiscoveryPlaybookPurpose()).toContain("read-only exploration");
  });
});