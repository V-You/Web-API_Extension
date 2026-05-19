import type { ChatScenarioFixture, WorkflowPreflightScenario } from "./scenario-types";

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

/**
 * PRD 2026-05-18 Phase 5 workflow preflight regression scenarios.
 *
 * Each fixture captures a previously-failing prompt, the kind of draft
 * the model might produce, and the expected static-preflight outcome.
 * The companion test in `workflow-preflight-scenarios.test.ts` replays
 * each script through `staticWorkflowPreflight` and asserts the result.
 *
 * New scenarios should be added before or alongside any contract fix so
 * regressions are caught at gate time.
 */
export const WORKFLOW_PREFLIGHT_SCENARIOS: WorkflowPreflightScenario[] = [
  {
    id: "ma-barclays-attach-visa-eur-dupe-check-send",
    prompt:
      "Create a Merchant Account for Barclays on this channel, attach VISA/EUR, enable duplicate check at 10s, then send 3 test transactions.",
    workflowScript: `
      const processors = await sdk.cardProcessors.list(context.ids?.pspId);
      const barclays = processors.find((p) => /barclays/i.test(p.name) || /barclays/i.test(p.ciCode));
      if (!barclays) throw new Error("Barclays CI not found");
      const ma = await sdk.merchantAccounts.create("channel", context.entityId, {
        name: "Barclays MID",
        state: "LIVE",
        merchantId: "BCLY-001",
        clearingInstituteId: barclays.id,
      });
      const merchantAccountId = ma.id || ma.merchantAccountId;
      if (!merchantAccountId) throw new Error("missing merchantAccountId");
      await sdk.merchantAccounts.attach(context.entityType, context.entityId, merchantAccountId, "VISA", "EUR");
      await sdk.settings.edit("channel", context.entityId, {
        "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:active": true,
        "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:timeframe": 10,
      });
      await sdk.transactions.sendTestBatch({ channelId: context.entityId, count: 3, tokenMode: "temporary" });
    `,
    expectedPreflight: "ok",
    note: "Happy path: dynamic clearingInstituteId, native typed settings, positional MA attach all OK.",
  },
  {
    id: "ma-five-acceptance-mids-different-currencies",
    prompt: "Create five Acceptance MIDs and attach each to a different currency.",
    workflowScript: `
      const currencies = ["EUR", "USD", "GBP", "CHF", "SEK"];
      for (const currency of currencies) {
        const ma = await sdk.merchantAccounts.create("channel", context.entityId, {
          name: \`Acceptance \${currency}\`,
          state: "LIVE",
          merchantId: \`ACC-\${currency}\`,
          clearingInstituteName: "ACCEPTANCE",
        });
        const merchantAccountId = ma.id || ma.merchantAccountId;
        await sdk.merchantAccounts.attach(context.entityType, context.entityId, merchantAccountId, "VISA", currency);
      }
    `,
    expectedPreflight: "ok",
    note: "clearingInstituteName accepted when ID UUID not known; one attach per currency.",
  },
  {
    id: "ci-lookup-barclays-readonly",
    prompt: "What is the live Clearing Institute ID and name for Barclays on this PSP?",
    workflowScript: `
      const processors = await sdk.cardProcessors.list(context.ids?.pspId);
      const matches = processors
        .filter((p) => /barclays/i.test(p.name) || /barclays/i.test(p.ciCode))
        .map((p) => ({ id: p.id, name: p.name, ciCode: p.ciCode }));
      results.push({ kind: "ci-lookup", barclays: matches });
    `,
    expectedPreflight: "ok",
    forbiddenTools: ["create_merchant_account", "edit_merchant_account"],
    note: "Read-only CI lookup must not invoke any write.",
  },
  {
    id: "dupe-check-stringified-settings-blocked",
    prompt: "Turn on duplicate check on this channel with a 10 second window.",
    workflowScript: `
      await sdk.settings.edit("channel", context.entityId, {
        "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:active": "true",
        "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:timeframe": "10",
      });
    `,
    expectedPreflight: "blocked",
    expectedMessageIncludes: ["doublication:active", "doublication:timeframe"],
    note: "Stringified boolean/number on RiRo doublication keys must be rejected before write.",
  },
  {
    id: "ma-attach-missing-currency-blocked",
    prompt: "Attach merchant account ma1 to this channel.",
    workflowScript: `
      await sdk.merchantAccounts.attach("channel", context.entityId, "ma1", "VISA", "");
    `,
    expectedPreflight: "blocked",
    expectedMessageIncludes: ["currency"],
    note: "Positional attach with empty currency must be rejected.",
  },
  {
    id: "ma-create-non-uuid-ci-id-blocked",
    prompt: "Create a Merchant Account on Acceptance for this channel.",
    workflowScript: `
      const ma = await sdk.merchantAccounts.create("channel", context.entityId, {
        name: "Acceptance MID",
        state: "LIVE",
        merchantId: "ACC-1",
        clearingInstituteId: "ACCEPTANCE",
      });
    `,
    expectedPreflight: "blocked",
    expectedMessageIncludes: ["clearingInstituteId", "UUID"],
    note: "CI code/label passed as clearingInstituteId literal must be rejected (use clearingInstituteName).",
  },
  {
    id: "uncalled-runworkflow-wrapper",
    prompt: "Create a Channel and a Merchant Account on it.",
    workflowScript: `
      async function runWorkflow() {
        await sdk.merchantAccounts.create("channel", context.entityId, {
          name: "MID", state: "LIVE", merchantId: "M1", clearingInstituteName: "ACCEPTANCE",
        });
      }
      // bug: runWorkflow defined but never invoked - no work happens
    `,
    expectedPreflight: "ok",
    note:
      "Preflight does not block the wrapper-without-invoke shape on its own; the draft prompt forbids it and Phase 5 fixture documents it so future analyzers can detect the empty top-level body. The Job would complete with zero results, surfaced as state failed by computeJobOutcome.",
  },
];
