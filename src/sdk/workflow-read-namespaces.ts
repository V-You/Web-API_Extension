import { normalizeListResult, LIST_KEYS } from "../lib/list-contract";
import type { ApiCredentials, Environment } from "../lib/types";
import { executeDescribeSettings } from "../tools/describe-settings";
import { executeGetAuditLog, type GetAuditLogInput } from "../tools/get-audit-log";
import { executeLookupClearingInstitutes } from "../tools/lookup-clearing-institutes";
import { listCardProcessors } from "../tools/card-processors";

export interface WorkflowReadNamespacesOptions {
  creds: ApiCredentials;
  env: Environment;
  resolveCardProcessorPspId?: (pspId?: string) => Promise<string | undefined> | string | undefined;
}

export function createWorkflowReadNamespaces(options: WorkflowReadNamespacesOptions) {
  const resolvePspId = async (pspId?: string) => options.resolveCardProcessorPspId
    ? options.resolveCardProcessorPspId(pspId)
    : pspId;

  return {
    clearingInstitutes: {
      async search(query: string) {
        return normalizeListResult(
          await executeLookupClearingInstitutes({ action: "search", query }, options.creds, options.env),
          { label: `search clearing institutes "${query}"`, candidateKeys: [...LIST_KEYS.clearingInstitutesSearch] },
        );
      },
      async getFields(ciCode: string) {
        return executeLookupClearingInstitutes({ action: "get_fields", ciCode }, options.creds, options.env);
      },
      async listLive(pspId: string) {
        return normalizeListResult(
          await executeLookupClearingInstitutes({ action: "list_live", pspId }, options.creds, options.env),
          { label: `list live clearing institutes for psp ${pspId}`, candidateKeys: [...LIST_KEYS.clearingInstitutesLive] },
        );
      },
    },

    cardProcessors: {
      async list(pspId?: string) {
        const resolvedPspId = await resolvePspId(pspId);
        return normalizeListResult(
          await listCardProcessors(resolvedPspId, options.creds, options.env),
          { label: `list card processors${resolvedPspId ? ` for psp ${resolvedPspId}` : ""}`, candidateKeys: [...LIST_KEYS.cardProcessors] },
        );
      },
      async listLive(pspId?: string) {
        const resolvedPspId = await resolvePspId(pspId);
        return normalizeListResult(
          await listCardProcessors(resolvedPspId, options.creds, options.env),
          { label: `list live card processors${resolvedPspId ? ` for psp ${resolvedPspId}` : ""}`, candidateKeys: [...LIST_KEYS.cardProcessors] },
        );
      },
      async search(query: string) {
        return normalizeListResult(
          await executeLookupClearingInstitutes({ action: "search", query }, options.creds, options.env),
          { label: `search card processors "${query}"`, candidateKeys: [...LIST_KEYS.clearingInstitutesSearch] },
        );
      },
      async getFields(ciCode: string) {
        return executeLookupClearingInstitutes({ action: "get_fields", ciCode }, options.creds, options.env);
      },
    },

    describeSettings(query: string, limit?: number) {
      return executeDescribeSettings({ query, limit });
    },

    audit: {
      async get(opts?: GetAuditLogInput) {
        return executeGetAuditLog(opts ?? {});
      },
    },
  };
}

export type WorkflowReadNamespaces = ReturnType<typeof createWorkflowReadNamespaces>;
