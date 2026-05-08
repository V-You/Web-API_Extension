export const CHAT_WRITE_TOOLS_KEY = "chat:writeToolsEnabled";
export const CHAT_AUTOMATION_MODE_KEY = "chat:automationModeEnabled";
export const CHAT_ACCESS_TOKEN_CONTROL_KEY = "chat:accessTokenControlEnabled";
export const CHAT_SHOW_TOOL_TRACES_KEY = "chat:showToolTraces";
export const CHAT_RENDER_MARKDOWN_KEY = "chat:renderMarkdown";

export async function isChatWriteToolsEnabled(): Promise<boolean> {
  const result = await chrome.storage.session.get(CHAT_WRITE_TOOLS_KEY);
  return result[CHAT_WRITE_TOOLS_KEY] === true;
}

export async function setChatWriteToolsEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await chrome.storage.session.set({
      [CHAT_WRITE_TOOLS_KEY]: true,
    });
    return;
  }

  await chrome.storage.session.set({
    [CHAT_WRITE_TOOLS_KEY]: false,
    [CHAT_AUTOMATION_MODE_KEY]: false,
    [CHAT_ACCESS_TOKEN_CONTROL_KEY]: false,
  });
}

export async function isChatAccessTokenControlEnabled(): Promise<boolean> {
  const result = await chrome.storage.session.get([CHAT_ACCESS_TOKEN_CONTROL_KEY, CHAT_WRITE_TOOLS_KEY]);
  return result[CHAT_WRITE_TOOLS_KEY] === true && result[CHAT_ACCESS_TOKEN_CONTROL_KEY] === true;
}

export async function setChatAccessTokenControlEnabled(enabled: boolean): Promise<void> {
  if (!enabled) {
    await chrome.storage.session.set({
      [CHAT_ACCESS_TOKEN_CONTROL_KEY]: false,
    });
    return;
  }

  const result = await chrome.storage.session.get(CHAT_WRITE_TOOLS_KEY);
  if (result[CHAT_WRITE_TOOLS_KEY] !== true) {
    throw new Error("Enable write tools before enabling accessToken control.");
  }

  await chrome.storage.session.set({
    [CHAT_ACCESS_TOKEN_CONTROL_KEY]: true,
  });
}

export async function isChatAutomationModeEnabled(): Promise<boolean> {
  const result = await chrome.storage.session.get([CHAT_AUTOMATION_MODE_KEY, CHAT_WRITE_TOOLS_KEY]);
  return result[CHAT_WRITE_TOOLS_KEY] === true && result[CHAT_AUTOMATION_MODE_KEY] === true;
}

export async function setChatAutomationModeEnabled(enabled: boolean): Promise<void> {
  if (!enabled) {
    await chrome.storage.session.set({
      [CHAT_AUTOMATION_MODE_KEY]: false,
    });
    return;
  }

  const result = await chrome.storage.session.get(CHAT_WRITE_TOOLS_KEY);
  if (result[CHAT_WRITE_TOOLS_KEY] !== true) {
    throw new Error("Enable write tools before enabling automation mode.");
  }

  await chrome.storage.session.set({
    [CHAT_AUTOMATION_MODE_KEY]: true,
  });
}

export async function isChatShowToolTracesEnabled(): Promise<boolean> {
  const result = await chrome.storage.session.get(CHAT_SHOW_TOOL_TRACES_KEY);
  return result[CHAT_SHOW_TOOL_TRACES_KEY] === true;
}

export async function setChatShowToolTracesEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.session.set({
    [CHAT_SHOW_TOOL_TRACES_KEY]: enabled,
  });
}

export async function isChatRenderMarkdownEnabled(): Promise<boolean> {
  const result = await chrome.storage.session.get(CHAT_RENDER_MARKDOWN_KEY);
  const value = result[CHAT_RENDER_MARKDOWN_KEY];
  return value === undefined ? true : value === true;
}

export async function setChatRenderMarkdownEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.session.set({
    [CHAT_RENDER_MARKDOWN_KEY]: enabled,
  });
}