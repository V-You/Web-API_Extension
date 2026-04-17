/**
 * manage_contact tool handler.
 *
 * Actions: get, list, create, edit, delete, attach, detach,
 *          lock, unlock, reset_password, find_by_username.
 *
 * Endpoint patterns:
 *   GET /contacts/{id}                              -- get
 *   GET /{plural}/{entityId}/ownedContacts           -- list owned
 *   GET /{plural}/{entityId}/attachedContacts        -- list attached
 *   POST /{plural}/{entityId}/ownedContacts          -- create
 *   POST /contacts/{id}                             -- edit
 *   DELETE /contacts/{id}                           -- delete
 *   POST /{plural}/{entityId}/attachedContacts/{id}  -- attach
 *   DELETE /{plural}/{entityId}/attachedContacts/{id} -- detach
 *   POST /contacts/{id}/lock                        -- lock
 *   POST /contacts/{id}/unlock                      -- unlock
 *   POST /contacts/{id}/resetPassword               -- reset password
 */

import { apiRequest } from "../lib/api-client";
import { type EntityType, ENTITY_PLURAL } from "../lib/entity-types";
import type { ApiCredentials, Environment } from "../lib/types";

const CONTACT_CREATE_SPEC_EXAMPLE_FIELDS = [
  "email",
  "name",
  "role",
  "kind",
  "language",
] as const;

const CONTACT_CREATE_NON_SPEC_GUESSES = [
  "username",
  "password",
  "firstName",
  "lastName",
] as const;

export interface ManageContactInput {
  action:
    | "get"
    | "list"
    | "create"
    | "edit"
    | "delete"
    | "attach"
    | "detach"
    | "lock"
    | "unlock"
    | "reset_password"
    | "find_by_username";
  contactId?: string;
  /** Entity context for list, create, attach, detach. */
  entityId?: string;
  entityType?: EntityType;
  /** "owned" or "attached" (default: "owned") for list. */
  scope?: "owned" | "attached";
  /** Fields for create or edit. */
  fields?: Record<string, string>;
  /** Username (email) for find_by_username. */
  username?: string;
  /** New password for reset_password. */
  newPassword?: string;
}

export async function executeManageContact(
  input: ManageContactInput,
  creds: ApiCredentials,
  env: Environment
) {
  switch (input.action) {
    case "get":
      return getContact(input, creds, env);
    case "list":
      return listContacts(input, creds, env);
    case "create":
      return createContact(input, creds, env);
    case "edit":
      return editContact(input, creds, env);
    case "delete":
      return deleteContact(input, creds, env);
    case "attach":
      return attachContact(input, creds, env);
    case "detach":
      return detachContact(input, creds, env);
    case "lock":
      return lockUnlock(input, creds, env, "lock");
    case "unlock":
      return lockUnlock(input, creds, env, "unlock");
    case "reset_password":
      return resetPassword(input, creds, env);
    case "find_by_username":
      return findByUsername(input, creds, env);
    default:
      return { error: `Unknown action: ${input.action}` };
  }
}

function entityPrefix(input: ManageContactInput): string | null {
  if (!input.entityId || !input.entityType) return null;
  return `/${ENTITY_PLURAL[input.entityType]}/${input.entityId}`;
}

async function getContact(
  input: ManageContactInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.contactId) return { error: "contactId is required for get." };
  return apiRequest(creds, env, { path: `/contacts/${input.contactId}` });
}

async function listContacts(
  input: ManageContactInput,
  creds: ApiCredentials,
  env: Environment
) {
  const prefix = entityPrefix(input);
  if (!prefix) return { error: "entityId and entityType are required for list." };

  const scope = input.scope === "attached" ? "attachedContacts" : "ownedContacts";
  return apiRequest(creds, env, { path: `${prefix}/${scope}` });
}

async function createContact(
  input: ManageContactInput,
  creds: ApiCredentials,
  env: Environment
) {
  const prefix = entityPrefix(input);
  if (!prefix) return { error: "entityId and entityType are required for create." };
  if (!input.fields) return { error: "fields are required for create." };

  const normalizedFields = normalizeCreateContactFields(input.fields);

  const result = await apiRequest(creds, env, {
    method: "POST",
    path: `${prefix}/ownedContacts`,
    params: normalizedFields,
  }, {
    eventType: "contact_create",
    entityId: input.entityId!,
    entityType: input.entityType!,
  });

  return addCreateContactHint(result, normalizedFields);
}

async function editContact(
  input: ManageContactInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.contactId) return { error: "contactId is required for edit." };
  if (!input.fields) return { error: "fields are required for edit." };

  return apiRequest(creds, env, {
    method: "POST",
    path: `/contacts/${input.contactId}`,
    params: input.fields,
  });
}

async function deleteContact(
  input: ManageContactInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.contactId) return { error: "contactId is required for delete." };

  return apiRequest(creds, env, {
    method: "DELETE",
    path: `/contacts/${input.contactId}`,
  }, {
    eventType: "contact_delete",
    entityId: input.contactId,
    entityType: "contact",
  });
}

async function attachContact(
  input: ManageContactInput,
  creds: ApiCredentials,
  env: Environment
) {
  const prefix = entityPrefix(input);
  if (!prefix) return { error: "entityId and entityType are required for attach." };
  if (!input.contactId) return { error: "contactId is required for attach." };

  return apiRequest(creds, env, {
    method: "POST",
    path: `${prefix}/attachedContacts/${input.contactId}`,
  }, {
    eventType: "contact_attach",
    entityId: input.contactId,
    entityType: "contact",
  });
}

async function detachContact(
  input: ManageContactInput,
  creds: ApiCredentials,
  env: Environment
) {
  const prefix = entityPrefix(input);
  if (!prefix) return { error: "entityId and entityType are required for detach." };
  if (!input.contactId) return { error: "contactId is required for detach." };

  return apiRequest(creds, env, {
    method: "DELETE",
    path: `${prefix}/attachedContacts/${input.contactId}`,
  }, {
    eventType: "contact_detach",
    entityId: input.contactId,
    entityType: "contact",
  });
}

async function lockUnlock(
  input: ManageContactInput,
  creds: ApiCredentials,
  env: Environment,
  action: "lock" | "unlock"
) {
  if (!input.contactId) return { error: `contactId is required for ${action}.` };

  return apiRequest(creds, env, {
    method: "POST",
    path: `/contacts/${input.contactId}/${action}`,
  }, {
    eventType: action === "lock" ? "contact_lock" : "contact_unlock",
    entityId: input.contactId,
    entityType: "contact",
  });
}

async function resetPassword(
  input: ManageContactInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.contactId) return { error: "contactId is required for reset_password." };

  const params: Record<string, string> = {};
  if (input.newPassword) params.password = input.newPassword;

  return apiRequest(creds, env, {
    method: "POST",
    path: `/contacts/${input.contactId}/resetPassword`,
    params: Object.keys(params).length > 0 ? params : undefined,
  }, {
    eventType: "contact_password_reset",
    entityId: input.contactId,
    entityType: "contact",
  });
}

async function findByUsername(
  input: ManageContactInput,
  _creds: ApiCredentials,
  _env: Environment
) {
  if (!input.username) return { error: "username is required for find_by_username." };

  // The API has no direct search-by-email endpoint.
  // The agent should use get_hierarchy + iterate, or the user provides the contactId.
  // For now, return guidance.
  return {
    error: null,
    note: "The API has no search-by-username endpoint. Use get_hierarchy to traverse entities and list contacts at each level, filtering by email. Or use execute_workflow for an automated search script.",
    username: input.username,
  };
}

function normalizeCreateContactFields(fields: Record<string, string>): Record<string, string> {
  return { ...fields };
}

function addCreateContactHint<T>(
  result: { ok: boolean; status: number; data: T },
  fields: Record<string, string>
): { ok: boolean; status: number; data: T } {
  if (!looksLikeMissingRequiredValuesError(result.data)) {
    return result;
  }

  const missingExampleFields = CONTACT_CREATE_SPEC_EXAMPLE_FIELDS.filter((field) => !hasNonEmptyField(fields[field]));
  const nonSpecFields = CONTACT_CREATE_NON_SPEC_GUESSES.filter((field) => hasNonEmptyField(fields[field]));
  const hint = [
    "Check the bundled OpenAPI contact schema instead of guessing login-style fields.",
    "The current ownedContacts create schema exposes fields like email, name, role, kind, language, mobile, autoAttach, description, oauthRedirectUrl, sendCredentialsMail, and sendAuthenticatorMail.",
    nonSpecFields.length > 0
      ? `The bundled spec does not list these create fields: ${nonSpecFields.join(", ")}.`
      : null,
    missingExampleFields.length > 0
      ? `The bundled spec example includes fields not present in this request: ${missingExampleFields.join(", ")}.`
      : null,
    fields.kind === "OAUTH_APP" && !hasNonEmptyField(fields.oauthRedirectUrl)
      ? "oauthRedirectUrl is described as required for OAUTH kind contacts."
      : null,
  ].filter(Boolean).join(" ");

  return {
    ...result,
    data: addHintToErrorPayload(result.data, hint),
  };
}

function looksLikeMissingRequiredValuesError(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;

  const message = (data as { error?: { message?: unknown } }).error?.message;
  return typeof message === "string"
    && message.toLowerCase().includes("required values")
    && message.toLowerCase().includes("missing");
}

function addHintToErrorPayload<T>(data: T, hint: string): T {
  if (!data || typeof data !== "object") return data;

  const current = data as { error?: Record<string, unknown> };
  return {
    ...current,
    error: {
      ...(current.error ?? {}),
      hint,
    },
  } as T;
}

function hasNonEmptyField(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export {
  addCreateContactHint,
  normalizeCreateContactFields,
};
