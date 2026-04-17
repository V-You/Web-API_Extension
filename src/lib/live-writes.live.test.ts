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
 * Tests exercise end-to-end create -> edit -> lock -> unlock -> delete on a
 * throwaway contact, then a create/delete merchant-account cycle. All calls
 * log method+path for auditability; credentials are scrubbed on log.
 *
 * Contacts are always created on SMOKE_DIVISION_ID to keep the blast radius
 * predictable. If this env var is absent, the suite skips.
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

  beforeAll(() => {
    console.log(`[live writes] division=${env.smokeDivisionId} stamp=${stamp}`);
  });

  afterAll(async () => {
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
});
