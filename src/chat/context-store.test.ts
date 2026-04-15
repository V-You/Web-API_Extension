import { describe, expect, it } from "vitest";

import { getChatContextStorageKey, shouldReplaceChatContext, type ChatContextRecord } from "./context-store";

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
});