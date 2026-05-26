/**
 * Credential storage layer.
 *
 * Encrypted blobs live in chrome.storage.local.
 * Decrypted credentials live in chrome.storage.session (cleared on browser close).
 *
 * Storage keys:
 *   cred:uat  -- encrypted UAT credentials blob
 *   cred:prod -- encrypted Prod credentials blob
 *   session:uat  -- decrypted UAT credentials (session only)
 *   session:prod -- decrypted Prod credentials (session only)
 *   transactionTokens:uat  -- encrypted UAT transaction bearer token rows
 *   transactionTokens:prod -- encrypted Prod transaction bearer token rows
 *   session:transactionTokens:uat  -- decrypted UAT token rows (session only)
 *   session:transactionTokens:prod -- decrypted Prod token rows (session only)
 *   activeEnv    -- "uat" | "prod" (stored in session and local)
 *   pinInitialized -- boolean flag indicating PIN has been set
 */

import { encrypt, decrypt, type EncryptedBlob } from "./crypto";
import { unlockLlmProviderSettingsWithPin } from "./llm-storage";
import { unlockGatewayTokenWithPin } from "../gateway/gateway-storage";
import type { ApiCredentials, Environment } from "./types";

export type { ApiCredentials, Environment } from "./types";

const STORAGE_KEY = (env: Environment) => `cred:${env}`;
const SESSION_KEY = (env: Environment) => `session:${env}`;
const TOKEN_STORAGE_KEY = (env: Environment) => `transactionTokens:${env}`;
const TOKEN_SESSION_KEY = (env: Environment) => `session:transactionTokens:${env}`;
const ACTIVE_ENV_KEY = "activeEnv";

export interface TransactionTokenRecord {
  id: string;
  merchantId: string;
  label?: string;
  token: string;
  source: "manual" | "webapi";
  apiTokenId?: string;
  lastDigits?: string;
  state?: "ACTIVE" | "SUSPENDED" | "DELETED" | string;
  createdAt: string;
  updatedAt: string;
  remoteCreatedTime?: string;
  remoteLastUsedTime?: string;
}

export interface TransactionTokenInput {
  id?: string;
  merchantId: string;
  label?: string;
  token: string;
  source?: "manual" | "webapi";
  apiTokenId?: string;
  lastDigits?: string;
  state?: "ACTIVE" | "SUSPENDED" | "DELETED" | string;
  remoteCreatedTime?: string;
  remoteLastUsedTime?: string;
}

/** Check whether any encrypted credentials exist. */
export async function hasStoredCredentials(): Promise<boolean> {
  const result = await chrome.storage.local.get(["cred:uat", "cred:prod", "transactionTokens:uat", "transactionTokens:prod", "llm:gemini"]);
  return !!result["cred:uat"] || !!result["cred:prod"] || !!result["transactionTokens:uat"] || !!result["transactionTokens:prod"] || !!result["llm:gemini"];
}

/** Check whether decrypted credentials are available in the current session. */
export async function isSessionUnlocked(): Promise<boolean> {
  const result = await chrome.storage.session.get(["session:uat", "session:prod"]);
  return !!result["session:uat"] || !!result["session:prod"];
}

/** Save credentials: encrypt with PIN and store in local, cache decrypted in session. */
export async function saveCredentials(
  env: Environment,
  creds: ApiCredentials,
  pin: string
): Promise<void> {
  const plaintext = JSON.stringify(creds);
  const blob = await encrypt(pin, plaintext);

  await chrome.storage.local.set({
    [STORAGE_KEY(env)]: blob,
    pinInitialized: true,
  });

  // Also cache the decrypted value in session storage
  await chrome.storage.session.set({
    [SESSION_KEY(env)]: creds,
  });
}

/** Unlock credentials for the current session using the user's PIN. */
export async function unlockWithPin(pin: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(["cred:uat", "cred:prod"]);
  let anyDecrypted = false;

  for (const env of ["uat", "prod"] as Environment[]) {
    const blob = stored[STORAGE_KEY(env)] as EncryptedBlob | undefined;
    if (!blob) continue;

    try {
      const plaintext = await decrypt(pin, blob);
      const creds: ApiCredentials = JSON.parse(plaintext);
      await chrome.storage.session.set({ [SESSION_KEY(env)]: creds });
      anyDecrypted = true;
    } catch {
      // Wrong PIN -- AES-GCM decrypt throws on authentication failure
      return false;
    }
  }

  const tokenStored = await chrome.storage.local.get([TOKEN_STORAGE_KEY("uat"), TOKEN_STORAGE_KEY("prod")]);
  for (const env of ["uat", "prod"] as Environment[]) {
    const blob = tokenStored[TOKEN_STORAGE_KEY(env)] as EncryptedBlob | undefined;
    if (!blob) continue;

    try {
      const plaintext = await decrypt(pin, blob);
      await chrome.storage.session.set({ [TOKEN_SESSION_KEY(env)]: normalizeTransactionTokens(JSON.parse(plaintext)) });
      anyDecrypted = true;
    } catch {
      return false;
    }
  }

  await unlockLlmProviderSettingsWithPin(pin);
  await unlockGatewayTokenWithPin(pin);

  if (anyDecrypted) {
    await getActiveEnv();
  }

  return anyDecrypted;
}

/** Get decrypted credentials for an environment from session storage. */
export async function getCredentials(env: Environment): Promise<ApiCredentials | null> {
  const result = await chrome.storage.session.get(SESSION_KEY(env));
  return (result[SESSION_KEY(env)] as ApiCredentials) ?? null;
}

/** Get decrypted transaction bearer token rows for an environment from session storage. */
export async function getTransactionTokens(env: Environment): Promise<TransactionTokenRecord[]> {
  const result = await chrome.storage.session.get(TOKEN_SESSION_KEY(env));
  return normalizeTransactionTokens(result[TOKEN_SESSION_KEY(env)]);
}

/** Save or replace one Merchant-scoped transaction bearer token row. */
export async function saveTransactionToken(
  env: Environment,
  input: TransactionTokenInput,
  pin: string,
): Promise<TransactionTokenRecord> {
  const merchantId = input.merchantId.trim();
  const token = input.token.trim();
  const label = input.label?.trim() || undefined;
  const apiTokenId = input.apiTokenId?.trim() || undefined;
  if (!merchantId) throw new Error("Merchant entity UUID is required.");
  if (!token) throw new Error("Transaction bearer token is required.");
  if (pin.length < 6) throw new Error("PIN must be at least 6 characters.");

  const existing = await loadTransactionTokensForWrite(env, pin);
  const now = new Date().toISOString();
  const id = input.id ?? existing.find((row) => apiTokenId && row.apiTokenId === apiTokenId)?.id ?? crypto.randomUUID();
  const previous = existing.find((row) => row.id === id);
  const nextRow: TransactionTokenRecord = {
    id,
    merchantId,
    label,
    token,
    source: input.source ?? previous?.source ?? "manual",
    apiTokenId,
    lastDigits: input.lastDigits?.trim() || previous?.lastDigits,
    state: input.state ?? previous?.state,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    remoteCreatedTime: input.remoteCreatedTime ?? previous?.remoteCreatedTime,
    remoteLastUsedTime: input.remoteLastUsedTime ?? previous?.remoteLastUsedTime,
  };
  const next = previous
    ? existing.map((row) => row.id === id ? nextRow : row)
    : [...existing, nextRow];

  await persistTransactionTokens(env, next, pin);
  return nextRow;
}

/** Delete one Merchant-scoped transaction bearer token row. */
export async function deleteTransactionToken(env: Environment, id: string, pin: string): Promise<void> {
  if (!id) return;
  if (pin.length < 6) throw new Error("PIN must be at least 6 characters.");
  const existing = await loadTransactionTokensForWrite(env, pin);
  await persistTransactionTokens(env, existing.filter((row) => row.id !== id), pin);
}

/** Get the active environment from session storage. */
export async function getActiveEnv(): Promise<Environment | null> {
  const [sessionResult, localResult] = await Promise.all([
    chrome.storage.session.get([ACTIVE_ENV_KEY, SESSION_KEY("uat"), SESSION_KEY("prod")]),
    chrome.storage.local.get(ACTIVE_ENV_KEY),
  ]);

  const sessionActive = sessionResult[ACTIVE_ENV_KEY] as Environment | undefined;
  if (sessionActive) {
    return sessionActive;
  }

  const localActive = localResult[ACTIVE_ENV_KEY] as Environment | undefined;
  if (localActive && sessionResult[SESSION_KEY(localActive)]) {
    await chrome.storage.session.set({ [ACTIVE_ENV_KEY]: localActive });
    return localActive;
  }

  const fallbackEnv = (["uat", "prod"] as Environment[]).find((env) => !!sessionResult[SESSION_KEY(env)]) ?? null;
  if (fallbackEnv) {
    await Promise.all([
      chrome.storage.session.set({ [ACTIVE_ENV_KEY]: fallbackEnv }),
      chrome.storage.local.set({ [ACTIVE_ENV_KEY]: fallbackEnv }),
    ]);
  }

  return fallbackEnv;
}

/** Set the active environment. */
export async function setActiveEnv(env: Environment): Promise<void> {
  await Promise.all([
    chrome.storage.session.set({ [ACTIVE_ENV_KEY]: env }),
    chrome.storage.local.set({ [ACTIVE_ENV_KEY]: env }),
  ]);
}

/** Get the user's configured throttle rate (requests per second). */
export async function getThrottleRate(): Promise<number> {
  const result = await chrome.storage.local.get("throttleRate");
  return typeof result.throttleRate === "number" ? result.throttleRate : 9;
}

/** Set the throttle rate. */
export async function setThrottleRate(rate: number): Promise<void> {
  await chrome.storage.local.set({ throttleRate: Math.max(1, Math.min(50, rate)) });
}

/** Check whether the privacy notice has been dismissed. */
export async function isPrivacyNoticeDismissed(): Promise<boolean> {
  const result = await chrome.storage.local.get("privacyNoticeDismissed");
  return result.privacyNoticeDismissed === true;
}

/** Mark the privacy notice as dismissed. */
export async function dismissPrivacyNotice(): Promise<void> {
  await chrome.storage.local.set({ privacyNoticeDismissed: true });
}

/** Remove all credentials for an environment (both encrypted and session). */
export async function forgetCredentials(env: Environment): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY(env));
  await chrome.storage.session.remove(SESSION_KEY(env));

  const remaining = await chrome.storage.local.get(["cred:uat", "cred:prod", "transactionTokens:uat", "transactionTokens:prod", ACTIVE_ENV_KEY]);

  if ((remaining[ACTIVE_ENV_KEY] as Environment | undefined) === env) {
    const fallbackEnv = (["uat", "prod"] as Environment[]).find((candidate) => candidate !== env && !!remaining[STORAGE_KEY(candidate)]) ?? null;

    if (fallbackEnv) {
      await Promise.all([
        chrome.storage.session.set({ [ACTIVE_ENV_KEY]: fallbackEnv }),
        chrome.storage.local.set({ [ACTIVE_ENV_KEY]: fallbackEnv }),
      ]);
    } else {
      await Promise.all([
        chrome.storage.session.remove(ACTIVE_ENV_KEY),
        chrome.storage.local.remove(ACTIVE_ENV_KEY),
      ]);
    }
  }

  // If no credentials remain, clear the initialized flag
  if (!remaining["cred:uat"] && !remaining["cred:prod"] && !remaining["transactionTokens:uat"] && !remaining["transactionTokens:prod"]) {
    await chrome.storage.local.remove("pinInitialized");
  }
}

async function loadTransactionTokensForWrite(env: Environment, pin: string): Promise<TransactionTokenRecord[]> {
  const stored = await chrome.storage.local.get(TOKEN_STORAGE_KEY(env));
  const blob = stored[TOKEN_STORAGE_KEY(env)] as EncryptedBlob | undefined;
  if (!blob) return getTransactionTokens(env);

  const plaintext = await decrypt(pin, blob);
  return normalizeTransactionTokens(JSON.parse(plaintext));
}

async function persistTransactionTokens(env: Environment, rows: TransactionTokenRecord[], pin: string): Promise<void> {
  const normalized = normalizeTransactionTokens(rows);
  const blob = await encrypt(pin, JSON.stringify(normalized));
  await chrome.storage.local.set({
    [TOKEN_STORAGE_KEY(env)]: blob,
    pinInitialized: true,
  });
  await chrome.storage.session.set({ [TOKEN_SESSION_KEY(env)]: normalized });
}

function normalizeTransactionTokens(raw: unknown): TransactionTokenRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({
      id: String(row.id ?? crypto.randomUUID()),
      merchantId: String(row.merchantId ?? "").trim(),
      label: row.label ? String(row.label).trim() : undefined,
      token: String(row.token ?? "").trim(),
      source: (row.source === "webapi" ? "webapi" : "manual") as "manual" | "webapi",
      apiTokenId: row.apiTokenId ? String(row.apiTokenId).trim() : undefined,
      lastDigits: row.lastDigits ? String(row.lastDigits).trim() : undefined,
      state: row.state ? String(row.state).trim() : undefined,
      createdAt: String(row.createdAt ?? new Date().toISOString()),
      updatedAt: String(row.updatedAt ?? row.createdAt ?? new Date().toISOString()),
      remoteCreatedTime: row.remoteCreatedTime ? String(row.remoteCreatedTime).trim() : undefined,
      remoteLastUsedTime: row.remoteLastUsedTime ? String(row.remoteLastUsedTime).trim() : undefined,
    }))
    .filter((row) => row.merchantId && row.token);
}
