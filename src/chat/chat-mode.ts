export const CHAT_WRITE_TOOLS_KEY = "chat:writeToolsEnabled";

export async function isChatWriteToolsEnabled(): Promise<boolean> {
  const result = await chrome.storage.session.get(CHAT_WRITE_TOOLS_KEY);
  return result[CHAT_WRITE_TOOLS_KEY] === true;
}

export async function setChatWriteToolsEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.session.set({
    [CHAT_WRITE_TOOLS_KEY]: enabled,
  });
}