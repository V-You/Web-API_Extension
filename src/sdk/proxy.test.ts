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

  // PRD 2026-05-18 Phase 1 / D1: type coercion remains in this proxy; these
  // tests document the supported coercions so consumers can rely on them.
  describe("string-form coercion at the RiRo boundary", () => {
    const ACTIVE = "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:active";
    const TIMEFRAME = "*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:timeframe";

    it("accepts boolean-y strings (true/1/yes, false/0/no) and serializes to API form", () => {
      const truthy = flattenSettings({ [ACTIVE]: "yes" });
      expect(truthy.ok).toBe(true);
      expect(truthy.settings[0]?.value).toBe("true");

      const falsy = flattenSettings({ [ACTIVE]: "no" });
      expect(falsy.ok).toBe(true);
      expect(falsy.settings[0]?.value).toBe("false");
    });

    it("accepts numeric strings and serializes them as-is", () => {
      const result = flattenSettings({ [TIMEFRAME]: "42" });
      expect(result.ok).toBe(true);
      expect(result.settings[0]?.value).toBe("42");
    });
  });
});
