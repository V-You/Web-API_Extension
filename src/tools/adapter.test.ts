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

  it("bypasses the confirm bridge when confirm=true is passed explicitly", async () => {
    await executeTypedTool(
      "delete_contact",
      { contactId: "c1", confirm: true },
      { creds, env },
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
      { parentType: "division", parentId: "d1", state: "DELETED" },
      { creds, env },
    );
    expect(requestConfirmMock).toHaveBeenCalledTimes(1);
  });

  it("returns ok=false for an unknown tool name", async () => {
    const res = await executeTypedTool("does_not_exist", {}, { creds, env });
    expect(res.ok).toBe(false);
  });
});
