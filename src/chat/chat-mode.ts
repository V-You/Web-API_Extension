export const CHAT_WRITE_TOOLS_KEY = "chat:writeToolsEnabled";
export const CHAT_SHOW_TOOL_TRACES_KEY = "chat:showToolTraces";
export const CHAT_RENDER_MARKDOWN_KEY = "chat:renderMarkdown";

export async function isChatWriteToolsEnabled(): Promise<boolean> {
  const result = await chrome.storage.session.get(CHAT_WRITE_TOOLS_KEY);
  return result[CHAT_WRITE_TOOLS_KEY] === true;
}

export async function setChatWriteToolsEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.session.set({
    [CHAT_WRITE_TOOLS_KEY]: enabled,
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