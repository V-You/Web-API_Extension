import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock chrome.storage.local for audit logging
const storageStore: Record<string, unknown> = {};
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storageStore[key] })),
      set: vi.fn(async (data: Record<string, unknown>) => {
        Object.assign(storageStore, data);
      }),
    },
  },
});

// Mock crypto.randomUUID
vi.stubGlobal("crypto", {
  ...globalThis.crypto,
  randomUUID: () => "test-uuid-1234",
});

import { apiRequest, type ApiResponse } from "./api-client";

describe("api-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(storageStore)) delete storageStore[key];
    vi.stubGlobal("fetch", vi.fn());
  });

  const creds = {
    baseUrl: "https://api.example.test",
    username: "testuser",
    password: "testpass",
  };

  it("sends credentials header with raw username:password", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await apiRequest(creds, "uat", { path: "/psps/123" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.example.test/psps/123");
    expect(opts.method).toBe("GET");
    expect(opts.headers.credentials).toBe("testuser:testpass");
  });

  it("sends POST with url-encoded body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: "new-1" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await apiRequest(creds, "uat", {
      method: "POST",
      path: "/merchants",
      params: { name: "Test Merchant", status: "active" },
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(opts.body).toContain("name=Test+Merchant");
    expect(opts.body).toContain("status=active");
  });

  it("returns parsed JSON for json content-type", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: "123", name: "Test" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result: ApiResponse<{ id: string; name: string }> = await apiRequest(creds, "uat", {
      path: "/merchants/123",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ id: "123", name: "Test" });
  });

  it("returns text for non-json content-type", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => "OK",
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await apiRequest(creds, "uat", { path: "/health" });
    expect(result.data).toBe("OK");
  });

  it("reports non-ok responses without throwing", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: "Not found" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await apiRequest(creds, "uat", { path: "/psps/missing" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("appends audit entry when auditMeta is provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", mockFetch);

    await apiRequest(creds, "uat", { method: "POST", path: "/merchants", params: { name: "X" } }, {
      eventType: "entity_create",
      entityId: "m1",
      entityType: "merchant",
    });

    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    const setArg = vi.mocked(chrome.storage.local.set).mock.calls[0][0] as Record<string, unknown>;
    const audit = setArg.audit as Array<Record<string, unknown>>;
    expect(audit).toHaveLength(1);
    expect(audit[0].entityId).toBe("m1");
    expect(audit[0].eventType).toBe("entity_create");
    expect(audit[0].environment).toBe("uat");
  });
});
