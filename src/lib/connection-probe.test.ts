import { describe, expect, it } from "vitest";

import { buildConnectionProbeUrl } from "./connection-probe";

describe("connection probe helpers", () => {
  it("builds a PSP-scoped probe URL with ownedContacts", () => {
    expect(buildConnectionProbeUrl({
      baseUrl: "https://eu-test.oppwa.com/bip/webapi/v1",
      scopeEntityId: "8ac7a4ca98efa8a00198f1ec9ea30482",
      scopeEntityType: "psp",
    })).toBe(
      "https://eu-test.oppwa.com/bip/webapi/v1/psps/8ac7a4ca98efa8a00198f1ec9ea30482/ownedContacts",
    );
  });

  it("builds a division-scoped probe URL", () => {
    expect(buildConnectionProbeUrl({
      baseUrl: "https://eu-test.oppwa.com/bip/webapi/v1",
      scopeEntityId: "div-123",
      scopeEntityType: "division",
    })).toBe(
      "https://eu-test.oppwa.com/bip/webapi/v1/divisions/div-123/ownedContacts",
    );
  });

  it("falls back to pspId for legacy credentials", () => {
    expect(buildConnectionProbeUrl({
      baseUrl: "https://eu-test.oppwa.com/bip/webapi/v1",
      pspId: "legacy-psp",
    })).toBe(
      "https://eu-test.oppwa.com/bip/webapi/v1/psps/legacy-psp/ownedContacts",
    );
  });

  it("trims a trailing slash from the base URL", () => {
    expect(buildConnectionProbeUrl({
      baseUrl: "https://eu-test.oppwa.com/bip/webapi/v1/",
      scopeEntityId: "psp-1",
    })).toBe("https://eu-test.oppwa.com/bip/webapi/v1/psps/psp-1/ownedContacts");
  });

  it("returns null when entity ID is missing", () => {
    expect(buildConnectionProbeUrl({
      baseUrl: "https://eu-test.oppwa.com/bip/webapi/v1",
    })).toBeNull();
  });
});