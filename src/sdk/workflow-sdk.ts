import { executeGetHierarchy } from "../tools/get-hierarchy";
import { executeManageEntity } from "../tools/manage-entity";
import type { ApiCredentials, Environment } from "../lib/types";
import type { EntityType } from "../lib/entity-types";
import { createSdk, type SdkContext } from "./sdk";
import { createWorkflowSettingsNamespaces } from "./workflow-settings-namespaces";
import { createWorkflowEntityNamespace } from "./workflow-entity-namespace";
import { createWorkflowContactNamespace } from "./workflow-contact-namespace";
import { createWorkflowMerchantAccountNamespace } from "./workflow-merchant-account-namespace";
import { createWorkflowReadNamespaces } from "./workflow-read-namespaces";
import { createWorkflowTransactionsNamespace, type WorkflowTransactionWriteRecord } from "./workflow-transactions-namespace";
import type { WorkflowWritePreview } from "./workflow-entity-namespace";

export interface WorkflowSdkHost {
  entityWriteTransport: "typedTool" | "internalHandler";
  contactWriteTransport: "typedTool" | "internalHandler";
  merchantAccountWriteTransport: "typedTool" | "internalHandler";
  beforeSettingsWrite: (preview: WorkflowWritePreview) => Promise<void>;
  beforeEntityWrite: (preview: WorkflowWritePreview) => Promise<void>;
  beforeContactWrite: (preview: WorkflowWritePreview) => Promise<void>;
  beforeMerchantAccountWrite: (preview: WorkflowWritePreview) => Promise<void>;
  recordTransactionWrite: (record: WorkflowTransactionWriteRecord) => void;
  planOnlyWrites?: boolean;
  signal?: AbortSignal;
  throttleRate?: number;
  mapEntityGetResult?: (result: unknown) => unknown;
  mapContactGetResult?: (result: unknown) => unknown;
  resolveCardProcessorPspId?: (pspId?: string) => Promise<string | undefined> | string | undefined;
  resolveMerchantAccountCreateFields?: (fields: Record<string, string>) => Promise<Record<string, string>>;
  validateMerchantAccountEditFields?: boolean;
  bypassTransactionConfirmation?: boolean;
  resolveTransactionParams?: (params: Record<string, unknown>, mode: "single" | "batch") => Promise<Record<string, unknown>>;
  includeManagementNamespace?: boolean;
  mapManagementEntityGetResult?: (result: unknown) => unknown;
}

export interface CreateWorkflowSdkOptions {
  creds: ApiCredentials;
  env: Environment;
  host: WorkflowSdkHost;
}

export function createWorkflowSdk(options: CreateWorkflowSdkOptions) {
  const { creds, env, host } = options;
  const ctx: SdkContext = { creds, env, signal: host.signal, throttleRate: host.throttleRate };
  const virtualSdk = createSdk(ctx);
  const settingsNamespaces = createWorkflowSettingsNamespaces({
    config: virtualSdk.config,
    planOnlyWrites: host.planOnlyWrites,
    beforeWrite: host.beforeSettingsWrite,
  });
  const readNamespaces = createWorkflowReadNamespaces({
    creds,
    env,
    resolveCardProcessorPspId: host.resolveCardProcessorPspId,
  });
  const facade = {
    config: settingsNamespaces.config,
    settings: settingsNamespaces.settings,
    entities: createWorkflowEntityNamespace({
      creds,
      env,
      writeTransport: host.entityWriteTransport,
      planOnlyWrites: host.planOnlyWrites,
      mapGetResult: host.mapEntityGetResult,
      beforeWrite: host.beforeEntityWrite,
    }),
    hierarchy: {
      async fetch(pspId: string, depth?: number) {
        return executeGetHierarchy({ pspId, depth }, creds, env);
      },
      async estimate(pspId: string, depth?: number) {
        return executeGetHierarchy({ pspId, depth, estimateOnly: true }, creds, env);
      },
    },
    contacts: createWorkflowContactNamespace({
      creds,
      env,
      writeTransport: host.contactWriteTransport,
      planOnlyWrites: host.planOnlyWrites,
      signal: host.signal,
      throttleRate: host.throttleRate,
      mapGetResult: host.mapContactGetResult,
      beforeWrite: host.beforeContactWrite,
    }),
    merchantAccounts: createWorkflowMerchantAccountNamespace({
      creds,
      env,
      writeTransport: host.merchantAccountWriteTransport,
      planOnlyWrites: host.planOnlyWrites,
      resolveCreateFields: host.resolveMerchantAccountCreateFields,
      validateEditFields: host.validateMerchantAccountEditFields,
      beforeWrite: host.beforeMerchantAccountWrite,
    }),
    clearingInstitutes: readNamespaces.clearingInstitutes,
    cardProcessors: readNamespaces.cardProcessors,
    describeSettings: readNamespaces.describeSettings,
    audit: readNamespaces.audit,
    transactions: createWorkflowTransactionsNamespace({
      creds,
      env,
      planOnlyWrites: host.planOnlyWrites,
      bypassWriteConfirmation: host.bypassTransactionConfirmation,
      resolveParams: host.resolveTransactionParams,
      recordWrite: host.recordTransactionWrite,
    }),
    ...(host.includeManagementNamespace ? {
      management: {
        entities: {
          async get(entityType: EntityType, entityId: string) {
            const result = await executeManageEntity({ action: "get", entityType, entityId }, creds, env);
            return host.mapManagementEntityGetResult ? host.mapManagementEntityGetResult(result) : result;
          },
        },
      },
    } : {}),
  };

  return facade;
}

export type WorkflowSdk = ReturnType<typeof createWorkflowSdk>;
