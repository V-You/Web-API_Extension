/**
 * Service-worker-only bridge that runs a tool invocation through the gateway
 * policy/telemetry pipeline. Holds a short-lived in-memory cache so the
 * preview-confirm round-trip does not re-evaluate the same policy.
 *
 * Cache key: tool + canonicalJson(params) + sessionId.
 * TTL: 60s. Max entries: 50 (FIFO eviction).
 */

import {
  evaluatePolicy,
  sendToolTelemetry,
  type SendToolTelemetryInput,
} from "./gateway-client";
import type {
  GatewayContext,
  GatewayPolicyDecision,
  GatewaySource,
  GatewayToolEventType,
} from "./gateway-types";
import { GatewayPolicyDeniedError, GatewayPolicyUnavailableError } from "./gateway-types";

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 50;

interface CacheEntry {
  correlationId: string;
  decision: GatewayPolicyDecision;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Stable per-SW-process session ID; cleared on SW restart. */
const SW_SESSION_ID = generateSessionId();

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function newCorrelationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(",")}}`;
}

function cacheKey(tool: string, params: Record<string, unknown>): string {
  return `${tool}|${canonicalJson(params)}|${SW_SESSION_ID}`;
}

function pruneCache(now: number): void {
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  while (cache.size > CACHE_MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

export interface GatewayWebMcpDecision {
  correlationId: string;
  decision: GatewayPolicyDecision;
}

export interface EvaluateWebMcpInput {
  source: GatewaySource;
  tool: { name: string; readOnly: boolean };
  params: Record<string, unknown>;
  context: GatewayContext;
  /** Strip params from the cache key (used when params include large blobs). */
  cacheParamsOverride?: Record<string, unknown>;
}

/**
 * Evaluate gateway policy with confirm-round-trip caching. Returns the
 * cached or fresh decision. Throws `GatewayPolicyDeniedError` or
 * `GatewayPolicyUnavailableError` on failure - callers must catch and turn
 * those into model-readable tool errors.
 */
export async function evaluateWebMcpPolicy(
  input: EvaluateWebMcpInput,
): Promise<GatewayWebMcpDecision> {
  const key = cacheKey(input.tool.name, input.cacheParamsOverride ?? input.params);
  const now = Date.now();
  pruneCache(now);
  const existing = cache.get(key);
  if (existing && existing.decision.allowed) {
    // Mark as cached on the returned object copy.
    return {
      correlationId: existing.correlationId,
      decision: { ...existing.decision, cached: true },
    };
  }

  const correlationId = existing?.correlationId ?? newCorrelationId();
  const decision = await evaluatePolicy({
    source: input.source,
    tool: { name: input.tool.name, readOnly: input.tool.readOnly, params: input.params },
    context: input.context,
    correlationId,
  });

  if (decision.allowed) {
    cache.set(key, {
      correlationId,
      decision: { ...decision, cached: false },
      expiresAt: now + CACHE_TTL_MS,
    });
  }
  return { correlationId, decision };
}

/**
 * Drop any cached entries for this tool+params pair after the final
 * execute - prevents stale "allowed" decisions from being reused after
 * the agent already acted on them.
 */
export function invalidateWebMcpCache(tool: string, params: Record<string, unknown>): void {
  cache.delete(cacheKey(tool, params));
}

export interface FireToolTelemetryInput {
  source: GatewaySource;
  eventType: GatewayToolEventType;
  tool: { name: string; readOnly: boolean };
  params: Record<string, unknown>;
  context: GatewayContext;
  correlationId: string;
  outcome: SendToolTelemetryInput["outcome"];
  terminal?: boolean;
}

export async function fireToolTelemetry(input: FireToolTelemetryInput): Promise<void> {
  try {
    await sendToolTelemetry({
      source: input.source,
      eventType: input.eventType,
      tool: { name: input.tool.name, readOnly: input.tool.readOnly, params: input.params },
      context: input.context,
      correlationId: input.correlationId,
      outcome: input.outcome,
      terminal: input.terminal,
    });
  } catch {
    // sendToolTelemetry is fire-and-forget but guard anyway.
  }
}

/** Translate gateway errors into user/model-readable strings. */
export function gatewayErrorMessage(err: unknown): string {
  if (err instanceof GatewayPolicyDeniedError) {
    return err.decision.reason ?? "Action denied by enterprise policy.";
  }
  if (err instanceof GatewayPolicyUnavailableError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export const __test = { cache, cacheKey, canonicalJson };
