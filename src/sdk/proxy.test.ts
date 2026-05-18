import { describe, expect, it } from "vitest";

import { flattenSettings } from "./proxy";

describe("settings proxy", () => {
  it("accepts known flat RiRo keys", () => {
    const result = flattenSettings({
      "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:active": true,
      "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:timeframe": 10,
    });

    expect(result).toMatchObject({ ok: true, errors: [] });
    expect(result.settings).toEqual([
      expect.objectContaining({
        flatKey: "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:active",
        value: "true",
      }),
      expect.objectContaining({
        flatKey: "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:timeframe",
        value: "10",
      }),
    ]);
  });

  it("coerces string primitives for known typed flat RiRo keys", () => {
    const result = flattenSettings({
      "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:active": "true",
      "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:timeframe": "10",
    });

    expect(result).toMatchObject({ ok: true, errors: [] });
    expect(result.settings).toEqual([
      expect.objectContaining({
        flatKey: "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:active",
        value: "true",
      }),
      expect.objectContaining({
        flatKey: "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:timeframe",
        value: "10",
      }),
    ]);
  });

  it("rejects hallucinated setting paths", () => {
    const result = flattenSettings({ "ib.dupeCheck.active": "true" });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["Unknown setting path: ib.dupeCheck.active"]);
  });
});
