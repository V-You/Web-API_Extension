import { describe, expect, it } from "vitest";

import { INITIAL_CHAT_SCENARIOS } from "./scenario-fixtures";
import { validateScenarioTrace, type ChatScenarioFixture } from "./scenario-types";

describe("chat scenario eval helpers", () => {
  it("validates expected tool traces", () => {
    const fixture: ChatScenarioFixture = {
      id: "txn-temp-token-from-channel",
      prompt: "Use a temp token",
      mode: { writeToolsEnabled: true, accessTokenControlEnabled: true },
      expectedTrace: [
        { tool: "send_test_transaction", args: { channelId: "channel-1", merchantId: "merchant-1", tokenMode: "temporary" } },
      ],
      forbidden: ["reveal_raw_bearer_token"],
    };

    expect(validateScenarioTrace(fixture, [
      { tool: "send_test_transaction", args: { channelId: "channel-1", merchantId: "merchant-1", tokenMode: "temporary" } },
    ])).toEqual({ ok: true, errors: [] });

    expect(validateScenarioTrace(fixture, [
      { tool: "send_test_transaction", args: { channelId: "channel-1", tokenMode: "temporary" } },
    ]).errors).toContain("Tool call 0 arg merchantId: expected merchant-1, got undefined");
  });

  it("ships an initial scenario seed for known routing failures", () => {
    expect(INITIAL_CHAT_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "send-test-transaction-current-channel-stored-token",
      "txn-temp-token-from-channel-after-auth-failure",
      "txn-temp-token-from-current-channel",
      "safe-mode-write-request-refused",
    ]);

    for (const scenario of INITIAL_CHAT_SCENARIOS) {
      expect(scenario.prompt).toBeTruthy();
      expect(scenario.forbidden?.length).toBeGreaterThan(0);
    }
  });
});
