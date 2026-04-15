import { beforeEach, describe, expect, it, vi } from "vitest";

const localStore: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of ks) result[key] = localStore[key];
        return result;
      }),
      set: vi.fn(async (data: Record<string, unknown>) => Object.assign(localStore, data)),
      remove: vi.fn(async (keys: string | string[]) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        for (const key of ks) delete localStore[key];
      }),
    },
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

import {
  getLlmProviderSettings,
  hasInvalidLlmProviderSettings,
  saveLlmProviderSettings,
  unlockLlmProviderSettingsWithPin,
} from "./llm-storage";

describe("llm storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(localStore)) delete localStore[key];
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  });

  it("round-trips Gemini settings with the correct PIN", async () => {
    await saveLlmProviderSettings("gemini", { apiKey: "abc", model: "gemini-2.5-flash" }, "123456");
    delete sessionStore["session:llm:gemini"];

    await unlockLlmProviderSettingsWithPin("123456");

    expect(await getLlmProviderSettings("gemini")).toEqual({
      apiKey: "abc",
      model: "gemini-2.5-flash",
    });
    expect(await hasInvalidLlmProviderSettings("gemini")).toBe(false);
  });

  it("clears stale Gemini settings and marks them invalid when decrypt fails", async () => {
    await saveLlmProviderSettings("gemini", { apiKey: "abc", model: "gemini-2.5-flash" }, "oldpin");
    delete sessionStore["session:llm:gemini"];

    await unlockLlmProviderSettingsWithPin("newpin");

    expect(await getLlmProviderSettings("gemini")).toBeNull();
    expect(localStore["llm:gemini"]).toBeUndefined();
    expect(await hasInvalidLlmProviderSettings("gemini")).toBe(true);
  });
});