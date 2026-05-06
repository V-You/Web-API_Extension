import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

import { executeManageEntity } from "./manage-entity";
import { apiRequest } from "../lib/api-client";

const apiRequestMock = vi.mocked(apiRequest);

describe("manage_entity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes parent information on get responses", async () => {
    apiRequestMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: "channel-1",
        sender: "merchant-1",
        name: "Channel One",
      },
    });

    const result = await executeManageEntity(
      {
        action: "get",
        entityId: "channel-1",
        entityType: "channel",
      },
      {} as never,
      "uat" as never,
    );

    expect(apiRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      "uat",
      { path: "/channels/channel-1" },
      {
        eventType: "get_entity",
        entityId: "channel-1",
        entityType: "channel",
      },
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        id: "channel-1",
        sender: "merchant-1",
        name: "Channel One",
        _parent: {
          type: "merchant",
          id: "merchant-1",
        },
      },
    });
  });
});