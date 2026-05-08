import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("../bridge/confirm-bridge", () => ({
  requestConfirm: vi.fn(async () => "confirm"),
}));

import { apiRequest } from "../lib/api-client";
import { requestConfirm } from "../bridge/confirm-bridge";
import { executeTypedTool } from "./adapter";

const apiRequestMock = vi.mocked(apiRequest);
const requestConfirmMock = vi.mocked(requestConfirm);

const creds = { baseUrl: "u", username: "x", password: "y" } as never;
const env = "uat" as never;

describe("typed-write adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequestMock.mockResolvedValue({ ok: true, status: 200, data: {} });
  });

  it("substitutes path params using the parentType alias for multi-variant tools", async () => {
    await executeTypedTool(
      "create_contact",
      {
        parentType: "merchant",
        parentId: "merchant-1",
        email: "a@b.c",
        name: "User",
        role: "OPERATOR",
        kind: "SEND",
        language: "en",
      },
      { creds, env },
    );

    const call = apiRequestMock.mock.calls[0];
    expect(call[2].method).toBe("POST");
    expect(call[2].path).toBe("/merchants/merchant-1/ownedContacts");
  });

  it("rejects unknown fields with the accepted list in details", async () => {
    const res = await executeTypedTool(
      "create_contact",
      {
        parentType: "merchant",
        parentId: "merchant-1",
        email: "a@b.c",
        role: "OPERATOR",
        kind: "SEND",
        language: "en",
        name: "User",
        username: "oops",
      },
      { creds, env },
    );

    expect(res.ok).toBe(false);
    expect((res.data as { error: string }).error).toMatch(/Unknown field/);
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("errors on a missing path parameter", async () => {
    const res = await executeTypedTool(
      "get_contact",
      {},
      { creds, env },
    );
    expect(res.ok).toBe(false);
    expect((res.data as { error: string }).error).toMatch(/contactId/);
  });

  it("flags conditional required fields when the trigger matches", async () => {
    const res = await executeTypedTool(
      "create_contact",
      {
        parentType: "merchant",
        parentId: "merchant-1",
        email: "a@b.c",
        name: "User",
        role: "OPERATOR",
        kind: "OAUTH_APP",
        language: "en",
      },
      { creds, env },
    );
    expect(res.ok).toBe(false);
    expect((res.data as { error: string }).error).toMatch(/oauthRedirectUrl/);
  });

  it("coerces booleans to string form at the transport boundary", async () => {
    await executeTypedTool(
      "create_contact",
      {
        parentType: "merchant",
        parentId: "merchant-1",
        email: "a@b.c",
        name: "User",
        role: "OPERATOR",
        kind: "SEND",
        language: "en",
        autoAttach: true,
      },
      { creds, env },
    );
    const params = apiRequestMock.mock.calls[0][2].params ?? {};
    expect(params.autoAttach).toBe("true");
  });

  it("routes destructive tools through the confirm bridge", async () => {
    await executeTypedTool(
      "delete_contact",
      { contactId: "c1" },
      { creds, env },
    );
    expect(requestConfirmMock).toHaveBeenCalledTimes(1);
  });

  it("ignores confirm=true in rawParams (model cannot bypass dialog)", async () => {
    await executeTypedTool(
      "delete_contact",
      { contactId: "c1", confirm: true },
      { creds, env },
    );
    expect(requestConfirmMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses the confirm bridge when options.confirm=true (trusted caller)", async () => {
    await executeTypedTool(
      "delete_contact",
      { contactId: "c1" },
      { creds, env, confirm: true },
    );
    expect(requestConfirmMock).not.toHaveBeenCalled();
  });

  it("aborts the call when the confirm bridge returns cancel", async () => {
    requestConfirmMock.mockResolvedValueOnce("cancel");
    const res = await executeTypedTool(
      "delete_contact",
      { contactId: "c1" },
      { creds, env },
    );
    expect(res.ok).toBe(false);
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("gates state=DELETED edits through the confirm bridge", async () => {
    await executeTypedTool(
      "edit_entity",
      { parentType: "division", parentId: "d1", name: "Division", state: "DELETED" },
      { creds, env },
    );
    expect(requestConfirmMock).toHaveBeenCalledTimes(1);
  });

  it("returns ok=false for an unknown tool name", async () => {
    const res = await executeTypedTool("does_not_exist", {}, { creds, env });
    expect(res.ok).toBe(false);
  });

  it("filters out DISABLED items from list tool responses", async () => {
    apiRequestMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        channels: [
          { channel: "ch1", name: "Active", state: "LIVE" },
          { channel: "ch2", name: "Deleted", state: "DISABLED" },
          { channel: "ch3", name: "Test", state: "CONNECTOR_TEST" },
        ],
      },
    });
    const res = await executeTypedTool(
      "list_channels",
      { merchantId: "aabbccdd00112233" },
      { creds, env },
    );
    expect(res.ok).toBe(true);
    const data = res.data as { channels: { channel: string }[]; _hiddenDisabled: number };
    expect(data.channels).toHaveLength(2);
    expect(data.channels.map((c) => c.channel)).toEqual(["ch1", "ch3"]);
    expect(data._hiddenDisabled).toBe(1);
  });

  it("does not add _hiddenDisabled when no items are filtered", async () => {
    apiRequestMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        channels: [
          { channel: "ch1", name: "Active", state: "LIVE" },
        ],
      },
    });
    const res = await executeTypedTool(
      "list_channels",
      { merchantId: "aabbccdd00112233" },
      { creds, env },
    );
    expect(res.ok).toBe(true);
    const data = res.data as { channels: unknown[]; _hiddenDisabled?: number };
    expect(data.channels).toHaveLength(1);
    expect(data._hiddenDisabled).toBeUndefined();
  });

  it("does not filter DISABLED items from non-list tools", async () => {
    apiRequestMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        channelInfo: { channel: "aabbccdd00112233", state: "DISABLED" },
      },
    });
    const res = await executeTypedTool(
      "get_entity",
      { parentType: "channel", parentId: "aabbccdd00112233" },
      { creds, env },
    );
    expect(res.ok).toBe(true);
    const data = res.data as { channelInfo: { state: string } };
    expect(data.channelInfo.state).toBe("DISABLED");
  });

  it("redacts API bearer tokens from generated tool responses", async () => {
    apiRequestMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: {
        apiToken: {
          id: "ffffffffffffffffffffffffffffffff",
          alias: "wax_test",
          apiBearerToken: "raw-secret-token",
          state: "ACTIVE",
        },
      },
    });

    const res = await executeTypedTool(
      "create_api_token",
      { merchantId: "merchant-1" },
      { creds, env },
    );

    expect(res.ok).toBe(true);
    expect(JSON.stringify(res.data)).not.toContain("raw-secret-token");
    expect(JSON.stringify(res.data)).toContain("[redacted]");
    expect(apiRequestMock).toHaveBeenCalledTimes(3);
    expect(apiRequestMock.mock.calls[1][2].path).toBe("/apiTokens/ffffffffffffffffffffffffffffffff/suspend");
    expect(apiRequestMock.mock.calls[2][2].path).toBe("/apiTokens/ffffffffffffffffffffffffffffffff");
    expect((res.data as Record<string, unknown>)._temporaryTokenDeleted).toBe(true);
  });
});
