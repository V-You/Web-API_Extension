import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("crypto", {
  ...globalThis.crypto,
  randomUUID: () => "ws-uuid-1234",
});

import {
  recordWrite,
  markVerified,
  dismissWriteStatus,
  getWriteStatuses,
  subscribeWriteStatus,
} from "./write-status";

describe("write-status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clean up all entries
    for (const e of getWriteStatuses()) dismissWriteStatus(e.id);
    vi.useRealTimers();
  });

  it("records a write with accepted status", () => {
    recordWrite("Create merchant M1");
    const entries = getWriteStatuses();
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe("Create merchant M1");
    expect(entries[0].status).toBe("accepted");
  });

  it("transitions to pending_propagation after 1 second", () => {
    recordWrite("Edit entity");
    vi.advanceTimersByTime(1001);
    const entries = getWriteStatuses();
    expect(entries[0].status).toBe("pending_propagation");
  });

  it("marks a write as verified", () => {
    const id = recordWrite("Delete merchant");
    markVerified(id);
    const entries = getWriteStatuses();
    expect(entries[0].status).toBe("verified");
  });

  it("removes verified entries after display period", () => {
    const id = recordWrite("Test write");
    markVerified(id);
    vi.advanceTimersByTime(5001);
    expect(getWriteStatuses()).toHaveLength(0);
  });

  it("dismisses entries immediately", () => {
    const id = recordWrite("Dismissed write");
    dismissWriteStatus(id);
    expect(getWriteStatuses()).toHaveLength(0);
  });

  it("transitions to likely_propagated then auto-expires", () => {
    recordWrite("Auto-expiring");
    // At 180s: transitions to likely_propagated
    vi.advanceTimersByTime(180_001);
    const statuses = getWriteStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].status).toBe("likely_propagated");
    // At 190s: auto-removed
    vi.advanceTimersByTime(10_000);
    expect(getWriteStatuses()).toHaveLength(0);
  });

  it("caps entries at 20", () => {
    for (let i = 0; i < 25; i++) recordWrite(`Write ${i}`);
    expect(getWriteStatuses().length).toBeLessThanOrEqual(20);
  });

  it("notifies subscribers on state changes", () => {
    const listener = vi.fn();
    const unsub = subscribeWriteStatus(listener);

    recordWrite("Notify test");
    expect(listener).toHaveBeenCalled();

    unsub();
  });
});
