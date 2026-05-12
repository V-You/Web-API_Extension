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
  executeLookupClearingInstitutesMock,
  listCardProcessorsMock,
  executeSendTestTransactionMock,
  requestConfirmMock,
  recordWriteMock,
} = vi.hoisted(() => ({
  executeTypedToolMock: vi.fn(),
  executeManageContactMock: vi.fn(),
  executeManageMerchantAccountMock: vi.fn(),
  executeLookupClearingInstitutesMock: vi.fn(),
  listCardProcessorsMock: vi.fn(),
  executeSendTestTransactionMock: vi.fn(),
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
vi.mock("../tools/lookup-clearing-institutes", () => ({
  executeLookupClearingInstitutes: executeLookupClearingInstitutesMock,
}));
vi.mock("../tools/card-processors", () => ({
  listCardProcessors: listCardProcessorsMock,
}));
vi.mock("../tools/send-test-transaction", () => ({
  executeSendTestTransaction: executeSendTestTransactionMock,
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
  executeLookupClearingInstitutesMock.mockReset();
  executeLookupClearingInstitutesMock.mockResolvedValue({ ok: true, status: 200, data: {} });
  listCardProcessorsMock.mockReset();
  listCardProcessorsMock.mockResolvedValue([{ id: "VISA", ciCode: "VISA", name: "VISA", requiredFields: [] }]);
  executeSendTestTransactionMock.mockReset();
  executeSendTestTransactionMock.mockResolvedValue({ ok: true, status: 200, data: { id: "tx-1" } });
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

  it("accepts merchant account create shorthand with merchant parent id", async () => {
    const writes: WriteRecord[] = [];
    const sdk = buildSdkFacade(creds, env, writes);

    const result = await sdk.merchantAccounts.create("merchant-1", { id: "MID-1", name: "MID one", status: "ACTIVE" });

    expect(executeTypedToolMock).toHaveBeenCalledWith(
      "create_merchant_account",
      expect.objectContaining({
        parentType: "merchant",
        parentId: "merchant-1",
        id: "MID-1",
        merchantId: "MID-1",
        name: "MID one",
        status: "ACTIVE",
        state: "LIVE",
      }),
      expect.objectContaining({ confirm: true }),
    );
    expect(result).toMatchObject({
      data: { id: "MID-1", merchantAccountId: "MID-1", name: "MID one" },
    });
  });

  it("accepts merchant account update as an alias for edit", async () => {
    const writes: WriteRecord[] = [];
    const sdk = buildSdkFacade(creds, env, writes);

    await sdk.merchantAccounts.update("ma-1", { state: "LIVE" });

    expect(executeTypedToolMock).toHaveBeenCalledWith(
      "edit_merchant_account",
      { merchantAccountId: "ma-1", state: "LIVE" },
      expect.objectContaining({ confirm: true }),
    );
  });

  it("exposes card processor list as a clearing-institute alias", async () => {
    const writes: WriteRecord[] = [];
    const sdk = buildSdkFacade(creds, env, writes);

    await sdk.cardProcessors.list("psp-1");

    expect(listCardProcessorsMock).toHaveBeenCalledWith("psp-1", creds, env);
  });

  it("lists bundled card processors when no PSP ID is available", async () => {
    const writes: WriteRecord[] = [];
    const sdk = buildSdkFacade(creds, env, writes);

    await sdk.cardProcessors.list();

    expect(listCardProcessorsMock).toHaveBeenCalledWith(undefined, creds, env);
  });

  it("accepts settings.edit as an alias for config.update", async () => {
    const writes: WriteRecord[] = [];
    const sdk = buildSdkFacade(creds, env, writes, { planOnlyWrites: true });

    const result = await sdk.settings.edit("channel", "channel-1", {
      "*/type:channel/duplicate:check": true,
      "*/type:channel/duplicate:window": 10,
    });

    expect(result).toEqual({ ok: true, applied: [], errors: [] });
    expect(writes).toEqual([
      expect.objectContaining({
        tool: "config",
        action: "update",
        entityId: "channel-1",
        entityType: "channel",
        params: {
          settings: {
            "*/type:channel/duplicate:check": true,
            "*/type:channel/duplicate:window": 10,
          },
        },
      }),
    ]);
    expect(requestConfirmMock).not.toHaveBeenCalled();
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

  it("records planned writes without confirmation or backend execution", async () => {
    const writes: WriteRecord[] = [];
    const sdk = buildSdkFacade(creds, env, writes, { planOnlyWrites: true });

    const result = await sdk.contacts.create("division", "div-1", {
      email: "planned@example.test",
      name: "Planned User",
      role: "OPERATOR",
      kind: "SEND",
      language: "en",
    });

    expect(requestConfirmMock).not.toHaveBeenCalled();
    expect(executeTypedToolMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      status: 0,
      data: { planned: true, tool: "create_contact" },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      tool: "manage_contact",
      action: "create",
      entityId: "div-1",
      entityType: "division",
    });
  });

  it("exposes test transactions through the workflow sdk", async () => {
    const writes: WriteRecord[] = [];
    const sdk = buildSdkFacade(creds, env, writes, { autoConfirmWrites: true });

    await sdk.transactions.sendTest({ channelId: "channel-1", merchantId: "merchant-1", tokenMode: "temporary" });

    expect(executeSendTestTransactionMock).toHaveBeenCalledWith(
      { channelId: "channel-1", merchantId: "merchant-1", tokenMode: "temporary" },
      creds,
      env,
      expect.objectContaining({ bypassWriteConfirmation: true, onWriteAccepted: expect.any(Function) }),
    );

    const onWriteAccepted = executeSendTestTransactionMock.mock.calls[0][3].onWriteAccepted as () => void;
    onWriteAccepted();
    expect(writes).toEqual([
      expect.objectContaining({
        tool: "send_test_transaction",
        action: "send",
        entityId: "channel-1",
        entityType: "channel",
      }),
    ]);
  });
});
