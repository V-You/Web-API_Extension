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
import { extractEntityCollection } from "../lib/api-shapes";
import {
  normalizeListResult as sharedNormalizeListResult,
  contactScopeKeys,
  merchantAccountScopeKeys,
  LIST_KEYS,
} from "../lib/list-contract";
import type { ApiCredentials, Environment } from "../lib/types";
import { requestConfirm, type WritePreview } from "../bridge/confirm-bridge";
import { recordWrite } from "../bridge/write-status";
import { wrapSdkWithGuard } from "./sdk-guard";
import { executeTypedTool, type AdapterResult } from "../tools/adapter";
import { knownFieldNames, pickOperation } from "../tools/manifest-helpers";
import { assertNoForbiddenFields } from "../tools/forbidden-fields";
import { assertLiveContract } from "../tools/live-contracts";
import { executeManageEntity } from "../tools/manage-entity";
import { executeGetHierarchy } from "../tools/get-hierarchy";
import { executeManageContact } from "../tools/manage-contact";
import { executeManageMerchantAccount } from "../tools/manage-merchant-account";
import { executeLookupClearingInstitutes } from "../tools/lookup-clearing-institutes";
import { listCardProcessors } from "../tools/card-processors";
import { executeDescribeSettings } from "../tools/describe-settings";
import { executeGetAuditLog, type GetAuditLogInput } from "../tools/get-audit-log";
import { executeSendTestTransaction, executeSendTestTransactions } from "../tools/send-test-transaction";
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

type MerchantAccountCreateResult = AdapterResult & {
  id?: string;
  merchantAccountId?: string;
  name?: string;
};

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

export interface SdkFacadeOptions {
  autoConfirmWrites?: boolean;
  planOnlyWrites?: boolean;
}

function plannedResult(tool: string, params: Record<string, unknown>): AdapterResult {
  return { ok: true, status: 0, data: { planned: true, tool, params } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function writeFailureMessage(result: Record<string, unknown>): string {
  const outcome = isRecord(result.apiOutcome) ? result.apiOutcome : null;
  const data = isRecord(result.data) ? result.data : null;
  const dataError = isRecord(data?.error) ? data.error : null;
  const messages = [
    stringValue(outcome?.errorCode),
    stringValue(outcome?.errorMessage),
    stringValue(dataError?.code),
    stringValue(dataError?.message),
    stringValue(data?.error),
  ].filter(Boolean);
  if (messages.length > 0) return messages.join(" - ");
  return typeof result.status === "number" ? `HTTP ${result.status}` : "unknown error";
}

function assertWriteSucceeded<T>(result: T, description: string): T {
  if (!isRecord(result)) return result;
  const errors = Array.isArray(result.errors) ? result.errors.map(String).filter(Boolean) : [];
  if (errors.length > 0) throw new Error(`${description} failed: ${errors.join("; ")}`);
  if (result.ok === false) throw new Error(`${description} failed: ${writeFailureMessage(result)}`);
  if (typeof result.error === "string" && result.error.trim()) throw new Error(`${description} failed: ${result.error.trim()}`);
  return result;
}

/**
 * Universal SDK list contract.
 *
 * Re-export of `normalizeListResult` from src/lib/list-contract.ts so the
 * sandbox facade and the SW job executor share one implementation. Every
 * `sdk.*.list*` / `sdk.*.search` SDK method must route through this helper
 * (see md/2026-05-18_PRD_contract-first-workflow-sdk.md).
 */
export const normalizeListResult = sharedNormalizeListResult;

function normalizeEntityListResult(result: unknown, childType: EntityType): Record<string, unknown>[] {
  if (isRecord(result)) {
    if (result.ok === false) throw new Error(`list ${childType} failed: ${writeFailureMessage(result)}`);
    if (typeof result.error === "string" && result.error.trim()) throw new Error(`list ${childType} failed: ${result.error.trim()}`);
  }

  const data = isRecord(result) && "data" in result ? result.data : result;
  return extractEntityCollection(childType, data).map((item) => {
    const normalized = { ...item };
    const entityId = typeof normalized._entityId === "string" && normalized._entityId.trim()
      ? normalized._entityId
      : childType === "channel" && typeof normalized.channel === "string" && normalized.channel.trim()
        ? normalized.channel
        : null;
    if (entityId && typeof normalized.id !== "string") normalized.id = entityId;
    return normalized;
  });
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const fields = Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .map(([key, entry]) => [key, String(entry)]),
  );
  if (fields.status && !fields.state) fields.state = fields.status === "ACTIVE" ? "LIVE" : fields.status;
  delete fields.status;
  if (fields.id && !fields.merchantId) fields.merchantId = fields.id;
  delete fields.id;
  if (fields.mid && !fields.merchantId) fields.merchantId = fields.mid;
  delete fields.mid;
  if (fields.identification && !fields.merchantId) fields.merchantId = fields.identification;
  delete fields.identification;
  if (fields.merchant_id && !fields.merchantId) fields.merchantId = fields.merchant_id;
  delete fields.merchant_id;
  if (fields.merchant_name && !fields.name) fields.name = fields.merchant_name;
  delete fields.merchant_name;
  if (fields.merchantName && !fields.name) fields.name = fields.merchantName;
  delete fields.merchantName;
  if (fields.clearingInstitute && !fields.clearingInstituteName) fields.clearingInstituteName = fields.clearingInstitute;
  delete fields.clearingInstitute;
  if (fields.ciId && !fields.clearingInstituteId) fields.clearingInstituteId = fields.ciId;
  delete fields.ciId;
  normalizeClearingInstituteIdentifier(fields);
  if (fields.merchantId && !fields.name) fields.name = fields.merchantId;
  return fields;
}

function normalizeClearingInstituteIdentifier(fields: Record<string, string>) {
  const id = fields.clearingInstituteId?.trim();
  if (!id || /^[a-f0-9]{32}$/i.test(id)) return;
  if (!fields.clearingInstituteName) fields.clearingInstituteName = id;
  delete fields.clearingInstituteId;
}

function assertManifestFields(toolName: string, parentType: EntityType | null, fields: Record<string, string>) {
  assertNoForbiddenFields(toolName, fields);
  const op = pickOperation(toolName, parentType);
  if (!op) throw new Error(`Unknown generated operation: ${toolName}`);
  const known = knownFieldNames(op);
  const unknown = Object.keys(fields).filter((field) => !known.has(field));
  if (unknown.length > 0) {
    const accepted = op.request.map((field) => field.name).sort();
    throw new Error(`${toolName} received unknown field(s): ${unknown.join(", ")}. Accepted fields: ${accepted.join(", ")}`);
  }
}

function assertMerchantAccountCreateContract(fields: Record<string, string>) {
  // PRD 2026-05-18 Phase 1 / D1: required-field check moved to the live-contract overlay.
  assertLiveContract("create_merchant_account", fields);
}

function normalizeMerchantAccountAttachArgs(args: unknown[]): { entityType: EntityType; entityId: string; merchantAccountId: string; subTypes: string; currency: string } {
  const [first, second, third, fourth, fifth] = args;
  if (isRecord(first)) {
    return {
      entityType: String(first.parentType ?? first.entityType ?? "channel") as EntityType,
      entityId: String(first.parentId ?? first.entityId ?? ""),
      merchantAccountId: String(first.merchantAccountId ?? first.id ?? ""),
      subTypes: normalizeListField(first.subTypes ?? first.subType ?? first.paymentBrand ?? first.paymentBrands),
      currency: normalizeListField(first.currency ?? first.currencies),
    };
  }
  return {
    entityType: first as EntityType,
    entityId: String(second ?? ""),
    merchantAccountId: String(third ?? ""),
    subTypes: normalizeListField(fourth),
    currency: normalizeListField(fifth),
  };
}

function normalizeListField(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean).join(",");
  return String(value ?? "").trim();
}

function normalizeMerchantAccountCreateArgs(args: unknown[]): { entityType: EntityType; entityId: string; fields: Record<string, string> } {
  const [first, second, third] = args;
  if (isRecord(first)) {
    const entityType = String(first.parentType ?? first.entityType ?? "merchant") as EntityType;
    const entityId = String(first.parentId ?? first.entityId ?? first.merchantId ?? "");
    const nestedFields = isRecord(first.fields) ? first.fields : first;
    const { parentType: _parentType, parentId: _parentId, entityType: _entityType, entityId: _entityId, merchantId: _merchantId, fields: _fields, ...rest } = nestedFields;
    return { entityType, entityId, fields: toStringRecord(rest) };
  }
  if (typeof first === "string" && isRecord(second) && third === undefined) {
    return { entityType: "merchant", entityId: first, fields: toStringRecord(isRecord(second.fields) ? second.fields : second) };
  }
  return { entityType: first as EntityType, entityId: String(second ?? ""), fields: toStringRecord(third) };
}

function normalizeMerchantAccountEditArgs(args: unknown[]): { merchantAccountId: string; fields: Record<string, string> } {
  const [first, second] = args;
  if (isRecord(first)) {
    const merchantAccountId = String(first.merchantAccountId ?? first.id ?? "");
    const nestedFields = isRecord(first.fields) ? first.fields : first;
    const { merchantAccountId: _merchantAccountId, id: _id, fields: _fields, ...rest } = nestedFields;
    return { merchantAccountId, fields: toStringRecord(rest) };
  }
  return { merchantAccountId: String(first ?? ""), fields: toStringRecord(second) };
}

function withMerchantAccountCreateAliases(result: AdapterResult, fields: Record<string, string>): MerchantAccountCreateResult {
  const data = isRecord(result.data) ? result.data : {};
  const merchantAccountId = String(data.merchantAccountId ?? data.id ?? fields.merchantAccountId ?? fields.id ?? fields.merchantId ?? "");
  const name = String(data.name ?? fields.name ?? merchantAccountId);
  const aliases = {
    ...(merchantAccountId ? { id: merchantAccountId, merchantAccountId } : {}),
    ...(name ? { name } : {}),
  };
  return {
    ...result,
    ...aliases,
    data: {
      ...data,
      ...aliases,
    },
  };
}

function assertMerchantAccountAttachFields(merchantAccountId: string, subTypes: string, currency: string) {
  // PRD 2026-05-18 Phase 1 / D1: required-field check moved to the live-contract overlay.
  assertLiveContract("attach_merchant_account", { merchantAccountId, subTypes, currency });
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
  writes: WriteRecord[],
  options: SdkFacadeOptions = {},
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
    if (options.planOnlyWrites) {
      writes.push({ tool, action, entityId, entityType, params, timestamp: new Date().toISOString() });
      return;
    }

    if (options.autoConfirmWrites) {
      writes.push({ tool, action, entityId, entityType, params, timestamp: new Date().toISOString() });
      recordWrite(description);
      return;
    }

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
    return assertWriteSucceeded(await executeTypedTool(toolName, params, { creds, env, confirm: true }), toolName);
  }

  const facade = {
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
        if (options.planOnlyWrites) return { ok: true, applied: [], errors: [] };
        return assertWriteSucceeded(await virtualSdk.config.update(entityType, entityId, settings), "settings update");
      },
      async batchUpdate(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        const keys = Object.keys(settings);
        await confirmAndWrite(
          "config", "batch_update", "POST", entityId, entityType,
          `Batch update ${keys.length} setting(s) on ${entityType} ${entityId}`,
          { settings },
        );
        if (options.planOnlyWrites) return { ok: true, applied: [], errors: [] };
        return assertWriteSucceeded(await virtualSdk.config.batchUpdate(entityType, entityId, settings), "settings batch update");
      },
    },

    // -- Settings aliases --
    settings: {
      get: virtualSdk.config.get.bind(virtualSdk.config),
      batchGet: virtualSdk.config.batchGet.bind(virtualSdk.config),
      describe: virtualSdk.config.describe.bind(virtualSdk.config),
      validate: virtualSdk.config.validate.bind(virtualSdk.config),
      coverage: virtualSdk.config.coverage.bind(virtualSdk.config),
      async edit(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        const keys = Object.keys(settings);
        await confirmAndWrite(
          "config", "update", "POST", entityId, entityType,
          `Update ${keys.length} setting(s) on ${entityType} ${entityId}`,
          { settings },
        );
        if (options.planOnlyWrites) return { ok: true, applied: [], errors: [] };
        return assertWriteSucceeded(await virtualSdk.config.update(entityType, entityId, settings), "settings update");
      },
      async update(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        const keys = Object.keys(settings);
        await confirmAndWrite(
          "config", "update", "POST", entityId, entityType,
          `Update ${keys.length} setting(s) on ${entityType} ${entityId}`,
          { settings },
        );
        if (options.planOnlyWrites) return { ok: true, applied: [], errors: [] };
        return assertWriteSucceeded(await virtualSdk.config.update(entityType, entityId, settings), "settings update");
      },
      async batchEdit(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        const keys = Object.keys(settings);
        await confirmAndWrite(
          "config", "batch_update", "POST", entityId, entityType,
          `Batch update ${keys.length} setting(s) on ${entityType} ${entityId}`,
          { settings },
        );
        if (options.planOnlyWrites) return { ok: true, applied: [], errors: [] };
        return assertWriteSucceeded(await virtualSdk.config.batchUpdate(entityType, entityId, settings), "settings batch update");
      },
      async batchUpdate(entityType: EntityType, entityId: string, settings: Record<string, unknown>) {
        const keys = Object.keys(settings);
        await confirmAndWrite(
          "config", "batch_update", "POST", entityId, entityType,
          `Batch update ${keys.length} setting(s) on ${entityType} ${entityId}`,
          { settings },
        );
        if (options.planOnlyWrites) return { ok: true, applied: [], errors: [] };
        return assertWriteSucceeded(await virtualSdk.config.batchUpdate(entityType, entityId, settings), "settings batch update");
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
        return normalizeEntityListResult(
          await executeManageEntity({ action: "list_children", parentType, parentId, childType }, creds, env),
          childType,
        );
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
        if (options.planOnlyWrites) return plannedResult(toolName, { parentType, parentId, ...fields });
        return runTyped(toolName, { parentType, parentId, ...fields });
      },
      async edit(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_entity", "edit", "POST", entityId, entityType,
          `Edit ${entityType} ${entityId}`,
          { fields },
        );
        if (options.planOnlyWrites) return plannedResult("edit_entity", { parentType: entityType, parentId: entityId, ...fields });
        return runTyped("edit_entity", { parentType: entityType, parentId: entityId, ...fields });
      },
      async delete(entityType: EntityType, entityId: string) {
        await confirmAndWrite(
          "manage_entity", "delete", "DELETE", entityId, entityType,
          `Delete ${entityType} ${entityId}`,
          {},
        );
        if (options.planOnlyWrites) return plannedResult("delete_entity", { parentType: entityType, parentId: entityId });
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
        return normalizeListResult(
          await executeManageContact({ action: "list", entityType, entityId, scope }, creds, env),
          { label: `list contacts on ${entityType} ${entityId}`, candidateKeys: contactScopeKeys(scope) },
        );
      },
      async create(entityType: EntityType, entityId: string, fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_contact", "create", "POST", entityId, entityType,
          `Create contact on ${entityType} ${entityId}`,
          { fields },
        );
        if (options.planOnlyWrites) return plannedResult("create_contact", { parentType: entityType, parentId: entityId, ...fields });
        return runTyped("create_contact", { parentType: entityType, parentId: entityId, ...fields });
      },
      async edit(contactId: string, fields: Record<string, string>) {
        await confirmAndWrite(
          "manage_contact", "edit", "POST", contactId, "contact",
          `Edit contact ${contactId}`,
          { fields },
        );
        if (options.planOnlyWrites) return plannedResult("edit_contact", { contactId, ...fields });
        return runTyped("edit_contact", { contactId, ...fields });
      },
      async delete(contactId: string) {
        await confirmAndWrite(
          "manage_contact", "delete", "DELETE", contactId, "contact",
          `Delete contact ${contactId}`,
          {},
        );
        if (options.planOnlyWrites) return plannedResult("delete_contact", { contactId });
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
        if (options.planOnlyWrites) return plannedResult("manage_contact", { action: "attach", entityType, entityId, contactId });
        return assertWriteSucceeded(await executeManageContact({ action: "attach", entityType, entityId, contactId }, creds, env), "contact attach");
      },
      async detach(entityType: EntityType, entityId: string, contactId: string) {
        await confirmAndWrite(
          "manage_contact", "detach", "DELETE", entityId, entityType,
          `Detach contact ${contactId} from ${entityType} ${entityId}`,
          { contactId },
        );
        if (options.planOnlyWrites) return plannedResult("detach_contact", { parentType: entityType, parentId: entityId, contactId });
        return runTyped("detach_contact", { parentType: entityType, parentId: entityId, contactId });
      },
      async lock(contactId: string) {
        await confirmAndWrite(
          "manage_contact", "lock", "POST", contactId, "contact",
          `Lock contact ${contactId}`,
          {},
        );
        if (options.planOnlyWrites) return plannedResult("lock_contact", { contactId });
        return runTyped("lock_contact", { contactId });
      },
      async unlock(contactId: string) {
        await confirmAndWrite(
          "manage_contact", "unlock", "POST", contactId, "contact",
          `Unlock contact ${contactId}`,
          {},
        );
        if (options.planOnlyWrites) return plannedResult("unlock_contact", { contactId });
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
        if (options.planOnlyWrites) return plannedResult("set_contact_password", { contactId });
        return runTyped("set_contact_password", { contactId });
      },
    },

    // -- Merchant accounts --
    merchantAccounts: {
      async get(merchantAccountId: string) {
        return executeManageMerchantAccount({ action: "get", merchantAccountId }, creds, env);
      },
      async list(entityType: EntityType, entityId: string, scope?: "owned" | "attached") {
        return normalizeListResult(
          await executeManageMerchantAccount({ action: "list", entityType, entityId, scope }, creds, env),
          { label: `list merchant accounts on ${entityType} ${entityId}`, candidateKeys: merchantAccountScopeKeys(scope) },
        );
      },
      async create(...args: unknown[]) {
        const { entityType, entityId, fields } = normalizeMerchantAccountCreateArgs(args);
        assertManifestFields("create_merchant_account", entityType, fields);
        assertMerchantAccountCreateContract(fields);
        await confirmAndWrite(
          "manage_merchant_account", "create", "POST", entityId, entityType,
          `Create merchant account on ${entityType} ${entityId}`,
          { fields },
        );
        if (options.planOnlyWrites) return plannedResult("create_merchant_account", { parentType: entityType, parentId: entityId, ...fields });
        return withMerchantAccountCreateAliases(
          await runTyped("create_merchant_account", { parentType: entityType, parentId: entityId, ...fields }),
          fields,
        );
      },
      async edit(...args: unknown[]) {
        const { merchantAccountId, fields } = normalizeMerchantAccountEditArgs(args);
        await confirmAndWrite(
          "manage_merchant_account", "edit", "POST", merchantAccountId, "merchant_account",
          `Edit merchant account ${merchantAccountId}`,
          { fields },
        );
        if (options.planOnlyWrites) return plannedResult("edit_merchant_account", { merchantAccountId, ...fields });
        return runTyped("edit_merchant_account", { merchantAccountId, ...fields });
      },
      async update(...args: unknown[]) {
        const { merchantAccountId, fields } = normalizeMerchantAccountEditArgs(args);
        await confirmAndWrite(
          "manage_merchant_account", "edit", "POST", merchantAccountId, "merchant_account",
          `Edit merchant account ${merchantAccountId}`,
          { fields },
        );
        if (options.planOnlyWrites) return plannedResult("edit_merchant_account", { merchantAccountId, ...fields });
        return runTyped("edit_merchant_account", { merchantAccountId, ...fields });
      },
      async activate(...args: unknown[]) {
        const { entityType, entityId, merchantAccountId, subTypes, currency } = normalizeMerchantAccountAttachArgs(args);
        return this.attach(entityType, entityId, merchantAccountId, subTypes, currency);
      },
      async delete(merchantAccountId: string) {
        await confirmAndWrite(
          "manage_merchant_account", "delete", "DELETE", merchantAccountId, "merchant_account",
          `Delete merchant account ${merchantAccountId}`,
          {},
        );
        if (options.planOnlyWrites) return plannedResult("delete_merchant_account", { merchantAccountId });
        return runTyped("delete_merchant_account", { merchantAccountId });
      },
      async attach(...args: unknown[]) {
        const { entityType, entityId, merchantAccountId, subTypes, currency } = normalizeMerchantAccountAttachArgs(args);
        assertMerchantAccountAttachFields(merchantAccountId, subTypes, currency);
        // Part-II P2-D3 fix: pass merchantAccountId/subTypes/currency at top level
        // through the adapter, which coerces and form-encodes them. The previous
        // nested-under-`fields` shape short-circuited the internal handler.
        await confirmAndWrite(
          "manage_merchant_account", "attach", "POST", entityId, entityType,
          `Attach merchant account ${merchantAccountId} to ${entityType} ${entityId}`,
          { merchantAccountId, subTypes, currency },
        );
        if (options.planOnlyWrites) {
          return plannedResult("attach_merchant_account", {
            parentType: entityType,
            parentId: entityId,
            merchantAccountId,
            subTypes,
            currency,
          });
        }
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
        if (options.planOnlyWrites) return plannedResult("detach_merchant_account", { attachedMerchantAccountId });
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
        return normalizeListResult(
          await executeLookupClearingInstitutes({ action: "search", query }, creds, env),
          { label: `search clearing institutes "${query}"`, candidateKeys: [...LIST_KEYS.clearingInstitutesSearch] },
        );
      },
      async getFields(ciCode: string) {
        // Single-result lookup, not a list - return raw shape.
        return executeLookupClearingInstitutes({ action: "get_fields", ciCode }, creds, env);
      },
      async listLive(pspId: string) {
        return normalizeListResult(
          await executeLookupClearingInstitutes({ action: "list_live", pspId }, creds, env),
          { label: `list live clearing institutes for psp ${pspId}`, candidateKeys: [...LIST_KEYS.clearingInstitutesLive] },
        );
      },
    },

    // -- Card processor aliases --
    cardProcessors: {
      async list(pspId?: string) {
        return normalizeListResult(await listCardProcessors(pspId, creds, env), {
          label: `list card processors${pspId ? ` for psp ${pspId}` : ""}`,
          candidateKeys: [...LIST_KEYS.cardProcessors],
        });
      },
      async listLive(pspId?: string) {
        return normalizeListResult(await listCardProcessors(pspId, creds, env), {
          label: `list live card processors${pspId ? ` for psp ${pspId}` : ""}`,
          candidateKeys: [...LIST_KEYS.cardProcessors],
        });
      },
      async search(query: string) {
        return normalizeListResult(
          await executeLookupClearingInstitutes({ action: "search", query }, creds, env),
          { label: `search card processors "${query}"`, candidateKeys: [...LIST_KEYS.clearingInstitutesSearch] },
        );
      },
      async getFields(ciCode: string) {
        return executeLookupClearingInstitutes({ action: "get_fields", ciCode }, creds, env);
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

    // -- Test transactions --
    transactions: {
      async sendTest(params: Record<string, unknown>) {
        const channelId = String(params.channelId ?? "");
        const recordTransactionWrite = () => writes.push({
          tool: "send_test_transaction",
          action: "send",
          entityId: channelId,
          entityType: "channel",
          params,
          timestamp: new Date().toISOString(),
        });
        if (options.planOnlyWrites) {
          recordTransactionWrite();
          return plannedResult("send_test_transaction", params);
        }
        return executeSendTestTransaction(params, creds, env, {
          bypassWriteConfirmation: options.autoConfirmWrites === true,
          onWriteAccepted: recordTransactionWrite,
        });
      },
      async sendTestBatch(params: Record<string, unknown>) {
        const channelId = String(params.channelId ?? "");
        const recordTransactionWrite = () => writes.push({
          tool: "send_test_transactions",
          action: "send_batch",
          entityId: channelId,
          entityType: "channel",
          params,
          timestamp: new Date().toISOString(),
        });
        if (options.planOnlyWrites) {
          recordTransactionWrite();
          return plannedResult("send_test_transactions", params);
        }
        return executeSendTestTransactions(params, creds, env, {
          bypassWriteConfirmation: options.autoConfirmWrites === true,
          onWriteAccepted: recordTransactionWrite,
        });
      },
    },
  };

  // PRD 2026-05-18 D14: reject unknown SDK members at runtime with a
  // structured suggestion instead of letting them silently become
  // `undefined`. `config` is the Virtual Settings SDK proxy and owns its
  // own access semantics, so we pass it through untouched.
  return wrapSdkWithGuard(facade, { passthroughNamespaces: ["config"] });
}

/** Type of the sdk object injected into sandbox scripts. */
export type SdkFacade = ReturnType<typeof buildSdkFacade>;
