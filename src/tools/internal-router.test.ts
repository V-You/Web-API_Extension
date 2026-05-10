import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/storage", () => ({
  getActiveEnv: vi.fn(),
  getCredentials: vi.fn(),
  getTransactionTokens: vi.fn(),
}));

vi.mock("../chat/chat-mode", () => ({
  isChatAccessTokenControlEnabled: vi.fn(),
}));

vi.mock("../lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("../lib/transaction-client", () => ({
  sendExampleTransaction: vi.fn(),
}));

vi.mock("../bridge/confirm-bridge", () => ({
  requestConfirm: vi.fn(async () => "confirm"),
}));

import { apiRequest } from "../lib/api-client";
import { sendExampleTransaction } from "../lib/transaction-client";
import { getActiveEnv, getCredentials, getTransactionTokens } from "../lib/storage";
import { createExecuteMap } from "./internal-router";

const apiRequestMock = vi.mocked(apiRequest);
const sendExampleTransactionMock = vi.mocked(sendExampleTransaction);
const getActiveEnvMock = vi.mocked(getActiveEnv);
const getCredentialsMock = vi.mocked(getCredentials);
const getTransactionTokensMock = vi.mocked(getTransactionTokens);

const creds = { baseUrl: "https://example.test", username: "user", password: "pass" };

describe("internal router transaction tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveEnvMock.mockResolvedValue("uat");
    getCredentialsMock.mockResolvedValue(creds);
    getTransactionTokensMock.mockResolvedValue([]);
  });

  it("creates a temporary token, sends the transaction, and cleans up without returning the bearer token", async () => {
    apiRequestMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: {
          apiToken: {
            id: "token-1",
            alias: "wax_tmp_txn",
            apiBearerToken: "raw-temp-token",
            state: "ACTIVE",
            lastDigits: "1234",
          },
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {} })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {} });

    sendExampleTransactionMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { id: "payment-1" },
      request: {
        endpoint: "https://eu-test.oppwa.com/v1/payments",
        method: "POST",
        body: { entityId: "channel-1", amount: "92.00" },
        authorization: "[redacted]",
      },
    });

    const execute = createExecuteMap({ bypassWriteConfirmation: true });
    const result = await execute.send_test_transaction({
      channelId: "channel-1",
      merchantId: "merchant-1",
      tokenMode: "temporary",
    }) as Record<string, unknown>;

    expect(sendExampleTransactionMock).toHaveBeenCalledWith("uat", "raw-temp-token", expect.stringContaining("entityId=channel-1"));
    expect(apiRequestMock.mock.calls.map((call) => call[2].path)).toEqual([
      "/merchants/merchant-1/apiTokens",
      "/apiTokens/token-1/suspend",
      "/apiTokens/token-1",
    ]);
    expect(JSON.stringify(result)).not.toContain("raw-temp-token");
    expect(result.cleanup).toEqual({ attempted: true, suspended: true, deleted: true, errors: [] });
  });

  it("retries auto mode with a temporary token after a stored token authentication failure", async () => {
    getTransactionTokensMock.mockResolvedValueOnce([
      {
        id: "stored-1",
        merchantId: "merchant-1",
        token: "raw-stored-token",
        source: "manual",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
    ]);

    sendExampleTransactionMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        data: { result: { code: "800.900.300", description: "invalid authentication information" } },
        request: {
          endpoint: "https://eu-test.oppwa.com/v1/payments",
          method: "POST",
          body: { entityId: "channel-1" },
          authorization: "[redacted]",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { id: "payment-2" },
        request: {
          endpoint: "https://eu-test.oppwa.com/v1/payments",
          method: "POST",
          body: { entityId: "channel-1" },
          authorization: "[redacted]",
        },
      });

    apiRequestMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: { apiToken: { id: "token-2", apiBearerToken: "raw-temp-token", state: "ACTIVE" } },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {} })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {} });

    const execute = createExecuteMap({ bypassWriteConfirmation: true });
    const result = await execute.send_test_transaction({
      channelId: "channel-1",
      merchantId: "merchant-1",
      tokenMode: "auto",
    }) as Record<string, unknown>;

    expect(sendExampleTransactionMock).toHaveBeenNthCalledWith(1, "uat", "raw-stored-token", expect.any(String));
    expect(sendExampleTransactionMock).toHaveBeenNthCalledWith(2, "uat", "raw-temp-token", expect.any(String));
    expect(JSON.stringify(result)).not.toContain("raw-stored-token");
    expect(JSON.stringify(result)).not.toContain("raw-temp-token");
    expect(result.previousAttempt).toBeDefined();
  });

  it("rejects stored mode when the stored token merchant does not match", async () => {
    getTransactionTokensMock.mockResolvedValueOnce([
      {
        id: "stored-1",
        merchantId: "other-merchant",
        token: "raw-stored-token",
        source: "manual",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
    ]);

    const execute = createExecuteMap({ bypassWriteConfirmation: true });
    await expect(execute.send_test_transaction({
      channelId: "channel-1",
      merchantId: "merchant-1",
      tokenMode: "stored",
    })).rejects.toThrow("No stored transaction token matched");
    expect(sendExampleTransactionMock).not.toHaveBeenCalled();
  });
});
