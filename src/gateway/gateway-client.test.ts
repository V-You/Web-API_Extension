import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock chrome.storage so gateway-storage works.
const localStore: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

vi.stubGlobal("chrome", {
  runtime: {
    getManifest: () => ({ name: "Web API Extension", version: "0.0.0-test" }),
  },
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

import { saveGatewaySettings } from "./gateway-storage";
import {
  evaluatePolicy,
  getGatewayDiagnostics,
  resetGatewayDiagnostics,
  sendApiTelemetry,
  sendToolTelemetry,
} from "./gateway-client";
import { GatewayPolicyDeniedError, GatewayPolicyUnavailableError } from "./gateway-types";

function mockResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function enableGatewayWithToken(): Promise<void> {
  for (const key of Object.keys(localStore)) delete localStore[key];
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  await saveGatewaySettings({ enabled: true });
  sessionStore["session:gateway:token"] = "test-token-abc";
}

describe("gateway-client", () => {
  beforeEach(() => {
    resetGatewayDiagnostics();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("evaluatePolicy", () => {
    it("returns allowed without a fetch when hooks are disabled", async () => {
      for (const key of Object.keys(localStore)) delete localStore[key];
      for (const key of Object.keys(sessionStore)) delete sessionStore[key];
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const decision = await evaluatePolicy({
        source: "webmcp",
        tool: { name: "list_psps", readOnly: true },
        context: { environment: "uat" },
        correlationId: "c-1",
      });
      expect(decision.allowed).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws unauthorized when token is locked", async () => {
      for (const key of Object.keys(localStore)) delete localStore[key];
      for (const key of Object.keys(sessionStore)) delete sessionStore[key];
      await saveGatewaySettings({ enabled: true });
      await expect(
        evaluatePolicy({
          source: "webmcp",
          tool: { name: "list_psps", readOnly: true },
          context: {},
          correlationId: "c-2",
        }),
      ).rejects.toBeInstanceOf(GatewayPolicyUnavailableError);
    });

    it("allows when server returns allowed:true", async () => {
      await enableGatewayWithToken();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse(200, { allowed: true }));
      const decision = await evaluatePolicy({
        source: "webmcp",
        tool: { name: "list_psps", readOnly: true },
        context: { environment: "uat" },
        correlationId: "c-3",
      });
      expect(decision.allowed).toBe(true);
      expect(decision.cached).toBe(false);
      expect(getGatewayDiagnostics().gatewayPolicyAllowed).toBe(1);
    });

    it("throws GatewayPolicyDeniedError on allowed:false", async () => {
      await enableGatewayWithToken();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockResponse(200, { allowed: false, reason: "nope", code: "policy_denied" }),
      );
      await expect(
        evaluatePolicy({
          source: "webmcp",
          tool: { name: "edit_entity", readOnly: false },
          context: {},
          correlationId: "c-4",
        }),
      ).rejects.toBeInstanceOf(GatewayPolicyDeniedError);
      expect(getGatewayDiagnostics().gatewayPolicyDenied).toBe(1);
    });

    it("masks internal-visibility reasons with a generic message", async () => {
      await enableGatewayWithToken();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockResponse(200, {
          allowed: false,
          reason: "internal SIEM rule 1234 triggered",
          reasonVisibility: "internal",
        }),
      );
      try {
        await evaluatePolicy({
          source: "webmcp",
          tool: { name: "edit_entity", readOnly: false },
          context: {},
          correlationId: "c-5",
        });
        throw new Error("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(GatewayPolicyDeniedError);
        const err = e as GatewayPolicyDeniedError;
        expect(err.decision.reason).toBe("Action denied by enterprise policy.");
        expect(err.decision.internalReason).toContain("SIEM rule 1234");
      }
    });

    it("fails closed on HTTP 5xx", async () => {
      await enableGatewayWithToken();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse(500, { error: "boom" }));
      await expect(
        evaluatePolicy({
          source: "webmcp",
          tool: { name: "list_psps", readOnly: true },
          context: {},
          correlationId: "c-6",
        }),
      ).rejects.toMatchObject({ name: "GatewayPolicyUnavailableError", kind: "http" });
    });

    it("fails closed and clears token on HTTP 401", async () => {
      await enableGatewayWithToken();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse(401, { error: "nope" }));
      await expect(
        evaluatePolicy({
          source: "webmcp",
          tool: { name: "list_psps", readOnly: true },
          context: {},
          correlationId: "c-7",
        }),
      ).rejects.toMatchObject({ name: "GatewayPolicyUnavailableError", kind: "unauthorized" });
    });

    it("fails closed on malformed JSON", async () => {
      await enableGatewayWithToken();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } }),
      );
      await expect(
        evaluatePolicy({
          source: "webmcp",
          tool: { name: "list_psps", readOnly: true },
          context: {},
          correlationId: "c-8",
        }),
      ).rejects.toMatchObject({ name: "GatewayPolicyUnavailableError", kind: "malformed" });
    });

    it("fails closed on missing 'allowed' field", async () => {
      await enableGatewayWithToken();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await expect(
        evaluatePolicy({
          source: "webmcp",
          tool: { name: "list_psps", readOnly: true },
          context: {},
          correlationId: "c-9",
        }),
      ).rejects.toMatchObject({ name: "GatewayPolicyUnavailableError", kind: "malformed" });
    });

    it("fails closed on network error", async () => {
      await enableGatewayWithToken();
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(
        evaluatePolicy({
          source: "webmcp",
          tool: { name: "list_psps", readOnly: true },
          context: {},
          correlationId: "c-10",
        }),
      ).rejects.toMatchObject({ name: "GatewayPolicyUnavailableError", kind: "network" });
    });

    it("sanitizes dashboardUrl before send", async () => {
      await enableGatewayWithToken();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockResponse(200, { allowed: true }),
      );
      await evaluatePolicy({
        source: "webmcp",
        tool: { name: "list_psps", readOnly: true },
        context: {
          environment: "uat",
          dashboardUrl: "https://eu-test.oppwa.com/page?token=secret#x",
        },
        correlationId: "c-11",
      });
      const init = fetchSpy.mock.calls[0]![1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.context.dashboardUrl).toBe("https://eu-test.oppwa.com/page");
      expect(body.context.dashboardUrl).not.toContain("secret");
    });

    it("strips params for tools not on the allowlist", async () => {
      await enableGatewayWithToken();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockResponse(200, { allowed: true }),
      );
      await evaluatePolicy({
        source: "chat",
        tool: { name: "send_test_transaction", readOnly: false, params: { pan: "4111111111111111" } },
        context: {},
        correlationId: "c-12",
      });
      const init = fetchSpy.mock.calls[0]![1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.tool.params).toEqual({});
    });
  });

  describe("sendToolTelemetry", () => {
    it("does nothing when hooks are disabled", async () => {
      for (const key of Object.keys(localStore)) delete localStore[key];
      for (const key of Object.keys(sessionStore)) delete sessionStore[key];
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await sendToolTelemetry({
        source: "webmcp",
        eventType: "tool_execution_completed",
        tool: { name: "list_psps", readOnly: true },
        context: {},
        correlationId: "c-t1",
        outcome: { ok: true },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does not throw on telemetry failure", async () => {
      await enableGatewayWithToken();
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("net"));
      await expect(
        sendToolTelemetry({
          source: "webmcp",
          eventType: "tool_execution_completed",
          tool: { name: "list_psps", readOnly: true },
          context: {},
          correlationId: "c-t2",
          outcome: { ok: true },
        }),
      ).resolves.toBeUndefined();
      expect(getGatewayDiagnostics().gatewayTelemetryFailed).toBeGreaterThan(0);
    });

    it("counts a successful 2xx send", async () => {
      await enableGatewayWithToken();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse(201, { ok: true }));
      await sendToolTelemetry({
        source: "webmcp",
        eventType: "tool_execution_completed",
        tool: { name: "list_psps", readOnly: true },
        context: {},
        correlationId: "c-t3",
        outcome: { ok: true, durationMs: 12, status: "completed" },
      });
      expect(getGatewayDiagnostics().gatewayTelemetrySent).toBe(1);
    });
  });

  describe("sendApiTelemetry", () => {
    it("posts an api_request_completed event", async () => {
      await enableGatewayWithToken();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockResponse(201, { ok: true }),
      );
      await sendApiTelemetry({
        eventType: "api_request_completed",
        api: { method: "POST", path: "/channels/x", status: 200, attemptCount: 1 },
        correlationId: "api-1",
        parentCorrelationId: "tool-1",
        outcome: { ok: true },
      });
      const init = fetchSpy.mock.calls[0]![1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.eventType).toBe("api_request_completed");
      expect(body.api.attemptCount).toBe(1);
      expect(body.parentCorrelationId).toBe("tool-1");
    });
  });
});
