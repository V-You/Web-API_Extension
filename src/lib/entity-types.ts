/**
 * Entity type helpers shared across tool handlers.
 *
 * The API uses type-specific endpoints -- there is no generic /entities/{id}.
 * Every request must know the entity type to pick the correct plural path.
 */

export type EntityType = "psp" | "division" | "merchant" | "channel";

export const ENTITY_PLURAL: Record<EntityType, string> = {
  psp: "psps",
  division: "divisions",
  merchant: "merchants",
  channel: "channels",
};

/** Detect entity type by brute-force GET across plural endpoints. */
export function entityPath(type: EntityType, id: string): string {
  return `/${ENTITY_PLURAL[type]}/${id}`;
}

/**
 * Given a raw entity object from the API, extract the parent type and ID.
 * The API embeds parent IDs as fields: pspId, divisionId, merchantId, sender.
 */
export function extractParentInfo(
  entity: Record<string, unknown>
): { type: EntityType; id: string } | null {
  // Channel -> parent is merchant (sender field)
  if (entity.sender && typeof entity.sender === "string") {
    return { type: "merchant", id: entity.sender };
  }
  if (entity.merchantId && typeof entity.merchantId === "string") {
    return { type: "merchant", id: entity.merchantId };
  }
  if (entity.divisionId && typeof entity.divisionId === "string") {
    return { type: "division", id: entity.divisionId };
  }
  if (entity.pspId && typeof entity.pspId === "string") {
    return { type: "psp", id: entity.pspId };
  }
  return null;
}

/** Entity types that can be children, with their parent type. */
export const CHILD_MAP: Record<string, { parent: EntityType; child: EntityType }> = {
  divisions: { parent: "psp", child: "division" },
  merchants: { parent: "division", child: "merchant" },
  channels: { parent: "merchant", child: "channel" },
};

/**
 * The types that can be created (PSP cannot be created via API).
 * Maps child type to the parent plural and child plural used in
 * the creation endpoint: POST /{parentPlural}/{parentId}/{childPlural}.
 */
export const CREATABLE: Record<
  "division" | "merchant" | "channel",
  { parentPlural: string; childPlural: string }
> = {
  division: { parentPlural: "psps", childPlural: "divisions" },
  merchant: { parentPlural: "divisions", childPlural: "merchants" },
  channel: { parentPlural: "merchants", childPlural: "channels" },
};
