/**
 * SDK facade for the sandbox.
 *
 * Wraps all tool handlers as SDK-style async methods so the agent's script
 * can call sdk.entities.get(...) instead of executeManageEntity({action:"get",...}).
 *
 * Also exposes the VirtualSdk.config for typed settings operations.
 *
 * Write operations go through:
 *   1. The outer preview/confirm bridge (confirmAndWrite below).
 *   2. The typed adapter (executeTypedTool) with `confirm: true` to bypass
 *      the adapter's own confirm layer, since confirmation already happened.
 *
 * The adapter enforces D5 (path params), D6 (unknown-field rejection),
 * and D7 (form-encode coercion). Runtime code-mode writes are therefore
 * held to the same correctness bar as WebMCP per-action writes (Part-II
 * P2-D3). `VirtualSdk` stays settings-only; the sandbox facade is the
 * typed domain surface for code-mode (Part-II P2-D3a).
 */

import { createSdk, type SdkContext } from "../sdk/sdk";
import type { EntityType } from "../lib/entity-types";
import type { ApiCredentials, Environment } from "../lib/types";
import { requestConfirm, type WritePreview } from "../bridge/confirm-bridge";
import { recordWrite } from "../bridge/write-status";
import { executeTypedTool, type AdapterResult } from "../tools/adapter";
import { executeManageEntity } from "../tools/manage-entity";
import { executeGetHierarchy } from "../tools/get-hierarchy";
import { executeManageContact } from "../tools/manage-contact";
import { executeManageMerchantAccount } from "../tools/manage-merchant-account";
import { executeLookupClearingInstitutes } from "../tools/lookup-clearing-institutes";
import { executeDescribeSettings } from "../tools/describe-settings";
import { executeGetAuditLog, type GetAuditLogInput } from "../tools/get-audit-log";
import type {
  Params_attach_merchant_account,
  Params_create_channel,
  Params_create_contact,
  Params_create_division,
  Params_create_merchant,
  Params_create_merchant_account,
  Params_delete_contact,
  Params_delete_entity,
  Params_delete_merchant_account,
  Params_detach_contact,
  Params_detach_merchant_account,
  Params_edit_contact,
  Params_edit_entity,
  Params_edit_merchant_account,
  Params_lock_contact,
  Params_set_contact_password,
  Params_unlock_contact,
} from "../../src_data/webapi-sdk";

// Re-export the generated typed parameter shapes for code-mode script
// authors and anyone wiring against the sandbox facade (Part-II P2-D3a --
// ensures `webapi-sdk.d.ts` has a real runtime consumer).
export type {
  Params_attach_merchant_account,
  Params_create_channel,
  Params_create_contact,
  Params_create_division,
  Params_create_merchant,
  Params_create_merchant_account,
  Params_delete_contact,
  Params_delete_entity,
  Params_delete_merchant_account,
  Params_detach_contact,
  Params_detach_merchant_account,
  Params_edit_contact,
  Params_edit_entity,
  Params_edit_merchant_account,
  Params_lock_contact,
  Params_set_contact_password,
  Params_unlock_contact,
};

export interface WriteRecord {
  tool: string;
  action: string;
  entityId: string;
  entityType: string;
  params: Record<string, unknown>;
  timestamp: string;
}

/**
 * Build the full `sdk` object injected into sandbox scripts.
 *
 * Every write operation goes through confirmAndWrite() which:
 *   1. Sends a preview to the confirmation bridge
 *   2. Waits for user approval (confirm / cancel / confirm_all)
 *   3. Records the write in the writes[] array
 *   4. Throws if the user cancels
 */
export function buildSdkFacade(
  creds: ApiCredentials,
  env: Environment,
  writes: WriteRecord[]
) {
  const ctx: SdkContext = { creds, env };
  const virtualSdk = createSdk(ctx);

  /** Request confirmation, record write, or throw on cancel. */
  async function confirmAndWrite(
    tool: string,
    action: string,
    method: "POST" | "DELETE",
    entityId: string,
    entityType: string,
    description: string,
    params: Record<string, unknown>,
  ) {
    const preview: WritePreview = { tool, action, method, description, params, env };
    const choice = await requestConfirm(preview);
    if (choice === "cancel") throw new Error("Operation cancelled by user.");
    writes.push({ tool, action, entityId, entityType, params, timestamp: new Date().toISOString() });
    recordWrite(description);
  }

  /**
   * Run a per-action typed tool through the adapter. Confirmation has
   * already happened at the outer facade layer, so we pass `confirm: true`
   * to bypass the adapter's own confirm bridge.
   */
  async function runTyped(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<AdapterResult> {
    return executeTypedTool(toolName, params, { creds, env, confirm: true });
  }

  return {
    // -- Settings (wrapped to intercept writes) --
    config: {
      get: virtualSdk.config.get.bind(virtualSdk.config),
      batchGet: virtualSdk.config.batchGet.bind(virtualSdk.config),
      describe: virtualSdk.config.describe.bind(virtualSdk.config),
      validate: virtualSdk.config.validate.bind(virtualSdk.config),
      coverage: virtualSdk.config.coverage.bind(virtualSdk.config),
      async update(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        const keys = Object.keys(settings);
        await confirmAndWrite(
          "config", "update", "POST", entityId, entityType,
          `Update ${keys.length} setting(s) on ${entityType} ${entityId}`,
          { settings },
        );
        return virtualSdk.config.update(entityType, entityId, settings);
      },
      async batchUpdate(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        const keys = Object.keys(settings);
        await confirmAndWrite(
          "config", "batch_update", "POST", entityId, entityType,
          `Batch update ${keys.length} setting(s) on ${entityType} ${entityId}`,
          { settings },
        );
        return virtualSdk.config.batchUpdate(entityType, entityId, settings);
      },
    },

    // -- Entity operations --
    entities: {
      async get(entityType: EntityType, entityId: string) {
        return executeManageEntity({ action: "get", entityType, entityId }, creds, env);
      },
      async search(namePath: string) {
        return executeManageEntity({ action: "search", namePath }, creds, env);
      },
      async listChildren(parentType: EntityType, parentId: string, childType: "division" | "merchant" | "channel") {
        return executeManageEntity({ action: "list_children", parentType, parentId, childType }, creds, env);
      },
      async create(parentType: EntityType, parentId: string, childType: "division" | "merchant" | "channel", fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_entity", "create", "POST", parentId, parentType,
          `Create ${childType} under ${parentType} ${parentId}`,
          { childType, fields },
        );
        const toolName =
          childType === "division" ? "create_division"
          : childType === "merchant" ? "create_merchant"
          : "create_channel";
        return runTyped(toolName, { parentType, parentId, ...fields });
      },
      async edit(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_entity", "edit", "POST", entityId, entityType,
          `Edit ${entityType} ${entityId}`,
          { fields },
        );
        return runTyped("edit_entity", { parentType: entityType, parentId: entityId, ...fields });
      },
      async delete(entityType: EntityType, entityId: string) {
        await confirmAndWrite(
          "manage_entity", "delete", "DELETE", entityId, entityType,
          `Delete ${entityType} ${entityId}`,
          {},
        );
        return runTyped("delete_entity", { parentType: entityType, parentId: entityId });
      },
    },

    // -- Hierarchy --
    hierarchy: {
      async fetch(pspId: string, depth?: number) {
        return executeGetHierarchy({ pspId, depth }, creds, env);
      },
      async estimate(pspId: string, depth?: number) {
        return executeGetHierarchy({ pspId, depth, estimateOnly: true }, creds, env);
      },
    },

    // -- Contacts --
    contacts: {
      async get(contactId: string) {
        return executeManageContact({ action: "get", contactId }, creds, env);
      },
      async list(entityType: EntityType, entityId: string, scope?: "owned" | "attached") {
        return executeManageContact({ action: "list", entityType, entityId, scope }, creds, env);
      },
      async create(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_contact", "create", "POST", entityId, entityType,
          `Create contact on ${entityType} ${entityId}`,
          { fields },
        );
        return runTyped("create_contact", { parentType: entityType, parentId: entityId, ...fields });
      },
      async edit(contactId: string, fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_contact", "edit", "POST", contactId, "contact",
          `Edit contact ${contactId}`,
          { fields },
        );
        return runTyped("edit_contact", { contactId, ...fields });
      },
      async delete(contactId: string) {
        await confirmAndWrite(
          "manage_contact", "delete", "DELETE", contactId, "contact",
          `Delete contact ${contactId}`,
          {},
        );
        return runTyped("delete_contact", { contactId });
      },
      async attach(entityType: EntityType, entityId: string, contactId: string) {
        // No per-action tool exists for contact attach (not in the bundled OpenAPI spec).
        // Falls back to the internal manage_contact handler (Part-II P2-D2 compat path).
        await confirmAndWrite(
          "manage_contact", "attach", "POST", entityId, entityType,
          `Attach contact ${contactId} to ${entityType} ${entityId}`,
          { contactId },
        );
        return executeManageContact({ action: "attach", entityType, entityId, contactId }, creds, env);
      },
      async detach(entityType: EntityType, entityId: string, contactId: string) {
        await confirmAndWrite(
          "manage_contact", "detach", "DELETE", entityId, entityType,
          `Detach contact ${contactId} from ${entityType} ${entityId}`,
          { contactId },
        );
        return runTyped("detach_contact", { parentType: entityType, parentId: entityId, contactId });
      },
      async lock(contactId: string) {
        await confirmAndWrite(
          "manage_contact", "lock", "POST", contactId, "contact",
          `Lock contact ${contactId}`,
          {},
        );
        return runTyped("lock_contact", { contactId });
      },
      async unlock(contactId: string) {
        await confirmAndWrite(
          "manage_contact", "unlock", "POST", contactId, "contact",
          `Unlock contact ${contactId}`,
          {},
        );
        return runTyped("unlock_contact", { contactId });
      },
      async resetPassword(contactId: string, _newPassword?: string) {
        // The spec-driven set_contact_password endpoint takes no password field --
        // the backend generates and mails credentials. The newPassword argument
        // is kept for backward compatibility but ignored.
        await confirmAndWrite(
          "manage_contact", "reset_password", "POST", contactId, "contact",
          `Reset password for contact ${contactId}`,
          {},
        );
        return runTyped("set_contact_password", { contactId });
      },
    },

    // -- Merchant accounts --
    merchantAccounts: {
      async get(merchantAccountId: string) {
        return executeManageMerchantAccount({ action: "get", merchantAccountId }, creds, env);
      },
      async list(entityType: EntityType, entityId: string, scope?: "owned" | "attached") {
        return executeManageMerchantAccount({ action: "list", entityType, entityId, scope }, creds, env);
      },
      async create(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_merchant_account", "create", "POST", entityId, entityType,
          `Create merchant account on ${entityType} ${entityId}`,
          { fields },
        );
        return runTyped("create_merchant_account", { parentType: entityType, parentId: entityId, ...fields });
      },
      async edit(merchantAccountId: string, fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_merchant_account", "edit", "POST", merchantAccountId, "merchant_account",
          `Edit merchant account ${merchantAccountId}`,
          { fields },
        );
        return runTyped("edit_merchant_account", { merchantAccountId, ...fields });
      },
      async delete(merchantAccountId: string) {
        await confirmAndWrite(
          "manage_merchant_account", "delete", "DELETE", merchantAccountId, "merchant_account",
          `Delete merchant account ${merchantAccountId}`,
          {},
        );
        return runTyped("delete_merchant_account", { merchantAccountId });
      },
      async attach(entityType: EntityType, entityId: string, merchantAccountId: string, subTypes: string, currency: string) {
        // Part-II P2-D3 fix: pass merchantAccountId/subTypes/currency at top level
        // through the adapter, which coerces and form-encodes them. The previous
        // nested-under-`fields` shape short-circuited the internal handler.
        await confirmAndWrite(
          "manage_merchant_account", "attach", "POST", entityId, entityType,
          `Attach merchant account ${merchantAccountId} to ${entityType} ${entityId}`,
          { merchantAccountId, subTypes, currency },
        );
        return runTyped("attach_merchant_account", {
          parentType: entityType,
          parentId: entityId,
          merchantAccountId,
          subTypes,
          currency,
        });
      },
      async detach(attachedMerchantAccountId: string) {
        await confirmAndWrite(
          "manage_merchant_account", "detach", "DELETE", attachedMerchantAccountId, "merchant_account",
          `Detach merchant account relationship ${attachedMerchantAccountId}`,
          {},
        );
        return runTyped("detach_merchant_account", { attachedMerchantAccountId });
      },
      async threeDCheck(merchantAccountId: string) {
        // No per-action tool exists for three_d_check. Falls back to the internal
        // manage_merchant_account handler (Part-II P2-D2 compat path).
        return executeManageMerchantAccount({ action: "three_d_check", merchantAccountId }, creds, env);
      },
    },

    // -- Clearing institutes --
    clearingInstitutes: {
      async search(query: string) {
        return executeLookupClearingInstitutes({ action: "search", query }, creds, env);
      },
      async getFields(ciCode: string) {
        return executeLookupClearingInstitutes({ action: "get_fields", ciCode }, creds, env);
      },
      async listLive(pspId: string) {
        return executeLookupClearingInstitutes({ action: "list_live", pspId }, creds, env);
      },
    },

    // -- Settings search (convenience alias for config.describe) --
    describeSettings(query: string, limit?: number) {
      return executeDescribeSettings({ query, limit });
    },

    // -- Audit --
    audit: {
      async get(opts?: GetAuditLogInput) {
        return executeGetAuditLog(opts ?? {});
      },
    },
  };
}

/** Type of the sdk object injected into sandbox scripts. */
export type SdkFacade = ReturnType<typeof buildSdkFacade>;
