import { describe, expect, it } from "vitest";

import type { AuditEventType } from "../lib/types";
import { manifestAuditEventTypes } from "./manifest-helpers";

/**
 * Phase 2 D13: the audit-log eventType enum is derived from the manifest.
 * Every event-type string mentioned in the manifest must be present in
 * the runtime union; every non-env event type in the union must have a
 * manifest origin.
 */
describe("audit event types align with the manifest", () => {
  // Keep this list in sync with `AuditEventType` in `src/lib/types.ts`.
  const RUNTIME_EVENT_TYPES: AuditEventType[] = [
    "setting_change",
    "entity_create",
    "entity_edit",
    "entity_delete",
    "contact_create",
    "contact_edit",
    "contact_delete",
    "contact_lock",
    "contact_unlock",
    "contact_attach",
    "contact_detach",
    "contact_password_reset",
    "ma_create",
    "ma_update",
    "ma_delete",
    "ma_attach",
    "ma_detach",
    "env_switch",
  ] as const;

  const EXTENSION_ONLY = new Set<AuditEventType>([
    "setting_change",
    "env_switch",
    // contact-attach is achieved via `autoAttach: true` in the create call;
    // there is no dedicated API operation to bind an audit entry to.
    "contact_attach",
  ]);

  it("every manifest event type is present in the runtime union", () => {
    const runtime = new Set(RUNTIME_EVENT_TYPES);
    for (const ev of manifestAuditEventTypes()) {
      expect(runtime.has(ev as AuditEventType)).toBe(true);
    }
  });

  it("every runtime API event type has a manifest origin", () => {
    const manifestSet = new Set(manifestAuditEventTypes());
    for (const ev of RUNTIME_EVENT_TYPES) {
      if (EXTENSION_ONLY.has(ev)) continue;
      expect(manifestSet.has(ev)).toBe(true);
    }
  });
});
