import { describe, expect, it } from "vitest";

import { buildConnectionProbeUrl } from "./connection-probe";

describe("connection probe helpers", () => {
  it("builds a PSP-scoped probe URL", () => {
    expect(buildConnectionProbeUrl({
      baseUrl: "https://eu-test.oppwa.com/bip/webapi/v1",
      pspId: "8ac7a4ca98efa8a00198f1ec9ea30482",
    })).toBe(
      "https://eu-test.oppwa.com/bip/webapi/v1/psps/8ac7a4ca98efa8a00198f1ec9ea30482/divisions",
    );
  });

  it("trims a trailing slash from the base URL", () => {
    expect(buildConnectionProbeUrl({
      baseUrl: "https://eu-test.oppwa.com/bip/webapi/v1/",
      pspId: "psp-1",
    })).toBe("https://eu-test.oppwa.com/bip/webapi/v1/psps/psp-1/divisions");
  });

  it("returns null when PSP ID is missing", () => {
    expect(buildConnectionProbeUrl({
      baseUrl: "https://eu-test.oppwa.com/bip/webapi/v1",
      pspId: "",
    })).toBeNull();
  });
});