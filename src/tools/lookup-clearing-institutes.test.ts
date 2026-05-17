import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

import { executeLookupClearingInstitutes } from "./lookup-clearing-institutes";
import { apiRequest } from "../lib/api-client";
import type { ApiCredentials, Environment } from "../lib/types";

const apiRequestMock = vi.mocked(apiRequest);

const creds = { username: "u", password: "p" } as ApiCredentials;
const env = "uat" as Environment;

describe("lookup clearing institutes", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("returns bundled processor candidates for an empty search", async () => {
    const result = await executeLookupClearingInstitutes({ action: "search", query: "" }, creds, env);

    expect(result).toMatchObject({ query: "" });
    expect("matchCount" in result ? result.matchCount : 0).toBeGreaterThan(0);
    expect("matches" in result && Array.isArray(result.matches) ? result.matches[0] : null).toMatchObject({
      ciCode: expect.any(String),
      requiredFields: expect.any(Array),
    });
  });

  it("filters live PSP clearing institutes and returns API id/name", async () => {
    apiRequestMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        clearingInstitutes: [
          { id: "8a8294175e7a703e015e802ca88315ca", name: "BARCLAYS_CI", internationalCode: "BARCLAYS", country: "GB" },
          { id: "ff8080813a01cd4e013a0290d1450214", name: "ACCEPTANCE_TEST", internationalCode: "ACCEPTANCE" },
        ],
      },
    });

    const result = await executeLookupClearingInstitutes({ action: "search", query: "Barclays", pspId: "psp-1" }, creds, env);

    expect(apiRequestMock).toHaveBeenCalledWith(creds, env, { path: "/psps/psp-1/clearingInstitutes" });
    expect(result).toMatchObject({
      source: "live",
      matchCount: 1,
      recommended: {
        id: "8a8294175e7a703e015e802ca88315ca",
        name: "BARCLAYS_CI",
        ciCode: "BARCLAYS",
        createFields: { clearingInstituteId: "8a8294175e7a703e015e802ca88315ca" },
      },
    });
  });
});
