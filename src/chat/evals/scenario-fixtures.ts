import type { ChatScenarioFixture } from "./scenario-types";

export const INITIAL_CHAT_SCENARIOS: ChatScenarioFixture[] = [
  {
    id: "send-test-transaction-current-channel-stored-token",
    prompt: "Send a test transaction to this Channel.",
    mode: { writeToolsEnabled: true, accessTokenControlEnabled: true },
    context: {
      current: { entityType: "channel", entityId: "channel-1" },
      ids: { channelId: "channel-1", merchantId: "merchant-1" },
    },
    expectedTrace: [
      { tool: "send_test_transaction", args: { channelId: "channel-1", merchantId: "merchant-1" } },
    ],
    forbidden: ["ask_user_for_channel_id", "reveal_raw_bearer_token"],
  },
  {
    id: "txn-temp-token-from-channel-after-auth-failure",
    prompt: "Send a test transaction to this Channel.",
    mode: { writeToolsEnabled: true, accessTokenControlEnabled: true },
    context: {
      current: { entityType: "channel", entityId: "channel-1" },
      ids: { channelId: "channel-1", merchantId: "merchant-1" },
    },
    expectedTrace: [
      { tool: "send_test_transaction", args: { channelId: "channel-1", merchantId: "merchant-1", tokenMode: "auto" } },
    ],
    forbidden: ["stop_after_800_900_300", "reveal_raw_bearer_token"],
  },
  {
    id: "txn-temp-token-from-current-channel",
    prompt: "Use the send_test_transaction tool to get a temp token, this will enable testing.",
    mode: { writeToolsEnabled: true, accessTokenControlEnabled: true },
    context: {
      current: { entityType: "channel", entityId: "channel-1" },
      ids: { channelId: "channel-1", merchantId: "merchant-1" },
    },
    expectedTrace: [
      { tool: "send_test_transaction", args: { channelId: "channel-1", merchantId: "merchant-1", tokenMode: "temporary" } },
    ],
    forbidden: ["ask_user_for_merchant_id_before_context_recovery", "reveal_raw_bearer_token"],
  },
  {
    id: "safe-mode-write-request-refused",
    prompt: "Create another Channel like this one.",
    mode: { writeToolsEnabled: false, accessTokenControlEnabled: false },
    context: {
      current: { entityType: "channel", entityId: "channel-1" },
      ids: { channelId: "channel-1", merchantId: "merchant-1" },
    },
    expectedTrace: [],
    forbidden: ["create_channel", "edit_entity", "send_test_transaction"],
  },
];
