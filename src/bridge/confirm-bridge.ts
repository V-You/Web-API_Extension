/**
 * Preview/confirm bridge.
 *
 * Singleton that connects write operations (from both WebMCP direct calls
 * and sandbox code) to the side panel UI for user confirmation.
 *
 * Since both the WebMCP tool registration and the React side panel share
 * the same JS context (sidepanel page), this uses a simple promise-based
 * approach with useSyncExternalStore-compatible subscription.
 *
 * Flow:
 *   1. Tool handler calls requestConfirm(preview)
 *   2. Bridge sets pending state, notifies React subscribers
 *   3. ConfirmDialog renders showing write details
 *   4. User clicks Confirm / Cancel / Confirm All
 *   5. Promise resolves, tool handler proceeds or throws
 */

import type { Environment } from "../lib/types";

// -- Types ----------------------------------------------------------------

export interface WritePreview {
  /** Tool name (e.g., "manage_entity"). */
  tool: string;
  /** Action name (e.g., "create", "delete"). */
  action: string;
  /** HTTP method the API call will use. */
  method: "POST" | "DELETE";
  /** Human-readable description of the operation. */
  description: string;
  /** Key parameters being sent. */
  params: Record<string, unknown>;
  /** Active environment -- so the UI can highlight Prod. */
  env: Environment;
}

export type ConfirmChoice = "confirm" | "cancel" | "confirm_all";

export interface PendingConfirmation {
  preview: WritePreview;
  /** Whether the request originates from a scoped context (sandbox). */
  hasScope: boolean;
}

// -- State ----------------------------------------------------------------

let pendingResolve: ((choice: ConfirmChoice) => void) | null = null;
let pendingState: PendingConfirmation | null = null;

// Scoped auto-confirm: when the user clicks "confirm all" inside a sandbox
// scope, subsequent writes in the same scope skip the dialog.
let currentScopeId: string | null = null;
let autoConfirmScopeId: string | null = null;

const listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of listeners) fn();
}

// -- Public API -----------------------------------------------------------

/**
 * Begin a confirmation scope (e.g., for a sandbox execution).
 * "Confirm all" only applies within the same scope.
 */
export function beginScope(scopeId: string) {
  currentScopeId = scopeId;
  autoConfirmScopeId = null;
}

/** End the current scope, resetting auto-confirm. */
export function endScope() {
  currentScopeId = null;
  autoConfirmScopeId = null;
}

/**
 * Request user confirmation for a write operation.
 * Resolves when the user responds. Throws never -- callers check the result.
 */
export function requestConfirm(preview: WritePreview): Promise<ConfirmChoice> {
  // Auto-confirm if the user previously chose "confirm all" in this scope
  if (currentScopeId && autoConfirmScopeId === currentScopeId) {
    return Promise.resolve("confirm");
  }

  return new Promise<ConfirmChoice>((resolve) => {
    pendingState = { preview, hasScope: currentScopeId !== null };
    pendingResolve = (choice) => {
      if (choice === "confirm_all" && currentScopeId) {
        autoConfirmScopeId = currentScopeId;
      }
      pendingState = null;
      pendingResolve = null;
      notifyListeners();
      resolve(choice === "confirm_all" ? "confirm" : choice);
    };
    notifyListeners();
  });
}

/** Get the current pending confirmation (if any). Snapshot for useSyncExternalStore. */
export function getPending(): PendingConfirmation | null {
  return pendingState;
}

/** Resolve the pending confirmation. Called by the UI. */
export function resolveConfirm(choice: ConfirmChoice) {
  pendingResolve?.(choice);
}

/** Subscribe to state changes. Returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
