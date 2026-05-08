/** Shared types for the Web API Extension. */

import type { EntityType } from "./entity-types";

export type Environment = "uat" | "prod";

export interface ApiCredentials {
  baseUrl: string;
  username: string;
  password: string;
  /** @deprecated Use scopeEntityId + scopeEntityType instead. Kept for migration. */
  pspId?: string;
  /** Entity ID the Web API user is attached to. */
  scopeEntityId?: string;
  /** Entity type the user is attached to (default: "psp"). */
  scopeEntityType?: EntityType;
}

/** Environments with their default base URLs. */
export const ENV_DEFAULTS: Record<Environment, { baseUrl: string; label: string }> = {
  uat: {
    baseUrl: "https://eu-test.oppwa.com/bip/webapi/v1",
    label: "UAT",
  },
  prod: {
    baseUrl: "https://eu-prod.oppwa.com/bip/webapi/v1",
    label: "Production",
  },
};

/** Post-write status model per PRD section 13.1. */
export type WriteStatus = "accepted" | "pending_propagation" | "likely_propagated" | "verified";

/** Job lifecycle states per PRD section 8.3. */
export type JobState =
  | "running"
  | "paused"
  | "resumed"
  | "cancelled"
  | "failed"
  | "completed";

/**
 * Audit event types.
/**
 * Audit event type.
 *
 * Part-II P2-D4: the API-derived portion is generated from
 * `src_data/webapi-audit-events.ts` (itself derived from the manifest).
 * Extension-only events -- `setting_change` (local RiRo writes),
 * `env_switch` (UI environment toggles), `contact_attach` (no per-action
 * tool in the bundled spec), `get_entity` (audited handwritten entity reads),
 * API token lifecycle events (Connections-owned controls may exist even when
 * CI fixtures omit the token operations), and `chat_automation_job_started`
 * (reviewed Chat job provenance) -- are declared here as literals. An alignment
 * test asserts both sides stay in sync.
 */
import type { ApiAuditEventType } from "../../src_data/webapi-audit-events";

export type AuditEventType =
  | ApiAuditEventType
  | "setting_change"
  | "env_switch"
  | "contact_attach"
  | "get_entity"
  | "api_token_activate"
  | "api_token_create"
  | "api_token_delete"
  | "api_token_suspend"
  | "api_token_update"
  | "chat_automation_job_started";

export interface AuditEntry {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  entityId: string;
  entityType: string;
  parameters: Record<string, unknown>;
  responseStatus: number;
  environment: Environment;
}
