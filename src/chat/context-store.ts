import type { EntityType } from "../lib/entity-types";

export type ChatContextSource = "url" | "anchor" | "script" | "form";

export interface ChatContextRecord {
  tabId: number;
  frameId: number;
  timestamp: number;
  entityId: string;
  entityType: EntityType;
  confidence: number;
  source: ChatContextSource;
  entityName?: string;
  section?: string;
}

const KEY_PREFIX = "chat:context:";
const BIP_URL_RE = /^https:\/\/eu-(test|prod)\.oppwa\.com\//i;

export function getChatContextStorageKey(tabId: number): string {
  return `${KEY_PREFIX}${tabId}`;
}

export function shouldReplaceChatContext(
  current: ChatContextRecord | null,
  incoming: ChatContextRecord,
): boolean {
  if (!current) return true;
  if (incoming.confidence > current.confidence) return true;
  if (incoming.confidence < current.confidence) return false;
  return incoming.timestamp >= current.timestamp;
}

export function mergeChatContext(
  current: ChatContextRecord | null,
  incoming: ChatContextRecord,
): ChatContextRecord {
  return {
    ...incoming,
    ...(incoming.entityName ? {} : current?.entityName ? { entityName: current.entityName } : {}),
    ...(incoming.section ? {} : current?.section ? { section: current.section } : {}),
  };
}

export async function upsertChatContext(record: ChatContextRecord): Promise<ChatContextRecord> {
  const key = getChatContextStorageKey(record.tabId);
  const result = await chrome.storage.session.get(key);
  const current = (result[key] as ChatContextRecord | undefined) ?? null;

  if (!shouldReplaceChatContext(current, record)) {
    return current ?? record;
  }

  const merged = mergeChatContext(current, record);
  await chrome.storage.session.set({ [key]: merged });
  return merged;
}

export async function getChatContext(tabId: number): Promise<ChatContextRecord | null> {
  const key = getChatContextStorageKey(tabId);
  const result = await chrome.storage.session.get(key);
  return (result[key] as ChatContextRecord) ?? null;
}

export async function clearChatContext(tabId: number): Promise<void> {
  await chrome.storage.session.remove(getChatContextStorageKey(tabId));
}

export async function getActiveBipTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  for (const tab of tabs) {
    if (typeof tab.id === "number" && BIP_URL_RE.test(tab.url ?? "")) {
      return tab.id;
    }
  }

  return null;
}

export async function getActiveChatContext(): Promise<ChatContextRecord | null> {
  const tabId = await getActiveBipTabId();
  if (tabId === null) return null;
  return getChatContext(tabId);
}