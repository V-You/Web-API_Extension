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
      errorKind: "precheck_failed",
      error: "Workflow preflight found contract violations:\n- sdk.entities.createChannel: Unknown SDK member",
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
    expect(result.assistantText).toMatch(/do not switch to per-action write tools/i);
    expect(result.toolEvents).toHaveLength(1);
  });
});
