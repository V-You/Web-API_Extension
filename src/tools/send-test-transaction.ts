import { requestConfirm, type WritePreview } from "../bridge/confirm-bridge";
import { isChatAccessTokenControlEnabled } from "../chat/chat-mode";
import { apiRequest } from "../lib/api-client";
import { sendExampleTransaction } from "../lib/transaction-client";
import { getTransactionTokens, type TransactionTokenRecord } from "../lib/storage";
import type { ApiCredentials, AuditEventType, Environment } from "../lib/types";
import { RecoverableToolError } from "./recoverable-error";

export type TransactionTokenMode = "stored" | "temporary" | "auto";

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

export interface SendTestTransactionRuntimeOptions {
  bypassWriteConfirmation?: boolean;
  onWriteAccepted?: (description: string) => void;
}

export async function assertSendTestTransactionAllowed(options: SendTestTransactionRuntimeOptions = {}): Promise<void> {
  if (options.bypassWriteConfirmation !== true && !await isChatAccessTokenControlEnabled()) {
    throw new Error("Enable accessToken control in Chat settings before sending test transactions.");
  }
}

export async function executeSendTestTransaction(
  params: Record<string, unknown>,
  creds: ApiCredentials,
  env: Environment,
  options: SendTestTransactionRuntimeOptions = {},
) {
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
    return withTransactionResultAliases(buildStoredTransactionResult(result, storedToken, merchantId || storedToken.merchantId, channelId, tokenMode));
  }

  if (tokenMode === "auto" && storedToken) {
    const storedResult = await sendExampleTransaction(env, storedToken.token, bodyText);
    if (storedResult.ok || !isAuthenticationFailure(storedResult.data)) {
      options.onWriteAccepted?.(`send_test_transaction (${channelId})`);
      return withTransactionResultAliases(buildStoredTransactionResult(storedResult, storedToken, merchantId || storedToken.merchantId, channelId, tokenMode));
    }

    if (!merchantId && !storedToken.merchantId) {
      return withTransactionResultAliases(buildStoredTransactionResult(storedResult, storedToken, storedToken.merchantId, channelId, tokenMode));
    }

    const temporaryResult = await sendWithTemporaryTransactionToken(creds, env, merchantId || storedToken.merchantId, channelId, bodyText);
    options.onWriteAccepted?.(`send_test_transaction (${channelId})`);
    const originalError = withTransactionResultAliases(buildStoredTransactionResult(storedResult, storedToken, merchantId || storedToken.merchantId, channelId, tokenMode));
    return {
      ...temporaryResult,
      originalError,
      previousAttempt: originalError,
    };
  }

  if (!merchantId) {
    throw new RecoverableToolError({
      ok: false,
      errorCode: "merchant_id_required",
      failureCategory: "identifier_failure",
      message: "merchantId is required for temporary transaction token creation. If the target is a Channel, call get_entity or manage_entity get for that Channel and derive the Merchant parent from _parent, merchantId, sender, parentId, or nearby hierarchy context before asking the user.",
      recoverable: true,
      recovery: {
        reason: "Temporary token creation requires the Merchant parent of the target Channel.",
        recommendedTool: "manage_entity",
        recommendedArgs: { action: "get", entityType: "channel", entityId: channelId },
        retryTool: "send_test_transaction",
        retryArgsPatch: { channelId, tokenMode: "temporary" },
        deriveFields: ["_parent", "merchantId", "sender", "parentId"],
      },
    });
  }

  const result = await sendWithTemporaryTransactionToken(creds, env, merchantId, channelId, bodyText);
  options.onWriteAccepted?.(`send_test_transaction (${channelId})`);
  return withTransactionResultAliases(result);
}

function withTransactionResultAliases<T extends Record<string, unknown>>(transaction: T): T & {
  statusCode?: number;
  response: { ok?: boolean; status?: number; data?: unknown };
  result: { ok?: boolean; status?: number; data?: unknown; code?: unknown; description?: unknown };
} {
  const status = typeof transaction.status === "number" ? transaction.status : undefined;
  const ok = typeof transaction.ok === "boolean" ? transaction.ok : undefined;
  const data = transaction.data;
  const dataResult = data && typeof data === "object" && "result" in data
    ? (data as { result?: unknown }).result
    : null;
  const code = dataResult && typeof dataResult === "object" ? (dataResult as Record<string, unknown>).code : undefined;
  const description = dataResult && typeof dataResult === "object" ? (dataResult as Record<string, unknown>).description : undefined;

  return {
    ...transaction,
    statusCode: status,
    response: { ok, status, data },
    result: { ok, status, data, code, description },
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
  options: SendTestTransactionRuntimeOptions,
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
      contextProvenance: params.contextProvenance,
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
      eventType: "api_token_create" as AuditEventType,
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
    return withTransactionResultAliases({
      ...transaction,
      environment: env,
      channelId,
      merchantId,
      tokenMode: "temporary" as const,
      token: redactApiTokenMetadata(apiToken, "temporary"),
      cleanup,
    });
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
