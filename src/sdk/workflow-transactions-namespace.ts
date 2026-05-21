import type { ApiCredentials, Environment } from "../lib/types";
import { executeSendTestTransaction, executeSendTestTransactions } from "../tools/send-test-transaction";

export interface WorkflowTransactionWriteRecord {
  tool: string;
  action: string;
  entityId: string;
  entityType: string;
  params: Record<string, unknown>;
}

export interface WorkflowTransactionsNamespaceOptions {
  creds: ApiCredentials;
  env: Environment;
  planOnlyWrites?: boolean;
  bypassWriteConfirmation?: boolean;
  resolveParams?: (params: Record<string, unknown>, mode: "single" | "batch") => Promise<Record<string, unknown>>;
  recordWrite: (record: WorkflowTransactionWriteRecord) => void;
}

function plannedResult(tool: string, params: Record<string, unknown>) {
  return { ok: true, status: 0, data: { planned: true, tool, params } };
}

async function resolveParams(options: WorkflowTransactionsNamespaceOptions, params: Record<string, unknown>, mode: "single" | "batch") {
  return options.resolveParams ? options.resolveParams(params, mode) : params;
}

function channelIdFrom(params: Record<string, unknown>): string {
  return String(params.channelId ?? "");
}

export function createWorkflowTransactionsNamespace(options: WorkflowTransactionsNamespaceOptions) {
  const record = (tool: string, action: string, params: Record<string, unknown>) => {
    options.recordWrite({
      tool,
      action,
      entityId: channelIdFrom(params),
      entityType: "channel",
      params,
    });
  };

  return {
    async sendTest(params: Record<string, unknown>) {
      const resolvedParams = await resolveParams(options, params, "single");
      if (options.planOnlyWrites) {
        record("send_test_transaction", "send", resolvedParams);
        return plannedResult("send_test_transaction", resolvedParams);
      }
      return executeSendTestTransaction(resolvedParams, options.creds, options.env, {
        bypassWriteConfirmation: options.bypassWriteConfirmation === true,
        onWriteAccepted: () => record("send_test_transaction", "send", resolvedParams),
      });
    },

    async sendTestBatch(params: Record<string, unknown>) {
      const resolvedParams = await resolveParams(options, params, "batch");
      if (options.planOnlyWrites) {
        record("send_test_transactions", "send_batch", resolvedParams);
        return plannedResult("send_test_transactions", resolvedParams);
      }
      return executeSendTestTransactions(resolvedParams, options.creds, options.env, {
        bypassWriteConfirmation: options.bypassWriteConfirmation === true,
        onWriteAccepted: () => record("send_test_transactions", "send_batch", resolvedParams),
      });
    },
  };
}

export type WorkflowTransactionsNamespace = ReturnType<typeof createWorkflowTransactionsNamespace>;
