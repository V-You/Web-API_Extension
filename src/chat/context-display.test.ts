import { describe, expect, it } from "vitest";

import { buildComposerTargetPreview, shouldShowChannelParentTarget, type EffectiveChatContext } from "./context-display";
import type { ChatContextRecord } from "./context-store";

function context(entityType: ChatContextRecord["entityType"], entityId: string): ChatContextRecord {
  return {
    tabId: 1,
    frameId: 0,
    timestamp: 100,
    entityId,
    entityType,
    confidence: 100,
    source: "url",
  };
}

function effective(entityType: EffectiveChatContext["entityType"], entityId: string): EffectiveChatContext {
  return { entityType, entityId, source: "detected" };
}

describe("chat context display", () => {
  it("targets the current Division even if a stale Channel target is still available", () => {
    expect(
      buildComposerTargetPreview(
        effective("division", "division-1"),
        { channelId: "channel-old", merchantId: "merchant-old" },
      ),
    ).toBe("Targeting Division division-1.");
  });

  it("shows Channel under Merchant only when the current target is that Channel", () => {
    expect(
      buildComposerTargetPreview(
        effective("channel", "channel-1"),
        { channelId: "channel-1", merchantId: "merchant-1" },
      ),
    ).toBe("Targeting Channel channel-1 under Merchant merchant-1.");

    expect(
      buildComposerTargetPreview(
        effective("channel", "channel-1"),
        { channelId: "channel-old", merchantId: "merchant-old" },
      ),
    ).toBe("Targeting Channel channel-1. Merchant parent not detected yet.");
  });

  it("hides the Settings Channel-parent line for non-Channel current context", () => {
    expect(shouldShowChannelParentTarget(context("division", "division-1"), { channelId: "channel-old", merchantId: "merchant-old" })).toBe(false);
    expect(shouldShowChannelParentTarget(context("channel", "channel-1"), { channelId: "channel-1", merchantId: "merchant-1" })).toBe(true);
  });
});
