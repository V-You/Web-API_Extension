import type { EntityType } from "../lib/entity-types";
import { normalizeListResult, merchantAccountScopeKeys } from "../lib/list-contract";
import type { ApiCredentials, Environment } from "../lib/types";
import { executeManageMerchantAccount, type ManageMerchantAccountInput } from "../tools/manage-merchant-account";
import { executeTypedTool } from "../tools/adapter";
import { knownFieldNames, pickOperation } from "../tools/manifest-helpers";
import { assertNoForbiddenFields } from "../tools/forbidden-fields";
import { assertLiveContract } from "../tools/live-contracts";
import type { WorkflowWritePreview } from "./workflow-entity-namespace";

type MerchantAccountWriteTransport = "typedTool" | "internalHandler";

type MerchantAccountCreateResult = Record<string, unknown> & {
  id?: string;
  merchantAccountId?: string;
  name?: string;
};

export interface WorkflowMerchantAccountNamespaceOptions {
  creds: ApiCredentials;
  env: Environment;
  writeTransport: MerchantAccountWriteTransport;
  beforeWrite: (preview: WorkflowWritePreview) => Promise<void>;
  planOnlyWrites?: boolean;
  resolveCreateFields?: (fields: Record<string, string>) => Promise<Record<string, string>>;
  validateEditFields?: boolean;
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

function assertOperationSucceeded<T>(result: T, description: string): T {
  if (!isRecord(result)) return result;
  const errors = Array.isArray(result.errors) ? result.errors.map(String).filter(Boolean) : [];
  if (errors.length > 0) throw new Error(`${description} failed: ${errors.join("; ")}`);
  if (result.ok === false) throw new Error(`${description} failed: ${writeFailureMessage(result)}`);
  if (typeof result.error === "string" && result.error.trim()) throw new Error(`${description} failed: ${result.error.trim()}`);
  return result;
}

function plannedResult(tool: string, params: Record<string, unknown>) {
  return { ok: true, status: 0, data: { planned: true, tool, params } };
}

function normalizeListField(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean).join(",");
  return String(value ?? "").trim();
}

function normalizeClearingInstituteIdentifier(fields: Record<string, string>) {
  const id = fields.clearingInstituteId?.trim();
  if (!id || /^[a-f0-9]{32}$/i.test(id)) return;
  if (!fields.clearingInstituteName) fields.clearingInstituteName = id;
  delete fields.clearingInstituteId;
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
  assertLiveContract("create_merchant_account", fields);
}

function assertMerchantAccountAttachFields(merchantAccountId: string, subTypes: string, currency: string) {
  assertLiveContract("attach_merchant_account", { merchantAccountId, subTypes, currency });
}

function withMerchantAccountCreateAliases(result: unknown, fields: Record<string, string>): MerchantAccountCreateResult {
  if (!isRecord(result)) return result as MerchantAccountCreateResult;
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

async function executeMerchantWrite(
  options: WorkflowMerchantAccountNamespaceOptions,
  typedToolName: string,
  typedParams: Record<string, unknown>,
  internalInput: ManageMerchantAccountInput,
  description: string,
) {
  if (options.planOnlyWrites) return plannedResult(typedToolName, typedParams);

  if (options.writeTransport === "typedTool") {
    return assertOperationSucceeded(
      await executeTypedTool(typedToolName, typedParams, { creds: options.creds, env: options.env, confirm: true }),
      typedToolName,
    );
  }

  return assertOperationSucceeded(
    await executeManageMerchantAccount(internalInput, options.creds, options.env),
    description,
  );
}

export function createWorkflowMerchantAccountNamespace(options: WorkflowMerchantAccountNamespaceOptions) {
  const namespace = {
    async get(merchantAccountId: string) {
      return executeManageMerchantAccount({ action: "get", merchantAccountId }, options.creds, options.env);
    },

    async list(entityType: EntityType, entityId: string, scope?: "owned" | "attached") {
      return normalizeListResult(
        await executeManageMerchantAccount({ action: "list", entityType, entityId, scope }, options.creds, options.env),
        { label: `list merchant accounts on ${entityType} ${entityId}`, candidateKeys: merchantAccountScopeKeys(scope) },
      );
    },

    async create(...args: unknown[]) {
      const { entityType, entityId, fields: rawFields } = normalizeMerchantAccountCreateArgs(args);
      const fields = options.resolveCreateFields ? await options.resolveCreateFields(rawFields) : rawFields;
      assertManifestFields("create_merchant_account", entityType, fields);
      assertMerchantAccountCreateContract(fields);
      await options.beforeWrite({
        tool: "manage_merchant_account",
        action: "create",
        method: "POST",
        entityId,
        entityType,
        description: `Create merchant account on ${entityType} ${entityId}`,
        params: { fields },
      });
      return withMerchantAccountCreateAliases(
        await executeMerchantWrite(
          options,
          "create_merchant_account",
          { parentType: entityType, parentId: entityId, ...fields },
          { action: "create", entityType, entityId, fields },
          "merchant account create",
        ),
        fields,
      );
    },

    async edit(...args: unknown[]) {
      const { merchantAccountId, fields } = normalizeMerchantAccountEditArgs(args);
      if (options.validateEditFields) assertManifestFields("edit_merchant_account", null, fields);
      await options.beforeWrite({
        tool: "manage_merchant_account",
        action: "edit",
        method: "POST",
        entityId: merchantAccountId,
        entityType: "merchant_account",
        description: `Edit merchant account ${merchantAccountId}`,
        params: { fields },
      });
      return executeMerchantWrite(
        options,
        "edit_merchant_account",
        { merchantAccountId, ...fields },
        { action: "edit", merchantAccountId, fields },
        "merchant account edit",
      );
    },

    async update(...args: unknown[]) {
      return namespace.edit(...args);
    },

    async activate(...args: unknown[]) {
      const { entityType, entityId, merchantAccountId, subTypes, currency } = normalizeMerchantAccountAttachArgs(args);
      return namespace.attach(entityType, entityId, merchantAccountId, subTypes, currency);
    },

    async delete(merchantAccountId: string) {
      await options.beforeWrite({
        tool: "manage_merchant_account",
        action: "delete",
        method: "DELETE",
        entityId: merchantAccountId,
        entityType: "merchant_account",
        description: `Delete merchant account ${merchantAccountId}`,
        params: {},
      });
      return executeMerchantWrite(
        options,
        "delete_merchant_account",
        { merchantAccountId },
        { action: "delete", merchantAccountId },
        "merchant account delete",
      );
    },

    async attach(...args: unknown[]) {
      const { entityType, entityId, merchantAccountId, subTypes, currency } = normalizeMerchantAccountAttachArgs(args);
      assertMerchantAccountAttachFields(merchantAccountId, subTypes, currency);
      await options.beforeWrite({
        tool: "manage_merchant_account",
        action: "attach",
        method: "POST",
        entityId,
        entityType,
        description: `Attach merchant account ${merchantAccountId} to ${entityType} ${entityId}`,
        params: { merchantAccountId, subTypes, currency },
      });
      return executeMerchantWrite(
        options,
        "attach_merchant_account",
        { parentType: entityType, parentId: entityId, merchantAccountId, subTypes, currency },
        { action: "attach", entityType, entityId, merchantAccountId, subTypes, currency },
        "merchant account attach",
      );
    },

    async detach(attachedMerchantAccountId: string) {
      await options.beforeWrite({
        tool: "manage_merchant_account",
        action: "detach",
        method: "DELETE",
        entityId: attachedMerchantAccountId,
        entityType: "merchant_account",
        description: `Detach merchant account relationship ${attachedMerchantAccountId}`,
        params: {},
      });
      return executeMerchantWrite(
        options,
        "detach_merchant_account",
        { attachedMerchantAccountId },
        { action: "detach", attachedMerchantAccountId },
        "merchant account detach",
      );
    },

    async threeDCheck(merchantAccountId: string) {
      return executeManageMerchantAccount({ action: "three_d_check", merchantAccountId }, options.creds, options.env);
    },
  };

  return namespace;
}

export type WorkflowMerchantAccountNamespace = ReturnType<typeof createWorkflowMerchantAccountNamespace>;
