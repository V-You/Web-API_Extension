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

export const CONFIG_TEST_RECIPE_SCENARIOS: ChatScenarioFixture[] = [
  {
    id: "duplicate-window-10s-current-channel",
    prompt: "Enable duplicate check on this Channel, set it to 10s, and send 3 transactions to test if it works.",
    mode: { writeToolsEnabled: true, accessTokenControlEnabled: true, automationModeEnabled: true },
    context: {
      current: { entityType: "channel", entityId: "channel-1" },
      ids: { channelId: "channel-1", merchantId: "merchant-1" },
    },
    expectedTrace: [],
    expectedRecipes: ["verification-fraud.duplicate-window"],
    forbiddenRecipes: ["verification-fraud.3ds-brand"],
    expectedWorkflowShape: {
      transactionHelper: "sdk.transactions.sendTestBatch",
      count: 3,
      phaseTypes: ["burst", "wait", "burst"],
      constants: ["merchantTransactionId", "amount", "currency", "paymentBrand", "paymentType", "card"],
    },
    forbidden: ["randomize_payment_brand_for_duplicate_test", "omit_testingIntent_result", "declare_verified_when_setup_failed"],
  },
  {
    id: "config-test-negative-list-channels",
    prompt: "list my channels",
    mode: { writeToolsEnabled: false, accessTokenControlEnabled: false, automationModeEnabled: false },
    expectedTrace: [],
    expectedRecipes: [],
    forbiddenRecipes: ["verification-fraud.duplicate-window"],
    forbidden: ["match_config_test_recipe"],
  },
];
