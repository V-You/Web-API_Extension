import type { EntityType } from "../lib/entity-types";
import type { ChatContextRecord } from "./context-store";

export interface EffectiveChatContext {
  entityId: string;
  entityType: EntityType;
  source: "manual" | "detected";
}

function entityLabel(entityType: EntityType): string {
  return entityType.charAt(0).toUpperCase() + entityType.slice(1);
}

export function buildComposerTargetPreview(
  effectiveContext: EffectiveChatContext | null,
  resolvedTarget: { channelId: string; merchantId?: string } | null,
): string | null {
  if (!effectiveContext) return null;
  if (effectiveContext.entityType === "channel") {
    const merchantId = resolvedTarget?.channelId === effectiveContext.entityId ? resolvedTarget.merchantId : undefined;
    return merchantId
      ? `Targeting Channel ${effectiveContext.entityId} under Merchant ${merchantId}.`
      : `Targeting Channel ${effectiveContext.entityId}. Merchant parent not detected yet.`;
  }
  return `Targeting ${entityLabel(effectiveContext.entityType)} ${effectiveContext.entityId}.`;
}

export function shouldShowChannelParentTarget(
  detectedContext: ChatContextRecord | null,
  resolvedTarget: { channelId: string; merchantId?: string } | null,
): resolvedTarget is { channelId: string; merchantId: string } {
  return detectedContext?.entityType === "channel"
    && detectedContext.entityId === resolvedTarget?.channelId
    && Boolean(resolvedTarget?.merchantId);
}
