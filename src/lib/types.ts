/** Shared types for the Web API Extension. */

export type Environment = "uat" | "prod";

export interface ApiCredentials {
  baseUrl: string;
  username: string;
  password: string;
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
export type WriteStatus = "accepted" | "pending_propagation" | "verified";

/** Job lifecycle states per PRD section 8.3. */
export type JobState =
  | "running"
  | "paused"
  | "resumed"
  | "cancelled"
  | "failed"
  | "completed";

/** Audit event types per PRD section 4.5. */
export type AuditEventType =
  | "setting_change"
  | "entity_create"
  | "entity_delete"
  | "contact_create"
  | "contact_delete"
  | "contact_lock"
  | "contact_unlock"
  | "contact_attach"
  | "contact_detach"
  | "contact_password_reset"
  | "ma_create"
  | "ma_update"
  | "ma_attach"
  | "ma_detach"
  | "env_switch";

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
