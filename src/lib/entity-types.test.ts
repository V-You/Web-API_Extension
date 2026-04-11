import { describe, expect, it } from "vitest";

import { CREATABLE, ENTITY_PLURAL, entityPath, extractParentInfo } from "./entity-types";

describe("entity type helpers", () => {
  it("builds entity paths from the plural map", () => {
    expect(entityPath("psp", "p1")).toBe("/psps/p1");
    expect(entityPath("division", "d1")).toBe("/divisions/d1");
    expect(entityPath("merchant", "m1")).toBe("/merchants/m1");
    expect(entityPath("channel", "c1")).toBe("/channels/c1");
    expect(ENTITY_PLURAL.channel).toBe("channels");
  });

  it("extracts parent information using the API field priority", () => {
    expect(extractParentInfo({ sender: "merchant-from-sender", merchantId: "ignored" })).toEqual({
      type: "merchant",
      id: "merchant-from-sender",
    });
    expect(extractParentInfo({ divisionId: "division-1" })).toEqual({
      type: "division",
      id: "division-1",
    });
    expect(extractParentInfo({ pspId: "psp-1" })).toEqual({ type: "psp", id: "psp-1" });
    expect(extractParentInfo({ unrelated: true })).toBeNull();
  });

  it("keeps the supported create endpoints stable", () => {
    expect(CREATABLE.division).toEqual({ parentPlural: "psps", childPlural: "divisions" });
    expect(CREATABLE.merchant).toEqual({ parentPlural: "divisions", childPlural: "merchants" });
    expect(CREATABLE.channel).toEqual({ parentPlural: "merchants", childPlural: "channels" });
  });
});