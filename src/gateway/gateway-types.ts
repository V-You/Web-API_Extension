/**
 * Shared types for the BYOG (bring-your-own-gateway) policy and telemetry
 * surface. Mirror of section 6 of md/2026-05-24_PRD_bring-your-own-gateway-hooks.md.
 */

export const GATEWAY_SCHEMA_VERSION = 1;

export type GatewaySource = "webmcp" | "chat" | "job" | "api";

export interface GatewayContext {
  environment?: string;
  entityId?: string;
  entityType?: string;
  entityName?: string;
  section?: string;
  ids?: {
    pspId?: string;
    merchantId?: string;
    channelId?: string;
    [k: string]: string | undefined;
  };
  /** Sanitized to origin + pathname before send. */
  dashboardUrl?: string;
}

export interface GatewayExtensionMeta {
  name: string;
  version: string;
  buildTimestamp?: string;
}

export interface GatewayToolDescriptor {
  name: string;
  readOnly: boolean;
  category?: string;
  params?: Record<string, unknown>;
}

export interface GatewayPolicyRequest {
  schemaVersion: typeof GATEWAY_SCHEMA_VERSION;
  correlationId: string;
  timestamp: string;
  source: GatewaySource;
  tool: GatewayToolDescriptor;
  context: GatewayContext;
  extension: GatewayExtensionMeta;
}

export type GatewayReasonVisibility = "user" | "internal";

export interface GatewayPolicyResponse {
  allowed: boolean;
  reason?: string;
  code?: string;
  reasonVisibility?: GatewayReasonVisibility;
}

export interface GatewayPolicyDecision {
  allowed: boolean;
  /** Reason safe to show to user/agent (already filtered by reasonVisibility). */
  reason?: string;
  code?: string;
  reasonVisibility: GatewayReasonVisibility;
  /** Verbatim reason for local diagnostics only. */
  internalReason?: string;
  /** True when this decision came from the SW confirm round-trip cache. */
  cached: boolean;
}

export type GatewayToolEventType =
  | "tool_execution_completed"
  | "tool_execution_denied"
  | "tool_execution_failed"
  | "job_started"
  | "job_completed"
  | "job_failed";

export type GatewayApiEventType = "api_request_completed";

export type GatewayEventType = GatewayToolEventType | GatewayApiEventType;

export interface GatewayToolTelemetryPayload {
  schemaVersion: typeof GATEWAY_SCHEMA_VERSION;
  correlationId: string;
  parentCorrelationId?: string;
  timestamp: string;
  eventType: GatewayToolEventType;
  source: GatewaySource;
  tool: {
    name: string;
    readOnly: boolean;
    params?: Record<string, unknown>;
  };
  context: GatewayContext;
  outcome: {
    ok: boolean;
    durationMs?: number;
    status?: string;
    errorCode?: string;
    errorMessage?: string;
  };
  extension: GatewayExtensionMeta;
}

export interface GatewayApiTelemetryPayload {
  schemaVersion: typeof GATEWAY_SCHEMA_VERSION;
  correlationId: string;
  parentCorrelationId?: string;
  timestamp: string;
  eventType: GatewayApiEventType;
  api: {
    method: string;
    path: string;
    status: number;
    environment?: string;
    attemptCount: number;
    apiOutcome?: {
      resultCode?: string;
      isError?: boolean;
    };
  };
  context?: GatewayContext;
  outcome: { ok: boolean; errorMessage?: string };
  extension: GatewayExtensionMeta;
}

export type GatewayTelemetryPayload =
  | GatewayToolTelemetryPayload
  | GatewayApiTelemetryPayload;

/** Local diagnostic counters surfaced via gateway-client.getDiagnostics(). */
export interface GatewayDiagnostics {
  gatewayPolicyAllowed: number;
  gatewayPolicyDenied: number;
  gatewayPolicyError: number;
  gatewayTelemetrySent: number;
  gatewayTelemetryFailed: number;
}

/** Errors thrown by the gateway client. */
export class GatewayPolicyDeniedError extends Error {
  readonly decision: GatewayPolicyDecision;
  constructor(decision: GatewayPolicyDecision) {
    super(decision.reason ?? "Action denied by enterprise policy.");
    this.name = "GatewayPolicyDeniedError";
    this.decision = decision;
  }
}

export class GatewayPolicyUnavailableError extends Error {
  readonly cause?: unknown;
  readonly kind: "timeout" | "network" | "unauthorized" | "http" | "malformed";
  constructor(kind: GatewayPolicyUnavailableError["kind"], message: string, cause?: unknown) {
    super(message);
    this.name = "GatewayPolicyUnavailableError";
    this.kind = kind;
    this.cause = cause;
  }
}
