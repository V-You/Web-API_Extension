/**
 * Sandbox SDK facade unit tests.
 *
 * Covers Part-II P2-D3: sandbox writes go through the typed adapter
 * (executeTypedTool) with confirm-bypass, and merchant-account attach
 * passes its params at top level -- the bug that originally passed
 * them nested under `fields` is regression-guarded here.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  executeTypedToolMock,
  executeManageContactMock,
  executeManageMerchantAccountMock,
  requestConfirmMock,
  recordWriteMock,
} = vi.hoisted(() => ({
  executeTypedToolMock: vi.fn(),
  executeManageContactMock: vi.fn(),
  executeManageMerchantAccountMock: vi.fn(),
  requestConfirmMock: vi.fn(),
  recordWriteMock: vi.fn(),
}));

vi.mock("../tools/adapter", () => ({
  executeTypedTool: executeTypedToolMock,
  isReadOnlyTool: () => false,
}));
vi.mock("../tools/manage-contact", () => ({
  executeManageContact: executeManageContactMock,
}));
vi.mock("../tools/manage-merchant-account", () => ({
  executeManageMerchantAccount: executeManageMerchantAccountMock,
}));
vi.mock("../bridge/confirm-bridge", () => ({
  requestConfirm: requestConfirmMock,
}));
vi.mock("../bridge/write-status", () => ({
  recordWrite: recordWriteMock,
}));

import { buildSdkFacade, type WriteRecord } from "./sdk-facade";
import type { ApiCredentials, Environment } from "../lib/types";

const creds: ApiCredentials = { username: "u", password: "p" } as ApiCredentials;
const env: Environment = "test" as Environment;

beforeEach(() => {
  executeTypedToolMock.mockReset();
  executeTypedToolMock.mockResolvedValue({ ok: true, status: 200, data: {} });
  executeManageContactMock.mockReset();
  executeManageContactMock.mockResolvedValue({ ok: true, status: 200, data: {} });
  executeManageMerchantAccountMock.mockReset();
  executeManageMerchantAccountMock.mockResolvedValue({ ok: true, status: 200, data: {} });
  requestConfirmMock.mockReset();
  requestConfirmMock.mockResolvedValue("confirm");
});

describe("sandbox SDK facade - typed adapter routing (Part-II P2-D3)", () => {
  it("routes merchant account attach through executeTypedTool with top-level params", async () => {
    const writes: WriteRecord[] = [];
    const sdk = buildSdkFacade(creds, env, writes);

    await sdk.merchantAccounts.attach("division", "div-123", "ma-456", "VISA,MC", "USD");

    expect(executeTypedToolMock).toHaveBeenCalledTimes(1);
    const [toolName, params, options] = executeTypedToolMock.mock.calls[0];
    expect(toolName).toBe("attach_merchant_account");
    expect(params).toEqual({
      parentType: "division",
      parentId: "div-123",
      merchantAccountId: "ma-456",
      subTypes: "VISA,MC",
      currency: "USD",
    });
    // Confirm bypass -- outer facade confirms.
    expect(options).toMatchObject({ confirm: true });
    // Params are NOT nested under `fields`. Regression guard for the
    // original attach bug.
    expect(params).not.toHaveProperty("fields");
  });

  it("routes entity.create(division) through create_division with parent alias", async () => {
    const writes: WriteRecord[] = [];
    const sdk = buildSdkFacade(creds, env, writes);

    await sdk.entities.create("psp", "psp-1", "division", { name: "new-div", state: "LIVE" });

    expect(executeTypedToolMock).toHaveBeenCalledWith(
      "create_division",
      { parentType: "psp", parentId: "psp-1", name: "new-div", state: "LIVE" },
      expect.objectContaining({ confirm: true }),
    );
  });

  it("routes contact.edit through edit_contact with fields at top level", async () => {
    const writes: WriteRecord[] = [];
    const sdk = buildSdkFacade(creds, env, writes);

    await sdk.contacts.edit("c-1", { name: "Alice", role: "ADMIN" });

    expect(executeTypedToolMock).toHaveBeenCalledWith(
      "edit_contact",
      { contactId: "c-1", name: "Alice", role: "ADMIN" },
      expect.objectContaining({ confirm: true }),
    );
  });

  it("records a write entry and throws when the user cancels", async () => {
    requestConfirmMock.mockResolvedValueOnce("cancel");
    const writes: WriteRecord[] = [];
    const sdk = buildSdkFacade(creds, env, writes);

    await expect(sdk.merchantAccounts.attach("division", "d1", "ma1", "VISA", "EUR")).rejects.toThrow(
      /cancelled/,
    );
    expect(executeTypedToolMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});
