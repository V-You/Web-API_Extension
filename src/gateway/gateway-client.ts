/**
 * Gateway client: policy evaluation and telemetry ingestion.
 *
 * Strict fail-closed default: any non-2xx, malformed, timeout, or network
 * error on the policy endpoint denies the action when hooks are enabled.
 * Telemetry is fire-and-forget; failures never surface to the caller.
 */

import type {
  GatewayApiTelemetryPayload,
  GatewayContext,
  GatewayDiagnostics,
  GatewayExtensionMeta,
  GatewayPolicyDecision,
  GatewayPolicyRequest,
  GatewayPolicyResponse,
  GatewaySource,
  GatewayToolDescriptor,
  GatewayToolEventType,
  GatewayToolTelemetryPayload,
} from "./gateway-types";
import {
  GATEWAY_SCHEMA_VERSION,
  GatewayPolicyDeniedError,
  GatewayPolicyUnavailableError,
} from "./gateway-types";
import {
  getGatewaySessionToken,
  getGatewaySettings,
  lockGatewayToken,
  saveGatewayProbeStatus,
  type GatewaySettings,
} from "./gateway-storage";
import { redactToolParams, sanitizeDashboardUrl } from "./gateway-redaction";

const POLICY_TIMEOUT_MS = 5000;
const TERMINAL_TELEMETRY_TIMEOUT_MS = 1000;
const NON_TERMINAL_TELEMETRY_TIMEOUT_MS = 3000;

const GENERIC_DENIAL_MESSAGE = "Action denied by enterprise policy.";

const diagnostics: GatewayDiagnostics = {
  gatewayPolicyAllowed: 0,
  gatewayPolicyDenied: 0,
  gatewayPolicyError: 0,
  gatewayTelemetrySent: 0,
  gatewayTelemetryFailed: 0,
};

function newCorrelationId(prefix = "gateway"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getGatewayDiagnostics(): GatewayDiagnostics {
  return { ...diagnostics };
}

export function resetGatewayDiagnostics(): void {
  diagnostics.gatewayPolicyAllowed = 0;
  diagnostics.gatewayPolicyDenied = 0;
  diagnostics.gatewayPolicyError = 0;
  diagnostics.gatewayTelemetrySent = 0;
  diagnostics.gatewayTelemetryFailed = 0;
}

export interface GatewayProbeResult {
  ok: boolean;
  step: "policy" | "telemetry" | "token";
  error?: string;
}

export interface EvaluatePolicyInput {
  source: GatewaySource;
  tool: GatewayToolDescriptor;
  context: GatewayContext;
  correlationId: string;
  /** Optional override for testing. */
  now?: () => Date;
}

export interface SendToolTelemetryInput {
  source: GatewaySource;
  eventType: GatewayToolEventType;
  tool: { name: string; readOnly: boolean; params?: unknown };
  context: GatewayContext;
  correlationId: string;
  parentCorrelationId?: string;
  outcome: GatewayToolTelemetryPayload["outcome"];
  /** Terminal events (completed/failed/denied) are awaited briefly. */
  terminal?: boolean;
}

export interface SendApiTelemetryInput {
  eventType: GatewayApiTelemetryPayload["eventType"];
  api: GatewayApiTelemetryPayload["api"];
  context?: GatewayContext;
  correlationId: string;
  parentCorrelationId?: string;
  outcome: GatewayApiTelemetryPayload["outcome"];
  terminal?: boolean;
}

/**
 * Evaluate policy for a tool invocation. Throws `GatewayPolicyDeniedError`
 * for denials and `GatewayPolicyUnavailableError` for fail-closed errors.
 * When hooks are disabled, returns an `allowed: true` decision without a fetch.
 */
export async function evaluatePolicy(input: EvaluatePolicyInput): Promise<GatewayPolicyDecision> {
  const settings = await getGatewaySettings();
  if (!settings.enabled) {
    return { allowed: true, reasonVisibility: "user", cached: false };
  }
  const token = await getGatewaySessionToken();
  if (!token) {
    diagnostics.gatewayPolicyError++;
    throw new GatewayPolicyUnavailableError(
      "unauthorized",
      "Gateway token is locked. Unlock the extension with your PIN and try again.",
    );
  }

  const url = buildUrl(settings, settings.policyPath);
  const payload: GatewayPolicyRequest = {
    schemaVersion: GATEWAY_SCHEMA_VERSION,
    correlationId: input.correlationId,
    timestamp: (input.now?.() ?? new Date()).toISOString(),
    source: input.source,
    tool: {
      name: input.tool.name,
      readOnly: input.tool.readOnly,
      ...(input.tool.category ? { category: input.tool.category } : {}),
      params: redactToolParams(input.tool.name, input.tool.params) ?? {},
    },
    context: sanitizeContext(input.context),
    extension: getExtensionMeta(),
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify(payload),
    }, POLICY_TIMEOUT_MS);
  } catch (e) {
    diagnostics.gatewayPolicyError++;
    const kind = isAbortError(e) ? "timeout" : "network";
    throw new GatewayPolicyUnavailableError(
      kind,
      kind === "timeout"
        ? "Policy gateway did not respond in time."
        : "Policy gateway is unreachable.",
      e,
    );
  }

  if (res.status === 401) {
    diagnostics.gatewayPolicyError++;
    await lockGatewayTokenSilently();
    throw new GatewayPolicyUnavailableError(
      "unauthorized",
      "Gateway token was rejected. Save a fresh token in Connections.",
    );
  }
  if (!res.ok) {
    diagnostics.gatewayPolicyError++;
    throw new GatewayPolicyUnavailableError(
      "http",
      `Policy gateway returned HTTP ${res.status}.`,
    );
  }

  let body: GatewayPolicyResponse;
  try {
    body = (await res.json()) as GatewayPolicyResponse;
  } catch (e) {
    diagnostics.gatewayPolicyError++;
    throw new GatewayPolicyUnavailableError("malformed", "Policy gateway returned malformed JSON.", e);
  }

  if (typeof body?.allowed !== "boolean") {
    diagnostics.gatewayPolicyError++;
    throw new GatewayPolicyUnavailableError("malformed", "Policy response is missing 'allowed'.");
  }

  const reasonVisibility = body.reasonVisibility === "internal" ? "internal" : "user";
  const visibleReason =
    reasonVisibility === "internal"
      ? GENERIC_DENIAL_MESSAGE
      : typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : undefined;
  const internalReason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;

  if (body.allowed) {
    diagnostics.gatewayPolicyAllowed++;
    return {
      allowed: true,
      reason: visibleReason,
      code: body.code,
      reasonVisibility,
      internalReason,
      cached: false,
    };
  }

  diagnostics.gatewayPolicyDenied++;
  const decision: GatewayPolicyDecision = {
    allowed: false,
    reason: visibleReason ?? GENERIC_DENIAL_MESSAGE,
    code: body.code,
    reasonVisibility,
    internalReason,
    cached: false,
  };
  throw new GatewayPolicyDeniedError(decision, input.correlationId);
}

/** Test the configured gateway without executing an agent tool. */
export async function testGatewayConnection(): Promise<GatewayProbeResult> {
  const correlationId = newCorrelationId("probe");
  try {
    await evaluatePolicy({
      source: "sidepanel",
      tool: { name: "_gateway_probe", readOnly: true, params: {} },
      context: {},
      correlationId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const tokenIssue = err instanceof GatewayPolicyUnavailableError && err.kind === "unauthorized";
    await saveGatewayProbeStatus({ policyStatus: "failed", telemetryStatus: undefined, error: message });
    return { ok: false, step: tokenIssue ? "token" : "policy", error: message };
  }

  const telemetryBefore = diagnostics.gatewayTelemetryFailed;
  await sendToolTelemetry({
    source: "sidepanel",
    eventType: "tool_execution_completed",
    tool: { name: "_gateway_probe", readOnly: true, params: {} },
    context: {},
    correlationId,
    outcome: { ok: true, status: "probe" },
    terminal: true,
  });
  const telemetryFailed = diagnostics.gatewayTelemetryFailed > telemetryBefore;
  if (telemetryFailed) {
    const error = "Telemetry endpoint failed.";
    await saveGatewayProbeStatus({ policyStatus: "ok", telemetryStatus: "failed", error });
    return { ok: false, step: "telemetry", error };
  }

  await saveGatewayProbeStatus({ policyStatus: "ok", telemetryStatus: "ok" });
  return { ok: true, step: "telemetry" };
}

/**
 * Send a tool-level telemetry event. Fire-and-forget for non-terminal events;
 * terminal events are awaited up to TERMINAL_TELEMETRY_TIMEOUT_MS.
 */
export async function sendToolTelemetry(input: SendToolTelemetryInput): Promise<void> {
  const settings = await getGatewaySettings();
  if (!settings.enabled) return;
  const token = await getGatewaySessionToken();
  if (!token) {
    diagnostics.gatewayTelemetryFailed++;
    return;
  }
  const payload: GatewayToolTelemetryPayload = {
    schemaVersion: GATEWAY_SCHEMA_VERSION,
    correlationId: input.correlationId,
    ...(input.parentCorrelationId ? { parentCorrelationId: input.parentCorrelationId } : {}),
    timestamp: new Date().toISOString(),
    eventType: input.eventType,
    source: input.source,
    tool: {
      name: input.tool.name,
      readOnly: input.tool.readOnly,
      params: redactToolParams(input.tool.name, input.tool.params) ?? {},
    },
    context: sanitizeContext(input.context),
    outcome: input.outcome,
    extension: getExtensionMeta(),
  };
  await postTelemetry(settings, token, payload, input.terminal !== false);
}

/**
 * Send an API-level telemetry event. Same fire-and-forget rules as tool
 * telemetry; treated as terminal by default.
 */
export async function sendApiTelemetry(input: SendApiTelemetryInput): Promise<void> {
  const settings = await getGatewaySettings();
  if (!settings.enabled) return;
  const token = await getGatewaySessionToken();
  if (!token) {
    diagnostics.gatewayTelemetryFailed++;
    return;
  }
  const payload: GatewayApiTelemetryPayload = {
    schemaVersion: GATEWAY_SCHEMA_VERSION,
    correlationId: input.correlationId,
    ...(input.parentCorrelationId ? { parentCorrelationId: input.parentCorrelationId } : {}),
    timestamp: new Date().toISOString(),
    eventType: input.eventType,
    api: input.api,
    ...(input.context ? { context: sanitizeContext(input.context) } : {}),
    outcome: input.outcome,
    extension: getExtensionMeta(),
  };
  await postTelemetry(settings, token, payload, input.terminal !== false);
}

// --- internals ---------------------------------------------------------------

async function postTelemetry(
  settings: GatewaySettings,
  token: string,
  payload: unknown,
  terminal: boolean,
): Promise<void> {
  const url = buildUrl(settings, settings.telemetryPath);
  const timeout = terminal ? TERMINAL_TELEMETRY_TIMEOUT_MS : NON_TERMINAL_TELEMETRY_TIMEOUT_MS;
  const send = async () => {
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: buildHeaders(token),
        body: JSON.stringify(payload),
      }, timeout);
      if (res.ok) diagnostics.gatewayTelemetrySent++;
      else diagnostics.gatewayTelemetryFailed++;
    } catch {
      diagnostics.gatewayTelemetryFailed++;
    }
  };
  if (terminal) {
    await send();
  } else {
    void send();
  }
}

function buildUrl(settings: GatewaySettings, path: string): string {
  const host = settings.host.replace(/\/+$/, "");
  const rel = path.startsWith("/") ? path : `/${path}`;
  return `${host}${rel}`;
}

function buildHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Gateway-Schema-Version": String(GATEWAY_SCHEMA_VERSION),
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message));
}

function sanitizeContext(ctx: GatewayContext): GatewayContext {
  const out: GatewayContext = { ...ctx };
  if (out.dashboardUrl) out.dashboardUrl = sanitizeDashboardUrl(out.dashboardUrl);
  return out;
}

function getExtensionMeta(): GatewayExtensionMeta {
  try {
    const m = chrome?.runtime?.getManifest?.();
    if (m) {
      return {
        name: m.name ?? "Web API Extension",
        version: m.version ?? "0.0.0",
      };
    }
  } catch {
    // ignore - fall through to defaults
  }
  return { name: "Web API Extension", version: "0.0.0" };
}

async function lockGatewayTokenSilently(): Promise<void> {
  try {
    await lockGatewayToken();
  } catch {
    // ignore - best-effort cleanup
  }
}
