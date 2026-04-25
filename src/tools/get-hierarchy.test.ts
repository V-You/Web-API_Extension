import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock("../lib/api-client", () => ({
  apiRequest: apiRequestMock,
}));

import { executeGetHierarchy } from "./get-hierarchy";

describe("get_hierarchy", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("builds a subtree starting from a division", async () => {
    apiRequestMock.mockImplementation(async (_creds, _env, request: { path: string }) => {
      if (request.path === "/divisions/div-1") {
        return {
          ok: true,
          status: 200,
          data: {
            divisionInfo: {
              id: "div-1",
              name: "Division One",
              pspId: "psp-1",
            },
          },
        };
      }

      if (request.path === "/divisions/div-1/merchants") {
        return {
          ok: true,
          status: 200,
          data: {
            merchants: [
              { merchantId: "mer-1", name: "Merchant One" },
              { merchantId: "mer-disabled", name: "Deleted Merchant", state: "DISABLED" },
            ],
          },
        };
      }

      if (request.path === "/merchants/mer-1/channels") {
        return {
          ok: true,
          status: 200,
          data: {
            channels: [
              { channel: "chn-1", name: "Channel One" },
            ],
          },
        };
      }

      throw new Error(`Unexpected path: ${request.path}`);
    });

    const result = await executeGetHierarchy(
      { entityId: "div-1", entityType: "division", depth: 3 },
      {} as never,
      "uat" as never,
    );

    expect(result).toEqual({
      estimate: {
        rootType: "division",
        rootId: "div-1",
        estimatedDivisions: 0,
        estimatedMerchants: 3,
        estimatedChannels: 6,
        estimatedApiCalls: 5,
        estimatedRuntime: "~1s (1min at 9 req/s)",
      },
      actual: {
        divisions: 0,
        merchants: 1,
        channels: 1,
      },
      _hiddenDisabled: 1,
      tree: {
        id: "div-1",
        type: "division",
        name: "Division One",
        data: {
          id: "div-1",
          name: "Division One",
          pspId: "psp-1",
        },
        children: [
          {
            id: "mer-1",
            type: "merchant",
            name: "Merchant One",
            data: {
              merchantId: "mer-1",
              name: "Merchant One",
            },
            children: [
              {
                id: "chn-1",
                type: "channel",
                name: "Channel One",
                data: {
                  channel: "chn-1",
                  name: "Channel One",
                },
                children: [],
              },
            ],
          },
        ],
      },
    });
  });

  it("still supports flat array child responses", async () => {
    apiRequestMock.mockImplementation(async (_creds, _env, request: { path: string }) => {
      if (request.path === "/divisions/div-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "div-1",
            name: "Division One",
            pspId: "psp-1",
          },
        };
      }

      if (request.path === "/divisions/div-1/merchants") {
        return {
          ok: true,
          status: 200,
          data: [
            { merchantId: "mer-1", name: "Merchant One" },
            { merchantId: "mer-disabled", name: "Deleted Merchant", state: "DISABLED" },
          ],
        };
      }

      if (request.path === "/merchants/mer-1/channels") {
        return {
          ok: true,
          status: 200,
          data: [
            { channel: "chn-1", name: "Channel One" },
          ],
        };
      }

      throw new Error(`Unexpected path: ${request.path}`);
    });

    const result = await executeGetHierarchy(
      { entityId: "div-1", entityType: "division", depth: 3 },
      {} as never,
      "uat" as never,
    );

    expect(result).toEqual({
      estimate: {
        rootType: "division",
        rootId: "div-1",
        estimatedDivisions: 0,
        estimatedMerchants: 3,
        estimatedChannels: 6,
        estimatedApiCalls: 5,
        estimatedRuntime: "~1s (1min at 9 req/s)",
      },
      actual: {
        divisions: 0,
        merchants: 1,
        channels: 1,
      },
      _hiddenDisabled: 1,
      tree: {
        id: "div-1",
        type: "division",
        name: "Division One",
        data: {
          id: "div-1",
          name: "Division One",
          pspId: "psp-1",
        },
        children: [
          {
            id: "mer-1",
            type: "merchant",
            name: "Merchant One",
            data: {
              merchantId: "mer-1",
              name: "Merchant One",
            },
            children: [
              {
                id: "chn-1",
                type: "channel",
                name: "Channel One",
                data: {
                  channel: "chn-1",
                  name: "Channel One",
                },
                children: [],
              },
            ],
          },
        ],
      },
    });
  });

  it("returns a clear error when no root is provided", async () => {
    const result = await executeGetHierarchy({ depth: 2 }, {} as never, "uat" as never);
    expect(result).toEqual({ error: "Provide either pspId or entityId + entityType." });
  });

  it("includes DISABLED descendants when includeDisabled=true", async () => {
    apiRequestMock.mockImplementation(async (_creds, _env, request: { path: string }) => {
      if (request.path === "/divisions/div-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "div-1",
            name: "Division One",
            pspId: "psp-1",
          },
        };
      }

      if (request.path === "/divisions/div-1/merchants") {
        return {
          ok: true,
          status: 200,
          data: {
            merchants: [
              { merchantId: "mer-1", name: "Merchant One", state: "LIVE" },
              { merchantId: "mer-disabled", name: "Deleted Merchant", state: "DISABLED" },
            ],
          },
        };
      }

      if (request.path === "/merchants/mer-1/channels") {
        return {
          ok: true,
          status: 200,
          data: { channels: [] },
        };
      }

      if (request.path === "/merchants/mer-disabled/channels") {
        return {
          ok: true,
          status: 200,
          data: { channels: [] },
        };
      }

      throw new Error(`Unexpected path: ${request.path}`);
    });

    const result = await executeGetHierarchy(
      { entityId: "div-1", entityType: "division", depth: 2, includeDisabled: true },
      {} as never,
      "uat" as never,
    );

    expect(result).toEqual({
      estimate: {
        rootType: "division",
        rootId: "div-1",
        estimatedDivisions: 0,
        estimatedMerchants: 3,
        estimatedChannels: 6,
        estimatedApiCalls: 5,
        estimatedRuntime: "~1s (1min at 9 req/s)",
      },
      actual: {
        divisions: 0,
        merchants: 2,
        channels: 0,
      },
      tree: {
        id: "div-1",
        type: "division",
        name: "Division One",
        data: {
          id: "div-1",
          name: "Division One",
          pspId: "psp-1",
        },
        children: [
          {
            id: "mer-1",
            type: "merchant",
            name: "Merchant One",
            data: {
              merchantId: "mer-1",
              name: "Merchant One",
              state: "LIVE",
            },
            children: [],
          },
          {
            id: "mer-disabled",
            type: "merchant",
            name: "Deleted Merchant",
            data: {
              merchantId: "mer-disabled",
              name: "Deleted Merchant",
              state: "DISABLED",
            },
            children: [],
          },
        ],
      },
    });
  });
});