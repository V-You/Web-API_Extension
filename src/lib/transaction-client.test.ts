import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseTransactionBody, sendExampleTransaction } from "./transaction-client";

describe("transaction client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("parses newline key-value form bodies", () => {
    expect(parseTransactionBody("amount=92.00\ncurrency=EUR\n# comment\n")).toEqual({
      amount: "92.00",
      currency: "EUR",
    });
  });

  it("redacts Authorization from the returned request summary", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: "payment-1" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendExampleTransaction("uat", "raw-token-secret", "amount=92.00\ncurrency=EUR");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.request.authorization).toBe("[redacted]");
    expect(JSON.stringify(result)).not.toContain("raw-token-secret");
  });

  it("marks non-success payment result codes as not ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ result: { code: "800.900.300", description: "invalid authentication information" } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendExampleTransaction("uat", "raw-token-secret", "amount=92.00\ncurrency=EUR");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(200);
  });
});