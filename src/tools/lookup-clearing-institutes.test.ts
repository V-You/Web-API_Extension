import { describe, expect, it } from "vitest";

import { executeLookupClearingInstitutes } from "./lookup-clearing-institutes";
import type { ApiCredentials, Environment } from "../lib/types";

const creds = { username: "u", password: "p" } as ApiCredentials;
const env = "uat" as Environment;

describe("lookup clearing institutes", () => {
  it("returns bundled processor candidates for an empty search", async () => {
    const result = await executeLookupClearingInstitutes({ action: "search", query: "" }, creds, env);

    expect(result).toMatchObject({ query: "" });
    expect("matchCount" in result ? result.matchCount : 0).toBeGreaterThan(0);
    expect("matches" in result && Array.isArray(result.matches) ? result.matches[0] : null).toMatchObject({
      ciCode: expect.any(String),
      requiredFields: expect.any(Array),
    });
  });
});
