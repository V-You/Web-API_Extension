import { requestConfirm, type WritePreview } from "../bridge/confirm-bridge";
import { confirmIfMutating, describeMutatingCall } from "../bridge/write-confirm-utils";
import { getJobFresh, type JobRecord } from "../jobs/job-store";
import type { EntityType } from "../lib/entity-types";
import { getActiveEnv, getCredentials, getTransactionTokens } from "../lib/storage";
import type { TransactionTokenRecord } from "../lib/storage";
import { isChatAccessTokenControlEnabled } from "../chat/chat-mode";
import { sendExampleTransaction } from "../lib/transaction-client";
import { apiRequest } from "../lib/api-client";
import type { ApiCredentials, AuditEventType, Environment } from "../lib/types";
import { executeTypedTool, isReadOnlyTool } from "./adapter";
import { executeDescribeSettings } from "./describe-settings";
import { executeGetAuditLog } from "./get-audit-log";
import { executeGetHierarchy } from "./get-hierarchy";
import { executeLookupClearingInstitutes } from "./lookup-clearing-institutes";
import { executeManageContact } from "./manage-contact";
import { executeManageEntity } from "./manage-entity";
import { executeManageMerchantAccount } from "./manage-merchant-account";
import { executeManageSettings } from "./manage-settings";
import { executeWorkflow } from "./execute-workflow";
import { describeOperation } from "./describe-operation";
import { MANIFEST } from "./manifest-helpers";

const API_TOKEN_TOOLS = new Set([
  "list_api_tokens",
  "get_api_token",
  "create_api_token",
  "update_api_token",
  "suspend_api_token",
  "activate_api_token",
  "delete_api_token",
  "send_test_transaction",
]);

type TransactionTokenMode = "stored" | "temporary" | "auto";

interface ApiTokenMetadata {
  id?: string;
  alias?: string;
  apiBearerToken?: string;
  state?: string;
  lastDigits?: string;
  createdTime?: string;
  lastUsedTime?: string;
}

interface ApiTokenResponse {
  apiToken?: ApiTokenMetadata;
  error?: { message?: string };
}

export interface ToolSession {
  creds: ApiCredentials;
  env: Environment;
}

export type ExecuteFn = (params: Record<string, unknown>) => Promise<unknown>;

export interface ExecuteMapOptions {
  onWriteAccepted?: (description: string) => void;
  bypassWriteConfirmation?: boolean;
  startWorkflowJob?: (input: StartWorkflowJobInput) => Promise<StartWorkflowJobResult>;
}

export interface StartWorkflowJobInput {
  label: string;
  script: string;
  entityId?: string;
  entityType?: string;
  totalCalls: number;
  throttleRate?: number;
  timeoutMs?: number;
  creds: ApiCredentials;
  env: Environment;
}

export interface StartWorkflowJobResult {
  jobId: string;
  state: string;
  label: string;
  totalCalls: number;
}

export async function resolveSession(): Promise<ToolSession | null> {
  const env = await getActiveEnv();
  if (!env) return null;

  const creds = await getCredentials(env);
  if (!creds) return null;

  return { creds, env };
}

export async function sessionOrError(): Promise<ToolSession> {
  const session = await resolveSession();
  if (!session) {
    throw new Error("Session not unlocked. Open the side panel and enter your PIN first.");
  }

  return session;
}

function reportWriteAccepted(
  description: string | undefined,
  onWriteAccepted?: (description: string) => void,
) {
  if (description && onWriteAccepted) {
    onWriteAccepted(description);
  }
}

async function confirmOrDescribeIfMutating(
  tool: string,
  params: Record<string, unknown>,
  env: Environment,
  options: ExecuteMapOptions,
): Promise<string | undefined> {
  if (options.bypassWriteConfirmation) {
    return describeMutatingCall(tool, params)?.description;
  }
  return confirmIfMutating(tool, params, env);
}

async function confirmWorkflowIfNeeded(
  params: Record<string, unknown>,
  env: Environment,
  options: ExecuteMapOptions,
): Promise<boolean> {
  if (params.dryRun === true || params.planOnly === true) return false;
  if (options.bypassWriteConfirmation) return true;

  const preview: WritePreview = {
    tool: "execute_workflow",
    action: "execute",
    method: "POST",
    description: "Execute workflow script",
    params,
    env,
  };
  const choice = await requestConfirm(preview);
  if (choice === "cancel") throw new Error("Operation cancelled by user.");
  return true;
}

export function createExecuteMap(options: ExecuteMapOptions = {}): Record<string, ExecuteFn> {
  const map = buildHandwrittenExecuteMap(options);
  return registerGeneratedToolExecutors(map, options);
}

function buildHandwrittenExecuteMap(options: ExecuteMapOptions = {}): Record<string, ExecuteFn> {
  // Externally reachable umbrella actions (writes moved to per-action tools per Part-II P2-D1).
  const READ_ONLY_UMBRELLA_ACTIONS: Record<string, Set<string>> = {
    manage_entity: new Set(["get", "search", "list_children"]),
    manage_contact: new Set(["get", "list", "find_by_username"]),
    manage_merchant_account: new Set(["get", "list"]),
  };

  const guardReadOnly = (tool: string, action: unknown): void => {
    const allowed = READ_ONLY_UMBRELLA_ACTIONS[tool];
    if (!allowed) return;
    if (typeof action !== "string" || !allowed.has(action)) {
      throw new Error(
        `${tool} only supports read actions (${[...allowed].join(", ")}). ` +
          `For writes, use the dedicated per-action tools.`,
      );
    }
  };

  return {
    manage_entity: async (params) => {
      guardReadOnly("manage_entity", params.action);
      const { creds, env } = await sessionOrError();
      const description = await confirmOrDescribeIfMutating("manage_entity", params, env, options);
      const result = await executeManageEntity(
        {
          action: params.action as "get",
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as "psp" | undefined,
          namePath: params.namePath as string | undefined,
          parentId: params.parentId as string | undefined,
          parentType: params.parentType as "psp" | undefined,
          childType: params.childType as "division" | undefined,
          fields: params.fields as Record<string, string> | undefined,
        },
        creds,
        env,
      );
      reportWriteAccepted(description, options.onWriteAccepted);
      return result;
    },

    get_hierarchy: async (params) => {
      const { creds, env } = await sessionOrError();
      return executeGetHierarchy(
        {
          pspId: params.pspId as string | undefined,
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as EntityType | undefined,
          depth: params.depth as number | undefined,
          estimateOnly: params.estimateOnly as boolean | undefined,
        },
        creds,
        env,
      );
    },

    manage_contact: async (params) => {
      guardReadOnly("manage_contact", params.action);
      const { creds, env } = await sessionOrError();
      const description = await confirmOrDescribeIfMutating("manage_contact", params, env, options);
      const result = await executeManageContact(
        {
          action: params.action as "get",
          contactId: params.contactId as string | undefined,
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as "psp" | undefined,
          scope: params.scope as "owned" | "attached" | undefined,
          fields: params.fields as Record<string, string> | undefined,
          username: params.username as string | undefined,
          newPassword: params.newPassword as string | undefined,
        },
        creds,
        env,
      );
      reportWriteAccepted(description, options.onWriteAccepted);
      return result;
    },

    attach_contact: async (params) => {
      const { creds, env } = await sessionOrError();
      const attachParams = { ...params, action: "attach" };
      const description = await confirmOrDescribeIfMutating("manage_contact", attachParams, env, options);
      const result = await executeManageContact(
        {
          action: "attach",
          contactId: params.contactId as string | undefined,
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as EntityType | undefined,
        },
        creds,
        env,
      );
      reportWriteAccepted(description, options.onWriteAccepted);
      return result;
    },

    manage_merchant_account: async (params) => {
      guardReadOnly("manage_merchant_account", params.action);
      const { creds, env } = await sessionOrError();
      const description = await confirmOrDescribeIfMutating("manage_merchant_account", params, env, options);
      const result = await executeManageMerchantAccount(
        {
          action: params.action as "get",
          merchantAccountId: params.merchantAccountId as string | undefined,
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as "psp" | undefined,
          scope: params.scope as "owned" | "attached" | undefined,
          fields: params.fields as Record<string, string> | undefined,
          subTypes: params.subTypes as string | undefined,
          currency: params.currency as string | undefined,
          attachedMerchantAccountId: params.attachedMerchantAccountId as string | undefined,
        },
        creds,
        env,
      );
      reportWriteAccepted(description, options.onWriteAccepted);
      return result;
    },

    lookup_clearing_institutes: async (params) => {
      const { creds, env } = await sessionOrError();
      return executeLookupClearingInstitutes(
        {
          action: params.action as "search",
          query: params.query as string | undefined,
          ciCode: params.ciCode as string | undefined,
          pspId: params.pspId as string | undefined,
        },
        creds,
        env,
      );
    },

    describe_settings: async (params) => {
      return executeDescribeSettings({
        query: params.query as string,
        limit: params.limit as number | undefined,
      });
    },

    manage_settings: async (params) => {
      const { creds, env } = await sessionOrError();
      const description = await confirmOrDescribeIfMutating("manage_settings", params, env, options);
      const result = await executeManageSettings(
        {
          action: params.action as "get",
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as "psp" | undefined,
          key: params.key as string | undefined,
          value: params.value as string | undefined,
          entityIds: params.entityIds as string[] | undefined,
          keys: params.keys as string[] | undefined,
          settings: params.settings as Record<string, string> | undefined,
          query: params.query as string | undefined,
        },
        creds,
        env,
      );
      reportWriteAccepted(description, options.onWriteAccepted);
      return result;
    },

    get_audit_log: async (params) => {
      return executeGetAuditLog({
        eventType: params.eventType as AuditEventType | undefined,
        entityId: params.entityId as string | undefined,
        limit: params.limit as number | undefined,
        since: params.since as string | undefined,
      });
    },

    get_job_status: async (params) => {
      return getJobStatus(params.jobId as string | undefined, params.includeDetails === true);
    },

    execute_workflow: async (params) => {
      const { creds, env } = await sessionOrError();
      const autoConfirmWrites = await confirmWorkflowIfNeeded(params, env, options);

      if (params.dryRun !== true && params.planOnly !== true && options.startWorkflowJob) {
        const label = typeof params.label === "string" && params.label.trim()
          ? params.label.trim()
          : "WebMCP workflow";
        const totalCalls = normalizeTotalCalls(params.totalCalls);
        const receipt = await options.startWorkflowJob({
          label,
          script: params.script as string,
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as string | undefined,
          totalCalls,
          timeoutMs: params.timeoutMs as number | undefined,
          creds,
          env,
        });
        return {
          status: "accepted",
          jobId: receipt.jobId,
          state: receipt.state,
          label: receipt.label,
          totalCalls: receipt.totalCalls,
          message: "Workflow accepted as a background Job. Poll get_job_status with this jobId, and the user can monitor or cancel it in the extension Jobs tab.",
        };
      }

      return executeWorkflow(
        {
          script: params.script as string,
          entityId: params.entityId as string | undefined,
          entityType: params.entityType as string | undefined,
          dryRun: params.dryRun as boolean | undefined,
          planOnly: params.planOnly as boolean | undefined,
          timeoutMs: params.timeoutMs as number | undefined,
          autoConfirmWrites,
        },
        creds,
        env,
      );
    },

    describe_operation: async (params) => {
      return describeOperation({ toolName: params.toolName as string | undefined });
    },

    send_test_transaction: async (params) => {
      if (options.bypassWriteConfirmation !== true && !await isChatAccessTokenControlEnabled()) {
        throw new Error("Enable accessToken control in Chat settings before sending test transactions.");
      }

      const { creds, env } = await sessionOrError();
      if (env !== "uat") {
        throw new Error("Test transactions are only enabled for UAT. Switch the active environment to UAT before sending a test transaction.");
      }

      const channelId = String(params.channelId ?? "").trim();
      if (!channelId) throw new Error("channelId is required.");

      const tokenMode = normalizeTransactionTokenMode(params.tokenMode);
      const merchantId = String(params.merchantId ?? "").trim();
      const bodyText = buildTestTransactionBody(channelId, params);

      await confirmTestTransactionIfNeeded(params, env, tokenMode, bodyText, options);

      const tokens = await getTransactionTokens(env);
      const tokenId = String(params.transactionTokenId ?? "").trim();
      const storedToken = selectStoredTransactionToken(tokens, tokenId, merchantId, tokenMode);

      if (tokenMode === "stored") {
        if (!storedToken) throw new Error("No stored transaction token matched this request. Provide a matching merchantId or transactionTokenId, or use tokenMode=temporary.");
        const result = await sendExampleTransaction(env, storedToken.token, bodyText);
        options.onWriteAccepted?.(`send_test_transaction (${channelId})`);
        return buildStoredTransactionResult(result, storedToken, merchantId || storedToken.merchantId, channelId, tokenMode);
      }

      if (tokenMode === "auto" && storedToken) {
        const storedResult = await sendExampleTransaction(env, storedToken.token, bodyText);
        if (storedResult.ok || !isAuthenticationFailure(storedResult.data)) {
          options.onWriteAccepted?.(`send_test_transaction (${channelId})`);
          return buildStoredTransactionResult(storedResult, storedToken, merchantId || storedToken.merchantId, channelId, tokenMode);
        }

        if (!merchantId && !storedToken.merchantId) {
          return buildStoredTransactionResult(storedResult, storedToken, storedToken.merchantId, channelId, tokenMode);
        }

        const temporaryResult = await sendWithTemporaryTransactionToken(creds, env, merchantId || storedToken.merchantId, channelId, bodyText);
        options.onWriteAccepted?.(`send_test_transaction (${channelId})`);
        return {
          ...temporaryResult,
          previousAttempt: buildStoredTransactionResult(storedResult, storedToken, merchantId || storedToken.merchantId, channelId, tokenMode),
        };
      }

      if (!merchantId) {
        throw new Error("merchantId is required for temporary transaction token creation. If the target is a Channel, call get_entity or manage_entity get for that Channel and derive the Merchant parent from _parent, merchantId, sender, parentId, or nearby hierarchy context before asking the user.");
      }

      const result = await sendWithTemporaryTransactionToken(creds, env, merchantId, channelId, bodyText);
      options.onWriteAccepted?.(`send_test_transaction (${channelId})`);
      return result;
    },
  };
}

function normalizeTransactionTokenMode(value: unknown): TransactionTokenMode {
  return value === "stored" || value === "temporary" || value === "auto" ? value : "auto";
}

async function confirmTestTransactionIfNeeded(
  params: Record<string, unknown>,
  env: Environment,
  tokenMode: TransactionTokenMode,
  bodyText: string,
  options: ExecuteMapOptions,
): Promise<void> {
  if (options.bypassWriteConfirmation) return;
  const preview: WritePreview = {
    tool: "send_test_transaction",
    action: "send",
    method: "POST",
    description: `send_test_transaction (${String(params.channelId ?? "")})`,
    params: {
      channelId: params.channelId,
      merchantId: params.merchantId,
      transactionTokenId: params.transactionTokenId,
      tokenMode,
      requestBody: Object.fromEntries(new URLSearchParams(bodyText.replace(/\n/g, "&")).entries()),
      authorization: "[redacted]",
    },
    env,
  };
  const choice = await requestConfirm(preview);
  if (choice === "cancel") throw new Error("Operation cancelled by user.");
}

function selectStoredTransactionToken(
  tokens: TransactionTokenRecord[],
  tokenId: string,
  merchantId: string,
  tokenMode: TransactionTokenMode,
): TransactionTokenRecord | null {
  const candidates = tokens.filter((row) => {
    if (tokenId && row.id !== tokenId) return false;
    if (merchantId && row.merchantId !== merchantId) return false;
    return row.state !== "DELETED";
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1 && (tokenId || merchantId)) {
    throw new Error("Multiple stored transaction tokens matched this request. Provide transactionTokenId so the correct token can be selected.");
  }
  if (candidates.length > 1 && tokenMode === "stored") {
    throw new Error("Multiple transaction tokens are stored. Provide merchantId or transactionTokenId so the correct token can be selected.");
  }
  if (tokenId || merchantId || tokenMode === "stored") return null;
  return null;
}

function buildStoredTransactionResult(
  result: unknown,
  token: TransactionTokenRecord,
  merchantId: string,
  channelId: string,
  tokenMode: TransactionTokenMode,
) {
  return {
    ...(result as Record<string, unknown>),
    environment: "uat",
    channelId,
    merchantId,
    tokenMode,
    token: {
      source: token.source,
      id: token.id,
      merchantId: token.merchantId,
      label: token.label,
      apiTokenId: token.apiTokenId,
      lastDigits: token.lastDigits,
      state: token.state,
    },
  };
}

async function sendWithTemporaryTransactionToken(
  creds: ApiCredentials,
  env: Environment,
  merchantId: string,
  channelId: string,
  bodyText: string,
) {
  const alias = `wax_tmp_txn_${Date.now()}_${merchantId.slice(-6) || channelId.slice(-6)}`;
  let apiToken: ApiTokenMetadata | null = null;
  const cleanup = {
    attempted: false,
    suspended: false,
    deleted: false,
    errors: [] as Array<{ source: "token_suspend" | "token_delete"; message: string }>,
  };

  try {
    const created = await apiRequest<ApiTokenResponse>(creds, env, {
      method: "POST",
      path: `/merchants/${encodeURIComponent(merchantId)}/apiTokens`,
      params: { alias },
    }, {
      eventType: "api_token_create",
      entityId: merchantId,
      entityType: "merchant",
    });

    const createdToken = created.data.apiToken;
    const bearerToken = createdToken?.apiBearerToken;
    if (!created.ok || created.data.error || !createdToken || !bearerToken) {
      throw new Error(created.data.error?.message ?? "Temporary API token was not created or did not return a bearer token.");
    }

    apiToken = createdToken;
    const transaction = await sendExampleTransaction(env, bearerToken, bodyText);
    return {
      ...transaction,
      environment: env,
      channelId,
      merchantId,
      tokenMode: "temporary" as const,
      token: redactApiTokenMetadata(apiToken, "temporary"),
      cleanup,
    };
  } finally {
    if (apiToken?.id) {
      cleanup.attempted = true;
      await apiRequest(creds, env, {
        method: "POST",
        path: `/apiTokens/${encodeURIComponent(apiToken.id)}/suspend`,
      }, {
        eventType: "api_token_suspend",
        entityId: apiToken.id,
        entityType: "apiToken",
      })
        .then((res) => { cleanup.suspended = res.ok; if (!res.ok) cleanup.errors.push({ source: "token_suspend", message: `HTTP ${res.status}` }); })
        .catch((err) => cleanup.errors.push({ source: "token_suspend", message: err instanceof Error ? err.message : String(err) }));

      await apiRequest(creds, env, {
        method: "DELETE",
        path: `/apiTokens/${encodeURIComponent(apiToken.id)}`,
      }, {
        eventType: "api_token_delete",
        entityId: apiToken.id,
        entityType: "apiToken",
      })
        .then((res) => { cleanup.deleted = res.ok; if (!res.ok) cleanup.errors.push({ source: "token_delete", message: `HTTP ${res.status}` }); })
        .catch((err) => cleanup.errors.push({ source: "token_delete", message: err instanceof Error ? err.message : String(err) }));
    }
  }
}

function redactApiTokenMetadata(apiToken: ApiTokenMetadata, source: "temporary") {
  return {
    source,
    apiTokenId: apiToken.id,
    alias: apiToken.alias,
    state: apiToken.state,
    lastDigits: apiToken.lastDigits,
    createdTime: apiToken.createdTime,
    lastUsedTime: apiToken.lastUsedTime,
  };
}

function isAuthenticationFailure(data: unknown): boolean {
  const serialized = JSON.stringify(data ?? "").toLowerCase();
  return serialized.includes("800.900.300") || serialized.includes("invalid authentication information");
}

function testTransactionField(params: Record<string, unknown>, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function buildTestTransactionBody(channelId: string, params: Record<string, unknown>): string {
  return [
    `entityId=${channelId}`,
    `amount=${testTransactionField(params, "amount", "92.00")}`,
    `currency=${testTransactionField(params, "currency", "EUR")}`,
    `paymentBrand=${testTransactionField(params, "paymentBrand", "VISA")}`,
    `paymentType=${testTransactionField(params, "paymentType", "PA")}`,
    `card.number=${testTransactionField(params, "cardNumber", "4200000000000000")}`,
    `card.holder=${testTransactionField(params, "cardHolder", "Jane Jones")}`,
    `card.expiryMonth=${testTransactionField(params, "cardExpiryMonth", "05")}`,
    `card.expiryYear=${testTransactionField(params, "cardExpiryYear", "2034")}`,
    `card.cvv=${testTransactionField(params, "cardCvv", "123")}`,
  ].join("\n");
}

function normalizeTotalCalls(value: unknown): number {
  const totalCalls = typeof value === "number" ? value : Number(value);
  return Number.isInteger(totalCalls) && totalCalls > 0 ? totalCalls : 1;
}

async function getJobStatus(jobId: string | undefined, includeDetails: boolean) {
  if (!jobId) return { error: "jobId is required." };
  const job = await getJobFresh(jobId);
  if (!job) return { error: `Job ${jobId} was not found.` };

  const base = summarizeJob(job);
  if (!includeDetails) return base;

  return {
    ...base,
    script: job.script,
    logs: job.logs,
    writes: job.writes,
    results: job.results,
  };
}

function summarizeJob(job: JobRecord) {
  return {
    jobId: job.id,
    label: job.label,
    state: job.state,
    source: job.source,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    pausedAt: job.pausedAt,
    completedAt: job.completedAt,
    env: job.env,
    entityType: job.entityType,
    entityId: job.entityId,
    progress: {
      completedCalls: job.completedCalls,
      totalCalls: job.totalCalls,
      throttleRate: job.throttleRate,
    },
    error: job.error,
    counts: {
      results: job.results.length,
      logs: job.logs.length,
      writes: job.writes.length,
    },
    results: job.state === "completed" ? job.results : undefined,
  };
}

/**
 * Register each generated per-action tool (from the manifest) onto an
 * existing execute-map. Typed writes go through the adapter which
 * enforces required-field tiers, rejects unknown fields, coerces values,
 * and routes destructive calls through the confirm bridge.
 */
export function registerGeneratedToolExecutors(
  map: Record<string, ExecuteFn>,
  options: ExecuteMapOptions = {},
): Record<string, ExecuteFn> {
  const handwrittenOverrides = new Set<string>(Object.keys(map));
  const ignoredByWebMcp = new Set<string>(["list_clearing_institutes"]);

  for (const toolName of MANIFEST.tools) {
    if (handwrittenOverrides.has(toolName)) continue;
    if (ignoredByWebMcp.has(toolName)) continue;

    map[toolName] = async (params) => {
      if (API_TOKEN_TOOLS.has(toolName) && !await isChatAccessTokenControlEnabled()) {
        throw new Error("Enable accessToken control in Chat settings before using API token tools.");
      }
      const { creds, env } = await sessionOrError();
      return executeTypedTool(toolName, params, {
        creds,
        env,
        confirm: options.bypassWriteConfirmation === true,
        onWriteAccepted: isReadOnlyTool(toolName) ? undefined : options.onWriteAccepted,
      });
    };
  }

  return map;
}