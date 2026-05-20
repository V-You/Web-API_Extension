import type { EntityType } from "../lib/entity-types";

export type ChatContextSource = "url" | "anchor" | "script" | "form";
export type ChatContextEvidenceSource = ChatContextSource | "api" | "hierarchy" | "manual";

export const CHAT_CONTEXT_PACKET_SCHEMA_VERSION = 1;

export interface ChatContextParentEntry {
  entityType: EntityType;
  entityId: string;
  entityName?: string;
  source: ChatContextEvidenceSource | "inferred";
  confidence: number;
}

export interface ChatContextEvidence {
  field: string;
  value: string;
  source: ChatContextEvidenceSource;
  confidence: number;
}

export interface ChatContextRoute {
  url: string;
  query: Record<string, string>;
  section?: string;
}

export interface ChatContextPacket {
  schemaVersion: typeof CHAT_CONTEXT_PACKET_SCHEMA_VERSION;
  tabId: number;
  frameId: number;
  timestamp: number;
  current: {
    entityId: string;
    entityType: EntityType;
    entityName?: string;
    section?: string;
  };
  ids: Partial<Record<`${EntityType}Id`, string>>;
  parentChain?: ChatContextParentEntry[];
  route?: ChatContextRoute;
  contextEvidence: ChatContextEvidence[];
  freshness: {
    detectedAt: number;
    apiVerifiedAt?: number;
  };
  confidence: number;
}

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
  packet?: ChatContextPacket;
  ids?: Partial<Record<`${EntityType}Id`, string>>;
  parentChain?: ChatContextParentEntry[];
  route?: ChatContextRoute;
  contextEvidence?: ChatContextEvidence[];
  apiVerifiedAt?: number;
}

const KEY_PREFIX = "chat:context:";
const BIP_URL_RE = /^https:\/\/eu-(test|prod)\.oppwa\.com\//i;
const ENTITY_DEPTH: Record<EntityType, number> = {
  psp: 0,
  division: 1,
  merchant: 2,
  channel: 3,
};

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
  const ids = pruneIdsForCurrentEntity(
    { ...(current?.ids ?? {}), ...(incoming.ids ?? {}) },
    incoming.entityType,
    incoming.entityId,
  );
  const parentChain = mergeParentChain(current?.parentChain, incoming.parentChain);
  const contextEvidence = mergeEvidence(current?.contextEvidence, incoming.contextEvidence);
  const route = incoming.route ?? current?.route;
  const apiVerifiedAt = incoming.apiVerifiedAt ?? current?.apiVerifiedAt;

  return {
    ...incoming,
    ...(incoming.entityName ? {} : current?.entityName ? { entityName: current.entityName } : {}),
    ...(incoming.section ? {} : current?.section ? { section: current.section } : {}),
    ...(Object.keys(ids).length > 0 ? { ids } : {}),
    ...(parentChain ? { parentChain } : {}),
    ...(route ? { route } : {}),
    ...(contextEvidence ? { contextEvidence } : {}),
    ...(apiVerifiedAt ? { apiVerifiedAt } : {}),
  };
}

function pruneIdsForCurrentEntity(
  ids: Partial<Record<`${EntityType}Id`, string>>,
  entityType: EntityType,
  entityId: string,
): Partial<Record<`${EntityType}Id`, string>> {
  const maxDepth = ENTITY_DEPTH[entityType];
  const pruned: Partial<Record<`${EntityType}Id`, string>> = {};
  for (const type of Object.keys(ENTITY_DEPTH) as EntityType[]) {
    if (ENTITY_DEPTH[type] > maxDepth) continue;
    const key = `${type}Id` as `${EntityType}Id`;
    const value = ids[key];
    if (typeof value === "string" && value.trim()) pruned[key] = value;
  }
  pruned[`${entityType}Id` as `${EntityType}Id`] = entityId;
  return pruned;
}

function mergeParentChain(
  current: ChatContextParentEntry[] | undefined,
  incoming: ChatContextParentEntry[] | undefined,
): ChatContextParentEntry[] | undefined {
  const byKey = new Map<string, ChatContextParentEntry>();
  for (const entry of current ?? []) byKey.set(`${entry.entityType}:${entry.entityId}`, entry);
  for (const entry of incoming ?? []) byKey.set(`${entry.entityType}:${entry.entityId}`, entry);
  return byKey.size > 0 ? Array.from(byKey.values()) : undefined;
}

function mergeEvidence(
  current: ChatContextEvidence[] | undefined,
  incoming: ChatContextEvidence[] | undefined,
): ChatContextEvidence[] | undefined {
  const byKey = new Map<string, ChatContextEvidence>();
  for (const entry of current ?? []) byKey.set(`${entry.field}:${entry.value}:${entry.source}`, entry);
  for (const entry of incoming ?? []) byKey.set(`${entry.field}:${entry.value}:${entry.source}`, entry);
  return byKey.size > 0 ? Array.from(byKey.values()) : undefined;
}

export function buildChatContextPacket(record: ChatContextRecord): ChatContextPacket {
  const ids = pruneIdsForCurrentEntity(record.ids ?? {}, record.entityType, record.entityId);
  const contextEvidence = record.contextEvidence ?? [];

  return {
    schemaVersion: CHAT_CONTEXT_PACKET_SCHEMA_VERSION,
    tabId: record.tabId,
    frameId: record.frameId,
    timestamp: record.timestamp,
    current: {
      entityId: record.entityId,
      entityType: record.entityType,
      ...(record.entityName ? { entityName: record.entityName } : {}),
      ...(record.section ? { section: record.section } : {}),
    },
    ids,
    ...(record.parentChain?.length ? { parentChain: record.parentChain } : {}),
    ...(record.route ? { route: record.route } : {}),
    contextEvidence,
    freshness: {
      detectedAt: record.timestamp,
      ...(record.apiVerifiedAt ? { apiVerifiedAt: record.apiVerifiedAt } : {}),
    },
    confidence: record.confidence,
  };
}

export function normalizeChatContextRecord(record: ChatContextRecord): ChatContextRecord {
  const normalized = {
    ...record,
    ids: pruneIdsForCurrentEntity(record.ids ?? {}, record.entityType, record.entityId),
  };
  return {
    ...normalized,
    packet: buildChatContextPacket(normalized),
  };
}

export async function upsertChatContext(record: ChatContextRecord): Promise<ChatContextRecord> {
  const key = getChatContextStorageKey(record.tabId);
  const result = await chrome.storage.session.get(key);
  const current = (result[key] as ChatContextRecord | undefined) ?? null;

  if (!shouldReplaceChatContext(current, record)) {
    return current ?? record;
  }

  const merged = normalizeChatContextRecord(mergeChatContext(current, record));
  await chrome.storage.session.set({ [key]: merged });
  return merged;
}

export async function getChatContext(tabId: number): Promise<ChatContextRecord | null> {
  const key = getChatContextStorageKey(tabId);
  const result = await chrome.storage.session.get(key);
  const record = (result[key] as ChatContextRecord | undefined) ?? null;
  if (!record) return null;
  if (record.packet && record.packet.schemaVersion !== CHAT_CONTEXT_PACKET_SCHEMA_VERSION) {
    await clearChatContext(tabId);
    return null;
  }
  return normalizeChatContextRecord(record);
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

export function contextPacketFor(record: ChatContextRecord | null): ChatContextPacket | null {
  if (!record) return null;
  return record.packet ?? buildChatContextPacket(normalizeChatContextRecord(record));
}

export function resolveChannelMerchantFromContext(
  record: ChatContextRecord | ChatContextPacket | null,
): { channelId: string; merchantId?: string; provenance?: string; confidence: number } | null {
  if (!record) return null;
  const packet = "current" in record ? record : contextPacketFor(record);
  if (!packet) return null;
  const channelId = packet.ids.channelId ?? (packet.current.entityType === "channel" ? packet.current.entityId : undefined);
  if (!channelId) return null;

  const merchantFromIds = packet.ids.merchantId;
  if (merchantFromIds) {
    return {
      channelId,
      merchantId: merchantFromIds,
      provenance: "Merchant derived from current Channel context.",
      confidence: packet.confidence,
    };
  }

  const merchantParent = packet.parentChain?.find((entry) => entry.entityType === "merchant");
  if (merchantParent) {
    return {
      channelId,
      merchantId: merchantParent.entityId,
      provenance: `Merchant derived from ${merchantParent.source} parent context.`,
      confidence: Math.min(packet.confidence, merchantParent.confidence),
    };
  }

  return { channelId, confidence: packet.confidence };
}