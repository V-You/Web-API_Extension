/**
 * manage_entity tool handler.
 *
 * Actions: get, search, list_children, create, edit, delete.
 *
 * Endpoint patterns:
 *   GET /{plural}/{id}               -- get entity
 *   GET /entities/byName/{names...}  -- search by name path
 *   GET /{parentPlural}/{parentId}/{childPlural} -- list children
 *   POST /{parentPlural}/{parentId}/{childPlural} -- create
 *   POST /{plural}/{id}              -- edit
 *   DELETE /{plural}/{id}            -- delete
 *
 * Quirks:
 *   - PSP has no direct GET endpoint (only sub-resources).
 *   - list_channels returns channel logins; the "channel" field is the entity ID.
 */

import { apiRequest } from "../lib/api-client";
import {
  type EntityType,
  ENTITY_PLURAL,
  entityPath,
  CREATABLE,
} from "../lib/entity-types";
import type { ApiCredentials, Environment } from "../lib/types";

export interface ManageEntityInput {
  action: "get" | "search" | "list_children" | "create" | "edit" | "delete";
  /** Required for get, edit, delete. */
  entityId?: string;
  /** Required for get, edit, delete. */
  entityType?: EntityType;
  /** Required for search -- slash-separated name path, e.g. "MyPSP/MyDiv". */
  namePath?: string;
  /** Required for list_children -- parent entity ID. */
  parentId?: string;
  /** Required for list_children and create -- type of parent. */
  parentType?: EntityType;
  /** Type of child to list or create (division, merchant, channel). */
  childType?: "division" | "merchant" | "channel";
  /** Fields for create or edit (form-encoded params). */
  fields?: Record<string, string>;
}

export async function executeManageEntity(
  input: ManageEntityInput,
  creds: ApiCredentials,
  env: Environment
) {
  switch (input.action) {
    case "get":
      return getEntity(input, creds, env);
    case "search":
      return searchEntity(input, creds, env);
    case "list_children":
      return listChildren(input, creds, env);
    case "create":
      return createEntity(input, creds, env);
    case "edit":
      return editEntity(input, creds, env);
    case "delete":
      return deleteEntity(input, creds, env);
    default:
      return { error: `Unknown action: ${input.action}` };
  }
}

async function getEntity(
  input: ManageEntityInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.entityId || !input.entityType) {
    return { error: "entityId and entityType are required for get." };
  }
  if (input.entityType === "psp") {
    return { error: "PSP has no direct GET endpoint. Use list_children to list its divisions." };
  }

  const res = await apiRequest(creds, env, {
    path: entityPath(input.entityType, input.entityId),
  });
  return res;
}

async function searchEntity(
  input: ManageEntityInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.namePath) {
    return { error: "namePath is required for search (e.g. 'MyPSP/MyDiv')." };
  }

  // The API uses /entities/byName/{pspName}[/{divisionName}[/{merchantName}]]
  const segments = input.namePath.split("/").map(encodeURIComponent);
  const path = `/entities/byName/${segments.join("/")}`;
  const res = await apiRequest(creds, env, { path });
  return res;
}

async function listChildren(
  input: ManageEntityInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.parentId || !input.parentType || !input.childType) {
    return { error: "parentId, parentType, and childType are required for list_children." };
  }

  const parentPlural = ENTITY_PLURAL[input.parentType];
  const childPlural = ENTITY_PLURAL[input.childType];
  const path = `/${parentPlural}/${input.parentId}/${childPlural}`;
  const res = await apiRequest(creds, env, { path });

  // Quirk: list_channels returns channel logins where "channel" is the entity ID
  if (input.childType === "channel" && res.ok && Array.isArray(res.data)) {
    return {
      ...res,
      data: (res.data as Record<string, unknown>[]).map((ch) => ({
        ...ch,
        _entityId: ch.channel ?? ch.id,
        _note: "channel field is the entity ID, not id",
      })),
    };
  }

  return res;
}

async function createEntity(
  input: ManageEntityInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.parentId || !input.childType || !input.fields) {
    return { error: "parentId, childType, and fields are required for create." };
  }

  const spec = CREATABLE[input.childType];
  if (!spec) {
    return { error: `Cannot create entity of type: ${input.childType}` };
  }

  const path = `/${spec.parentPlural}/${input.parentId}/${spec.childPlural}`;
  const res = await apiRequest(creds, env, {
    method: "POST",
    path,
    params: input.fields,
  }, {
    eventType: "entity_create",
    entityId: input.parentId,
    entityType: input.childType,
  });
  return res;
}

async function editEntity(
  input: ManageEntityInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.entityId || !input.entityType || !input.fields) {
    return { error: "entityId, entityType, and fields are required for edit." };
  }

  const res = await apiRequest(creds, env, {
    method: "POST",
    path: entityPath(input.entityType, input.entityId),
    params: input.fields,
  });
  return res;
}

async function deleteEntity(
  input: ManageEntityInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.entityId || !input.entityType) {
    return { error: "entityId and entityType are required for delete." };
  }

  const res = await apiRequest(creds, env, {
    method: "DELETE",
    path: entityPath(input.entityType, input.entityId),
  }, {
    eventType: "entity_delete",
    entityId: input.entityId,
    entityType: input.entityType,
  });
  return res;
}
