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
 *   activeEnv    -- "uat" | "prod" (session only)
 *   pinInitialized -- boolean flag indicating PIN has been set
 */

import { encrypt, decrypt, type EncryptedBlob } from "./crypto";

export type Environment = "uat" | "prod";

export interface ApiCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

const STORAGE_KEY = (env: Environment) => `cred:${env}`;
const SESSION_KEY = (env: Environment) => `session:${env}`;

/** Check whether any encrypted credentials exist. */
export async function hasStoredCredentials(): Promise<boolean> {
  const result = await chrome.storage.local.get(["cred:uat", "cred:prod", "pinInitialized"]);
  return result.pinInitialized === true || !!result["cred:uat"] || !!result["cred:prod"];
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

  return anyDecrypted;
}

/** Get decrypted credentials for an environment from session storage. */
export async function getCredentials(env: Environment): Promise<ApiCredentials | null> {
  const result = await chrome.storage.session.get(SESSION_KEY(env));
  return (result[SESSION_KEY(env)] as ApiCredentials) ?? null;
}

/** Get the active environment from session storage. */
export async function getActiveEnv(): Promise<Environment | null> {
  const result = await chrome.storage.session.get("activeEnv");
  return (result.activeEnv as Environment) ?? null;
}

/** Set the active environment. */
export async function setActiveEnv(env: Environment): Promise<void> {
  await chrome.storage.session.set({ activeEnv: env });
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

  // If no credentials remain, clear the initialized flag
  const remaining = await chrome.storage.local.get(["cred:uat", "cred:prod"]);
  if (!remaining["cred:uat"] && !remaining["cred:prod"]) {
    await chrome.storage.local.remove("pinInitialized");
  }
}
