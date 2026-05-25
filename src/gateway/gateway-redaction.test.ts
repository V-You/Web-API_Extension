import { describe, expect, it } from "vitest";

import { redactToolParams, sanitizeDashboardUrl } from "./gateway-redaction";

describe("gateway-redaction", () => {
  describe("redactToolParams", () => {
    it("returns undefined for tools not on the allowlist", () => {
      expect(redactToolParams("unknown_tool", { foo: "bar" })).toBeUndefined();
    });

    it("returns undefined for blocklisted card-data tools", () => {
      expect(
        redactToolParams("send_test_transaction", {
          pan: "4111111111111111",
          cvv: "123",
          amount: 10,
        }),
      ).toBeUndefined();
    });

    it("projects only allowed keys", () => {
      const out = redactToolParams("list_merchants", {
        env: "uat",
        pspId: "psp-1",
        includeDisabled: true,
        password: "leak",
        bearer: "leak",
      });
      expect(out).toEqual({ env: "uat", pspId: "psp-1", includeDisabled: true });
    });

    it("masks bearer tokens inside allowed string values", () => {
      const out = redactToolParams("set_setting", {
        env: "uat",
        entityId: "e",
        entityType: "channel",
        key: "k",
        value: "Authorization: Bearer abc.def.ghi",
      });
      expect(out?.value).toContain("Bearer [redacted]");
    });

    it("redacts JWT-shaped values inside allowed strings", () => {
      const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature_part_here_abc";
      const out = redactToolParams("set_setting", {
        env: "uat",
        entityId: "e",
        entityType: "channel",
        key: "k",
        value: `note ${jwt} tail`,
      });
      expect(out?.value).not.toContain(jwt);
      expect(out?.value).toContain("[redacted]");
    });

    it("redacts Luhn-valid PAN-shaped runs inside allowed strings", () => {
      // 4111 1111 1111 1111 is a canonical Luhn-valid test PAN.
      const out = redactToolParams("set_setting", {
        env: "uat",
        entityId: "e",
        entityType: "channel",
        key: "k",
        value: "pan=4111111111111111",
      });
      expect(out?.value).not.toContain("4111111111111111");
      expect(out?.value).toContain("[redacted]");
    });

    it("leaves non-Luhn long digit runs intact", () => {
      const out = redactToolParams("set_setting", {
        env: "uat",
        entityId: "e",
        entityType: "channel",
        key: "k",
        value: "order=1234567890123",
      });
      expect(out?.value).toContain("1234567890123");
    });

    it("redacts cardish-keyed nested values even on the allowlist", () => {
      const out = redactToolParams("set_channel_clearing_institute", {
        env: "uat",
        channelId: "c",
        clearingInstituteId: "ci",
        fields: { cvv: "123", holderName: "Jane Doe", iban: "DE89" },
      });
      const fields = (out?.fields ?? {}) as Record<string, unknown>;
      expect(fields.cvv).toBe("[redacted]");
      expect(fields.holderName).toBe("[redacted]");
      expect(fields.iban).toBe("DE89");
    });

    it("replaces oversized payloads with a marker", () => {
      const big = "x".repeat(50 * 1024);
      const out = redactToolParams("set_setting", {
        env: "uat",
        entityId: "e",
        entityType: "channel",
        key: "k",
        value: big,
      });
      expect(out?._redacted).toBe("oversized");
      expect(typeof out?.sizeBytes).toBe("number");
    });
  });

  describe("sanitizeDashboardUrl", () => {
    it("strips query and fragment", () => {
      expect(sanitizeDashboardUrl("https://eu-test.oppwa.com/path/x?token=abc#frag")).toBe(
        "https://eu-test.oppwa.com/path/x",
      );
    });

    it("returns undefined for invalid URLs", () => {
      expect(sanitizeDashboardUrl("not a url")).toBeUndefined();
    });

    it("passes through undefined", () => {
      expect(sanitizeDashboardUrl(undefined)).toBeUndefined();
    });
  });
});
