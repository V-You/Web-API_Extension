/**
 * Gateway (BYOG) configuration and bearer-token storage.
 *
 * Storage keys:
 *   gateway:settings        -- non-secret settings (enabled, host, paths)
 *   gateway:token           -- AES-GCM encrypted bearer token blob
 *   session:gateway:token   -- decrypted bearer token (session only)
 *   gateway:tokenInvalid    -- boolean, set when the token failed to unlock with the last PIN
 *
 * PIN entry is reused from the existing on-page PIN fields (ACI / transaction-token
 * forms). There is no gateway-only PIN. Having only a saved gateway token does NOT
 * force a PIN gate at startup; see hasStoredCredentials() in storage.ts.
 */

import { decrypt, encrypt, type EncryptedBlob } from "../lib/crypto";

const SETTINGS_KEY = "gateway:settings";
const TOKEN_STORAGE_KEY = "gateway:token";
const TOKEN_SESSION_KEY = "session:gateway:token";
const TOKEN_INVALID_KEY = "gateway:tokenInvalid";

export const DEFAULT_GATEWAY_HOST = "https://mobot.laetzer.com";
export const DEFAULT_POLICY_PATH = "/v1/policy/evaluate";
export const DEFAULT_TELEMETRY_PATH = "/v1/telemetry/ingest";

/**
 * Hosts the manifest grants permission for. Keep in sync with `host_permissions`
 * in manifest.json. v1 only ships mobot.laetzer.com; phase 2 will switch to
 * optional_host_permissions for arbitrary enterprise hosts.
 */
export const ALLOWED_GATEWAY_HOSTS: ReadonlyArray<string> = ["mobot.laetzer.com"];

export interface GatewaySettings {
  enabled: boolean;
  host: string;
  policyPath: string;
  telemetryPath: string;
  updatedAt?: string;
  lastPolicyStatus?: "ok" | "failed";
  lastTelemetryStatus?: "ok" | "failed";
  lastProbeAt?: string;
  lastProbeError?: string;
}

export interface GatewaySettingsInput {
  enabled?: boolean;
  host?: string;
  policyPath?: string;
  telemetryPath?: string;
}

const DEFAULT_SETTINGS: GatewaySettings = {
  enabled: false,
  host: DEFAULT_GATEWAY_HOST,
  policyPath: DEFAULT_POLICY_PATH,
  telemetryPath: DEFAULT_TELEMETRY_PATH,
};

function normalizeSettings(raw: unknown): GatewaySettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const obj = raw as Record<string, unknown>;
  return {
    enabled: obj.enabled === true,
    host: typeof obj.host === "string" && obj.host.trim() ? obj.host.trim() : DEFAULT_GATEWAY_HOST,
    policyPath: typeof obj.policyPath === "string" && obj.policyPath.trim() ? obj.policyPath.trim() : DEFAULT_POLICY_PATH,
    telemetryPath: typeof obj.telemetryPath === "string" && obj.telemetryPath.trim() ? obj.telemetryPath.trim() : DEFAULT_TELEMETRY_PATH,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : undefined,
    lastPolicyStatus: obj.lastPolicyStatus === "ok" || obj.lastPolicyStatus === "failed" ? obj.lastPolicyStatus : undefined,
    lastTelemetryStatus: obj.lastTelemetryStatus === "ok" || obj.lastTelemetryStatus === "failed" ? obj.lastTelemetryStatus : undefined,
    lastProbeAt: typeof obj.lastProbeAt === "string" ? obj.lastProbeAt : undefined,
    lastProbeError: typeof obj.lastProbeError === "string" ? obj.lastProbeError : undefined,
  };
}

/** Validate a gateway host URL. Returns null when valid, error string otherwise. */
export function validateGatewayHost(host: string): string | null {
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    return "Gateway host must be a valid URL (e.g. https://mobot.laetzer.com).";
  }
  if (url.protocol !== "https:") {
    return "Gateway host must use https://.";
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    return "Gateway host must not include a path.";
  }
  const hostname = url.hostname.toLowerCase();
  const allowed = ALLOWED_GATEWAY_HOSTS.some((h) =>
    hostname === h || hostname.endsWith(`.${h}`),
  );
  if (!allowed) {
    return `Host not covered by extension permissions. Allowed: ${ALLOWED_GATEWAY_HOSTS.join(", ")}.`;
  }
  return null;
}

/** Validate a path field (must start with /, no spaces). */
export function validateGatewayPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return "Path must start with /.";
  if (/\s/.test(trimmed)) return "Path must not contain whitespace.";
  return null;
}

/** Load the non-secret gateway settings (merged with defaults). */
export async function getGatewaySettings(): Promise<GatewaySettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(result[SETTINGS_KEY]);
}

/** Save non-secret gateway settings. Does not touch the encrypted token. */
export async function saveGatewaySettings(input: GatewaySettingsInput): Promise<GatewaySettings> {
  const current = await getGatewaySettings();
  const next: GatewaySettings = {
    enabled: input.enabled ?? current.enabled,
    host: input.host?.trim() ?? current.host,
    policyPath: input.policyPath?.trim() ?? current.policyPath,
    telemetryPath: input.telemetryPath?.trim() ?? current.telemetryPath,
    updatedAt: new Date().toISOString(),
  };

  const hostError = validateGatewayHost(next.host);
  if (hostError) throw new Error(hostError);
  const policyError = validateGatewayPath(next.policyPath);
  if (policyError) throw new Error(`Policy path: ${policyError}`);
  const telemetryError = validateGatewayPath(next.telemetryPath);
  if (telemetryError) throw new Error(`Telemetry path: ${telemetryError}`);

  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function saveGatewayProbeStatus(input: {
  policyStatus?: "ok" | "failed";
  telemetryStatus?: "ok" | "failed";
  error?: string;
}): Promise<GatewaySettings> {
  const current = await getGatewaySettings();
  const next: GatewaySettings = {
    ...current,
    lastPolicyStatus: input.policyStatus,
    lastTelemetryStatus: input.telemetryStatus,
    lastProbeAt: new Date().toISOString(),
    lastProbeError: input.error,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Encrypt and persist the gateway bearer token. Does not by itself force the app-level PIN gate. */
export async function saveGatewayToken(token: string, pin: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Gateway bearer token is required.");
  if (pin.length < 6) throw new Error("PIN must be at least 6 characters.");

  const blob = await encrypt(pin, trimmed);
  await chrome.storage.local.set({
    [TOKEN_STORAGE_KEY]: blob,
    [TOKEN_INVALID_KEY]: false,
  });
  await chrome.storage.session.set({ [TOKEN_SESSION_KEY]: trimmed });
}

/** Whether an encrypted gateway token exists in local storage. */
export async function hasStoredGatewayToken(): Promise<boolean> {
  const result = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
  return !!result[TOKEN_STORAGE_KEY];
}

/** Returns true if the most recent unlock attempt for the gateway token failed. */
export async function isGatewayTokenInvalid(): Promise<boolean> {
  const result = await chrome.storage.local.get(TOKEN_INVALID_KEY);
  return result[TOKEN_INVALID_KEY] === true;
}

/** Read the decrypted token from session storage. */
export async function getGatewaySessionToken(): Promise<string | null> {
  const result = await chrome.storage.session.get(TOKEN_SESSION_KEY);
  const value = result[TOKEN_SESSION_KEY];
  return typeof value === "string" && value ? value : null;
}

/**
 * Try to decrypt the gateway token with the given PIN and cache it in session storage.
 * Failure does not throw; the caller is unlocking many secrets in parallel and one
 * mismatch should not block the others. Returns true when a token was decrypted (or
 * when no token is configured, which is also a non-failure state).
 */
export async function unlockGatewayTokenWithPin(pin: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
  const blob = stored[TOKEN_STORAGE_KEY] as EncryptedBlob | undefined;
  if (!blob) return true;

  try {
    const plaintext = await decrypt(pin, blob);
    await Promise.all([
      chrome.storage.session.set({ [TOKEN_SESSION_KEY]: plaintext }),
      chrome.storage.local.set({ [TOKEN_INVALID_KEY]: false }),
    ]);
    return true;
  } catch {
    await Promise.all([
      chrome.storage.session.remove(TOKEN_SESSION_KEY),
      chrome.storage.local.set({ [TOKEN_INVALID_KEY]: true }),
    ]);
    return false;
  }
}

/** Remove the encrypted gateway token and any session copy. */
export async function forgetGatewayToken(): Promise<void> {
  await Promise.all([
    chrome.storage.local.remove([TOKEN_STORAGE_KEY, TOKEN_INVALID_KEY]),
    chrome.storage.session.remove(TOKEN_SESSION_KEY),
  ]);
}

/** Clear only the decrypted session token and mark the saved token as needing unlock/replacement. */
export async function lockGatewayToken(): Promise<void> {
  await Promise.all([
    chrome.storage.session.remove(TOKEN_SESSION_KEY),
    chrome.storage.local.set({ [TOKEN_INVALID_KEY]: true }),
  ]);
}
