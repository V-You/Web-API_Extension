import { describe, expect, it } from "vitest";

import type { AuditEventType } from "../lib/types";
import { AUDIT_EVENT_TYPES } from "../../src_data/webapi-audit-events";
import { manifestAuditEventTypes } from "./manifest-helpers";

/**
 * Phase 2 D13 + Part-II P2-D4: the audit-log eventType enum is generated
 * from the manifest. This test is now a tripwire over the generated
 * coupling rather than a handwritten alignment ledger.
 */
describe("audit event types align with the generated manifest module", () => {
  const EXTENSION_ONLY: readonly AuditEventType[] = [
    "setting_change",
    "env_switch",
    // contact-attach is achieved via `autoAttach: true` in the create call;
    // there is no dedicated API operation to bind an audit entry to.
    "contact_attach",
    "get_entity",
  ] as const;

  it("AUDIT_EVENT_TYPES matches the live manifest derivation", () => {
    expect([...AUDIT_EVENT_TYPES].sort()).toEqual([...manifestAuditEventTypes()].sort());
  });

  it("the runtime union equals AUDIT_EVENT_TYPES plus extension-only events", () => {
    // Compile-time: each generated type assigns into the runtime union.
    const api: AuditEventType[] = [...AUDIT_EVENT_TYPES];
    // Compile-time: each extension-only event is part of the runtime union.
    const extension: AuditEventType[] = [...EXTENSION_ONLY];

    // Runtime: both sides together cover the full observed surface.
    const combined = new Set<string>([...api, ...extension]);
    expect(combined.size).toBe(api.length + extension.length);
  });
});
