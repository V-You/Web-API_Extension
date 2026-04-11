/**
 * Post-write status tracker per PRD section 13.1.
 *
 * After a write operation is confirmed and accepted by the API,
 * this tracks the status lifecycle: accepted -> pending propagation -> verified.
 *
 * The API is eventually consistent -- a 200 does not mean the change is
 * immediately visible. This store surfaces that honestly.
 */

import type { WriteStatus } from "../lib/types";

export interface WriteStatusEntry {
  id: string;
  description: string;
  status: WriteStatus;
  timestamp: number;
  /** Milliseconds since accepted -- for propagation timer display. */
  elapsedMs: number;
}

const PROPAGATION_WINDOW_MS = 180_000; // 3 minutes per PRD

let entries: WriteStatusEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/** Record a new write that was accepted by the API. */
export function recordWrite(description: string): string {
  const entry: WriteStatusEntry = {
    id: crypto.randomUUID(),
    description,
    status: "accepted",
    timestamp: Date.now(),
    elapsedMs: 0,
  };
  entries = [entry, ...entries].slice(0, 20);

  // Transition to pending_propagation after a short delay
  setTimeout(() => {
    const e = entries.find((x) => x.id === entry.id);
    if (e && e.status === "accepted") {
      e.status = "pending_propagation";
      e.elapsedMs = Date.now() - e.timestamp;
      notify();
    }
  }, 1000);

  // Auto-transition to likely_propagated after the propagation window
  setTimeout(() => {
    const e2 = entries.find((x) => x.id === entry.id);
    if (e2 && (e2.status === "pending_propagation" || e2.status === "accepted")) {
      e2.status = "likely_propagated";
      e2.elapsedMs = Date.now() - e2.timestamp;
      notify();
    }
    // Remove after a short display period
    setTimeout(() => {
      entries = entries.filter((x) => x.id !== entry.id);
      notify();
    }, 10_000);
  }, PROPAGATION_WINDOW_MS);

  notify();
  return entry.id;
}

/** Mark a write as verified (e.g., after a follow-up GET confirms the change). */
export function markVerified(id: string) {
  const e = entries.find((x) => x.id === id);
  if (e) {
    e.status = "verified";
    e.elapsedMs = Date.now() - e.timestamp;
    notify();
    // Remove after a short display period
    setTimeout(() => {
      entries = entries.filter((x) => x.id !== id);
      notify();
    }, 5000);
  }
}

/** Dismiss a status entry. */
export function dismissWriteStatus(id: string) {
  entries = entries.filter((x) => x.id !== id);
  notify();
}

export function getWriteStatuses(): WriteStatusEntry[] {
  // Update elapsed times
  const now = Date.now();
  for (const e of entries) {
    e.elapsedMs = now - e.timestamp;
  }
  return entries;
}

export function subscribeWriteStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
