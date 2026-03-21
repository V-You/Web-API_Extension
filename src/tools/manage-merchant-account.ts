/**
 * manage_merchant_account tool handler.
 *
 * Actions: get, list, create, edit, delete, attach, detach, three_d_check.
 *
 * Endpoint patterns:
 *   GET /merchantAccounts/{id}                      -- get
 *   GET /{plural}/{entityId}/ownedMerchantAccounts   -- list owned
 *   GET /{plural}/{entityId}/attachedMerchantAccounts -- list attached
 *   POST /{plural}/{entityId}/ownedMerchantAccounts  -- create
 *   POST /merchantAccounts/{id}                     -- edit
 *   DELETE /merchantAccounts/{id}                   -- delete
 *   POST /{plural}/{entityId}/attachedMerchantAccounts -- attach (with merchantAccountId, subTypes, currency)
 *   DELETE /attachedMerchantAccounts/{attachedId}    -- detach
 *   POST /merchantAccounts/{id}/ThreeDEnrollmentCheck -- 3DS check
 */

import { apiRequest } from "../lib/api-client";
import { type EntityType, ENTITY_PLURAL } from "../lib/entity-types";
import type { ApiCredentials, Environment } from "../lib/types";

export interface ManageMerchantAccountInput {
  action:
    | "get"
    | "list"
    | "create"
    | "edit"
    | "delete"
    | "attach"
    | "detach"
    | "three_d_check";
  /** MA ID for get, edit, delete, three_d_check. */
  merchantAccountId?: string;
  /** Entity context for list, create, attach. */
  entityId?: string;
  entityType?: EntityType;
  /** "owned" or "attached" (default: "owned") for list. */
  scope?: "owned" | "attached";
  /** Fields for create or edit. */
  fields?: Record<string, string>;
  /** For attach: subTypes (comma-separated), currency. */
  subTypes?: string;
  currency?: string;
  /** For detach: the attached MA relationship ID (not the MA ID itself). */
  attachedMerchantAccountId?: string;
}

export async function executeManageMerchantAccount(
  input: ManageMerchantAccountInput,
  creds: ApiCredentials,
  env: Environment
) {
  switch (input.action) {
    case "get":
      return getMA(input, creds, env);
    case "list":
      return listMA(input, creds, env);
    case "create":
      return createMA(input, creds, env);
    case "edit":
      return editMA(input, creds, env);
    case "delete":
      return deleteMA(input, creds, env);
    case "attach":
      return attachMA(input, creds, env);
    case "detach":
      return detachMA(input, creds, env);
    case "three_d_check":
      return threeDCheck(input, creds, env);
    default:
      return { error: `Unknown action: ${input.action}` };
  }
}

function entityPrefix(input: ManageMerchantAccountInput): string | null {
  if (!input.entityId || !input.entityType) return null;
  return `/${ENTITY_PLURAL[input.entityType]}/${input.entityId}`;
}

async function getMA(
  input: ManageMerchantAccountInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.merchantAccountId) return { error: "merchantAccountId is required for get." };
  return apiRequest(creds, env, {
    path: `/merchantAccounts/${input.merchantAccountId}`,
  });
}

async function listMA(
  input: ManageMerchantAccountInput,
  creds: ApiCredentials,
  env: Environment
) {
  const prefix = entityPrefix(input);
  if (!prefix) return { error: "entityId and entityType are required for list." };

  const scope = input.scope === "attached"
    ? "attachedMerchantAccounts"
    : "ownedMerchantAccounts";
  return apiRequest(creds, env, { path: `${prefix}/${scope}` });
}

async function createMA(
  input: ManageMerchantAccountInput,
  creds: ApiCredentials,
  env: Environment
) {
  const prefix = entityPrefix(input);
  if (!prefix) return { error: "entityId and entityType are required for create." };
  if (!input.fields) return { error: "fields are required for create." };

  return apiRequest(creds, env, {
    method: "POST",
    path: `${prefix}/ownedMerchantAccounts`,
    params: input.fields,
  }, {
    eventType: "ma_create",
    entityId: input.entityId!,
    entityType: input.entityType!,
  });
}

async function editMA(
  input: ManageMerchantAccountInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.merchantAccountId) return { error: "merchantAccountId is required for edit." };
  if (!input.fields) return { error: "fields are required for edit." };

  return apiRequest(creds, env, {
    method: "POST",
    path: `/merchantAccounts/${input.merchantAccountId}`,
    params: input.fields,
  }, {
    eventType: "ma_update",
    entityId: input.merchantAccountId,
    entityType: "merchantAccount",
  });
}

async function deleteMA(
  input: ManageMerchantAccountInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.merchantAccountId) return { error: "merchantAccountId is required for delete." };
  return apiRequest(creds, env, {
    method: "DELETE",
    path: `/merchantAccounts/${input.merchantAccountId}`,
  });
}

async function attachMA(
  input: ManageMerchantAccountInput,
  creds: ApiCredentials,
  env: Environment
) {
  const prefix = entityPrefix(input);
  if (!prefix) return { error: "entityId and entityType are required for attach." };
  if (!input.merchantAccountId) return { error: "merchantAccountId is required for attach." };

  const params: Record<string, string> = {
    merchantAccountId: input.merchantAccountId,
  };
  if (input.subTypes) params.subTypes = input.subTypes;
  if (input.currency) params.currency = input.currency;

  return apiRequest(creds, env, {
    method: "POST",
    path: `${prefix}/attachedMerchantAccounts`,
    params,
  }, {
    eventType: "ma_attach",
    entityId: input.merchantAccountId,
    entityType: "merchantAccount",
  });
}

async function detachMA(
  input: ManageMerchantAccountInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.attachedMerchantAccountId) {
    return { error: "attachedMerchantAccountId is required for detach (the relationship ID, not the MA ID)." };
  }

  return apiRequest(creds, env, {
    method: "DELETE",
    path: `/attachedMerchantAccounts/${input.attachedMerchantAccountId}`,
  }, {
    eventType: "ma_detach",
    entityId: input.attachedMerchantAccountId,
    entityType: "merchantAccount",
  });
}

async function threeDCheck(
  input: ManageMerchantAccountInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.merchantAccountId) return { error: "merchantAccountId is required for three_d_check." };

  return apiRequest(creds, env, {
    method: "POST",
    path: `/merchantAccounts/${input.merchantAccountId}/ThreeDEnrollmentCheck`,
  });
}
