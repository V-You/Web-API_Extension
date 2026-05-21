import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeManageEntityMock, executeTypedToolMock } = vi.hoisted(() => ({
  executeManageEntityMock: vi.fn(),
  executeTypedToolMock: vi.fn(),
}));

vi.mock("../tools/manage-entity", () => ({
  executeManageEntity: executeManageEntityMock,
}));

vi.mock("../tools/adapter", () => ({
  executeTypedTool: executeTypedToolMock,
}));

import { createWorkflowEntityNamespace, type WorkflowWritePreview } from "./workflow-entity-namespace";
import type { ApiCredentials, Environment } from "../lib/types";

const creds: ApiCredentials = { username: "u", password: "p" } as ApiCredentials;
const env: Environment = "uat" as Environment;

describe("createWorkflowEntityNamespace", () => {
  beforeEach(() => {
    executeManageEntityMock.mockReset();
    executeManageEntityMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    executeTypedToolMock.mockReset();
    executeTypedToolMock.mockResolvedValue({ ok: true, status: 200, data: { id: "new" } });
  });

  it("routes sandbox-style create through typed tools after beforeWrite", async () => {
    const previews: WorkflowWritePreview[] = [];
    const entities = createWorkflowEntityNamespace({
      creds,
      env,
      writeTransport: "typedTool",
      beforeWrite: async (preview) => { previews.push(preview); },
    });

    await entities.create("merchant", "m-1", "channel", { name: "Germany" });

    expect(previews).toEqual([
      expect.objectContaining({
        tool: "manage_entity",
        action: "create",
        method: "POST",
        entityId: "m-1",
        entityType: "merchant",
        params: { childType: "channel", fields: { name: "Germany" } },
      }),
    ]);
    expect(executeTypedToolMock).toHaveBeenCalledWith(
      "create_channel",
      { parentType: "merchant", parentId: "m-1", name: "Germany" },
      expect.objectContaining({ creds, env, confirm: true }),
    );
    expect(executeManageEntityMock).not.toHaveBeenCalled();
  });

  it("routes SW-style delete through the internal handler after beforeWrite", async () => {
    const previews: WorkflowWritePreview[] = [];
    const entities = createWorkflowEntityNamespace({
      creds,
      env,
      writeTransport: "internalHandler",
      beforeWrite: async (preview) => { previews.push(preview); },
    });

    await entities.delete("channel", "c-1");

    expect(previews).toEqual([
      expect.objectContaining({
        tool: "manage_entity",
        action: "delete",
        method: "DELETE",
        entityId: "c-1",
        entityType: "channel",
      }),
    ]);
    expect(executeManageEntityMock).toHaveBeenCalledWith(
      { action: "delete", entityType: "channel", entityId: "c-1" },
      creds,
      env,
    );
    expect(executeTypedToolMock).not.toHaveBeenCalled();
  });

  it("returns planned results without executing transport in plan-only mode", async () => {
    const entities = createWorkflowEntityNamespace({
      creds,
      env,
      writeTransport: "typedTool",
      planOnlyWrites: true,
      beforeWrite: async () => undefined,
    });

    await expect(entities.edit("merchant", "m-1", { name: "New" })).resolves.toEqual({
      ok: true,
      status: 0,
      data: {
        planned: true,
        tool: "edit_entity",
        params: { parentType: "merchant", parentId: "m-1", name: "New" },
      },
    });
    expect(executeTypedToolMock).not.toHaveBeenCalled();
    expect(executeManageEntityMock).not.toHaveBeenCalled();
  });

  it("normalizes listChildren channel IDs to id", async () => {
    executeManageEntityMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [{ channel: "c-1", name: "First" }, { id: "c-2", name: "Second" }],
    });
    const entities = createWorkflowEntityNamespace({
      creds,
      env,
      writeTransport: "internalHandler",
      beforeWrite: async () => undefined,
    });

    await expect(entities.listChildren("merchant", "m-1", "channel")).resolves.toEqual([
      { channel: "c-1", name: "First", id: "c-1" },
      { id: "c-2", name: "Second" },
    ]);
  });
});
