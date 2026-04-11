import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginScope,
  endScope,
  requestConfirm,
  resolveConfirm,
  getPending,
  subscribe,
  type WritePreview,
} from "./confirm-bridge";

describe("confirm-bridge", () => {
  beforeEach(() => {
    endScope(); // reset scope state
  });

  const preview: WritePreview = {
    tool: "manage_entity",
    action: "delete",
    method: "DELETE",
    description: "Delete merchant m1",
    params: { entityId: "m1", entityType: "merchant" },
    env: "uat",
  };

  it("returns pending state when a confirmation is requested", () => {
    // Subscribe so the bridge uses the promise path (not native confirm fallback)
    const unsub = subscribe(() => {});

    requestConfirm(preview); // don't await -- it blocks until resolved
    const pending = getPending();
    expect(pending).not.toBeNull();
    expect(pending!.preview.tool).toBe("manage_entity");
    expect(pending!.preview.action).toBe("delete");
    expect(pending!.hasScope).toBe(false);

    resolveConfirm("cancel"); // clean up
    unsub();
  });

  it("resolves with confirm when user confirms", async () => {
    const unsub = subscribe(() => {});

    const promise = requestConfirm(preview);
    resolveConfirm("confirm");
    const result = await promise;

    expect(result).toBe("confirm");
    expect(getPending()).toBeNull();
    unsub();
  });

  it("resolves with cancel when user cancels", async () => {
    const unsub = subscribe(() => {});

    const promise = requestConfirm(preview);
    resolveConfirm("cancel");
    const result = await promise;

    expect(result).toBe("cancel");
    unsub();
  });

  it("auto-confirms within the same scope after confirm_all", async () => {
    const unsub = subscribe(() => {});

    beginScope("test-scope");

    // First confirmation in scope -- user clicks "confirm all"
    const p1 = requestConfirm(preview);
    resolveConfirm("confirm_all");
    const r1 = await p1;
    expect(r1).toBe("confirm"); // confirm_all resolves as "confirm"

    // Second confirmation in the same scope -- auto-confirmed
    const r2 = await requestConfirm(preview);
    expect(r2).toBe("confirm");

    endScope();
    unsub();
  });

  it("does not auto-confirm after scope ends", async () => {
    const unsub = subscribe(() => {});

    beginScope("scope-a");
    const p1 = requestConfirm(preview);
    resolveConfirm("confirm_all");
    await p1;
    endScope();

    // New request outside scope -- should require confirmation again
    const p2 = requestConfirm(preview);
    expect(getPending()).not.toBeNull();
    resolveConfirm("cancel");
    const r2 = await p2;
    expect(r2).toBe("cancel");

    unsub();
  });

  it("reports hasScope=true when inside a scope", () => {
    const unsub = subscribe(() => {});

    beginScope("my-scope");
    requestConfirm(preview);
    const pending = getPending();
    expect(pending!.hasScope).toBe(true);

    resolveConfirm("cancel");
    endScope();
    unsub();
  });

  it("notifies subscribers when state changes", async () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);

    const p = requestConfirm(preview);
    expect(listener).toHaveBeenCalled(); // notified on pending
    const callsBefore = listener.mock.calls.length;

    resolveConfirm("confirm");
    await p;
    expect(listener.mock.calls.length).toBeGreaterThan(callsBefore); // notified on resolve

    unsub();
  });
});
