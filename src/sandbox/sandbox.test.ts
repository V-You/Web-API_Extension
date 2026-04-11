import { beforeEach, describe, expect, it, vi } from "vitest";

const { beginScopeMock, buildSdkFacadeMock, endScopeMock } = vi.hoisted(() => ({
  beginScopeMock: vi.fn(),
  buildSdkFacadeMock: vi.fn(),
  endScopeMock: vi.fn(),
}));

vi.mock("./sdk-facade", () => ({
  buildSdkFacade: buildSdkFacadeMock,
}));

vi.mock("../bridge/confirm-bridge", () => ({
  beginScope: beginScopeMock,
  endScope: endScopeMock,
}));

import { compileSandboxScript, runSandbox } from "./sandbox";

const creds = {
  baseUrl: "https://example.test/api",
  username: "user",
  password: "pass",
};

describe("sandbox compilation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildSdkFacadeMock.mockReturnValue({});
  });

  it("transpiles TypeScript syntax with the parser-backed path", async () => {
    const result = await compileSandboxScript(`
type Row = { id: string };
interface Payload {
  rows: Row[];
}
const payload: Payload = { rows: [{ id: "1" }] };
const first = payload.rows[0] as Row;
results.push(first.id);
`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.jsCode).not.toContain("type Row");
    expect(result.jsCode).not.toContain("interface Payload");
    expect(result.jsCode).not.toContain(" as Row");
    expect(result.jsCode).toContain('results.push(first.id);');
  });

  it("rejects module syntax and forbidden globals", async () => {
    const result = await compileSandboxScript(`
import { readFileSync } from "fs";
await fetch("https://example.test");
`);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected the sandbox script to be rejected.");
    }

    expect(result.error).toContain("Module imports are not allowed");
    expect(result.error).toContain("Direct fetch() calls are not allowed");
  });
});

describe("sandbox execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildSdkFacadeMock.mockReturnValue({});
  });

  it("times out long-running scripts", async () => {
    const result = await runSandbox({
      script: "await sleep(25);",
      creds,
      env: "uat",
      timeoutMs: 5,
    });

    expect(result.status).toBe("timeout");
    expect(result.error).toContain("Script timed out");
    expect(beginScopeMock).toHaveBeenCalledTimes(1);
    expect(endScopeMock).toHaveBeenCalledTimes(1);
  });

  it("reports cancellation when the abort signal trips", async () => {
    const controller = new AbortController();
    const pending = runSandbox({
      script: "await sleep(50);",
      creds,
      env: "uat",
      timeoutMs: 0,
      abortSignal: controller.signal,
    });

    controller.abort();
    const result = await pending;

    expect(result.status).toBe("timeout");
    expect(result.error).toBe("Script was cancelled");
  });

  it("returns recorded writes from sdk-backed script execution", async () => {
    buildSdkFacadeMock.mockImplementation((_creds: unknown, _env: unknown, writes: Array<Record<string, unknown>>) => ({
      mutate: async () => {
        writes.push({
          tool: "test_tool",
          action: "mutate",
          entityId: "merchant-1",
          entityType: "merchant",
          params: { key: "value" },
          timestamp: "2026-04-05T00:00:00.000Z",
        });
        return "ok";
      },
    }));

    const result = await runSandbox({
      script: "results.push(await sdk.mutate());",
      creds,
      env: "uat",
      timeoutMs: 100,
    });

    expect(result.status).toBe("completed");
    expect(result.results).toEqual(["ok"]);
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0]).toMatchObject({
      tool: "test_tool",
      action: "mutate",
      entityId: "merchant-1",
    });
  });
});