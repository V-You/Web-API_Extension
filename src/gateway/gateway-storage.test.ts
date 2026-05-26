import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { hasStoredCredentials, saveCredentials, unlockWithPin, type ApiCredentials } from "../lib/storage";
import {
  getGatewaySessionToken,
  hasStoredGatewayToken,
  isGatewayTokenInvalid,
  lockGatewayToken,
  saveGatewayToken,
  unlockGatewayTokenWithPin,
} from "./gateway-storage";

describe("gateway storage", () => {
  const pin = "123456";
  const creds: ApiCredentials = {
    baseUrl: "https://api.test",
    username: "u",
    password: "p",
    pspId: "psp-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(localStore)) delete localStore[key];
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  });

  it("saves a gateway token without forcing the app-level PIN gate", async () => {
    await saveGatewayToken("gateway-token", pin);

    expect(await hasStoredGatewayToken()).toBe(true);
    expect(await getGatewaySessionToken()).toBe("gateway-token");
    expect(await hasStoredCredentials()).toBe(false);
    expect(localStore.pinInitialized).toBeUndefined();
  });

  it("unlocks a gateway token during normal one-PIN credential unlock", async () => {
    await saveCredentials("uat", creds, pin);
    await saveGatewayToken("gateway-token", pin);
    delete sessionStore["session:uat"];
    delete sessionStore["session:gateway:token"];

    expect(await unlockWithPin(pin)).toBe(true);
    expect(await getGatewaySessionToken()).toBe("gateway-token");
  });

  it("can unlock a gateway token directly without creating app-level credentials", async () => {
    await saveGatewayToken("gateway-token", pin);
    delete sessionStore["session:gateway:token"];

    expect(await unlockGatewayTokenWithPin(pin)).toBe(true);
    expect(await getGatewaySessionToken()).toBe("gateway-token");
    expect(await hasStoredCredentials()).toBe(false);
  });

  it("marks wrong PIN as invalid without deleting the encrypted token", async () => {
    await saveGatewayToken("gateway-token", pin);
    delete sessionStore["session:gateway:token"];

    expect(await unlockGatewayTokenWithPin("wrong-pin")).toBe(false);
    expect(await hasStoredGatewayToken()).toBe(true);
    expect(await isGatewayTokenInvalid()).toBe(true);
  });

  it("locks only the session token and preserves the encrypted local token", async () => {
    await saveGatewayToken("gateway-token", pin);
    await lockGatewayToken();

    expect(await hasStoredGatewayToken()).toBe(true);
    expect(await getGatewaySessionToken()).toBeNull();
    expect(await isGatewayTokenInvalid()).toBe(true);
  });
});
