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

import {
  CHAT_AUTOMATION_MODE_KEY,
  CHAT_ACCESS_TOKEN_CONTROL_KEY,
  CHAT_RENDER_MARKDOWN_KEY,
  CHAT_SHOW_TOOL_TRACES_KEY,
  CHAT_WRITE_TOOLS_KEY,
  isChatAccessTokenControlEnabled,
  isChatAutomationModeEnabled,
  isChatRenderMarkdownEnabled,
  isChatShowToolTracesEnabled,
  isChatWriteToolsEnabled,
  setChatAccessTokenControlEnabled,
  setChatAutomationModeEnabled,
  setChatRenderMarkdownEnabled,
  setChatShowToolTracesEnabled,
  setChatWriteToolsEnabled,
} from "./chat-mode";

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

  it("defaults automation mode to disabled", async () => {
    expect(await isChatAutomationModeEnabled()).toBe(false);
  });

  it("requires write mode before enabling accessToken control", async () => {
    await expect(setChatAccessTokenControlEnabled(true)).rejects.toThrow("Enable write tools");
    expect(sessionStore[CHAT_ACCESS_TOKEN_CONTROL_KEY]).toBeUndefined();
  });

  it("stores accessToken control once write mode is enabled", async () => {
    await setChatWriteToolsEnabled(true);
    await setChatAccessTokenControlEnabled(true);

    expect(sessionStore[CHAT_ACCESS_TOKEN_CONTROL_KEY]).toBe(true);
    expect(await isChatAccessTokenControlEnabled()).toBe(true);
  });

  it("requires write mode before enabling automation mode", async () => {
    await expect(setChatAutomationModeEnabled(true)).rejects.toThrow("Enable write tools");
    expect(sessionStore[CHAT_AUTOMATION_MODE_KEY]).toBeUndefined();
  });

  it("stores automation mode in session storage once write mode is enabled", async () => {
    await setChatWriteToolsEnabled(true);
    await setChatAutomationModeEnabled(true);

    expect(sessionStore[CHAT_AUTOMATION_MODE_KEY]).toBe(true);
    expect(await isChatAutomationModeEnabled()).toBe(true);
  });

  it("disables automation mode when write mode is disabled", async () => {
    await setChatWriteToolsEnabled(true);
    await setChatAutomationModeEnabled(true);
    await setChatWriteToolsEnabled(false);

    expect(sessionStore[CHAT_WRITE_TOOLS_KEY]).toBe(false);
    expect(sessionStore[CHAT_AUTOMATION_MODE_KEY]).toBe(false);
    expect(sessionStore[CHAT_ACCESS_TOKEN_CONTROL_KEY]).toBe(false);
    expect(await isChatAutomationModeEnabled()).toBe(false);
    expect(await isChatAccessTokenControlEnabled()).toBe(false);
  });

  it("hides tool traces by default", async () => {
    expect(await isChatShowToolTracesEnabled()).toBe(false);
  });

  it("stores the tool trace visibility toggle in session storage", async () => {
    await setChatShowToolTracesEnabled(true);

    expect(sessionStore[CHAT_SHOW_TOOL_TRACES_KEY]).toBe(true);
    expect(await isChatShowToolTracesEnabled()).toBe(true);
  });

  it("renders markdown by default", async () => {
    expect(await isChatRenderMarkdownEnabled()).toBe(true);
  });

  it("stores the markdown rendering toggle in session storage", async () => {
    await setChatRenderMarkdownEnabled(false);

    expect(sessionStore[CHAT_RENDER_MARKDOWN_KEY]).toBe(false);
    expect(await isChatRenderMarkdownEnabled()).toBe(false);
  });
});