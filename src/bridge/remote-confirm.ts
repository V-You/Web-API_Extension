import type { ConfirmChoice, PendingConfirmation, WritePreview } from "./confirm-bridge";

export const SIDEPANEL_CONFIRM_READY_KEY = "sidepanel:confirm-ready";
export const REMOTE_CONFIRM_REQUEST_KEY = "remote-confirm:request";
export const REMOTE_CONFIRM_RESPONSE_KEY = "remote-confirm:response";

export interface RemoteConfirmRequest extends PendingConfirmation {
  requestId: string;
  createdAt: number;
}

export interface RemoteConfirmResponse {
  requestId: string;
  choice: ConfirmChoice;
  respondedAt: number;
}

export async function setSidePanelConfirmReady(ready: boolean): Promise<void> {
  if (ready) {
    await chrome.storage.session.set({ [SIDEPANEL_CONFIRM_READY_KEY]: true });
    return;
  }
  await chrome.storage.session.remove(SIDEPANEL_CONFIRM_READY_KEY);
}

export async function isSidePanelConfirmReady(): Promise<boolean> {
  const result = await chrome.storage.session.get(SIDEPANEL_CONFIRM_READY_KEY);
  return result[SIDEPANEL_CONFIRM_READY_KEY] === true;
}

export async function setRemoteConfirmRequest(request: RemoteConfirmRequest | null): Promise<void> {
  if (!request) {
    await chrome.storage.session.remove(REMOTE_CONFIRM_REQUEST_KEY);
    return;
  }
  await chrome.storage.session.set({ [REMOTE_CONFIRM_REQUEST_KEY]: request });
}

export async function getRemoteConfirmRequest(): Promise<RemoteConfirmRequest | null> {
  const result = await chrome.storage.session.get(REMOTE_CONFIRM_REQUEST_KEY);
  return (result[REMOTE_CONFIRM_REQUEST_KEY] as RemoteConfirmRequest | undefined) ?? null;
}

export async function clearRemoteConfirmState(): Promise<void> {
  await chrome.storage.session.remove([REMOTE_CONFIRM_REQUEST_KEY, REMOTE_CONFIRM_RESPONSE_KEY]);
}

export async function sendRemoteConfirmResponse(requestId: string, choice: ConfirmChoice): Promise<void> {
  const response: RemoteConfirmResponse = {
    requestId,
    choice,
    respondedAt: Date.now(),
  };
  await chrome.storage.session.set({ [REMOTE_CONFIRM_RESPONSE_KEY]: response });
}

export function subscribeRemoteConfirmRequest(listener: () => void): () => void {
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== "session") return;
    if (changes[REMOTE_CONFIRM_REQUEST_KEY]) {
      listener();
    }
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}

export async function waitForRemoteConfirmResponse(
  requestId: string,
  timeoutMs = 300000,
): Promise<ConfirmChoice | null> {
  const existing = await chrome.storage.session.get(REMOTE_CONFIRM_RESPONSE_KEY);
  const initial = existing[REMOTE_CONFIRM_RESPONSE_KEY] as RemoteConfirmResponse | undefined;
  if (initial?.requestId === requestId) {
    return initial.choice;
  }

  return new Promise<ConfirmChoice | null>((resolve) => {
    let settled = false;
    const finish = (choice: ConfirmChoice | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(onChanged);
      resolve(choice);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "session") return;
      const next = changes[REMOTE_CONFIRM_RESPONSE_KEY]?.newValue as RemoteConfirmResponse | undefined;
      if (!next || next.requestId !== requestId) return;
      finish(next.choice);
    };

    chrome.storage.onChanged.addListener(onChanged);
  });
}

export function buildRemoteConfirmRequest(
  preview: WritePreview,
  hasScope = false,
): RemoteConfirmRequest {
  return {
    requestId: crypto.randomUUID(),
    preview,
    hasScope,
    createdAt: Date.now(),
  };
}