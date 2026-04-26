import { ENTITY_PLURAL, type EntityType } from "./entity-types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function unwrapEntityRecord(type: EntityType, data: Record<string, unknown>): Record<string, unknown> {
  const directKey = type;
  const infoKey = `${type}Info`;

  if (isRecord(data[directKey])) return data[directKey];
  if (isRecord(data[infoKey])) return data[infoKey];
  return data;
}

export function extractEntityCollection(childType: EntityType, data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }

  if (!isRecord(data)) {
    return [];
  }

  const direct = data[ENTITY_PLURAL[childType]];
  if (Array.isArray(direct)) {
    return direct.filter(isRecord);
  }

  return [];
}

export function extractParentFromEntityRecord(entity: Record<string, unknown>): { id: string; type: EntityType } | null {
  const sender = entity.sender;
  if (typeof sender === "string" && sender) return { id: sender, type: "merchant" };
  if (isRecord(sender) && typeof sender.id === "string" && sender.id) return { id: sender.id, type: "merchant" };
  if (typeof entity.merchantId === "string" && entity.merchantId) return { id: entity.merchantId, type: "merchant" };
  if (typeof entity.divisionId === "string" && entity.divisionId) return { id: entity.divisionId, type: "division" };
  if (typeof entity.pspId === "string" && entity.pspId) return { id: entity.pspId, type: "psp" };
  if (typeof entity.parentId === "string" && entity.parentId) return { id: entity.parentId, type: "psp" };
  return null;
}
