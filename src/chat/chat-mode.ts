export const CHAT_WRITE_TOOLS_KEY = "chat:writeToolsEnabled";
export const CHAT_SHOW_TOOL_TRACES_KEY = "chat:showToolTraces";

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