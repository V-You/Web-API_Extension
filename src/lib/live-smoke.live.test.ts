/**
 * Read-only live smoke tests against UAT.
 *
 * Gated behind `npm run test:live` (sets WEBAPI_TEST_LIVE=1) and requires
 * a populated `.env`:
 *
 *   BASE_URL=https://eu-test.oppwa.com/bip/webapi/v1
 *   CREDENTIALS=email@example.com:password
 *   SMOKE_DIVISION_ID=<hex id>     # optional; enables contact + MA list tests
 *   SMOKE_PSP_NAME=<psp name>      # optional; enables search-by-name test
 *
 * The suite skips cleanly when the env is missing. No writes.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { apiRequest } from "./api-client";
import { loadLiveTestEnv, scrubSecrets } from "./test-env";

const env = loadLiveTestEnv();
const LIVE_FLAG = process.env.WEBAPI_TEST_LIVE === "1";

const describeIf = LIVE_FLAG && env.enabled ? describe : describe.skip;

describeIf("live smoke tests (UAT, read-only)", () => {
  beforeAll(() => {
    if (!LIVE_FLAG) return;
    if (!env.enabled) {
      // Logged once for visibility; credentials are scrubbed.
      console.log(`[live tests skipped] ${env.skipReason}`);
    }
  });

  afterEach(() => {
    // no-op; network calls are audit-logged via apiRequest.
  });

  it("lists owned contacts on SMOKE_DIVISION_ID", async () => {
    if (!env.smokeDivisionId) {
      console.log("[skip] SMOKE_DIVISION_ID unset");
      return;
    }
    const res = await apiRequest(env.credentials, "uat", {
      path: `/divisions/${env.smokeDivisionId}/ownedContacts`,
    });
    const safe = scrubSecrets(JSON.stringify({ status: res.status }), env.credentials);
    console.log(`list contacts -> ${safe}`);
    expect(res.ok).toBe(true);
  });

  it("lists owned merchant accounts on SMOKE_DIVISION_ID", async () => {
    if (!env.smokeDivisionId) {
      console.log("[skip] SMOKE_DIVISION_ID unset");
      return;
    }
    const res = await apiRequest(env.credentials, "uat", {
      path: `/divisions/${env.smokeDivisionId}/ownedMerchantAccounts`,
    });
    console.log(`list MAs -> status ${res.status}`);
    expect(res.ok).toBe(true);
  });

  it("searches entity by name path via SMOKE_PSP_NAME", async () => {
    if (!env.smokePspName) {
      console.log("[skip] SMOKE_PSP_NAME unset");
      return;
    }
    const segment = encodeURIComponent(env.smokePspName);
    const res = await apiRequest(env.credentials, "uat", {
      path: `/entities/byName/${segment}`,
    });
    console.log(`search entity -> status ${res.status}`);
    expect([200, 404]).toContain(res.status);
  });

  it("auth header is accepted (any read endpoint returns non-401)", async () => {
    const probePath = env.smokeDivisionId
      ? `/divisions/${env.smokeDivisionId}/ownedContacts`
      : env.smokePspId
        ? `/psps/${env.smokePspId}/divisions`
        : "/entities/byName/__connection_probe__";
    const res = await apiRequest(env.credentials, "uat", { path: probePath });
    console.log(`auth probe ${probePath} -> status ${res.status}`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
