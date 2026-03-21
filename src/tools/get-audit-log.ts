/**
 * get_audit_log tool handler.
 *
 * Retrieves entries from the local audit log stored in chrome.storage.local.
 * Supports filtering by event type, entity, and time range.
 */

import type { AuditEntry, AuditEventType } from "../lib/types";

export interface GetAuditLogInput {
  /** Filter by event type. */
  eventType?: AuditEventType;
  /** Filter by entity ID (substring match). */
  entityId?: string;
  /** Maximum entries to return (default: 50). */
  limit?: number;
  /** ISO timestamp -- only entries after this time. */
  since?: string;
}

export async function executeGetAuditLog(input: GetAuditLogInput) {
  const result = await chrome.storage.local.get("audit");
  let entries = (result.audit ?? []) as AuditEntry[];

  if (input.eventType) {
    entries = entries.filter((e) => e.eventType === input.eventType);
  }

  if (input.entityId) {
    const q = input.entityId.toLowerCase();
    entries = entries.filter((e) => e.entityId.toLowerCase().includes(q));
  }

  if (input.since) {
    const since = new Date(input.since).getTime();
    entries = entries.filter((e) => new Date(e.timestamp).getTime() >= since);
  }

  const limit = Math.min(input.limit ?? 50, 500);
  // Return newest first, capped
  const sliced = entries.slice(-limit).reverse();

  return {
    totalStored: (result.audit as AuditEntry[] | undefined)?.length ?? 0,
    matchCount: entries.length,
    returned: sliced.length,
    entries: sliced,
  };
}
