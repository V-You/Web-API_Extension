import { describe, expect, it } from "vitest";

import { buildChatContextPacket, getChatContextStorageKey, mergeChatContext, resolveChannelMerchantFromContext, shouldReplaceChatContext, type ChatContextRecord } from "./context-store";

describe("chat context store", () => {
  it("builds deterministic session storage keys", () => {
    expect(getChatContextStorageKey(42)).toBe("chat:context:42");
  });

  it("prefers higher-confidence context records", () => {
    const current: ChatContextRecord = {
      tabId: 7,
      frameId: 0,
      timestamp: 100,
      entityId: "merchant-1",
      entityType: "merchant",
      confidence: 60,
      source: "anchor",
    };

    const incoming: ChatContextRecord = {
      ...current,
      timestamp: 90,
      confidence: 100,
      source: "url",
    };

    expect(shouldReplaceChatContext(current, incoming)).toBe(true);
  });

  it("uses recency as the tiebreaker when confidence is equal", () => {
    const current: ChatContextRecord = {
      tabId: 7,
      frameId: 0,
      timestamp: 100,
      entityId: "merchant-1",
      entityType: "merchant",
      confidence: 100,
      source: "url",
    };

    const olderIncoming: ChatContextRecord = {
      ...current,
      timestamp: 99,
    };
    const newerIncoming: ChatContextRecord = {
      ...current,
      timestamp: 101,
    };

    expect(shouldReplaceChatContext(current, olderIncoming)).toBe(false);
    expect(shouldReplaceChatContext(current, newerIncoming)).toBe(true);
  });

  it("preserves richer optional context fields when a newer record omits them", () => {
    const current: ChatContextRecord = {
      tabId: 7,
      frameId: 0,
      timestamp: 100,
      entityId: "channel-1",
      entityType: "channel",
      confidence: 100,
      source: "url",
      entityName: "Checkout Channel",
      section: "attachedMerchantAccounts",
    };

    const incoming: ChatContextRecord = {
      ...current,
      timestamp: 101,
      source: "anchor",
      entityName: undefined,
      section: undefined,
    };

    expect(mergeChatContext(current, incoming)).toEqual({
      ...incoming,
      entityName: "Checkout Channel",
      section: "attachedMerchantAccounts",
    });
  });

  it("builds a versioned context packet with current and known IDs", () => {
    const record: ChatContextRecord = {
      tabId: 7,
      frameId: 0,
      timestamp: 100,
      entityId: "channel-1",
      entityType: "channel",
      confidence: 100,
      source: "url",
      ids: { merchantId: "merchant-1" },
      contextEvidence: [{ field: "merchantId", value: "merchant-1", source: "url", confidence: 100 }],
    };

    expect(buildChatContextPacket(record)).toMatchObject({
      schemaVersion: 1,
      current: { entityId: "channel-1", entityType: "channel" },
      ids: { channelId: "channel-1", merchantId: "merchant-1" },
      contextEvidence: [{ field: "merchantId", value: "merchant-1", source: "url", confidence: 100 }],
    });
  });

  it("resolves a Channel's Merchant parent without overwriting supplied values", () => {
    const record: ChatContextRecord = {
      tabId: 7,
      frameId: 0,
      timestamp: 100,
      entityId: "channel-1",
      entityType: "channel",
      confidence: 100,
      source: "url",
      ids: { merchantId: "merchant-1" },
    };

    expect(resolveChannelMerchantFromContext(record)).toEqual({
      channelId: "channel-1",
      merchantId: "merchant-1",
      provenance: "Merchant derived from current Channel context.",
      confidence: 100,
    });
  });
});