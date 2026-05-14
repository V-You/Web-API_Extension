import { describe, expect, it } from "vitest";

import {
  matchConfigTestRecipes,
  renderConfigTestRecipePrompt,
  validateConfigTestRecipes,
} from "./config-test-recipes";

const ACTIVE_KEY = "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:active";
const TIMEFRAME_KEY = "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:timeframe";

describe("config test recipes", () => {
  it("validates the bundled recipe dataset", () => {
    expect(validateConfigTestRecipes()).toEqual([]);
  });

  it("matches duplicate-window testing intent from prompt and setting keys", () => {
    const matches = matchConfigTestRecipes({
      prompt: "Enable duplicate check on this Channel, set it to 10s, and send 3 transactions to test if it works.",
      env: "uat",
      settingKeys: [ACTIVE_KEY, TIMEFRAME_KEY],
      knownIds: { channelId: "channel-1", merchantId: "merchant-1" },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].recipe.id).toBe("verification-fraud.duplicate-window");
    expect(matches[0].matchedSignals).toEqual(expect.arrayContaining([`setting:${ACTIVE_KEY}`, "family:db.db"]));
  });

  it("renders compact prompt guidance for a matched recipe", () => {
    const matches = matchConfigTestRecipes({
      prompt: "Set db.db to 10 seconds and send three transactions to verify duplicate handling.",
      env: "uat",
    });

    const rendered = renderConfigTestRecipePrompt(matches);

    expect(rendered).toContain("Transaction testing intent detected: duplicate window verification.");
    expect(rendered).toContain("Use recipe verification-fraud.duplicate-window v1.");
    expect(rendered).toContain("send 2 transaction(s) immediately");
    expect(rendered).toContain("requires live calibration");
    expect(rendered).toContain("testingIntent");
  });

  it("does not match read-only explanation prompts", () => {
    expect(matchConfigTestRecipes({ prompt: "How does duplicate check work?", env: "uat" })).toEqual([]);
  });

  it("does not match unrelated prompts", () => {
    expect(matchConfigTestRecipes({ prompt: "list my channels", env: "uat" })).toEqual([]);
  });

  it("does not let a fake recipe id create a match", () => {
    expect(matchConfigTestRecipes({ prompt: "Use recipe verification-fraud-bypass", env: "uat" })).toEqual([]);
  });
});
