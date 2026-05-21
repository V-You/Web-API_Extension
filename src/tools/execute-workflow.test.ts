import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeTypedToolMock } = vi.hoisted(() => ({
  executeTypedToolMock: vi.fn(),
}));

vi.mock("./adapter", () => ({
  executeTypedTool: executeTypedToolMock,
  isReadOnlyTool: (toolName: string) => toolName.startsWith("get_") || toolName.startsWith("list_"),
}));

import { executeWorkflow } from "./execute-workflow";

describe("execute_workflow declarative workflow mode", () => {
  beforeEach(() => {
    executeTypedToolMock.mockReset();
    executeTypedToolMock.mockResolvedValue({ ok: true, status: 200, data: { id: "created" } });
  });

  it("records planned writes without executing backend calls", async () => {
    const script = JSON.stringify({
      workflowVersion: 1,
      kind: "tool_calls",
      calls: [
        { tool: "create_contact", params: { parentType: "division", parentId: "div-1", email: "a@example.test" } },
        { tool: "create_contact", params: { parentType: "division", parentId: "div-1", email: "b@example.test" } },
      ],
    });

    const result = await executeWorkflow(
      { script, planOnly: true },
      {} as never,
      "uat" as never,
    );

    expect(executeTypedToolMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "planned",
      writeCount: 2,
      results: [
        { tool: "create_contact", planned: true },
        { tool: "create_contact", planned: true },
      ],
      writes: [
        { tool: "create_contact", action: "create_contact", entityId: "div-1", entityType: "division" },
        { tool: "create_contact", action: "create_contact", entityId: "div-1", entityType: "division" },
      ],
    });
  });

  it("executes declarative calls through the typed adapter after outer confirmation", async () => {
    const script = JSON.stringify({
      calls: [
        { tool: "create_contact", params: { parentType: "division", parentId: "div-1", email: "a@example.test" } },
      ],
    });

    const result = await executeWorkflow(
      { script, autoConfirmWrites: true },
      {} as never,
      "uat" as never,
    );

    expect(executeTypedToolMock).toHaveBeenCalledWith(
      "create_contact",
      { parentType: "division", parentId: "div-1", email: "a@example.test" },
      expect.objectContaining({ confirm: true }),
    );
    expect(result).toMatchObject({
      status: "completed",
      writeCount: 1,
      results: [{ tool: "create_contact", result: { ok: true, status: 200, data: { id: "created" } } }],
    });
  });

  it("rejects freeform planOnly scripts before unsafe evaluation", async () => {
    const result = await executeWorkflow(
      { script: "await sdk.contacts.list('merchant', 'm1');", planOnly: true },
      {} as never,
      "uat" as never,
    );

    expect(result).toMatchObject({
      status: "error",
      writeCount: 0,
    });
    expect("error" in result ? result.error : "").toMatch(/planOnly for freeform workflow scripts/);
    expect(executeTypedToolMock).not.toHaveBeenCalled();
  });

  it("rejects unknown SDK methods in freeform scripts during preflight", async () => {
    const result = await executeWorkflow(
      { script: "await sdk.entities.createChannel('merchant', 'm1', { name: 'Germany' });" },
      {} as never,
      "uat" as never,
    );

    expect(result).toMatchObject({
      status: "error",
      writeCount: 0,
      errorKind: "unknown_sdk_member",
      errorInfo: {
        kind: "unknown_sdk_member",
        suggest: "create",
      },
    });
    expect("errorInfo" in result ? (result.errorInfo as { fixHint?: string }).fixHint : "").toMatch(/workflow SDK reference/);
    expect("error" in result ? result.error : "").toMatch(/Unknown SDK member: `sdk\.entities\.createChannel`/);
    expect(executeTypedToolMock).not.toHaveBeenCalled();
  });
});
