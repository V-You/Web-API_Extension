/**
 * SDK facade for the sandbox.
 *
 * Wraps all tool handlers as SDK-style async methods so the agent's script
 * can call sdk.entities.get(...) instead of executeManageEntity({action:"get",...}).
 *
 * Also exposes the VirtualSdk.config for typed settings operations.
 *
 * Write operations are intercepted by the preview/confirm bridge before
 * execution, and recorded into the writes[] array.
 */

import { createSdk, type SdkContext } from "../sdk/sdk";
import type { EntityType } from "../lib/entity-types";
import type { ApiCredentials, Environment } from "../lib/types";
import { requestConfirm, type WritePreview } from "../bridge/confirm-bridge";
import { recordWrite } from "../bridge/write-status";
import { executeManageEntity } from "../tools/manage-entity";
import { executeGetHierarchy } from "../tools/get-hierarchy";
import { executeManageContact } from "../tools/manage-contact";
import { executeManageMerchantAccount } from "../tools/manage-merchant-account";
import { executeLookupClearingInstitutes } from "../tools/lookup-clearing-institutes";
import { executeDescribeSettings } from "../tools/describe-settings";
import { executeGetAuditLog, type GetAuditLogInput } from "../tools/get-audit-log";

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
        return executeManageEntity({ action: "create", parentType, parentId, childType, fields }, creds, env);
      },
      async edit(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_entity", "edit", "POST", entityId, entityType,
          `Edit ${entityType} ${entityId}`,
          { fields },
        );
        return executeManageEntity({ action: "edit", entityType, entityId, fields }, creds, env);
      },
      async delete(entityType: EntityType, entityId: string) {
        await confirmAndWrite(
          "manage_entity", "delete", "DELETE", entityId, entityType,
          `Delete ${entityType} ${entityId}`,
          {},
        );
        return executeManageEntity({ action: "delete", entityType, entityId }, creds, env);
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
        return executeManageContact({ action: "create", entityType, entityId, fields }, creds, env);
      },
      async edit(contactId: string, fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_contact", "edit", "POST", contactId, "contact",
          `Edit contact ${contactId}`,
          { fields },
        );
        return executeManageContact({ action: "edit", contactId, fields }, creds, env);
      },
      async delete(contactId: string) {
        await confirmAndWrite(
          "manage_contact", "delete", "DELETE", contactId, "contact",
          `Delete contact ${contactId}`,
          {},
        );
        return executeManageContact({ action: "delete", contactId }, creds, env);
      },
      async attach(entityType: EntityType, entityId: string, contactId: string) {
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
        return executeManageContact({ action: "detach", entityType, entityId, contactId }, creds, env);
      },
      async lock(contactId: string) {
        await confirmAndWrite(
          "manage_contact", "lock", "POST", contactId, "contact",
          `Lock contact ${contactId}`,
          {},
        );
        return executeManageContact({ action: "lock", contactId }, creds, env);
      },
      async unlock(contactId: string) {
        await confirmAndWrite(
          "manage_contact", "unlock", "POST", contactId, "contact",
          `Unlock contact ${contactId}`,
          {},
        );
        return executeManageContact({ action: "unlock", contactId }, creds, env);
      },
      async resetPassword(contactId: string, newPassword: string) {
        await confirmAndWrite(
          "manage_contact", "reset_password", "POST", contactId, "contact",
          `Reset password for contact ${contactId}`,
          {},
        );
        return executeManageContact({ action: "reset_password", contactId, newPassword }, creds, env);
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
        return executeManageMerchantAccount({ action: "create", entityType, entityId, fields }, creds, env);
      },
      async edit(merchantAccountId: string, fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_merchant_account", "edit", "POST", merchantAccountId, "merchant_account",
          `Edit merchant account ${merchantAccountId}`,
          { fields },
        );
        return executeManageMerchantAccount({ action: "edit", merchantAccountId, fields }, creds, env);
      },
      async delete(merchantAccountId: string) {
        await confirmAndWrite(
          "manage_merchant_account", "delete", "DELETE", merchantAccountId, "merchant_account",
          `Delete merchant account ${merchantAccountId}`,
          {},
        );
        return executeManageMerchantAccount({ action: "delete", merchantAccountId }, creds, env);
      },
      async attach(entityType: EntityType, entityId: string, merchantAccountId: string, subTypes: string, currency: string) {
        await confirmAndWrite(
          "manage_merchant_account", "attach", "POST", entityId, entityType,
          `Attach merchant account ${merchantAccountId} to ${entityType} ${entityId}`,
          { merchantAccountId, subTypes, currency },
        );
        return executeManageMerchantAccount({ action: "attach", entityType, entityId, fields: { merchantAccountId, subTypes, currency } }, creds, env);
      },
      async detach(attachedMerchantAccountId: string) {
        await confirmAndWrite(
          "manage_merchant_account", "detach", "DELETE", attachedMerchantAccountId, "merchant_account",
          `Detach merchant account relationship ${attachedMerchantAccountId}`,
          {},
        );
        return executeManageMerchantAccount({ action: "detach", attachedMerchantAccountId }, creds, env);
      },
      async threeDCheck(merchantAccountId: string) {
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
