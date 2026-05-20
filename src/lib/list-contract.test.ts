/**
 * Tests for the shared list contract used by both the sandbox facade and
 * the service-worker job executor (PRD md/2026-05-18_PRD_contract-first-workflow-sdk.md).
 *
 * Both SDK construction sites must route every list/search method through
 * `normalizeListResult`. This file pins the helper's behaviour so the
 * contract cannot drift across the two SDK surfaces.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeListResult,
  contactScopeKeys,
  merchantAccountScopeKeys,
  LIST_KEYS,
} from "./list-contract";

describe("normalizeListResult", () => {
  it("returns an array when given the tool-handler envelope with raw array data", () => {
    const result = normalizeListResult(
      { ok: true, status: 200, data: [{ id: "a" }, { id: "b" }] },
      { label: "test" },
    );
    expect(result).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("extracts an array under a candidate plural key", () => {
    const result = normalizeListResult(
      { ok: true, status: 200, data: { merchants: [{ id: "m-1" }] } },
      { label: "list merchants", candidateKeys: ["merchants"] },
    );
    expect(result).toEqual([{ id: "m-1" }]);
  });

  it("extracts the sole array-valued property as a last resort", () => {
    const result = normalizeListResult(
      { ownedContacts: [{ id: "c-1" }] },
      { label: "list contacts" },
    );
    expect(result).toEqual([{ id: "c-1" }]);
  });

  it("returns an empty array for null / unknown shapes rather than throwing", () => {
    expect(normalizeListResult(null, { label: "x" })).toEqual([]);
    expect(normalizeListResult({}, { label: "x" })).toEqual([]);
    expect(normalizeListResult({ data: { items: 5 } }, { label: "x" })).toEqual([]);
  });

  it("throws a clear error when the envelope reports ok: false", () => {
    expect(() =>
      normalizeListResult(
        { ok: false, status: 403, data: { error: { message: "Forbidden" } } },
        { label: "list contacts" },
      ),
    ).toThrow(/list contacts failed: Forbidden/);
  });

  it("throws a clear error when the result carries an `error` string", () => {
    expect(() =>
      normalizeListResult(
        { error: "entityId and entityType are required for list." },
        { label: "list merchant accounts" },
      ),
    ).toThrow(/list merchant accounts failed: entityId and entityType/);
  });

  it("includes HTTP status when no error message is available", () => {
    expect(() =>
      normalizeListResult(
        { ok: false, status: 500, data: null },
        { label: "list channels" },
      ),
    ).toThrow(/list channels failed: HTTP 500/);
  });

  it("accepts a raw array (no envelope) and filters out non-records", () => {
    expect(normalizeListResult([{ id: "a" }, null, "skip", { id: "b" }], { label: "x" })).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });
});

describe("scope-key helpers", () => {
  it("contactScopeKeys picks ownedContacts by default", () => {
    expect(contactScopeKeys()).toEqual(["ownedContacts", "contacts"]);
    expect(contactScopeKeys("owned")).toEqual(["ownedContacts", "contacts"]);
    expect(contactScopeKeys("attached")).toEqual(["attachedContacts", "contacts"]);
  });

  it("merchantAccountScopeKeys picks ownedMerchantAccounts by default", () => {
    expect(merchantAccountScopeKeys()).toEqual(["ownedMerchantAccounts", "merchantAccounts"]);
    expect(merchantAccountScopeKeys("attached")).toEqual([
      "attachedMerchantAccounts",
      "merchantAccounts",
    ]);
  });

  it("LIST_KEYS exposes the canonical candidate sets", () => {
    expect(LIST_KEYS.clearingInstitutesSearch).toContain("matches");
    expect(LIST_KEYS.clearingInstitutesLive).toContain("clearingInstitutes");
    expect(LIST_KEYS.cardProcessors).toContain("cardProcessors");
  });
});
