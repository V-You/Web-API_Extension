/**
 * Opt-in live WRITE tests against UAT.
 *
 * Gated behind both:
 *   - WEBAPI_TEST_LIVE=1 (set by `npm run test:live`)
 *   - WEBAPI_TEST_LIVE_WRITES=1 (explicit opt-in; prevents accidental writes)
 *
 * Requires a populated `.env`:
 *
 *   CREDENTIALS=email:password
 *   BASE_URL=https://eu-test.oppwa.com/bip/webapi/v1
 *   SMOKE_DIVISION_ID=<hex id>
 *
 * Optional env (individual lifecycles skip gracefully when absent):
 *   SMOKE_PSP_ID=<hex id>                   -- enables create_division lifecycle
 *   SMOKE_CLEARING_INSTITUTE_ID=<id>        -- enables MA create/edit/delete
 *   SMOKE_MERCHANT_ACCOUNT_ID=<id>          -- enables attach_merchant_account
 *
 * Tests exercise end-to-end lifecycles on throwaway resources. Every path
 * logs method+path for auditability; credentials are scrubbed on log.
 *
 * Part-II phase E -- coverage surface:
 *   - contact: create / edit / lock / unlock / set_password / delete
 *   - division: create / delete
 *   - merchant account: create / edit / delete
 *   - attach/detach: attach_merchant_account / detach (if MA id provided)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { executeTypedTool } from "../tools/adapter";
import { loadLiveTestEnv } from "./test-env";

const env = loadLiveTestEnv();
const LIVE = process.env.WEBAPI_TEST_LIVE === "1";
const WRITES = process.env.WEBAPI_TEST_LIVE_WRITES === "1";
const gate = LIVE && WRITES && env.enabled && Boolean(env.smokeDivisionId);
const describeIf = gate ? describe : describe.skip;

describeIf("live write tests (UAT)", () => {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  let contactId: string | null = null;
  let createdDivisionId: string | null = null;
  let createdMaId: string | null = null;
  let attachedMa: { parentType: string; parentId: string; merchantAccountId: string } | null = null;

  beforeAll(() => {
    console.log(`[live writes] division=${env.smokeDivisionId} stamp=${stamp}`);
  });

  afterAll(async () => {
    // Cleanup order: detach first (if any attach succeeded), then delete
    // resources in reverse creation order.
    if (attachedMa) {
      const res = await executeTypedTool(
        "detach_merchant_account",
        { ...attachedMa, confirm: true },
        { creds: env.credentials, env: "uat" },
      );
      console.log(`[cleanup] detach_merchant_account -> ${res.status}`);
    }
    if (createdMaId) {
      const res = await executeTypedTool(
        "delete_merchant_account",
        { merchantAccountId: createdMaId, confirm: true },
        { creds: env.credentials, env: "uat" },
      );
      console.log(`[cleanup] delete_merchant_account ${createdMaId} -> ${res.status}`);
    }
    if (createdDivisionId) {
      const res = await executeTypedTool(
        "delete_entity",
        { entityType: "division", entityId: createdDivisionId, confirm: true },
        { creds: env.credentials, env: "uat" },
      );
      console.log(`[cleanup] delete_entity division ${createdDivisionId} -> ${res.status}`);
    }
    if (contactId) {
      const res = await executeTypedTool(
        "delete_contact",
        { contactId, confirm: true },
        { creds: env.credentials, env: "uat" },
      );
      console.log(`[cleanup] delete_contact ${contactId} -> ${res.status}`);
    }
  });

  it("creates a disposable contact via create_contact", async () => {
    const res = await executeTypedTool<{ id?: string }>(
      "create_contact",
      {
        parentType: "division",
        parentId: env.smokeDivisionId!,
        email: `smoke+${stamp}@example.invalid`,
        name: `Smoke ${stamp}`,
        role: "OPERATOR",
        kind: "SEND",
        language: "en",
      },
      { creds: env.credentials, env: "uat" },
    );
    expect(res.ok).toBe(true);
    const id = (res.data as { id?: string }).id;
    expect(typeof id).toBe("string");
    contactId = id ?? null;
  });

  it("edits the contact via edit_contact", async () => {
    if (!contactId) return;
    const res = await executeTypedTool(
      "edit_contact",
      { contactId, language: "de" },
      { creds: env.credentials, env: "uat" },
    );
    expect(res.ok).toBe(true);
  });

  it("locks and unlocks the contact", async () => {
    if (!contactId) return;
    const lock = await executeTypedTool(
      "lock_contact",
      { contactId, confirm: true },
      { creds: env.credentials, env: "uat" },
    );
    expect([200, 204]).toContain(lock.status);
    const unlock = await executeTypedTool(
      "unlock_contact",
      { contactId, confirm: true },
      { creds: env.credentials, env: "uat" },
    );
    expect([200, 204]).toContain(unlock.status);
  });

  it("resets the contact password via set_contact_password", async () => {
    if (!contactId) return;
    const res = await executeTypedTool(
      "set_contact_password",
      { contactId, confirm: true },
      { creds: env.credentials, env: "uat" },
    );
    // The endpoint returns 200 on success or 204 on no content.
    expect([200, 204]).toContain(res.status);
  });

  it("create_division -> delete_entity lifecycle (SMOKE_PSP_ID gated)", async () => {
    if (!env.smokePspId) {
      console.log("[skip] create_division: SMOKE_PSP_ID not set");
      return;
    }
    const created = await executeTypedTool<{ id?: string }>(
      "create_division",
      { pspId: env.smokePspId, name: `smoke-div-${stamp}`, state: "DISABLED" },
      { creds: env.credentials, env: "uat" },
    );
    expect(created.ok).toBe(true);
    const id = (created.data as { id?: string }).id;
    expect(typeof id).toBe("string");
    createdDivisionId = id ?? null;
  });

  it("create/edit/delete merchant account lifecycle (SMOKE_CLEARING_INSTITUTE_ID gated)", async () => {
    if (!env.smokeClearingInstituteId || !env.smokeDivisionId) {
      console.log("[skip] create_merchant_account: SMOKE_CLEARING_INSTITUTE_ID or SMOKE_DIVISION_ID not set");
      return;
    }
    const created = await executeTypedTool<{ id?: string }>(
      "create_merchant_account",
      {
        parentType: "division",
        parentId: env.smokeDivisionId,
        name: `smoke-ma-${stamp}`,
        state: "TEST",
        clearingInstituteId: env.smokeClearingInstituteId,
      },
      { creds: env.credentials, env: "uat" },
    );
    expect(created.ok).toBe(true);
    const id = (created.data as { id?: string }).id;
    expect(typeof id).toBe("string");
    createdMaId = id ?? null;

    if (createdMaId) {
      const edited = await executeTypedTool(
        "edit_merchant_account",
        { merchantAccountId: createdMaId, merchant3DName: `smoke-3d-${stamp}` },
        { creds: env.credentials, env: "uat" },
      );
      expect(edited.ok).toBe(true);
    }
  });

  it("attach_merchant_account lifecycle (SMOKE_MERCHANT_ACCOUNT_ID gated)", async () => {
    if (!env.smokeMerchantAccountId || !env.smokeDivisionId) {
      console.log("[skip] attach_merchant_account: SMOKE_MERCHANT_ACCOUNT_ID or SMOKE_DIVISION_ID not set");
      return;
    }
    const res = await executeTypedTool(
      "attach_merchant_account",
      {
        parentType: "division",
        parentId: env.smokeDivisionId,
        merchantAccountId: env.smokeMerchantAccountId,
        confirm: true,
      },
      { creds: env.credentials, env: "uat" },
    );
    // Regression guard for Part-II P2-D2: MA attach now flows typed params
    // at the top level. If this silently reverts to nesting under `fields`
    // the server returns 400 here.
    expect([200, 201, 204]).toContain(res.status);
    if (res.ok) {
      attachedMa = {
        parentType: "division",
        parentId: env.smokeDivisionId,
        merchantAccountId: env.smokeMerchantAccountId,
      };
    }
  });
});
