/**
 * Shared utilities for write confirmation across bridge.ts and register-tools.ts.
 *
 * Extracted to avoid duplication of describeDirectWrite and related helpers
 * which had identical copies in content/bridge.ts and src/webmcp/register-tools.ts.
 */

import type { Environment } from "../lib/types";
import { requestConfirm, type WritePreview } from "./confirm-bridge";

/** Actions that mutate data, keyed by tool name. */
export const MUTATING_ACTIONS: Record<string, Set<string>> = {
  manage_entity: new Set(["create", "edit", "delete"]),
  manage_contact: new Set(["create", "edit", "delete", "attach", "detach", "lock", "unlock", "reset_password"]),
  manage_merchant_account: new Set(["create", "edit", "delete", "attach", "detach"]),
  manage_settings: new Set(["set", "batch_set"]),
};

/** HTTP method for a mutating action. */
export function httpMethod(action: string): "POST" | "DELETE" {
  return action === "delete" || action === "detach" ? "DELETE" : "POST";
}

/** Build a human-readable description for a write operation. */
export function describeDirectWrite(tool: string, action: string, params: Record<string, unknown>): string {
  const id = (params.entityId ?? params.contactId ?? params.merchantAccountId ?? params.attachedMerchantAccountId ?? "") as string;
  const type = (params.entityType ?? "") as string;
  switch (tool) {
    case "manage_entity":
      if (action === "create") return `Create ${params.childType ?? "entity"} under ${params.parentType} ${params.parentId}`;
      if (action === "delete") return `Delete ${type} ${id}`;
      return `Edit ${type} ${id}`;
    case "manage_contact":
      if (action === "create") return `Create contact on ${type} ${id}`;
      if (action === "lock") return `Lock contact ${params.contactId}`;
      if (action === "unlock") return `Unlock contact ${params.contactId}`;
      if (action === "reset_password") return `Reset password for contact ${params.contactId}`;
      if (action === "attach") return `Attach contact ${params.contactId} to ${type} ${id}`;
      if (action === "detach") return `Detach contact ${params.contactId} from ${type} ${id}`;
      if (action === "delete") return `Delete contact ${params.contactId}`;
      return `Edit contact ${params.contactId}`;
    case "manage_merchant_account":
      if (action === "create") return `Create merchant account on ${type} ${id}`;
      if (action === "attach") return `Attach merchant account to ${type} ${id}`;
      if (action === "detach") return `Detach merchant account ${params.attachedMerchantAccountId}`;
      if (action === "delete") return `Delete merchant account ${params.merchantAccountId}`;
      return `Edit merchant account ${params.merchantAccountId}`;
    case "manage_settings":
      if (action === "set") return `Set setting ${params.key} on ${type} ${id}`;
      return `Batch set ${Object.keys((params.settings as Record<string, unknown>) ?? {}).length} setting(s) on ${type} ${id}`;
    default:
      return `${action} on ${tool}`;
  }
}

/**
 * Check whether a tool call is mutating; if so, request user confirmation.
 * Returns the write description if the call was mutating and confirmed,
 * or undefined if the call is non-mutating (read-only).
 * Throws if the user cancels.
 */
export async function confirmIfMutating(
  tool: string, params: Record<string, unknown>, env: Environment
): Promise<string | undefined> {
  const actions = MUTATING_ACTIONS[tool];
  if (!actions) return undefined;
  const action = params.action as string;
  if (!actions.has(action)) return undefined;

  const description = describeDirectWrite(tool, action, params);
  const preview: WritePreview = {
    tool,
    action,
    method: httpMethod(action),
    description,
    params,
    env,
  };
  const choice = await requestConfirm(preview);
  if (choice === "cancel") throw new Error("Operation cancelled by user.");
  return description;
}
