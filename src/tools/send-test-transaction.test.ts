import { describe, expect, it } from "vitest";

import {
  KNOWN_SEND_TEST_TRANSACTION_PARAMS,
  assertKnownSendTestTransactionParams,
  executeSendTestTransaction,
  executeSendTestTransactions,
} from "./send-test-transaction";

const creds = { username: "u", password: "p" } as Parameters<typeof executeSendTestTransaction>[1];

describe("send_test_transaction param gate (PRD 2026-05-18 Phase 2)", () => {
  it("accepts every documented field name", () => {
    const params = Object.fromEntries(
      Array.from(KNOWN_SEND_TEST_TRANSACTION_PARAMS).map((field) => [field, "x"]),
    );
    expect(() => assertKnownSendTestTransactionParams("send_test_transaction", params)).not.toThrow();
  });

  it("rejects invented fields before transport", () => {
    expect(() =>
      assertKnownSendTestTransactionParams("send_test_transaction", {
        channelId: "c1",
        paymentBrand: "VISA",
        fooBarInvented: "x",
        anotherWrong: 1,
      }),
    ).toThrowError(
      /send_test_transaction received unknown field\(s\): fooBarInvented, anotherWrong\. Accepted fields:/,
    );
  });

  it("blocks executeSendTestTransaction (handwritten path) before any API call", async () => {
    await expect(
      executeSendTestTransaction(
        { channelId: "c1", merchantId: "m1", paymentBrand: "VISA", invented: "yes" },
        creds,
        "uat",
        { bypassWriteConfirmation: true },
      ),
    ).rejects.toThrow(/send_test_transaction received unknown field\(s\): invented/);
  });

  it("blocks executeSendTestTransactions before any API call", async () => {
    await expect(
      executeSendTestTransactions(
        { channelId: "c1", merchantId: "m1", count: 3, invented: "yes" },
        creds,
        "uat",
        { bypassWriteConfirmation: true },
      ),
    ).rejects.toThrow(/send_test_transactions received unknown field\(s\): invented/);
  });
});
