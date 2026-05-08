import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock chrome.storage
const localStore: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const k of ks) result[k] = localStore[k];
        return result;
      }),
      set: vi.fn(async (data: Record<string, unknown>) => Object.assign(localStore, data)),
      remove: vi.fn(async (key: string | string[]) => {
        const ks = Array.isArray(key) ? key : [key];
        for (const k of ks) delete localStore[k];
      }),
    },
    session: {
      get: vi.fn(async (keys: string | string[]) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const k of ks) result[k] = sessionStore[k];
        return result;
      }),
      set: vi.fn(async (data: Record<string, unknown>) => Object.assign(sessionStore, data)),
      remove: vi.fn(async (key: string | string[]) => {
        const ks = Array.isArray(key) ? key : [key];
        for (const k of ks) delete sessionStore[k];
      }),
    },
  },
});

import {
  saveCredentials,
  unlockWithPin,
  getCredentials,
  getActiveEnv,
  setActiveEnv,
  hasStoredCredentials,
  isSessionUnlocked,
  forgetCredentials,
  getTransactionTokens,
  saveTransactionToken,
  deleteTransactionToken,
  getThrottleRate,
  setThrottleRate,
  type ApiCredentials,
} from "./storage";

describe("storage", () => {
  const creds: ApiCredentials = {
    baseUrl: "https://api.test",
    username: "testuser",
    password: "testpass",
    pspId: "psp-123",
  };
  const pin = "5678";
  const tokenPin = "567890";

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(localStore)) delete localStore[key];
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  });

  it("reports no stored credentials initially", async () => {
    expect(await hasStoredCredentials()).toBe(false);
  });

  it("saves and retrieves credentials", async () => {
    await saveCredentials("uat", creds, pin);

    expect(await hasStoredCredentials()).toBe(true);
    const retrieved = await getCredentials("uat");
    expect(retrieved).toEqual(creds);
  });

  it("persists the PSP ID with credentials", async () => {
    await saveCredentials("uat", creds, pin);

    const retrieved = await getCredentials("uat");
    expect(retrieved?.pspId).toBe("psp-123");
  });

  it("unlocks credentials with correct PIN", async () => {
    await saveCredentials("uat", creds, pin);
    // Clear session to simulate new session
    delete sessionStore["session:uat"];
    delete sessionStore.activeEnv;

    const ok = await unlockWithPin(pin);
    expect(ok).toBe(true);
    expect(await getCredentials("uat")).toEqual(creds);
    expect(await getActiveEnv()).toBe("uat");
  });

  it("rejects wrong PIN", async () => {
    await saveCredentials("uat", creds, pin);
    delete sessionStore["session:uat"];

    const ok = await unlockWithPin("wrong");
    expect(ok).toBe(false);
  });

  it("detects unlocked session", async () => {
    expect(await isSessionUnlocked()).toBe(false);
    await saveCredentials("uat", creds, pin);
    expect(await isSessionUnlocked()).toBe(true);
  });

  it("manages active environment", async () => {
    expect(await getActiveEnv()).toBeNull();
    await setActiveEnv("prod");
    expect(await getActiveEnv()).toBe("prod");
    expect(localStore.activeEnv).toBe("prod");
  });

  it("restores the persisted active environment after unlock", async () => {
    await saveCredentials("uat", creds, pin);
    await saveCredentials("prod", { ...creds, baseUrl: "https://prod.test" }, pin);
    await setActiveEnv("prod");

    delete sessionStore["session:uat"];
    delete sessionStore["session:prod"];
    delete sessionStore.activeEnv;

    const ok = await unlockWithPin(pin);
    expect(ok).toBe(true);
    expect(await getActiveEnv()).toBe("prod");
  });

  it("manages throttle rate with bounds", async () => {
    expect(await getThrottleRate()).toBe(9); // default
    await setThrottleRate(20);
    expect(await getThrottleRate()).toBe(20);
  });

  it("clamps throttle rate to valid range", async () => {
    await setThrottleRate(0);
    // Should have been clamped to 1
    const stored = localStore.throttleRate as number;
    expect(stored).toBe(1);
  });

  it("forgets credentials for an environment", async () => {
    await saveCredentials("uat", creds, pin);
    await forgetCredentials("uat");

    expect(await getCredentials("uat")).toBeNull();
    expect(await hasStoredCredentials()).toBe(false);
  });

  it("keeps other env credentials when forgetting one", async () => {
    await saveCredentials("uat", creds, pin);
    await saveCredentials("prod", { ...creds, baseUrl: "https://prod.test" }, pin);
    await setActiveEnv("uat");
    await forgetCredentials("uat");

    expect(await hasStoredCredentials()).toBe(true);
    expect(await getCredentials("prod")).not.toBeNull();
    expect(await getActiveEnv()).toBe("prod");
  });

  it("saves and lists merchant transaction tokens in session without plaintext local storage", async () => {
    const row = await saveTransactionToken("uat", {
      merchantId: "merchant-123",
      label: "test merchant",
      token: "bearer-token-secret",
    }, tokenPin);

    expect(row.merchantId).toBe("merchant-123");
    expect(row.label).toBe("test merchant");
    expect(row.source).toBe("manual");
    expect(await getTransactionTokens("uat")).toEqual([row]);
    expect(JSON.stringify(localStore["transactionTokens:uat"])).not.toContain("bearer-token-secret");
  });

  it("saves Web API-created token metadata", async () => {
    const row = await saveTransactionToken("uat", {
      merchantId: "merchant-123",
      label: "wax_123",
      token: "bearer-token-secret",
      source: "webapi",
      apiTokenId: "ffffffffffffffffffffffffffffffff",
      lastDigits: "JMTUs=",
      state: "ACTIVE",
      remoteCreatedTime: "2026-05-07 17:45:49",
      remoteLastUsedTime: "1970-01-01 00:00:00",
    }, tokenPin);

    expect(row.source).toBe("webapi");
    expect(row.apiTokenId).toBe("ffffffffffffffffffffffffffffffff");
    expect(row.lastDigits).toBe("JMTUs=");
    expect(JSON.stringify(localStore["transactionTokens:uat"])).not.toContain("bearer-token-secret");
  });

  it("unlocks merchant transaction tokens with the PIN", async () => {
    await saveTransactionToken("uat", {
      merchantId: "merchant-123",
      token: "bearer-token-secret",
    }, tokenPin);
    delete sessionStore["session:transactionTokens:uat"];

    const ok = await unlockWithPin(tokenPin);
    expect(ok).toBe(true);
    expect((await getTransactionTokens("uat"))[0].token).toBe("bearer-token-secret");
  });

  it("deletes merchant transaction tokens with the PIN", async () => {
    const row = await saveTransactionToken("uat", {
      merchantId: "merchant-123",
      token: "bearer-token-secret",
    }, tokenPin);

    await deleteTransactionToken("uat", row.id, tokenPin);

    expect(await getTransactionTokens("uat")).toEqual([]);
    expect(JSON.stringify(localStore["transactionTokens:uat"])).not.toContain("bearer-token-secret");
  });

  it("requires the correct PIN when token rows are already unlocked in session", async () => {
    const row = await saveTransactionToken("uat", {
      merchantId: "merchant-123",
      token: "bearer-token-secret",
    }, tokenPin);

    await expect(deleteTransactionToken("uat", row.id, "000000")).rejects.toThrow();

    expect((await getTransactionTokens("uat"))[0].token).toBe("bearer-token-secret");
  });
});
