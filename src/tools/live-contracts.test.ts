import { describe, expect, it } from "vitest";

import {
  LIVE_CONTRACTS,
  assertLiveContract,
  validateIdentifierFormats,
} from "./live-contracts";

describe("live-contracts overlay", () => {
  describe("assertLiveContract: create_merchant_account", () => {
    it("passes when all required fields and a CI selector are present", () => {
      expect(() =>
        assertLiveContract("create_merchant_account", {
          name: "Acme LIVE",
          state: "LIVE",
          merchantId: "ACME-1",
          clearingInstituteId: "8a8294174b7ecb28014b9699220015ca",
        }),
      ).not.toThrow();
    });

    it("passes when clearingInstituteName is supplied instead of the id", () => {
      expect(() =>
        assertLiveContract("create_merchant_account", {
          name: "Acme LIVE",
          state: "LIVE",
          merchantId: "ACME-1",
          clearingInstituteName: "Barclays",
        }),
      ).not.toThrow();
    });

    it("lists every missing required field and the CI selector", () => {
      expect(() => assertLiveContract("create_merchant_account", {})).toThrowError(
        /create_merchant_account is missing required field\(s\): name, state, merchantId, clearingInstituteId or clearingInstituteName\./,
      );
    });

    it("flags only the CI selector when other fields are present", () => {
      expect(() =>
        assertLiveContract("create_merchant_account", {
          name: "Acme LIVE",
          state: "LIVE",
          merchantId: "ACME-1",
        }),
      ).toThrowError(/clearingInstituteId or clearingInstituteName/);
    });

    it("treats empty strings and whitespace as missing", () => {
      expect(() =>
        assertLiveContract("create_merchant_account", {
          name: "  ",
          state: "",
          merchantId: "ACME-1",
          clearingInstituteName: "Barclays",
        }),
      ).toThrowError(/name, state/);
    });

    it("includes the error hint to help the model redraft", () => {
      expect(() => assertLiveContract("create_merchant_account", {})).toThrowError(
        /sdk\.merchantAccounts\.create\(parentType, parentId, \{ name, state: "LIVE", merchantId, clearingInstituteId or clearingInstituteName \}\)/,
      );
    });
  });

  describe("assertLiveContract: attach_merchant_account", () => {
    it("passes when merchantAccountId, subTypes and currency are present", () => {
      expect(() =>
        assertLiveContract("attach_merchant_account", {
          merchantAccountId: "ma-1",
          subTypes: "VISA",
          currency: "EUR",
        }),
      ).not.toThrow();
    });

    it("rejects a missing currency", () => {
      expect(() =>
        assertLiveContract("attach_merchant_account", {
          merchantAccountId: "ma-1",
          subTypes: "VISA",
          currency: "",
        }),
      ).toThrowError(
        /attach_merchant_account is missing required field\(s\): currency\. .*attach once per currency/,
      );
    });

    it("rejects a missing subTypes", () => {
      expect(() =>
        assertLiveContract("attach_merchant_account", {
          merchantAccountId: "ma-1",
          currency: "EUR",
        }),
      ).toThrowError(/subTypes/);
    });

    it("lists every missing field when none are present", () => {
      expect(() => assertLiveContract("attach_merchant_account", {})).toThrowError(
        /merchantAccountId, subTypes, currency/,
      );
    });
  });

  describe("assertLiveContract: unknown tool", () => {
    it("is a no-op when no overlay entry exists", () => {
      expect(() => assertLiveContract("totally_made_up_tool", {})).not.toThrow();
    });
  });

  describe("validateIdentifierFormats", () => {
    it("returns no hits when clearingInstituteId is a 32-character hex UUID", () => {
      const hits = validateIdentifierFormats("create_merchant_account", {
        clearingInstituteId: "8a8294174b7ecb28014b9699220015ca",
      });
      expect(hits).toEqual([]);
    });

    it("flags a malformed clearingInstituteId", () => {
      const hits = validateIdentifierFormats("create_merchant_account", {
        clearingInstituteId: "Barclays",
      });
      expect(hits).toEqual([
        {
          field: "clearingInstituteId",
          value: "Barclays",
          description: "32-character API UUID",
        },
      ]);
    });

    it("skips when the field is absent or non-string", () => {
      expect(
        validateIdentifierFormats("create_merchant_account", { clearingInstituteName: "Barclays" }),
      ).toEqual([]);
      expect(validateIdentifierFormats("create_merchant_account", { clearingInstituteId: 123 })).toEqual([]);
    });

    it("returns an empty list when the overlay has no format rules", () => {
      expect(
        validateIdentifierFormats("attach_merchant_account", {
          merchantAccountId: "ma-1",
          subTypes: "VISA",
          currency: "EUR",
        }),
      ).toEqual([]);
    });
  });

  describe("LIVE_CONTRACTS data", () => {
    it("exposes the two Phase 1 overlay entries", () => {
      expect(Object.keys(LIVE_CONTRACTS).sort()).toEqual([
        "attach_merchant_account",
        "create_merchant_account",
      ]);
    });
  });
});
