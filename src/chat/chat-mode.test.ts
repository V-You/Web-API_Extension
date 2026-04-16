import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionStore: Record<string, unknown> = {};

vi.stubGlobal("chrome", {
  storage: {
    session: {
      get: vi.fn(async (keys: string | string[]) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of ks) result[key] = sessionStore[key];
        return result;
      }),
      set: vi.fn(async (data: Record<string, unknown>) => Object.assign(sessionStore, data)),
      remove: vi.fn(async (keys: string | string[]) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        for (const key of ks) delete sessionStore[key];
      }),
    },
  },
});

import { CHAT_WRITE_TOOLS_KEY, isChatWriteToolsEnabled, setChatWriteToolsEnabled } from "./chat-mode";

describe("chat mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  });

  it("defaults to safe mode", async () => {
    expect(await isChatWriteToolsEnabled()).toBe(false);
  });

  it("stores write opt-in in session storage", async () => {
    await setChatWriteToolsEnabled(true);

    expect(sessionStore[CHAT_WRITE_TOOLS_KEY]).toBe(true);
    expect(await isChatWriteToolsEnabled()).toBe(true);
  });
});