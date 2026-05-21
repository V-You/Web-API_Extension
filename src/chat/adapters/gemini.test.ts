import { describe, expect, it, vi, beforeEach } from "vitest";

const { sendToSwMock } = vi.hoisted(() => ({
  sendToSwMock: vi.fn(),
}));

vi.mock("../sw-client", () => ({
  sendToSw: sendToSwMock,
}));

import { runGeminiTurn } from "./gemini";

describe("runGeminiTurn workflow contract failures", () => {
  beforeEach(() => {
    sendToSwMock.mockReset();
  });

  it("stops the tool loop after an execute_workflow precheck failure", async () => {
    sendToSwMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        candidates: [{
          content: {
            role: "model",
            parts: [{
              functionCall: {
                id: "call-1",
                name: "execute_workflow",
                args: { script: "await sdk.entities.createChannel()" },
              },
            }],
          },
        }],
      },
    });

    const executeTool = vi.fn().mockResolvedValue({
      status: "error",
      errorKind: "unknown_sdk_member",
      error: "Workflow preflight found contract violations:\n- sdk.entities.createChannel: Unknown SDK member",
      errorInfo: {
        kind: "unknown_sdk_member",
        message: "Workflow preflight found contract violations:\n- sdk.entities.createChannel: Unknown SDK member",
        suggest: "create",
        fixHint: "Use the workflow SDK reference and replace the unknown method with `create` if it matches the requested operation.",
      },
    });

    const result = await runGeminiTurn({
      apiKey: "key",
      model: "gemini-test",
      history: [],
      userText: "create channels",
      systemPrompt: "system",
      tools: [{ name: "execute_workflow", description: "run", parameters: { type: "object" } }],
      executeTool,
      maxRounds: 5,
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(sendToSwMock).toHaveBeenCalledTimes(1);
    expect(result.assistantText).toMatch(/workflow draft failed SDK contract preflight/i);
    expect(result.assistantText).toMatch(/replace the unknown method with `create`/i);
    expect(result.assistantText).toMatch(/do not switch to per-action write tools/i);
    expect(result.toolEvents).toHaveLength(1);
  });

  it("does not execute a same-response per-action write after a workflow contract failure", async () => {
    sendToSwMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        candidates: [{
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  id: "call-1",
                  name: "execute_workflow",
                  args: { script: "await sdk.entities.createChannel()" },
                },
              },
              {
                functionCall: {
                  id: "call-2",
                  name: "create_channel",
                  args: { parentType: "merchant", parentId: "m1", name: "Germany" },
                },
              },
            ],
          },
        }],
      },
    });

    const executeTool = vi.fn().mockResolvedValueOnce({
      status: "error",
      errorKind: "unknown_sdk_member",
      error: "Workflow preflight found contract violations:\n- sdk.entities.createChannel: Unknown SDK member",
      errorInfo: {
        kind: "unknown_sdk_member",
        message: "Workflow preflight found contract violations:\n- sdk.entities.createChannel: Unknown SDK member",
        suggest: "create",
        fixHint: "Use only methods listed in the workflow SDK reference.",
      },
    });

    const result = await runGeminiTurn({
      apiKey: "key",
      model: "gemini-test",
      history: [],
      userText: "create channels",
      systemPrompt: "system",
      tools: [
        { name: "execute_workflow", description: "run", parameters: { type: "object" } },
        { name: "create_channel", description: "create", parameters: { type: "object" } },
      ],
      executeTool,
      maxRounds: 5,
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith("execute_workflow", { script: "await sdk.entities.createChannel()" });
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0].name).toBe("execute_workflow");
    expect(result.assistantText).toMatch(/do not switch to per-action write tools/i);
  });
});
