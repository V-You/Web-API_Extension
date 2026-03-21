/**
 * SDK facade for the sandbox.
 *
 * Wraps all tool handlers as SDK-style async methods so the agent's script
 * can call sdk.entities.get(...) instead of executeManageEntity({action:"get",...}).
 *
 * Also exposes the VirtualSdk.config for typed settings operations.
 */

import { createSdk, type SdkContext } from "../sdk/sdk";
import { apiRequest } from "../lib/api-client";
import type { EntityType } from "../lib/entity-types";
import type { ApiCredentials, Environment } from "../lib/types";
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
 * Write operations are recorded into the writes array so the
 * preview/confirm bridge (step 5) can intercept them.
 */
export function buildSdkFacade(
  creds: ApiCredentials,
  env: Environment,
  writes: WriteRecord[]
) {
  const ctx: SdkContext = { creds, env };
  const virtualSdk = createSdk(ctx);

  function recordWrite(tool: string, action: string, entityId: string, entityType: string, params: Record<string, unknown>) {
    writes.push({ tool, action, entityId, entityType, params, timestamp: new Date().toISOString() });
  }

  return {
    // -- Settings (the typed proxy from step 3) --
    config: virtualSdk.config,

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
        recordWrite("manage_entity", "create", parentId, parentType, { childType, fields });
        return executeManageEntity({ action: "create", parentType, parentId, childType, fields }, creds, env);
      },
      async edit(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        recordWrite("manage_entity", "edit", entityId, entityType, { fields });
        return executeManageEntity({ action: "edit", entityType, entityId, fields }, creds, env);
      },
      async delete(entityType: EntityType, entityId: string) {
        recordWrite("manage_entity", "delete", entityId, entityType, {});
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
        recordWrite("manage_contact", "create", entityId, entityType, { fields });
        return executeManageContact({ action: "create", entityType, entityId, fields }, creds, env);
      },
      async edit(contactId: string, fields: Record<string, string>) {
        recordWrite("manage_contact", "edit", contactId, "contact", { fields });
        return executeManageContact({ action: "edit", contactId, fields }, creds, env);
      },
      async delete(contactId: string) {
        recordWrite("manage_contact", "delete", contactId, "contact", {});
        return executeManageContact({ action: "delete", contactId }, creds, env);
      },
      async attach(entityType: EntityType, entityId: string, contactId: string) {
        recordWrite("manage_contact", "attach", entityId, entityType, { contactId });
        return executeManageContact({ action: "attach", entityType, entityId, contactId }, creds, env);
      },
      async detach(entityType: EntityType, entityId: string, contactId: string) {
        recordWrite("manage_contact", "detach", entityId, entityType, { contactId });
        return executeManageContact({ action: "detach", entityType, entityId, contactId }, creds, env);
      },
      async lock(contactId: string) {
        recordWrite("manage_contact", "lock", contactId, "contact", {});
        return executeManageContact({ action: "lock", contactId }, creds, env);
      },
      async unlock(contactId: string) {
        recordWrite("manage_contact", "unlock", contactId, "contact", {});
        return executeManageContact({ action: "unlock", contactId }, creds, env);
      },
      async resetPassword(contactId: string, newPassword: string) {
        recordWrite("manage_contact", "reset_password", contactId, "contact", {});
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
        recordWrite("manage_merchant_account", "create", entityId, entityType, { fields });
        return executeManageMerchantAccount({ action: "create", entityType, entityId, fields }, creds, env);
      },
      async edit(merchantAccountId: string, fields: Record<string, string>) {
        recordWrite("manage_merchant_account", "edit", merchantAccountId, "merchant_account", { fields });
        return executeManageMerchantAccount({ action: "edit", merchantAccountId, fields }, creds, env);
      },
      async delete(merchantAccountId: string) {
        recordWrite("manage_merchant_account", "delete", merchantAccountId, "merchant_account", {});
        return executeManageMerchantAccount({ action: "delete", merchantAccountId }, creds, env);
      },
      async attach(entityType: EntityType, entityId: string, merchantAccountId: string, subTypes: string, currency: string) {
        recordWrite("manage_merchant_account", "attach", entityId, entityType, { merchantAccountId, subTypes, currency });
        return executeManageMerchantAccount({ action: "attach", entityType, entityId, fields: { merchantAccountId, subTypes, currency } }, creds, env);
      },
      async detach(attachedMerchantAccountId: string) {
        recordWrite("manage_merchant_account", "detach", attachedMerchantAccountId, "merchant_account", {});
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
