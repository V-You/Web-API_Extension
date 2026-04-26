import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock("../lib/api-client", () => ({
  apiRequest: apiRequestMock,
}));

vi.mock("../sdk/riro-tree", () => ({
  allSettings: () => [
    {
      flatKey: "setting:key",
      sdkPath: "setting.key",
      bipPath: "Setting > Key",
      defaultValue: "false",
    },
  ],
  getByKey: (key: string) => key === "setting:key" ? { defaultValue: "false" } : null,
}));

import { executeManageSettings } from "./manage-settings";

describe("manage_settings", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("returns an explicit channel setting as the effective value", async () => {
    apiRequestMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { key: "setting:key", value: "true" },
    });

    const result = await executeManageSettings(
      { action: "get", entityType: "channel", entityId: "ch-1", key: "setting:key" },
      {} as never,
      "uat" as never,
    );

    expect(result).toEqual({
      key: "setting:key",
      entityId: "ch-1",
      entityType: "channel",
      value: "true",
      effectiveValue: "true",
      source: "explicit",
      sourceEntityId: "ch-1",
      sourceEntityType: "channel",
      defaultValue: "false",
      resolutionPath: [
        { entityId: "ch-1", entityType: "channel", readable: true, value: "true" },
      ],
    });
  });

  it("walks from channel to merchant when the channel value is empty", async () => {
    apiRequestMock.mockImplementation(async (_creds, _env, request: { path: string }) => {
      if (request.path === "/channels/ch-1/setting?key=setting%3Akey") {
        return { ok: true, status: 200, data: { key: "setting:key", value: "" } };
      }
      if (request.path === "/channels/ch-1") {
        return { ok: true, status: 200, data: { channelInfo: { channel: "ch-1", sender: "mer-1" } } };
      }
      if (request.path === "/merchants/mer-1/setting?key=setting%3Akey") {
        return { ok: true, status: 200, data: { key: "setting:key", value: "true" } };
      }
      throw new Error(`Unexpected path: ${request.path}`);
    });

    const result = await executeManageSettings(
      { action: "get", entityType: "channel", entityId: "ch-1", key: "setting:key" },
      {} as never,
      "uat" as never,
    );

    expect(result).toMatchObject({
      key: "setting:key",
      entityId: "ch-1",
      entityType: "channel",
      value: "",
      effectiveValue: "true",
      source: "inherited",
      sourceEntityId: "mer-1",
      sourceEntityType: "merchant",
      defaultValue: "false",
    });
  });

  it("reports unknown effective value when resolution reaches division level", async () => {
    apiRequestMock.mockImplementation(async (_creds, _env, request: { path: string }) => {
      if (request.path === "/merchants/mer-1/setting?key=setting%3Akey") {
        return { ok: true, status: 200, data: { key: "setting:key", value: "" } };
      }
      if (request.path === "/merchants/mer-1") {
        return { ok: true, status: 200, data: { merchantInfo: { id: "mer-1", divisionId: "div-1" } } };
      }
      throw new Error(`Unexpected path: ${request.path}`);
    });

    const result = await executeManageSettings(
      { action: "get", entityType: "merchant", entityId: "mer-1", key: "setting:key" },
      {} as never,
      "uat" as never,
    );

    expect(result).toEqual({
      key: "setting:key",
      entityId: "mer-1",
      entityType: "merchant",
      value: "",
      effectiveValue: null,
      source: "unknown",
      defaultValue: "false",
      resolutionPath: [
        { entityId: "mer-1", entityType: "merchant", readable: true, value: "" },
        { entityId: "div-1", entityType: "division", readable: false },
      ],
      apiLimit: "GET /setting is unavailable at division and PSP level.",
    });
  });

  it("uses effective values for query-based list_non_default", async () => {
    apiRequestMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { key: "setting:key", value: "true" },
    });

    const result = await executeManageSettings(
      { action: "list_non_default", entityType: "channel", entityId: "ch-1", query: "setting" },
      {} as never,
      "uat" as never,
    );

    expect(result).toEqual({
      entityId: "ch-1",
      entityType: "channel",
      checkedKeys: 1,
      capped: false,
      totalMatched: 1,
      nonDefaultCount: 1,
      nonDefault: [
        {
          key: "setting:key",
          currentValue: "true",
          defaultValue: "false",
          source: "explicit",
          sourceEntityId: "ch-1",
          sourceEntityType: "channel",
        },
      ],
    });
  });
});
