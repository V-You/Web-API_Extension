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
  getThrottleRate,
  setThrottleRate,
  type ApiCredentials,
} from "./storage";

describe("storage", () => {
  const creds: ApiCredentials = {
    baseUrl: "https://api.test",
    username: "testuser",
    password: "testpass",
  };
  const pin = "5678";

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

  it("unlocks credentials with correct PIN", async () => {
    await saveCredentials("uat", creds, pin);
    // Clear session to simulate new session
    delete sessionStore["session:uat"];

    const ok = await unlockWithPin(pin);
    expect(ok).toBe(true);
    expect(await getCredentials("uat")).toEqual(creds);
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
    await forgetCredentials("uat");

    expect(await hasStoredCredentials()).toBe(true);
    expect(await getCredentials("prod")).not.toBeNull();
  });
});
