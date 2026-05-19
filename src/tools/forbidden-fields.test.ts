import { describe, expect, it } from "vitest";
import { assertNoForbiddenFields, findForbiddenFields } from "./forbidden-fields";

describe("forbidden-fields deny list (PRD 2026-05-18 Phase 0)", () => {
  it("flags every forbidden key on create_merchant_account", () => {
    const hits = findForbiddenFields("create_merchant_account", {
      paymentBrand: "VISA",
      paymentBrands: ["VISA"],
      brands: ["MASTER"],
      config: { foo: 1 },
      // legitimate fields should not be flagged
      type: "VISA",
      currency: "EUR",
    });
    const fields = hits.map((h) => h.field).sort();
    expect(fields).toEqual(["brands", "config", "paymentBrand", "paymentBrands"]);
    for (const hit of hits) {
      expect(typeof hit.reason).toBe("string");
      expect(hit.reason.length).toBeGreaterThan(0);
    }
  });

  it("returns no hits when only allowed fields are present", () => {
    expect(findForbiddenFields("create_merchant_account", { type: "VISA", currency: "EUR" })).toEqual([]);
  });

  it("ignores tools that have no deny list", () => {
    expect(findForbiddenFields("list_channels", { paymentBrand: "VISA" })).toEqual([]);
  });

  it("assertNoForbiddenFields throws a structured message", () => {
    expect(() => assertNoForbiddenFields("create_merchant_account", { paymentBrand: "VISA" }))
      .toThrowError(/create_merchant_account received forbidden field\(s\): paymentBrand:/);
  });

  it("assertNoForbiddenFields is a no-op when nothing is forbidden", () => {
    expect(() => assertNoForbiddenFields("create_merchant_account", { type: "VISA" })).not.toThrow();
  });
});
